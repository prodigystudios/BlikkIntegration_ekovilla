"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
// Typ-only: raderas vid bygget, så den drar INTE in pdf.js i paketet. Poängen är att
// type-check ska fånga fel i pdf.js-API:et — se teardown-kommentaren i steg 2 för den bugg
// som slapp igenom när de här referenserna var `any`.
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';

// PDF-visare som renderar sidorna själv.
//
// 🧨 VARFÖR INTE <iframe>: första versionen bäddade in den signerade URL:en i en iframe. I
// Chrome fungerade det, men WebKit — alltså Safari, iPhone OCH vår PWA, som är den enda vy
// installatörerna har — renderar en inbäddad pdf som en STATISK FÖRHANDSBILD AV SIDA 1. En
// tvåsidig lathund såg ut att vara en sida, utan felmeddelande och utan scroll. Samma
// observation står sedan tidigare i WorkOrderFilesTab.tsx; skillnaden är att arbetsordern
// hade råd att skicka användaren till webbläsarens egen visare, och det har inte en PWA:
// där kastas man ur appen utan väg tillbaka.
//
// Därför ritar vi sidorna på canvas med pdf.js. Det är samma motor som Firefox och
// webbläsarnas egna visare bygger på, och den beter sig identiskt i alla webbläsare.
//
// LEGACY-BYGGET med flit: pdfjs-dist 6 använder Promise.withResolvers(), som saknas i Safari
// före 17.4. Legacy-bygget bär med sig polyfillen. En telefon som inte uppdaterats hade
// annars fått en tom ruta — och det är precis de telefonerna det här är byggt för.

type PdfPageBox = { number: number; ratio: number };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

// Rita sidorna strax innan de scrollas in, inte alla på en gång: en lathund på tjugo sidor
// hade annars låst telefonen i flera sekunder vid öppning.
const RENDER_MARGIN = '300px';

// Modulen laddas EN gång per flik och delas av varje visare på sidan. Dynamiskt eftersom
// bygget är ~1 MB — det ska inte ligga i startpaketet för en sida där de flesta bara läser text.
type PdfjsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfjsModule> | null = null;

function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
      // 🧨 Sökvägen pekar på en fil i public/ och INTE på ett bundlat `new URL(...)`. Det
      // receptet får Next att skicka workern genom SWC, som failar hela bygget — hela
      // resonemanget står i scripts/copy-pdf-worker.mjs, som lägger filen här vid varje
      // install och build så att versionen alltid följer paketet.
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export default function PdfViewer({
  url,
  label,
  downloadUrl,
  fileName,
}: {
  url: string;
  label: string;
  downloadUrl: string;
  fileName: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pages, setPages] = useState<PdfPageBox[]>([]);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(0);
  const [visiblePages, setVisiblePages] = useState<number[]>([]);
  // 0-100, eller null när filens storlek inte går att läsa.
  const [progress, setProgress] = useState<number | null>(null);

  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const tasksRef = useRef(new Map<number, RenderTask>());
  // Sida -> vilken skala den ritades i. Ändras skalan matchar nyckeln inte längre och sidan
  // ritas om; annars hade en zoomning gett en uppförstorad, suddig canvas.
  const renderedRef = useRef(new Map<number, string>());
  // Läses inne i renderPage utan att ligga i dess deps: annars byggs funktionen om vid varje
  // zoomklick, och varenda observatör nedan måste kopplas om i samma veva.
  const zoomRef = useRef(zoom);
  const fitRef = useRef(fitWidth);
  zoomRef.current = zoom;
  fitRef.current = fitWidth;

  // ── Steg 1: gör ingenting förrän dragspelet öppnats ──────────────────────────
  // Visaren monteras även när dragspelet är stängt — React bryr sig inte om att förälderns
  // innehåll är display:none. Ett element utan layout kan aldrig skära vyn, så observatören
  // slår först när fliken faktiskt fällts ut. Utan den här grinden hade en sida med fem
  // pdf:er hämtat och avkodat alla fem direkt vid sidladdning, på mobildata.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || started) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { rootMargin: RENDER_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [started]);

  // ── Steg 2: öppna dokumentet ────────────────────────────────────────────────
  useEffect(() => {
    if (!started) return;
    let cancelled = false;

    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const task = pdfjs.getDocument({ url });
        // Hunnit avbrytas medan pdf.js laddades? Då har städningen nedan redan kört och sett
        // en tom referens — uppgiften måste rivas här, annars fortsätter den hämta i bakgrunden.
        if (cancelled) {
          void task.destroy().catch(() => {});
          return;
        }
        loadingTaskRef.current = task;

        // Hela filen hämtas innan första sidan kan ritas, och det är MÄTT och inte antaget:
        // storage svarar visserligen på Range, men skickar ingen Access-Control-Expose-Headers,
        // så webbläsaren får inte läsa accept-ranges/content-range och pdf.js faller tillbaka
        // på en hel hämtning. På mobildata är skillnaden mellan "det händer inget" och en
        // procentsats hela skillnaden.
        task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
          if (cancelled || !total) return;
          setProgress(Math.min(100, Math.round((loaded / total) * 100)));
        };

        const doc = await task.promise;
        if (cancelled) return;

        // Sidmåtten tas från FÖRSTA sidan och används som platshållare för alla. Att fråga
        // varje sida hade betytt ett anrop per sida innan något ens ritats; nästan alla
        // dokument har enhetlig sidstorlek, och den sida som avviker rättar sin egen ruta
        // när den ritas (se renderPage).
        const first = await doc.getPage(1);
        const box = first.getViewport({ scale: 1 });
        const ratio = box.height / box.width;
        if (cancelled) return;

        docRef.current = doc;
        setPages(Array.from({ length: doc.numPages }, (_, i) => ({ number: i + 1, ratio })));
        setStatus('ready');
      } catch {
        // En laddning som avbryts kastar också. Att stänga en flik ska inte lämna efter sig
        // ett felmeddelande i en vy som inte längre finns.
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      // Ordningen spelar roll: avbryt pågående ritningar innan dokumentet rivs, annars
      // kastar de mot ett stängt dokument.
      for (const task of tasksRef.current.values()) task.cancel();
      tasksRef.current.clear();
      renderedRef.current.clear();
      docRef.current = null;

      // 🧨 destroy() ligger på LADDNINGSUPPGIFTEN, inte på dokumentet. PDFDocumentProxy har
      // ingen destroy() i pdfjs-dist 6 — den togs bort. Första versionen anropade
      // doc.destroy() och kraschade sidan med "doc.destroy is not a function" när man lämnade
      // den. Att den slapp igenom utvecklingsläget är ingen tillfällighet: StrictMode kör
      // städningen direkt efter monteringen, alltså INNAN dokumentet hunnit laddas, och då var
      // referensen tom och grenen hoppades över. Buggen fanns bara efter en LYCKAD laddning.
      const task = loadingTaskRef.current;
      loadingTaskRef.current = null;
      void task?.destroy().catch(() => {});
    };
  }, [started, url]);

  // ── Steg 3: mät bredden ─────────────────────────────────────────────────────
  // Sidorna ritas i den bredd de faktiskt visas i, inte i en gissad. Mätningen kan bara ske
  // när rutan har layout, alltså efter att dragspelet öppnats — därför en ResizeObserver och
  // inte en engångsmätning.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setFitWidth(Math.round(width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [status]);

  // ── Steg 4: rita en sida ────────────────────────────────────────────────────
  const renderPage = useCallback(async (pageNumber: number) => {
    const doc = docRef.current;
    const canvas = canvasRefs.current.get(pageNumber);
    const cssWidth = fitRef.current * zoomRef.current;
    if (!doc || !canvas || cssWidth <= 0) return;

    const key = `${Math.round(cssWidth)}`;
    if (renderedRef.current.get(pageNumber) === key) return;
    renderedRef.current.set(pageNumber, key);

    // 🧨 En canvas får ha EXAKT en pågående rendering. Utan avbrytningen kastar pdf.js
    // "Cannot use the same canvas during multiple render() operations" så fort man zoomar
    // medan en sida fortfarande ritas — och då blir sidan permanent tom.
    tasksRef.current.get(pageNumber)?.cancel();

    try {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });

      // Ritas i skärmens pixeltäthet så texten blir skarp på en telefon, men taket på 2
      // hindrar en 3x-skärm från att ge en fyra gånger så tung canvas per sida.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });

      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);

      const task = page.render({ canvas, viewport });
      tasksRef.current.set(pageNumber, task);
      await task.promise;

      // Sidan som avviker från den första rättar sin egen platshållare i efterhand.
      // Oförändrat mått måste ge SAMMA array tillbaka — annars renderar varje ritad sida om
      // hela listan, och i ett dokument med enhetlig sidstorlek är det varenda sida.
      const trueRatio = base.height / base.width;
      setPages((prev) => {
        const box = prev.find((p) => p.number === pageNumber);
        if (!box || Math.abs(box.ratio - trueRatio) <= 0.01) return prev;
        return prev.map((p) => (p.number === pageNumber ? { ...p, ratio: trueRatio } : p));
      });
    } catch (error: any) {
      // RenderingCancelledException är väntad — den kommer från vår egen cancel() ovan.
      // Allt annat ska få ett nytt försök nästa gång sidan kommer i vy.
      if (error?.name !== 'RenderingCancelledException') renderedRef.current.delete(pageNumber);
    } finally {
      tasksRef.current.delete(pageNumber);
    }
  }, []);

  // ── Steg 5: håll reda på vilka sidor som syns ───────────────────────────────
  useEffect(() => {
    const root = scrollRef.current;
    if (status !== 'ready' || !root || pages.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const number = Number((entry.target as HTMLElement).dataset.page);
            if (!number) continue;
            if (entry.isIntersecting) next.add(number);
            else next.delete(number);
          }
          const list = Array.from(next).sort((a, b) => a - b);
          // Samma innehåll ska ge samma referens, annars triggar varje scrollhack en
          // omrendering av hela listan.
          return list.length === prev.length && list.every((n, i) => n === prev[i]) ? prev : list;
        });
      },
      { root, rootMargin: RENDER_MARGIN },
    );

    for (const el of Array.from(root.querySelectorAll('[data-page]'))) observer.observe(el);
    return () => observer.disconnect();
  }, [status, pages.length]);

  // ── Steg 6: rita det som syns, i den skala som gäller nu ────────────────────
  useEffect(() => {
    if (status !== 'ready' || fitWidth <= 0) return;
    // Första sidan ritas även innan observatören hunnit rapportera något, så rutan aldrig
    // står tom i det ögonblick den fälls ut.
    const wanted = visiblePages.length > 0 ? visiblePages : [1];
    for (const number of wanted) void renderPage(number);
  }, [status, visiblePages, zoom, fitWidth, renderPage]);

  const currentPage = visiblePages[0] ?? 1;
  const pageWidth = Math.max(fitWidth * zoom, 1);

  const changeZoom = (delta: number) => {
    setZoom((prev) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((prev + delta) * 100) / 100));
      return next;
    });
  };

  return (
    <div ref={rootRef} className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="text-[13px] font-semibold text-slate-900">{label}</div>
        <div className="flex items-center gap-1.5">
          {status === 'ready' && pages.length > 0 && (
            <>
              <span className="mr-1 text-[12px] tabular-nums text-slate-500">
                Sida {currentPage} av {pages.length}
              </span>
              <button
                type="button"
                onClick={() => changeZoom(-ZOOM_STEP)}
                disabled={zoom <= MIN_ZOOM}
                aria-label="Zooma ut"
                className={cn(crm.ghostButton, 'w-8 px-0 text-base leading-none')}
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                aria-label="Återställ zoom till sidbredd"
                className={cn(crm.ghostButton, 'px-2 text-[12px] tabular-nums')}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => changeZoom(ZOOM_STEP)}
                disabled={zoom >= MAX_ZOOM}
                aria-label="Zooma in"
                className={cn(crm.ghostButton, 'w-8 px-0 text-base leading-none')}
              >
                +
              </button>
            </>
          )}
          <a
            href={downloadUrl}
            download={fileName}
            className={cn(crm.ghostButton, 'px-3 no-underline')}
          >
            Ladda ner
          </a>
        </div>
      </div>

      {/* Egen scrollyta: tabIndex gör att den går att scrolla med tangentbordet, vilket en
          ren <div> med overflow inte gör. */}
      <div
        ref={scrollRef}
        role="region"
        aria-label={`${label} (PDF)`}
        tabIndex={0}
        className="h-[70vh] max-h-[760px] min-h-[360px] w-full overflow-auto rounded-lg border border-[#e3e9df] bg-[#eef2ea] p-3 outline-none focus-visible:border-emerald-500"
      >
        {status === 'loading' && (
          <div className="grid h-full place-items-center text-[13px] tabular-nums text-slate-500">
            {progress === null ? 'Laddar PDF…' : `Laddar PDF… ${progress} %`}
          </div>
        )}

        {status === 'error' && (
          <div className="grid h-full place-items-center px-4 text-center">
            <div className="grid gap-2">
              <p className="m-0 text-[13px] text-slate-600">PDF:en kunde inte visas här.</p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] font-semibold text-emerald-700 underline hover:text-emerald-800"
              >
                Öppna den i webbläsaren i stället
              </a>
            </div>
          </div>
        )}

        {status === 'ready' && (
          // 🧨 mx-auto BARA när sidorna får plats. Ett centrerat block som är bredare än sin
          // scrollruta får sin vänsterkant avklippt och oåtkomlig — marginalen kan inte bli
          // negativ, så den inzoomade sidans vänstra del hade helt enkelt inte gått att nå.
          <div className={cn('grid w-fit gap-3', zoom <= 1 && 'mx-auto')}>
            {pages.map((page) => (
              <div
                key={page.number}
                data-page={page.number}
                // Rutan har sina mått FÖRE canvasen ritats. Utan dem hade listan varit noll
                // pixlar hög, allt hade skurit vyn samtidigt, och varenda sida ritats direkt.
                style={{ width: pageWidth, height: Math.round(pageWidth * page.ratio) }}
                className="overflow-hidden rounded-md border border-[#dbe3d6] bg-white shadow-[0_1px_3px_rgba(20,44,27,0.08)]"
              >
                <canvas
                  ref={(el) => {
                    if (el) canvasRefs.current.set(page.number, el);
                    else canvasRefs.current.delete(page.number);
                  }}
                  className="block h-full w-full"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

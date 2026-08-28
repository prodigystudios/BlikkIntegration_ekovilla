"use client";

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import Select from '@/components/ui/Select';
import { formatDate } from '@/app/crm/lib/format';
import {
  WORK_ORDER_FILE_CATEGORIES,
  WORK_ORDER_FILE_CATEGORY_ORDER,
  workOrderFileCategoryLabel,
  type WorkOrderFileCategory,
  type WorkOrderFileView,
} from '@/lib/domains/crm/workOrderFiles/types';

// Filfliken. Monteras av BÅDE kontorsvyn (/crm/arbetsorder) och fältvyn (/arbetsorder), därför
// helt presentational: data och callbacks in som props, inga egna fetch-anrop, inga toasts.
//
// Fältvyn (/arbetsorder) ligger UTANFÖR .crm-shell och saknar därför dess variabler. Knappfärgen
// tas ur --ek-green, som bor på :root och gäller app-vitt — den lappen med hårdkodad fallback
// behövs inte längre.

type Props = {
  workOrderId: string;
  files: WorkOrderFileView[];
  loading: boolean;
  currentUserId: string | null;
  canUpload: boolean;
  canMarkInternal: boolean;
  canDeleteAny: boolean;
  uploadProgress: { current: number; total: number } | null;
  onUpload: (files: File[], meta: { category: WorkOrderFileCategory; isInternal: boolean }) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
};

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif';

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function fileExtension(name: string): string {
  return name.split('.').pop()?.toUpperCase().slice(0, 4) || 'FIL';
}

export default function WorkOrderFilesTab({
  workOrderId,
  files,
  loading,
  currentUserId,
  canUpload,
  canMarkInternal,
  canDeleteAny,
  uploadProgress,
  onUpload,
  onDelete,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [category, setCategory] = useState<WorkOrderFileCategory>('drawing');
  const [isInternal, setIsInternal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Id och inte hela raden: listan hämtas om var 25:e minut (de signerade URL:erna går ut), och
  // en kopia av raden hade fortsatt peka på en död URL medan visaren stod öppen.
  const [viewerId, setViewerId] = useState<string | null>(null);
  const viewerFile = files.find((file) => file.id === viewerId) || null;

  const uploading = uploadProgress !== null;

  async function handlePicked(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const ok = await onUpload(Array.from(picked), { category, isInternal });
    // Nollställ alltid inputen, även vid fel: annars går samma fil inte att välja igen.
    if (inputRef.current) inputRef.current.value = '';
    if (ok) {
      setComposerOpen(false);
      setIsInternal(false);
    }
  }

  async function confirmDelete(id: string) {
    setBusyId(id);
    await onDelete(id);
    setBusyId(null);
    setConfirmDeleteId(null);
  }

  // Kategorierna är inte en godtycklig taxonomi utan ett jobbs kronologi: ritningen och
  // förberedelserna finns innan besättningen åker, fotona kommer under och efter. Ordningen är
  // därför fast och inte alfabetisk. Tomma kategorier hoppas över — en rubrik utan innehåll är
  // brus på en telefonskärm.
  const groups = WORK_ORDER_FILE_CATEGORY_ORDER
    .map((key) => ({ key, items: files.filter((file) => file.category === key) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className={cn(crm.cardInner, 'grid gap-4')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={crm.cardTitle}>Filer</p>
        {canUpload ? (
          <button
            type="button"
            onClick={() => setComposerOpen((open) => !open)}
            disabled={uploading}
            className={cn(crm.formButton, 'px-3')}
            style={{ backgroundColor: 'var(--ek-green)' }}
          >
            {uploading
              ? `Laddar upp (${uploadProgress.current}/${uploadProgress.total})…`
              : composerOpen ? 'Avbryt' : 'Ladda upp filer'}
          </button>
        ) : null}
      </div>

      {/* Uppladdningen ligger bakom en knapp och inte som en permanent yta överst: den som öppnar
          fliken i fält gör det för att TITTA på ritningen, och en dropzone hade tryckt ner den
          under skärmkanten på en telefon. */}
      {canUpload && composerOpen ? (
        <div className="grid gap-3 rounded-xl border border-[#cfdcc9] bg-[#f1f5ee] p-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid gap-1">
              <span className={crm.label}>Kategori</span>
              {/* Ingen breddspärr: etiketten är ett griditem i `minmax(0,1fr)`, så kolumnen
                  bestämmer bredden och knappen kan inte krympa efter sitt valda värde. */}
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value as WorkOrderFileCategory)}
                aria-label="Kategori"
                className={crm.selectMenu}
              >
                {WORK_ORDER_FILE_CATEGORIES.map((key) => (
                  <option key={key} value={key}>{workOrderFileCategoryLabel[key]}</option>
                ))}
              </Select>
            </label>

            {canMarkInternal ? (
              <label className="flex items-center gap-2 pb-1 text-[13px] text-slate-600">
                <input
                  type="checkbox"
                  checked={isInternal}
                  onChange={(e) => setIsInternal(e.target.checked)}
                  className="h-4 w-4 shrink-0 accent-[#1a3f26]"
                />
                Intern — visas inte för besättningen
              </label>
            ) : null}
          </div>

          <label
            htmlFor="work-order-file-input"
            className="grid cursor-pointer place-items-center gap-1 rounded-xl border border-dashed border-[#cfdcc9] bg-white px-4 py-6 text-center transition hover:border-[#1a3f26]"
          >
            <span className="text-sm font-semibold text-slate-700">Välj filer</span>
            <span className="text-xs text-slate-500">Bilder och PDF, max 25 MB per fil</span>
          </label>
          <input
            id="work-order-file-input"
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            onChange={(e) => handlePicked(e.target.files)}
            disabled={uploading}
            className="sr-only"
          />
        </div>
      ) : null}

      {loading ? <div className="text-sm text-slate-500">Laddar filer…</div> : null}

      {!loading && files.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#cfdcc9] bg-[#f1f5ee] px-4 py-6 text-sm text-slate-500">
          {canUpload
            ? 'Inga filer än. Ladda upp ritningar och bilder här så har besättningen dem när de öppnar jobbet.'
            : 'Inga filer på den här arbetsordern än.'}
        </div>
      ) : null}

      {!loading && groups.map((group) => (
        <section key={group.key} className="grid gap-2">
          <div className="flex items-baseline gap-2">
            <h3 className={crm.sectionTitle}>{workOrderFileCategoryLabel[group.key]}</h3>
            <span className="text-[11px] font-semibold text-slate-400">{group.items.length}</span>
          </div>

          {/* EN kolumn på telefon. Två kolumner gav ~160 px breda kort där filnamnet kapades mitt
              i ("IMG_4125.jp"), metaraden bröt sig över tre rader och "Ta bort? Ja Nej" klipptes av
              kortkanten. Det är också fel prioritering: den som öppnar fliken i fält vill SE
              ritningen, inte se två frimärken. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.items.map((file) => {
              const canRemove = canDeleteAny || (!!currentUserId && file.created_by === currentUserId);
              const href = `/api/crm/work-orders/${workOrderId}/files/${file.id}?redirect=1`;
              const isImage = !!file.url;

              return (
                <figure
                  key={file.id}
                  className="grid overflow-hidden rounded-xl border border-[#e0e8dc] bg-white"
                >
                  {/* Bilder öppnas i appens egen visare; PDF i webbläsarens. Se kommentaren på
                      FileViewer längst ner i filen för varför de två skiljer sig åt. */}
                  {isImage ? (
                    <button
                      type="button"
                      onClick={() => setViewerId(file.id)}
                      className="block aspect-[4/3] w-full cursor-zoom-in border-none bg-[#f1f5ee] p-0"
                      aria-label={`Visa ${file.file_name}`}
                    >
                      <img src={file.url as string} alt="" className="h-full w-full object-cover" />
                    </button>
                  ) : (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="grid aspect-[4/3] w-full place-items-center bg-[#f1f5ee] no-underline"
                      aria-label={`Öppna ${file.file_name}`}
                    >
                      <span className="text-sm font-bold tracking-wide text-slate-400">
                        {fileExtension(file.file_name)}
                      </span>
                    </a>
                  )}

                  <figcaption className="grid gap-1.5 px-3 py-2.5">
                    {isImage ? (
                      <button
                        type="button"
                        onClick={() => setViewerId(file.id)}
                        className="truncate border-none bg-transparent p-0 text-left text-[13px] font-semibold text-slate-900"
                        title={file.file_name}
                      >
                        {file.file_name}
                      </button>
                    ) : (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-[13px] font-semibold text-slate-900 no-underline hover:underline"
                        title={file.file_name}
                      >
                        {file.file_name}
                      </a>
                    )}

                    <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400">
                      <span className="min-w-0 truncate">{file.created_by_name}</span>
                      <span aria-hidden>·</span>
                      <span className="whitespace-nowrap">{formatDate(file.created_at)}</span>
                      {formatBytes(file.size_bytes) ? (
                        <>
                          <span aria-hidden>·</span>
                          <span className="whitespace-nowrap">{formatBytes(file.size_bytes)}</span>
                        </>
                      ) : null}
                    </div>

                    {file.is_internal ? (
                      <span className={cn(crm.badge, 'justify-self-start border-amber-300 bg-amber-50 text-amber-800')}>
                        Intern
                      </span>
                    ) : null}

                    {/* Egen rad, aldrig i samma flöde som metan — det var den som klipptes.
                        "Ladda ner" ligger här och inte bara i visaren: den som förbereder dagen
                        sitter ofta i bilen och har ingen täckning på plats. En ritning som ligger
                        i telefonen går att öppna ändå. */}
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-x-0 border-b-0 border-t border-[#eef2ec] pt-2 text-xs">
                      <a
                        href={`${href}&download=1`}
                        className="font-medium text-slate-500 no-underline hover:text-slate-800"
                      >
                        Ladda ner
                      </a>

                      {canRemove ? (
                        confirmDeleteId === file.id ? (
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-slate-500">Ta bort?</span>
                            <button
                              type="button"
                              onClick={() => confirmDelete(file.id)}
                              disabled={busyId === file.id}
                              className="border-none bg-transparent p-0 font-semibold text-rose-600 hover:text-rose-700"
                            >
                              {busyId === file.id ? 'Tar bort…' : 'Ja'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="border-none bg-transparent p-0 text-slate-400 hover:text-slate-600"
                            >
                              Nej
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(file.id)}
                            className="border-none bg-transparent p-0 font-medium text-slate-400 hover:text-rose-500"
                          >
                            Ta bort
                          </button>
                        )
                      ) : null}
                    </div>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      ))}

      {viewerFile?.url ? (
        <FileViewer
          fileName={viewerFile.file_name}
          url={viewerFile.url}
          openHref={`/api/crm/work-orders/${workOrderId}/files/${viewerFile.id}?redirect=1`}
          downloadHref={`/api/crm/work-orders/${workOrderId}/files/${viewerFile.id}?redirect=1&download=1`}
          onClose={() => setViewerId(null)}
        />
      ) : null}
    </div>
  );
}

// Bildvisare i appen.
//
// VARFÖR BARA BILDER: att öppna en fil i en ny flik fungerar bra på datorn men illa på telefonen —
// man kastas ur appen till en naken flik utan väg tillbaka annat än fliklistan. För BILDER finns
// ingen anledning till det: vi har redan den signerade URL:en, och en overlay som stänger med ett
// tryck är både snabbare och mindre desorienterande.
//
// PDF öppnas fortfarande i webbläsarens egen visare, med flit. En ritning ska gå att nypzooma och
// bläddra mellan sidor i, och telefonens inbyggda PDF-visare gör det bättre än något vi bygger —
// dessutom renderar iOS Safari en PDF i <iframe> som en enda sida utan scroll, så en inbäddad
// variant hade varit sämre än länken vi har.
//
// "Öppna i ny flik" finns kvar också för bilder: det är vägen till riktig nypzoom när man behöver
// läsa en detalj i en ritning som fotats av.
function FileViewer({
  fileName,
  url,
  openHref,
  downloadHref,
  onClose,
}: {
  fileName: string;
  url: string;
  openHref: string;
  downloadHref: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // Lås bakgrundsscrollen så telefonen inte scrollar ordern bakom bilden.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const actionClass =
    'inline-flex h-9 items-center rounded-lg border border-white/25 bg-white/10 px-3 text-[13px] font-semibold text-white no-underline transition hover:bg-white/20';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={fileName}
      className="fixed inset-0 z-[2800] grid grid-rows-[auto_1fr] bg-slate-950/95"
      // Tryck utanför bilden stänger. Knappraden stoppar sin egen bubbling nedan.
      onClick={onClose}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{fileName}</span>
        <div className="flex shrink-0 items-center gap-2">
          <a href={openHref} target="_blank" rel="noreferrer" className={actionClass}>Öppna</a>
          <a href={downloadHref} className={actionClass}>Ladda ner</a>
          <button type="button" onClick={onClose} className={actionClass} aria-label="Stäng">Stäng</button>
        </div>
      </div>

      <div className="grid min-h-0 place-items-center overflow-auto p-4">
        {/* Klick på själva bilden ska INTE stänga — man zoomar och panorerar i den. */}
        <img
          src={url}
          alt={fileName}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    </div>
  );
}

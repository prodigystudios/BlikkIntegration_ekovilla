import { describe, it, expect } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { buildSafetyRoundDocument } from '@/lib/domains/safetyRounds/document';
import { renderSafetyRoundPdf, safetyRoundFilename } from '@/lib/domains/safetyRounds/pdf';
import type { SafetyRoundBundle } from '@/lib/domains/safetyRounds/types';
import { completeBundle, makeItem, makePhoto } from './helpers/fixtures';

// Skyddsrondens protokoll. Som KMA-planens test frågar det VAR något står (vilken sida, fot eller
// kropp) — en text på fel blad går fortfarande att extrahera.
//
// Förhandsvisning att titta på:
//   SAFETY_PDF_PREVIEW_DIR=/tmp/skyddsrond npx vitest run tests/safetyRounds/safetyRoundPdf.test.ts

const PRINTED_ON = '2026-09-25';
/** Under den här höjden är det foten. */
const FOOTER_TOP = 62;

type TextItem = { str: string; y: number };

async function pagesOf(bytes: Uint8Array): Promise<TextItem[][]> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: TextItem[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(
      content.items
        .map((item) => {
          const it = item as { str?: string; transform?: number[] };
          return { str: (it.str ?? '').trim(), y: it.transform?.[5] ?? 0 };
        })
        .filter((it) => it.str),
    );
  }
  return pages;
}

const bodyText = (page: TextItem[]) => page.filter((it) => it.y > FOOTER_TOP).map((it) => it.str).join(' ');
const footerText = (page: TextItem[]) => page.filter((it) => it.y <= FOOTER_TOP).map((it) => it.str).join(' ');

async function render(bundle: SafetyRoundBundle, name: string, images?: ReadonlyMap<string, Uint8Array>) {
  const doc = buildSafetyRoundDocument(bundle, { printedOn: PRINTED_ON });
  const bytes = await renderSafetyRoundPdf({ ...doc, images });
  const dir = process.env.SAFETY_PDF_PREVIEW_DIR;
  if (dir) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.pdf`), bytes);
  }
  return { doc, pages: await pagesOf(bytes) };
}

describe('skyddsrondens protokoll', () => {
  it('rondinfo och deltagare på första sidan, checklistan och handlingsplanen på egna sidor', async () => {
    const { pages } = await render({ ...completeBundle(), round: { ...completeBundle().round, status: 'completed', completed_at: '2026-09-24T09:00:00Z' } }, 'slutford');
    expect(pages.length).toBeGreaterThanOrEqual(3);

    const first = bodyText(pages[0]);
    expect(first).toContain('Skyddsrond – ute på arbetsplats');
    expect(first).toContain('Vindsbjälklag Hus A–C');
    expect(first).toContain('Rolf Rondledare');
    expect(first).toContain('Sara Skyddsombud');
    expect(first).not.toContain('UTKAST');

    const checklistPage = pages.findIndex((page) => bodyText(page).includes('Checklista'));
    const planPage = pages.findIndex((page) => bodyText(page).includes('Handlingsplan – riskåtgärder'));
    expect(checklistPage).toBeGreaterThan(0);
    expect(planPage).toBeGreaterThan(checklistPage);
    expect(bodyText(pages[planPage])).toContain('Sätt räcke vid taklucka hus 3');
    expect(bodyText(pages[planPage])).toContain('AFS 2023:1 §13');
  });

  it('ett utkast säger att det är ett utkast', async () => {
    const { pages } = await render(completeBundle(), 'utkast');
    expect(bodyText(pages[0])).toContain('UTKAST');
  });

  it('foten bär ordernumret, rondnumret och UTSKRIFTSDAGEN — uppföljningen visas per den dagen', async () => {
    const { pages } = await render(completeBundle(), 'fot');
    for (const page of pages) {
      const foot = footerText(page);
      expect(foot).toContain('6579');
      expect(foot).toContain('Rond 2');
      expect(foot).toContain(`Utskriven ${PRINTED_ON}`);
    }
  });

  it('en egen punkt (utan nummer) kommer med i sin kategori', async () => {
    const bundle = completeBundle();
    bundle.items.push(makeItem({ category_code: 'I', category_label: 'Egna punkter / objektsspecifika risker', number: null, catalog_item_id: null, text: 'Takluckan på hus 3 öppen?' }));
    const { pages } = await render(bundle, 'egen-punkt');
    const all = pages.map(bodyText).join(' ');
    expect(all).toContain('I. Egna punkter / objektsspecifika risker');
    expect(all).toContain('Takluckan på hus 3 öppen?');
  });

  it('en lång checklista bryter över sidor utan att tappa en punkt', async () => {
    const bundle = completeBundle();
    for (let n = 100; n < 160; n++) bundle.items.push(makeItem({ number: n, text: `Punkt nummer ${n} med en fråga som är lagom lång?` }));
    const { pages } = await render(bundle, 'lang');
    const all = pages.map(bodyText).join(' ');
    for (let n = 100; n < 160; n++) expect(all).toContain(`Punkt nummer ${n}`);
  });
});

describe('metadatans titel', () => {
  it('utan ordernummer blir det inget dubbelt mellanslag', () => {
    const bundle = completeBundle();
    bundle.round = { ...bundle.round, order_number: null, fortnox_order_number: null };
    expect(buildSafetyRoundDocument(bundle, { printedOn: PRINTED_ON }).title).toBe('Skyddsrond – Vindsbjälklag Hus A–C');
    expect(buildSafetyRoundDocument(completeBundle(), { printedOn: PRINTED_ON }).title).toBe('Skyddsrond 6579 – Vindsbjälklag Hus A–C');
  });

  it('en OK-punkt med inaktuella brist-val skrivs ut som OK — utan risk och handlingsplan', async () => {
    const bundle = completeBundle();
    bundle.items.push(makeItem({ number: 77, text: 'Stale punkt?', status: 'ok', risk: 'severe', to_action_plan: 'yes', description: 'Inaktuell text' }));
    const { pages } = await render(bundle, 'inaktuell');
    const all = pages.map(bodyText).join(' ');
    expect(all).not.toContain('Inaktuell text');
    // Raden: OK och "–", ingen risknivå och inget "Ja" efter den.
    expect(all).toMatch(/77 Stale punkt\? OK – (B\.|$)/);
    // Summeringen räknar bara den riktiga bristen (Hög), inte den inaktuella (Allvarlig).
    expect(all).toContain('Hög + Allvarlig 1');
    expect(all).toContain('Till handlingsplan 1');
  });
});

describe('safetyRoundFilename', () => {
  it('ASCII, ordernummer och rondnummer', () => {
    expect(safetyRoundFilename(completeBundle().round)).toBe('Skyddsrond 6579 rond2 - Vindsbjalklag Hus AC.pdf');
  });

  it('utan Fortnox-nummer används det interna', () => {
    expect(safetyRoundFilename({ ...completeBundle().round, fortnox_order_number: null })).toBe(
      'Skyddsrond AO-20260924-AB12CD rond2 - Vindsbjalklag Hus AC.pdf',
    );
  });
});

describe('foton i protokollet', () => {
  // En riktig JPEG (Isoleringslandslagets logga) får spela foto.
  const jpeg = () => readFile(join(process.cwd(), 'public/brand/Isoleringslandslaget_logo.jpg')).then((b) => new Uint8Array(b));

  function withPhotos() {
    const bundle = completeBundle();
    const defect = bundle.items[2];
    bundle.photos = [
      makePhoto({ item_id: defect.id, photo_no: 1 }),
      makePhoto({ item_id: defect.id, photo_no: 2 }),
      makePhoto({ item_id: bundle.items[0].id, photo_no: 3 }),
    ];
    return bundle;
  }

  it('en fotobilaga sist, med nummer och punkt — och ett foto som saknas sägs rakt ut', async () => {
    const bundle = withPhotos();
    const bytes = await jpeg();
    const images = new Map([
      [bundle.photos[0].id, bytes],
      [bundle.photos[1].id, bytes],
      // Foto 3 kunde inte hämtas.
    ]);
    const { pages } = await render(bundle, 'foton', images);
    const last = bodyText(pages[pages.length - 1]);
    expect(last).toContain('Foton');
    expect(last).toContain('Foto 1 – Punkt 4:');
    expect(last).toContain('Foto 2 – Punkt 4:');
    expect(last).toContain('Fotot kunde inte hämtas.');
  });

  it('checklistan och handlingsplanen hänvisar till fotonumren, som i mallen', async () => {
    const { pages } = await render(withPhotos(), 'foto-hanvisningar');
    const all = pages.map(bodyText).join(' ');
    // Bristen (punkt 4): i checklistan och på åtgärden. OK-punkten: bara i checklistan.
    expect(all.match(/Foto 1, 2/g)?.length).toBe(2);
    expect(all).toContain('Foto 3');
  });

  it('ryms inte alla i budgeten listas resten, och bara de som ryms hämtas', () => {
    const bundle = withPhotos();
    bundle.photos = bundle.photos.map((p, i) => ({ ...p, print_size_bytes: i === 0 ? 1_000_000 : 3_000_000 }));
    const doc = buildSafetyRoundDocument(bundle, { printedOn: PRINTED_ON });
    expect(doc.photoDownloads).toEqual([{ ref: bundle.photos[0].id, path: bundle.photos[0].print_path }]);
    const texts = doc.sections.flatMap((section) => section.blocks).filter((b) => b.t === 'p').map((b) => (b as { text: string }).text);
    expect(texts).toContain('Foto 2, 3 ryms inte i PDF:en. De finns i ronden i appen.');
  });

  it('utan foton: ingen bilaga och inget att hämta', () => {
    const doc = buildSafetyRoundDocument(completeBundle(), { printedOn: PRINTED_ON });
    expect(doc.photoDownloads).toEqual([]);
    expect(doc.sections.map((section) => section.key)).toEqual(['info', 'checklist', 'plan']);
  });
});

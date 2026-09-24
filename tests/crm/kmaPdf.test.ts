import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';

import { buildKmaDocument, type KmaDocumentContext } from '@/lib/domains/crm/kmaPlans/document';
import { renderKmaPdf } from '@/lib/domains/crm/kmaPlans/pdf';
import type { KmaDocument, KmaFormValues } from '@/lib/domains/crm/kmaPlans/types';

import { kmaForm } from './helpers/kmaFixtures';

// KMA-planens PDF. Det som prövas är SIDORNA, inte bara texten: en text som hamnat på fel blad går
// fortfarande att extrahera, så ett test som bara letar efter strängen är grönt medan utskriften är
// oläslig (löneunderlagets läxa). Varje test här frågar därför VAR något står.
//
// Förhandsvisning att titta på:
//   KMA_PDF_PREVIEW_DIR=/tmp/kma npx vitest run tests/crm/kmaPdf.test.ts

const CTX: KmaDocumentContext = { revision: 1, issuedOn: '2026-09-24', firstIssuedOn: '2026-09-24' };

/** Under den här höjden är det foten (bolagsraden, löptexten, sidnumret). */
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

const body = (page: TextItem[]) => page.filter((it) => it.y > FOOTER_TOP);
const footer = (page: TextItem[]) => page.filter((it) => it.y <= FOOTER_TOP);
const texts = (items: TextItem[]) => items.map((it) => it.str);

function headingsOf(doc: KmaDocument): Set<string> {
  const set = new Set<string>();
  for (const section of doc.sections) {
    for (const block of section.blocks) if (block.t === 'h1' || block.t === 'h2' || block.t === 'h3') set.add(block.text);
  }
  return set;
}

async function render(form: KmaFormValues, ctx: KmaDocumentContext = CTX) {
  const doc = buildKmaDocument(form, ctx);
  const bytes = await renderKmaPdf(doc);
  return { doc, bytes, pages: await pagesOf(bytes) };
}

describe('renderKmaPdf', () => {
  it('huvuddokumentet och varje bilaga — varje bilaga börjar överst på en egen sida', async () => {
    const { pages } = await render(kmaForm());
    const starts = pages.map((page) => texts(body(page))[0]);
    for (let no = 1; no <= 8; no++) {
      expect(starts.some((first) => first?.startsWith(`Bilaga ${no} –`)), `bilaga ${no}`).toBe(true);
    }
    expect(starts[0]).toBe('KMA-PLAN');
  });

  it('bilaga 8:s namnteckningsrad står på SISTA sidan', async () => {
    const { pages } = await render(kmaForm());
    const last = texts(body(pages[pages.length - 1]));
    expect(last).toContain('Namnteckning av behörig undertecknare:');
    expect(last[0]).toBe('Bilaga 8 – Signaturlista');
  });

  it('varje sida har bolagsraden och "Sida X (Y)" med rätt totalsumma', async () => {
    const { pages } = await render(kmaForm());
    pages.forEach((page, index) => {
      const foot = texts(footer(page));
      expect(foot).toContain('Ekovilla AB / Isoleringslandslaget AB - 020-44 66 40 - Info@ekovilla.se');
      expect(foot).toContain(`Sida ${index + 1} (${pages.length})`);
      expect(foot).toContain('KMA-plan · 6579 · Revision 1');
    });
  });

  it('en lång kontaktlista upprepar tabellhuvudet på nästa sida', async () => {
    const form = kmaForm({
      contacts: Array.from({ length: 45 }, (_, i) => ({ name: `Kontakt ${String(i + 1).padStart(2, '0')}`, role: 'Installatör', phone: '' })),
    });
    const { pages } = await render(form);
    // Sidan där listan fortsätter: första brödtexten är tabellhuvudet, inte en rad ur listan.
    const continued = pages.findIndex((page, i) => i > 0 && texts(body(page)).includes('Kontakt 45') && !texts(body(page)).includes('Kontakt 01'));
    expect(continued).toBeGreaterThan(0);
    expect(texts(body(pages[continued])).slice(0, 3)).toEqual(['Namn', 'Roll', 'Telefon']);
  });

  it('ingen rubrik står ensam sist på en sida — svept över risker och kontakter', async () => {
    let sawHeadingPushedToNextPage = false;
    for (let risks = 0; risks <= 10; risks += 2) {
      for (let contacts = 0; contacts <= 24; contacts += 3) {
        const form = kmaForm({
          extraRisks: Array.from({ length: risks }, (_, i) => ({ risk: `Extra risk ${i + 1}`, action: `Åtgärd för risk ${i + 1} på plats` })),
          contacts: Array.from({ length: contacts }, (_, i) => ({ name: `Person ${i + 1}`, role: 'Installatör', phone: '070-000 00 00' })),
        });
        const { doc, pages } = await render(form);
        const headings = headingsOf(doc);
        for (const [index, page] of pages.entries()) {
          // Ingen brödtext ned i fotens zon: en rad som ritats utan platsprövning hamnar där.
          for (const item of body(page)) expect(item.y, `"${item.str}" under brödtextens nederkant`).toBeGreaterThanOrEqual(80);
          const items = texts(body(page));
          expect(headings.has(items[items.length - 1]), `sida ${index + 1} slutar med en rubrik (${risks} risker, ${contacts} kontakter)`).toBe(false);
          // Brytfallet måste ha inträffat i svepet, annars prövar testet ingenting: en rubrik
          // (inte en bilagerubrik, som alltid står överst) som hamnat först på en sida.
          if (index > 0 && headings.has(items[0]) && !items[0].startsWith('Bilaga ')) sawHeadingPushedToNextPage = true;
        }
      }
    }
    expect(sawHeadingPushedToNextPage).toBe(true);
  }, 60_000); // 54 renderingar — svepet ÄR testet, så det får ta sin tid.

  it('tabellhuvudet följer bara med medan tabellen flödar — inte över text som kommer efter den', async () => {
    // En kort tabell och sedan ett långt stycke som bryts till nästa sida. Nollställs inte
    // fortsättningshuvudet när tabellen är slut ritas "Kolumn A · Kolumn B" överst på sidan, över
    // brödtext den inte beskriver.
    const filler = Array.from({ length: 220 }, (_, i) => `Mening ${i + 1} i ett långt stycke som fyller sidan.`).join(' ');
    const doc: KmaDocument = {
      ...buildKmaDocument(kmaForm(), CTX),
      sections: [
        {
          key: 'test',
          newPage: false,
          blocks: [
            {
              t: 'table',
              columns: [
                { head: 'Kolumn A', width: 1 },
                { head: 'Kolumn B', width: 1 },
              ],
              rows: [['a1', 'b1']],
            },
            { t: 'p', text: filler },
          ],
        },
      ],
    };
    const pages = await pagesOf(await renderKmaPdf(doc));
    expect(pages.length).toBeGreaterThan(1);
    expect(texts(body(pages[1]))[0]).toMatch(/^Mening|stycke|sidan/);
    expect(texts(body(pages[1]))).not.toContain('Kolumn A');
  });

  it('samma dokument ger samma text på samma sidor — en omladdning är samma plan', async () => {
    const doc = buildKmaDocument(kmaForm(), CTX);
    const first = await pagesOf(await renderKmaPdf(doc));
    const second = await pagesOf(await renderKmaPdf(JSON.parse(JSON.stringify(doc)) as KmaDocument));
    expect(second.map((p) => texts(p))).toEqual(first.map((p) => texts(p)));
  });

  it('metadatadatumen är planens utgivningsdatum, inte dagens', async () => {
    const { bytes } = await render(kmaForm(), { revision: 2, issuedOn: '2020-02-03', firstIssuedOn: '2020-01-15' });
    const loaded = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(loaded.getCreationDate()?.toISOString()).toBe('2020-02-03T00:00:00.000Z');
    expect(loaded.getModificationDate()?.toISOString()).toBe('2020-02-03T00:00:00.000Z');
    expect(loaded.getTitle()).toBe('KMA-plan 6579 – Vindsbjälklag Hus A–C');
  });

  it('ritar utan loggor hellre än att fallera', async () => {
    const doc = buildKmaDocument(kmaForm(), CTX);
    const bytes = await renderKmaPdf(doc, { ekovillaLogo: null, partnerLogo: null });
    expect((await pagesOf(bytes)).length).toBeGreaterThanOrEqual(9);
  });

  it('en okänd layout kastar i stället för att ritas fel', async () => {
    const doc = { ...buildKmaDocument(kmaForm(), CTX), layout: 2 } as unknown as KmaDocument;
    await expect(renderKmaPdf(doc)).rejects.toThrow(/stöds inte/);
  });
});

it('skriver förhandsvisningar när KMA_PDF_PREVIEW_DIR är satt', async () => {
  const dir = process.env.KMA_PDF_PREVIEW_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });

  const knauf = kmaForm();
  knauf.project.materials = ['KNAUF SUPAFIL'];
  const big = kmaForm({
    extraRisks: [{ risk: 'Asbest i befintlig isolering', action: 'Provtagning före start, sanering av behörig entreprenör' }],
    contacts: Array.from({ length: 14 }, (_, i) => ({ name: `Installatör ${i + 1}`, role: 'Installatör', phone: '070-000 00 00' })),
  });

  const files: Array<[string, Uint8Array]> = [
    ['kma-ekovilla.pdf', (await render(kmaForm())).bytes],
    ['kma-knauf.pdf', (await render(knauf)).bytes],
    ['kma-stor-rev3.pdf', (await render(big, { revision: 3, issuedOn: '2026-10-02', firstIssuedOn: '2026-09-24' })).bytes],
  ];
  for (const [name, bytes] of files) await writeFile(join(dir, name), bytes);
});

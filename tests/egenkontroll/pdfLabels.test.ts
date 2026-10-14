import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { POST } from '@/app/api/pdf/generate/route';
import {
  EGENKONTROLL_CHECKS,
  EGENKONTROLL_CLOSED_STAGE_COLUMNS,
  EGENKONTROLL_COMMENT_FIELD,
  EGENKONTROLL_MATERIAL_FIELD,
  EGENKONTROLL_OPEN_STAGE_COLUMNS,
  EGENKONTROLL_PROJECT_FIELDS,
  EGENKONTROLL_SECTIONS,
  EGENKONTROLL_SIGNATURE_FIELDS,
} from '@/lib/domains/egenkontroll/template';

// Egenkontrollens PDF skriver blankettens etiketter ur lib/domains/egenkontroll/template.ts — samma
// källa som KMA-planens bilaga 6 visar tom. Testet vaktar bindningen: en etikett som skrivs in i
// routen igen, i stället för att läsas ur mallen, hade låtit bilagan och egenkontrollen glida isär
// tyst — precis så som den gamla bilagan gjorde.

const ok = { ok: true, comment: '' };

/** Varje kontroll ifylld och en rad i varje etapptabell — annars ritar PDF:en inte etiketterna. */
const FILLED = {
  orderId: '6579',
  clientName: 'Testfastigheter AB',
  checks: Object.fromEntries(EGENKONTROLL_CHECKS.map((check) => [check.key, ok])),
  etapperOpen: [{ etapp: 'Vind', ytaM2: '120' }],
  etapperClosed: [{ etapp: 'Vägg', ytaM2: '40' }],
};

async function pdfText(body: unknown): Promise<string[]> {
  const res = await POST(new NextRequest('https://app.ekovilla.se/api/pdf/generate', { method: 'POST', body: JSON.stringify(body) }));
  expect(res.status).toBe(200);
  const doc = await getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
  const items: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    items.push(...content.items.map((item) => (item as { str?: string }).str ?? ''));
  }
  return items;
}

const squash = (text: string) => text.replace(/\s+/g, '');

describe('egenkontrollens PDF — etiketterna ur mallen', () => {
  it('kortens rubriker, fälten och kontrollerna', async () => {
    const items = await pdfText(FILLED);
    for (const title of Object.values(EGENKONTROLL_SECTIONS)) expect(items, title).toContain(title);
    // Fältens etiketter ritas med versaler.
    const labels = [
      ...Object.values(EGENKONTROLL_PROJECT_FIELDS),
      EGENKONTROLL_MATERIAL_FIELD,
      EGENKONTROLL_COMMENT_FIELD,
      ...Object.values(EGENKONTROLL_SIGNATURE_FIELDS),
      ...EGENKONTROLL_CHECKS.map((check) => check.label),
    ];
    for (const label of labels) expect(items, label).toContain(label.toUpperCase());
  });

  it('etapptabellernas kolumnrubriker, i mallens ordning', async () => {
    // En smal kolumn bryter sin rubrik över flera rader ("Sättningspr / ocent / %"), så texten
    // jämförs utan blanksteg — rubrikerna ritas kolumn för kolumn, i ordning.
    const text = squash((await pdfText(FILLED)).join(''));
    for (const columns of [EGENKONTROLL_OPEN_STAGE_COLUMNS, EGENKONTROLL_CLOSED_STAGE_COLUMNS]) {
      expect(text).toContain(squash(columns.map((column) => column.label).join('')));
    }
  });
});

import { describe, it, expect, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import {
  assembleOfferDocument,
  offerAttachments,
  OfferAttachmentError,
  resolveTermsKind,
  type OfferAttachment,
} from '@/lib/domains/fortnox/offerPdfAssembly';

const A4: [number, number] = [595, 842];

/** En PDF med `count` sidor, valfritt i ett annat pappersformat. */
async function makePdf(count: number, size: [number, number] = A4): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage(size);
  return doc.save();
}

const attachment = (file: string, position: 'before' | 'after', required: boolean): OfferAttachment =>
  ({ file, position, required });

describe('resolveTermsKind', () => {
  it('följer det uttryckliga valet', () => {
    expect(resolveTermsKind({ quote_type: 'private' })).toBe('private');
    expect(resolveTermsKind({ quote_type: 'business' })).toBe('business');
  });

  it('räknar ROT som privat — ROT finns inte för företag', () => {
    expect(resolveTermsKind({ quote_type: 'business', rot_details: { enabled: true } })).toBe('private');
  });

  it('räknar personnummer i ögonblicksbilden som privat', () => {
    // quote_type har `default 'business'`, så en offert där typen aldrig sattes ser ut som företag.
    // Personnumret sätts bara för privatkund och avslöjar då att det inte stämmer.
    expect(resolveTermsKind({ quote_type: 'business', customer_snapshot: { personal_number: '19740312-4519' } }))
      .toBe('private');
  });

  it('låter ett tomt personnummer vara just tomt', () => {
    expect(resolveTermsKind({ quote_type: 'business', customer_snapshot: { personal_number: '  ' } }))
      .toBe('business');
  });

  it('ger företag när ingenting pekar mot privat', () => {
    expect(resolveTermsKind({})).toBe('business');
  });
});

describe('offerAttachments', () => {
  it('väljer villkoren efter kundtyp', () => {
    expect(offerAttachments('private').map((a) => a.file)).toContain('allmanna-villkor-privat-2026.pdf');
    expect(offerAttachments('business').map((a) => a.file)).toContain('allmanna-villkor-foretag-2026.pdf');
  });

  it('gör BARA villkoren obligatoriska — en saknad broschyrsida får inte stoppa en offert', () => {
    const required = offerAttachments('private').filter((a) => a.required).map((a) => a.file);
    expect(required).toEqual(['allmanna-villkor-privat-2026.pdf']);
  });

  it('lägger försättsbladet före och resten efter, i ordning', () => {
    const all = offerAttachments('private');
    expect(all[0].position).toBe('before');
    expect(all.slice(1).every((a) => a.position === 'after')).toBe(true);
    // Informationsbladen 2–5 ska följa varandra, och villkoren ligga sist av allt.
    expect(all.map((a) => a.file.replace(/^13949-Ekovilla-Offer-Templates-|\.pdf$/g, ''))).toEqual([
      '1', '2', '3', '4', '5', 'allmanna-villkor-privat-2026',
    ]);
  });
});

describe('assembleOfferDocument', () => {
  it('lägger försättsbladet först och bilagorna sist', async () => {
    const read = vi.fn(async (file: string) => (file === 'forsatt.pdf' ? makePdf(1) : makePdf(2)));
    const merged = await assembleOfferDocument(
      await makePdf(1),
      [attachment('forsatt.pdf', 'before', false), attachment('villkor.pdf', 'after', true)],
      read,
    );
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(4);
  });

  it('behåller ordningen mellan FLERA försättssidor', async () => {
    // Varje ny sida ska in EFTER den föregående insatta, inte före den.
    const read = vi.fn(async (file: string) => makePdf(file === 'ett.pdf' ? 1 : 1));
    const merged = await assembleOfferDocument(
      await makePdf(1),
      [attachment('ett.pdf', 'before', false), attachment('tva.pdf', 'before', false)],
      read,
    );
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(3);
    // Offertsidan ska ligga sist av de tre.
    expect(read.mock.calls.map(([f]) => f)).toEqual(['ett.pdf', 'tva.pdf']);
  });

  it('KASTAR när avtalsvillkoren saknas — en offert utan villkor ser komplett ut men är det inte', async () => {
    const read = vi.fn(async () => {
      throw new Error('ENOENT');
    });
    await expect(
      assembleOfferDocument(await makePdf(1), [attachment('villkor.pdf', 'after', true)], read),
    ).rejects.toBeInstanceOf(OfferAttachmentError);
  });

  it('hoppar över en saknad broschyrsida och skickar offerten ändå', async () => {
    const read = vi.fn(async () => {
      throw new Error('ENOENT');
    });
    const merged = await assembleOfferDocument(await makePdf(2), [attachment('forsatt.pdf', 'before', false)], read);
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(2);
  });

  it('vägrar en bilaga som inte är A4 — den kommer annars ut i fel storlek mitt i dokumentet', async () => {
    const letter = await makePdf(1, [612, 792]);
    const read = vi.fn(async () => letter);
    await expect(
      assembleOfferDocument(await makePdf(1), [attachment('villkor.pdf', 'after', true)], read),
    ).rejects.toThrow(/inte A4/);
  });

  it('hoppar över en broschyrsida i fel format i stället för att stoppa offerten', async () => {
    const read = vi.fn(async () => makePdf(1, [420, 595]));
    const merged = await assembleOfferDocument(await makePdf(1), [attachment('forsatt.pdf', 'before', false)], read);
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(1);
  });

  it('lämnar dokumentet orört utan bilagor', async () => {
    const merged = await assembleOfferDocument(await makePdf(3), []);
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(3);
  });
});

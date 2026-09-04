// Fogar ihop det färdiga offertdokumentet: försättsblad → vår genererade offert → informationsblad
// → allmänna villkor.
//
// VARFÖR FÄRDIGA PDF:ER OCH INTE GENERERADE SIDOR. Bilagorna bär bilder och grafik, och pdf-lib kan
// inte rendera SVG — varje illustration hade blivit en PNG placerad för hand med koordinater, och
// varje justering i formen en kodändring. Sidorna designas därför i Figma och fogas in som de är.
// Mätt 2026-09-04: infogningen kostar ingenting i filstorlek (offert 64 kB + bilaga 147 kB blev
// 203 kB, alltså 9 kB MINDRE än delarna, eftersom pdf-lib slår ihop gemensam struktur).
//
// INGEN TEXT TRYCKS PÅ BILAGORNA. De är statiska (William 2026-09-04). Det går — pdf-lib kan rita
// ovanpå en inkopierad sida — men så länge inget varierar ska inget ritas.
//
// SIDNUMREN RÖRS INTE. Vår "Sida 1 av 2" räknar bara de sidor vi själva genererar, och det är
// avsiktligt: numret finns för att läsaren ska se om PRISLISTAN är komplett. Bilagorna kan ändå
// inte numreras, eftersom vi inte skriver på dem.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { OfferAttachmentError } from './offerPdfErrors';

const DOCUMENT_DIR = path.join(process.cwd(), 'public', 'documents', 'templates');

/** A4 i punkter. En bilaga i annat format kommer ut i fel storlek mitt i dokumentet. */
const A4_W = 595;
const A4_H = 842;
const SIZE_TOLERANCE = 2;

export type TermsKind = 'private' | 'business';

export type OfferAttachment = {
  /** Filnamn i public/documents/templates/. */
  file: string;
  /** Före eller efter offertens egna sidor. */
  position: 'before' | 'after';
  /**
   * `true` = dokumentet får INTE gå ut utan den. Gäller avtalsvillkoren: en offert som saknar dem
   * ser komplett ut men är det inte, och felet upptäcks först när någon ska åberopa ett villkor.
   * `false` = utsmyckning; saknas den skickas offerten ändå.
   */
  required: boolean;
};

/**
 * Privat eller företag — avgör VILKA allmänna villkor som bifogas.
 *
 * ⚠️ **`crm_quotes.quote_type` har `default 'business'`.** En offert där typen aldrig sattes blir
 * alltså företag utan att någon valt det, och då hade en konsument fått företagsvillkor. Det är den
 * sämre riktningen att fela åt: konsumenträtten gäller ändå, men dokumentet säger emot den.
 *
 * Därför prövas tre signaler och vilken som helst räcker för privat:
 *   • `quote_type === 'private'` — det uttryckliga valet.
 *   • ROT påslaget — ROT finns bara för privatperson, och företag + ROT avvisas redan av
 *     offertvalideringen (`app/api/crm/quotes/_lib.ts`).
 *   • personnummer i kundögonblicksbilden — sätts bara för privatkund (`buildCustomerSnapshot`).
 */
export function resolveTermsKind(quote: {
  quote_type?: string | null;
  rot_details?: { enabled?: boolean | null } | null;
  customer_snapshot?: { personal_number?: string | null } | null;
}): TermsKind {
  if (quote.quote_type === 'private') return 'private';
  if (quote.rot_details?.enabled === true) return 'private';
  if ((quote.customer_snapshot?.personal_number ?? '').trim()) return 'private';
  return 'business';
}

/**
 * Bilagorna i den ordning de ska ligga. Filerna bor i repot, så en ändrad broschyrsida kräver en
 * deploy — men den syns då också i granskningen, vilket ett dokument som går till kund bör göra.
 */
export function offerAttachments(kind: TermsKind): OfferAttachment[] {
  return [
    { file: '13949-Ekovilla-Offer-Templates-1.pdf', position: 'before', required: false },
    { file: '13949-Ekovilla-Offer-Templates-2.pdf', position: 'after', required: false },
    { file: '13949-Ekovilla-Offer-Templates-3.pdf', position: 'after', required: false },
    { file: '13949-Ekovilla-Offer-Templates-4.pdf', position: 'after', required: false },
    { file: '13949-Ekovilla-Offer-Templates-5.pdf', position: 'after', required: false },
    {
      file: kind === 'private' ? 'allmanna-villkor-privat-2026.pdf' : 'allmanna-villkor-foretag-2026.pdf',
      position: 'after',
      required: true,
    },
  ];
}

// Felklassen bor i en modul utan pdf-lib, så routen kan känna igen felet utan att dra in
// PDF-motorn på sin kallstart. Re-exporteras här för anropare som ändå har renderaren laddad.
export { OfferAttachmentError } from './offerPdfErrors';

/** Läser en bilaga. Bruten ut så testerna slipper filsystemet. */
export type AttachmentReader = (file: string) => Promise<Uint8Array>;

const readFromDisk: AttachmentReader = async (file) => new Uint8Array(await readFile(path.join(DOCUMENT_DIR, file)));

/**
 * Fogar in bilagorna runt den renderade offerten.
 *
 * En bilaga som inte går att använda — filen saknas, är trasig eller är i fel pappersformat —
 * behandlas likadant oavsett orsak: `required` avgör om det stoppar dokumentet eller hoppas över.
 * Att skilja på "saknas" och "fel storlek" hade gett två felvägar för samma sak.
 */
export async function assembleOfferDocument(
  offerBytes: Uint8Array,
  attachments: OfferAttachment[],
  read: AttachmentReader = readFromDisk,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(offerBytes);
  let inserted = 0;

  for (const attachment of attachments) {
    let pages;
    try {
      const source = await PDFDocument.load(await read(attachment.file));
      const wrong = source.getPages().find((page) => {
        const { width, height } = page.getSize();
        return Math.abs(width - A4_W) > SIZE_TOLERANCE || Math.abs(height - A4_H) > SIZE_TOLERANCE;
      });
      if (wrong) {
        const { width, height } = wrong.getSize();
        throw new Error(`sidan är ${width.toFixed(0)}×${height.toFixed(0)} pt, inte A4`);
      }
      pages = await doc.copyPages(source, source.getPageIndices());
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (attachment.required) {
        throw new OfferAttachmentError(`Kunde inte foga in ${attachment.file}: ${why}`);
      }
      console.warn(`[offert-pdf] hoppar över bilagan ${attachment.file}: ${why}`);
      continue;
    }

    if (attachment.position === 'before') {
      // Sidorna sätts in i ordning FÖRE offerten. `inserted` håller räkningen, annars hamnar en
      // andra försättssida före den första.
      for (const page of pages) doc.insertPage(inserted++, page);
    } else {
      for (const page of pages) doc.addPage(page);
    }
  }

  return doc.save();
}

import type { PDFFont } from 'pdf-lib';

// Textstädning och radbrytning för pdf-lib-renderarna.
//
// Bodde i lib/domains/fortnox/documentPdfDesign.ts till 2026-09-21 och flyttades hit när
// löneunderlaget (lib/domains/time/payrollPdf.ts) behövde samma brytning för anteckningskolumnen.
// documentPdfDesign.ts re-exporterar båda, så dess anropare och tester är oförändrade.
//
// Open Sans är inbäddad i båda dokumenten, så WinAnsi-spärren gäller inte här: tankstreck,
// typografiska citattecken och det RIKTIGA minustecknet i "−3 937,00" renderas som de är. Kvar
// behövs bara att styrtecken och udda blanksteg städas bort innan de når pdf-lib.

export function cleanText(input: unknown): string {
  return String(input ?? '')
    .replace(/\r\n?/g, '\n')
    // Tabb och blanksteg som inte bryter rad (NBSP, siffermellanslag) blir vanliga mellanslag.
    .replace(/[\t   ]/g, ' ')
    // Styrtecken bort. Radbrytningen (\u000a) undantas — den bär mening i wrapLines.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .trimEnd();
}

/** Bryter text till rader som ryms inom `maxWidth`. Bevarar avsiktliga radbrytningar. */
export function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of cleanText(text).split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      for (const piece of splitLongWord(word, font, size, maxWidth)) {
        const candidate = current ? `${current} ${piece}` : piece;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          current = candidate;
        } else {
          if (current) lines.push(current);
          current = piece;
        }
      }
    }
    lines.push(current);
  }
  const filled = lines.filter((line) => line !== '');
  return filled.length > 0 ? filled : [''];
}

/**
 * Delar ett ord som ensamt är bredare än kolumnen.
 *
 * Utan den här skjuts ett långt obrutet ord ut som egen rad och SPILLER över kolumnkanten — en lång
 * artikelbenämning utan mellanslag skulle skrivas rakt över antals- och prissiffrorna. Radbrytning
 * mellan ord räcker inte när ordet i sig inte får plats.
 */
function splitLongWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];

  const pieces: string[] = [];
  let piece = '';
  for (const char of word) {
    if (piece && font.widthOfTextAtSize(piece + char, size) > maxWidth) {
      pieces.push(piece);
      piece = char;
    } else {
      piece += char;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

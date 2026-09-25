import { compressImageToBlob, compressImageUnderCap } from '@/lib/shared/imageCompression';
import { PHOTO_MAX_BYTES, PRINT_PHOTO_MAX_BYTES } from '@/lib/domains/safetyRounds/photoRules';

// Fotots två varianter, gjorda i telefonen före uppladdningen. Båda blir JPEG — det löser tre saker
// på en gång: en iPhone-HEIC blir läsbar i alla webbläsare, bilden går att bädda in i PDF:en, och
// bucketen godtar bara JPEG.
//
//   * Den FULLA (högst 1600 px, under 0,7 MB) är den man tittar på i appen.
//   * Den LILLA (900 px) bäddas in i protokollet. PDF-svaret får inte passera Vercels 4,5 MB, och
//     med den lilla varianten ryms alla trettio fotona en rond kan ha.

const FULL_TARGET_BYTES = 700_000;

export class UnreadablePhotoError extends Error {}

export async function preparePhotoVariants(file: File): Promise<{ full: Blob; print: Blob }> {
  try {
    const full = await compressImageUnderCap(file, FULL_TARGET_BYTES);
    let print = await compressImageToBlob(file, 900, 0.6);
    if (print.size > PRINT_PHOTO_MAX_BYTES) print = await compressImageToBlob(file, 640, 0.55);
    if (full.size > PHOTO_MAX_BYTES || print.size > PRINT_PHOTO_MAX_BYTES) {
      throw new UnreadablePhotoError('Bilden gick inte att göra tillräckligt liten. Ta ett nytt foto.');
    }
    return { full, print };
  } catch (e) {
    if (e instanceof UnreadablePhotoError) throw e;
    // Webbläsaren kunde inte avkoda bilden (t.ex. HEIC i Chrome på en dator). Originalet laddas INTE
    // upp i stället — det hade inte gått att visa eller skriva ut.
    throw new UnreadablePhotoError('Bilden gick inte att läsa. Ta ett nytt foto, eller välj en JPG- eller PNG-bild.');
  }
}

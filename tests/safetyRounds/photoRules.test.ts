import { describe, it, expect } from 'vitest';
import {
  PDF_PHOTO_BUDGET_BYTES,
  PHOTO_MAX_BYTES,
  PRINT_PHOTO_MAX_BYTES,
  buildPhotoPaths,
  formatPhotoRefs,
  nextPhotoNo,
  parsePhotoPath,
  photoNumbersByItem,
  selectPhotosForPdf,
  validatePhotoObject,
} from '@/lib/domains/safetyRounds/photoRules';
import { makePhoto } from './helpers/fixtures';

// Fotonas regler. Sökvägskontrollen är den säkerhetsbärande: allt en klient skickar tillbaka är ett
// påstående, och en sökväg går att läsa ut ur en signerad URL.

const ROUND = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const UID = '44444444-4444-4444-8444-444444444444';

describe('buildPhotoPaths / parsePhotoPath', () => {
  it('den fulla och den lilla varianten delar rond, uppladdare och uuid', () => {
    expect(buildPhotoPaths(ROUND, ME, UID)).toEqual({
      full: `${ROUND}/${ME}/${UID}.jpg`,
      print: `${ROUND}/${ME}/${UID}.print.jpg`,
    });
  });

  it('en egen full sökväg i ronden godtas, och den lilla härleds — aldrig ur kroppen', () => {
    expect(parsePhotoPath(`${ROUND}/${ME}/${UID}.jpg`, ROUND, ME)).toEqual(buildPhotoPaths(ROUND, ME, UID));
  });

  it('nekar någon annans foto, en annan rond, den lilla varianten och påhittade sökvägar', () => {
    expect(parsePhotoPath(`${ROUND}/${OTHER}/${UID}.jpg`, ROUND, ME)).toBeNull();
    expect(parsePhotoPath(`${OTHER}/${ME}/${UID}.jpg`, ROUND, ME)).toBeNull();
    expect(parsePhotoPath(`${ROUND}/${ME}/${UID}.print.jpg`, ROUND, ME)).toBeNull();
    expect(parsePhotoPath(`${ROUND}/${ME}/../${UID}.jpg`, ROUND, ME)).toBeNull();
    expect(parsePhotoPath(`${ROUND}/${ME}/sub/${UID}.jpg`, ROUND, ME)).toBeNull();
    expect(parsePhotoPath(`${ROUND}/${ME}/${UID}.png`, ROUND, ME)).toBeNull();
    expect(parsePhotoPath(`Documents/${UID}.jpg`, ROUND, ME)).toBeNull();
  });

  it('ett rond- eller användar-id som inte är en uuid ger aldrig träff (inget mönster byggs av det)', () => {
    expect(parsePhotoPath(`.*/${ME}/${UID}.jpg`, '.*', ME)).toBeNull();
    expect(parsePhotoPath(`${ROUND}/.*/${UID}.jpg`, ROUND, '.*')).toBeNull();
  });
});

describe('validatePhotoObject', () => {
  it('bara JPEG, inte tom, inte över taket — mätt i lagringen', () => {
    expect(validatePhotoObject({ size: 300_000, contentType: 'image/jpeg' }, PHOTO_MAX_BYTES)).toBeNull();
    expect(validatePhotoObject({ size: 300_000, contentType: 'image/heic' }, PHOTO_MAX_BYTES)).toMatch(/JPEG/);
    expect(validatePhotoObject({ size: 0, contentType: 'image/jpeg' }, PHOTO_MAX_BYTES)).toMatch(/tom/);
    expect(validatePhotoObject({ size: PRINT_PHOTO_MAX_BYTES + 1, contentType: 'image/jpeg' }, PRINT_PHOTO_MAX_BYTES)).toMatch(/för stor/);
  });
});

describe('numreringen', () => {
  it('nästa nummer är max + 1 — ett hål efter ett borttaget foto fylls aldrig', () => {
    expect(nextPhotoNo([])).toBe(1);
    expect(nextPhotoNo([{ photo_no: 1 }, { photo_no: 2 }])).toBe(3);
    expect(nextPhotoNo([{ photo_no: 1 }, { photo_no: 5 }])).toBe(6);
  });

  it('fotonumren per punkt, i nummerordning, och mallens hänvisning', () => {
    const byItem = photoNumbersByItem([
      makePhoto({ item_id: 'a', photo_no: 3 }),
      makePhoto({ item_id: 'b', photo_no: 2 }),
      makePhoto({ item_id: 'a', photo_no: 1 }),
    ]);
    expect(byItem.get('a')).toEqual([1, 3]);
    expect(formatPhotoRefs(byItem.get('a') ?? [])).toBe('Foto 1, 3');
    expect(formatPhotoRefs([])).toBe('');
  });
});

describe('selectPhotosForPdf', () => {
  it('alla ryms normalt — trettio små varianter under budgeten', () => {
    const photos = Array.from({ length: 30 }, (_, i) => makePhoto({ photo_no: i + 1, print_size_bytes: 110_000 }));
    const { embed, omitted } = selectPhotosForPdf(photos);
    expect(embed).toHaveLength(30);
    expect(omitted).toHaveLength(0);
    expect(30 * 110_000).toBeLessThan(PDF_PHOTO_BUDGET_BYTES);
  });

  it('i nummerordning tills budgeten tar slut — resten listas, och inget senare foto smiter in', () => {
    const photos = [
      makePhoto({ photo_no: 2, print_size_bytes: 600 }),
      makePhoto({ photo_no: 1, print_size_bytes: 500 }),
      makePhoto({ photo_no: 3, print_size_bytes: 100 }),
    ];
    const { embed, omitted } = selectPhotosForPdf(photos, 1000);
    expect(embed.map((p) => p.photo_no)).toEqual([1]);
    // Foto 3 hade fått plats, men ett protokoll med 1 och 3 men inte 2 läses som ett fel.
    expect(omitted.map((p) => p.photo_no)).toEqual([2, 3]);
  });
});

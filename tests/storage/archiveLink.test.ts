import { describe, it, expect } from 'vitest';
import { buildArchiveDownloadUrl } from '@/app/api/storage/_lib';

// Regressionsvakt för domänbytet till app.ekovilla.se. Länken den här funktionen bygger skrivs in
// i Blikk- och arbetsorderkommentarer och går inte att rätta i efterhand — därför ligger den
// serverside och testas separat.
describe('buildArchiveDownloadUrl', () => {
  it('bygger en absolut länk mot den kanoniska rutten', () => {
    expect(buildArchiveDownloadUrl('https://app.ekovilla.se', 'Egenkontroller/rapport.pdf')).toBe(
      'https://app.ekovilla.se/api/storage/download?path=Egenkontroller%2Frapport.pdf',
    );
  });

  it('URL-kodar sökvägen — snedstreck, mellanslag och å ä ö får inte spräcka query-strängen', () => {
    const url = buildArchiveDownloadUrl(
      'https://app.ekovilla.se',
      'Egenkontroller/Egenkontroll_Åsa Öberg_1234.pdf',
    );
    expect(url).toBe(
      'https://app.ekovilla.se/api/storage/download?path=Egenkontroller%2FEgenkontroll_%C3%85sa%20%C3%96berg_1234.pdf',
    );
    // Sökvägen ska gå att läsa tillbaka oförvanskad.
    expect(decodeURIComponent(new URL(url).searchParams.get('path') || '')).toBe(
      'Egenkontroller/Egenkontroll_Åsa Öberg_1234.pdf',
    );
  });

  it('normaliserar bort avslutande snedstreck på origin så länken inte får dubbelt //', () => {
    expect(buildArchiveDownloadUrl('https://app.ekovilla.se/', 'a.pdf')).toBe(
      'https://app.ekovilla.se/api/storage/download?path=a.pdf',
    );
    expect(buildArchiveDownloadUrl('https://app.ekovilla.se///', 'a.pdf')).toBe(
      'https://app.ekovilla.se/api/storage/download?path=a.pdf',
    );
  });

  it('ger tom sträng när origin eller path saknas — anroparen utelämnar då raden helt', () => {
    expect(buildArchiveDownloadUrl('', 'a.pdf')).toBe('');
    expect(buildArchiveDownloadUrl('https://app.ekovilla.se', '')).toBe('');
    expect(buildArchiveDownloadUrl('   ', '   ')).toBe('');
    expect(buildArchiveDownloadUrl(undefined as unknown as string, null as unknown as string)).toBe('');
  });
});

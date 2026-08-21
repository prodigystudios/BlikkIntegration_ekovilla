import { describe, expect, it } from 'vitest';
import { buildInfoImagePath, isInfoImagePath, sanitizeInfoImageName } from '@/lib/domains/info-page/storage';

const SECTION = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';

describe('isInfoImagePath', () => {
  it('släpper igenom en sökväg vi själva byggde för sektionen', () => {
    const path = buildInfoImagePath(SECTION, 'skyddsutrustning.png', 'abc-123');
    expect(isInfoImagePath(SECTION, path)).toBe(true);
  });

  it('kastar sökvägar som pekar in i andra områdens filer', () => {
    // 🧨 Kärnan i fyndet: registreringsrutten tar sökvägen från klienten och servern signerar
    // den sedan med service-role. Eftersom SELECT-policyn släpper igenom varje inloggad hade
    // en rad som pekar hit gjort en privat arbetsorderritning synlig för alla på sidan.
    expect(isInfoImagePath(SECTION, 'Arbetsorder/abc/def/ritning.pdf')).toBe(false);
    expect(isInfoImagePath(SECTION, 'Documents/avtal.pdf')).toBe(false);
    expect(isInfoImagePath(SECTION, 'Egenkontroller/2026/rapport.pdf')).toBe(false);
    expect(isInfoImagePath(SECTION, 'Support/bilaga.png')).toBe(false);
  });

  it('kastar en sökväg som hör till en ANNAN flik', () => {
    const path = buildInfoImagePath(OTHER, 'bild.png', 'abc-123');
    expect(isInfoImagePath(SECTION, path)).toBe(false);
  });

  it('kastar traversering och separator-trick', () => {
    expect(isInfoImagePath(SECTION, `Info/${SECTION}/../../Arbetsorder/x.pdf`)).toBe(false);
    expect(isInfoImagePath(SECTION, `/Info/${SECTION}/bild.png`)).toBe(false);
    expect(isInfoImagePath(SECTION, `Info\\${SECTION}\\bild.png`)).toBe(false);
  });

  it('kastar tomt', () => {
    expect(isInfoImagePath(SECTION, '')).toBe(false);
    expect(isInfoImagePath('', 'Info//bild.png')).toBe(false);
  });
});

describe('sanitizeInfoImageName', () => {
  it('gör om namnet till ren ascii utan sökvägstecken', () => {
    expect(sanitizeInfoImageName('Skyddsutrustning på taket.png')).toBe('Skyddsutrustning-p_-taket.png');
    expect(sanitizeInfoImageName('../../etc/passwd')).toBe('.-.-etc-passwd');
  });

  it('faller tillbaka på ett namn när allt städats bort', () => {
    expect(sanitizeInfoImageName('   ')).toBe('bild');
  });
});

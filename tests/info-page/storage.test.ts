import { describe, expect, it } from 'vitest';
import {
  buildInfoImagePath,
  isInfoImagePath,
  resolveFileKind,
  sanitizeInfoImageName,
  toDownloadUrl,
} from '@/lib/domains/info-page/storage';

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

describe('resolveFileKind', () => {
  it('läser MIME-typen först', () => {
    expect(resolveFileKind('application/pdf', 'Info/x/abc-lathund.pdf')).toBe('pdf');
    expect(resolveFileKind('image/png', 'Info/x/abc-bild.png')).toBe('image');
    expect(resolveFileKind('image/jpeg; charset=binary', 'Info/x/abc-foto.jpg')).toBe('image');
  });

  it('faller tillbaka på ändelsen när typen saknas eller är intetsägande', () => {
    // Webbläsaren skickar tom typ för en fil vald ur ett moln-lager, och
    // application/octet-stream för en pdf som kommit via vissa filhanterare. Utan
    // fallbacken hade bägge avvisats i uppladdningen.
    expect(resolveFileKind(undefined, 'Info/x/abc-lathund.pdf')).toBe('pdf');
    expect(resolveFileKind('', 'Info/x/abc-bild.PNG')).toBe('image');
    expect(resolveFileKind('application/octet-stream', 'Info/x/abc-lathund.PDF')).toBe('pdf');
  });

  it('rader från före content_type-kolumnen läses på sökvägen', () => {
    // De seedade raderna har både null i content_type och ett file_name utan ändelse
    // ("Lathund Isolering") — det är public_path som bär sanningen.
    expect(resolveFileKind(null, '/documents/LATHUND ISOLERINGsdsdas-1.64dc66a5b38ea2.85087943.png')).toBe('image');
  });

  it('kastar svg — den serveras inline och är ett skriptdokument', () => {
    expect(resolveFileKind('image/svg+xml', 'Info/x/abc-logo.svg')).toBe('other');
    expect(resolveFileKind(null, 'Info/x/abc-logo.svg')).toBe('other');
  });

  it('kastar allt annat', () => {
    expect(resolveFileKind('text/html', 'Info/x/abc-sida.html')).toBe('other');
    expect(resolveFileKind(null, 'Info/x/abc-utan-andelse')).toBe('other');
    expect(resolveFileKind(null, '')).toBe('other');
  });
});

describe('toDownloadUrl', () => {
  it('hänger på download på en signerad url', () => {
    // 🧨 Signeringen sker UTAN download, för en url med Content-Disposition: attachment går
    // inte att bädda in — <iframe> hade laddat ned pdf:en i stället för att visa den. Den
    // här funktionen är därför den enda vägen tillbaka till en nedladdningslänk.
    expect(toDownloadUrl('https://x.supabase.co/storage/v1/object/sign/pdfs/Info/a/b.pdf?token=abc'))
      .toBe('https://x.supabase.co/storage/v1/object/sign/pdfs/Info/a/b.pdf?token=abc&download=');
  });

  it('använder ? när adressen saknar frågesträng', () => {
    expect(toDownloadUrl('https://x.example/fil.pdf')).toBe('https://x.example/fil.pdf?download=');
  });

  it('lämnar tomt orört', () => {
    expect(toDownloadUrl('')).toBe('');
  });
});

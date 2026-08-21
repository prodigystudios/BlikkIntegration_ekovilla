import { describe, expect, it } from 'vitest';
import {
  buildInfoImagePath,
  isInfoImagePath,
  resolveFileKind,
  resolveUploadKind,
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

  it('kapar långa namn UTAN att äta ändelsen', () => {
    // 🧨 Kapade den bort ".pdf" passerade filen vakten i steg ett (som ser filnamnet) och
    // avvisades i steg två (som ser sökvägen) — efter att objektet redan låg i bucketen.
    const long = `${'a'.repeat(200)}.pdf`;
    const out = sanitizeInfoImageName(long);
    expect(out.endsWith('.pdf')).toBe(true);
    expect(out.length).toBe(120);
    expect(resolveUploadKind(null, out)).toBe('pdf');
  });

  it('hittar inte på en ändelse när namnet saknar en', () => {
    const out = sanitizeInfoImageName('b'.repeat(200));
    expect(out.length).toBe(120);
    expect(out.includes('.')).toBe(false);
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

describe('resolveUploadKind', () => {
  it('släpper igenom när typ och ändelse pekar åt samma håll', () => {
    expect(resolveUploadKind('application/pdf', 'Info/x/abc-lathund.pdf')).toBe('pdf');
    expect(resolveUploadKind('image/png', 'Info/x/abc-bild.png')).toBe('image');
  });

  it('släpper igenom när webbläsaren inte kunde säga vad filen var', () => {
    expect(resolveUploadKind(undefined, 'lathund.pdf')).toBe('pdf');
    expect(resolveUploadKind('', 'bild.JPG')).toBe('image');
    expect(resolveUploadKind('application/octet-stream', 'lathund.pdf')).toBe('pdf');
  });

  it('🧨 kastar en påhittad MIME-typ på en fil med farlig ändelse', () => {
    // Fyndet: vakten frågade resolveFileKind, som svarar på MIME-typen FÖRST och därför
    // aldrig nådde ändelsen. { fileName: 'x.html', contentType: 'image/png' } passerade båda
    // stegen, och sökvägen vi reserverade slutade på .html — i en bucket vars SELECT-policy
    // släpper igenom varje inloggad.
    expect(resolveUploadKind('image/png', 'x.html')).toBe('other');
    expect(resolveUploadKind('application/pdf', 'x.html')).toBe('other');
    expect(resolveUploadKind('image/png', 'x.svg')).toBe('other');
  });

  it('kastar när typ och ändelse säger emot varandra', () => {
    expect(resolveUploadKind('text/html', 'lathund.pdf')).toBe('other');
    expect(resolveUploadKind('application/pdf', 'bild.png')).toBe('other');
    expect(resolveUploadKind('image/svg+xml', 'bild.png')).toBe('other');
  });

  it('kräver en ändelse — till skillnad från visningen', () => {
    expect(resolveUploadKind('application/pdf', 'Lathund')).toBe('other');
    // Visningen är tillåtande: en rad som redan ligger i databasen ska renderas så bra som
    // möjligt, och den frågan är inte samma som "får det här laddas upp".
    expect(resolveFileKind('application/pdf', 'Lathund')).toBe('pdf');
  });
});

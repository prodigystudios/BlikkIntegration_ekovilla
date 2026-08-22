import { describe, it, expect, vi } from 'vitest';
import {
  buildReceiptDir,
  buildReceiptPath,
  isReceiptPath,
  resolveReceiptAttachment,
  sanitizeReceiptFileName,
  validateReceiptFile,
  RECEIPT_MAX_BYTES,
} from '@/lib/domains/time/receipts';

const ANNA = '11111111-1111-4111-8111-111111111111';
const BENGT = '22222222-2222-4222-8222-222222222222';

describe('sanitizeReceiptFileName', () => {
  it('gör om filnamnet till ren ASCII utan sökvägstecken', () => {
    // \w utan u-flagga är [A-Za-z0-9_], så både Ö och ö blir _. Mellanslag blir bindestreck.
    expect(sanitizeReceiptFileName('Kvitto Ödeshög.jpg')).toBe('Kvitto-_desh_g.jpg');
    expect(sanitizeReceiptFileName('a/b\\c.pdf')).toBe('a-b-c.pdf');
  });

  // ⚠️ `..` får aldrig överleva till en storage-nyckel. isReceiptPath avvisar den också, men
  // saneringen är första ledet och ska inte förlita sig på det andra.
  it('neutraliserar katalogklättring', () => {
    const path = buildReceiptPath(ANNA, '../../hemligt.pdf', 'uid');
    expect(path.includes('..')).toBe(false);
    expect(isReceiptPath(path, ANNA)).toBe(true);
  });

  it('faller tillbaka på ett namn när ingenting återstår', () => {
    expect(sanitizeReceiptFileName('   ')).toBe('kvitto');
    expect(sanitizeReceiptFileName('')).toBe('kvitto');
  });

  it('kapar orimligt långa namn', () => {
    expect(sanitizeReceiptFileName('a'.repeat(400)).length).toBe(120);
  });
});

describe('buildReceiptPath', () => {
  it('lägger ägaren i sökvägen', () => {
    expect(buildReceiptDir(ANNA)).toBe(`Kvitton/${ANNA}`);
    expect(buildReceiptPath(ANNA, 'kvitto.jpg', 'abc')).toBe(`Kvitton/${ANNA}/abc-kvitto.jpg`);
  });
});

describe('isReceiptPath', () => {
  const own = buildReceiptPath(ANNA, 'kvitto.jpg', 'abc');

  it('släpper igenom den egna katalogen', () => {
    expect(isReceiptPath(own, ANNA)).toBe(true);
  });

  /**
   * ⚠️ HELA SPÄRREN LIGGER HÄR.
   *
   * Klienten skickar tillbaka sökvägen den fick, och en upload-token binder BARA sökvägen. Utan den
   * här kontrollen kunde en inloggad användare påstå att ett Documents/-objekt, en arbetsorderfil
   * eller en kollegas kvitto var hens eget — och sedan öppna det genom sin egen post, eftersom
   * /receipt-routen signerar vad raden än pekar på. Det gör vem som helst till läsare av allt i
   * bucketen.
   */
  it('avvisar andras kataloger och andra prefix', () => {
    expect(isReceiptPath(buildReceiptPath(BENGT, 'kvitto.jpg', 'abc'), ANNA)).toBe(false);
    expect(isReceiptPath('Documents/hemlig-ritning.pdf', ANNA)).toBe(false);
    expect(isReceiptPath(`Arbetsorder/x/${ANNA}/fil.pdf`, ANNA)).toBe(false);
    // Prefixmatchning på ett id som BÖRJAR med det egna hade varit ett hål; katalogen slutar på "/".
    expect(isReceiptPath(`Kvitton/${ANNA}extra/abc-kvitto.jpg`, ANNA)).toBe(false);
  });

  it('avvisar katalogklättring och egna underkataloger', () => {
    expect(isReceiptPath(`Kvitton/${ANNA}/../${BENGT}/kvitto.jpg`, ANNA)).toBe(false);
    expect(isReceiptPath(`Kvitton/${ANNA}/under/kvitto.jpg`, ANNA)).toBe(false);
  });

  it('avvisar tomt och saknad ägare', () => {
    expect(isReceiptPath('', ANNA)).toBe(false);
    expect(isReceiptPath(own, '')).toBe(false);
    expect(isReceiptPath(null as any, ANNA)).toBe(false);
  });
});

describe('validateReceiptFile', () => {
  it('släpper igenom bilder och PDF', () => {
    expect(validateReceiptFile({ size: 1000, type: 'image/jpeg', name: 'k.jpg' })).toBeNull();
    expect(validateReceiptFile({ size: 1000, type: 'application/pdf', name: 'k.pdf' })).toBeNull();
    expect(validateReceiptFile({ size: 1000, type: 'image/heic', name: 'k.heic' })).toBeNull();
  });

  it('avvisar fel typ, tom fil och för stor fil', () => {
    expect(validateReceiptFile({ size: 1000, type: 'text/csv', name: 'k.csv' })).toMatch(/bild/i);
    expect(validateReceiptFile({ size: 0, type: 'image/jpeg', name: 'k.jpg' })).toMatch(/tom/i);
    expect(validateReceiptFile({ size: RECEIPT_MAX_BYTES + 1, type: 'image/jpeg', name: 'k.jpg' })).toMatch(/för stor/i);
  });

  // Safari och en del Android-webbläsare skickar tom `type` för HEIC. Utan fallbacken på filändelsen
  // kan en iPhone-användare inte fotografera ett kvitto alls.
  it('faller tillbaka på filändelsen när webbläsaren inte satte någon typ', () => {
    expect(validateReceiptFile({ size: 1000, type: '', name: 'IMG_0042.HEIC' })).toBeNull();
    expect(validateReceiptFile({ size: 1000, type: '', name: 'kvitto.exe' })).toMatch(/bild/i);
  });
});

// ── resolveReceiptAttachment ─────────────────────────────────────────────────

function storageStub(entry: { name: string; size: number; mimetype: string } | null) {
  const remove = vi.fn(async () => ({ data: null, error: null }));
  const list = vi.fn(async () => ({
    data: entry ? [{ name: entry.name, metadata: { size: entry.size, mimetype: entry.mimetype } }] : [],
    error: null,
  }));
  return { admin: { storage: { from: () => ({ list, remove }) } } as any, list, remove };
}

const NOW = () => '2026-08-22T10:00:00.000Z';

describe('resolveReceiptAttachment', () => {
  it('gör en giltig uppladdning till kolumner, med storlek och typ från LAGRINGEN', async () => {
    const path = buildReceiptPath(ANNA, 'kvitto.jpg', 'abc');
    const { admin } = storageStub({ name: `abc-kvitto.jpg`, size: 40_000, mimetype: 'image/jpeg' });

    const result = await resolveReceiptAttachment(admin, 'pdfs', ANNA, { storage_path: path, file_name: 'kvitto.jpg' }, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columns).toEqual({
      receipt_bucket: 'pdfs',
      receipt_path: path,
      receipt_name: 'kvitto.jpg',
      receipt_content_type: 'image/jpeg',
      receipt_size_bytes: 40_000,
      receipt_uploaded_at: '2026-08-22T10:00:00.000Z',
    });
  });

  it('avvisar en sökväg som inte är användarens egen — utan att röra lagringen', async () => {
    const { admin, list, remove } = storageStub({ name: 'x', size: 1, mimetype: 'image/jpeg' });

    const result = await resolveReceiptAttachment(
      admin, 'pdfs', ANNA,
      { storage_path: buildReceiptPath(BENGT, 'kvitto.jpg', 'abc'), file_name: 'kvitto.jpg' },
      NOW,
    );

    expect(result.ok).toBe(false);
    // ⚠️ INGET remove. Objektet är någon annans — en städning här hade gjort spärren till ett vapen:
    // vem som helst kunde radera vilket objekt som helst i bucketen genom att peka ut det.
    expect(remove).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('avvisar när objektet inte finns i lagringen', async () => {
    const { admin } = storageStub(null);
    const result = await resolveReceiptAttachment(
      admin, 'pdfs', ANNA,
      { storage_path: buildReceiptPath(ANNA, 'kvitto.jpg', 'abc'), file_name: 'kvitto.jpg' },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/kom aldrig fram/i);
  });

  /**
   * Regression: klientens PÅSTÅENDE om storlek får aldrig bli sanningen.
   *
   * Steg 1 avvisar en fil som redan på pappret är för stor, men den kontrollen är en artighet — en
   * klient kan påstå 2 MB och ladda upp 40. Det är den här läsningen ur lagringen som är spärren,
   * och den ska dessutom städa bort objektet: det ligger bevisligen i användarens egen katalog och
   * hör inte hemma någonstans.
   */
  it('läser den FAKTISKA storleken och städar bort en för stor fil', async () => {
    const path = buildReceiptPath(ANNA, 'kvitto.jpg', 'abc');
    const { admin, remove } = storageStub({ name: 'abc-kvitto.jpg', size: RECEIPT_MAX_BYTES + 1, mimetype: 'image/jpeg' });

    const result = await resolveReceiptAttachment(admin, 'pdfs', ANNA, { storage_path: path, file_name: 'kvitto.jpg' }, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/för stor/i);
    expect(remove).toHaveBeenCalledWith([path]);
  });

  it('städar bort en fil av fel typ', async () => {
    const path = buildReceiptPath(ANNA, 'kvitto.zip', 'abc');
    const { admin, remove } = storageStub({ name: 'abc-kvitto.zip', size: 500, mimetype: 'application/zip' });

    const result = await resolveReceiptAttachment(admin, 'pdfs', ANNA, { storage_path: path, file_name: 'kvitto.zip' }, NOW);

    expect(result.ok).toBe(false);
    expect(remove).toHaveBeenCalledWith([path]);
  });

  // `search` i storage-API:t är en DELSTRÄNGSMATCHNING. Träffar den ett annat objekt i katalogen
  // hade vi läst FEL fils storlek och typ — därför jämförs namnet exakt.
  it('godtar inte ett objekt vars namn bara liknar det sökta', async () => {
    const path = buildReceiptPath(ANNA, 'kvitto.jpg', 'abc');
    const { admin } = storageStub({ name: 'abc-kvitto.jpg.bak', size: 500, mimetype: 'image/jpeg' });

    const result = await resolveReceiptAttachment(admin, 'pdfs', ANNA, { storage_path: path, file_name: 'kvitto.jpg' }, NOW);
    expect(result.ok).toBe(false);
  });
});

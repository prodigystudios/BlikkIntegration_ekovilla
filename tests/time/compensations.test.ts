import { describe, it, expect } from 'vitest';
import {
  carriesAmount,
  compensationConstraintError,
  countMissingReceipts,
  hasReceipt,
  isReceiptMissing,
  summarizeCompensations,
  COMPENSATION_UNITS,
  EMPTY_RECEIPT,
  type CompensationItem,
} from '@/lib/domains/time/compensations';

const item = (over: Partial<CompensationItem> = {}): CompensationItem => ({
  id: 'x', user_id: 'anna', entry_date: '2026-08-11', kind: 'expense',
  quantity: null, amount: 100, vat_amount: null, note: null,
  receipt_name: null, receipt_content_type: null, receipt_size_bytes: null, receipt_uploaded_at: null,
  ...over,
});

// Ett utlägg MED kvitto. Egen hjälpare för att `receipt_name` är det enda fält som avgör saken —
// om den härledningen någonsin byter fält ska testerna gå sönder på ett ställe.
const withReceipt = (over: Partial<CompensationItem> = {}): CompensationItem =>
  item({ receipt_name: 'kvitto.jpg', receipt_content_type: 'image/jpeg', receipt_size_bytes: 12345, ...over });

// Regeln bakom att beloppsfältet bara finns på utlägg (William 2026-09-01: traktamente och
// milersättning ersätts med fasta satser som lönebyrån äger). Den läses av formuläret, båda routerna
// och båda vyerna — går den isär får man en ruta som går att fylla i på ett ställe och ignoreras på
// ett annat, vilket är precis det missförstånd ändringen tog bort.
describe('carriesAmount', () => {
  it('är sant bara för utlägg', () => {
    expect(carriesAmount('expense')).toBe(true);
    expect(carriesAmount('travel')).toBe(false);
    expect(carriesAmount('per_diem')).toBe(false);
  });

  // ⚠️ Speglar enheterna, men får inte HÄRLEDAS ur dem. Att utlägg saknar enhet och bär belopp är
  // två separata fakta om samma sort; en `!COMPENSATION_UNITS[kind]` hade kopplat ihop dem så att en
  // framtida sort med både enhet och belopp (timersättning?) tyst blev beloppslös.
  it('är motsatsen till att ha en enhet — i dag, men inte per definition', () => {
    expect(carriesAmount('expense')).toBe(COMPENSATION_UNITS.expense === null);
    expect(carriesAmount('travel')).toBe(COMPENSATION_UNITS.travel === null);
  });
});

describe('summarizeCompensations', () => {
  it('summerar belopp och antal per sort', () => {
    const totals = summarizeCompensations([
      item({ kind: 'travel', quantity: 12.5, amount: 312.5 }),
      item({ kind: 'travel', quantity: 4, amount: 100 }),
      item({ kind: 'expense', amount: 249 }),
    ]);
    expect(totals).toEqual([
      { kind: 'travel', quantity: 16.5, amount: 412.5, vat: 0, count: 2, missingReceipts: 0 },
      { kind: 'expense', quantity: 0, amount: 249, vat: 0, count: 1, missingReceipts: 1 },
    ]);
  });

  // Regression: PostgREST returnerar numeric som STRÄNG. Med + i stället för Number() hade
  // '120.50' + '80.25' blivit '120.5080.25' — ett belopp som ser ut som ett belopp.
  it('behandlar numeric-strängar från PostgREST som tal', () => {
    const totals = summarizeCompensations([
      item({ kind: 'per_diem', amount: '120.50' as any, quantity: '1' as any }),
      item({ kind: 'per_diem', amount: '80.25' as any, quantity: '1' as any }),
    ]);
    expect(totals[0].amount).toBe(200.75);
    expect(totals[0].quantity).toBe(2);
  });

  it('utelämnar sorter utan poster', () => {
    expect(summarizeCompensations([item({ kind: 'expense', amount: 50 })]).map((t) => t.kind)).toEqual(['expense']);
  });

  it('är tom när det inte finns några poster', () => {
    expect(summarizeCompensations([])).toEqual([]);
  });
});

describe('COMPENSATION_UNITS', () => {
  // Utlägg har ingen enhet — beloppet är hela sanningen. Mil och traktamente har det, så formuläret
  // kan fråga efter antal utöver kronorna.
  it('ger utlägg ingen enhet', () => {
    expect(COMPENSATION_UNITS.expense).toBeNull();
    expect(COMPENSATION_UNITS.travel).toBe('mil');
    expect(COMPENSATION_UNITS.per_diem).toBe('dagar');
  });
});

describe('summarizeCompensations — moms och kvitton', () => {
  it('summerar momsen per sort och räknar en saknad moms som noll kronor', () => {
    const totals = summarizeCompensations([
      withReceipt({ amount: 250, vat_amount: 50 }),
      withReceipt({ amount: 125, vat_amount: 25 }),
      // Moms ej ifylld. Ska inte bidra till summan — och inte heller göra den till NaN, vilket är
      // vad `current.vat += item.vat_amount` hade gett.
      withReceipt({ amount: 100, vat_amount: null }),
    ]);
    expect(totals[0].vat).toBe(75);
    expect(totals[0].amount).toBe(475);
  });

  // Samma PostgREST-fälla som beloppet: numeric kommer som sträng.
  it('behandlar moms som numeric-sträng som tal', () => {
    const totals = summarizeCompensations([
      withReceipt({ amount: '250.00' as any, vat_amount: '50.00' as any }),
      withReceipt({ amount: '125.00' as any, vat_amount: '25.00' as any }),
    ]);
    expect(totals[0].vat).toBe(75);
  });

  it('räknar bara utlägg som saknade kvitton', () => {
    const totals = summarizeCompensations([
      item({ kind: 'travel', quantity: 10, amount: 250 }),
      item({ kind: 'per_diem', quantity: 1, amount: 260 }),
      item({ kind: 'expense', amount: 89 }),
      withReceipt({ kind: 'expense', amount: 120 }),
    ]);
    const byKind = Object.fromEntries(totals.map((t) => [t.kind, t.missingReceipts]));
    // ⚠️ Traktamente och milersättning har inga kvitton att lämna in. En flagga på dem hade varit
    // brus som lär folk att ignorera flaggan — och attesten hade visat "3 saknar kvitto" på en
    // månad där ett enda papper faktiskt fattades.
    expect(byKind).toEqual({ travel: 0, per_diem: 0, expense: 1 });
  });
});

describe('isReceiptMissing / hasReceipt', () => {
  it('flaggar bara utlägg utan kvitto', () => {
    expect(isReceiptMissing(item({ kind: 'expense' }))).toBe(true);
    expect(isReceiptMissing(withReceipt({ kind: 'expense' }))).toBe(false);
    expect(isReceiptMissing(item({ kind: 'travel' }))).toBe(false);
    expect(isReceiptMissing(item({ kind: 'per_diem' }))).toBe(false);
  });

  it('svarar på om posten bär ett kvitto oavsett sort', () => {
    expect(hasReceipt(item())).toBe(false);
    expect(hasReceipt(withReceipt())).toBe(true);
  });

  it('räknar saknade kvitton i ett urval', () => {
    expect(countMissingReceipts([item(), withReceipt(), item({ kind: 'travel' }), item()])).toBe(2);
    expect(countMissingReceipts([])).toBe(0);
  });
});

describe('EMPTY_RECEIPT', () => {
  // Regression: nollställningen måste släcka ALLA kvittokolumner. En bortglömd kolumn hade lämnat en
  // rad som påstår sig ha ett kvitto vars objekt inte finns — och `Visa kvitto`-länken hade gett 404
  // på en post som ser komplett ut.
  it('nollar varje kvittokolumn', () => {
    expect(Object.keys(EMPTY_RECEIPT).sort()).toEqual([
      'receipt_bucket', 'receipt_content_type', 'receipt_name', 'receipt_path',
      'receipt_size_bytes', 'receipt_uploaded_at',
    ]);
    expect(Object.values(EMPTY_RECEIPT).every((value) => value === null)).toBe(true);
  });
});

describe('compensationConstraintError', () => {
  it('översätter momsvillkoret till ett 400 på svenska', () => {
    const mapped = compensationConstraintError({
      code: '23514',
      message: 'new row for relation "crm_time_compensations" violates check constraint "crm_time_compensations_vat_amount_chk"',
    });
    expect(mapped?.status).toBe(400);
    expect(mapped?.code).toBe('time_compensation_vat_invalid');
    // Meddelandet måste nämna BÅDA fälten: villkoret slår lika gärna när man sänker beloppet under
    // en moms som redan står på raden, och en PATCH som bara skickar `amount` kan inte förvarna.
    expect(mapped?.message).toMatch(/moms/i);
    expect(mapped?.message).toMatch(/belopp/i);
  });

  it('rör inte andra fel', () => {
    expect(compensationConstraintError(null)).toBeNull();
    expect(compensationConstraintError({ code: 'P0001', message: 'Perioden är inlämnad' })).toBeNull();
    expect(compensationConstraintError({ code: '23505', message: 'duplicate key' })).toBeNull();
    // En annan CHECK på samma tabell ska inte påstå att det handlade om moms.
    expect(compensationConstraintError({ code: '23514', message: 'violates check constraint "crm_time_compensations_kind_check"' })).toBeNull();
  });
});

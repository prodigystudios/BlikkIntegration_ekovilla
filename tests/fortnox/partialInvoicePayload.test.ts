import { describe, it, expect, vi, beforeEach } from 'vitest';

// Vad delfakturan FAKTISKT skickar till Fortnox.
//
// Skilt från partialInvoices.test.ts, som prövar de rena funktionerna utan mockar. Det här är den
// andra halvan av skyddet: att createPartialInvoice verkligen KOPPLAR IN dem. Buggen som filen
// föddes ur satt precis i den sömmen — `partialInvoiceReferenceField` hade kunnat vara aldrig så
// rätt medan payloaden stämplade in vårt ordernummer ändå.
//
// Fältnamnen är externa (Fortnox API) och stavas därför ut ordagrant här. Byter någon `YourOrderNumber`
// mot ett fält som "låter rättare" ska det synas som ett rött test, inte som en tyst tom ruta på en
// faktura hos kunden.

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

vi.mock('@/lib/domains/fortnox/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/client')>();
  return { ...actual, fortnoxGet: vi.fn(), fortnoxPost: vi.fn(), fortnoxPut: vi.fn() };
});

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxGet, fortnoxPost, fortnoxPut } from '@/lib/domains/fortnox/client';
import { createPartialInvoice } from '@/lib/domains/fortnox/partialInvoices';

const WORK_ORDER_ID = 'wo-1';
const LINE_ID = 'line-a';

// En arbetsorder som är redo att delfaktureras: företagskund, en prissatt rad, ordern finns redan i
// Fortnox (så pushWorkOrderToFortnox aldrig rörs) och reverse_vat är uttryckt så resolveReverseVat
// kortsluter utan att fråga databasen.
const workOrderRow = {
  id: WORK_ORDER_ID,
  status: 'completed',
  project_name: 'Vindsisolering Kv Björken',
  vat_percent: 25,
  customer_id: 'cust-1',
  customer_snapshot: { reverse_vat: false },
  line_items: [{ id: LINE_ID, pricing_mode: 'item', unit_price: '100', quantity: '10' }],
  partial_invoicing_started_at: null,
  fortnox_order_number: '1234',
  // Uttrycklig typ, inte den inferrerade `null`: ROT-fallen nedan skickar in riktiga uppgifter via
  // overrides, och Partial<typeof workOrderRow> hade annars låst fältet till null | undefined.
  rot_details: null as { enabled?: boolean; property_designation?: string; brf_org_number?: string } | null,
};

// En kedja per tabell — den delade makeQueryChain räcker inte här, eftersom createPartialInvoice
// läser tre olika tabeller i samma anrop och claimFortnoxPush dessutom använder .lt().
function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'lt', 'order', 'limit'] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
    Promise.resolve(result).then(ok, err);
  return chain;
}

function installSupabaseMock(overrides: Partial<typeof workOrderRow> = {}) {
  // claimFortnoxPush vinner claimen på första försöket (update ... .select('id') ger en rad).
  const workOrders = makeChain({ data: [{ id: WORK_ORDER_ID }], error: null });
  workOrders.single = vi.fn().mockResolvedValue({ data: { ...workOrderRow, ...overrides }, error: null });
  const invoices = makeChain({ data: [], error: null });

  vi.mocked(getSupabaseAdmin).mockReturnValue({
    from: vi.fn((table: string) => (table === 'crm_work_order_invoices' ? invoices : workOrders)),
  } as unknown as ReturnType<typeof getSupabaseAdmin>);
}

// Payloaden som skickades till POST /invoices.
function postedInvoice(): Record<string, unknown> {
  const [path, body] = vi.mocked(fortnoxPost).mock.calls[0] as [string, { Invoice: Record<string, unknown> }];
  expect(path).toBe('/invoices');
  return body.Invoice;
}

describe('createPartialInvoice — fakturahuvudet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installSupabaseMock();
    vi.mocked(fortnoxPost).mockResolvedValue({ Invoice: { DocumentNumber: 9001 } } as never);
    vi.mocked(fortnoxPut).mockResolvedValue({} as never);
  });

  // ⚖️ KÄRNAN. "Ert referensnummer" på delfakturan är KUNDENS märkning, aldrig vårt ordernummer.
  // Fältet heter YourOrderNumber på både order och faktura, vilket är exakt varför de kunde krocka.
  it('bär kundens märkning i YourOrderNumber, inte Fortnox-ordernumret', async () => {
    vi.mocked(fortnoxGet).mockResolvedValue({
      Order: { CustomerNumber: 55, YourOrderNumber: 'Projekt 4711', YourReference: 'Anna Andersson' },
    } as never);

    await createPartialInvoice(WORK_ORDER_ID, [{ line_id: LINE_ID, quantity: 4 }], 'user-1');

    const invoice = postedInvoice();
    expect(invoice.YourOrderNumber).toBe('Projekt 4711');
    // Ordernumret får inte smyga tillbaka in i fältet — det är hela buggen.
    expect(invoice.YourOrderNumber).not.toBe('1234');
    // Men det ska fortfarande stå i Remarks, som är där ekonomi hittar kopplingen order→faktura.
    expect(invoice.Remarks).toBe('Delfaktura 1 – avser order 1234 – Vindsisolering Kv Björken');
    // Er referens speglas som förut och ska inte ha påverkats av ändringen.
    expect(invoice.YourReference).toBe('Anna Andersson');
  });

  // En order utan märkning ska inte få en påhittad — nyckeln utelämnas hellre helt.
  it('utelämnar YourOrderNumber när ordern saknar referensnummer', async () => {
    vi.mocked(fortnoxGet).mockResolvedValue({ Order: { CustomerNumber: 55 } } as never);

    await createPartialInvoice(WORK_ORDER_ID, [{ line_id: LINE_ID, quantity: 4 }], 'user-1');

    expect('YourOrderNumber' in postedInvoice()).toBe(false);
  });

  // 🧨 Följdrisken av speglingen: på en ROT-villa ÄR fastighetsbeteckningen referensnumret, och
  // Fortnox saknar fält för den — den rider annars som textrad. Bygger vi textraden vid sidan om
  // regeln står beteckningen två gånger på fakturan medan orderbekräftelsen har den en gång.
  const rotVilla = { enabled: true, property_designation: 'Haggården 6:3' };
  const textRows = (invoice: Record<string, unknown>) =>
    (invoice.InvoiceRows as Array<{ Description?: string }>).filter((r) => r.Description?.includes('Fastighetsbeteckning'));

  it('trycker inte fastighetsbeteckningen två gånger på en ROT-villa', async () => {
    installSupabaseMock({ rot_details: rotVilla });
    vi.mocked(fortnoxGet).mockResolvedValue({
      Order: { CustomerNumber: 55, YourOrderNumber: 'Haggården 6:3' },
    } as never);

    await createPartialInvoice(WORK_ORDER_ID, [{ line_id: LINE_ID, quantity: 4 }], 'user-1');

    const invoice = postedInvoice();
    expect(invoice.YourOrderNumber).toBe('Haggården 6:3');
    expect(invoice.TaxReductionType).toBe('rot');
    expect(textRows(invoice)).toHaveLength(0);
  });

  // ⚠️ Men beteckningen får aldrig FÖRSVINNA. Bär ordern den inte (pushad innan ROT-uppgifterna
  // fanns, eller en misslyckad header-synk) ska textraden stå kvar — den är underlaget för avdraget.
  it('behåller textraden när ROT-ordern saknar referensnummer', async () => {
    installSupabaseMock({ rot_details: rotVilla });
    vi.mocked(fortnoxGet).mockResolvedValue({ Order: { CustomerNumber: 55 } } as never);

    await createPartialInvoice(WORK_ORDER_ID, [{ line_id: LINE_ID, quantity: 4 }], 'user-1');

    expect(textRows(postedInvoice())).toHaveLength(1);
  });
});

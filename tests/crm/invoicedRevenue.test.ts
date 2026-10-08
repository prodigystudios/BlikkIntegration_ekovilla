import { describe, it, expect } from 'vitest';
import {
  invoicedAt,
  invoicedRevenue,
  uninvoicedAmount,
  type InvoicedOrderRow,
  type InvoiceRoundRow,
} from '@/lib/domains/crm/invoicedRevenue';
import { computePricing, type PricingLineItem } from '@/lib/domains/crm/pricing';
import { lineKey, roundSubtotal, type PartialInvoiceLineItem } from '@/lib/domains/fortnox/partialInvoices';

// "Fakturerat" räknas per FAKTURA. En order fakturerad i ett svep är en faktura; en delfakturerad
// order är en faktura per runda, var och en på sitt eget datum. Innan det här räknade rapporten
// och topplistan bara ordrar med status `invoiced` — en order mitt i delfaktureringen gav 0 kr, och
// när sista rundan gick landade hela ordervärdet på sista rundans dag.

const order = (overrides: Partial<InvoicedOrderRow> = {}): InvoicedOrderRow => ({
  vat_percent: 0,
  amount: 50_000,
  status: 'invoiced',
  created_at: '2026-07-01T08:00:00Z',
  fortnox_invoiced_at: '2026-09-10T08:00:00Z',
  partial_invoicing_started_at: null,
  assigned_to: 'u1',
  client_name: 'Kund A',
  ...overrides,
});

const round = (amount: number | string, createdAt: string, workOrder: InvoiceRoundRow['work_order'] = { status: 'partially_invoiced', assigned_to: 'u1', client_name: 'Kund A' }): InvoiceRoundRow => ({
  amount,
  created_at: createdAt,
  work_order: workOrder,
});

const stamp = (o: InvoicedOrderRow) => o.fortnox_invoiced_at;

describe('invoicedRevenue — ordrar fakturerade i ett svep', () => {
  it('ger en faktura med orderns netto på orderns datum', () => {
    expect(invoicedRevenue([order()], [], stamp)).toEqual([
      { amount: 50_000, at: '2026-09-10T08:00:00Z', assigned_to: 'u1', client_name: 'Kund A', quote_type: null, work_order_id: null },
    ]);
  });

  it('för vidare orderns id — fakturerat per depå slår upp orderns schema på det', () => {
    expect(invoicedRevenue([order({ id: 'ao-1' })], [], stamp)[0].work_order_id).toBe('ao-1');
  });

  it('för vidare orderns kundtyp — rapportens andel privat', () => {
    expect(invoicedRevenue([order({ quote_type: 'private' })], [], stamp)[0].quote_type).toBe('private');
  });

  it('räknas ex moms, samma bas som resten av rapporten', () => {
    const [invoice] = invoicedRevenue([order({ vat_percent: 25, amount: 62_500 })], [], stamp);
    expect(invoice.amount).toBe(50_000);
  });

  it('räknar bara ordrar med status invoiced', () => {
    const notBilled = ['completed', 'partially_invoiced', 'in_progress', 'cancelled'].map((status) => order({ status }));
    expect(invoicedRevenue(notBilled, [], stamp)).toEqual([]);
  });

  it('följer anroparens datumregel, och en order utan datum räknas inte', () => {
    const unstamped = order({ fortnox_invoiced_at: null });
    expect(invoicedRevenue([unstamped], [], stamp)).toEqual([]);
    // Rapportens regel faller tillbaka på skapandedatumet.
    expect(invoicedRevenue([unstamped], [], invoicedAt)[0].at).toBe('2026-07-01T08:00:00Z');
  });
});

describe('invoicedRevenue — delfakturerade ordrar', () => {
  it('räknar rundorna för en order som är MITT I delfaktureringen', () => {
    const midway = order({ status: 'partially_invoiced', fortnox_invoiced_at: null, partial_invoicing_started_at: '2026-08-05T08:00:00Z' });
    const result = invoicedRevenue([midway], [round(30_000, '2026-08-05T08:00:00Z')], stamp);
    expect(result).toEqual([{ amount: 30_000, at: '2026-08-05T08:00:00Z', assigned_to: 'u1', client_name: 'Kund A', quote_type: null, work_order_id: null }]);
  });

  // Den slutfakturerade ordern är `invoiced` med fortnox_invoiced_at = sista rundans dag. Räknas
  // både ordern och rundorna blir sista rundans pengar dubbla — och alla tidigare rundors pengar
  // hamnar dessutom en gång till på sista dagen.
  it('räknar inte ordern själv när den slutfakturerats i rundor, bara rundorna', () => {
    const closed = order({ partial_invoicing_started_at: '2026-08-05T08:00:00Z' });
    const done = { status: 'invoiced', assigned_to: 'u1', client_name: 'Kund A' };
    const result = invoicedRevenue([closed], [
      round(30_000, '2026-08-05T08:00:00Z', done),
      round(20_000, '2026-09-10T08:00:00Z', done),
    ], stamp);

    expect(result.map((invoice) => [invoice.at.slice(0, 7), invoice.amount])).toEqual([['2026-08', 30_000], ['2026-09', 20_000]]);
    expect(result.reduce((total, invoice) => total + invoice.amount, 0)).toBe(50_000);
  });

  // En order kan sättas tillbaka i ett arbetsläge efter en runda (den lokala databasen har en sådan
  // på `in_progress`). Pengarna är fakturerade ändå.
  it('räknar en runda oavsett vilket arbetsläge ordern står i nu', () => {
    const result = invoicedRevenue([], [round(2_800, '2026-10-02T11:59:28Z', { status: 'in_progress', assigned_to: 'u2', client_name: 'Kund B' })], stamp);
    expect(result).toEqual([{ amount: 2_800, at: '2026-10-02T11:59:28Z', assigned_to: 'u2', client_name: 'Kund B', quote_type: null, work_order_id: null }]);
  });

  it('för vidare rundans order-id', () => {
    const [invoice] = invoicedRevenue([], [{ ...round(2_800, '2026-10-02T11:59:28Z'), work_order_id: 'ao-2' }], stamp);
    expect(invoice.work_order_id).toBe('ao-2');
  });

  it('för vidare rundans orders kundtyp', () => {
    const result = invoicedRevenue([], [round(2_800, '2026-10-02T11:59:28Z', { status: 'invoiced', assigned_to: 'u2', client_name: 'Kund B', quote_type: 'private' })], stamp);
    expect(result[0].quote_type).toBe('private');
  });

  it('läser ett belopp som kommer som sträng', () => {
    const [invoice] = invoicedRevenue([], [round('12500.50', '2026-08-05T08:00:00Z')], stamp);
    expect(invoice.amount).toBe(12_500.5);
  });

  it('läser en inbäddad order som kommer som lista', () => {
    const [invoice] = invoicedRevenue([], [round(1_000, '2026-08-05T08:00:00Z', [{ status: 'partially_invoiced', assigned_to: 'u3', client_name: 'Kund C' }])], stamp);
    expect(invoice).toMatchObject({ assigned_to: 'u3', client_name: 'Kund C' });
  });

  it('hoppar över en runda vars order läsaren inte får se', () => {
    expect(invoicedRevenue([], [round(1_000, '2026-08-05T08:00:00Z', null)], stamp)).toEqual([]);
  });

  it('hoppar över en runda på en avbruten order, samma regel som för ordrarna', () => {
    expect(invoicedRevenue([], [round(1_000, '2026-08-05T08:00:00Z', { status: 'cancelled', assigned_to: 'u1', client_name: 'Kund A' })], stamp)).toEqual([]);
  });
});

// Rundans `amount` (roundSubtotal) och orderns netto (computePricing.subtotal) räknas av två olika
// funktioner. Att en helt delfakturerad order summerar till samma netto som om den fakturerats i ett
// svep vilar på att de två har samma bas — antal × pris efter rabatt, utan moms. Glider de isär
// visar rapporten olika "fakturerat" för samma jobb beroende på hur det fakturerades.
describe('rundornas bas är orderns netto', () => {
  it('två rundor som tillsammans fakturerar allt summerar till orderns subtotal', () => {
    const lines: PartialInvoiceLineItem[] = [
      { pricing_mode: 'item', unit_price: '120', quantity: '50', discount_percent: '10' },
      { pricing_mode: 'item', unit_price: '89.90', quantity: '7' },
    ];
    const first = new Map([[lineKey(lines[0], 0), 30], [lineKey(lines[1], 1), 7]]);
    const second = new Map([[lineKey(lines[0], 0), 20]]);

    const billed = roundSubtotal(lines, first) + roundSubtotal(lines, second);
    const { subtotal } = computePricing(lines as PricingLineItem[], 25);

    expect(billed).toBeCloseTo(subtotal, 2);
  });
});

// "Att fakturera" och "Order" på översikten visar det som ÄNNU INTE fakturerats. En delfakturerad
// order stod kvar där med hela sitt värde, också den del som redan syns i Fakturerat.
describe('uninvoicedAmount', () => {
  it('är hela nettot när inget fakturerats', () => {
    expect(uninvoicedAmount({ vat_percent: 25, amount: 62_500, invoice_rounds: [] })).toBe(50_000);
  });

  it('drar av rundorna som redan gått ut, ex moms mot ex moms', () => {
    expect(uninvoicedAmount({ vat_percent: 25, amount: 62_500, invoice_rounds: [{ amount: 30_000 }, { amount: '5000.50' }] })).toBe(14_999.5);
  });

  // PostgREST ger tom lista när RLS döljer rundorna; null ska aldrig komma, men får inte krascha.
  it('räknar hela nettot som kvar när rundorna saknas', () => {
    expect(uninvoicedAmount({ vat_percent: 0, amount: 50_000, invoice_rounds: null })).toBe(50_000);
  });

  // Rundorna avrundas till hela ören, nettot inte. En helt fakturerad order kan därför landa en
  // bråkdel av ett öre under noll, och ett lager ska då visa noll kvar.
  it('går aldrig under noll', () => {
    const net = { vat_percent: 0, amount: 1_000, pricing_summary: { subtotal: 999.996, total: 1_000 } };
    expect(uninvoicedAmount({ ...net, invoice_rounds: [{ amount: 1_000 }] })).toBe(0);
  });
});

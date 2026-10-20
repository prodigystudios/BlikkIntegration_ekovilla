import { describe, it, expect, vi, beforeEach } from 'vitest';

// Kundbyte på en arbetsorder som redan finns i Fortnox (crm/workOrderCustomerSwap.ts).
//
// 🧪 Mätt i testbolaget 2026-10-20 (ordrar 106–109): en PUT med bara nytt `CustomerNumber` byter numret
// men lämnar den GAMLA kundens namn, adress, org.nr, telefon, e-post och leveransadress — samma som på
// offerten (#325). Med kortets kunddel i samma PUT följer allt med, och fakturan ärver den nya kunden.

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

vi.mock('@/lib/domains/fortnox/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/client')>();
  return { ...actual, fortnoxGet: vi.fn(), fortnoxPost: vi.fn(), fortnoxPut: vi.fn() };
});

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxGet, fortnoxPost, fortnoxPut } from '@/lib/domains/fortnox/client';
import { orderCustomerFieldsFromCard, pushWorkOrderToFortnox, syncWorkOrderHeaderToFortnox, updateWorkOrderInFortnox } from '@/lib/domains/fortnox/orders';

// Testbolagets kund 2, som den såg ut i mätningen.
const cardB = {
  CustomerNumber: '2',
  Name: 'johansons bygg ab',
  Address1: 'byggvägen 32',
  ZipCode: '15160',
  City: 'södertälje',
  OrganisationNumber: '556103-4249',
  Phone1: '0843232421',
  Email: 'info@johansons.se',
  EmailOrder: '',
  EmailOrderCC: '',
  EmailOrderBCC: '',
  TermsOfPayment: '30',
  YourReference: 'Kortets referens',
  // Kortets eget leveransblock: lagret. Får aldrig blandas in under orderns arbetsplats.
  DeliveryName: 'Johansons lager',
  DeliveryAddress2: 'Port 3',
  DeliveryAddress1: 'Lagervägen 1',
  DeliveryZipCode: '15161',
  DeliveryCity: 'södertälje',
};

describe('orderCustomerFieldsFromCard', () => {
  it('ger kortets kunddel med Fortnox exakta fältnamn, som offerten', () => {
    expect(orderCustomerFieldsFromCard(cardB)).toMatchObject({
      CustomerName: 'johansons bygg ab',
      Address1: 'byggvägen 32',
      ZipCode: '15160',
      City: 'södertälje',
      OrganisationNumber: '556103-4249',
      Phone1: '0843232421',
      TermsOfPayment: '30',
    });
  });

  // Mätt (kund 7): en ny order fick kortets allmänna e-post när orderadressen var tom.
  it('e-posten: kortets orderadress, annars den allmänna', () => {
    expect(orderCustomerFieldsFromCard(cardB).EmailInformation).toEqual({ EmailAddressTo: 'info@johansons.se', EmailAddressCC: null, EmailAddressBCC: null });
    expect(orderCustomerFieldsFromCard({ ...cardB, EmailOrder: 'order@j.se', EmailOrderCC: 'cc@j.se', EmailOffer: 'offert@j.se' }).EmailInformation)
      .toEqual({ EmailAddressTo: 'order@j.se', EmailAddressCC: 'cc@j.se', EmailAddressBCC: null });
  });

  // `''` lämnar det gamla värdet kvar (mätt) — den förra kundens e-post hade stått kvar på ordern.
  it('ingen e-post på kortet rensar orderns', () => {
    expect(orderCustomerFieldsFromCard({ Name: 'x', Email: '', EmailOrder: '' }).EmailInformation.EmailAddressTo).toBeNull();
  });
});

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'lt', 'order', 'limit'] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => Promise.resolve(result).then(ok, err);
  return chain;
}

const workOrderRow = {
  id: 'wo-1',
  quote_id: 'quote-1',
  customer_id: 'cust-new',
  assigned_to: null,
  status: 'scheduled',
  customer_snapshot: { reverse_vat: false, your_reference: 'Anna Andersson', fortnox_customer_number: '2' },
  work_address: null,
  project_name: 'Vindsisolering',
  client_name: 'johansons bygg ab',
  vat_percent: 25,
  line_items: [{ id: 'line-a', pricing_mode: 'item', unit_price: '100', quantity: '10' }],
  fortnox_order_number: '20',
  fortnox_invoice_number: null,
  partial_invoicing_started_at: null,
  rot_details: null,
};

// Kundkorten svarar per id: den nya kunden (cust-new, Fortnox 2) och offertens gamla (cust-old, 7).
const cards: Record<string, Record<string, unknown>> = {
  'cust-new': { fortnox_customer_id: '2', customer_type: 'business', organization_number: '556103-4249', personal_number: null },
  'cust-old': { fortnox_customer_id: '7', customer_type: 'business', organization_number: '434567-0032', personal_number: null },
};

function mockDatabase(opts: { row?: Record<string, unknown>; offerNumber?: string | null } = {}) {
  const row: Record<string, unknown> = { ...workOrderRow, ...opts.row };
  const workOrders = makeChain({ data: [{ id: 'wo-1' }], error: null });
  let columns: string[] = Object.keys(row);
  workOrders.select = vi.fn((list: string) => {
    columns = list.split(',').map((c) => c.trim());
    return workOrders;
  });
  const asSelected = async () => ({ data: Object.fromEntries(columns.filter((c) => c in row).map((c) => [c, row[c]])), error: null });
  workOrders.single = vi.fn(asSelected);
  workOrders.maybeSingle = vi.fn(asSelected);

  const customers = makeChain({ data: null, error: null });
  let customerId = '';
  customers.eq = vi.fn((_col: string, value: string) => {
    customerId = value;
    return customers;
  });
  customers.maybeSingle = vi.fn(async () => ({ data: cards[customerId] ?? null, error: null }));

  const tables: Record<string, ReturnType<typeof makeChain>> = {
    crm_work_orders: workOrders,
    // Offerten står kvar på den GAMLA kunden — det är hela poängen.
    crm_quotes: makeChain({
      data: {
        fortnox_offer_number: opts.offerNumber === undefined ? '31' : opts.offerNumber,
        customer_id: 'cust-old',
        customer_source: null,
        assigned_to: null,
        customer_snapshot: { reverse_vat: false },
        rot_details: null,
      },
      error: null,
    }),
    crm_customers: customers,
  };
  vi.mocked(getSupabaseAdmin).mockReturnValue({
    from: vi.fn((table: string) => tables[table] ?? makeChain({ data: null, error: null })),
  } as unknown as ReturnType<typeof getSupabaseAdmin>);
}

// Vad Fortnox-ordern bär i dag.
function mockFortnoxOrderCustomer(customerNumber: string | null) {
  vi.mocked(fortnoxGet).mockImplementation(async (path: string) => {
    if (path === '/orders/20') return { Order: { CustomerNumber: customerNumber } } as never;
    if (path === '/customers/2') return { Customer: cardB } as never;
    throw new Error(`oväntat GET ${path}`);
  });
}

function orderPutBody(): Record<string, unknown> {
  const call = vi.mocked(fortnoxPut).mock.calls.find(([path]) => path === '/orders/20');
  expect(call, 'ingen PUT till /orders/20').toBeDefined();
  return (call![1] as { Order: Record<string, unknown> }).Order;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fortnoxPut).mockImplementation(async (path: string) =>
    (path.endsWith('/createorder') ? { Order: { DocumentNumber: 20 } } : {}) as never);
  vi.mocked(fortnoxPost).mockResolvedValue({ Order: { DocumentNumber: '22' } } as never);
});

describe('Fortnox-ordern byter kund', () => {
  it('"Synka om" skickar det nya kundnumret OCH den nya kundens kunddel', async () => {
    mockDatabase();
    mockFortnoxOrderCustomer('7');

    await updateWorkOrderInFortnox('wo-1', { recheckAfterPush: false });

    expect(orderPutBody()).toMatchObject({
      CustomerNumber: '2',
      CustomerName: 'johansons bygg ab',
      Address1: 'byggvägen 32',
      City: 'södertälje',
      Phone1: '0843232421',
      EmailInformation: { EmailAddressTo: 'info@johansons.se' },
    });
  });

  // Kunddelen ligger UNDER orderns egna fält: Er referens och org.nr är CRM:s, inte kortets.
  it('orderns egna fält vinner över kortets', async () => {
    mockDatabase();
    mockFortnoxOrderCustomer('7');

    await updateWorkOrderInFortnox('wo-1', { recheckAfterPush: false });

    expect(orderPutBody().YourReference).toBe('Anna Andersson');
    expect(orderPutBody().OrganisationNumber).toBe('556103-4249');
  });

  // Egen arbetsplats: hela leveransblocket är orderns, aldrig kortets lagergata under orderns ort.
  it('egen arbetsplats: kortets leveransfält skickas som null under orderns', async () => {
    mockDatabase({ row: { work_address: { street_address: 'Byggplatsen 9', postal_code: '11122', city: 'Stockholm' } } });
    mockFortnoxOrderCustomer('7');

    await updateWorkOrderInFortnox('wo-1', { recheckAfterPush: false });

    expect(orderPutBody()).toMatchObject({ DeliveryAddress1: 'Byggplatsen 9', DeliveryZipCode: '11122', DeliveryCity: 'Stockholm', DeliveryName: null, DeliveryAddress2: null });
  });

  it('samma kundnummer i Fortnox: ingen kunddel och inget kortuppslag', async () => {
    mockDatabase();
    mockFortnoxOrderCustomer('2');

    await updateWorkOrderInFortnox('wo-1', { recheckAfterPush: false });

    expect(orderPutBody()).not.toHaveProperty('CustomerNumber');
    expect(orderPutBody()).not.toHaveProperty('CustomerName');
    expect(fortnoxGet).not.toHaveBeenCalledWith('/customers/2');
  });

  // En order som aldrig bytt kund kostar inget extra anrop och kan inte byta kund av sig själv.
  it('utan förväntat kundnummer frågas Fortnox inte alls', async () => {
    mockDatabase({ row: { customer_snapshot: { reverse_vat: false, your_reference: 'Anna Andersson' } } });
    mockFortnoxOrderCustomer('7');

    await updateWorkOrderInFortnox('wo-1', { recheckAfterPush: false });

    expect(fortnoxGet).not.toHaveBeenCalled();
    expect(orderPutBody()).not.toHaveProperty('CustomerNumber');
  });

  // Hellre 'failed' än en order som tyst bär fel kund.
  it('ett svar utan kundnummer fäller pushen', async () => {
    mockDatabase();
    mockFortnoxOrderCustomer(null);

    await expect(updateWorkOrderInFortnox('wo-1', { recheckAfterPush: false })).rejects.toThrow(/utan kundnummer/);
    expect(vi.mocked(fortnoxPut).mock.calls.some(([path]) => path === '/orders/20')).toBe(false);
  });

  // Header-synken skickar kortets org.nr ur CRM. Efter ett byte vars fulla push misslyckats hade den
  // annars lagt den nya kundens nummer på en order som fortfarande bär den gamla kunden.
  it('header-synken byter också kund', async () => {
    mockDatabase();
    mockFortnoxOrderCustomer('7');

    await syncWorkOrderHeaderToFortnox('wo-1');

    expect(orderPutBody()).toMatchObject({ CustomerNumber: '2', CustomerName: 'johansons bygg ab', OrganisationNumber: '556103-4249' });
  });

  // Ordern skapas ur offerten, som står kvar på den GAMLA kunden — createorder ger alltså den gamla.
  it('createorder ur den gamla kundens offert: ordern byter till den nya direkt efteråt', async () => {
    mockDatabase({ row: { fortnox_order_number: null } });
    mockFortnoxOrderCustomer('7');

    await pushWorkOrderToFortnox('wo-1');

    expect(fortnoxPut).toHaveBeenCalledWith('/offers/31/createorder');
    expect(orderPutBody()).toMatchObject({ CustomerNumber: '2', CustomerName: 'johansons bygg ab' });
  });

  it('fristående skapande: orderns kund, inte offertens', async () => {
    mockDatabase({ row: { fortnox_order_number: null }, offerNumber: null });
    mockFortnoxOrderCustomer('2');

    await pushWorkOrderToFortnox('wo-1');

    const [path, body] = vi.mocked(fortnoxPost).mock.calls[0];
    expect(path).toBe('/orders');
    expect((body as { Order: Record<string, unknown> }).Order.CustomerNumber).toBe('2');
  });
});

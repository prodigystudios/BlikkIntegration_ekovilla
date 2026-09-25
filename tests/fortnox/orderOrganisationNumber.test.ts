import { describe, it, expect, vi, beforeEach } from 'vitest';

// Kundens nummer på Fortnox-ORDERN.
//
// 🧨 Felet: Fortnox kopierar kunduppgifterna in i dokumentet när det skapas, och `createorder`
// kopierar dem ur OFFERTEN. En offert som skapades innan kunden hade sitt personnummer/org.nr gav
// därför en order med tomt `OrganisationNumber` — fast numret sedan lagts in på kundkortet och
// synkats till Fortnox-kunden. Fakturan ärver ordern. Reproducerat i testbolaget 2026-09-25
// (kund 17 med numret, offert 31 och order 20 utan).

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

vi.mock('@/lib/domains/fortnox/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/client')>();
  return { ...actual, fortnoxGet: vi.fn(), fortnoxPost: vi.fn(), fortnoxPut: vi.fn() };
});

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxPut } from '@/lib/domains/fortnox/client';
import { documentOrganisationNumber, resolveDocumentOrganisationNumber } from '@/lib/domains/fortnox/helpers';
import { pushWorkOrderToFortnox } from '@/lib/domains/fortnox/orders';

describe('documentOrganisationNumber', () => {
  it('ger personnumret för en privatkund', () => {
    expect(documentOrganisationNumber({ customer_type: 'private', personal_number: '19121212-1212' })).toBe('19121212-1212');
  });

  it('ger org.nr för en företagskund', () => {
    expect(documentOrganisationNumber({ customer_type: 'business', organization_number: '559999-9991' })).toBe('559999-9991');
  });

  // Samma val som buildFortnoxCustomerPayload — dokumentet ska bära det Fortnox-kunden bär.
  it('väljer kolumn efter kundtypen, inte efter vilken som råkar vara ifylld', () => {
    const both = { organization_number: '559999-9991', personal_number: '19121212-1212' };
    expect(documentOrganisationNumber({ ...both, customer_type: 'private' })).toBe('19121212-1212');
    expect(documentOrganisationNumber({ ...both, customer_type: 'business' })).toBe('559999-9991');
    expect(documentOrganisationNumber({ customer_type: 'private', organization_number: '559999-9991' })).toBeNull();
  });

  // ⚠️ Ett ogiltigt nummer UTELÄMNAS. Skickat kunde det göra en PUT som i dag går igenom till en
  // som avvisas — ordern på 'failed' och faktureringen spärrad.
  it('utelämnar platshållare och tiosiffriga personnummer', () => {
    expect(documentOrganisationNumber({ customer_type: 'private', personal_number: '11111' })).toBeNull();
    expect(documentOrganisationNumber({ customer_type: 'private', personal_number: '121212-1212' })).toBeNull();
  });

  it('utelämnar ett org.nr som inte klarar kontrollsiffran', () => {
    expect(documentOrganisationNumber({ customer_type: 'business', organization_number: '556000-0000' })).toBeNull();
  });

  it('utelämnar tomt, blanksteg och saknat kort', () => {
    expect(documentOrganisationNumber({ customer_type: 'private', personal_number: '   ' })).toBeNull();
    expect(documentOrganisationNumber({ customer_type: 'business', organization_number: null })).toBeNull();
    expect(documentOrganisationNumber(null)).toBeNull();
  });

  it('trimmar värdet', () => {
    expect(documentOrganisationNumber({ customer_type: 'private', personal_number: ' 19121212-1212 ' })).toBe('19121212-1212');
  });
});

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

describe('resolveDocumentOrganisationNumber', () => {
  it('frågar inte databasen utan kund', async () => {
    const from = vi.fn();
    const supabase = { from } as unknown as ReturnType<typeof getSupabaseAdmin>;
    expect(await resolveDocumentOrganisationNumber(supabase, null)).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  // Ett läsfel får inte fälla pushen — fältet utelämnas och Fortnox behåller sitt.
  it('ger null vid läsfel', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const supabase = {
      from: vi.fn(() => makeChain({ data: null, error: { message: 'timeout' } })),
    } as unknown as ReturnType<typeof getSupabaseAdmin>;
    expect(await resolveDocumentOrganisationNumber(supabase, 'cust-1')).toBeNull();
  });
});

describe('pushWorkOrderToFortnox — ordern skapad ur en offert', () => {
  const workOrderRow = {
    id: 'wo-1',
    quote_id: 'quote-1',
    customer_id: 'cust-1',
    assigned_to: null,
    customer_snapshot: { reverse_vat: false },
    work_address: null,
    project_name: 'Vindsisolering',
    client_name: 'Tolvan Tolvansson',
    amount: 1000,
    vat_percent: 25,
    currency_code: 'SEK',
    line_items: [{ id: 'line-a', pricing_mode: 'item', unit_price: '100', quantity: '10' }],
    fortnox_order_number: null,
    rot_details: null,
  };

  function mockDatabase(card: Record<string, unknown>) {
    const workOrders = makeChain({ data: [{ id: 'wo-1' }], error: null });
    workOrders.single = vi.fn().mockResolvedValue({ data: workOrderRow, error: null });
    workOrders.maybeSingle = vi.fn().mockResolvedValue({ data: workOrderRow, error: null });
    const tables: Record<string, ReturnType<typeof makeChain>> = {
      crm_work_orders: workOrders,
      // Offerten HAR ett Fortnox-nummer → createorder-grenen, där felet satt.
      crm_quotes: makeChain({
        data: {
          fortnox_offer_number: '31',
          customer_id: 'cust-1',
          customer_source: null,
          assigned_to: null,
          customer_snapshot: { reverse_vat: false },
          rot_details: null,
        },
        error: null,
      }),
      crm_customers: makeChain({ data: card, error: null }),
    };
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: vi.fn((table: string) => tables[table] ?? makeChain({ data: null, error: null })),
    } as unknown as ReturnType<typeof getSupabaseAdmin>);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fortnoxPut).mockImplementation(async (path: string) =>
      (path.endsWith('/createorder') ? { Order: { DocumentNumber: 20 } } : {}) as never);
  });

  function orderPutBody(): Record<string, unknown> {
    const call = vi.mocked(fortnoxPut).mock.calls.find(([path]) => path === '/orders/20');
    expect(call, 'ingen PUT till /orders/20').toBeDefined();
    return (call![1] as { Order: Record<string, unknown> }).Order;
  }

  it('skickar kundkortets personnummer på ordern efter konverteringen', async () => {
    mockDatabase({ customer_type: 'private', personal_number: '19121212-1212', organization_number: null });

    await pushWorkOrderToFortnox('wo-1');

    expect(fortnoxPut).toHaveBeenCalledWith('/offers/31/createorder');
    // Exakt fältnamn — Fortnox stavar det brittiskt, och ett felstavat fält avvisas med 2001399.
    expect(orderPutBody().OrganisationNumber).toBe('19121212-1212');
  });

  it('skickar kundkortets org.nr för en företagskund', async () => {
    mockDatabase({ customer_type: 'business', organization_number: '559999-9991', personal_number: null });

    await pushWorkOrderToFortnox('wo-1');

    expect(orderPutBody().OrganisationNumber).toBe('559999-9991');
  });

  it('utelämnar fältet helt när kortets nummer är ogiltigt', async () => {
    mockDatabase({ customer_type: 'private', personal_number: '11111', organization_number: null });

    await pushWorkOrderToFortnox('wo-1');

    expect(orderPutBody()).not.toHaveProperty('OrganisationNumber');
  });
});

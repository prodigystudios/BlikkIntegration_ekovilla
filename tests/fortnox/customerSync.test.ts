import { describe, it, expect, vi, beforeEach } from 'vitest';

// Massynken och kortpasset mot en låtsasdatabas som spelar in varje insert/update. Mappningarna har egna tester i
// customers.test.ts; det här prövar att RÄTT rad skrivs på rätt väg — det var där felet satt: listan lästes som ett kort.

const fortnoxGet = vi.fn();
vi.mock('@/lib/domains/fortnox/client', () => ({
  fortnoxGet: (...args: unknown[]) => fortnoxGet(...args),
  fortnoxPost: vi.fn(),
  fortnoxPut: vi.fn(),
}));

type Op = {
  kind: 'select' | 'insert' | 'update';
  payload: any;
  options?: { count?: string; head?: boolean };
  filters: Array<[string, string, unknown]>;
};
let ops: Op[] = [];
let answerSelect: (op: Op) => { data?: unknown; count?: number; error: null };

function builder(op: Op) {
  ops.push(op);
  const chain: any = {
    eq: (column: string, value: unknown) => { op.filters.push(['eq', column, value]); return chain; },
    in: (column: string, value: unknown) => { op.filters.push(['in', column, value]); return chain; },
    not: (column: string, _operator: string, value: unknown) => { op.filters.push(['not', column, value]); return chain; },
    order: () => chain,
    limit: () => chain,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(op.kind === 'select' ? answerSelect(op) : { error: null }).then(resolve, reject),
  };
  return chain;
}

const supabase = {
  from: () => ({
    select: (columns: string, options?: Op['options']) => builder({ kind: 'select', payload: columns, options, filters: [] }),
    insert: (rows: unknown) => builder({ kind: 'insert', payload: rows, filters: [] }),
    update: (row: unknown) => builder({ kind: 'update', payload: row, filters: [] }),
  }),
};
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => supabase }));

import { syncFortnoxCustomers, verifyCustomerTypesBatch } from '@/lib/domains/fortnox/customers';

// Testbolagets kund 20 (e-posten utbytt): listraden och kortet som Fortnox faktiskt svarade 2026-10-21.
const LISTED_20 = {
  CustomerNumber: '20', Name: 'Testa Inbjudan', OrganisationNumber: '556000-0001', Email: 'kund@example.test',
  Phone: '0812345233', Address1: 'testbutiksvägen 14', Address2: null, ZipCode: '15123', City: 'södertest',
};
const CARD_20 = {
  CustomerNumber: '20', Name: 'Testa Inbjudan', OrganisationNumber: '556000-0001', Email: 'kund@example.test',
  Phone1: '0812345233', Phone2: null, Type: 'COMPANY', Active: true,
  Address1: 'testbutiksvägen 14', Address2: null, ZipCode: '15123', City: 'södertest',
  VisitingAddress: 'testbutiksvägen 14', VisitingZipCode: '15123', VisitingCity: 'södertest',
  DeliveryAddress1: null, DeliveryZipCode: null, DeliveryCity: null,
  EmailInvoice: 'faktura@example.test', TermsOfPayment: '', PriceList: '160', InvoiceDiscount: null,
  VATNumber: '', VATType: 'SEREVERSEDVAT',
};

const updates = () => ops.filter((op) => op.kind === 'update');
const inserts = () => ops.filter((op) => op.kind === 'insert');

beforeEach(() => {
  ops = [];
  fortnoxGet.mockReset();
});

describe('syncFortnoxCustomers', () => {
  // 🧨 Före 2026-10-21 skrev omsynken reverse_vat=false och null på varje kortfält för samtliga kunder, eftersom
  // listan saknar fälten. Kortpasset rättade nya kunder — men besökte aldrig en redan verifierad kund igen.
  it('rör inga kortfält på en kund vi redan har', async () => {
    fortnoxGet.mockResolvedValueOnce({ Customers: [LISTED_20], MetaInformation: { '@TotalPages': 1 } });
    answerSelect = () => ({
      data: [{ id: 'u20', fortnox_customer_id: '20', customer_type: 'business', customer_type_verified: true }],
      error: null,
    });

    await syncFortnoxCustomers('admin-1');

    expect(updates()).toHaveLength(1);
    const [update] = updates();
    expect(update.filters).toContainEqual(['eq', 'fortnox_customer_id', '20']);
    for (const column of ['reverse_vat', 'payment_terms', 'price_list', 'discount', 'vat_number', 'invoice_email',
      'mobile', 'visit_address', 'delivery_address', 'customer_type_verified']) {
      expect(update.payload, column).not.toHaveProperty(column);
    }
    expect(update.payload.phone).toBe('0812345233');
    expect(update.payload.customer_type).toBe('business');
  });

  it('köar en ny kund för kortpasset, som fyller kortfälten', async () => {
    fortnoxGet.mockResolvedValueOnce({ Customers: [LISTED_20], MetaInformation: { '@TotalPages': 1 } });
    answerSelect = () => ({ data: [], error: null });

    await syncFortnoxCustomers('admin-1');

    expect(inserts()).toHaveLength(1);
    const [row] = inserts()[0].payload;
    expect(row.customer_type_verified).toBe(false);
    expect(row.fortnox_customer_id).toBe('20');
    expect(row).not.toHaveProperty('reverse_vat');
  });
});

describe('verifyCustomerTypesBatch (kortpasset)', () => {
  it('skriver kortets fält men lämnar vårt härledda momsnummer orört när kortet saknar ett', async () => {
    answerSelect = (op) => op.options?.count
      ? { count: 0, error: null }
      : { data: [{ id: 'u20', fortnox_customer_id: '20', customer_type: 'business' }], error: null };
    fortnoxGet.mockResolvedValueOnce({ Customer: CARD_20 });

    await verifyCustomerTypesBatch();

    expect(fortnoxGet).toHaveBeenCalledWith('/customers/20');
    expect(updates()).toHaveLength(1);
    const [update] = updates();
    expect(update.filters).toContainEqual(['eq', 'id', 'u20']);
    expect(update.payload.reverse_vat).toBe(true);
    expect(update.payload.price_list).toBe('160');
    expect(update.payload.invoice_email).toBe('faktura@example.test');
    expect(update.payload.payment_terms).toBeNull();
    expect(update.payload.customer_type_verified).toBe(true);
    // 🧨 Kortet svarar "" för de flesta kunders momsnummer. Skrevs tomheten hade kortpasset nollat varje nummer vi
    // härlett ur org.numret — och efter rättelsen ska passet köras över alla kunder.
    expect(update.payload).not.toHaveProperty('vat_number');
  });
});

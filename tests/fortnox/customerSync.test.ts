import { describe, it, expect, vi, beforeEach } from 'vitest';

// Massynken och kortpasset mot en låtsasdatabas som spelar in varje insert/update. Mappningarna har egna tester i
// customers.test.ts; det här prövar att RÄTT rad skrivs på rätt väg — det var där felet satt: listan lästes som ett kort
// — och vilka kunder synken köar för kortpasset.

const fortnoxGet = vi.fn();
vi.mock('@/lib/domains/fortnox/client', () => ({
  fortnoxGet: (...args: unknown[]) => fortnoxGet(...args),
  fortnoxPost: vi.fn(),
  fortnoxPut: vi.fn(),
}));

type Op = {
  table: string;
  kind: 'select' | 'insert' | 'update';
  payload: any;
  options?: { count?: string; head?: boolean };
  filters: Array<[string, string, unknown]>;
};
type Answer = { data?: unknown; count?: number; error: { message: string } | null };
let ops: Op[] = [];
let answerSelect: (op: Op) => Answer;
let answerWrite: (op: Op) => Answer;

function builder(op: Op) {
  ops.push(op);
  const chain: any = {
    eq: (column: string, value: unknown) => { op.filters.push(['eq', column, value]); return chain; },
    in: (column: string, value: unknown) => { op.filters.push(['in', column, value]); return chain; },
    not: (column: string, _operator: string, value: unknown) => { op.filters.push(['not', column, value]); return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => chain,
    // Svaret räknas fram när kedjan inväntas, så filtren finns på plats.
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve().then(() => (op.kind === 'select' ? answerSelect(op) : answerWrite(op))).then(resolve, reject),
  };
  return chain;
}

const supabase = {
  from: (table: string) => ({
    select: (columns: string, options?: Op['options']) => builder({ table, kind: 'select', payload: columns, options, filters: [] }),
    insert: (rows: unknown) => builder({ table, kind: 'insert', payload: rows, filters: [] }),
    update: (row: unknown) => builder({ table, kind: 'update', payload: row, filters: [] }),
  }),
};
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => supabase }));

import { syncFortnoxCustomers, verifyCustomerTypesBatch } from '@/lib/domains/fortnox/customers';

// Testbolagets kund 20 (e-posten utbytt): listraden och kortet som Fortnox faktiskt svarade 2026-10-21.
const LISTED_20 = {
  CustomerNumber: '20', Name: 'Testa Inbjudan', OrganisationNumber: '556000-0001', Email: 'kund@example.test',
  Phone: '0812345233', Address1: 'testbutiksvägen 14', Address2: null, ZipCode: '15123', City: 'södertest',
};
const LISTED_18 = {
  CustomerNumber: '18', Name: 'Testbolaget Bygg AB', OrganisationNumber: '559999-9991', Email: 'info@example.test',
  Phone: '08-000 00 01', Address1: 'Box 1', Address2: null, ZipCode: '111 11', City: 'Teststad',
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
const CARD_ONLY_COLUMNS = ['reverse_vat', 'payment_terms', 'price_list', 'discount', 'vat_number', 'invoice_email',
  'mobile', 'visit_address', 'delivery_address'];

const customerUpdates = () => ops.filter((op) => op.kind === 'update' && op.table === 'crm_customers');
const customerUpdate = (nr: string) => customerUpdates().find((op) => op.filters.some(([, col, v]) => col === 'fortnox_customer_id' && v === nr));
const inserts = () => ops.filter((op) => op.kind === 'insert');
const savedSyncTimes = () => ops.filter((op) => op.kind === 'update' && op.table === 'fortnox_integrations');

type Existing = { id: string; fortnox_customer_id: string; customer_type: string };

/**
 * En databas för massynken. `syncedAt` är förra synkens tidpunkt (null = okänd, 'error' = går inte att läsa);
 * `listed` är Fortnox lista och `changed` de kundnummer listan filtrerad på lastmodified svarar med.
 */
function arrange({ syncedAt, existing, listed, changed = [], failUpdateFor = [] }: {
  syncedAt: string | null | 'error';
  existing: Existing[];
  listed: object[];
  changed?: string[];
  failUpdateFor?: string[];
}) {
  answerSelect = (op) => {
    if (op.table === 'fortnox_integrations') {
      return syncedAt === 'error'
        ? { data: null, error: { message: 'column "customers_synced_at" does not exist' } }
        : { data: { customers_synced_at: syncedAt }, error: null };
    }
    if (op.options?.count) return { count: 7, error: null };
    return { data: existing, error: null };
  };
  answerWrite = (op) => {
    const nr = op.filters.find(([, col]) => col === 'fortnox_customer_id')?.[2];
    return failUpdateFor.includes(nr as string) ? { error: { message: 'boom' } } : { error: null };
  };
  fortnoxGet.mockImplementation(async (_path: string, params?: Record<string, string>) =>
    params?.lastmodified
      ? { Customers: listed.filter((c: any) => changed.includes(c.CustomerNumber)), MetaInformation: { '@TotalPages': 1 } }
      : { Customers: listed, MetaInformation: { '@TotalPages': 1 } });
}

const KNOWN_SYNC = '2026-10-20T10:00:00.000Z';
const BOTH = [
  { id: 'u18', fortnox_customer_id: '18', customer_type: 'business' },
  { id: 'u20', fortnox_customer_id: '20', customer_type: 'business' },
];

beforeEach(() => {
  ops = [];
  fortnoxGet.mockReset();
  // Varje test ställer upp sina egna svar; ett glömt svar ska fallera, inte ärva förra testets.
  answerSelect = () => { throw new Error('answerSelect inte uppställt för testet'); };
  answerWrite = () => ({ error: null });
});

describe('syncFortnoxCustomers', () => {
  // 🧨 Före 2026-10-21 skrev omsynken reverse_vat=false och null på varje kortfält för samtliga kunder, eftersom
  // listan saknar fälten. Kortpasset rättade nya kunder — men besökte aldrig en redan verifierad kund igen.
  it('rör inga kortfält på en kund vi redan har, och köar den inte när Fortnox inte ändrat den', async () => {
    arrange({ syncedAt: KNOWN_SYNC, existing: [BOTH[1]], listed: [LISTED_20] });

    await syncFortnoxCustomers('admin-1');

    const update = customerUpdate('20')!;
    for (const column of [...CARD_ONLY_COLUMNS, 'customer_type_verified']) {
      expect(update.payload, column).not.toHaveProperty(column);
    }
    expect(update.payload.phone).toBe('0812345233');
  });

  it('köar en ny kund för kortpasset, som fyller kortfälten', async () => {
    arrange({ syncedAt: KNOWN_SYNC, existing: [], listed: [LISTED_20] });

    const result = await syncFortnoxCustomers('admin-1');

    expect(inserts()).toHaveLength(1);
    const [row] = inserts()[0].payload;
    expect(row.customer_type_verified).toBe(false);
    expect(row).not.toHaveProperty('reverse_vat');
    expect(result.queued).toBe(1);
  });

  // Utan det här når en ändring av omvänd moms eller betalningsvillkor i Fortnox aldrig en kund vi redan har.
  it('köar bara de kunder Fortnox ändrat sedan förra synken', async () => {
    arrange({ syncedAt: KNOWN_SYNC, existing: BOTH, listed: [LISTED_18, LISTED_20], changed: ['20'] });

    const result = await syncFortnoxCustomers('admin-1');

    expect(customerUpdate('20')!.payload.customer_type_verified).toBe(false);
    expect(customerUpdate('18')!.payload).not.toHaveProperty('customer_type_verified');
    for (const column of CARD_ONLY_COLUMNS) expect(customerUpdate('20')!.payload, column).not.toHaveProperty(column);
    expect(result.queued).toBe(1);
    expect(result.pendingCards).toBe(7);
  });

  // Fortnox läser `lastmodified` som svensk tid. 10:00 UTC − två timmars marginal = 08:00 UTC = 10:00 svensk sommartid.
  it('frågar efter ändringar från förra synken minus marginalen, i svensk tid', async () => {
    arrange({ syncedAt: KNOWN_SYNC, existing: BOTH, listed: [LISTED_18, LISTED_20] });

    await syncFortnoxCustomers('admin-1');

    expect(fortnoxGet).toHaveBeenCalledWith('/customers', expect.objectContaining({ lastmodified: '2026-10-20 10:00' }));
  });

  // Första körningen efter rättelsen: tidpunkten finns inte, och alla 1 658 kunders kort behöver läsas om.
  it('köar alla kunder när förra synken är okänd — det är reparationen', async () => {
    arrange({ syncedAt: null, existing: BOTH, listed: [LISTED_18, LISTED_20] });

    const result = await syncFortnoxCustomers('admin-1');

    expect(customerUpdate('18')!.payload.customer_type_verified).toBe(false);
    expect(customerUpdate('20')!.payload.customer_type_verified).toBe(false);
    expect(fortnoxGet).not.toHaveBeenCalledWith('/customers', expect.objectContaining({ lastmodified: expect.anything() }));
    expect(result.queued).toBe(2);
  });

  // Koden före migreringen: kolumnen finns inte. Att köa alla kostar bara tid; att krascha hade stoppat synken.
  it('köar alla kunder när förra synkens tidpunkt inte går att läsa', async () => {
    arrange({ syncedAt: 'error', existing: BOTH, listed: [LISTED_18, LISTED_20] });

    await syncFortnoxCustomers('admin-1');

    expect(customerUpdate('18')!.payload.customer_type_verified).toBe(false);
    expect(customerUpdate('20')!.payload.customer_type_verified).toBe(false);
  });

  // Starttiden, inte sluttiden: en kund som ändras medan synken pågår ska med nästa gång.
  it('sparar synkens starttid som nästa tidpunkt', async () => {
    arrange({ syncedAt: KNOWN_SYNC, existing: BOTH, listed: [LISTED_18, LISTED_20] });
    // Klockan går medan listan hämtas — annars hade start och slut kunnat vara samma millisekund och testet tomt.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    const listFetch = fortnoxGet.getMockImplementation()!;
    fortnoxGet.mockImplementation(async (path: string, params?: Record<string, string>) => {
      vi.setSystemTime(new Date('2026-10-21T12:05:00Z'));
      return listFetch(path, params);
    });

    try {
      await syncFortnoxCustomers('admin-1');
    } finally {
      vi.useRealTimers();
    }

    expect(savedSyncTimes()).toHaveLength(1);
    const [saved] = savedSyncTimes();
    expect(saved.filters).toContainEqual(['eq', 'provider', 'fortnox']);
    expect(saved.payload.customers_synced_at).toBe('2026-10-21T12:00:00.000Z');
  });

  // Sparades tidpunkten ändå hade nästa synk börjat efter ändringen, och kunden hade aldrig köats.
  it('sparar inte tidpunkten när en köad kund inte gick att uppdatera', async () => {
    arrange({ syncedAt: KNOWN_SYNC, existing: BOTH, listed: [LISTED_18, LISTED_20], changed: ['20'], failUpdateFor: ['20'] });

    const result = await syncFortnoxCustomers('admin-1');

    expect(savedSyncTimes()).toHaveLength(0);
    expect(result.queued).toBe(0);
  });

  it('sparar tidpunkten när bara en oköad kunds uppdatering misslyckas', async () => {
    arrange({ syncedAt: KNOWN_SYNC, existing: BOTH, listed: [LISTED_18, LISTED_20], changed: ['20'], failUpdateFor: ['18'] });

    await syncFortnoxCustomers('admin-1');

    expect(savedSyncTimes()).toHaveLength(1);
  });

  // En köad kund är overifierad tills kortet lästs. Gissade omsynken typen igen då, hade ett personnummer som
  // org.nr (enskild firma) gjort en bekräftad företagskund till privatkund.
  it('behåller typen på en kund vi redan har, även medan den väntar på kortet', async () => {
    arrange({
      syncedAt: null,
      existing: [{ id: 'u20', fortnox_customer_id: '20', customer_type: 'business' }],
      listed: [{ ...LISTED_20, OrganisationNumber: '19121212-1212' }],
    });

    await syncFortnoxCustomers('admin-1');

    expect(customerUpdate('20')!.payload.customer_type).toBe('business');
    expect(customerUpdate('20')!.payload.company_name).toBe('Testa Inbjudan');
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
    expect(customerUpdates()).toHaveLength(1);
    const [update] = customerUpdates();
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

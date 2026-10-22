import { describe, it, expect, vi } from 'vitest';

// Modulen importerar getSupabaseAdmin på toppnivå. Den rörs inte här, men måste finnas för importen.
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => null }));

import { getWorkOrderCallContacts, getWorkOrderCustomerContact } from '@/lib/domains/crm/work-orders';

// Startsidans "Ring"-rad: kontakten för flera ordrar i ett svep. Det som prövas är att svaret är
// SAMMA PERSON som fältvyn visar för varje order (getWorkOrderCustomerContact), att bara namn och
// nummer följer med, och att en trasig kundläsning inte tar med sig kontakten på plats.

type Order = { id: string; customer_id: string | null; customer_snapshot: Record<string, unknown> | null };

function makeSupabase(orders: Order[], customers: Array<Record<string, unknown>>, opts: { customerError?: boolean } = {}) {
  const calls: Array<{ table: string; ids: string[] }> = [];
  const client = {
    from(table: string) {
      const builder: any = {
        select: vi.fn(() => builder),
        in: vi.fn((_col: string, ids: string[]) => {
          calls.push({ table, ids });
          if (table === 'crm_work_orders') return Promise.resolve({ data: orders.filter((o) => ids.includes(o.id)), error: null });
          if (table === 'crm_customers') {
            if (opts.customerError) return Promise.resolve({ data: null, error: { message: 'tillfälligt fel' } });
            return Promise.resolve({ data: customers.filter((c) => ids.includes(String(c.id))), error: null });
          }
          return Promise.resolve({ data: null, error: { message: `oväntat anrop: ${table}` } });
        }),
        // Envariantens läsningar, så samma klient kan jämföras mot fältvyns funktion.
        eq: vi.fn((_col: string, id: string) => {
          builder.__id = id;
          return builder;
        }),
        maybeSingle: vi.fn(() => {
          if (table === 'crm_work_orders') {
            const o = orders.find((x) => x.id === builder.__id);
            return Promise.resolve({ data: o ? { customer_id: o.customer_id, customer_snapshot: o.customer_snapshot } : null, error: null });
          }
          if (table === 'crm_customers') {
            if (opts.customerError) return Promise.resolve({ data: null, error: { message: 'tillfälligt fel' } });
            return Promise.resolve({ data: customers.find((c) => String(c.id) === builder.__id) ?? null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }),
      };
      return builder;
    },
  } as any;
  return { client, calls };
}

const ACME = {
  id: 'cust-acme',
  customer_type: 'business',
  email: 'robert@acme.se',
  phone: '08-000',
  mobile: null,
  contacts: [{ name: 'Anna', email: 'anna@acme.se', phone: '08-111', is_primary: true }],
};

const ORDERS: Order[] = [
  // Orderns egen kontaktperson — det normala fallet.
  { id: 'wo-own', customer_id: 'cust-acme', customer_snapshot: { contact_name: 'Björn', phone: '08-222', email: 'bjorn@acme.se' } },
  // Kontakt på plats, utan eget nummer.
  { id: 'wo-site', customer_id: 'cust-acme', customer_snapshot: { end_contact_name: 'Fastighetsskötaren', contact_name: 'Anna', phone: '08-111' } },
  // En äldre order som aldrig fick någon kontakt — kundkortet får svara.
  { id: 'wo-old', customer_id: 'cust-acme', customer_snapshot: {} },
];

describe('getWorkOrderCallContacts', () => {
  it('ger samma person och nummer som fältvyn, order för order', async () => {
    const { client } = makeSupabase(ORDERS, [ACME]);
    const { data, error } = await getWorkOrderCallContacts(client, ORDERS.map((o) => o.id));
    expect(error).toBeNull();
    for (const order of ORDERS) {
      const { data: fieldView } = await getWorkOrderCustomerContact(client, order.id);
      expect(data?.[order.id]).toEqual({
        contactName: fieldView?.contactName,
        phone: fieldView?.phone,
        isOnSiteContact: fieldView?.isOnSiteContact,
        phoneFromCustomer: fieldView?.phoneFromCustomer,
      });
    }
  });

  it('ringer orderns kontaktperson, inte kundkortets', async () => {
    const { client } = makeSupabase(ORDERS, [ACME]);
    const { data } = await getWorkOrderCallContacts(client, ['wo-own']);
    expect(data).toEqual({ 'wo-own': { contactName: 'Björn', phone: '08-222', isOnSiteContact: false, phoneFromCustomer: false } });
  });

  it('säger när kontakten på plats har lånat kundens nummer', async () => {
    const { client } = makeSupabase(ORDERS, [ACME]);
    const { data } = await getWorkOrderCallContacts(client, ['wo-site']);
    expect(data?.['wo-site']).toEqual({ contactName: 'Fastighetsskötaren', phone: '08-111', isOnSiteContact: true, phoneFromCustomer: true });
  });

  it('skickar aldrig e-post — det som inte visas ska inte heller ut', async () => {
    const { client } = makeSupabase(ORDERS, [ACME]);
    const { data } = await getWorkOrderCallContacts(client, ORDERS.map((o) => o.id));
    expect(JSON.stringify(data)).not.toContain('@');
  });

  it('utelämnar en order utan nummer att ringa', async () => {
    const noPhone = { id: 'wo-x', customer_id: null, customer_snapshot: { contact_name: 'Utan nummer', email: 'x@example.se' } };
    const { client } = makeSupabase([noPhone], []);
    const { data } = await getWorkOrderCallContacts(client, ['wo-x']);
    expect(data).toEqual({});
  });

  it('läser ordrarna och kunderna i ett svep var, inte en i taget', async () => {
    const { client, calls } = makeSupabase(ORDERS, [ACME]);
    await getWorkOrderCallContacts(client, ORDERS.map((o) => o.id));
    expect(calls.map((c) => c.table)).toEqual(['crm_work_orders', 'crm_customers']);
    // Tre ordrar hos samma kund ger ett kunduppslag.
    expect(calls[1].ids).toEqual(['cust-acme']);
  });

  it('en trasig kundläsning tar inte med sig kontakten på plats', async () => {
    const onSite = { id: 'wo-onsite', customer_id: 'cust-acme', customer_snapshot: { end_contact_name: 'Ulla', end_contact_phone: '070-333' } };
    const { client } = makeSupabase([...ORDERS, onSite], [ACME], { customerError: true });
    const { data, error } = await getWorkOrderCallContacts(client, [...ORDERS.map((o) => o.id), 'wo-onsite']);
    expect(error).toEqual({ message: 'tillfälligt fel' });
    // Kontakten på plats står på egna ben (wo-site lånar orderns eget nummer ur snapshoten, inget
    // kundkort behövs); de som behövde kundkortet uteblir hellre än gissas.
    expect(data).toEqual({
      'wo-site': { contactName: 'Fastighetsskötaren', phone: '08-111', isOnSiteContact: true, phoneFromCustomer: true },
      'wo-onsite': { contactName: 'Ulla', phone: '070-333', isOnSiteContact: true, phoneFromCustomer: false },
    });
    // Samma svar som fältvyn ger order för order när kundkortet inte går att läsa.
    for (const id of ['wo-own', 'wo-site', 'wo-old', 'wo-onsite']) {
      const { data: fieldView } = await getWorkOrderCustomerContact(client, id);
      expect(data?.[id]?.phone ?? null).toBe(fieldView?.phone ?? null);
    }
  });
});

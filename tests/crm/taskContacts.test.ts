import { describe, it, expect } from 'vitest';

import { attachCrmTaskContacts } from '@/lib/domains/crm/tasks';

// "Vem ska jag kontakta" på en uppgift. Uppslaget är batchat: en fråga mot crm_quotes för de
// offertkopplade uppgifterna, en mot crm_customers för kunderna (offerternas kunder inräknade).
//
// ⚠️ ORDERGIVAREN, inte slutkunden på plats. Uppgiftslistan är en säljyta, precis som offertens
// "Er referens" — fältvyns fråga är en annan och där vinner slutkunden.

const QUOTE_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';

const ACME = {
  id: CUSTOMER_ID,
  customer_type: 'business',
  email: 'info@acme.se',
  phone: '08-000',
  mobile: null,
  contacts: [
    { name: 'Anna', email: 'anna@acme.se', phone: '08-111', is_primary: true },
    { name: 'Björn', email: 'bjorn@acme.se', phone: '08-222', is_primary: false },
  ],
};

/**
 * Minsta möjliga PostgREST-attrapp: `.from(t).select(...).in('id', ids)` ger raderna vars id
 * efterfrågades. `calls` spelar in vilka tabeller som lästes, så batchningen går att pröva.
 */
function makeSupabase(
  tables: { crm_quotes?: any[]; crm_customers?: any[] },
  opts: { failOn?: string } = {},
) {
  const calls: Array<{ table: string; ids: string[] }> = [];
  const supabase = {
    from(table: string) {
      return {
        select: () => ({
          in: (_column: string, ids: string[]) => {
            calls.push({ table, ids });
            if (opts.failOn === table) return Promise.resolve({ data: null, error: { message: 'nekad' } });
            const rows = (tables[table as keyof typeof tables] ?? []).filter((r: any) => ids.includes(r.id));
            return Promise.resolve({ data: rows, error: null });
          },
        }),
      };
    },
  } as any;
  return { supabase, calls };
}

const quoteTask = (id = 't1', relatedId: string | null = QUOTE_ID) =>
  ({ id, related_type: 'crm_quote' as const, related_id: relatedId });
const customerTask = (id = 't2', relatedId: string | null = CUSTOMER_ID) =>
  ({ id, related_type: 'crm_customer' as const, related_id: relatedId });

describe('attachCrmTaskContacts', () => {
  it('offertkopplad uppgift får offertens Er referens', async () => {
    const { supabase } = makeSupabase({
      crm_quotes: [{ id: QUOTE_ID, customer_id: CUSTOMER_ID, customer_snapshot: { contact_name: 'Björn' } }],
      crm_customers: [ACME],
    });
    const [task] = await attachCrmTaskContacts(supabase, [quoteTask()]);
    // Björn, inte kortets primära Anna: offertens snapshot vinner.
    expect(task.contact).toEqual({ name: 'Björn', phone: '08-222', email: 'bjorn@acme.se' });
  });

  // 🧨 Kärnan i valet av funktion. Hade attachCrmTaskContacts använt resolveDocumentContact hade
  // uppgiften pekat på fastighetsskötaren medan offerten den hör till visar Björn.
  it('slutkunden på plats tränger INTE undan ordergivaren', async () => {
    const { supabase } = makeSupabase({
      crm_quotes: [{
        id: QUOTE_ID,
        customer_id: CUSTOMER_ID,
        customer_snapshot: { contact_name: 'Björn', end_contact_name: 'Fastighetsskötaren', end_contact_phone: '070-9' },
      }],
      crm_customers: [ACME],
    });
    const [task] = await attachCrmTaskContacts(supabase, [quoteTask()]);
    expect(task.contact).toMatchObject({ name: 'Björn', phone: '08-222' });
  });

  it('kundkopplad uppgift får kortets primärkontakt', async () => {
    const { supabase } = makeSupabase({ crm_customers: [ACME] });
    const [task] = await attachCrmTaskContacts(supabase, [customerTask()]);
    expect(task.contact).toEqual({ name: 'Anna', phone: '08-111', email: 'anna@acme.se' });
  });

  it('prospekt slås upp i samma tabell — prospekt och kund är samma rad', async () => {
    const { supabase, calls } = makeSupabase({ crm_customers: [ACME] });
    const [task] = await attachCrmTaskContacts(supabase, [
      { id: 't1', related_type: 'crm_prospect' as const, related_id: CUSTOMER_ID },
    ]);
    expect(task.contact).toMatchObject({ name: 'Anna' });
    expect(calls.map((c) => c.table)).toEqual(['crm_customers']);
  });

  it('uppgift utan koppling får null utan att fråga databasen', async () => {
    const { supabase, calls } = makeSupabase({});
    const [task] = await attachCrmTaskContacts(supabase, [
      { id: 't1', related_type: null, related_id: null },
    ]);
    expect(task.contact).toBeNull();
    expect(calls).toHaveLength(0);
  });

  // ⚠️ Grinden. Ser anroparen inte offerten (RLS) kommer den inte tillbaka ur frågan, och då ska
  // uppgiften svara null — inte falla tillbaka på något annat.
  it('en offert anroparen inte får se ger null', async () => {
    const { supabase } = makeSupabase({ crm_quotes: [], crm_customers: [ACME] });
    const [task] = await attachCrmTaskContacts(supabase, [quoteTask()]);
    expect(task.contact).toBeNull();
  });

  it('batchar — en fråga per tabell oavsett antal uppgifter', async () => {
    const { supabase, calls } = makeSupabase({
      crm_quotes: [{ id: QUOTE_ID, customer_id: CUSTOMER_ID, customer_snapshot: { contact_name: 'Björn' } }],
      crm_customers: [ACME, { ...ACME, id: OTHER_CUSTOMER_ID }],
    });
    await attachCrmTaskContacts(supabase, [
      quoteTask('t1'), quoteTask('t2'), customerTask('t3'), customerTask('t4', OTHER_CUSTOMER_ID),
    ]);
    expect(calls.map((c) => c.table)).toEqual(['crm_quotes', 'crm_customers']);
    // Offertens kund slås upp i SAMMA fråga som de direktkopplade kunderna.
    expect(calls[1].ids.sort()).toEqual([CUSTOMER_ID, OTHER_CUSTOMER_ID].sort());
  });

  // 🧨 related_id är en TEXT-kolumn. Ett skräpvärde mot en uuid-kolumn ger 400 från PostgREST, och
  // utan filtret hade EN trasig rad tömt hela listan på kontakter.
  it('ett related_id som inte är ett uuid frågas aldrig efter', async () => {
    const { supabase, calls } = makeSupabase({ crm_customers: [ACME] });
    const tasks = await attachCrmTaskContacts(supabase, [customerTask('t1', 'inte-ett-uuid'), customerTask('t2')]);
    expect(calls[0].ids).toEqual([CUSTOMER_ID]);
    expect(tasks[0].contact).toBeNull();
    expect(tasks[1].contact).toMatchObject({ name: 'Anna' });
  });

  // Best-effort: ett trasigt uppslag får inte fälla uppgiftslistan.
  it('ett fel ger null-kontakter, inte ett kastat fel', async () => {
    const { supabase } = makeSupabase({ crm_customers: [ACME] }, { failOn: 'crm_customers' });
    const tasks = await attachCrmTaskContacts(supabase, [customerTask()]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].contact).toBeNull();
  });

  it('en kund utan kontaktuppgifter alls ger null i stället för tomma fält', async () => {
    const { supabase } = makeSupabase({
      crm_customers: [{ id: CUSTOMER_ID, customer_type: 'business', email: null, phone: null, mobile: null, contacts: [] }],
    });
    const [task] = await attachCrmTaskContacts(supabase, [customerTask()]);
    expect(task.contact).toBeNull();
  });

  it('bevarar uppgiftens övriga fält', async () => {
    const { supabase } = makeSupabase({ crm_customers: [ACME] });
    const [task] = await attachCrmTaskContacts(supabase, [{ ...customerTask(), title: 'Ring kunden' } as any]);
    expect(task).toMatchObject({ id: 't2', title: 'Ring kunden' });
  });
});

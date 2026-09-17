import { describe, it, expect } from 'vitest';
import { canSessionReadWorkOrder, narrowLookupRow, sanitizeOrFilterTerm, searchWorkOrdersForTimeReport } from '@/lib/domains/crm/work-orders';

// The egenkontroll's order lookup (/api/crm/work-orders/lookup) reads under the SERVICE ROLE, so
// nothing but these two functions stands between a whole work order and any signed-in account.

describe('narrowLookupRow', () => {
  const row = () => ({
    id: 'wo-1',
    order_number: 'AO-20260810-A1B2',
    customer_snapshot: { street_address: 'Kontoret 9', personal_number: '19850101-1234', phone: '070-1234567' },
    internal_handoff: { work_scope: 'Vind', handoff_notes: 'Portkod – 1234', future_secret: 'nej' },
    line_items: [{ article_name: 'Ekovilla', m2: '120', unit_price: '450' }],
  });

  it('keeps the arbetsbeskrivning — the egenkontroll card has nothing to show without it', () => {
    // Guards the allowlist from being tightened past the one field the card exists to show.
    expect(narrowLookupRow(row()).internal_handoff).toEqual({ work_scope: 'Vind', handoff_notes: 'Portkod – 1234' });
  });

  it('drops every other handoff key, including ones added later', () => {
    expect(narrowLookupRow(row()).internal_handoff).not.toHaveProperty('future_secret');
  });

  it('tolerates an order without a handoff at all', () => {
    expect(narrowLookupRow({ ...row(), internal_handoff: null }).internal_handoff).toEqual({ work_scope: null, handoff_notes: null });
  });

  it('still narrows the customer snapshot and the line items', () => {
    const narrowed = narrowLookupRow(row()) as { customer_snapshot: Record<string, unknown>; line_items: Record<string, unknown>[] };
    expect(narrowed.customer_snapshot).not.toHaveProperty('personal_number');
    expect(narrowed.customer_snapshot).not.toHaveProperty('phone');
    expect(narrowed.line_items[0]).not.toHaveProperty('unit_price');
  });
});

describe('searchWorkOrdersForTimeReport', () => {
  // Sökningen bakom tidrapportens jobbväljare. Den körs med SESSIONSKLIENTEN, så urvalet är RLS:
  // installatören når sina egna jobb. Det som prövas här är frågan den ställer.
  const spy = () => {
    const calls: Record<string, any> = { order: [] as Array<[string, unknown]>, neq: [] as Array<[string, unknown]> };
    const chain: any = {
      or: (filter: string) => { calls.or = filter; return chain; },
      neq: (column: string, value: unknown) => { calls.neq.push([column, value]); return chain; },
      order: (column: string, options: unknown) => { calls.order.push([column, options]); return chain; },
      limit: async (n: number) => { calls.limit = n; return { data: [{ id: 'wo-1' }], error: null }; },
    };
    const client = {
      from: (table: string) => { calls.table = table; return { select: (columns: string) => { calls.select = columns; return chain; } }; },
    } as never;
    return { client, calls };
  };

  it('söker på ordernumret, Fortnox-numret, projektet och kunden', async () => {
    const { client, calls } = spy();
    await searchWorkOrdersForTimeReport(client, '6579');
    expect(calls.table).toBe('crm_work_orders');
    for (const column of ['order_number', 'fortnox_order_number', 'project_name', 'client_name']) {
      expect(calls.or).toContain(`${column}.ilike.%6579%`);
    }
  });

  it('🧨 städar bort komma och parenteser — annars svarar PostgREST 400 på ett kundnamn', async () => {
    // "Ekbergs Bygg, AB" delar `or=(...)` mitt itu, och väljaren visar det som "ingen träff".
    const { client, calls } = spy();
    await searchWorkOrdersForTimeReport(client, 'Ekbergs Bygg, AB (Syd)');
    expect(calls.or).toContain('client_name.ilike.%Ekbergs Bygg  AB  Syd%');
    // Inga parenteser eller kommatecken ur termen får nå filtret — bara de som skiljer villkoren åt.
    expect(calls.or).not.toContain('(');
    expect(calls.or.split(',')).toHaveLength(4);
  });

  it('🧨 utesluter avbokade ordrar — timmar på ett inställt jobb når efterkalkylen', async () => {
    // Dagens lista kan aldrig erbjuda en avbokad order (get_my_crm_jobs filtrerar bort dem), och
    // insert-policyn på tidraden frågar inget om status. Spärren finns bara här.
    const { client, calls } = spy();
    await searchWorkOrdersForTimeReport(client, 'Villa');
    expect(calls.neq).toContainEqual(['status', 'cancelled']);
  });

  it('sorterar med ett andra nyckelvärde så två identiska sökningar ger samma åtta', async () => {
    const { client, calls } = spy();
    await searchWorkOrdersForTimeReport(client, 'Villa');
    expect(calls.order.map(([column]: [string, unknown]) => column)).toEqual(['desired_installation_date', 'created_at']);
  });

  it('frågar inte alls på en tom term', async () => {
    const { client, calls } = spy();
    const result = await searchWorkOrdersForTimeReport(client, '   ');
    expect(calls.table).toBeUndefined();
    expect(result.data).toEqual([]);
  });

  it('⚠️ hämtar BARA de fyra fälten väljaren ritar — raden bär personnummer', async () => {
    // customer_snapshot och rot_details bär personnummer (se redactWorkOrderForField). Fältytor
    // får aldrig hämta hela raden och rensa i klienten.
    const { client, calls } = spy();
    await searchWorkOrdersForTimeReport(client, 'Villa');
    expect(calls.select).toBe('id, order_number, fortnox_order_number, project_name, client_name');
    expect(calls.select).not.toContain('customer_snapshot');
    expect(calls.select).not.toContain('rot_details');
    expect(calls.limit).toBe(8);
  });
});

describe('sanitizeOrFilterTerm', () => {
  it('ersätter komma och parenteser med mellanslag och trimmar', () => {
    expect(sanitizeOrFilterTerm(' Ekbergs, AB ')).toBe('Ekbergs  AB');
    expect(sanitizeOrFilterTerm('x,status.eq.invoiced')).toBe('x status.eq.invoiced');
    expect(sanitizeOrFilterTerm(' , ')).toBe('');
  });
});

describe('canSessionReadWorkOrder', () => {
  // Minimal stand-in for the session client: the answer is whatever RLS would have let through.
  const client = (result: { data: unknown; error: unknown }) =>
    ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => result }),
        }),
      }),
    }) as never;

  it('is true when RLS returns the row', async () => {
    expect(await canSessionReadWorkOrder(client({ data: { id: 'wo-1' }, error: null }), 'wo-1')).toBe(true);
  });

  it('is false when RLS filters the row away — no row, no error, which is how RLS says no', async () => {
    expect(await canSessionReadWorkOrder(client({ data: null, error: null }), 'wo-1')).toBe(false);
  });

  it('fails closed on an error', async () => {
    expect(await canSessionReadWorkOrder(client({ data: { id: 'wo-1' }, error: { message: 'boom' } }), 'wo-1')).toBe(false);
  });
});

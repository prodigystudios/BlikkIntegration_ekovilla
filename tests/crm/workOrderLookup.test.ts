import { describe, it, expect } from 'vitest';
import { canSessionReadWorkOrder, narrowLookupRow } from '@/lib/domains/crm/work-orders';

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

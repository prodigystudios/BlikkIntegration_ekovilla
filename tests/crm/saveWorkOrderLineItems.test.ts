import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

import { saveWorkOrderLineItems } from '@/lib/domains/crm/work-orders';

// Spärren i DOMÄNEN, inte bara i editorn: en gammal flik eller ett direkt API-anrop ska inte kunna
// spara en rad utan pris eller mängd. Förut sparades den och först Fortnox-pushen sa 409 — med
// ordern stämplad 'failed' och faktureringen spärrad.

function fakeSupabase(workOrder: Record<string, unknown>) {
  const update = vi.fn();
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order']) c[m] = vi.fn(() => c);
    c.maybeSingle = vi.fn(async () => result);
    c.single = vi.fn(async () => result);
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
    return c;
  };
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'crm_work_order_invoices') return chain({ data: [], error: null });
      const c = chain({ data: workOrder, error: null });
      c.update = vi.fn((payload: unknown) => { update(payload); return c; });
      return c;
    }),
  };
  return { client: client as never, update };
}

const order = {
  id: 'wo-1', status: 'in_progress', vat_percent: 25, quote_type: 'business', rot_details: {},
  line_items: [], partial_invoicing_started_at: null, fortnox_invoice_number: null,
};

describe('saveWorkOrderLineItems — spärren före skrivningen', () => {
  it('nekar en rad utan pris och skriver ingenting', async () => {
    const { client, update } = fakeSupabase(order);

    const result = await saveWorkOrderLineItems(client, 'wo-1', [
      { id: 'a', article_name: 'Frakt', pricing_mode: 'item', quantity: '1', unit_price: '' },
    ]);

    expect(result.reason).toBe('invalid_rows');
    expect(String(result.error?.message)).toContain('pris saknas');
    expect(update).not.toHaveBeenCalled();
  });

  it('nekar en rad utan mängd', async () => {
    const { client, update } = fakeSupabase(order);

    const result = await saveWorkOrderLineItems(client, 'wo-1', [
      { id: 'a', article_name: 'Lösull', pricing_mode: 'm3', m2: '', thickness_mm: '', unit_price: '700' },
    ]);

    expect(result.reason).toBe('invalid_rows');
    expect(update).not.toHaveBeenCalled();
  });

  // ROT-spärren gäller bara när ORDERN har ROT påslaget — samma villkor som prissättningen.
  it('prövar arbetskostnaden bara på en ROT-order', async () => {
    const row = { id: 'a', article_name: 'Lösull', pricing_mode: 'item', quantity: '1', unit_price: '700', labor_cost: '700' };

    const off = fakeSupabase({ ...order, quote_type: 'private', rot_details: { enabled: false } });
    expect((await saveWorkOrderLineItems(off.client, 'wo-1', [row])).reason).toBeNull();

    const on = fakeSupabase({ ...order, quote_type: 'private', rot_details: { enabled: true } });
    const result = await saveWorkOrderLineItems(on.client, 'wo-1', [row]);
    expect(result.reason).toBe('invalid_rows');
    expect(on.update).not.toHaveBeenCalled();
  });

  it('sparar prissatta rader som vanligt', async () => {
    const { client, update } = fakeSupabase(order);

    const result = await saveWorkOrderLineItems(client, 'wo-1', [
      { id: 'a', article_name: 'Frakt', pricing_mode: 'item', quantity: '1', unit_price: '0' },
    ]);

    expect(result.reason).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });
});

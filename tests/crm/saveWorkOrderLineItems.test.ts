import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

import { saveWorkOrderLineItems } from '@/lib/domains/crm/work-orders';

// Spärren i DOMÄNEN, inte bara i editorn: en gammal flik eller ett direkt API-anrop ska inte kunna
// spara en rad utan pris eller mängd. Förut sparades den och först Fortnox-pushen sa 409 — med
// ordern stämplad 'failed' och faktureringen spärrad.

function fakeSupabase(workOrder: Record<string, unknown>, rounds: unknown[] = []) {
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
      if (table === 'crm_work_order_invoices') return chain({ data: rounds, error: null });
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

  // Antal 0 = inget levererades. Det är hur en delfakturerad order stängs, och servern får inte neka det.
  it('sparar en rad med antal 0', async () => {
    const { client, update } = fakeSupabase(order);

    const result = await saveWorkOrderLineItems(client, 'wo-1', [
      { id: 'a', article_name: 'Brandmatta', pricing_mode: 'item', quantity: '0', unit_price: '90' },
    ]);

    expect(result.reason).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });

  // 🧨 En gammal rad utan pris får inte låsa en sparning som rör en ANNAN rad.
  it('låter en orörd gammal rad utan pris ligga kvar', async () => {
    const legacy = { id: 'old', article_name: 'Frakt', pricing_mode: 'item', quantity: '1', unit_price: '' };
    const { client, update } = fakeSupabase({ ...order, line_items: [legacy] });

    const result = await saveWorkOrderLineItems(client, 'wo-1', [
      legacy,
      { id: 'new', article_name: 'Lösull', pricing_mode: 'item', quantity: '2', unit_price: '700' },
    ]);

    expect(result.reason).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });

  // 🧨 En FAKTURERAD rad utan pris (äldre data) måste kunna sänkas till det fakturerade — annars kan
  // ordern aldrig stängas. Priset går inte att ändra (validateLineItemEdit), så spärren hade låst den.
  it('låter antalet sänkas på en fakturerad rad utan pris', async () => {
    const invoiced = { id: 'inv', article_name: 'Frakt', pricing_mode: 'item', quantity: '5', unit_price: '' };
    const { client, update } = fakeSupabase(
      { ...order, line_items: [invoiced], partial_invoicing_started_at: '2026-09-01T00:00:00Z' },
      [{ line_quantities: [{ line_id: 'inv', index: 0, quantity: 3 }] }],
    );

    const result = await saveWorkOrderLineItems(client, 'wo-1', [{ ...invoiced, quantity: '3' }]);

    expect(result.reason).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });

  // 🧨 Rundor utan kolumn (createPartialInvoice skriver kolumnen EFTER rundan, utan felkontroll):
  // låset måste gälla ändå, annars kan en fakturerad rads pris nollas — prisspärren hoppar över den.
  it('låser fakturerade rader så fort rundor finns, även utan partial_invoicing_started_at', async () => {
    const invoiced = { id: 'inv', article_name: 'Frakt', pricing_mode: 'item', quantity: '5', unit_price: '500' };
    const { client, update } = fakeSupabase(
      { ...order, line_items: [invoiced], partial_invoicing_started_at: null },
      [{ line_quantities: [{ line_id: 'inv', index: 0, quantity: 3 }] }],
    );

    const result = await saveWorkOrderLineItems(client, 'wo-1', [{ ...invoiced, unit_price: '' }]);

    expect(result.reason).toBe('line_invoiced');
    expect(update).not.toHaveBeenCalled();
  });

  // ROT-spärren är editorns — den läser översiktens UTKAST. Servern ser bara det sparade läget och
  // hade kunnat neka en rad editorn inte ens visar arbetskostnaden för.
  it('prövar inte arbetskostnaden på servern', async () => {
    const row = { id: 'a', article_name: 'Lösull', pricing_mode: 'item', quantity: '1', unit_price: '700', labor_cost: '700' };
    const on = fakeSupabase({ ...order, quote_type: 'private', rot_details: { enabled: true } });
    expect((await saveWorkOrderLineItems(on.client, 'wo-1', [row])).reason).toBeNull();
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

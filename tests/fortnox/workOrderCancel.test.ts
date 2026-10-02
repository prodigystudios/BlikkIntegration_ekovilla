import { describe, it, expect, vi } from 'vitest';

// Avbruten arbetsorder ↔ makulerad Fortnox-order (lib/domains/fortnox/workOrderCancel.ts).
//
// Regeln (William 2026-10-02): arbetsordern blir inte Avbruten om inte Fortnox först tagit emot makuleringen. Det som
// prövas här är ORDNINGEN — claim, makulering, sparande, släpp — och att ett nej aldrig når sparandet.

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

import { FortnoxApiError } from '@/lib/domains/fortnox/client';
import {
  cancelWorkOrderWithFortnox,
  isWorkOrderFortnoxOrderCancelled,
  mayUpdateWorkOrder,
  workOrderStatusFortnoxStep,
  type WorkOrderCancelDeps,
} from '@/lib/domains/fortnox/workOrderCancel';

const ID = 'wo-1';

/** Fejkade beroenden som skriver varje anrop i en logg, så att ordningen går att pröva. */
function fakeDeps(opts: {
  rows: Array<{ fortnox_order_number: string | null; fortnox_order_sync_status: string | null }>;
  claim?: boolean;
  cancel?: () => Promise<void>;
  order?: { cancelled: boolean; invoiceNumber: string | null } | Error;
}) {
  const log: string[] = [];
  let reads = 0;
  const deps: WorkOrderCancelDeps = {
    claim: vi.fn(async () => { log.push('claim'); return opts.claim ?? true; }),
    read: vi.fn(async () => {
      log.push('read');
      const row = opts.rows[Math.min(reads, opts.rows.length - 1)];
      reads += 1;
      return row;
    }),
    setSyncStatus: vi.fn(async (_id, status) => { log.push(`release:${status}`); }),
    cancel: vi.fn(async (n) => { log.push(`cancel:${n}`); if (opts.cancel) await opts.cancel(); }),
    readOrder: vi.fn(async (n) => {
      log.push(`readOrder:${n}`);
      if (opts.order instanceof Error) throw opts.order;
      return opts.order ?? { cancelled: false, invoiceNumber: null };
    }),
  };
  const save = vi.fn(async () => { log.push('save'); return { data: { id: ID }, error: null }; });
  return { deps, save, log };
}

const refused = () => new FortnoxApiError(400, 'Fortnox PUT /orders/89/cancel (400)', 2001383, 'Är låst och kan inte makuleras');

describe('workOrderStatusFortnoxStep', () => {
  it.each([
    ['in_progress', 'cancelled', 'cancel'],
    ['draft', 'cancelled', 'cancel'],
    ['cancelled', 'scheduled', 'reactivate'],
    ['cancelled', 'cancelled', 'none'],
    ['draft', 'scheduled', 'none'],
    ['completed', undefined, 'none'],
  ])('%s → %s = %s', (from, to, step) => {
    expect(workOrderStatusFortnoxStep(from, to)).toBe(step);
  });
});

describe('mayUpdateWorkOrder — RLS-policyn, prövad före Fortnox', () => {
  it('den ansvarige får', () => expect(mayUpdateWorkOrder('u1', 'u1', false)).toBe(true));
  it('crm.admin får, utan att vara ansvarig', () => expect(mayUpdateWorkOrder('u2', 'u1', true)).toBe(true));
  it('en annan säljare får inte', () => expect(mayUpdateWorkOrder('u2', 'u1', false)).toBe(false));
  // Ingen ansvarig: policyn jämför uid = NULL, som aldrig är sant.
  it('ingen ansvarig och inte admin: får inte', () => expect(mayUpdateWorkOrder(null, 'u1', false)).toBe(false));
});

describe('cancelWorkOrderWithFortnox', () => {
  // ⚖️ KÄRNAN. Makuleringen FÖRE sparandet, och claimen hålls genom båda.
  it('makulerar Fortnox-ordern, sparar sedan, och släpper claimen sist', async () => {
    const { deps, save, log } = fakeDeps({ rows: [{ fortnox_order_number: '89', fortnox_order_sync_status: 'synced' }] });

    const result = await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(result).toEqual({ kind: 'saved', fortnoxOrderNumber: '89', saved: { data: { id: ID }, error: null } });
    expect(log).toEqual(['read', 'claim', 'read', 'cancel:89', 'save', 'release:synced']);
  });

  // Ett nytt försök efter ett avbrott (Fortnox makulerade, sparandet föll) ska läka sig: redan makulerad är klar.
  it('räknar en redan makulerad order som klar och sparar', async () => {
    const { deps, save } = fakeDeps({
      rows: [{ fortnox_order_number: '89', fortnox_order_sync_status: 'synced' }],
      cancel: async () => { throw new FortnoxApiError(400, 'Fortnox PUT /orders/89/cancel (400)', 2001279, 'Är redan makulerad'); },
      order: { cancelled: true, invoiceNumber: null },
    });

    const result = await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(result.kind).toBe('saved');
    expect(save).toHaveBeenCalledOnce();
  });

  // ⚖️ NEJET NÅR ALDRIG SPARANDET.
  it('sparar ingenting när Fortnox-ordern är fakturerad', async () => {
    const { deps, save, log } = fakeDeps({
      rows: [{ fortnox_order_number: '86', fortnox_order_sync_status: 'synced' }],
      cancel: async () => { throw refused(); },
      order: { cancelled: false, invoiceNumber: '33' },
    });

    const result = await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(result).toEqual({ kind: 'invoiced', fortnoxOrderNumber: '86', invoiceNumber: '33' });
    expect(save).not.toHaveBeenCalled();
    expect(log.at(-1)).toBe('release:synced');
  });

  it('kastar Fortnox nej av annat skäl, utan att spara, och släpper claimen', async () => {
    const { deps, save, log } = fakeDeps({
      rows: [{ fortnox_order_number: '89', fortnox_order_sync_status: 'synced' }],
      cancel: async () => { throw refused(); },
      order: { cancelled: false, invoiceNumber: null },
    });

    await expect(cancelWorkOrderWithFortnox(ID, save, deps)).rejects.toBeInstanceOf(FortnoxApiError);
    expect(save).not.toHaveBeenCalled();
    expect(log.at(-1)).toBe('release:synced');
  });

  // Går läget inte att läsa vet vi inte om ordern är makulerad: det ursprungliga nejet gäller.
  it('kastar nejet när inte heller orderns läge går att läsa', async () => {
    const { deps, save } = fakeDeps({
      rows: [{ fortnox_order_number: '89', fortnox_order_sync_status: 'synced' }],
      cancel: async () => { throw refused(); },
      order: new Error('timeout'),
    });

    await expect(cancelWorkOrderWithFortnox(ID, save, deps)).rejects.toBeInstanceOf(FortnoxApiError);
    expect(save).not.toHaveBeenCalled();
  });

  it('gör ingenting när ett skapande håller claimen', async () => {
    const { deps, save, log } = fakeDeps({ rows: [{ fortnox_order_number: null, fortnox_order_sync_status: 'pending' }], claim: false });

    const result = await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(result).toEqual({ kind: 'busy' });
    expect(save).not.toHaveBeenCalled();
    expect(deps.cancel).not.toHaveBeenCalled();
    // Claimen är inte vår: synkläget rörs inte.
    expect(log).toEqual(['read', 'claim']);
  });

  // Utan nummer finns inget att makulera, men claimen hålls ändå medan statusen sparas (ett skapande på väg).
  it('sparar utan Fortnox-anrop när ordern aldrig skapats, och lämnar synkläget som det var', async () => {
    const { deps, save, log } = fakeDeps({ rows: [{ fortnox_order_number: null, fortnox_order_sync_status: 'failed' }] });

    const result = await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(result).toEqual({ kind: 'saved', fortnoxOrderNumber: null, saved: { data: { id: ID }, error: null } });
    expect(log).toEqual(['read', 'claim', 'read', 'save', 'release:failed']);
  });

  it('skriver inte tillbaka claimens eget pending', async () => {
    const { deps, save, log } = fakeDeps({ rows: [{ fortnox_order_number: null, fortnox_order_sync_status: 'pending' }] });

    await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(log.at(-1)).toBe('release:not_synced');
  });

  // 🧨 Numret läses OM med claimen: ett skapande som slutfördes mellan första läsningen och claimen har sparat sitt.
  it('makulerar ordern som ett samtidigt skapande hann spara', async () => {
    const { deps, save, log } = fakeDeps({
      rows: [
        { fortnox_order_number: null, fortnox_order_sync_status: 'pending' },
        { fortnox_order_number: '90', fortnox_order_sync_status: 'synced' },
      ],
    });

    const result = await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(result.kind === 'saved' && result.fortnoxOrderNumber).toBe('90');
    expect(log).toContain('cancel:90');
    expect(log.at(-1)).toBe('release:synced');
  });

  it('släpper claimen också när sparandet kastar', async () => {
    const { deps, log } = fakeDeps({ rows: [{ fortnox_order_number: '89', fortnox_order_sync_status: 'synced' }] });

    await expect(cancelWorkOrderWithFortnox(ID, async () => { throw new Error('db'); }, deps)).rejects.toThrow('db');
    expect(log.at(-1)).toBe('release:synced');
  });
});

describe('isWorkOrderFortnoxOrderCancelled', () => {
  it('läser orderns läge', async () => {
    const { deps } = fakeDeps({ rows: [], order: { cancelled: true, invoiceNumber: null } });
    expect(await isWorkOrderFortnoxOrderCancelled('89', deps)).toBe(true);
  });
});

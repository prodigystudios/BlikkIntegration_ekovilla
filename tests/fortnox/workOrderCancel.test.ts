import { describe, it, expect, vi } from 'vitest';

// Avbruten arbetsorder ↔ makulerad Fortnox-order (lib/domains/fortnox/workOrderCancel.ts).
//
// Reglerna (William 2026-10-02): arbetsordern blir inte Avbruten om inte Fortnox först tagit emot makuleringen, och en
// delfakturerad arbetsorder avbryts inte alls. Det som prövas här är ORDNINGEN — claimarna, kontrollen, makuleringen,
// sparandet, släppet — och att ett nej aldrig når sparandet.

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

import { FortnoxApiError } from '@/lib/domains/fortnox/client';
import {
  cancelWorkOrderWithFortnox,
  checkWorkOrderReactivation,
  mayUpdateWorkOrder,
  workOrderStatusFortnoxStep,
  type WorkOrderCancelDeps,
} from '@/lib/domains/fortnox/workOrderCancel';

const ID = 'wo-1';

type Row = {
  fortnox_order_number: string | null;
  fortnox_order_sync_status?: string | null;
  fortnox_invoice_sync_status?: string | null;
  status?: string | null;
  partial_invoicing_started_at?: string | null;
};

/** Fejkade beroenden som skriver varje anrop i en logg, så att ordningen går att pröva. */
function fakeDeps(opts: {
  /** Raden per läsning: första är före claimarna, sista upprepas. */
  rows: Row[];
  orderClaim?: boolean;
  invoiceClaim?: boolean;
  /** Fakturarundor per räkning; sista upprepas. */
  rounds?: number[];
  cancel?: () => Promise<void>;
  order?: { cancelled: boolean; invoiceNumber: string | null } | Error;
}) {
  const log: string[] = [];
  let reads = 0;
  let counts = 0;
  const full = (r: Row) => ({
    status: 'in_progress',
    partial_invoicing_started_at: null,
    fortnox_order_sync_status: 'synced',
    fortnox_invoice_sync_status: 'not_synced',
    ...r,
  });
  const deps: WorkOrderCancelDeps = {
    claim: vi.fn(async (_id, which) => {
      log.push(`claim:${which}`);
      return (which === 'order' ? opts.orderClaim : opts.invoiceClaim) ?? true;
    }),
    read: vi.fn(async () => {
      log.push('read');
      const row = opts.rows[Math.min(reads, opts.rows.length - 1)];
      reads += 1;
      return full(row) as Awaited<ReturnType<WorkOrderCancelDeps['read']>>;
    }),
    countInvoiceRounds: vi.fn(async () => {
      log.push('rounds');
      const list = opts.rounds ?? [0];
      const n = list[Math.min(counts, list.length - 1)];
      counts += 1;
      return n;
    }),
    setSyncStatus: vi.fn(async (_id, which, status) => { log.push(`release:${which}:${status}`); }),
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

describe('mayUpdateWorkOrder — RLS-policyn, båda halvorna, prövad före Fortnox', () => {
  const same = (a: string | null) => ({ current: a, next: a });
  it('den ansvarige får', () => expect(mayUpdateWorkOrder(same('u1'), 'u1', false)).toBe(true));
  it('crm.admin får, utan att vara ansvarig', () => expect(mayUpdateWorkOrder(same('u2'), 'u1', true)).toBe(true));
  it('en annan säljare får inte (USING)', () => expect(mayUpdateWorkOrder(same('u2'), 'u1', false)).toBe(false));
  // Ingen ansvarig: policyn jämför uid = NULL, som aldrig är sant.
  it('ingen ansvarig och inte admin: får inte', () => expect(mayUpdateWorkOrder(same(null), 'u1', false)).toBe(false));
  // 🧨 WITH CHECK: den ansvarige som lämnar över i samma sparning nekas av policyn på den NYA raden. Prövades bara den
  // gamla hade Fortnox makulerat och sparandet sedan fallit — varje nytt försök på samma sätt.
  it('den ansvarige som byter till en kollega i samma sparning: får inte (WITH CHECK)', () =>
    expect(mayUpdateWorkOrder({ current: 'u1', next: 'u2' }, 'u1', false)).toBe(false));
  it('den ansvarige som tar bort sig själv: får inte', () =>
    expect(mayUpdateWorkOrder({ current: 'u1', next: null }, 'u1', false)).toBe(false));
  it('crm.admin får byta ansvarig', () => expect(mayUpdateWorkOrder({ current: 'u1', next: 'u2' }, 'u3', true)).toBe(true));
});

describe('cancelWorkOrderWithFortnox', () => {
  // ⚖️ KÄRNAN. Båda claimarna först, kontrollen med dem tagna, makuleringen FÖRE sparandet, släppet sist.
  it('tar claimarna, prövar faktureringen, makulerar, sparar och släpper sist', async () => {
    const { deps, save, log } = fakeDeps({ rows: [{ fortnox_order_number: '89' }] });

    const result = await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(result).toEqual({ kind: 'saved', fortnoxOrderNumber: '89', saved: { data: { id: ID }, error: null } });
    expect(log).toEqual([
      'read', 'claim:order', 'claim:invoice', 'read', 'rounds', 'cancel:89', 'save',
      'release:invoice:not_synced', 'release:order:synced',
    ]);
  });

  // Ett nytt försök efter ett avbrott (Fortnox makulerade, sparandet föll) ska läka sig: redan makulerad är klar.
  it('räknar en redan makulerad order som klar och sparar', async () => {
    const { deps, save } = fakeDeps({
      rows: [{ fortnox_order_number: '89' }],
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
      rows: [{ fortnox_order_number: '86' }],
      cancel: async () => { throw refused(); },
      order: { cancelled: false, invoiceNumber: '33' },
    });

    const result = await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(result).toEqual({ kind: 'invoiced', fortnoxOrderNumber: '86', invoiceNumber: '33' });
    expect(save).not.toHaveBeenCalled();
    expect(log.slice(-2)).toEqual(['release:invoice:not_synced', 'release:order:synced']);
  });

  it('kastar Fortnox nej av annat skäl, utan att spara, och släpper claimarna', async () => {
    const { deps, save, log } = fakeDeps({
      rows: [{ fortnox_order_number: '89' }],
      cancel: async () => { throw refused(); },
      order: { cancelled: false, invoiceNumber: null },
    });

    await expect(cancelWorkOrderWithFortnox(ID, save, deps)).rejects.toBeInstanceOf(FortnoxApiError);
    expect(save).not.toHaveBeenCalled();
    expect(log.slice(-2)).toEqual(['release:invoice:not_synced', 'release:order:synced']);
  });

  // Går läget inte att läsa vet vi inte om ordern är makulerad: det ursprungliga nejet gäller.
  it('kastar nejet när inte heller orderns läge går att läsa', async () => {
    const { deps, save } = fakeDeps({
      rows: [{ fortnox_order_number: '89' }],
      cancel: async () => { throw refused(); },
      order: new Error('timeout'),
    });

    await expect(cancelWorkOrderWithFortnox(ID, save, deps)).rejects.toBeInstanceOf(FortnoxApiError);
    expect(save).not.toHaveBeenCalled();
  });

  it('gör ingenting när ett skapande håller orderns claim', async () => {
    const { deps, save, log } = fakeDeps({ rows: [{ fortnox_order_number: null, fortnox_order_sync_status: 'pending' }], orderClaim: false });

    const result = await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(result).toEqual({ kind: 'busy' });
    expect(save).not.toHaveBeenCalled();
    expect(deps.cancel).not.toHaveBeenCalled();
    // Claimen är inte vår: synkläget rörs inte.
    expect(log).toEqual(['read', 'claim:order']);
  });

  // 🧨 Delfakturan tar FAKTURANS claim. Håller den den är en faktura på väg: ingenting görs, och bara orderns claim släpps.
  it('gör ingenting när en fakturering håller fakturans claim', async () => {
    const { deps, save, log } = fakeDeps({ rows: [{ fortnox_order_number: '89' }], invoiceClaim: false });

    const result = await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(result).toEqual({ kind: 'busy' });
    expect(save).not.toHaveBeenCalled();
    expect(deps.cancel).not.toHaveBeenCalled();
    expect(log).toEqual(['read', 'claim:order', 'claim:invoice', 'release:order:synced']);
  });

  // ⚖️ En delfakturerad arbetsorder avbryts inte — och Fortnox tillfrågas aldrig.
  it.each([
    ['statusen', { status: 'partially_invoiced' }, 0],
    ['kolumnen', { partial_invoicing_started_at: '2026-10-01T10:00:00Z' }, 0],
    ['en runda', {}, 1],
  ])('nekar en delfakturerad order (%s), med claimarna tagna', async (_name, fields, rounds) => {
    const { deps, save, log } = fakeDeps({ rows: [{ fortnox_order_number: '89', ...fields }], rounds: [rounds] });

    const result = await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(result).toEqual({ kind: 'invoicing_started' });
    expect(save).not.toHaveBeenCalled();
    expect(deps.cancel).not.toHaveBeenCalled();
    expect(log.slice(-2)).toEqual(['release:invoice:not_synced', 'release:order:synced']);
  });

  // 🧨 Kontrollen görs MED claimarna: en delfaktura som hann lägga sin runda mellan första läsningen och claimen fångas.
  // Bara omläsningen visar delfaktureringen (rundorna räknas inte här): det är omläsningen som prövas, inte räkningen.
  it('fångar en delfaktura som landade mellan läsningen och claimarna', async () => {
    const { deps, save } = fakeDeps({
      rows: [{ fortnox_order_number: '89' }, { fortnox_order_number: '89', partial_invoicing_started_at: '2026-10-02T12:00:00Z' }],
      rounds: [0],
    });

    const result = await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(result).toEqual({ kind: 'invoicing_started' });
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  // Läsfel på rundorna: fail-closed, inget görs.
  it('kastar när rundorna inte går att räkna, utan att makulera', async () => {
    const { deps, save, log } = fakeDeps({ rows: [{ fortnox_order_number: '89' }] });
    deps.countInvoiceRounds = vi.fn(async () => { throw new Error('rundorna'); });

    await expect(cancelWorkOrderWithFortnox(ID, save, deps)).rejects.toThrow('rundorna');
    expect(deps.cancel).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(log.slice(-2)).toEqual(['release:invoice:not_synced', 'release:order:synced']);
  });

  // Utan nummer finns inget att makulera, men claimarna hålls ändå medan statusen sparas (ett skapande på väg).
  it('sparar utan Fortnox-anrop när ordern aldrig skapats, och lämnar synklägena som de var', async () => {
    const { deps, save, log } = fakeDeps({ rows: [{ fortnox_order_number: null, fortnox_order_sync_status: 'failed' }] });

    const result = await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(result).toEqual({ kind: 'saved', fortnoxOrderNumber: null, saved: { data: { id: ID }, error: null } });
    expect(log).toEqual(['read', 'claim:order', 'claim:invoice', 'read', 'rounds', 'save', 'release:invoice:not_synced', 'release:order:failed']);
  });

  // Claimen gick att ta trots 'pending' bara för att den var gammal: ett försök som dog.
  it('skriver inte tillbaka claimarnas eget pending, utan failed', async () => {
    const { deps, save, log } = fakeDeps({
      rows: [{ fortnox_order_number: null, fortnox_order_sync_status: 'pending', fortnox_invoice_sync_status: 'pending' }],
    });

    await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(log.slice(-2)).toEqual(['release:invoice:failed', 'release:order:failed']);
  });

  // 🧨 Ett nej fick tidigare 'synced' tillbaka, och en order vars rader aldrig nådde Fortnox ('failed') hade då gått att
  // fakturera — på de gamla raderna.
  it.each(['failed', 'not_synced'])('lämnar ett %s orört när Fortnox säger nej', async (prior) => {
    const { deps, save, log } = fakeDeps({
      rows: [{ fortnox_order_number: '89', fortnox_order_sync_status: prior }],
      cancel: async () => { throw refused(); },
      order: { cancelled: false, invoiceNumber: null },
    });

    await expect(cancelWorkOrderWithFortnox(ID, save, deps)).rejects.toBeInstanceOf(FortnoxApiError);
    expect(log.at(-1)).toBe(`release:order:${prior}`);
  });

  it('lämnar ett failed orört också efter en lyckad makulering', async () => {
    const { deps, save, log } = fakeDeps({ rows: [{ fortnox_order_number: '89', fortnox_order_sync_status: 'failed' }] });

    await cancelWorkOrderWithFortnox(ID, save, deps);

    expect(log.at(-1)).toBe('release:order:failed');
  });

  // 🧨 Numret läses OM med claimarna: ett skapande som slutfördes mellan första läsningen och claimen har sparat sitt.
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
    expect(log.at(-1)).toBe('release:order:synced');
  });

  it('släpper claimarna också när sparandet kastar', async () => {
    const { deps, log } = fakeDeps({ rows: [{ fortnox_order_number: '89' }] });

    await expect(cancelWorkOrderWithFortnox(ID, async () => { throw new Error('db'); }, deps)).rejects.toThrow('db');
    expect(log.slice(-2)).toEqual(['release:invoice:not_synced', 'release:order:synced']);
  });
});

describe('checkWorkOrderReactivation', () => {
  it('nekar när Fortnox-ordern är makulerad', async () => {
    const { deps } = fakeDeps({ rows: [], order: { cancelled: true, invoiceNumber: null } });
    expect(await checkWorkOrderReactivation('89', deps)).toEqual({ kind: 'fortnox_cancelled', fortnoxOrderNumber: '89' });
  });

  // Avbruten före regeln: Fortnox-ordern står öppen.
  it('släpper igenom när Fortnox-ordern är öppen', async () => {
    const { deps } = fakeDeps({ rows: [], order: { cancelled: false, invoiceNumber: null } });
    expect(await checkWorkOrderReactivation('80', deps)).toEqual({ kind: 'allowed' });
  });

  it('frågar inte Fortnox när ordern aldrig skapats där', async () => {
    const { deps } = fakeDeps({ rows: [] });
    expect(await checkWorkOrderReactivation(null, deps)).toEqual({ kind: 'allowed' });
    expect(deps.readOrder).not.toHaveBeenCalled();
  });

  it('kastar när Fortnox inte svarar (anroparen låter ordern stå kvar)', async () => {
    const { deps } = fakeDeps({ rows: [], order: new Error('timeout') });
    await expect(checkWorkOrderReactivation('89', deps)).rejects.toThrow('timeout');
  });
});

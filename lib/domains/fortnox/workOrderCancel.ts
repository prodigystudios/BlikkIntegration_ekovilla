import { getSupabaseAdmin } from '@/lib/supabase/server';
import { claimFortnoxPush } from './helpers';
import {
  cancelFortnoxOrder,
  cancelFortnoxOrderByState,
  readStoreOrderFortnoxOrder,
  type StoreOrderFortnoxOrderState,
} from '@/lib/domains/portal/storeOrderActions';

/**
 * En avbruten arbetsorder makulerar sin Fortnox-order, och bara så.
 *
 * Regeln (William 2026-10-02): en arbetsorder blir inte Avbruten om inte Fortnox först tagit emot makuleringen. Säger
 * Fortnox nej sparas ingenting, säljaren får beskedet och statusen står kvar. Före det här ändrade Avbruten bara vår
 * status, och Fortnox-ordern låg kvar som öppen order (testbolagets order 80 och 89).
 *
 * Makuleringen och nejet avgörs av `cancelFortnoxOrderByState`, samma väg som butiksbeställningarnas Makulera: en order
 * som redan är makulerad räknas som klar (ett nytt försök efter ett avbrott läker sig själv), en fakturerad kan inte
 * makuleras, och allt annat kastas.
 *
 * 🧨 ORDNINGEN. Orderns push-claim tas först, och statusen sparas medan den hålls. Utan claimen kunde ett skapande som
 * redan var på väg (portalintaget, "Skicka till Fortnox") hinna POST:a en ny order efter att vi läst raden utan nummer,
 * och en avbruten arbetsorder hade fått en öppen Fortnox-order. `pushWorkOrderToFortnox` vägrar dessutom en avbruten
 * order, så ett skapande som kommer efter claimen släpps inte heller igenom.
 */

/** Vad ett statusbyte kräver av Fortnox. */
export type WorkOrderStatusFortnoxStep = 'cancel' | 'reactivate' | 'none';

export function workOrderStatusFortnoxStep(
  currentStatus: string | null | undefined,
  nextStatus: string | null | undefined,
): WorkOrderStatusFortnoxStep {
  if (!nextStatus || nextStatus === currentStatus) return 'none';
  if (nextStatus === 'cancelled') return 'cancel';
  if (currentStatus === 'cancelled') return 'reactivate';
  return 'none';
}

/**
 * Får användaren spara arbetsordern? Exakt RLS-policyn `crm_work_orders_update_visible`: den ansvarige eller
 * `crm.admin`. Prövas FÖRE makuleringen: nekar databasen sparandet efteråt är Fortnox-ordern redan makulerad.
 */
export function mayUpdateWorkOrder(assignedTo: string | null | undefined, userId: string, isCrmAdmin: boolean): boolean {
  return isCrmAdmin || (Boolean(assignedTo) && assignedTo === userId);
}

type CancelRow = { fortnox_order_number: string | null; fortnox_order_sync_status: string | null };

export type WorkOrderCancelDeps = {
  /** Orderns push-claim, samma som skapandet tar (`claimFortnoxPush`). */
  claim: (workOrderId: string) => Promise<boolean>;
  read: (workOrderId: string) => Promise<CancelRow | null>;
  /** Släpper claimen genom att skriva tillbaka synkläget. */
  setSyncStatus: (workOrderId: string, status: string) => Promise<void>;
  cancel: (orderNumber: string) => Promise<void>;
  readOrder: (orderNumber: string) => Promise<StoreOrderFortnoxOrderState>;
};

export function workOrderCancelDeps(): WorkOrderCancelDeps {
  const admin = getSupabaseAdmin();
  return {
    claim: (id) => claimFortnoxPush(admin, 'crm_work_orders', id, 'fortnox_order_sync_status', 'fortnox_order_claimed_at'),
    read: async (id) => {
      const { data, error } = await admin
        .from('crm_work_orders')
        .select('fortnox_order_number, fortnox_order_sync_status')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`Arbetsordern gick inte att läsa: ${error.message}`);
      return (data as CancelRow | null) ?? null;
    },
    setSyncStatus: async (id, status) => {
      const { error } = await admin.from('crm_work_orders').update({ fortnox_order_sync_status: status }).eq('id', id);
      if (error) console.error('[fortnox] Claimen släpptes inte efter makuleringen', { id, error: error.message });
    },
    cancel: cancelFortnoxOrder,
    // GET /orders/{n}: makulerad, och fakturan. Samma läsning som butiksbeställningarna gör; inget i den är butiksspecifikt.
    readOrder: readStoreOrderFortnoxOrder,
  };
}

export type CancelWorkOrderResult<S> =
  /** Fortnox-ordern är makulerad (eller fanns inte), och `save` har körts med claimen. Läs `saved` för sparningens utfall. */
  | { kind: 'saved'; fortnoxOrderNumber: string | null; saved: S }
  /** Ett skapande håller orderns claim: Fortnox-ordern kan vara på väg. Ingenting gjort. */
  | { kind: 'busy' }
  /** Fortnox-ordern är fakturerad och kan inte makuleras. Ingenting gjort. */
  | { kind: 'invoiced'; fortnoxOrderNumber: string; invoiceNumber: string };

/**
 * Makulerar arbetsorderns Fortnox-order och sparar sedan statusen (`save`), medan orderns claim hålls.
 *
 * Kastar Fortnox fel (anslutningen, ett nej av annat skäl): ingenting är då sparat, och claimen är släppt. Kastar också
 * när `save` kastar, efter att claimen släppts.
 */
export async function cancelWorkOrderWithFortnox<S>(
  workOrderId: string,
  save: () => Promise<S>,
  deps: WorkOrderCancelDeps = workOrderCancelDeps(),
): Promise<CancelWorkOrderResult<S>> {
  const before = await deps.read(workOrderId);
  if (!await deps.claim(workOrderId)) return { kind: 'busy' };

  // Synkläget som släpper claimen. En order som finns i Fortnox står som synkad (makuleringen ändrar inte dess innehåll);
  // en utan nummer får tillbaka det den hade, utom claimens eget 'pending'.
  let fortnoxOrderNumber: string | null = null;
  const release = () => {
    const prior = before?.fortnox_order_sync_status ?? 'not_synced';
    return deps.setSyncStatus(workOrderId, fortnoxOrderNumber ? 'synced' : prior === 'pending' ? 'not_synced' : prior);
  };

  try {
    // Omläst med claimen: ett skapande som slutfördes efter läsningen ovan har sparat sitt nummer nu.
    const row = await deps.read(workOrderId);
    fortnoxOrderNumber = row?.fortnox_order_number ?? null;
    if (fortnoxOrderNumber) {
      const outcome = await cancelFortnoxOrderByState(fortnoxOrderNumber, deps);
      if (outcome.kind === 'invoiced') {
        await release();
        return { kind: 'invoiced', fortnoxOrderNumber, invoiceNumber: outcome.invoiceNumber };
      }
    }
  } catch (e) {
    await release();
    throw e;
  }

  try {
    const saved = await save();
    return { kind: 'saved', fortnoxOrderNumber, saved };
  } finally {
    await release();
  }
}

/** Är Fortnox-ordern makulerad? Avgör om en avbruten arbetsorder kan återupptas. Kastar när Fortnox inte svarar. */
export async function isWorkOrderFortnoxOrderCancelled(
  orderNumber: string,
  deps: Pick<WorkOrderCancelDeps, 'readOrder'> = workOrderCancelDeps(),
): Promise<boolean> {
  return (await deps.readOrder(orderNumber)).cancelled;
}

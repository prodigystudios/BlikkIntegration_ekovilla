import { getSupabaseAdmin } from '@/lib/supabase/server';
import { countWorkOrderInvoiceRounds, workOrderInvoicingStarted } from '@/lib/domains/crm/work-orders';
import { claimFortnoxPush } from './helpers';
import { cancelFortnoxOrder, cancelFortnoxOrderByState, readFortnoxOrderState, type FortnoxOrderState } from './orderCancel';

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
 * 🧨 ORDNINGEN. Orderns push-claim och fakturans claim tas först, och statusen sparas medan de hålls.
 *   - Orderns: utan den kunde ett skapande som redan var på väg (portalintaget, "Skicka till Fortnox") hinna POST:a en ny
 *     order efter att vi läst raden utan nummer. `pushWorkOrderToFortnox` vägrar dessutom en avbruten order.
 *   - Fakturans: en delfakturerad order avbryts inte, men delfakturan tar fakturans claim, inte orderns. Utan den hade en
 *     delfaktura på väg kunnat passera kontrollen, ställa ut en riktig faktura och skriva Delfakturerad över Avbruten.
 *     Delfaktureringen prövas därför först när båda claimarna är våra, och createPartialInvoice prövar Avbruten igen
 *     efter sin.
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
 * Får användaren spara arbetsordern? Exakt RLS-policyn `crm_work_orders_update_visible`, båda halvorna: USING på den
 * ansvarige som står (`current`) och WITH CHECK på den som blir (`next`, samma när PATCH:en inte byter). Den ansvarige
 * eller `crm.admin`. Prövas FÖRE makuleringen: nekar databasen sparandet efteråt är Fortnox-ordern redan makulerad.
 */
export function mayUpdateWorkOrder(
  assignee: { current: string | null | undefined; next: string | null | undefined },
  userId: string,
  isCrmAdmin: boolean,
): boolean {
  if (isCrmAdmin) return true;
  return Boolean(assignee.current) && assignee.current === userId && assignee.next === userId;
}

type CancelRow = {
  status: string | null;
  partial_invoicing_started_at: string | null;
  fortnox_order_number: string | null;
  fortnox_order_sync_status: string | null;
  fortnox_invoice_sync_status: string | null;
};

/** Orderns push-claim (skapandet, synken) och fakturans (delfakturan, Fakturera allt). Samma kolumnpar som de tar. */
export type WorkOrderClaim = 'order' | 'invoice';

export type WorkOrderCancelDeps = {
  claim: (workOrderId: string, which: WorkOrderClaim) => Promise<boolean>;
  read: (workOrderId: string) => Promise<CancelRow | null>;
  countInvoiceRounds: (workOrderId: string) => Promise<number>;
  /** Släpper en claim genom att skriva tillbaka synkläget. */
  setSyncStatus: (workOrderId: string, which: WorkOrderClaim, status: string) => Promise<void>;
  cancel: (orderNumber: string) => Promise<void>;
  readOrder: (orderNumber: string) => Promise<FortnoxOrderState>;
};

const CLAIM_COLUMNS: Record<WorkOrderClaim, [string, string]> = {
  order: ['fortnox_order_sync_status', 'fortnox_order_claimed_at'],
  invoice: ['fortnox_invoice_sync_status', 'fortnox_invoice_claimed_at'],
};

export function workOrderCancelDeps(): WorkOrderCancelDeps {
  // Elevated som claimarna: kontrollen av rundorna får inte filtreras av sessionens RLS (en admin utan
  // crm.workorder.read hade sett noll rundor). Routen har redan prövat att användaren får spara ordern.
  const admin = getSupabaseAdmin();
  return {
    claim: (id, which) => claimFortnoxPush(admin, 'crm_work_orders', id, ...CLAIM_COLUMNS[which]),
    read: async (id) => {
      const { data, error } = await admin
        .from('crm_work_orders')
        .select('status, partial_invoicing_started_at, fortnox_order_number, fortnox_order_sync_status, fortnox_invoice_sync_status')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`Arbetsordern gick inte att läsa: ${error.message}`);
      return (data as CancelRow | null) ?? null;
    },
    countInvoiceRounds: async (id) => {
      const { count, error } = await countWorkOrderInvoiceRounds(admin, id);
      if (error) throw new Error(`Fakturarundorna gick inte att läsa: ${error.message}`);
      return count ?? 0;
    },
    setSyncStatus: async (id, which, status) => {
      const { error } = await admin.from('crm_work_orders').update({ [CLAIM_COLUMNS[which][0]]: status }).eq('id', id);
      if (error) console.error('[fortnox] Claimen släpptes inte efter avbrytandet', { id, which, error: error.message });
    },
    cancel: cancelFortnoxOrder,
    readOrder: readFortnoxOrderState,
  };
}

export type CancelWorkOrderResult<S> =
  /** Fortnox-ordern är makulerad (eller fanns inte), och `save` har körts med claimarna. Läs `saved` för sparningens utfall. */
  | { kind: 'saved'; fortnoxOrderNumber: string | null; saved: S }
  /** Ett skapande eller en fakturering håller en claim. Ingenting gjort. */
  | { kind: 'busy' }
  /** Faktureringen har börjat (delfakturerad): ordern avbryts inte. Ingenting gjort, Fortnox inte tillfrågat. */
  | { kind: 'invoicing_started' }
  /** Fortnox-ordern är fakturerad och kan inte makuleras. Ingenting gjort. */
  | { kind: 'invoiced'; fortnoxOrderNumber: string; invoiceNumber: string };

/**
 * Makulerar arbetsorderns Fortnox-order och sparar sedan statusen (`save`), medan orderns och fakturans claim hålls.
 *
 * Kastar Fortnox fel (anslutningen, ett nej av annat skäl) och läsfel: ingenting är då sparat, och claimarna är släppta.
 * Kastar också när `save` kastar, efter att claimarna släppts.
 */
export async function cancelWorkOrderWithFortnox<S>(
  workOrderId: string,
  save: () => Promise<S>,
  deps: WorkOrderCancelDeps = workOrderCancelDeps(),
): Promise<CancelWorkOrderResult<S>> {
  const before = await deps.read(workOrderId);
  if (!await deps.claim(workOrderId, 'order')) return { kind: 'busy' };

  // Synkläget som släpper en claim: det som stod före den. 🧨 ALDRIG ett påhittat 'synced': stod ordern 'failed'
  // (raderna nådde inte Fortnox) och Fortnox sa nej till makuleringen, hade ett 'synced' här släppt igenom faktureringen
  // av de gamla raderna (assertOrderRowsSynced). Bara claimens eget 'pending' byts: för ordern mot 'synced' när ett
  // skapande hann spara sitt nummer mellan läsningen och claimen; annars mot 'failed' (claimen gick bara att ta för att
  // den var gammal, alltså ett försök som dog).
  let fortnoxOrderNumber: string | null = null;
  let invoiceClaimed = false;
  const releaseOrder = () => {
    const prior = before?.fortnox_order_sync_status ?? 'not_synced';
    const createdMeanwhile = Boolean(fortnoxOrderNumber) && !before?.fortnox_order_number;
    return deps.setSyncStatus(workOrderId, 'order', prior !== 'pending' ? prior : createdMeanwhile ? 'synced' : 'failed');
  };
  const releaseInvoice = () => {
    const prior = before?.fortnox_invoice_sync_status ?? 'not_synced';
    return deps.setSyncStatus(workOrderId, 'invoice', prior !== 'pending' ? prior : 'failed');
  };
  const release = async () => {
    if (invoiceClaimed) await releaseInvoice();
    await releaseOrder();
  };

  try {
    if (!await deps.claim(workOrderId, 'invoice')) {
      await releaseOrder();
      return { kind: 'busy' };
    }
    invoiceClaimed = true;

    // Omläst med claimarna: ett skapande som slutfördes efter läsningen ovan har sparat sitt nummer nu, och en delfaktura
    // som hann före har lagt sin runda.
    const row = await deps.read(workOrderId);
    if (workOrderInvoicingStarted(row ?? {}, await deps.countInvoiceRounds(workOrderId))) {
      await release();
      return { kind: 'invoicing_started' };
    }
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

export type WorkOrderReactivation = { kind: 'allowed' } | { kind: 'fortnox_cancelled'; fortnoxOrderNumber: string };

/**
 * Får en avbruten arbetsorder öppnas igen? Inte när dess Fortnox-order är makulerad: den går inte att öppna, och en
 * aktiv arbetsorder mot en makulerad order är driften regeln finns för att hindra. En order som avbröts före regeln har
 * sin Fortnox-order öppen och kan återupptas som förut; en utan Fortnox-order likaså.
 *
 * Kastar när Fortnox inte svarar: då vet vi inte, och anroparen låter ordern stå kvar som Avbruten.
 */
export async function checkWorkOrderReactivation(
  fortnoxOrderNumber: string | null,
  deps: Pick<WorkOrderCancelDeps, 'readOrder'> = { readOrder: readFortnoxOrderState },
): Promise<WorkOrderReactivation> {
  if (!fortnoxOrderNumber) return { kind: 'allowed' };
  return (await deps.readOrder(fortnoxOrderNumber)).cancelled ? { kind: 'fortnox_cancelled', fortnoxOrderNumber } : { kind: 'allowed' };
}

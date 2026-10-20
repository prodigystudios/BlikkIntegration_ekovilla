import type { SupabaseClient } from '@supabase/supabase-js';
import { FortnoxNotConnectedError, FortnoxPushInProgressError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { createFortnoxCustomer } from '@/lib/domains/fortnox/customers';
import { updateWorkOrderInFortnox, type PushOrderResult } from '@/lib/domains/fortnox/orders';
import { countWorkOrderInvoiceRounds, workOrderInvoicingStarted } from './work-orders';
import { isFortnoxOrderClosed } from './workOrderSyncFields';
import type { WorkOrderReadinessIssue } from './workOrderReadiness';
import {
  SWAP_CUSTOMER_SELECT,
  SWAPPABLE_WORK_ORDER_SELECT,
  buildWorkOrderCustomerSwapUpdate,
  customerSwapBlock,
  customerSwapBlockMessage,
  customerSwapReadinessBlockers,
  type CustomerSwapBlock,
  type SwapCustomerCard,
  type SwappableWorkOrder,
  type WorkAddressChoice,
} from './workOrderCustomerSwap';

/**
 * Byter kund på en arbetsorder och, när Fortnox-ordern finns, på den — reglerna och besluten står i
 * workOrderCustomerSwap.ts.
 *
 * Två klienter, med flit (samma som portalens koppling, portal/linkCustomer.ts):
 *   sessionen      arbetsordern och det nya kundkortet. RLS avgör vem som ser dem och vem som får ändra
 *                  ordern (den ansvariga och admin).
 *   service-rollen smala läsningar EFTER att sessionen visat att den ser ordern: fakturarundorna,
 *                  portaljobbet, det gamla kortets moms och offertens ROT-uppgifter. Ett RLS-tomt svar där
 *                  hade sett ut som "inga fakturor" eller "ingen ROT" och släppt igenom fel byte.
 *
 * Ordningen: pröva → se till att den nya kunden finns i Fortnox → skriv ordern → pusha. CRM leder:
 * misslyckas pushen står kunden ändå bytt här, ordern stämplas 'failed', och "Synka om" byter kunden i
 * Fortnox (orderCustomerSwapFields jämför vid varje push så länge numren skiljer sig).
 */

export type SwapWorkOrderCustomerResult =
  | { kind: 'not_found' }
  | { kind: 'customer_not_found' }
  | { kind: 'blocked'; reason: CustomerSwapBlock; message: string }
  /** Kortet saknar något ordern behöver. Ingenting sparat. */
  | { kind: 'incomplete'; blockers: WorkOrderReadinessIssue[] }
  /** Den nya kunden kunde inte läggas upp i Fortnox. Ingenting sparat. */
  | { kind: 'fortnox_customer_failed'; message: string }
  /** Sessionen ser ordern men får inte ändra den: varken ansvarig eller admin. */
  | { kind: 'forbidden' }
  /** Ordern sparades av någon annan medan bytet förbereddes. Ingenting sparat; försök igen. */
  | { kind: 'changed' }
  | { kind: 'swapped'; inFortnox: boolean; fortnoxError: string | null };

export type SwapWorkOrderCustomerDeps = {
  push: (workOrderId: string) => Promise<PushOrderResult>;
  createFortnoxCustomer: (customerId: string) => Promise<{ fortnoxCustomerNumber: string }>;
};

type OrderRow = SwappableWorkOrder & {
  fortnox_invoice_number: string | null;
  partial_invoicing_started_at: string | null;
};

export async function swapWorkOrderCustomer(
  session: SupabaseClient,
  admin: SupabaseClient,
  input: { workOrderId: string; customerId: string; workAddress: WorkAddressChoice },
  deps: SwapWorkOrderCustomerDeps = { push: updateWorkOrderInFortnox, createFortnoxCustomer },
): Promise<SwapWorkOrderCustomerResult> {
  const orderRead = await session.from('crm_work_orders').select(SWAPPABLE_WORK_ORDER_SELECT).eq('id', input.workOrderId).maybeSingle();
  if (orderRead.error) throw new Error(`Arbetsordern gick inte att läsa: ${orderRead.error.message}`);
  const order = orderRead.data as OrderRow | null;
  if (!order) return { kind: 'not_found' };

  const cardRead = await session.from('crm_customers').select(SWAP_CUSTOMER_SELECT).eq('id', input.customerId).maybeSingle();
  if (cardRead.error) throw new Error(`Kundkortet gick inte att läsa: ${cardRead.error.message}`);
  const card = cardRead.data as SwapCustomerCard | null;
  if (!card) return { kind: 'customer_not_found' };

  const [rounds, portalJob, oldCard, quote] = await Promise.all([
    countWorkOrderInvoiceRounds(admin, order.id),
    admin.from('crm_portal_jobs').select('quote_id').eq('work_order_id', order.id).maybeSingle(),
    order.customer_id
      ? admin.from('crm_customers').select('reverse_vat').eq('id', order.customer_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    order.quote_id
      ? admin.from('crm_quotes').select('fortnox_offer_number, rot_details').eq('id', order.quote_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const read of [rounds, portalJob, oldCard, quote]) {
    if (read.error) throw new Error(`Ordern gick inte att pröva: ${read.error.message}`);
  }

  // Momsen ordern har i dag: snapshotens flagga är auktoritativ, annars det nuvarande kortets — samma
  // val som Fortnox-pushen gör (resolveReverseVat).
  const snapshotReverseVat = order.customer_snapshot?.reverse_vat;
  const currentReverseVat = typeof snapshotReverseVat === 'boolean'
    ? snapshotReverseVat
    : (oldCard.data as { reverse_vat?: boolean | null } | null)?.reverse_vat === true;
  const block = customerSwapBlock(order, card, {
    invoiced: workOrderInvoicingStarted(order, rounds.count ?? 0) || isFortnoxOrderClosed(order),
    isPortalJob: Boolean(portalJob.data),
    currentReverseVat,
  });
  if (block) {
    return { kind: 'blocked', reason: block, message: customerSwapBlockMessage(block, { quote_type: order.quote_type, reverseVat: currentReverseVat }) };
  }

  const quoteRow = quote.data as { fortnox_offer_number: string | null; rot_details: Record<string, unknown> | null } | null;
  const draft = buildWorkOrderCustomerSwapUpdate(order, card, {
    workAddress: input.workAddress,
    fallbackRot: quoteRow?.rot_details ?? null,
    fortnoxCustomerNumber: card.fortnox_customer_id,
  });
  const blockers = customerSwapReadinessBlockers(order, card, draft, input.workAddress);
  if (blockers.length > 0) return { kind: 'incomplete', blockers };

  // Fortnox behöver den nya kunden när ordern finns där — eller kommer att skapas ur en Fortnox-offert,
  // som bär den GAMLA kunden (createorder kopierar offertens). I båda fallen är det numret här som
  // pushen jämför med och byter till. En fristående order som ännu inte pushats skapas på orderns kund.
  let fortnoxCustomerNumber = card.fortnox_customer_id;
  const fortnoxInvolved = Boolean(order.fortnox_order_number || quoteRow?.fortnox_offer_number);
  if (fortnoxInvolved && !fortnoxCustomerNumber) {
    try {
      fortnoxCustomerNumber = (await deps.createFortnoxCustomer(card.id)).fortnoxCustomerNumber;
    } catch (e) {
      console.error('[kundbyte] den nya kunden kunde inte läggas upp i Fortnox', { workOrderId: order.id, customerId: card.id, error: e instanceof Error ? e.message : String(e) });
      return { kind: 'fortnox_customer_failed', message: `Kunden kunde inte läggas upp i Fortnox: ${friendlyFortnoxMessage(e)}` };
    }
  }
  const update = fortnoxCustomerNumber === card.fortnox_customer_id
    ? draft
    : { ...draft, customer_snapshot: { ...(draft.customer_snapshot as Record<string, unknown>), fortnox_customer_number: fortnoxCustomerNumber } };

  // Sessionen ändrar ordern: RLS släpper bara den ansvariga och admin. Bara om den fortfarande har samma
  // kund och inte sparats sedan den lästes — uppdateringen skriver hela snapshoten, och en kontakt eller
  // märkning som någon sparade under tiden hade annars försvunnit utan att någon märkt det.
  let write = session.from('crm_work_orders').update(update).eq('id', order.id).eq('updated_at', order.updated_at);
  write = order.customer_id ? write.eq('customer_id', order.customer_id) : write.is('customer_id', null);
  const saved = await write.select('id');
  if (saved.error) throw new Error(`Kunden kunde inte bytas: ${saved.error.message}`);
  if ((saved.data ?? []).length === 0) {
    // Ingen rad ändrad: någon hann före, eller så får sessionen inte ändra ordern. UPDATE svarar utan fel i båda fallen.
    const again = await session.from('crm_work_orders').select('updated_at').eq('id', order.id).maybeSingle();
    if (again.error) throw new Error(`Arbetsordern gick inte att läsa: ${again.error.message}`);
    if (!again.data) return { kind: 'not_found' };
    return (again.data as { updated_at: string }).updated_at !== order.updated_at ? { kind: 'changed' } : { kind: 'forbidden' };
  }
  console.info('[kundbyte] arbetsordern bytte kund', { workOrderId: order.id, from: order.customer_id, to: card.id, inFortnox: Boolean(order.fortnox_order_number) });

  // Inte i Fortnox än: ordern skapas där som vanligt, på den nya kunden (orders.ts).
  if (!order.fortnox_order_number) return { kind: 'swapped', inFortnox: false, fortnoxError: null };

  try {
    const pushed = await deps.push(order.id);
    const fortnoxError = pushed.mirrorFailed
      ? 'Fortnox-ordern bytte kund, men en ändring som sparades under tiden kom inte med. Synka om arbetsordern.'
      : null;
    return { kind: 'swapped', inFortnox: true, fortnoxError };
  } catch (e) {
    console.error('[kundbyte] Fortnox-ordern kunde inte byta kund', { workOrderId: order.id, error: e instanceof Error ? e.message : String(e) });
    const reason = e instanceof FortnoxNotConnectedError || e instanceof FortnoxPushInProgressError
      ? friendlyFortnoxMessage(e)
      : `Fortnox svarade: ${friendlyFortnoxMessage(e)}`;
    return {
      kind: 'swapped',
      inFortnox: true,
      fortnoxError: `Kunden är bytt på ordern, men Fortnox-ordern bär fortfarande den gamla kunden. ${reason} Tryck Synka om när det går.`,
    };
  }
}

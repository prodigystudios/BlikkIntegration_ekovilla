import { getSupabaseAdmin } from '@/lib/supabase/server';
import { lineItemQuantity } from '@/lib/domains/crm/lineItems';
import { lineItemUnitPrice, lineItemDiscountPercent, lineItemEffectiveUnitPrice } from '@/lib/domains/crm/pricing';
import { fortnoxGet, fortnoxPost, fortnoxPut, FortnoxNotConnectedError, FortnoxPushInProgressError } from './client';
import { claimFortnoxPush, resolveReverseVat } from './helpers';
import { pushWorkOrderToFortnox } from './orders';
import { DEFAULT_ROT_HOUSE_WORK_TYPE } from './types';

// Delfakturering (partial invoicing). The app OWNS the per-article invoiced state — a Fortnox
// Order exposes only a single InvoiceReference and no per-row invoiced quantity, so we can't read
// partial progress back from Fortnox. Each round we POST a standalone draft invoice (Model B) with
// exactly that round's quantities and record what we billed. Remaining-per-article is derived from
// the frozen line_items snapshot minus the sum of prior rounds (rows matched by array index — safe
// because editing is locked from the first round on). The proven one-shot full-invoice path
// (createInvoiceFromWorkOrder → order createinvoice) is left untouched and is used only when no
// partial round has started.

// Quantity floating-point tolerance (m³ volumes are fractional). Below this two quantities are
// treated as equal — used for the "remaining" comparison and the final-round test.
const QTY_EPS = 1e-6;

const roundQty = (n: number) => Math.round(n * 1e6) / 1e6;
const roundMoney = (n: number) => Math.round(n * 100) / 100;

export type PartialInvoiceLineItem = {
  article_number?: string | null;
  article_name?: string | null;
  article_unit_name?: string | null;
  unit_price?: string | null;
  article_price?: number | null;
  quantity?: string | null;
  pricing_mode?: string | null;
  m2?: string | null;
  thickness_mm?: string | null;
  discount_percent?: string | null;
  line_note?: string | null;
  is_rot_work?: boolean | null;
  house_work_type?: string | null;
};

export type PartialRequestLine = { index: number; quantity: number };
export type InvoiceRound = { line_quantities: PartialRequestLine[] | null };
export type LineInvoiceState = { index: number; total: number; invoiced: number; remaining: number };

export type PartialInvoiceResult = {
  fortnox_invoice_number: string;
  round_number: number;
  status: 'partially_invoiced' | 'invoiced';
};

// A delfakturering validation failure (over-invoicing, nothing to invoice, bad row) — distinct
// from a Fortnox/network failure so the route can map it to a 409 with a friendly message.
export class PartialInvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartialInvoiceError';
  }
}

// Per-article invoiced-so-far + remaining, from the (frozen) line items and all prior rounds.
// `total` is the line's full quantity (m³ volume or entered quantity, via the shared resolver).
export function computeInvoiceState(lineItems: PartialInvoiceLineItem[] | null, priorRounds: InvoiceRound[]): LineInvoiceState[] {
  return (lineItems ?? []).map((item, index) => {
    const total = roundQty(lineItemQuantity(item));
    const invoiced = roundQty(
      priorRounds.reduce((sum, round) => {
        const match = (round.line_quantities ?? []).find((q) => q.index === index);
        return sum + (match ? Math.max(0, match.quantity) : 0);
      }, 0),
    );
    return { index, total, invoiced, remaining: Math.max(0, roundQty(total - invoiced)) };
  });
}

// Validate a requested round against remaining-per-line. Throws PartialInvoiceError on
// over-invoicing or an all-zero request. Returns the (deduped, positive-only) quantities keyed by
// line index and whether this round invoices the last of every line (→ status 'invoiced').
export function validatePartialRequest(
  state: LineInvoiceState[],
  request: PartialRequestLine[],
): { requestByIndex: Map<number, number>; isFinalRound: boolean } {
  const byIndex = new Map<number, number>();
  for (const line of request) {
    const qty = Math.max(0, line.quantity);
    if (qty <= 0) continue;
    const st = state.find((s) => s.index === line.index);
    if (!st) throw new PartialInvoiceError(`Ogiltig rad (index ${line.index}).`);
    const next = roundQty((byIndex.get(line.index) ?? 0) + qty);
    if (next > st.remaining + QTY_EPS) {
      throw new PartialInvoiceError(`Antal att fakturera överstiger återstående för rad ${line.index + 1}.`);
    }
    byIndex.set(line.index, next);
  }
  if (![...byIndex.values()].some((q) => q > 0)) {
    throw new PartialInvoiceError('Inget antal att fakturera angavs.');
  }
  // Final round when, after billing this round, every line's remaining reaches zero.
  const isFinalRound = state.every((s) => s.remaining - (byIndex.get(s.index) ?? 0) <= QTY_EPS);
  return { requestByIndex: byIndex, isFinalRound };
}

// Build Fortnox INVOICE rows for this round. NOTE: invoice rows use `DeliveredQuantity` (order
// rows use OrderedQuantity, offer rows use Quantity). Quantity is this round's per-line amount;
// only lines with a positive quantity produce a row. Discount/ROT mapping mirrors buildOrderRows.
export function buildInvoiceRows(
  lineItems: PartialInvoiceLineItem[] | null,
  requestByIndex: Map<number, number>,
  vatPercent: number,
  rotEnabled: boolean,
  reverseVat = false,
) {
  const rows: Array<Record<string, unknown>> = [];
  (lineItems ?? []).forEach((item, index) => {
    const qty = requestByIndex.get(index) ?? 0;
    if (qty <= 0) return;
    const discount = lineItemDiscountPercent(item);
    rows.push({
      ...(item.article_number ? { ArticleNumber: item.article_number } : {}),
      Description: item.article_name || item.line_note || 'Artikel',
      DeliveredQuantity: qty,
      Price: lineItemUnitPrice(item),
      // Reverse charge (byggmoms) → 0 % VAT; the invoice's VAT regime comes from the customer
      // card (synced from reverse_vat), so we match the row VAT to keep the document consistent.
      VAT: reverseVat ? 0 : vatPercent,
      ...(item.article_unit_name ? { Unit: item.article_unit_name } : {}),
      ...(discount > 0 ? { Discount: discount, DiscountType: 'PERCENT' as const } : {}),
      ...(rotEnabled && item.is_rot_work
        ? { HouseWork: true, HouseWorkType: item.house_work_type || DEFAULT_ROT_HOUSE_WORK_TYPE }
        : {}),
    });
  });
  return rows;
}

// This round's subtotal ex VAT (quantity × discounted unit price), matching pricing_summary.subtotal.
export function roundSubtotal(lineItems: PartialInvoiceLineItem[] | null, requestByIndex: Map<number, number>): number {
  let sum = 0;
  (lineItems ?? []).forEach((item, index) => {
    const qty = requestByIndex.get(index) ?? 0;
    if (qty <= 0) return;
    sum += qty * lineItemEffectiveUnitPrice(item);
  });
  return roundMoney(sum);
}

type WorkOrderRow = {
  id: string;
  status: string;
  project_name: string | null;
  vat_percent: number | null;
  customer_id: string | null;
  customer_snapshot: { reverse_vat?: boolean | null } | null;
  line_items: PartialInvoiceLineItem[] | null;
  line_items_invoicing_snapshot: PartialInvoiceLineItem[] | null;
  partial_invoicing_started_at: string | null;
  fortnox_order_number: string | null;
  rot_details: { enabled?: boolean | null } | null;
};

type FortnoxOrderHeader = {
  CustomerNumber?: string | number;
  OurReference?: string | null;
  YourReference?: string | null;
  DeliveryAddress1?: string | null;
  DeliveryZipCode?: string | null;
  DeliveryCity?: string | null;
};

// Create ONE partial-invoice round: validate the requested quantities against remaining, ensure
// the Fortnox order exists (its header is the source for customer/references/delivery), POST a
// standalone draft invoice with this round's rows, then record the round and advance the work
// order to 'partially_invoiced' (or 'invoiced' when the last of every line is billed). Guarded by
// the same atomic claim as the full-invoice push so a double-submit can't create two invoices.
export async function createPartialInvoice(
  workOrderId: string,
  request: PartialRequestLine[],
  actorUserId: string | null,
): Promise<PartialInvoiceResult> {
  const supabase = getSupabaseAdmin();

  const { data: workOrder, error } = await supabase
    .from('crm_work_orders')
    .select('id, status, project_name, vat_percent, customer_id, customer_snapshot, line_items, line_items_invoicing_snapshot, partial_invoicing_started_at, fortnox_order_number, rot_details')
    .eq('id', workOrderId)
    .single<WorkOrderRow>();

  if (error || !workOrder) throw new Error(`Arbetsorder ${workOrderId} hittades inte`);

  if (workOrder.status !== 'completed' && workOrder.status !== 'partially_invoiced') {
    throw new PartialInvoiceError('Sätt arbetsordern till "Fakturera" innan du delfakturerar.');
  }

  // Frozen basis: the snapshot taken at the first round (falls back to current line_items before
  // any round exists). Per-article remaining is always measured against this, never the live rows.
  const basis = workOrder.line_items_invoicing_snapshot ?? workOrder.line_items;

  // Validate BEFORE claiming so a bad request doesn't flip the sync status to pending.
  const { data: priorRoundsData } = await supabase
    .from('crm_work_order_invoices')
    .select('round_number, line_quantities, fortnox_invoice_number')
    .eq('work_order_id', workOrderId)
    .order('round_number', { ascending: true });
  const priorRounds = (priorRoundsData ?? []) as Array<{ round_number: number; line_quantities: PartialRequestLine[] | null; fortnox_invoice_number: string | null }>;
  const roundNumber = (priorRounds.length ? Math.max(...priorRounds.map((r) => r.round_number)) : 0) + 1;

  const state = computeInvoiceState(basis, priorRounds);
  const { requestByIndex, isFinalRound } = validatePartialRequest(state, request);

  const claimed = await claimFortnoxPush(
    supabase, 'crm_work_orders', workOrderId, 'fortnox_invoice_sync_status', 'fortnox_invoice_claimed_at',
  );
  if (!claimed) throw new FortnoxPushInProgressError();

  try {
    const vatPercent = typeof workOrder.vat_percent === 'number' ? workOrder.vat_percent : 25;
    // Reverse charge (byggmoms) excludes ROT and forces 0 % rows + SEREVERSEDVAT on the invoice.
    const reverseVat = await resolveReverseVat(supabase, workOrder.customer_snapshot?.reverse_vat, workOrder.customer_id);
    const rotEnabled = workOrder.rot_details?.enabled === true && !reverseVat;

    // The invoice is independent, but we mirror the order's header (customer/references/delivery)
    // so the partial invoices match the order confirmation. Ensure the order exists first — this
    // also guarantees the customer is synced to Fortnox.
    let orderNumber = workOrder.fortnox_order_number;
    if (!orderNumber) {
      const pushed = await pushWorkOrderToFortnox(workOrderId);
      orderNumber = pushed.fortnox_order_number;
    }
    const order = await fortnoxGet<{ Order?: FortnoxOrderHeader }>(`/orders/${orderNumber}`);
    const header = order.Order ?? {};
    if (header.CustomerNumber == null) throw new Error('Fortnox-ordern saknar kundkoppling');

    const invoiceRows = buildInvoiceRows(basis, requestByIndex, vatPercent, rotEnabled, reverseVat);
    if (!invoiceRows.length) throw new PartialInvoiceError('Inget antal att fakturera angavs.');

    // A partial invoice is a STANDALONE Fortnox invoice (it can't use the order's createinvoice,
    // which would lock the order after one round), so it lacks the native order↔invoice link.
    // Stamp a human-readable reference into Remarks ("Övrigt") + YourOrderNumber so whoever handles
    // invoicing in Fortnox — who may not have the CRM — can see which order this invoice belongs to.
    const projectName = workOrder.project_name?.trim();
    const remarks = `Delfaktura ${roundNumber} – avser order ${orderNumber}${projectName ? ` – ${projectName}` : ''}`;

    const response = await fortnoxPost<{ Invoice?: { DocumentNumber?: string | number } }>('/invoices', {
      Invoice: {
        CustomerNumber: String(header.CustomerNumber),
        InvoiceDate: new Date().toISOString().slice(0, 10),
        Remarks: remarks,
        YourOrderNumber: String(orderNumber),
        ...(header.OurReference ? { OurReference: header.OurReference } : {}),
        ...(header.YourReference ? { YourReference: header.YourReference } : {}),
        // No VATType on the payload (kept consistent with offers/orders): the customer card drives
        // the VAT regime and rows carry the matching VAT (0 % for reverse charge, see
        // buildInvoiceRows) so header and rows never diverge.
        ...(rotEnabled ? { TaxReductionType: 'rot' } : {}),
        ...(header.DeliveryAddress1
          ? {
              DeliveryAddress1: header.DeliveryAddress1,
              ...(header.DeliveryZipCode ? { DeliveryZipCode: header.DeliveryZipCode } : {}),
              ...(header.DeliveryCity ? { DeliveryCity: header.DeliveryCity } : {}),
            }
          : {}),
        InvoiceRows: invoiceRows,
      },
    });

    const invoiceNumber = response.Invoice?.DocumentNumber != null ? String(response.Invoice.DocumentNumber) : '';
    if (!invoiceNumber) throw new Error('Fortnox returnerade inget fakturanummer');

    const lineQuantities = [...requestByIndex.entries()].map(([index, quantity]) => ({ index, quantity }));

    await supabase.from('crm_work_order_invoices').insert({
      work_order_id: workOrderId,
      round_number: roundNumber,
      fortnox_invoice_number: invoiceNumber,
      fortnox_sync_status: 'synced',
      amount: roundSubtotal(basis, requestByIndex),
      line_quantities: lineQuantities,
      created_by: actorUserId,
    });

    const status: 'partially_invoiced' | 'invoiced' = isFinalRound ? 'invoiced' : 'partially_invoiced';
    const nowIso = new Date().toISOString();
    await supabase
      .from('crm_work_orders')
      .update({
        fortnox_invoice_sync_status: 'synced',
        status,
        // Freeze the basis + mark the start at the first round so editing locks and remaining math
        // stays stable across rounds.
        ...(workOrder.line_items_invoicing_snapshot ? {} : { line_items_invoicing_snapshot: workOrder.line_items }),
        ...(workOrder.partial_invoicing_started_at ? {} : { partial_invoicing_started_at: nowIso }),
        // The terminal fortnox_invoice_number/at mirror the LAST round, for the existing card + reports.
        ...(isFinalRound ? { fortnox_invoice_number: invoiceNumber, fortnox_invoiced_at: nowIso } : {}),
      })
      .eq('id', workOrderId);

    // Annotate the Fortnox order's internal Comments so finance can see it's been (part-)invoiced
    // via standalone invoices — the order keeps no native InvoiceReference in this flow. Uses
    // Comments (internal), NOT Remarks (printed on the customer's order confirmation). Non-fatal:
    // the invoice is already created, so a failed annotation must not fail the round.
    try {
      const invoiceNumbers = [...priorRounds.map((r) => r.fortnox_invoice_number).filter(Boolean), invoiceNumber];
      const statusLabel = isFinalRound ? 'Fulldelfakturerad (avslutad)' : 'Delfakturerad';
      const comment = `${statusLabel} i CRM – fakturor: ${invoiceNumbers.join(', ')}`;
      await fortnoxPut(`/orders/${orderNumber}`, { Order: { Comments: comment } });
    } catch (annotateErr) {
      console.error('[Fortnox] kunde inte annotera order vid delfaktura:', (annotateErr as Error)?.message);
    }

    return { fortnox_invoice_number: invoiceNumber, round_number: roundNumber, status };
  } catch (e) {
    const syncStatus = e instanceof FortnoxNotConnectedError ? 'not_synced' : 'failed';
    await supabase
      .from('crm_work_orders')
      .update({ fortnox_invoice_sync_status: syncStatus })
      .eq('id', workOrderId);
    throw e;
  }
}

// "Fakturera allt" once delfakturering has already started: invoice every line's remaining quantity
// in a single final round (→ status 'invoiced'). Used by the existing invoice route when a partial
// round exists, so it never re-runs the order createinvoice (which would re-bill the full order).
export async function invoiceRemainingForWorkOrder(workOrderId: string, actorUserId: string | null): Promise<PartialInvoiceResult> {
  const supabase = getSupabaseAdmin();

  const { data: workOrder, error } = await supabase
    .from('crm_work_orders')
    .select('line_items, line_items_invoicing_snapshot')
    .eq('id', workOrderId)
    .single<{ line_items: PartialInvoiceLineItem[] | null; line_items_invoicing_snapshot: PartialInvoiceLineItem[] | null }>();
  if (error || !workOrder) throw new Error(`Arbetsorder ${workOrderId} hittades inte`);

  const basis = workOrder.line_items_invoicing_snapshot ?? workOrder.line_items;

  const { data: priorRoundsData } = await supabase
    .from('crm_work_order_invoices')
    .select('line_quantities')
    .eq('work_order_id', workOrderId);
  const state = computeInvoiceState(basis, (priorRoundsData ?? []) as InvoiceRound[]);

  const request = state.filter((s) => s.remaining > QTY_EPS).map((s) => ({ index: s.index, quantity: s.remaining }));
  if (!request.length) throw new PartialInvoiceError('Det finns inget kvar att fakturera.');

  return createPartialInvoice(workOrderId, request, actorUserId);
}

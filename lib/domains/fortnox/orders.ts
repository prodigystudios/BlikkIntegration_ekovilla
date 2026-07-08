import { getSupabaseAdmin } from '@/lib/supabase/server';
import { lineItemQuantity } from '@/lib/domains/crm/lineItems';
import { lineItemUnitPrice, lineItemDiscountPercent, lineItemRowTotal } from '@/lib/domains/crm/pricing';
import { fortnoxGet, fortnoxGetBinary, fortnoxPost, fortnoxPut, FortnoxApiError, FortnoxNotConnectedError, FortnoxPushInProgressError } from './client';
import { appendFortnoxTextNote, buildEndContactNote, buildRotPropertyNote, claimFortnoxPush, resolveOurReference, resolveReverseVat, rotLaborRow, rowRotLaborCarveout, splitRotMaterialRow } from './helpers';
import { DEFAULT_ROT_HOUSE_WORK_TYPE } from './types';

type WorkOrderRow = {
  id: string;
  quote_id: string | null;
  customer_id: string | null;
  assigned_to: string | null;
  customer_snapshot: {
    contact_name?: string | null;
    delivery_address?: string | null;
    delivery_postal_code?: string | null;
    delivery_city?: string | null;
    postal_code?: string | null;
    city?: string | null;
    reverse_vat?: boolean | null;
    end_contact_name?: string | null;
    end_contact_phone?: string | null;
    end_contact_email?: string | null;
    label?: string | null;
  } | null;
  project_name: string;
  client_name: string | null;
  amount: number;
  vat_percent: number | null;
  currency_code: string;
  fortnox_order_number: string | null;
  line_items: Array<{
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
    // Labour carved out of a material row for ROT — summed onto the aggregated "Arbetskostnad ROT" row.
    labor_cost?: string | null;
  }> | null;
};

export type PushOrderResult = {
  fortnox_order_number: string;
};

export type CreateInvoiceResult = {
  fortnox_invoice_number: string;
};

type FortnoxOrderRow = {
  ArticleNumber?: string;
  Description: string;
  OrderedQuantity?: number;
  DeliveredQuantity?: number;
  Price?: number;
  VAT?: number;
  Unit?: string;
  Discount?: number;
  DiscountType?: 'PERCENT' | 'AMOUNT';
  HouseWork?: boolean;
  HouseWorkType?: string;
};

// A text-only order row: Description with no article/quantities, so Fortnox renders it as a
// comment line under the article (carries the per-row free text / Radtext).
// NOTE: if a Fortnox test company rejects a text-only /orders row, the fallback is to append
// the Radtext to the article row's Description instead — the offer side is unaffected.
function orderTextRow(description: string): FortnoxOrderRow {
  return { Description: description };
}

// Exported for tests. NOTE: Fortnox order rows use `OrderedQuantity` (offer rows use
// `Quantity`, invoice rows use `DeliveredQuantity`) — sending `Quantity` to /orders
// returns 400 "Felaktigt fältnamn (Quantity)".
export function buildOrderRows(lineItems: WorkOrderRow['line_items'], vatPercent: number, rotEnabled: boolean, reverseVat = false, rotPropertyNote: string | null = null): FortnoxOrderRow[] {
  if (!lineItems?.length) return [];

  // Accumulates the labour carved out of material rows (kr, ex VAT), emitted as one aggregated
  // "Arbetskostnad ROT" row after the loop. Mirrors buildOfferRows so offer→order stays consistent.
  let carvedLaborTotal = 0;

  const rows = lineItems.flatMap((item) => {
    // Shared CRM pricing helpers (single source of truth) — identical parse/clamp/total logic as the
    // quote form, work-order editor and partialInvoices, so the order row can never drift from them.
    const price = lineItemUnitPrice(item);
    // For m³ rows the quantity is the computed volume, not the (empty) quantity field.
    const quantity = lineItemQuantity(item);
    const discount = lineItemDiscountPercent(item);

    // ROT labour carved out of THIS material row — removed from the row and re-booked onto the
    // aggregated husarbete row below, leaving the order total unchanged. See buildOfferRows. The
    // split rounds the material unit price and lets the labour absorb the residual so the two rows'
    // rounded totals still sum to the row total (no drift on non-divisible quantities).
    const rowNet = lineItemRowTotal(item);
    const carve = rowRotLaborCarveout(item, rowNet, rotEnabled);
    const split = carve > 0 ? splitRotMaterialRow(rowNet, quantity, carve) : null;
    if (split) carvedLaborTotal += split.labour;

    const row: FortnoxOrderRow = {
      ...(item.article_number ? { ArticleNumber: item.article_number } : {}),
      Description: item.article_name || item.line_note || 'Artikel',
      // Fortnox invoices the DELIVERED quantity. A work order is the basis for invoicing
      // the full completed job, so delivered = ordered (otherwise the row sum stays 0 /
      // stale on new or edited rows).
      OrderedQuantity: quantity,
      DeliveredQuantity: quantity,
      // When labour is carved out this row is material only: the unit price becomes the reduced
      // material net (discount baked in) so quantity × price nets to it; otherwise the raw price +
      // a separate Discount % line, as before.
      Price: split ? split.materialUnitPrice : price,
      // Reverse charge (omvänd skattskyldighet / byggmoms) → 0 % output VAT on rows; the document's
      // VAT regime comes from the customer card (synced from reverse_vat), so matching rows here.
      VAT: reverseVat ? 0 : vatPercent,
      ...(item.article_unit_name ? { Unit: item.article_unit_name } : {}),
      // DiscountType:'PERCENT' is required — Fortnox defaults to AMOUNT (kronor), which would
      // book discount_percent as a kronor discount and diverge from the CRM total. Dropped on a
      // carved material row (baked into the price above).
      ...(carve === 0 && discount > 0 ? { Discount: discount, DiscountType: 'PERCENT' as const } : {}),
      // Husarbete only on a ROT document, and only for rows flagged fully as ROT work (a carved
      // material row is NOT husarbete). Do NOT send HouseWork:false on non-ROT rows — Fortnox
      // stamps an empty husarbete type ('EMPTYHOUSEWORK') that a non-ROT document rejects
      // (2004021). See offers.ts. A husarbete-configured article is fixed in Fortnox, not here.
      ...(carve === 0 && rotEnabled && item.is_rot_work
        ? { HouseWork: true, HouseWorkType: item.house_work_type || DEFAULT_ROT_HOUSE_WORK_TYPE }
        : {}),
    };
    // The per-row free text (Radtext) gets its own text row — only when an article name is
    // present, since otherwise it is already the row Description (the fallback above).
    const lineNote = item.line_note?.trim();
    if (lineNote && item.article_name?.trim()) return [row, orderTextRow(lineNote)];
    return [row];
  });

  // One aggregated "Arbetskostnad ROT" husarbete row for all carved labour (kept out of line_items —
  // synthesised only at push time). ROT and reverse charge never co-occur, so VAT is just vatPercent.
  const laborRow = rotLaborRow(carvedLaborTotal, reverseVat ? 0 : vatPercent);
  if (laborRow) rows.push({ ...laborRow, OrderedQuantity: 1, DeliveredQuantity: 1 });

  // ROT property note (Fastighetsbeteckning / BRF org.nr) as a trailing text row — Fortnox has no
  // API field for it. Only relevant for a standalone order with ROT (the offer→order path inherits
  // the offer's rows, which already carry it); the caller passes null otherwise.
  return appendFortnoxTextNote(rows, rotPropertyNote);
}

// Resolves the Fortnox customer number from an already-fetched linked quote.
// Checks customer_source first, then falls back to crm_customers.fortnox_customer_id.
async function resolveCustomerNumberFromQuote(
  linkedQuote: { customer_source: { kind?: string; fortnox_customer_id?: string } | null; customer_id: string | null } | null,
  supabase: ReturnType<typeof getSupabaseAdmin>,
): Promise<string | null> {
  if (!linkedQuote) return null;

  if (linkedQuote.customer_source?.kind === 'fortnox' && linkedQuote.customer_source.fortnox_customer_id) {
    return linkedQuote.customer_source.fortnox_customer_id;
  }

  if (linkedQuote.customer_id) {
    return resolveFortnoxCustomerNumberById(linkedQuote.customer_id, supabase);
  }

  return null;
}

// Look up a customer's Fortnox number directly (used for standalone orders whose customer
// lives on the work order, not on a quote).
async function resolveFortnoxCustomerNumberById(
  customerId: string,
  supabase: ReturnType<typeof getSupabaseAdmin>,
): Promise<string | null> {
  const { data } = await supabase
    .from('crm_customers')
    .select('fortnox_customer_id')
    .eq('id', customerId)
    .maybeSingle();
  return (data as { fortnox_customer_id?: string | null } | null)?.fortnox_customer_id ?? null;
}

// Push a CRM work order to Fortnox as an order.
// If the linked quote already has a Fortnox offer number, converts that offer to an order
// (preserving the offer→order link in Fortnox). Otherwise creates a standalone order.
export async function pushWorkOrderToFortnox(workOrderId: string): Promise<PushOrderResult> {
  const supabase = getSupabaseAdmin();

  const { data: workOrder, error } = await supabase
    .from('crm_work_orders')
    .select('id, quote_id, customer_id, assigned_to, customer_snapshot, project_name, client_name, amount, vat_percent, currency_code, line_items, fortnox_order_number')
    .eq('id', workOrderId)
    .single<WorkOrderRow>();

  if (error || !workOrder) throw new Error(`Arbetsorder ${workOrderId} hittades inte`);

  // Idempotency: if this work order is already linked to a Fortnox order, don't try
  // to create another one — Fortnox rejects a second createorder on the same offer
  // (error 2000499). Just confirm the synced state and return the existing number.
  if (workOrder.fortnox_order_number) {
    await supabase
      .from('crm_work_orders')
      .update({ fortnox_order_sync_status: 'synced', fortnox_order_synced_at: new Date().toISOString() })
      .eq('id', workOrderId);
    return { fortnox_order_number: workOrder.fortnox_order_number };
  }

  // Atomically claim the push so a concurrent request can't create a SECOND Fortnox order
  // for this work order (the create branch below has no Fortnox-side dedup for standalone
  // POST /orders). If we lose the claim, a fresh push is already in flight.
  const claimed = await claimFortnoxPush(
    supabase, 'crm_work_orders', workOrderId, 'fortnox_order_sync_status', 'fortnox_order_claimed_at',
  );
  if (!claimed) throw new FortnoxPushInProgressError();

  try {
    let fortnoxOrderNumber: string;

    // Fetch linked quote data in one query – used for offer number, customer resolution,
    // and reference fields on standalone orders.
    type LinkedQuote = {
      fortnox_offer_number: string | null;
      customer_id: string | null;
      customer_source: { kind?: string; fortnox_customer_id?: string } | null;
      assigned_to: string | null;
      customer_snapshot: {
        contact_name?: string | null;
        delivery_address?: string | null;
        delivery_postal_code?: string | null;
        delivery_city?: string | null;
        postal_code?: string | null;
        city?: string | null;
        reverse_vat?: boolean | null;
        end_contact_name?: string | null;
        end_contact_phone?: string | null;
        end_contact_email?: string | null;
        label?: string | null;
      } | null;
      rot_details: { enabled?: boolean | null; property_designation?: string | null; brf_org_number?: string | null } | null;
    };

    const linkedQuote: LinkedQuote | null = workOrder.quote_id
      ? await (async () => {
          const { data } = await supabase
            .from('crm_quotes')
            .select('fortnox_offer_number, customer_id, customer_source, assigned_to, customer_snapshot, rot_details')
            .eq('id', workOrder.quote_id!)
            .maybeSingle();
          return data as LinkedQuote | null;
        })()
      : null;

    const fortnoxOfferNumber = linkedQuote?.fortnox_offer_number ?? null;

    if (fortnoxOfferNumber) {
      // Convert existing Fortnox offer → order.
      // Fortnox carries OurReference, YourReference, and DeliveryAddress from the offer automatically.
      let resolved = '';
      try {
        const response = await fortnoxPut<{ Order?: { DocumentNumber?: string | number } }>(
          `/offers/${fortnoxOfferNumber}/createorder`,
        );
        if (response.Order?.DocumentNumber != null) resolved = String(response.Order.DocumentNumber);
      } catch (e) {
        // 2000499 = the offer already has an order (a prior push converted it). Any other
        // error is a real failure and must propagate.
        const message = String((e as any)?.message || '');
        if (!message.includes('2000499') && !message.toLowerCase().includes('redan en skapad order')) throw e;
      }
      // At this point the order exists in Fortnox (just created, or already converted) but
      // we may not have captured its number — the createorder response shape can vary, or
      // the order already existed. Resolve it from the offer's OrderReference so a created
      // order is never reported as failed.
      if (!resolved) {
        const offer = await fortnoxGet<{ Offer?: { OrderReference?: number | string | null } }>(`/offers/${fortnoxOfferNumber}`);
        const existing = offer.Offer?.OrderReference;
        if (!existing) throw new Error('Fortnox returnerade inget ordernummer vid konvertering');
        resolved = String(existing);
      }
      fortnoxOrderNumber = resolved;
    } else {
      // No Fortnox offer exists – create a standalone order with full reference data.
      // Resolve the customer from the linked quote, or — for a truly standalone order
      // (no quote) — from the work order's own customer.
      const customerNumber =
        (await resolveCustomerNumberFromQuote(linkedQuote, supabase)) ??
        (workOrder.customer_id ? await resolveFortnoxCustomerNumberById(workOrder.customer_id, supabase) : null);
      if (!customerNumber) {
        throw new Error(
          'Ingen Fortnox-kundkoppling hittades. Kunden måste vara synkad till Fortnox.',
        );
      }

      const ourReference = await resolveOurReference(linkedQuote?.assigned_to ?? workOrder.assigned_to ?? null, supabase);

      const snapshot = linkedQuote?.customer_snapshot ?? workOrder.customer_snapshot;
      // Work/job address (Fortnox delivery): street is the anchor; postal/city sent as
      // entered, not borrowed from the customer address. Matches the work order's address.
      const deliveryAddress = snapshot?.delivery_address;
      const deliveryZip = snapshot?.delivery_postal_code;
      const deliveryCity = snapshot?.delivery_city;

      const vatPercent = typeof workOrder.vat_percent === 'number' ? workOrder.vat_percent : 25;
      // Reverse charge (byggmoms) excludes ROT and forces 0 % rows + SEREVERSEDVAT on the order.
      const reverseVat = await resolveReverseVat(
        supabase,
        snapshot?.reverse_vat,
        linkedQuote?.customer_id ?? workOrder.customer_id,
      );
      const rotEnabled = linkedQuote?.rot_details?.enabled === true && !reverseVat;
      // "Ert referensnummer" (order field = YourOrderNumber): ROT villa fastighetsbeteckning, else
      // the företag märkning (snapshot.label). Mirrors offers.ts; standalone ROT is a rare path.
      // Bostadsrätt (BRF) can't use one field → text row via buildRotPropertyNote.
      const hasProperty = rotEnabled && !!linkedQuote?.rot_details?.property_designation?.trim();
      const hasBrf = rotEnabled && !!linkedQuote?.rot_details?.brf_org_number?.trim();
      const propertyAsRef = hasProperty && !hasBrf;
      const referenceNumber = propertyAsRef
        ? linkedQuote!.rot_details!.property_designation!.trim()
        : (snapshot?.label?.trim() || null);
      const rotPropertyNote = propertyAsRef ? null : (rotEnabled ? buildRotPropertyNote(linkedQuote?.rot_details) : null);
      const orderRows = buildOrderRows(workOrder.line_items, vatPercent, rotEnabled, reverseVat, rotPropertyNote);

      const response = await fortnoxPost<{ Order: { DocumentNumber: string } }>('/orders', {
        Order: {
          CustomerNumber: customerNumber,
          OrderDate: new Date().toISOString().slice(0, 10),
          ...(ourReference ? { OurReference: ourReference } : {}),
          ...(snapshot?.contact_name ? { YourReference: snapshot.contact_name } : {}),
          // "Ert referensnummer" — order field is YourOrderNumber (offer uses YourReferenceNumber).
          ...(referenceNumber ? { YourOrderNumber: referenceNumber } : {}),
          // No VATType on the payload (Fortnox rejects it on offers; we keep orders consistent):
          // the customer card drives the VAT regime, and rows carry the matching VAT (0 % for
          // reverse charge, see buildOrderRows) so header and rows never diverge.
          ...(rotEnabled ? { TaxReductionType: 'rot' } : {}),
          ...(buildEndContactNote(snapshot) ? { Remarks: buildEndContactNote(snapshot) } : {}),
          ...(deliveryAddress
            ? {
                DeliveryAddress1: deliveryAddress,
                ...(deliveryZip ? { DeliveryZipCode: deliveryZip } : {}),
                ...(deliveryCity ? { DeliveryCity: deliveryCity } : {}),
              }
            : {}),
          OrderRows: orderRows,
        },
      });
      fortnoxOrderNumber = response.Order?.DocumentNumber;
      if (!fortnoxOrderNumber) throw new Error('Fortnox returnerade inget ordernummer');
    }

    await supabase
      .from('crm_work_orders')
      .update({
        fortnox_order_number: fortnoxOrderNumber,
        fortnox_order_sync_status: 'synced',
        fortnox_order_synced_at: new Date().toISOString(),
      })
      .eq('id', workOrderId);

    return { fortnox_order_number: fortnoxOrderNumber };
  } catch (e) {
    const syncStatus = e instanceof FortnoxNotConnectedError ? 'not_synced' : 'failed';
    await supabase
      .from('crm_work_orders')
      .update({ fortnox_order_sync_status: syncStatus })
      .eq('id', workOrderId);
    throw e;
  }
}

// Create a DRAFT invoice in Fortnox from the work order's Fortnox order
// (PUT /orders/{n}/createinvoice). Fortnox carries the customer, rows, delivered
// quantities, ROT and references from the order automatically — we only create the
// draft; bookkeeping/sending is done by finance inside Fortnox. Idempotent: a work order
// that already has an invoice number returns it without creating a second invoice. On
// success the work order is moved to status `invoiced` ("Avslutad").
export async function createInvoiceFromWorkOrder(workOrderId: string): Promise<CreateInvoiceResult> {
  const supabase = getSupabaseAdmin();

  const { data: workOrder, error } = await supabase
    .from('crm_work_orders')
    .select('id, fortnox_order_number, fortnox_invoice_number')
    .eq('id', workOrderId)
    .single<{ id: string; fortnox_order_number: string | null; fortnox_invoice_number: string | null }>();

  if (error || !workOrder) throw new Error(`Arbetsorder ${workOrderId} hittades inte`);

  // Idempotency: already invoiced → confirm synced and return the existing number.
  if (workOrder.fortnox_invoice_number) {
    await supabase
      .from('crm_work_orders')
      .update({ fortnox_invoice_sync_status: 'synced' })
      .eq('id', workOrderId);
    return { fortnox_invoice_number: workOrder.fortnox_invoice_number };
  }

  // Atomically claim the invoice push so a double-click / retry can't create TWO draft
  // invoices (Fortnox's createinvoice can succeed before the order shows as invoiced).
  const claimed = await claimFortnoxPush(
    supabase, 'crm_work_orders', workOrderId, 'fortnox_invoice_sync_status', 'fortnox_invoice_claimed_at',
  );
  if (!claimed) throw new FortnoxPushInProgressError();

  try {
    // The invoice is created FROM the Fortnox order, so the order must exist there first.
    // Ensure it's synced (creates it if missing; idempotent if already synced).
    let orderNumber = workOrder.fortnox_order_number;
    if (!orderNumber) {
      const pushed = await pushWorkOrderToFortnox(workOrderId);
      orderNumber = pushed.fortnox_order_number;
    }

    let invoiceNumber = '';
    try {
      const response = await fortnoxPut<{ Invoice?: { DocumentNumber?: string | number } }>(
        `/orders/${orderNumber}/createinvoice`,
      );
      if (response.Invoice?.DocumentNumber != null) invoiceNumber = String(response.Invoice.DocumentNumber);
    } catch (createErr) {
      // createinvoice fails if the order was already (fully) invoiced. Recover the existing
      // invoice via the order's InvoiceReference; if there's none, the failure is real.
      const order = await fortnoxGet<{ Order?: { InvoiceReference?: number | string | null } }>(`/orders/${orderNumber}`).catch(() => null);
      const existing = order?.Order?.InvoiceReference;
      if (!existing) throw createErr;
      invoiceNumber = String(existing);
    }

    // Response without a number but no error — resolve from the order's InvoiceReference.
    if (!invoiceNumber) {
      const order = await fortnoxGet<{ Order?: { InvoiceReference?: number | string | null } }>(`/orders/${orderNumber}`);
      const existing = order.Order?.InvoiceReference;
      if (!existing) throw new Error('Fortnox returnerade inget fakturanummer');
      invoiceNumber = String(existing);
    }

    await supabase
      .from('crm_work_orders')
      .update({
        fortnox_invoice_number: invoiceNumber,
        fortnox_invoice_sync_status: 'synced',
        fortnox_invoiced_at: new Date().toISOString(),
        status: 'invoiced',
      })
      .eq('id', workOrderId);

    return { fortnox_invoice_number: invoiceNumber };
  } catch (e) {
    const syncStatus = e instanceof FortnoxNotConnectedError ? 'not_synced' : 'failed';
    await supabase
      .from('crm_work_orders')
      .update({ fortnox_invoice_sync_status: syncStatus })
      .eq('id', workOrderId);
    throw e;
  }
}

// Push edited article rows to an already-synced Fortnox order (PUT replaces all rows).
// If the order was never synced, falls back to the create path. Used after the work
// order's line_items are edited so Fortnox reflects the corrected areas/articles before
// invoicing. Fortnox rejects edits to an invoiced/cancelled order — that surfaces as the
// thrown error and the sync status flips to 'failed'.
export async function updateWorkOrderInFortnox(workOrderId: string): Promise<PushOrderResult> {
  const supabase = getSupabaseAdmin();

  const { data: workOrder, error } = await supabase
    .from('crm_work_orders')
    .select('id, quote_id, customer_id, customer_snapshot, vat_percent, fortnox_order_number, line_items')
    .eq('id', workOrderId)
    .single<WorkOrderRow>();

  if (error || !workOrder) throw new Error(`Arbetsorder ${workOrderId} hittades inte`);

  // Not yet in Fortnox → create it (which also stores the number + synced state).
  if (!workOrder.fortnox_order_number) {
    return pushWorkOrderToFortnox(workOrderId);
  }

  await supabase
    .from('crm_work_orders')
    .update({ fortnox_order_sync_status: 'pending' })
    .eq('id', workOrderId);

  try {
    type EditRotDetails = { enabled?: boolean | null; property_designation?: string | null; brf_org_number?: string | null };
    const { data: linkedQuote } = workOrder.quote_id
      ? await supabase.from('crm_quotes').select('rot_details').eq('id', workOrder.quote_id).maybeSingle()
      : { data: null as { rot_details: EditRotDetails | null } | null };

    const vatPercent = typeof workOrder.vat_percent === 'number' ? workOrder.vat_percent : 25;
    // Reverse charge (byggmoms) must be honoured on the edit-resync too, else editing an article
    // re-PUTs the order at 25 % VAT and silently un-does the 0 %-rate push. ROT is excluded then.
    const reverseVat = await resolveReverseVat(supabase, workOrder.customer_snapshot?.reverse_vat, workOrder.customer_id);
    const rotDetails = (linkedQuote as { rot_details?: EditRotDetails | null } | null)?.rot_details ?? null;
    const rotEnabled = rotDetails?.enabled === true && !reverseVat;
    // This PUT replaces ALL OrderRows, so a ROT property note that rides as a text ROW (bostadsrätt)
    // would be WIPED unless we regenerate it here. Villa/företag put it in YourOrderNumber (header),
    // which this rows-only PUT doesn't touch, so their note stays null here. Mirrors the create path.
    const hasProperty = rotEnabled && !!rotDetails?.property_designation?.trim();
    const hasBrf = rotEnabled && !!rotDetails?.brf_org_number?.trim();
    const propertyAsRef = hasProperty && !hasBrf;
    const rotPropertyNote = propertyAsRef ? null : (rotEnabled ? buildRotPropertyNote(rotDetails) : null);
    const orderRows = buildOrderRows(workOrder.line_items, vatPercent, rotEnabled, reverseVat, rotPropertyNote);

    await fortnoxPut(`/orders/${workOrder.fortnox_order_number}`, { Order: { OrderRows: orderRows } });

    await supabase
      .from('crm_work_orders')
      .update({ fortnox_order_sync_status: 'synced', fortnox_order_synced_at: new Date().toISOString() })
      .eq('id', workOrderId);

    return { fortnox_order_number: workOrder.fortnox_order_number };
  } catch (e) {
    const syncStatus = e instanceof FortnoxNotConnectedError ? 'not_synced' : 'failed';
    await supabase.from('crm_work_orders').update({ fortnox_order_sync_status: syncStatus }).eq('id', workOrderId);
    throw e;
  }
}

// Resolve a work order's synced Fortnox order number, or throw a 409 telling the
// caller to sync the work order to Fortnox first.
async function requireOrderNumber(workOrderId: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('crm_work_orders')
    .select('fortnox_order_number')
    .eq('id', workOrderId)
    .maybeSingle();

  if (error) throw new FortnoxApiError(500, `Kunde inte läsa arbetsordern: ${error.message}`, undefined, 'Kunde inte läsa arbetsordern. Försök igen.');
  const orderNumber = data?.fortnox_order_number;
  if (!orderNumber) throw new FortnoxApiError(409, 'Synka arbetsordern till Fortnox först.', undefined, 'Synka arbetsordern till Fortnox först.');
  return String(orderNumber);
}

// Fetch the order confirmation as a PDF (GET /orders/{n}/preview). Same as offers:
// use `/preview` (matches Fortnox's own förhandsgranskning, incl. ROT) and keep
// `Accept: application/json` (Fortnox rejects application/pdf, code 1000030).
export async function getFortnoxOrderPdf(workOrderId: string): Promise<{ bytes: Uint8Array; contentType: string; orderNumber: string }> {
  const orderNumber = await requireOrderNumber(workOrderId);
  const { bytes, contentType } = await fortnoxGetBinary(`/orders/${orderNumber}/preview`, 'application/json');
  if (contentType.includes('application/json')) {
    const text = new TextDecoder().decode(bytes).slice(0, 500);
    throw new FortnoxApiError(502, `Fortnox returnerade inte en PDF för order ${orderNumber}: ${text}`, undefined, 'Fortnox kunde inte skapa en orderbekräftelse. Försök igen om en stund.');
  }
  return { bytes, contentType, orderNumber };
}

// Ask Fortnox to e-mail the order confirmation to the customer (GET /orders/{n}/email).
export async function emailFortnoxOrder(workOrderId: string): Promise<{ orderNumber: string }> {
  const orderNumber = await requireOrderNumber(workOrderId);
  await fortnoxGet(`/orders/${orderNumber}/email`);
  return { orderNumber };
}

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { parseDecimal } from '@/lib/shared/number';
import { lineItemQuantity } from '@/lib/domains/crm/lineItems';
import { fortnoxGet, fortnoxPost, fortnoxPut, FortnoxNotConnectedError } from './client';
import { resolveOurReference } from './helpers';
import { DEFAULT_ROT_HOUSE_WORK_TYPE } from './types';

type WorkOrderRow = {
  id: string;
  quote_id: string | null;
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
  }> | null;
};

export type PushOrderResult = {
  fortnox_order_number: string;
};

function buildOrderRows(lineItems: WorkOrderRow['line_items'], vatPercent: number, rotEnabled: boolean) {
  if (!lineItems?.length) return [];
  return lineItems.map((item) => {
    // parseDecimal handles Swedish comma input ("1,5") that plain parseFloat truncates.
    const price = item.unit_price ? parseDecimal(item.unit_price) : (item.article_price ?? 0);
    // For m³ rows the quantity is the computed volume, not the (empty) quantity field.
    const quantity = lineItemQuantity(item);
    const discount = item.discount_percent ? parseDecimal(item.discount_percent) : 0;
    return {
      ...(item.article_number ? { ArticleNumber: item.article_number } : {}),
      Description: item.article_name || item.line_note || 'Artikel',
      Quantity: quantity,
      Price: price,
      VAT: vatPercent,
      ...(item.article_unit_name ? { Unit: item.article_unit_name } : {}),
      ...(discount > 0 ? { Discount: discount } : {}),
      ...(rotEnabled && item.is_rot_work ? { HouseWork: true, HouseWorkType: item.house_work_type || DEFAULT_ROT_HOUSE_WORK_TYPE } : {}),
    };
  });
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
    const { data: customer } = await supabase
      .from('crm_customers')
      .select('fortnox_customer_id')
      .eq('id', linkedQuote.customer_id)
      .maybeSingle();
    if (customer?.fortnox_customer_id) return customer.fortnox_customer_id;
  }

  return null;
}

// Push a CRM work order to Fortnox as an order.
// If the linked quote already has a Fortnox offer number, converts that offer to an order
// (preserving the offer→order link in Fortnox). Otherwise creates a standalone order.
export async function pushWorkOrderToFortnox(workOrderId: string): Promise<PushOrderResult> {
  const supabase = getSupabaseAdmin();

  await supabase
    .from('crm_work_orders')
    .update({ fortnox_order_sync_status: 'pending' })
    .eq('id', workOrderId);

  try {
    const { data: workOrder, error } = await supabase
      .from('crm_work_orders')
      .select('id, quote_id, project_name, client_name, amount, vat_percent, currency_code, line_items, fortnox_order_number')
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
        postal_code?: string | null;
        city?: string | null;
      } | null;
      rot_details: { enabled?: boolean | null } | null;
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
      const customerNumber = await resolveCustomerNumberFromQuote(linkedQuote, supabase);
      if (!customerNumber) {
        throw new Error(
          'Ingen Fortnox-kundkoppling hittades. Kunden måste vara synkad till Fortnox.',
        );
      }

      const ourReference = await resolveOurReference(linkedQuote?.assigned_to ?? null, supabase);

      const snapshot = linkedQuote?.customer_snapshot;
      const deliveryAddress = snapshot?.delivery_address;

      const vatPercent = typeof workOrder.vat_percent === 'number' ? workOrder.vat_percent : 25;
      const rotEnabled = linkedQuote?.rot_details?.enabled === true;
      const orderRows = buildOrderRows(workOrder.line_items, vatPercent, rotEnabled);

      const response = await fortnoxPost<{ Order: { DocumentNumber: string } }>('/orders', {
        Order: {
          CustomerNumber: customerNumber,
          OrderDate: new Date().toISOString().slice(0, 10),
          ...(ourReference ? { OurReference: ourReference } : {}),
          ...(snapshot?.contact_name ? { YourReference: snapshot.contact_name } : {}),
          ...(rotEnabled ? { TaxReductionType: 'rot' } : {}),
          ...(deliveryAddress
            ? {
                DeliveryAddress1: deliveryAddress,
                ...(snapshot?.postal_code ? { DeliveryZipCode: snapshot.postal_code } : {}),
                ...(snapshot?.city ? { DeliveryCity: snapshot.city } : {}),
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

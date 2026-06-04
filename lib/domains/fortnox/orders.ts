import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxPost, fortnoxPut, FortnoxNotConnectedError } from './client';

type WorkOrderRow = {
  id: string;
  quote_id: string | null;
  project_name: string;
  client_name: string | null;
  amount: number;
  vat_percent: number | null;
  currency_code: string;
  line_items: Array<{
    article_number?: string | null;
    article_name?: string | null;
    article_unit_name?: string | null;
    unit_price?: string | null;
    article_price?: number | null;
    quantity?: string | null;
    discount_percent?: string | null;
    line_note?: string | null;
    is_rot_work?: boolean | null;
  }> | null;
};

export type PushOrderResult = {
  fortnox_order_number: string;
};

function buildOrderRows(lineItems: WorkOrderRow['line_items'], vatPercent: number, rotEnabled: boolean) {
  if (!lineItems?.length) return [];
  return lineItems.map((item) => {
    const price = item.unit_price ? parseFloat(item.unit_price) : (item.article_price ?? 0);
    const quantity = item.quantity ? parseFloat(item.quantity) : 1;
    const discount = item.discount_percent ? parseFloat(item.discount_percent) : 0;
    return {
      ...(item.article_number ? { ArticleNumber: item.article_number } : {}),
      Description: item.article_name || item.line_note || 'Artikel',
      Quantity: Number.isFinite(quantity) ? quantity : 1,
      Price: Number.isFinite(price) ? price : 0,
      VAT: vatPercent,
      ...(item.article_unit_name ? { Unit: item.article_unit_name } : {}),
      ...(discount > 0 ? { Discount: discount } : {}),
      ...(rotEnabled && item.is_rot_work ? { HouseWork: true, HouseWorkType: 'CONSTRUCTION' } : {}),
    };
  });
}

// Resolves the Fortnox customer number via the work order's linked quote.
async function resolveCustomerNumber(quoteId: string | null): Promise<string | null> {
  if (!quoteId) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('crm_quotes')
    .select('customer_id, customer_source')
    .eq('id', quoteId)
    .maybeSingle();

  if (!data) return null;

  const source = data.customer_source as { kind?: string; fortnox_customer_id?: string } | null;
  if (source?.kind === 'fortnox' && source.fortnox_customer_id) {
    return source.fortnox_customer_id;
  }

  if (data.customer_id) {
    const { data: customer } = await supabase
      .from('crm_customers')
      .select('fortnox_customer_id')
      .eq('id', data.customer_id)
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
      .select('id, quote_id, project_name, client_name, amount, vat_percent, currency_code, line_items')
      .eq('id', workOrderId)
      .single<WorkOrderRow>();

    if (error || !workOrder) throw new Error(`Arbetsorder ${workOrderId} hittades inte`);

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
      const response = await fortnoxPut<{ Order: { DocumentNumber: string } }>(
        `/offers/${fortnoxOfferNumber}/createorder`,
      );
      fortnoxOrderNumber = response.Order?.DocumentNumber;
      if (!fortnoxOrderNumber) throw new Error('Fortnox returnerade inget ordernummer vid konvertering');
    } else {
      // No Fortnox offer exists – create a standalone order with full reference data.
      const customerNumber = await resolveCustomerNumber(workOrder.quote_id);
      if (!customerNumber) {
        throw new Error(
          'Ingen Fortnox-kundkoppling hittades. Kunden måste vara synkad till Fortnox.',
        );
      }

      let ourReference: string | undefined;
      if (linkedQuote?.assigned_to) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', linkedQuote.assigned_to)
          .maybeSingle();
        ourReference = (profile as { full_name?: string | null } | null)?.full_name ?? undefined;
      }

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

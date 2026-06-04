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
  }> | null;
};

export type PushOrderResult = {
  fortnox_order_number: string;
};

function buildOrderRows(lineItems: WorkOrderRow['line_items'], vatPercent: number) {
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

    // Try converting the linked Fortnox offer to an order first
    const fortnoxOfferNumber = workOrder.quote_id
      ? await (async () => {
          const { data: quote } = await supabase
            .from('crm_quotes')
            .select('fortnox_offer_number')
            .eq('id', workOrder.quote_id!)
            .maybeSingle();
          return quote?.fortnox_offer_number as string | null ?? null;
        })()
      : null;

    if (fortnoxOfferNumber) {
      // Convert existing Fortnox offer → order
      const response = await fortnoxPut<{ Order: { DocumentNumber: string } }>(
        `/offers/${fortnoxOfferNumber}/createorder`,
      );
      fortnoxOrderNumber = response.Order?.DocumentNumber;
      if (!fortnoxOrderNumber) throw new Error('Fortnox returnerade inget ordernummer vid konvertering');
    } else {
      // No Fortnox offer exists – create a standalone order
      const customerNumber = await resolveCustomerNumber(workOrder.quote_id);
      if (!customerNumber) {
        throw new Error(
          'Ingen Fortnox-kundkoppling hittades. Kunden måste vara synkad till Fortnox.',
        );
      }

      const vatPercent = typeof workOrder.vat_percent === 'number' ? workOrder.vat_percent : 25;
      const orderRows = buildOrderRows(workOrder.line_items, vatPercent);

      const response = await fortnoxPost<{ Order: { DocumentNumber: string } }>('/orders', {
        Order: {
          CustomerNumber: customerNumber,
          OrderDate: new Date().toISOString().slice(0, 10),
          YourReference: workOrder.project_name,
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

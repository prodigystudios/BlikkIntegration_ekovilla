import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxPost, FortnoxNotConnectedError } from './client';

type QuoteLineItem = {
  article_number?: string | null;
  article_name?: string | null;
  article_unit_name?: string | null;
  unit_price?: string | null;
  article_price?: number | null;
  quantity?: string | null;
  discount_percent?: string | null;
  line_note?: string | null;
};

type QuoteRow = {
  id: string;
  project_name: string;
  description: string | null;
  amount: number;
  vat_percent: number | null;
  quote_date: string;
  valid_until: string | null;
  notes: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_source: {
    kind?: string | null;
    fortnox_customer_id?: string | null;
  } | null;
  customer_snapshot: {
    customer_name?: string | null;
    company_name?: string | null;
    organization_number?: string | null;
  } | null;
  line_items: QuoteLineItem[] | null;
};

type FortnoxOfferRow = {
  ArticleNumber?: string;
  Description: string;
  Quantity: number;
  Price: number;
  Unit?: string;
  Discount?: number;
  VAT?: number;
};

export type PushOfferResult = {
  fortnox_offer_number: string;
};

function buildOfferRows(lineItems: QuoteLineItem[], vatPercent: number): FortnoxOfferRow[] {
  if (!lineItems.length) return [];

  return lineItems.map((item) => {
    const price = item.unit_price
      ? parseFloat(item.unit_price)
      : (item.article_price ?? 0);
    const quantity = item.quantity ? parseFloat(item.quantity) : 1;
    const discount = item.discount_percent ? parseFloat(item.discount_percent) : 0;

    const row: FortnoxOfferRow = {
      Description: item.article_name || item.line_note || 'Artikel',
      Quantity: Number.isFinite(quantity) ? quantity : 1,
      Price: Number.isFinite(price) ? price : 0,
      VAT: vatPercent,
    };

    if (item.article_number) row.ArticleNumber = item.article_number;
    if (item.article_unit_name) row.Unit = item.article_unit_name;
    if (discount > 0) row.Discount = discount;

    return row;
  });
}

// Resolves the Fortnox customer number for a quote.
// Checks customer_source first, then falls back to crm_customers.fortnox_customer_id.
async function resolveFortnoxCustomerNumber(quote: QuoteRow): Promise<string | null> {
  // Direct link from quote (customer picked from Fortnox in the form)
  if (quote.customer_source?.kind === 'fortnox' && quote.customer_source.fortnox_customer_id) {
    return quote.customer_source.fortnox_customer_id;
  }

  // Try to look up via linked CRM customer
  if (quote.customer_id) {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('crm_customers')
      .select('fortnox_customer_id')
      .eq('id', quote.customer_id)
      .maybeSingle();

    if (data?.fortnox_customer_id) return data.fortnox_customer_id;
  }

  return null;
}

// Push a CRM quote to Fortnox as an offer.
// Saves fortnox_offer_number and sync status back to crm_quotes.
export async function pushQuoteToFortnox(quoteId: string): Promise<PushOfferResult> {
  const supabase = getSupabaseAdmin();

  // Mark as pending before we start
  await supabase
    .from('crm_quotes')
    .update({ fortnox_sync_status: 'pending' })
    .eq('id', quoteId);

  let quote: QuoteRow;
  try {
    const { data, error } = await supabase
      .from('crm_quotes')
      .select(`
        id,
        project_name,
        description,
        amount,
        vat_percent,
        quote_date,
        valid_until,
        notes,
        customer_id,
        customer_name,
        customer_source,
        customer_snapshot,
        line_items
      `)
      .eq('id', quoteId)
      .single();

    if (error || !data) throw new Error(`Offert ${quoteId} hittades inte`);
    quote = data as QuoteRow;
  } catch (e) {
    await supabase
      .from('crm_quotes')
      .update({ fortnox_sync_status: 'failed' })
      .eq('id', quoteId);
    throw e;
  }

  try {
    const fortnoxCustomerNumber = await resolveFortnoxCustomerNumber(quote);
    if (!fortnoxCustomerNumber) {
      throw new Error(
        'Ingen Fortnox-kundkoppling hittades. Kunden måste vara synkad till Fortnox eller vald som Fortnox-kund i offerten.',
      );
    }

    const vatPercent = typeof quote.vat_percent === 'number' ? quote.vat_percent : 25;
    const lineItems = Array.isArray(quote.line_items) ? quote.line_items : [];
    const offerRows = buildOfferRows(lineItems, vatPercent);

    const payload = {
      Offer: {
        CustomerNumber: fortnoxCustomerNumber,
        OfferDate: quote.quote_date,
        ...(quote.valid_until ? { ExpireDate: quote.valid_until } : {}),
        YourReference: quote.project_name,
        ...(quote.description ? { Remarks: quote.description } : {}),
        OfferRows: offerRows,
      },
    };

    const response = await fortnoxPost<{ Offer: { DocumentNumber: string } }>('/offers', payload);
    const offerNumber = response.Offer?.DocumentNumber;

    if (!offerNumber) throw new Error('Fortnox returnerade inget offertnummer');

    await supabase
      .from('crm_quotes')
      .update({
        fortnox_offer_number: offerNumber,
        fortnox_sync_status: 'synced',
        fortnox_synced_at: new Date().toISOString(),
      })
      .eq('id', quoteId);

    return { fortnox_offer_number: offerNumber };
  } catch (e) {
    // If Fortnox isn't connected, leave status as not_synced rather than failed
    const syncStatus = e instanceof FortnoxNotConnectedError ? 'not_synced' : 'failed';
    await supabase
      .from('crm_quotes')
      .update({ fortnox_sync_status: syncStatus })
      .eq('id', quoteId);
    throw e;
  }
}

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxPost, fortnoxPut, FortnoxNotConnectedError } from './client';

type QuoteLineItem = {
  article_number?: string | null;
  article_name?: string | null;
  article_unit_name?: string | null;
  unit_price?: string | null;
  article_price?: number | null;
  quantity?: string | null;
  discount_percent?: string | null;
  line_note?: string | null;
  is_rot_work?: boolean | null;
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
    personal_number?: string | null;
    contact_name?: string | null;
    email?: string | null;
    phone?: string | null;
    street_address?: string | null;
    delivery_address?: string | null;
    postal_code?: string | null;
    city?: string | null;
  } | null;
  assigned_to: string | null;
  rot_details: {
    enabled?: boolean | null;
    rot_percent?: number | null;
    applicant_name?: string | null;
    personal_number?: string | null;
    property_designation?: string | null;
  } | null;
  line_items: QuoteLineItem[] | null;
  fortnox_offer_number: string | null;
};

type FortnoxOfferRow = {
  ArticleNumber?: string;
  Description: string;
  Quantity: number;
  Price: number;
  Unit?: string;
  Discount?: number;
  VAT?: number;
  HouseWork?: boolean;
  HouseWorkType?: string;
};

export type PushOfferResult = {
  fortnox_offer_number: string;
  updated: boolean;
};

function buildOfferRows(
  lineItems: QuoteLineItem[],
  vatPercent: number,
  rotEnabled: boolean,
): FortnoxOfferRow[] {
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
    if (rotEnabled && item.is_rot_work) {
      row.HouseWork = true;
      row.HouseWorkType = 'CONSTRUCTION';
    }

    return row;
  });
}

// Resolves the Fortnox customer number for a quote.
// Checks customer_source first, then falls back to crm_customers.fortnox_customer_id.
async function resolveFortnoxCustomerNumber(quote: QuoteRow): Promise<string | null> {
  if (quote.customer_source?.kind === 'fortnox' && quote.customer_source.fortnox_customer_id) {
    return quote.customer_source.fortnox_customer_id;
  }

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

// Creates the customer in Fortnox from the quote's snapshot data.
// Uses company_name for businesses and customer_name for private persons –
// both map to Fortnox's single Name field.
// Writes the resulting CustomerNumber back to crm_customers so future
// quote pushes resolve it directly without a new API call.
async function createCustomerInFortnox(quote: QuoteRow): Promise<string> {
  const snapshot = quote.customer_snapshot;
  const name = snapshot?.company_name ?? snapshot?.customer_name ?? quote.customer_name;
  if (!name) throw new Error('Kunden saknar namn – kan inte skapas i Fortnox automatiskt.');

  const customerPayload: Record<string, unknown> = {
    Name: name,
    Type: snapshot?.company_name ? 'COMPANY' : 'PRIVATE',
  };
  // For companies: OrganisationNumber = org number. For private persons: OrganisationNumber = personal number (Fortnox uses the same field for both).
  if (snapshot?.organization_number) customerPayload.OrganisationNumber = snapshot.organization_number;
  else if (snapshot?.personal_number) customerPayload.OrganisationNumber = snapshot.personal_number;
  if (snapshot?.email) customerPayload.Email = snapshot.email;
  if (snapshot?.phone) customerPayload.Phone1 = snapshot.phone;
  if (snapshot?.street_address) customerPayload.Address1 = snapshot.street_address;
  if (snapshot?.postal_code) customerPayload.ZipCode = snapshot.postal_code;
  if (snapshot?.city) customerPayload.City = snapshot.city;
  if (snapshot?.contact_name) customerPayload.YourReference = snapshot.contact_name;
  if (snapshot?.delivery_address) {
    customerPayload.DeliveryAddress1 = snapshot.delivery_address;
    // Reuse invoice postal/city for delivery when no separate delivery address exists
    if (snapshot?.postal_code) customerPayload.DeliveryZipCode = snapshot.postal_code;
    if (snapshot?.city) customerPayload.DeliveryCity = snapshot.city;
  }

  const response = await fortnoxPost<{ Customer: { CustomerNumber: string } }>('/customers', {
    Customer: customerPayload,
  });

  const customerNumber = response.Customer?.CustomerNumber;
  if (!customerNumber) throw new Error('Fortnox returnerade inget kundnummer vid skapande.');

  const supabase = getSupabaseAdmin();

  if (quote.customer_id) {
    // Link the Fortnox number back to the existing CRM customer
    await supabase
      .from('crm_customers')
      .update({ fortnox_customer_id: customerNumber })
      .eq('id', quote.customer_id);
  } else {
    // No CRM customer linked – create one in our DB so future syncs find it.
    // assigned_to/created_by are NOT NULL – use the quote's assigned user.
    if (!quote.assigned_to) {
      console.warn(`[Fortnox] Kan inte skapa crm_customers-rad för offert ${quote.id}: assigned_to saknas`);
      return customerNumber;
    }
    const isCompany = Boolean(snapshot?.company_name);
    const now = new Date().toISOString();
    const hasAddress = snapshot?.street_address || snapshot?.postal_code || snapshot?.city;
    const addressJson = hasAddress
      ? { street: snapshot?.street_address ?? null, postal_code: snapshot?.postal_code ?? null, city: snapshot?.city ?? null }
      : null;

    const { data: newCustomer, error: insertError } = await supabase
      .from('crm_customers')
      .insert({
        customer_type: isCompany ? 'business' : 'private',
        customer_stage: 'fortnox_customer',
        company_name: snapshot?.company_name ?? null,
        first_name: !isCompany ? (snapshot?.customer_name?.split(' ')[0] ?? null) : null,
        last_name: !isCompany ? (snapshot?.customer_name?.split(' ').slice(1).join(' ') || null) : null,
        organization_number: snapshot?.organization_number ?? null,
        personal_number: !isCompany ? (snapshot?.personal_number ?? null) : null,
        visit_address: addressJson,
        invoice_address: addressJson,
        fortnox_customer_id: customerNumber,
        assigned_to: quote.assigned_to,
        created_by: quote.assigned_to,
        sync_status: 'synced',
        last_synced_at: now,
        status: 'active',
        source: 'fortnox_auto_created',
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .maybeSingle();

    if (insertError) {
      console.error(`[Fortnox] Kunde inte skapa crm_customers-rad för offert ${quote.id}:`, insertError.message);
    }

    if (newCustomer?.id) {
      // Create a primary contact with the phone/email from the quote snapshot
      const contactName = snapshot?.contact_name ?? snapshot?.customer_name ?? snapshot?.company_name ?? name;
      if (snapshot?.email || snapshot?.phone) {
        await supabase.from('crm_customer_contacts').insert({
          customer_id: newCustomer.id,
          name: contactName,
          phone: snapshot?.phone ?? null,
          email: snapshot?.email ?? null,
          is_primary: true,
        });
      }

      // Update the quote: link customer_id and mark source as fortnox
      await supabase
        .from('crm_quotes')
        .update({
          customer_id: newCustomer.id,
          customer_source: {
            kind: 'fortnox',
            sync_intent: 'linked',
            fortnox_customer_id: customerNumber,
            fortnox_customer_name: name,
          },
        })
        .eq('id', quote.id);
    }
  }

  return customerNumber;
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
        assigned_to,
        rot_details,
        line_items,
        fortnox_offer_number
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
    const fortnoxCustomerNumber =
      (await resolveFortnoxCustomerNumber(quote)) ?? (await createCustomerInFortnox(quote));

    const vatPercent = typeof quote.vat_percent === 'number' ? quote.vat_percent : 25;
    const lineItems = Array.isArray(quote.line_items) ? quote.line_items : [];
    const rotEnabled = quote.rot_details?.enabled === true;
    const offerRows = buildOfferRows(lineItems, vatPercent, rotEnabled);

    let ourReference: string | undefined;
    if (quote.assigned_to) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', quote.assigned_to)
        .maybeSingle();
      ourReference = profile?.full_name ?? undefined;
    }

    const snapshot = quote.customer_snapshot;
    const deliveryAddress = snapshot?.delivery_address;

    // Build Remarks: description first, then property designation on a new line if ROT
    const propertyDesignation = rotEnabled && quote.rot_details?.property_designation
      ? `Fastighetsbeteckning: ${quote.rot_details.property_designation}`
      : null;
    const remarks = [quote.description, propertyDesignation].filter(Boolean).join('\n') || undefined;

    const offerBody = {
      Offer: {
        CustomerNumber: fortnoxCustomerNumber,
        OfferDate: quote.quote_date,
        ...(quote.valid_until ? { ExpireDate: quote.valid_until } : {}),
        ...(ourReference ? { OurReference: ourReference } : {}),
        ...(snapshot?.contact_name ? { YourReference: snapshot.contact_name } : {}),
        ...(rotEnabled ? { TaxReductionType: 'rot' } : {}),
        ...(remarks ? { Remarks: remarks } : {}),
        ...(deliveryAddress
          ? {
              DeliveryAddress1: deliveryAddress,
              ...(snapshot?.postal_code ? { DeliveryZipCode: snapshot.postal_code } : {}),
              ...(snapshot?.city ? { DeliveryCity: snapshot.city } : {}),
            }
          : {}),
        OfferRows: offerRows,
      },
    };

    const existingOfferNumber = quote.fortnox_offer_number;
    let offerNumber: string;
    let updated: boolean;

    if (existingOfferNumber) {
      // Update the existing Fortnox offer instead of creating a duplicate
      const response = await fortnoxPut<{ Offer: { DocumentNumber: string } }>(
        `/offers/${existingOfferNumber}`,
        offerBody,
      );
      offerNumber = response.Offer?.DocumentNumber ?? existingOfferNumber;
      updated = true;
    } else {
      const response = await fortnoxPost<{ Offer: { DocumentNumber: string } }>('/offers', offerBody);
      offerNumber = response.Offer?.DocumentNumber;
      updated = false;
    }

    if (!offerNumber) throw new Error('Fortnox returnerade inget offertnummer');

    await supabase
      .from('crm_quotes')
      .update({
        fortnox_offer_number: offerNumber,
        fortnox_sync_status: 'synced',
        fortnox_synced_at: new Date().toISOString(),
      })
      .eq('id', quoteId);

    return { fortnox_offer_number: offerNumber, updated };
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

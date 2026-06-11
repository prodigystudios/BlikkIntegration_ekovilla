import { getSupabaseAdmin } from '@/lib/supabase/server';
import { parseDecimal } from '@/lib/shared/number';
import { lineItemQuantity } from '@/lib/domains/crm/lineItems';
import { fortnoxPost, fortnoxPut, fortnoxGet, fortnoxGetBinary, FortnoxApiError, FortnoxNotConnectedError, FortnoxPushInProgressError } from './client';
import { claimFortnoxPush, resolveOurReference, resolveReverseVat } from './helpers';
import { buildFortnoxCustomerPayload, createFortnoxCustomer, splitSwedishName, buildFortnoxAddress, type FortnoxCustomerSource } from './customers';
import { DEFAULT_ROT_HOUSE_WORK_TYPE } from './types';

type QuoteLineItem = {
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
    delivery_postal_code?: string | null;
    delivery_city?: string | null;
    postal_code?: string | null;
    city?: string | null;
    reverse_vat?: boolean | null;
  } | null;
  assigned_to: string | null;
  rot_details: {
    enabled?: boolean | null;
    rot_percent?: number | null;
    applicant_name?: string | null;
    personal_number?: string | null;
    property_designation?: string | null;
    brf_org_number?: string | null;
  } | null;
  line_items: QuoteLineItem[] | null;
  fortnox_offer_number: string | null;
};

type FortnoxOfferRow = {
  ArticleNumber?: string;
  Description: string;
  // Quantity/Price are omitted for text-only rows (e.g. the measurement line) so
  // Fortnox renders them as a comment row without amounts.
  Quantity?: number;
  Price?: number;
  Unit?: string;
  Discount?: number;
  // Fortnox defaults DiscountType to AMOUNT (kronor). The CRM stores discount_percent as a
  // PERCENT, so we MUST send DiscountType:'PERCENT' alongside Discount — otherwise a 25%
  // discount is booked as 25 kr off the row and the Fortnox total diverges from the quote.
  DiscountType?: 'PERCENT' | 'AMOUNT';
  VAT?: number;
  HouseWork?: boolean;
  HouseWorkType?: string;
};

// Free-text description of a line item's measurements (m² + thickness), shown as its
// own row on the Fortnox offer. Returns null when the item has no measurements.
function buildMeasurementText(item: QuoteLineItem): string | null {
  const m2 = item.m2?.trim();
  const thickness = item.thickness_mm?.trim();
  const parts: string[] = [];
  if (m2) parts.push(`Yta: ${m2} m²`);
  if (thickness) parts.push(`Tjocklek: ${thickness} mm`);
  return parts.length ? parts.join(', ') : null;
}

export type PushOfferResult = {
  fortnox_offer_number: string;
  updated: boolean;
};

export function buildOfferRows(
  lineItems: QuoteLineItem[],
  vatPercent: number,
  rotEnabled: boolean,
  reverseVat = false,
): FortnoxOfferRow[] {
  if (!lineItems.length) return [];

  return lineItems.flatMap((item) => {
    // parseDecimal handles Swedish comma input ("1,5") that plain parseFloat truncates.
    const price = item.unit_price ? parseDecimal(item.unit_price) : (item.article_price ?? 0);
    // For m³ rows the quantity is the computed volume, not the (empty) quantity field.
    const quantity = lineItemQuantity(item);
    // Clamp to [0,100] to match the CRM pricing (lib/domains/crm/pricing.ts); a discount
    // > 100 would make the Fortnox offer row diverge from the quote's stored total.
    const discount = Math.min(100, Math.max(0, item.discount_percent ? parseDecimal(item.discount_percent) : 0));

    const row: FortnoxOfferRow = {
      Description: item.article_name || item.line_note || 'Artikel',
      Quantity: quantity,
      Price: price,
      // Reverse charge (omvänd skattskyldighet / byggmoms): the seller charges 0 % output VAT;
      // the buyer accounts for it. The document's VAT regime comes from the customer card
      // (synced from reverse_vat); matching the row VAT here keeps the document consistent.
      VAT: reverseVat ? 0 : vatPercent,
    };

    if (item.article_number) row.ArticleNumber = item.article_number;
    if (item.article_unit_name) row.Unit = item.article_unit_name;
    if (discount > 0) {
      row.Discount = discount;
      row.DiscountType = 'PERCENT';
    }
    if (rotEnabled && item.is_rot_work) {
      row.HouseWork = true;
      row.HouseWorkType = item.house_work_type || DEFAULT_ROT_HOUSE_WORK_TYPE;
    }

    // Measurements (m² + thickness) get their own text row so they appear on the
    // offer PDF below the article. Text rows carry only a Description (no amounts).
    const measurement = buildMeasurementText(item);
    if (measurement) {
      return [row, { Description: measurement } as FortnoxOfferRow];
    }
    return [row];
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

// Maps a quote's customer snapshot to the shared FortnoxCustomerSource shape so the
// auto-create-from-quote path uses the SAME payload mapper as the customer form.
// The snapshot is a flatter capture than a crm_customers row (single name field,
// string addresses, no mobile/terms/VAT) – absent fields map to null.
export function snapshotToFortnoxSource(quote: QuoteRow): FortnoxCustomerSource {
  const s = quote.customer_snapshot;
  const isCompany = Boolean(s?.company_name);
  const name = splitSwedishName(s?.customer_name ?? quote.customer_name);
  const mainAddress = buildFortnoxAddress(s?.street_address, s?.postal_code, s?.city);
  // Work/job address is structured (own postal/city). Use it as entered — don't borrow the
  // customer's postal/city, which belong to a different place when the job is elsewhere.
  const deliveryAddress = s?.delivery_address
    ? buildFortnoxAddress(s.delivery_address, s?.delivery_postal_code, s?.delivery_city)
    : null;

  return {
    customer_type: isCompany ? 'business' : 'private',
    company_name: s?.company_name ?? null,
    first_name: isCompany ? null : name.first,
    last_name: isCompany ? null : name.last,
    organization_number: s?.organization_number ?? null,
    personal_number: s?.personal_number ?? null,
    email: s?.email ?? null,
    phone: s?.phone ?? null,
    mobile: null,
    visit_address: null,
    invoice_address: mainAddress,
    delivery_address: deliveryAddress,
    invoice_email: null,
    payment_terms: null,
    price_list: null,
    discount: null,
    vat_number: null,
    reverse_vat: null,
    fortnox_customer_id: null,
  };
}

// Creates the customer in Fortnox for a quote that has no resolvable Fortnox number.
// Reuses the shared customer push (buildFortnoxCustomerPayload) so the offer path and
// the customer form stay in sync. Writes the CustomerNumber back so future quote
// pushes resolve it directly without creating a duplicate.
async function createCustomerInFortnox(quote: QuoteRow): Promise<string> {
  // A CRM customer is already linked – reuse the shared push entirely: it loads the
  // full row, maps every field, and updates the row's sync state.
  if (quote.customer_id) {
    const { fortnoxCustomerNumber } = await createFortnoxCustomer(quote.customer_id);
    return fortnoxCustomerNumber;
  }

  // No linked CRM customer – build the Fortnox payload from the quote snapshot using
  // the SAME mapper as the customer form, then create + link a DB row for next time.
  const snapshot = quote.customer_snapshot;
  const source = snapshotToFortnoxSource(quote);
  const name = source.company_name ?? [source.first_name, source.last_name].filter(Boolean).join(' ');
  if (!name) throw new Error('Kunden saknar namn – kan inte skapas i Fortnox automatiskt.');

  const response = await fortnoxPost<{ Customer: { CustomerNumber: string } }>('/customers', {
    Customer: buildFortnoxCustomerPayload(source),
  });

  const customerNumber = response.Customer?.CustomerNumber;
  if (!customerNumber) throw new Error('Fortnox returnerade inget kundnummer vid skapande.');

  const supabase = getSupabaseAdmin();

  // assigned_to/created_by are NOT NULL – use the quote's assigned user.
  if (!quote.assigned_to) {
    console.warn(`[Fortnox] Kan inte skapa crm_customers-rad för offert ${quote.id}: assigned_to saknas`);
    return customerNumber;
  }
  const isCompany = Boolean(snapshot?.company_name);
  const now = new Date().toISOString();
  const dbName = splitSwedishName(snapshot?.customer_name);
  const addressJson = buildFortnoxAddress(snapshot?.street_address, snapshot?.postal_code, snapshot?.city);

  const { data: newCustomer, error: insertError } = await supabase
    .from('crm_customers')
    .insert({
      customer_type: isCompany ? 'business' : 'private',
      customer_stage: 'fortnox_customer',
      company_name: snapshot?.company_name ?? null,
      first_name: !isCompany ? dbName.first : null,
      last_name: !isCompany ? dbName.last : null,
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
  }

  // Always link customer_source on the quote regardless of whether the DB insert succeeded.
  // This ensures resolveFortnoxCustomerNumber finds the Fortnox number on the next push
  // and skips createCustomerInFortnox – preventing duplicate Fortnox customers on retry.
  const { error: quoteUpdateError } = await supabase
    .from('crm_quotes')
    .update({
      ...(newCustomer?.id ? { customer_id: newCustomer.id } : {}),
      customer_source: {
        kind: 'fortnox',
        sync_intent: 'linked',
        fortnox_customer_id: customerNumber,
        fortnox_customer_name: name,
      },
    })
    .eq('id', quote.id);

  if (quoteUpdateError) {
    throw new Error(`[Fortnox] Kunde inte länka customer_source på offert ${quote.id}: ${quoteUpdateError.message}`);
  }

  return customerNumber;
}

// Push a CRM quote to Fortnox as an offer.
// Saves fortnox_offer_number and sync status back to crm_quotes.
export async function pushQuoteToFortnox(quoteId: string): Promise<PushOfferResult> {
  const supabase = getSupabaseAdmin();

  let quote: QuoteRow;
  {
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
  }

  // Atomically claim the push so two concurrent first-time pushes can't each POST /offers
  // and create a DUPLICATE Fortnox offer. (Re-pushes of an existing offer PUT the same
  // number and are idempotent — the claim just serialises them.)
  const claimed = await claimFortnoxPush(
    supabase, 'crm_quotes', quoteId, 'fortnox_sync_status', 'fortnox_offer_claimed_at',
  );
  if (!claimed) throw new FortnoxPushInProgressError();

  try {
    const fortnoxCustomerNumber =
      (await resolveFortnoxCustomerNumber(quote)) ?? (await createCustomerInFortnox(quote));

    const vatPercent = typeof quote.vat_percent === 'number' ? quote.vat_percent : 25;
    const lineItems = Array.isArray(quote.line_items) ? quote.line_items : [];
    // Reverse charge (byggmoms) and ROT are mutually exclusive (B2B vs private). When reverse
    // charge applies, rows go out at 0 % VAT (the customer card supplies the SEREVERSEDVAT regime).
    const reverseVat = await resolveReverseVat(supabase, quote.customer_snapshot?.reverse_vat, quote.customer_id);
    const rotEnabled = quote.rot_details?.enabled === true && !reverseVat;
    const offerRows = buildOfferRows(lineItems, vatPercent, rotEnabled, reverseVat);

    const ourReference = await resolveOurReference(quote.assigned_to, supabase);

    const snapshot = quote.customer_snapshot;
    // Work/job address (where the service is delivered). Street is the anchor; postal/city
    // are sent as entered (not borrowed from the customer address — that would attach the
    // wrong postcode to a job in another locality). Matches the work order's address.
    const deliveryAddress = snapshot?.delivery_address;
    const deliveryZip = snapshot?.delivery_postal_code;
    const deliveryCity = snapshot?.delivery_city;

    // Build Remarks: description first, then ROT property designation / BRF org number
    // on their own lines (Fortnox offers have no structured field for these).
    const propertyDesignation = rotEnabled && quote.rot_details?.property_designation
      ? `Fastighetsbeteckning: ${quote.rot_details.property_designation}`
      : null;
    const brfOrgNumber = rotEnabled && quote.rot_details?.brf_org_number
      ? `BRF org.nr: ${quote.rot_details.brf_org_number}`
      : null;
    const remarks = [quote.description, propertyDesignation, brfOrgNumber].filter(Boolean).join('\n') || undefined;

    const offerBody = {
      Offer: {
        CustomerNumber: fortnoxCustomerNumber,
        OfferDate: quote.quote_date,
        ...(quote.valid_until ? { ExpireDate: quote.valid_until } : {}),
        ...(ourReference ? { OurReference: ourReference } : {}),
        ...(snapshot?.contact_name ? { YourReference: snapshot.contact_name } : {}),
        // NOTE: do NOT send VATType on offers — Fortnox rejects it (400 "Felaktigt fältnamn
        // (VATType)", offers have no such field). The document's VAT regime is taken from the
        // customer card (kept in sync with our reverse_vat), and we send rows at the MATCHING VAT
        // (0 % for reverse charge, else vatPercent) so header and rows are always consistent.
        ...(rotEnabled ? { TaxReductionType: 'rot' } : {}),
        ...(remarks ? { Remarks: remarks } : {}),
        ...(deliveryAddress
          ? {
              DeliveryAddress1: deliveryAddress,
              ...(deliveryZip ? { DeliveryZipCode: deliveryZip } : {}),
              ...(deliveryCity ? { DeliveryCity: deliveryCity } : {}),
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

// Resolve a quote's synced Fortnox offer number, or throw a 409 telling the caller
// to push the offer to Fortnox first.
async function requireOfferNumber(quoteId: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('crm_quotes')
    .select('fortnox_offer_number')
    .eq('id', quoteId)
    .maybeSingle();

  if (error) throw new FortnoxApiError(500, `Kunde inte läsa offerten: ${error.message}`, undefined, 'Kunde inte läsa offerten. Försök igen.');
  const offerNumber = data?.fortnox_offer_number;
  if (!offerNumber) throw new FortnoxApiError(409, 'Skicka offerten till Fortnox först.', undefined, 'Skicka offerten till Fortnox först.');
  return String(offerNumber);
}

// Fetch the offer as a PDF (GET /offers/{n}/preview). We use `/preview`, not `/print`:
// preview renders the same layout as Fortnox's own "Förhandsgranska" (which correctly
// shows the ROT/skattereduktion breakdown) and has no side effects (doesn't mark the
// offer as printed). NB: Fortnox validates the Accept header against its JSON allow-list
// and rejects `application/pdf` with error 1000030 "Invalid response type" — you must
// keep `Accept: application/json` and Fortnox still returns the PDF binary. See
// FORTNOX_INTEGRATION.md.
export async function getFortnoxOfferPdf(quoteId: string): Promise<{ bytes: Uint8Array; contentType: string; offerNumber: string }> {
  const offerNumber = await requireOfferNumber(quoteId);
  const { bytes, contentType } = await fortnoxGetBinary(`/offers/${offerNumber}/preview`, 'application/json');
  if (contentType.includes('application/json')) {
    // Fortnox returned a JSON body instead of a PDF (e.g. an error wrapper).
    const text = new TextDecoder().decode(bytes).slice(0, 500);
    throw new FortnoxApiError(502, `Fortnox returnerade inte en PDF för offert ${offerNumber}: ${text}`, undefined, 'Fortnox kunde inte skapa en PDF av offerten. Försök igen om en stund.');
  }
  return { bytes, contentType, offerNumber };
}

// Ask Fortnox to e-mail the offer to the customer (GET /offers/{n}/email). Uses the
// offer's EmailInformation in Fortnox; returns the offer number on success.
export async function emailFortnoxOffer(quoteId: string): Promise<{ offerNumber: string }> {
  const offerNumber = await requireOfferNumber(quoteId);
  await fortnoxGet(`/offers/${offerNumber}/email`);
  return { offerNumber };
}

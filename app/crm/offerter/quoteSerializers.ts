// Pure serializers that turn the quote form draft into the API payload shapes.
// Kept in a standalone (non-"use client") module so the mapping — historically the
// most regression-prone part of the quote form — is unit-testable in isolation.
//
// Inputs are narrow structural types: the form's full QuoteDraft satisfies them, so
// callers pass `draft` directly, and tests build small plain objects.

import { parseDecimal } from '@/lib/shared/number';
import { inferMaterialFromArticle, lineItemSacks } from '@/lib/domains/crm/materials';

export type QuoteCustomerFields = {
  quote_type: 'private' | 'business';
  customer_name: string;
  company_name: string;
  organization_number: string;
  personal_number: string;
  contact_name: string;
  email: string;
  phone: string;
  street_address: string;
  postal_code: string;
  city: string;
  visit_address: string;
  // Arbetsadress (where the job is performed). `delivery_address` is its STREET line;
  // postal/city are structured so it works for company jobs whose card address (street_address)
  // is the office. Kept under the `delivery_*` name = Fortnox "delivery address".
  delivery_address: string;
  delivery_postal_code: string;
  delivery_city: string;
  invoice_address: string;
  // Separate on-site contact (slutkund) OUTSIDE the customer card: e.g. a builder orders the
  // job but the work is done for a different end customer. Independent of "Er referens"
  // (contact_name), which stays the order-giver. Stored only when explicitly entered.
  end_contact_name: string;
  end_contact_phone: string;
  end_contact_email: string;
  // Free-text marking/reference (företag) → Fortnox "Ert referensnummer" (YourReferenceNumber on
  // the offer, YourOrderNumber on order/invoice). The business counterpart of a private ROT
  // customer's fastighetsbeteckning, which uses the same Fortnox field.
  label: string;
};

// Two address strings are "the same place" if their trimmed, case-folded forms match.
// Used to drop a work address that equals the customer/invoice address so the common
// (private) case stores no separate delivery address and stays exactly as before.
function sameAddressPart(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// The customer name used on the quote: company name for business (falling back to
// the contact name), otherwise the person's name.
export function getEffectiveCustomerName(
  d: Pick<QuoteCustomerFields, 'quote_type' | 'company_name' | 'customer_name'>,
): string {
  return d.quote_type === 'business'
    ? (d.company_name.trim() || d.customer_name.trim())
    : d.customer_name.trim();
}

// Point-in-time snapshot of the customer details, stored on every quote regardless
// of whether the customer is a saved record. Empty strings become null.
export function buildCustomerSnapshot(d: QuoteCustomerFields, opts?: { reverseVat?: boolean | null }) {
  const effectiveCustomerName = getEffectiveCustomerName(d);

  // Work address: anchored on the STREET line — only stored when a street is entered AND
  // the address differs from the customer address. Identical (or no street) → null
  // everywhere, so downstream (work order, Fortnox) falls back to the customer address and
  // the private case behaves exactly as before. The street anchor keeps the snapshot, the
  // toggle (keyed on delivery_address), the work order, and Fortnox all in agreement —
  // never a half-populated city-only work address.
  const workMatchesCustomer =
    sameAddressPart(d.delivery_address, d.street_address) &&
    sameAddressPart(d.delivery_postal_code, d.postal_code) &&
    sameAddressPart(d.delivery_city, d.city);
  const hasWorkAddress = !workMatchesCustomer && Boolean(d.delivery_address.trim());

  // Separate on-site contact: stored only when at least a name/phone/email was entered.
  const hasEndContact = Boolean(
    d.end_contact_name?.trim() || d.end_contact_phone?.trim() || d.end_contact_email?.trim(),
  );

  return {
    customer_name: d.quote_type === 'private' ? d.customer_name || null : effectiveCustomerName || null,
    company_name: d.quote_type === 'business' ? d.company_name || null : null,
    organization_number: d.quote_type === 'business' ? d.organization_number || null : null,
    personal_number: d.quote_type === 'private' ? d.personal_number || null : null,
    contact_name: d.contact_name || null,
    email: d.email || null,
    phone: d.phone || null,
    street_address: d.street_address || null,
    postal_code: d.postal_code || null,
    city: d.city || null,
    visit_address: d.visit_address || null,
    delivery_address: hasWorkAddress ? d.delivery_address || null : null,
    delivery_postal_code: hasWorkAddress ? d.delivery_postal_code || null : null,
    delivery_city: hasWorkAddress ? d.delivery_city || null : null,
    invoice_address: d.invoice_address || null,
    // Separate on-site contact (slutkund) — null unless explicitly entered.
    end_contact_name: hasEndContact ? d.end_contact_name || null : null,
    end_contact_phone: hasEndContact ? d.end_contact_phone || null : null,
    end_contact_email: hasEndContact ? d.end_contact_email || null : null,
    // Märkning (företag) → Fortnox "Ert referensnummer". null unless entered.
    label: d.label?.trim() || null,
    // Point-in-time byggmoms (omvänd skattskyldighet). Stored on the snapshot so the Fortnox
    // push (resolveReverseVat) can decide the 0 %-row VAT regime without depending on the live
    // customer record — essential for snapshot-only quotes with no linked customer_id. `null`
    // = unknown (legacy rows / callers that don't supply it) → resolver falls back to the
    // customer. A boolean is authoritative.
    reverse_vat: opts?.reverseVat ?? null,
  };
}

export type QuoteRotFields = {
  quote_type: 'private' | 'business';
  rot_enabled: boolean;
  rot_property_designation: string;
  rot_percent: string;
  rot_max_deduction: string;
  rot_brf_org_number: string;
  // The ROT applicant is always the customer – derived from the customer fields,
  // never entered separately, so the personal number Fortnox uses for the deduction
  // is the same one stored on the customer.
  customer_name: string;
  personal_number: string;
};

// ROT is only valid for private customers; everything is nulled out when disabled.
export function buildRotDetails(d: QuoteRotFields) {
  const enabled = d.quote_type === 'private' ? d.rot_enabled : false;
  return {
    enabled,
    applicant_name: enabled ? d.customer_name || null : null,
    personal_number: enabled ? d.personal_number || null : null,
    property_designation: enabled ? d.rot_property_designation || null : null,
    // parseDecimal handles Swedish comma/space input ("33,5", "50 000"); raw Number() would
    // turn those into NaN and the server schema would reject the whole quote save.
    rot_percent: enabled ? parseDecimal(d.rot_percent, 30) : 30,
    max_deduction: enabled ? parseDecimal(d.rot_max_deduction, 50000) : 50000,
    brf_org_number: enabled ? d.rot_brf_org_number || null : null,
  };
}

export type QuoteHandoffFields = {
  desired_installation_date: string;
  handoff_notes: string;
  work_scope: string;
};

export function buildInternalHandoff(d: QuoteHandoffFields) {
  return {
    desired_installation_date: d.desired_installation_date || null,
    handoff_notes: d.handoff_notes || null,
    work_scope: d.work_scope || null,
  };
}

const CONSTRUCTION_LABELS: Record<string, string> = { vagg: 'Vägg', snedtak: 'Snedtak', vind: 'Vind' };

export type MeasurementLineItem = {
  construction?: string | null;
  article_name?: string | null;
  m2?: string | null;
  thickness_mm?: string | null;
  pricing_mode?: string | null;
  density?: string | null;
};

// Build "Vägg – 100 m² × 200 mm" lines for the m³-priced rows that have both an area
// and a thickness. When the seller has entered a density AND the material's bag weight
// can be resolved from the article, the sack count is appended:
// "Vägg – 100 m² × 200 mm @ 45 kg/m³ – 53 säck". Used by the "Hämta mått från rader"
// button to prefill the work description so the seller doesn't retype anything.
export function buildMeasurementLines(items: MeasurementLineItem[]): string[] {
  const qualifying = items.filter(
    (it) => (it.pricing_mode ?? 'm3') !== 'item' && (it.m2 ?? '').trim() !== '' && (it.thickness_mm ?? '').trim() !== '',
  );
  if (qualifying.length === 0) return [];

  // Group rows under their material's short headline (e.g. "EKOVILLA"); rows whose
  // material can't be resolved fall in an unlabelled group. Sum sacks for the total.
  const groups: Array<{ heading: string; rows: string[] }> = [];
  let totalSacks = 0;

  for (const it of qualifying) {
    const label = CONSTRUCTION_LABELS[it.construction ?? ''] || it.article_name || '';
    const dims = `${(it.m2 ?? '').trim()} m² × ${(it.thickness_mm ?? '').trim()} mm`;
    let row = label ? `${label} – ${dims}` : dims;

    const material = inferMaterialFromArticle(it.article_name);
    const sacks = lineItemSacks(it);
    if (sacks > 0) {
      row += ` @ ${(it.density ?? '').trim()} kg/m³ – ${sacks} säck`;
      totalSacks += sacks;
    }

    const heading = material?.short ?? '';
    const group = groups.find((g) => g.heading === heading);
    if (group) group.rows.push(row);
    else groups.push({ heading, rows: [row] });
  }

  const lines: string[] = [];
  groups.forEach((g, idx) => {
    if (idx > 0) lines.push('');
    if (g.heading) lines.push(g.heading);
    lines.push(...g.rows);
  });
  if (totalSacks > 0) lines.push('', `Totalt: ${totalSacks} säck`);
  return lines;
}

// Pure serializers that turn the quote form draft into the API payload shapes.
// Kept in a standalone (non-"use client") module so the mapping — historically the
// most regression-prone part of the quote form — is unit-testable in isolation.
//
// Inputs are narrow structural types: the form's full QuoteDraft satisfies them, so
// callers pass `draft` directly, and tests build small plain objects.

import { parseDecimal } from '@/lib/shared/number';

// ── Giltighetstid ────────────────────────────────────────────────────────────
//
// "Giltig till" härleds ur offertdatumet plus ett antal dagar. Säljaren väljer antalet i en
// rullgardin i stället för att behöva plocka ett datum i kalendern — det vanliga fallet är ett
// jämnt antal dagar, inte ett specifikt datum. Kalendern finns kvar för de gånger det ÄR ett
// specifikt datum som gäller.

/** Standard: en månad. Det är den giltighetstid offerterna har haft sedan formuläret byggdes. */
export const OFFER_VALIDITY_DAYS = 30;

/** Valen i rullgardinen. 30 ligger med som standardvalet. */
export const OFFER_VALIDITY_PRESETS = [10, 15, 20, 30, 45, 60] as const;

/**
 * Datumet `days` dagar efter `iso` (YYYY-MM-DD).
 *
 * Klockan tolvs på dagen med flit: en date-only-sträng tolkad som midnatt kan tippa över till fel
 * dygn när sommartid slår om, och då blir giltighetstiden en dag kort eller lång.
 */
export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  // Vakta ÄVEN dagantalet: setDate(NaN) gör datumet ogiltigt och toISOString KASTAR då
  // (RangeError), vilket hade tagit ner hela formulärets rendering i stället för att degradera.
  if (!Number.isFinite(days)) return iso;
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Antal dagar mellan två datum (YYYY-MM-DD), eller null om något av dem inte är ett datum. */
export function daysBetweenIso(from: string, to: string): number | null {
  if (!from || !to) return null;
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/**
 * Vilket rullgardinsval giltighetstiden motsvarar, eller null för ett datum som inte är någon av
 * dem ("Eget datum").
 *
 * Härleds ur datumen i stället för att lagras separat. Ett eget fält för "valt antal dagar" hade
 * blivit en andra sanning som kan glida isär från `valid_until` — och det är `valid_until` som går
 * till Fortnox. Följden blir också att en offert som redigeras visar rätt val i rullgardinen utan
 * att något behöver ha sparats.
 */
export function matchedValidityPreset(quoteDate: string, validUntil: string): number | null {
  const days = daysBetweenIso(quoteDate, validUntil);
  if (days === null) return null;
  return (OFFER_VALIDITY_PRESETS as readonly number[]).includes(days) ? days : null;
}

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

// ── Uppdatera offerten från kundkortet utan att äta säljarens egna ändringar ──
//
// Att gå in på kundkortet mitt i en offert och komma tillbaka finns till för att kunna ÅTGÄRDA
// något på kunden — slå på omvänd skattskyldighet, rätta en adress. Samtidigt fyller säljaren i
// egna värden på offerten som inte ska bli överskrivna av kortet.
//
// Tidigare gjordes valet ovillkorligt, och båda svaren var fel på var sitt sätt: förifyllde man
// alltid försvann det säljaren skrivit, förifyllde man aldrig blev en påslagen omvänd moms kvar
// på 25 % — och gula notisen intygade ändå motsatsen, eftersom den läser kundkortet direkt.
//
// Regeln nedan skiljer dem åt: ett fält som fortfarande bär exakt det värde kortet gav när kunden
// valdes är oberört och får det färska värdet; har säljaren ändrat det står deras värde kvar.

export const CUSTOMER_DERIVED_KEYS = [
  'quote_type', 'vat_percent', 'company_name', 'customer_name', 'organization_number',
  'personal_number', 'contact_name', 'phone', 'email', 'street_address', 'postal_code', 'city',
  'delivery_address', 'delivery_postal_code', 'delivery_city',
] as const;

export type CustomerDerivedKey = (typeof CUSTOMER_DERIVED_KEYS)[number];

/** The subset of draft fields that `applySelectedCustomer` derives from the customer card. */
export type CustomerDerivedValues = Record<CustomerDerivedKey, string>;

/** Pick the customer-derived subset out of anything draft-shaped. */
export function pickCustomerDerived(source: Partial<Record<CustomerDerivedKey, unknown>>): CustomerDerivedValues {
  const out = {} as CustomerDerivedValues;
  for (const key of CUSTOMER_DERIVED_KEYS) out[key] = String(source[key] ?? '');
  return out;
}

/**
 * Field-by-field merge on return from the customer card.
 *
 * @param current  what the draft holds now
 * @param applied  what the card gave when the customer was picked (the "untouched" reference)
 * @param next     what the card gives now
 *
 * Untouched (current === applied) → take `next`. Edited → keep `current`.
 *
 * ⚠️ Without `applied` this is undecidable — that is the whole reason it is stored alongside the
 * draft. A caller with no reference must leave the draft alone rather than guess, because guessing
 * wrong in the "overwrite" direction is the one that silently destroys a seller's work.
 */
export function mergeUntouchedCustomerFields(
  current: CustomerDerivedValues,
  applied: CustomerDerivedValues,
  next: CustomerDerivedValues,
): CustomerDerivedValues {
  const out = {} as CustomerDerivedValues;
  for (const key of CUSTOMER_DERIVED_KEYS) {
    out[key] = current[key] === applied[key] ? next[key] : current[key];
  }
  return out;
}

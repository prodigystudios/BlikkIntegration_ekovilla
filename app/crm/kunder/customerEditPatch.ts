import { parseOptionalDecimal } from '@/lib/shared/number';

// Kundkortets editor: utkastet är formulärets strängar, och sparningen skickar bara det användaren ändrat.

export type CustomerEditDraft = {
  customer_type: 'business' | 'private';
  company_name: string; organization_number: string;
  first_name: string; last_name: string; personal_number: string;
  email: string; phone: string; mobile: string;
  visit_street: string; visit_postal_code: string; visit_city: string;
  delivery_street: string; delivery_postal_code: string; delivery_city: string;
  invoice_street: string; invoice_postal_code: string; invoice_city: string;
  invoice_email: string; payment_terms: string; price_list: string;
  discount: string; vat_number: string; reverse_vat: boolean;
  annual_revenue: string; number_of_employees: string;
  legal_entity_type: string; sni_code: string; sni_name: string;
  operating_profit: string; profit_after_financial_items: string; total_assets: string;
  operating_margin: string; equity_ratio: string; financial_year: string;
};

function buildAddress(street: string, postalCode: string, city: string) {
  if (!street && !postalCode && !city) return null;
  return { street: street || null, postal_code: postalCode || null, city: city || null };
}

/** Utkastet som PATCH-fält: tomt blir null. */
export function customerEditBody(draft: CustomerEditDraft): Record<string, unknown> {
  return {
    customer_type: draft.customer_type,
    company_name: draft.company_name.trim() || null,
    organization_number: draft.organization_number.trim() || null,
    first_name: draft.first_name.trim() || null,
    last_name: draft.last_name.trim() || null,
    personal_number: draft.personal_number.trim() || null,
    email: draft.email.trim() || null,
    phone: draft.phone.trim() || null,
    mobile: draft.mobile.trim() || null,
    visit_address: buildAddress(draft.visit_street, draft.visit_postal_code, draft.visit_city),
    delivery_address: buildAddress(draft.delivery_street, draft.delivery_postal_code, draft.delivery_city),
    invoice_address: buildAddress(draft.invoice_street, draft.invoice_postal_code, draft.invoice_city),
    invoice_email: draft.invoice_email.trim() || null,
    payment_terms: draft.payment_terms.trim() || null,
    price_list: draft.price_list.trim() || null,
    // Svenskt decimalkomma: "5,5" är 5,5 %, inte NaN. Ett ogiltigt värde stoppas av customerEditDiscountIssue före.
    discount: parseOptionalDecimal(draft.discount),
    vat_number: draft.vat_number.trim() || null,
    reverse_vat: draft.reverse_vat,
    annual_revenue: draft.annual_revenue.trim() ? Number(draft.annual_revenue) : null,
    number_of_employees: draft.number_of_employees.trim() ? Number(draft.number_of_employees) : null,
    legal_entity_type: draft.legal_entity_type.trim() || null,
    sni_code: draft.sni_code.trim() || null,
    sni_name: draft.sni_name.trim() || null,
    operating_profit: draft.operating_profit.trim() ? Number(draft.operating_profit) : null,
    profit_after_financial_items: draft.profit_after_financial_items.trim() ? Number(draft.profit_after_financial_items) : null,
    total_assets: draft.total_assets.trim() ? Number(draft.total_assets) : null,
    operating_margin: draft.operating_margin.trim() ? Number(draft.operating_margin) : null,
    equity_ratio: draft.equity_ratio.trim() ? Number(draft.equity_ratio) : null,
    financial_year: draft.financial_year.trim() ? Number(draft.financial_year) : null,
  };
}

/**
 * 🧨 Rabatten pushas till Fortnox, och en tömd rabatt töms där också (InvoiceDiscount 0). Något som inte går att läsa
 * som ett tal får därför inte tolkas som tomt — det hade raderat kundens rabatt i båda systemen.
 */
export function customerEditDiscountIssue(draft: CustomerEditDraft): string | null {
  if (!draft.discount.trim() || parseOptionalDecimal(draft.discount) !== null) return null;
  return 'Rabatten måste vara ett tal, t.ex. 5 eller 5,5.';
}

const digitsOf = (value: unknown) => String(value ?? '').replace(/\D/g, '');

/**
 * Det editorn skickar när den sparar: bara fälten som skiljer sig från utkastet den öppnades med. `body` och `base` är
 * customerEditBody av utkastet nu och utkastet vid öppningen.
 *
 * 🧨 Editorn skickade tidigare hela kortet. Hade någon annan fyllt i ett fält medan editorn stod öppen — kortpasset i
 * kundsynken, en kollega — skrevs det över med editorns gamla värde. En gammal tomhet räknas dessutom som en tömning,
 * och PATCH-routen tömmer numera fältet i Fortnox också (fortnoxCustomerClears). Då hade värdet raderats även där.
 *
 * Ett tomt momsnummer skickas med när org.numrets siffror ändrats. deriveVatNumberForWrite härleder SE…01 när org.numret
 * ändras utan att momsnumret skickas, men editorn härleder redan medan användaren skriver — står fältet ändå tomt har
 * användaren tömt det med flit.
 */
export function changedCustomerEditFields(
  body: Record<string, unknown>,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (JSON.stringify(value) !== JSON.stringify(base[key])) changed[key] = value;
  }
  const orgDigitsChanged = 'organization_number' in changed
    && digitsOf(body.organization_number) !== digitsOf(base.organization_number);
  if (orgDigitsChanged && 'vat_number' in body && body.vat_number === null) changed.vat_number = null;
  return changed;
}

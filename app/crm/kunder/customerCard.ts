// Kundkortets typer och visningsregler. Rent och utan "use client", så att reglerna kan testas utan
// komponenten (tests/crm/customerCard.test.ts).

import type { TicCreditReport } from '@/lib/domains/tic/types';

export type CustomerType = 'business' | 'private';
export type CustomerStage = 'prospect' | 'customer' | 'fortnox_customer';
export type CustomerStatus = 'active' | 'inactive' | 'churned';
export type CustomerAddress = { street: string | null; postal_code: string | null; city: string | null } | null;

export type CustomerContact = {
  id: string; name: string; role: string | null; phone: string | null; email: string | null; is_primary: boolean;
};

export type RiskIndicator = { type: string; subtype?: string; notes?: string; score?: number | null };

export type Customer = {
  id: string;
  customer_type: CustomerType;
  customer_stage: CustomerStage;
  status: CustomerStatus;
  company_name: string | null;
  organization_number: string | null;
  first_name: string | null;
  last_name: string | null;
  personal_number: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  visit_address: CustomerAddress;
  delivery_address: CustomerAddress;
  invoice_address: CustomerAddress;
  invoice_email: string | null;
  payment_terms: string | null;
  price_list: string | null;
  discount: number | null;
  vat_number: string | null;
  reverse_vat: boolean;
  annual_revenue: number | null;
  number_of_employees: number | null;
  legal_entity_type: string | null;
  sni_code: string | null;
  sni_name: string | null;
  operating_profit: number | null;
  profit_after_financial_items: number | null;
  total_assets: number | null;
  operating_margin: number | null;
  equity_ratio: number | null;
  financial_year: number | null;
  risk_indicators: RiskIndicator[] | null;
  tic_company_id: number | null;
  credit_report: TicCreditReport | null;
  credit_report_fetched_at: string | null;
  fortnox_customer_id: string | null;
  sync_status: 'not_synced' | 'pending' | 'synced' | 'failed';
  account_manager_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  contacts: CustomerContact[];
};

export type RelatedQuote = {
  id: string; quote_number: string | null; project_name: string; amount: number; currency_code: string; status: string; quote_date: string;
};
export type RelatedWorkOrder = { id: string; order_number: string; project_name: string; status: string; desired_installation_date: string | null };
export type RelatedCall = { id: string; outcome: 'no_answer' | 'follow_up' | 'positive' | 'negative'; summary: string; call_at: string; contact_name: string | null };
export type RelatedTask = { id: string; title: string; status: 'open' | 'done' | 'cancelled'; due_date: string | null; priority: 'low' | 'normal' | 'high' };

// Kundens namn och avatar kommer ur app/crm/lib/customerDisplay.ts — samma som kundregistret, så att
// samma kund ser likadan ut i listan och på kortet.

/** En kontaktpersons initialer: första bokstaven i de två första orden. "Lars Nordin" → "LN". */
export function contactInitials(name: string): string {
  const words = name.trim().normalize('NFC').split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? '').join('').toUpperCase();
  return letters || '?';
}

export function hasAddress(addr: CustomerAddress): boolean {
  return Boolean(addr && (addr.street?.trim() || addr.postal_code?.trim() || addr.city?.trim()));
}

/** Gatuadress på första raden, "postnr ort" på andra. Tom lista = ingen adress. */
export function addressLines(addr: CustomerAddress): string[] {
  if (!addr) return [];
  const street = addr.street?.trim() || '';
  const place = [addr.postal_code?.trim(), addr.city?.trim()].filter(Boolean).join(' ');
  return [street, place].filter(Boolean);
}

function normalizedAddress(addr: CustomerAddress): string {
  if (!addr) return '';
  const street = (addr.street || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const postal = (addr.postal_code || '').replace(/\D/g, '');
  const city = (addr.city || '').trim().toLowerCase();
  return `${street}|${postal}|${city}`;
}

export type AddressDisplay =
  | { kind: 'address'; lines: string[] }
  | { kind: 'same-as-visit' }
  | { kind: 'empty' };

/**
 * Leveransadressen. Tom = ordern faller tillbaka på besöksadressen (så har formuläret alltid sparat
 * "samma adress"), alltså är "Samma som besöksadress" sant — men bara när det finns en besöksadress.
 */
export function deliveryAddressDisplay(c: Pick<Customer, 'visit_address' | 'delivery_address'>): AddressDisplay {
  if (hasAddress(c.delivery_address)) return { kind: 'address', lines: addressLines(c.delivery_address) };
  return hasAddress(c.visit_address) ? { kind: 'same-as-visit' } : { kind: 'empty' };
}

/**
 * Fakturaadressen. Formuläret KOPIERAR in besöksadressen när fakturan följer den, så "samma" syns
 * som lika värden. En TOM fakturaadress är något annat: kunder som importerats ur Fortnox kan sakna
 * den, och då vet vi inte att den är samma — den visas som tom, aldrig som "samma".
 */
export function invoiceAddressDisplay(c: Pick<Customer, 'visit_address' | 'invoice_address'>): AddressDisplay {
  if (!hasAddress(c.invoice_address)) return { kind: 'empty' };
  if (hasAddress(c.visit_address) && normalizedAddress(c.invoice_address) === normalizedAddress(c.visit_address)) {
    return { kind: 'same-as-visit' };
  }
  return { kind: 'address', lines: addressLines(c.invoice_address) };
}

export const CUSTOMER_TABS = ['oversikt', 'offerter', 'arbetsorder', 'samtal', 'uppgifter', 'kontakter'] as const;
export type CustomerTab = (typeof CUSTOMER_TABS)[number];

/** `?tab=` → flik. Okänt eller saknat värde = Översikt. */
export function resolveCustomerTab(value: string | null | undefined): CustomerTab {
  return CUSTOMER_TABS.find((tab) => tab === value) ?? 'oversikt';
}

/**
 * Antalet på en flik. Listan hämtas med ett tak; når den taket kan det finnas fler, och då står det
 * "200+" i stället för ett tal som ser exakt ut men inte är det. `total` är serverns räkning när
 * routen har en (offerter, arbetsorder) och vinner då.
 */
export function tabCountLabel(loaded: number, limit: number, total?: number | null): string {
  if (total != null) return String(total);
  return loaded >= limit ? `${limit}+` : String(loaded);
}

/** "48 200 000 kr", eller null när värdet saknas. */
export function formatSek(value: number | null | undefined): string | null {
  if (value == null) return null;
  return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(value)} kr`;
}

/** "12,5 %", eller null när värdet saknas. */
export function formatPercent(value: number | null | undefined): string | null {
  if (value == null) return null;
  return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 }).format(value)} %`;
}

/** Har kunden någon företagsdata från tic.io (bransch, bolagsform, nyckeltal, risk)? Styr knappens text. */
export function hasCompanyInfo(c: Customer): boolean {
  return Boolean(
    c.legal_entity_type || c.sni_code || c.sni_name
    || c.annual_revenue != null || c.number_of_employees != null
    || c.operating_profit != null || c.profit_after_financial_items != null
    || c.total_assets != null || c.operating_margin != null
    || c.equity_ratio != null || c.financial_year != null
    || (c.risk_indicators && c.risk_indicators.length > 0),
  );
}

/** Sektionerna i redigeringsläget som "Ändra" kan hoppa till. Id:t är `redigera-<sektion>`. */
export type CustomerEditSection = 'grundinfo' | 'kontakt' | 'adresser' | 'fakturering';

// Registreringsformulärets utkast och reglerna kring tic.io-uppslaget. Rent och utan "use client",
// så att reglerna kan testas utan formuläret (tests/crm/newCustomerDraft.test.ts).

import { formatSwedishIdNumber, vatFromOrgNumber } from './customerNumbers';
import { formatPersonalNumber } from '@/lib/domains/crm/personalNumber';
import type { TicLookupResult, TicRiskIndicator } from '@/lib/domains/tic/types';

export type CustomerType = 'business' | 'private';

export type NewCustomerDraft = {
  customer_type: CustomerType;
  company_name: string;
  organization_number: string;
  first_name: string;
  last_name: string;
  personal_number: string;
  email: string;
  phone: string;
  mobile: string;
  visit_street: string;
  visit_postal_code: string;
  visit_city: string;
  delivery_street: string;
  delivery_postal_code: string;
  delivery_city: string;
  invoice_street: string;
  invoice_postal_code: string;
  invoice_city: string;
  invoice_email: string;
  payment_terms: string;
  price_list: string;
  discount: string;
  vat_number: string;
  reverse_vat: boolean;
  annual_revenue: string;
  number_of_employees: string;
  legal_entity_type: string;
  sni_code: string;
  sni_name: string;
  operating_profit: string;
  profit_after_financial_items: string;
  total_assets: string;
  operating_margin: string;
  equity_ratio: string;
  financial_year: string;
  risk_indicators: TicRiskIndicator[];
  account_manager_id: string;
};

export const INITIAL_NEW_CUSTOMER_DRAFT: NewCustomerDraft = {
  customer_type: 'business',
  company_name: '',
  organization_number: '',
  first_name: '',
  last_name: '',
  personal_number: '',
  email: '',
  phone: '',
  mobile: '',
  visit_street: '',
  visit_postal_code: '',
  visit_city: '',
  delivery_street: '',
  delivery_postal_code: '',
  delivery_city: '',
  invoice_street: '',
  invoice_postal_code: '',
  invoice_city: '',
  invoice_email: '',
  payment_terms: '',
  price_list: '',
  discount: '',
  vat_number: '',
  reverse_vat: false,
  annual_revenue: '',
  number_of_employees: '',
  legal_entity_type: '',
  sni_code: '',
  sni_name: '',
  operating_profit: '',
  profit_after_financial_items: '',
  total_assets: '',
  operating_margin: '',
  equity_ratio: '',
  financial_year: '',
  risk_indicators: [],
  account_manager_id: '',
};

/** Textfälten uppslaget kan fylla. */
export type TicFillableField = Exclude<
  { [K in keyof NewCustomerDraft]: NewCustomerDraft[K] extends string ? K : never }[keyof NewCustomerDraft],
  'customer_type' | 'account_manager_id'
>;

/**
 * Vad uppslaget skrev, fält för fält, med VÄRDET det satte. Värdet är poängen: ett fält räknas som
 * uppslagets bara så länge det står orört. Skriver säljaren om det är det hens, och då ska varken
 * "tic.io"-taggen stå kvar eller "Byt företag" tömma det.
 */
export type TicFill = {
  fields: Partial<Record<TicFillableField, string>>;
  riskIndicators: boolean;
};

export const EMPTY_TIC_FILL: TicFill = { fields: {}, riskIndicators: false };

/**
 * Fyller utkastet ur en träff. Skriver BARA i tomma fält — ett uppslag skriver aldrig över det någon
 * redan skrivit (samma princip som momsnumret). Org- och personnummer går genom samma formaterare
 * som fälten.
 */
export function applyTicLookup(draft: NewCustomerDraft, r: TicLookupResult): { draft: NewCustomerDraft; fill: TicFill } {
  const next: NewCustomerDraft = { ...draft };
  const fields: TicFill['fields'] = {};

  function fill(key: TicFillableField, value: string | number | null | undefined) {
    if (value == null || value === '') return;
    if (next[key].trim()) return;
    const text = String(value);
    next[key] = text;
    fields[key] = text;
  }

  let riskIndicators = false;
  if (r.kind === 'company') {
    fill('company_name', r.company_name);
    if (r.organization_number && !next.organization_number.trim()) {
      const formatted = formatSwedishIdNumber(r.organization_number);
      fill('organization_number', formatted);
      // Härleds bara ur ett org.nr som uppslaget självt satte, och bara i ett tomt fält.
      fill('vat_number', vatFromOrgNumber(formatted));
    }
    fill('annual_revenue', r.annual_revenue);
    fill('number_of_employees', r.number_of_employees);
    fill('legal_entity_type', r.legal_entity_type);
    fill('sni_code', r.sni_code);
    fill('sni_name', r.sni_name);
    fill('operating_profit', r.operating_profit);
    fill('profit_after_financial_items', r.profit_after_financial_items);
    fill('total_assets', r.total_assets);
    fill('operating_margin', r.operating_margin);
    fill('equity_ratio', r.equity_ratio);
    fill('financial_year', r.financial_year);
    if (r.risk_indicators && r.risk_indicators.length > 0 && next.risk_indicators.length === 0) {
      next.risk_indicators = r.risk_indicators;
      riskIndicators = true;
    }
  } else {
    fill('first_name', r.first_name);
    fill('last_name', r.last_name);
    // Personnummer har EGEN maskning: formatSwedishIdNumber kapar vid tio siffror (rätt för
    // org.nr) och hade klippt bort århundradet.
    if (r.personal_number) fill('personal_number', formatPersonalNumber(r.personal_number));
  }
  fill('email', r.email);
  fill('phone', r.phone);
  fill('visit_street', r.address?.street);
  fill('visit_postal_code', r.address?.postal_code);
  fill('visit_city', r.address?.city);

  return { draft: next, fill: { fields, riskIndicators } };
}

/** "Byt företag": tömmer det uppslaget fyllde och som fortfarande står orört. */
export function clearTicLookup(draft: NewCustomerDraft, fill: TicFill): NewCustomerDraft {
  const next: NewCustomerDraft = { ...draft };
  for (const key of Object.keys(fill.fields) as TicFillableField[]) {
    if (draft[key] === fill.fields[key]) next[key] = INITIAL_NEW_CUSTOMER_DRAFT[key];
  }
  if (fill.riskIndicators) next.risk_indicators = [];
  return next;
}

/** Bär fältet fortfarande uppslagets värde? Styr "tic.io"-taggen vid etiketten. */
export function isTicFilled(draft: NewCustomerDraft, fill: TicFill, key: TicFillableField): boolean {
  const value = fill.fields[key];
  return value !== undefined && draft[key] === value;
}

/**
 * Faktura-e-posten. Tomt fält = kundens e-post, vilket är vad formuläret alltid gav när fakturan
 * följde besöksadressen (standardfallet). Fältet bor numera under Fakturering och är frikopplat från
 * adressrutan, så regeln står här i stället för i rutans tillstånd.
 */
export function resolveInvoiceEmail(draft: Pick<NewCustomerDraft, 'invoice_email' | 'email'>): string | null {
  return draft.invoice_email.trim() || draft.email.trim() || null;
}

export type ChecklistItem = { label: string; done: boolean };

/**
 * "Innan du sparar". Bara en påminnelse — det enda som spärrar sparningen är namnet, precis som förut.
 */
export function newCustomerChecklist(draft: NewCustomerDraft): ChecklistItem[] {
  const isB2B = draft.customer_type === 'business';
  return [
    isB2B
      ? { label: 'Företagsnamn', done: Boolean(draft.company_name.trim()) }
      : { label: 'Namn', done: Boolean(draft.first_name.trim() && draft.last_name.trim()) },
    { label: 'E-post eller telefon', done: Boolean(draft.email.trim() || draft.phone.trim() || draft.mobile.trim()) },
    { label: 'Adress', done: Boolean(draft.visit_street.trim() && draft.visit_city.trim()) },
  ];
}

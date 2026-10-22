// Kundkortets typer och visningsregler. Rent och utan "use client", så att reglerna kan testas utan
// komponenten (tests/crm/customerCard.test.ts).

import type { TicCreditReport } from '@/lib/domains/tic/types';
import { netAmount } from '@/lib/domains/crm/pricing';
import { callAtToIso, type CrmCallOutcome } from '@/app/crm/lib/callDisplay';
import type { TaskItem } from '@/app/crm/lib/taskForm';
import type { CallLogDraft } from '@/app/crm/components/CallLogModal';

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

// Bara fälten kortet använder — routerna skickar hela raderna (crmQuoteSelect, crmWorkOrderSelect).
export type RelatedQuote = {
  id: string;
  quote_number: string | null;
  fortnox_offer_number: string | null;
  project_name: string;
  amount: number | string;
  currency_code: string;
  vat_percent: number | string | null;
  pricing_summary: { subtotal?: number; vat?: number; total?: number } | null;
  status: string;
  quote_date: string;
  assigned_to: string | null;
  customer_snapshot: {
    street_address?: string | null; city?: string | null;
    delivery_address?: string | null; delivery_city?: string | null;
  } | null;
};
export type RelatedWorkOrder = {
  id: string;
  order_number: string;
  fortnox_order_number: string | null;
  project_name: string;
  status: string;
  desired_installation_date: string | null;
  planned_start_day: string | null;
  planned_end_day: string | null;
  work_address: { street_address?: string | null; city?: string | null } | null;
  quote_id: string | null;
  assigned_to: string | null;
  assignee: { id: string; full_name: string | null } | null;
  partial_invoicing_started_at?: string | null;
};
export type RelatedCall = {
  id: string; outcome: CrmCallOutcome; summary: string; next_step: string | null; call_at: string;
  contact_name: string | null; user_id: string | null;
};
/** Uppgiftslistans rad — samma form som uppgiftssidan och offertpanelen läser. */
export type RelatedTask = TaskItem;

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

/**
 * Var offertens jobb ligger: arbetsadressen när offerten har en egen, annars kundens adress i
 * offertens ögonblicksbild. Gata och ort, eller null.
 */
export function quotePlace(q: Pick<RelatedQuote, 'customer_snapshot'>): string | null {
  const s = q.customer_snapshot;
  if (!s) return null;
  const parts = s.delivery_address?.trim()
    ? [s.delivery_address, s.delivery_city]
    : [s.street_address, s.city];
  return parts.map((p) => p?.trim()).filter(Boolean).join(', ') || null;
}

/** Orderns arbetsadress som "gata, ort", eller null. */
export function workOrderPlace(wo: Pick<RelatedWorkOrder, 'work_address'>): string | null {
  const a = wo.work_address;
  return [a?.street_address, a?.city].map((p) => p?.trim()).filter(Boolean).join(', ') || null;
}

export const QUOTE_STATUS_FILTERS = [
  { id: 'alla', label: 'Alla', statuses: null },
  { id: 'utkast', label: 'Utkast', statuses: ['draft'] },
  { id: 'skickade', label: 'Skickade', statuses: ['sent'] },
  { id: 'folj-upp', label: 'Följ upp', statuses: ['follow_up'] },
  { id: 'vunna', label: 'Vunna', statuses: ['won'] },
  { id: 'forlorade', label: 'Förlorade', statuses: ['lost'] },
] as const;
export type QuoteStatusFilter = (typeof QUOTE_STATUS_FILTERS)[number]['id'];

/** Sök på nummer, benämning och plats; status enligt filtret. */
export function filterQuotes(quotes: RelatedQuote[], search: string, filter: QuoteStatusFilter): RelatedQuote[] {
  const statuses = QUOTE_STATUS_FILTERS.find((f) => f.id === filter)?.statuses ?? null;
  const q = search.trim().toLowerCase();
  return quotes.filter((quote) => {
    if (statuses && !(statuses as readonly string[]).includes(quote.status)) return false;
    if (!q) return true;
    return [quote.quote_number, quote.fortnox_offer_number, quote.project_name, quotePlace(quote)]
      .some((v) => v?.toLowerCase().includes(q));
  });
}

/** Sök på nummer, benämning och adress. */
export function filterWorkOrders(orders: RelatedWorkOrder[], search: string): RelatedWorkOrder[] {
  const q = search.trim().toLowerCase();
  if (!q) return orders;
  return orders.filter((wo) => [wo.order_number, wo.fortnox_order_number, wo.project_name, workOrderPlace(wo)]
    .some((v) => v?.toLowerCase().includes(q)));
}

/**
 * Summorna under offerttabellen, EX MOMS och i KRONOR. `amount` är brutto (subtotal + moms), och en
 * summa av brutto blandar byggmoms (0 %) med privatkundens 25 % — samma fel som rapporteringen hade.
 * `netAmount` är enda vägen till ett netto (den vaktar också mot en tom pricing_summary).
 * Öppna = utkast, skickade och följ upp. En offert i annan valuta räknas inte in — euro och kronor
 * går inte att lägga ihop — men `otherCurrency` säger att den finns.
 */
export function quoteSums(quotes: RelatedQuote[]): { won: number; open: number; otherCurrency: boolean } {
  let won = 0;
  let open = 0;
  let otherCurrency = false;
  for (const q of quotes) {
    if (q.currency_code && q.currency_code !== 'SEK') { otherCurrency = true; continue; }
    const net = netAmount(q);
    if (q.status === 'won') won += net;
    else if (q.status === 'draft' || q.status === 'sent' || q.status === 'follow_up') open += net;
  }
  return { won, open, otherCurrency };
}

/**
 * Samtalet som loggas från kundkortet — samma form som samtalssidan skickar när en kund är vald:
 * bara kopplingen och samtalet. Kundens namn, org.nr och kontaktuppgifter läses via kopplingen
 * (crmCallSelect bäddar in kundraden), så de kopieras inte in i samtalet.
 *
 * 🧨 `customer_id`, aldrig `prospect_id` — även för en kund i prospektläget. `crm_calls_insert_visible`
 * kräver att en satt prospect_id pekar på en kund tilldelad den som skriver, så ett samtal på en
 * kollegas prospekt hade nekats. Priset: `crm_calls_select_visible` har ingen customer_id-gren, så
 * samtalet syns för den som loggade det och för admin, inte för kundens ansvariga säljare. Samma
 * avvägning som samtalen på offerten (William 2026-09-18: acceptabelt).
 */
export function buildCustomerCallPayload(customerId: string, draft: CallLogDraft) {
  const callAt = callAtToIso(draft.call_at);
  return {
    customer_id: customerId,
    outcome: draft.outcome,
    summary: draft.summary.trim(),
    next_step: draft.next_step.trim() || null,
    // Utelämnas när fältet är tomt — då sätter databasen tidpunkten till nu.
    ...(callAt ? { call_at: callAt } : {}),
  };
}

/** Nyast först, som routen ger dem — ett bakåtdaterat samtal hamnar på sin plats. */
export function sortCallsNewestFirst(calls: RelatedCall[]): RelatedCall[] {
  return [...calls].sort((a, b) => (a.call_at < b.call_at ? 1 : a.call_at > b.call_at ? -1 : 0));
}

/** "Att göra" (öppna) och "Klara" (klara och avbrutna). Ordningen inom varje del är serverns. */
export function splitTasks(tasks: RelatedTask[]): { open: RelatedTask[]; closed: RelatedTask[] } {
  return {
    open: tasks.filter((t) => t.status === 'open'),
    closed: tasks.filter((t) => t.status !== 'open'),
  };
}

/** En öppen uppgift vars förfallodag har passerat. `todayIso` = svensk dag (stockholmTodayISO). */
export function isTaskOverdue(task: Pick<RelatedTask, 'status' | 'due_date'>, todayIso: string): boolean {
  return task.status === 'open' && Boolean(task.due_date) && (task.due_date as string) < todayIso;
}

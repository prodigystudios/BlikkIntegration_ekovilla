import { documentRef } from '@/app/crm/lib/format';

// Presentation helpers shared by every surface that shows a quote: the offer list, the Säljtavla
// board and the detail panel they both open. Pure and side-effect free, so they're unit-tested and
// can't drift between the three places a quote is rendered.

export type QuoteNameFields = {
  customer_name: string | null;
  customer_snapshot: { customer_name?: string | null; company_name?: string | null } | null;
  prospect: { company_name: string } | Array<{ company_name: string }> | null;
};

/**
 * The customer name to show for a quote.
 *
 * Order matters and is not arbitrary: a prospect-backed quote should read as the prospect company
 * (that's the entity the seller is working), then the point-in-time snapshot stored on the quote,
 * and only last the live `customer_name` column. The snapshot outranks the column so an old quote
 * keeps showing who it was written for even if the customer has since been renamed.
 */
export function quoteCustomerName(item: QuoteNameFields): string {
  const prospect = Array.isArray(item.prospect) ? item.prospect[0] : item.prospect;
  return prospect?.company_name
    || item.customer_snapshot?.customer_name
    || item.customer_snapshot?.company_name
    || item.customer_name
    || 'Okänd kund';
}

export type QuoteLabelFields = {
  project_name: string;
  quote_number: string | null;
  fortnox_offer_number?: string | null;
};

/**
 * Hur en offert HETER när den nämns någon annanstans än på sig själv — i en kopplingsväljare, på
 * en uppgift, i en lista över relaterade poster.
 *
 * 🧨 Numret MÅSTE gå via documentRef, alltså Fortnox-numret först. `quote_number` är genererat ur
 * id:t ('OFF-' + åtta tecken, 20260603_crm_quotes_quote_number.sql) och är bara en reserv för
 * offerter som ännu inte synkats. Offertlistan, panelens rubrik och arbetsordern visar alla
 * '#10144'; en etikett som säger 'OFF-3AA74887' pekar på samma offert med ett nummer ingen känner
 * igen — och etiketten FRYSES i metadata.related_label, så uppgiften bär det felaktiga numret för
 * alltid.
 *
 * Bor här och inte lokalt i den som råkar behöva den: det finns tre ställen som skapar sådana
 * kopplingar (uppgiftssidans väljare, offertpanelens formulär och den automatiska
 * uppföljningsuppgiften). Tre kopior hade tyst börjat producera olika etiketter för samma offert.
 */
export function quoteLabel(item: QuoteLabelFields): string {
  const ref = documentRef(item.fortnox_offer_number, item.quote_number);
  return ref === '–' ? item.project_name : `${item.project_name} (${ref})`;
}

export type QuoteOverdueFields = {
  follow_up_date: string | null;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
};

/**
 * Is the follow-up date in the past and still relevant?
 *
 * Won and lost quotes are never overdue — the deal is closed, so nagging about a follow-up date
 * that was set weeks earlier is noise. `today` is injectable so the check is testable without
 * freezing the clock; it defaults to the runtime's local calendar day, which is what a Swedish
 * seller's browser shows.
 */
export function isQuoteOverdue(item: QuoteOverdueFields, today: Date = new Date()): boolean {
  if (!item.follow_up_date || item.status === 'won' || item.status === 'lost') return false;
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return item.follow_up_date < iso;
}

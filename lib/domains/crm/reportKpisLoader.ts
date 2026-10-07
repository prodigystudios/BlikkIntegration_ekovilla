import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTIVE_QUOTE_STATUSES, ORDER_STOCK_SELECT, ORDER_STOCK_STATUSES } from './overviewSummary';
import { readEveryRow } from './reports';
import type { OpenQuoteRow, OrderStockRow } from './reportKpis';
import type { CustomerOrderRow } from './reportRevenue';

// Läsningarna bakom rapportens ögonblicksbilder — orderstocken och de öppna offerterna. Båda följer
// INTE periodväljaren: de svarar på "hur ser det ut just nu".
//
// Rutten kör dem med admin-klienten, samma skäl som resten av rapporten: lagets samlade tal, inte
// läsarens egna. Varje läsning kastar vid fel, och rutten fångar var och en för sig så att en
// trasig ögonblicksbild inte sänker resten av sidan.
//
// ⚠️ SIDINDELADE, och lagren är ändå små (89 order och 206 offerter i prod 2026-10-07). Skälet är
// att de växer med verksamheten och inte med en period — det finns ingen gräns som håller dem under
// PostgRESTs tyst kapande 1000-radstak. `id` är den unika sorteringen sidorna vilar på.
//
// Radtyperna härleds ur select-strängarna (readEveryRow), så en select som tappar en obligatorisk
// kolumn fäller typkontrollen. Utan `invoice_rounds` hade varje delfakturerad order räknats med hela
// sitt värde — den redan fakturerade delen både i stocken och i Fakturerat.

/**
 * Orderstockens rader MED orderns id — orderstocken per depå (Produkt & marknad) slår upp orderns schema
 * på den. Översiktens egen läsning (overviewSummary.ts) behöver inte id:t och delar bara resten.
 */
export type ReportOrderStockRow = OrderStockRow & { id: string };
const REPORT_ORDER_STOCK_SELECT = `id, ${ORDER_STOCK_SELECT}` as const;

export function fetchOrderStockRows(admin: SupabaseClient): Promise<ReportOrderStockRow[]> {
  return readEveryRow('orderstock', (from, to) =>
    admin.from('crm_work_orders')
      .select(REPORT_ORDER_STOCK_SELECT)
      .in('status', ORDER_STOCK_STATUSES)
      .order('id', { ascending: true })
      .range(from, to),
  );
}

export function fetchOpenQuoteRows(admin: SupabaseClient): Promise<OpenQuoteRow[]> {
  return readEveryRow('öppna offerter', (from, to) =>
    admin.from('crm_quotes')
      .select('status, amount, vat_percent, pricing_summary, quote_date, valid_until, follow_up_date')
      .in('status', ACTIVE_QUOTE_STATUSES)
      .order('id', { ascending: true })
      .range(from, to),
  );
}

/**
 * Varje order sedan start, med sin kund — "återkommande kunder" under Omsättning räknar hur många order
 * varje kund har. Bara fyra kolumner: tabellen läses i sin helhet. Avbrutna och order efter periodens slut
 * filtreras i countOrdersPerCustomer.
 *
 * Känt: läsningen växer med verksamheten, en sida per 1 000 order (prod 2026-10: drygt 250, ~150 i
 * månaden). Blir den märkbar: räkna bara periodens kunder med en `.in()` i klumpar, eller en GROUP BY.
 */
export function fetchCustomerOrderRows(admin: SupabaseClient): Promise<CustomerOrderRow[]> {
  return readEveryRow('kundernas order', (from, to) =>
    admin.from('crm_work_orders')
      .select('status, created_at, customer_id, client_name')
      .order('id', { ascending: true })
      .range(from, to),
  );
}

/**
 * Dagen då CRM:et fick sin första offert eller order — där trenden börjar så länge CRM:et är yngre än
 * tolv månader (se trendWindow). Två rader, inga sidor: det är bara den tidigaste av varje som behövs.
 * null när tabellerna är tomma. `created_at` jämförs på sin UTC-dag, samma regel som rapportens fönster.
 */
export async function fetchFirstActivityDay(admin: SupabaseClient): Promise<string | null> {
  const [quote, order] = await Promise.all([
    admin.from('crm_quotes').select('quote_date').order('quote_date', { ascending: true }).limit(1),
    admin.from('crm_work_orders').select('created_at').order('created_at', { ascending: true }).limit(1),
  ]);
  if (quote.error) throw new Error(`första offerten: ${quote.error.message}`);
  if (order.error) throw new Error(`första ordern: ${order.error.message}`);
  const days = [quote.data?.[0]?.quote_date, order.data?.[0]?.created_at]
    .filter((value): value is string => Boolean(value))
    .map((value) => String(value).slice(0, 10));
  return days.length > 0 ? days.reduce((first, day) => (day < first ? day : first)) : null;
}

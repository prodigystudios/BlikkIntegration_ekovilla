import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTIVE_QUOTE_STATUSES, ORDER_STOCK_SELECT, ORDER_STOCK_STATUSES } from './overviewSummary';
import { readEveryRow } from './reports';
import type { OpenQuoteRow, OrderStockRow } from './reportKpis';

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

export function fetchOrderStockRows(admin: SupabaseClient): Promise<OrderStockRow[]> {
  return readEveryRow('orderstock', (from, to) =>
    admin.from('crm_work_orders')
      .select(ORDER_STOCK_SELECT)
      .in('status', ORDER_STOCK_STATUSES)
      .order('id', { ascending: true })
      .range(from, to),
  );
}

export function fetchOpenQuoteRows(admin: SupabaseClient): Promise<OpenQuoteRow[]> {
  return readEveryRow('öppna offerter', (from, to) =>
    admin.from('crm_quotes')
      .select('status, amount, vat_percent, pricing_summary, valid_until, follow_up_date')
      .in('status', ACTIVE_QUOTE_STATUSES)
      .order('id', { ascending: true })
      .range(from, to),
  );
}

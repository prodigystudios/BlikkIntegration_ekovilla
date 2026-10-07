import type { SupabaseClient } from '@supabase/supabase-js';
import { readAllPages } from '@/lib/domains/planning/pagedRead';
import { ACTIVE_QUOTE_STATUSES } from './overviewSummary';
import { ORDER_STOCK_STATUSES, type OpenQuoteRow, type OrderStockRow } from './reportKpis';

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

export async function fetchOrderStockRows(admin: SupabaseClient): Promise<OrderStockRow[]> {
  const { rows, error } = await readAllPages<OrderStockRow>((from, to) =>
    admin.from('crm_work_orders')
      // Rundorna inbäddade: en delfakturerad order står i stocken med det som återstår, inte hela värdet.
      .select('status, amount, vat_percent, pricing_summary, invoice_rounds:crm_work_order_invoices(amount)')
      .in('status', [...ORDER_STOCK_STATUSES])
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (error) throw new Error(`orderstock: ${error.message}`);
  return rows;
}

export async function fetchOpenQuoteRows(admin: SupabaseClient): Promise<OpenQuoteRow[]> {
  const { rows, error } = await readAllPages<OpenQuoteRow>((from, to) =>
    admin.from('crm_quotes')
      .select('status, amount, vat_percent, pricing_summary, valid_until, follow_up_date')
      .in('status', ACTIVE_QUOTE_STATUSES)
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (error) throw new Error(`öppna offerter: ${error.message}`);
  return rows;
}

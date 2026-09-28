import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid } from '@/lib/api/responses';

/**
 * Brickan "Från återförsäljarportalen · <butik> · offert <nr>" i arbetsorderns sidhuvud (RESELLER_PORTAL_CRM_PLAN.md
 * fas 3b, William 2026-09-28).
 *
 * SESSIONSKLIENTEN: sessionen får läsa just de här kolumnerna i `crm_portal_jobs` (kolumngrant), och bara för en
 * arbetsorder den får läsa kontorsvägen (crm.workorder.read, eller ansvarig). Butikens namn står på jobbet, eftersom
 * säljarna inte kan läsa `crm_portal_resellers`.
 */
export type PortalJobBadge = { storeName: string; quoteNumber: string };

/** null = ordern kom inte från portalen (eller syns inte för sessionen). Kastar vid ett databasfel. */
export async function getPortalJobBadge(session: SupabaseClient, workOrderId: string): Promise<PortalJobBadge | null> {
  // Ett id som inte är en uuid får Postgres att kasta (22P02); sidan visar då sitt eget "hittades inte".
  if (!isUuid(workOrderId)) return null;
  const { data, error } = await session
    .from('crm_portal_jobs')
    .select('store_name, quote_number')
    .eq('work_order_id', workOrderId)
    .maybeSingle();
  if (error) throw new Error(`Portaljobbet gick inte att läsa: ${error.message}`);
  const row = data as { store_name: string; quote_number: string } | null;
  return row ? { storeName: row.store_name, quoteNumber: row.quote_number } : null;
}

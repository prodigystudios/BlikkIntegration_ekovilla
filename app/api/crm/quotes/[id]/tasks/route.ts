import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmQuoteStatus } from '@/lib/domains/crm/quotes';
import { attachCrmTaskParticipantNames, listCrmQuoteTasks, mapCrmTaskRows } from '@/lib/domains/crm/tasks';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { invalidUuidParam, ok, requireCrmUser, routeError } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

/**
 * Alla uppgifter som hör till offerten — även kollegornas.
 *
 * ── Varför en egen route och inte `/api/crm/tasks?quote_id=` ──
 *
 * Kundkortets `?customer_id=` läser med SESSIONSKLIENTEN och betyder därför "MINA uppgifter på
 * kunden". Det här betyder något annat — "ALLA uppgifter på offerten" — och har en helt annan
 * behörighetsgrind. Att lägga båda i samma route hade gjort /api/crm/tasks till två routes med
 * samma namn, där bara ett frågesträngsvärde avgjorde vilken man fick.
 *
 * ── Grinden ──
 *
 * ⚠️ Ordningen nedan är hela säkerheten, inte en detalj.
 *
 * Offerten läses FÖRST med sessionsklienten. Får anroparen inte se den svarar vi 404 och den
 * elevated frågan körs aldrig. Det är alltså RLS på crm_quotes som bestämmer vem som når
 * uppgifterna, inte id:t i adressen — och crm_quotes_select_visible är
 * `auth.uid() = assigned_to or has_permission('crm.offer.read')`
 * (20260609_rls_permissions_crm_quotes_workorders.sql), alltså exakt de som redan ser varenda
 * offert i listan. Ingen ny krets får se något nytt.
 *
 * Läsningen av själva uppgifterna måste vara elevated: dashboard_work_items har egen-bara RLS,
 * och policyn lämnas medvetet orörd (den personliga dashboarden läser tabellen utan user_id-filter
 * och litar helt på den). Se listCrmQuoteTasks för hela resonemanget.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    // Grinden. Sessionsklienten med flit — det är den som bär anroparens RLS.
    const supabase = createRouteHandlerClient({ cookies });
    const { data: quote, error: quoteError } = await getCrmQuoteStatus(supabase, context.params.id);
    if (quoteError || !quote) {
      return routeError(404, 'crm_quote_not_found', 'Offerten hittades inte');
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await listCrmQuoteTasks(admin, context.params.id);
    if (error) {
      return routeError(500, 'crm_quote_tasks_failed', error.message);
    }

    const items = await attachCrmTaskParticipantNames(admin, mapCrmTaskRows(data as any[] | null | undefined));

    return ok({ items });
  } catch (e: any) {
    return routeError(500, 'crm_quote_tasks_unexpected', e?.message || 'Failed to list quote tasks');
  }
}

import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listTimeApprovalOverview, normalizeOverviewRow, periodStartOf } from '@/lib/domains/time/approvals';
import { can, getEffectivePermissions, ok, periodQuerySchema, requirePermission, routeError, validationError } from '@/app/api/time/_lib';

// GET /api/admin/time/approvals?period=YYYY-MM — attestvyns underlag.
//
// Alla anställda × månaden: status, rapporterade timmar, frånvaro och ersättningar. Ligger under
// /api/admin med flit — det är kontorets yta, inte den anställdes, och /api/time/** ska förbli
// "min egen tid" utan en enda parameter som öppnar för andras.
//
// SESSIONSKLIENT, inte getSupabaseAdmin(). Läsningen kräver att man ser andras profiler, vilket
// self-select-RLS:en på profiles annars hindrar — men lösningen är RPC:n time_approval_overview,
// som är security definer med has_permission('time.approve') som första rad. Urvalet är
// säkerhetsgränsen; service-role hade öppnat hela databasen för att slippa en radpolicy.
export async function GET(req: Request) {
  try {
    const gate = await requirePermission('time.approve');
    if (gate.response || !gate.currentUser) return gate.response;

    const url = new URL(req.url);
    const parsed = periodQuerySchema.safeParse({ period: url.searchParams.get('period') });
    if (!parsed.success) return validationError(parsed.error);

    const periodStart = periodStartOf(parsed.data.period);
    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listTimeApprovalOverview(supabase, periodStart);
    if (error) return routeError(500, 'time_approval_overview_failed', error.message);

    // ⚠️ ATT ATTESTERA OCH ATT RÄTTA ÄR TVÅ SKILDA NYCKLAR, och sedan rollen `ekonomi` finns är de
    // inte längre samma personer: lönebyrån attesterar men får aldrig ändra någons timmar.
    //
    // Klienten kan inte fråga efter sina egna behörigheter, så flaggan följer med underlaget. Utan
    // den ritade vyn "Rätta" och "Ta bort" på varje öppen rad för alla som kom in — knappar vars
    // enda utfall är ett 403 från PATCH:en. En knapp som inte kan lyckas är värre än ingen knapp:
    // den som trycker tror att systemet är trasigt, inte att hon saknar behörighet.
    //
    // getEffectivePermissions är React-cachad per request, så det här kostar ingen extra rundtur.
    const perms = await getEffectivePermissions();

    return ok({
      period_start: periodStart,
      people: (data ?? []).map(normalizeOverviewRow),
      can_correct: can(perms, 'time.entry.write.all'),
    });
  } catch (e: any) {
    return routeError(500, 'time_approval_overview_unexpected', e?.message || 'Kunde inte hämta attestöversikten');
  }
}

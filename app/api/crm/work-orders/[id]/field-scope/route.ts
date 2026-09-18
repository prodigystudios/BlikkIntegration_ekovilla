import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getCrmWorkOrderLineItems } from '@/lib/domains/crm/work-orders';
import { invalidUuidParam, ok, requireSignedInUser, routeError } from '../../_lib';

// Vilken ETAPP en placering utför — fältvyns enda fråga om etapper.
//
// ── VARFÖR DEN FINNS ────────────────────────────────────────────────────────
// Fältvyn (/arbetsorder/[id]) är per ARBETSORDER och känner inte till etapper. En besättning som
// bara ska göra etapp 1 öppnade därför ordern och såg HELA jobbet: alla rader, hela säckantalet.
// Kontoret delade upp ordern, planeringen visade rätt — och killarna fick fel underlag ändå.
//
// Feeden (/mina-jobb) vet vilken placering man kom ifrån och skickar den som ?segment=. Den här
// rutten översätter det till etappen.
//
// ── TVÅ KLIENTER, MED FLIT ──────────────────────────────────────────────────
// ÅTKOMSTEN prövas med SESSIONSKLIENTEN: går arbetsordern inte att läsa finns ingenting att svara
// på, och RLS (crm.workorder.read ELLER besättning via is_user_on_work_order) är samma grind som
// fältvyn själv passerar.
//
// UPPSLAGET görs ELEVERAT, eftersom både ops_segments (planning.schedule.read) och
// crm_work_order_stages (crm.workorder.read) är stängda för en installatör. Det som lämnas ut är
// strikt MINDRE än anroparen redan har: vilken delmängd av en order hen redan ser i sin helhet.
// Båda uppslagen är bundna till arbetsordern ur RUTT-PARAMETERN, aldrig ur frågesträngen, så ett
// segment- eller etapp-id från en annan order kan inte användas för att läsa något.
//
// nodejs: admin-klienten använder service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response) return currentUser.response;

    const workOrderId = context.params.id;
    const badId = invalidUuidParam(workOrderId);
    if (badId) return badId;

    const segmentId = new URL(req.url).searchParams.get('segment');
    // Ingen placering angiven = inget scope. Direktlänkar till ordern ska fortsätta visa helheten.
    if (!segmentId) return ok({ stage: null });
    const badSegment = invalidUuidParam(segmentId);
    if (badSegment) return badSegment;

    // Grinden: kan anroparen läsa ordern alls?
    const supabase = createRouteHandlerClient({ cookies });
    const { data: order, error: orderError } = await getCrmWorkOrderLineItems(supabase, workOrderId);
    if (orderError) return routeError(500, 'crm_work_order_field_scope_read_failed', orderError.message);
    if (!order) return routeError(404, 'crm_work_order_not_found', 'Arbetsordern hittades inte.');

    const admin = getSupabaseAdmin();
    const { data: segment, error: segErr } = await admin
      .from('ops_segments')
      .select('stage_id')
      .eq('id', segmentId)
      .eq('work_order_id', workOrderId)
      .maybeSingle();
    if (segErr) return routeError(500, 'crm_work_order_field_scope_segment_failed', segErr.message);

    const stageId = (segment as { stage_id?: string | null } | null)?.stage_id ?? null;
    // Okänd placering, eller en som utför RESTEN: inget etappscope, och det är inget fel.
    if (!stageId) return ok({ stage: null });

    const { data: stage, error: stageErr } = await admin
      .from('crm_work_order_stages')
      .select('id, stage_number, title, line_quantities, work_description')
      .eq('id', stageId)
      .eq('work_order_id', workOrderId)
      .maybeSingle();
    if (stageErr) return routeError(500, 'crm_work_order_field_scope_stage_failed', stageErr.message);

    return ok({ stage: stage ?? null });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_field_scope_unexpected', e?.message || 'Failed to resolve field scope');
  }
}

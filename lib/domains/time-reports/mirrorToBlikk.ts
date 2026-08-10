import type { SupabaseClient } from '@supabase/supabase-js';
import { getBlikk } from '@/lib/blikk';
import { buildCrmTimeMirrorBody, resolveCrmMirrorConfig } from './crmMirror';

// Field cutover fas 1e — side-effecting half of the CRM → Blikk time mirror.
// The mapping itself is pure and unit-tested in ./crmMirror; this module does the I/O.
//
// CONTRACT: this never throws and never reports failure to the caller as an error. The CRM row is
// already committed when we get here — the person's hours are safe. A failed mirror is a payroll
// reconciliation item (blikk_time_report_id stays null, see
// supabase/sql/20260810_crm_time_entries_blikk_mirror.sql), not a reason to fail their submit.

export type MirrorOutcome =
  | { mirrored: true; blikkTimeReportId: number | null }
  | { mirrored: false; reason: 'disabled' | 'unmappable' | 'failed' };

type WorkOrderRefRow = {
  order_number: string;
  fortnox_order_number: string | null;
  project_name: string | null;
  client_name: string | null;
};

export async function mirrorTimeEntryToBlikk(
  supabase: SupabaseClient,
  input: {
    entryId: string;
    workOrderId: string;
    userId: string;
    workDate: string;
    hours: number;
    note?: string | null;
  },
): Promise<MirrorOutcome> {
  try {
    const { internalProjectId, timeArticleId } = resolveCrmMirrorConfig();
    // Not configured = mirroring is off (local dev, or after fas 4). A valid state, not a fault.
    if (internalProjectId === null) return { mirrored: false, reason: 'disabled' };

    // Both reads go through the caller's session client: a crew member may read their own profile
    // (self-only RLS) and their own work order (crew policy, fas 1a). No service role needed.
    const [{ data: profile }, { data: workOrder }] = await Promise.all([
      supabase.from('profiles').select('blikk_id').eq('id', input.userId).maybeSingle(),
      supabase
        .from('crm_work_orders')
        .select('order_number, fortnox_order_number, project_name, client_name')
        .eq('id', input.workOrderId)
        .maybeSingle(),
    ]);

    const wo = workOrder as WorkOrderRefRow | null;
    if (!wo) return { mirrored: false, reason: 'unmappable' };

    const body = buildCrmTimeMirrorBody({
      blikkUserId: (profile as { blikk_id?: number | null } | null)?.blikk_id ?? null,
      internalProjectId,
      timeArticleId,
      workDate: input.workDate,
      hours: input.hours,
      note: input.note,
      orderNumber: wo.order_number,
      fortnoxOrderNumber: wo.fortnox_order_number,
      projectName: wo.project_name,
      clientName: wo.client_name,
    });
    // Most common cause: the person has no profiles.blikk_id. Surfaced by the preflight query in
    // supabase/sql/20260810_golive_preflight_verify.sql, section 5.
    if (!body) return { mirrored: false, reason: 'unmappable' };

    const res = await getBlikk().createTimeReport(body);
    const rawId = (res?.data as { id?: unknown } | null)?.id;
    const blikkTimeReportId = Number.isFinite(Number(rawId)) ? Number(rawId) : null;

    // Stamp the link so reconciliation can tell "mirrored" from "never made it". If this update
    // fails the row just looks unmirrored — safe direction to fail in (it gets re-checked, not
    // silently dropped).
    await supabase
      .from('crm_work_order_time_entries')
      .update({ blikk_time_report_id: blikkTimeReportId })
      .eq('id', input.entryId);

    return { mirrored: true, blikkTimeReportId };
  } catch (e) {
    console.warn('[crm time mirror] Blikk mirror failed; entry saved in CRM only', {
      entryId: input.entryId,
      workOrderId: input.workOrderId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { mirrored: false, reason: 'failed' };
  }
}

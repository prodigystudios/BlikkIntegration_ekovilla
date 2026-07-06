import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCurrentUser, requireFaultReportRecipient } from '@/lib/auth/route';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { ok, routeError, validationError, invalidUuidParam, isNoRowsError } from '@/lib/api/responses';
import { updateFaultReportSchema } from '@/lib/domains/fault-reports/schemas';
import { getFaultReport, listFaultReportUpdates } from '@/lib/domains/fault-reports/queries';
import { updateFaultReport, addFaultReportUpdate } from '@/lib/domains/fault-reports/mutations';
import { mapFaultReportRow, mapFaultReportUpdateRows } from '@/lib/domains/fault-reports/mappers';
import { statusLabel, type FaultReportRow, type FaultReportUpdateRow, type FaultReportView } from '@/lib/domains/fault-reports/types';
import { buildFaultReportUpdatedNotification } from '@/lib/domains/notifications/payload';
import { expandNotificationToRecipients } from '@/lib/domains/notifications/mutations';
import { deliverNotifications } from '@/lib/domains/notifications/delivery';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');

    const badId = invalidUuidParam(params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    // RLS lets reporter OR recipient read; a hidden row returns null.
    const { data, error } = await getFaultReport(supabase, params.id);
    if (error) return routeError(500, 'fault_report_get_failed', error.message);
    if (!data) return routeError(404, 'not_found', 'Ärendet hittades inte.');

    const { data: updates } = await listFaultReportUpdates(supabase, params.id);

    return ok({
      item: mapFaultReportRow(data as FaultReportRow),
      updates: mapFaultReportUpdateRows(updates as FaultReportUpdateRow[] | null),
    });
  } catch (e: any) {
    return routeError(500, 'fault_reports_unexpected', e?.message || 'Failed to load fault report');
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const recipient = await requireFaultReportRecipient();
    if (recipient.response || !recipient.currentUser) return recipient.response;

    const badId = invalidUuidParam(params.id);
    if (badId) return badId;

    const parsed = updateFaultReportSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateFaultReport(supabase, params.id, {
      ...parsed.data,
      responder_id: recipient.currentUser.id,
      responder_name: recipient.currentUser.name || 'Arbetsledare',
    });
    if (isNoRowsError(error)) return routeError(404, 'not_found', 'Ärendet hittades inte.');
    if (error || !data) return routeError(500, 'fault_report_update_failed', error?.message || 'Update failed');

    // Parent row is committed → the save succeeded. Append history + notify the reporter
    // best-effort; a transient failure here must not report a false error to the supervisor
    // (which would prompt a retry and a duplicate history entry).
    const { error: historyError } = await addFaultReportUpdate(supabase, {
      report_id: data.id,
      status: parsed.data.status,
      reply: parsed.data.reply,
      responder_id: recipient.currentUser.id,
      responder_name: recipient.currentUser.name || 'Arbetsledare',
    });
    if (historyError) console.error('[felanmalan] history insert failed', historyError);

    await notifyReporter(data).catch((e) => console.error('[felanmalan] reporter notify failed', e));

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'fault_reports_unexpected', e?.message || 'Failed to update fault report');
  }
}

async function notifyReporter(report: FaultReportView) {
  if (!report.reporter_id) return;
  const admin = getSupabaseAdmin();
  const content = buildFaultReportUpdatedNotification({
    reportId: report.id,
    categoryLabel: report.category_label,
    reporterName: report.reporter_name,
    statusLabel: statusLabel[report.status],
  });
  await deliverNotifications(admin, expandNotificationToRecipients(content, [report.reporter_id]));
}

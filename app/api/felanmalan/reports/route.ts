import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCurrentUser, requireFaultReportRecipient } from '@/lib/auth/route';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email';
import { ok, routeError, validationError } from '@/lib/api/responses';
import {
  createFaultReportSchema,
  listFaultReportsQuerySchema,
} from '@/lib/domains/fault-reports/schemas';
import { createFaultReport } from '@/lib/domains/fault-reports/mutations';
import { listInboxFaultReports, listMyFaultReports } from '@/lib/domains/fault-reports/queries';
import { mapFaultReportRows } from '@/lib/domains/fault-reports/mappers';
import { listActiveRecipients, resolveRecipientEmails, dedupeEmails } from '@/lib/domains/fault-reports/recipients';
import { buildFaultReportEmail } from '@/lib/domains/fault-reports/email';
import type { FaultReportRow, FaultReportView } from '@/lib/domains/fault-reports/types';
import { buildFaultReportCreatedNotification } from '@/lib/domains/notifications/payload';
import { createNotifications, expandNotificationToRecipients } from '@/lib/domains/notifications/mutations';

export async function GET(req: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');

    const url = new URL(req.url);
    const parsed = listFaultReportsQuerySchema.safeParse({
      scope: url.searchParams.get('scope') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });

    if (parsed.data.scope === 'inbox') {
      const recipient = await requireFaultReportRecipient();
      if (recipient.response) return recipient.response;
      const { data, error } = await listInboxFaultReports(supabase, { status: parsed.data.status });
      if (error) return routeError(500, 'fault_reports_list_failed', error.message);
      return ok({ items: mapFaultReportRows(data as FaultReportRow[] | null) });
    }

    const { data, error } = await listMyFaultReports(supabase, currentUser.id);
    if (error) return routeError(500, 'fault_reports_list_failed', error.message);
    return ok({ items: mapFaultReportRows(data as FaultReportRow[] | null) });
  } catch (e: any) {
    return routeError(500, 'fault_reports_unexpected', e?.message || 'Failed to list fault reports');
  }
}

export async function POST(req: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');

    const parsed = createFaultReportSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createFaultReport(supabase, {
      ...parsed.data,
      reporter_id: currentUser.id,
      reporter_name: currentUser.name || 'Okänd användare',
    });
    if (error || !data) return routeError(500, 'fault_report_create_failed', error?.message || 'Insert failed');

    // Fan-out (best-effort — never fail the user's submission on notify errors).
    await fanOutNewReport(data, req).catch((e) => console.error('[felanmalan] fan-out failed', e));

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'fault_reports_unexpected', e?.message || 'Failed to create fault report');
  }
}

async function fanOutNewReport(report: FaultReportView, req: Request) {
  const admin = getSupabaseAdmin();
  const recipientIds = await listActiveRecipients(admin);
  // Don't notify the reporter about their own report (they may themselves be a supervisor).
  const notifyIds = recipientIds.filter((id) => id !== report.reporter_id);

  // In-app notifications (one per recipient), when there are any.
  if (notifyIds.length > 0) {
    const content = buildFaultReportCreatedNotification({
      reportId: report.id,
      categoryLabel: report.category_label,
      reporterName: report.reporter_name,
    });
    await createNotifications(admin, expandNotificationToRecipients(content, notifyIds));
  }

  // Email: resolved supervisor addresses + the FELANMALAN_NOTIFY_TO fallback/override. Runs even
  // when the recipients table is empty, so the env fallback still reaches someone.
  const resolved = await resolveRecipientEmails(admin, notifyIds);
  const envList = (process.env.FELANMALAN_NOTIFY_TO || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const emails = dedupeEmails([...resolved, ...envList]);
  if (emails.length === 0) return;

  const origin = safeOrigin(req);
  const { subject, html, text } = buildFaultReportEmail(report, origin);
  await sendEmail({ to: emails, subject, html, text });
}

function safeOrigin(req: Request): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  } catch {
    return undefined;
  }
}

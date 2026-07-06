import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmWorkOrderComment, listCrmWorkOrderComments } from '@/lib/domains/crm/work-orders';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { buildWorkOrderCommentMentionNotification } from '@/lib/domains/notifications/payload';
import { expandNotificationToRecipients } from '@/lib/domains/notifications/mutations';
import { deliverNotifications } from '@/lib/domains/notifications/delivery';
import { createWorkOrderCommentSchema, ok, requireSignedInUser, routeError, validationError } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response) return currentUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listCrmWorkOrderComments(supabase, context.params.id);

    if (error) {
      return routeError(500, 'crm_work_order_comments_list_failed', error.message);
    }

    return ok({ items: data || [] });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_comments_unexpected', e?.message || 'Failed to list work order comments');
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const parsedBody = createWorkOrderCommentSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createCrmWorkOrderComment(supabase, {
      work_order_id: context.params.id,
      created_by: currentUser.currentUser.id,
      body: parsedBody.data.body,
    });

    if (error) {
      return routeError(500, 'crm_work_order_comment_create_failed', error.message);
    }

    // Notify @-mentioned users (best-effort — never fail the comment on a notify error).
    await fanOutMentions({
      workOrderId: context.params.id,
      authorId: currentUser.currentUser.id,
      authorName: currentUser.currentUser.name ?? null,
      mentionedIds: parsedBody.data.mentioned_user_ids,
    }).catch((e) => console.error('[work-order-comment] mention fan-out failed', e));

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_work_order_comment_unexpected', e?.message || 'Failed to create work order comment');
  }
}

async function fanOutMentions(input: {
  workOrderId: string;
  authorId: string;
  authorName: string | null;
  mentionedIds: string[];
}) {
  // Dedupe + drop the author (no self-mention notification).
  const ids = Array.from(new Set(input.mentionedIds)).filter((id) => id && id !== input.authorId);
  if (ids.length === 0) return;

  const admin = getSupabaseAdmin();
  // Validate the client-supplied ids are real profiles: recipient_user_id FKs to profiles, so one
  // bogus id would otherwise fail the whole batch insert and nobody would be notified. We also read
  // `role` to route each recipient's notification to a view they can open (see below).
  const { data: profs } = await admin.from('profiles').select('id, role').in('id', ids);
  const validProfiles = (profs || []) as { id: string; role: string | null }[];
  if (validProfiles.length === 0) return;

  const { data: wo } = await admin
    .from('crm_work_orders')
    .select('order_number, project_name')
    .eq('id', input.workOrderId)
    .maybeSingle();

  // Split recipients by CRM access (mirrors the /crm layout gate: konsult == sales). Office roles
  // link to the CRM detail view; everyone else to the open field view, so an installer isn't sent
  // to a /crm/* page that would bounce them to '/'.
  const hasCrmAccess = (role: string | null) => role === 'admin' || role === 'sales' || role === 'konsult';
  const crmIds = validProfiles.filter((p) => hasCrmAccess(p.role)).map((p) => p.id);
  const fieldIds = validProfiles.filter((p) => !hasCrmAccess(p.role)).map((p) => p.id);

  const base = {
    workOrderId: input.workOrderId,
    orderNumber: (wo as { order_number?: string | null } | null)?.order_number ?? null,
    projectName: (wo as { project_name?: string | null } | null)?.project_name ?? null,
    commenterName: input.authorName,
  };
  const rows = [
    ...expandNotificationToRecipients(buildWorkOrderCommentMentionNotification({ ...base, audience: 'crm' }), crmIds),
    ...expandNotificationToRecipients(buildWorkOrderCommentMentionNotification({ ...base, audience: 'field' }), fieldIds),
  ];
  if (rows.length > 0) await deliverNotifications(admin, rows);
}
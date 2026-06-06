import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { deleteCrmWorkOrderComment, updateCrmWorkOrderComment } from '@/lib/domains/crm/work-orders';
import { createWorkOrderCommentSchema, ok, requireSignedInUser, routeError, validationError } from '../../../_lib';

type RouteContext = {
  params: {
    id: string;
    commentId: string;
  };
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const parsedBody = createWorkOrderCommentSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateCrmWorkOrderComment(supabase, context.params.commentId, currentUser.currentUser.id, parsedBody.data.body);

    if (error) return routeError(500, 'crm_work_order_comment_update_failed', error.message);
    if (!data) return routeError(404, 'crm_work_order_comment_not_found', 'Kommentaren hittades inte eller tillhör en annan användare');

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_comment_update_unexpected', e?.message || 'Failed to update comment');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await deleteCrmWorkOrderComment(supabase, context.params.commentId, currentUser.currentUser.id);

    if (error) return routeError(500, 'crm_work_order_comment_delete_failed', error.message);
    if (!data) return routeError(404, 'crm_work_order_comment_not_found', 'Kommentaren hittades inte eller tillhör en annan användare');

    return ok({ id: context.params.commentId });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_comment_delete_unexpected', e?.message || 'Failed to delete comment');
  }
}

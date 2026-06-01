import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmWorkOrderComment, listCrmWorkOrderComments } from '@/lib/domains/crm/work-orders';
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

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_work_order_comment_unexpected', e?.message || 'Failed to create work order comment');
  }
}
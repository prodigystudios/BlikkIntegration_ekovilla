import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { updateCrmTask } from '@/lib/crm/tasks';
import {
  ok,
  requireCrmUser,
  routeError,
  updateCrmTaskSchema,
  validationError,
} from '../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = updateCrmTaskSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const payload = {
      ...parsedBody.data,
      completed_at: parsedBody.data.status === 'done' ? new Date().toISOString() : null,
    };

    const { data, error } = await updateCrmTask(supabase, context.params.id, payload);

    if (error) {
      return routeError(500, 'crm_task_update_failed', error.message);
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_task_update_unexpected', e?.message || 'Failed to update task');
  }
}
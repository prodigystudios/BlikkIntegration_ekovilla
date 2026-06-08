import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmTask, listCrmTasks, mapCrmTaskRows } from '@/lib/domains/crm/tasks';
import {
  createCrmTaskSchema,
  listCrmTasksQuerySchema,
  ok,
  requireCrmUser,
  routeError,
  validationError,
} from './_lib';

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsedQuery = listCrmTasksQuerySchema.safeParse({
      q: url.searchParams.get('q') || undefined,
      status: url.searchParams.get('status') || undefined,
      prospect_id: url.searchParams.get('prospect_id') || undefined,
      customer_id: url.searchParams.get('customer_id') || undefined,
    });

    if (!parsedQuery.success) return validationError(parsedQuery.error);

    const supabase = createRouteHandlerClient({ cookies });
    const query = await listCrmTasks(supabase, {
      search: parsedQuery.data.q,
      status: parsedQuery.data.status,
      prospectId: parsedQuery.data.prospect_id,
      customerId: parsedQuery.data.customer_id,
    });
    const { data, error } = await query;

    if (error) {
      return routeError(500, 'crm_tasks_list_failed', error.message);
    }

    return ok({ items: mapCrmTaskRows(data as any[] | null | undefined) });
  } catch (e: any) {
    return routeError(500, 'crm_tasks_unexpected', e?.message || 'Failed to list tasks');
  }
}

export async function POST(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = createCrmTaskSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const payload = {
      ...parsedBody.data,
      user_id: crmUser.currentUser.id,
      completed_at: parsedBody.data.status === 'done' ? new Date().toISOString() : null,
    };

    const { data, error } = await createCrmTask(supabase, payload);

    if (error) {
      return routeError(500, 'crm_task_create_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_task_unexpected', e?.message || 'Failed to create task');
  }
}
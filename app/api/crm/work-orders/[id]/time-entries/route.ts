import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmWorkOrderTimeEntry, listCrmWorkOrderTimeEntries } from '@/lib/domains/crm/work-orders';
import { createWorkOrderTimeEntrySchema, ok, requireSignedInUser, routeError, validationError } from '../../_lib';

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
    const { data, error } = await listCrmWorkOrderTimeEntries(supabase, context.params.id);

    if (error) {
      return routeError(500, 'crm_work_order_time_entries_list_failed', error.message);
    }

    return ok({ items: data || [] });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_time_entries_unexpected', e?.message || 'Failed to list work order time entries');
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const parsedBody = createWorkOrderTimeEntrySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createCrmWorkOrderTimeEntry(supabase, {
      work_order_id: context.params.id,
      user_id: currentUser.currentUser.id,
      work_date: parsedBody.data.work_date,
      hours: parsedBody.data.hours,
      note: parsedBody.data.note,
    });

    if (error) {
      return routeError(500, 'crm_work_order_time_entry_create_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_work_order_time_entry_unexpected', e?.message || 'Failed to create work order time entry');
  }
}
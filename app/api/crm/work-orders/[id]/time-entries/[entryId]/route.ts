import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { deleteCrmWorkOrderTimeEntry, updateCrmWorkOrderTimeEntry } from '@/lib/domains/crm/work-orders';
import { createWorkOrderTimeEntrySchema, ok, requireSignedInUser, routeError, validationError } from '../../../_lib';

type RouteContext = {
  params: {
    id: string;
    entryId: string;
  };
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const parsedBody = createWorkOrderTimeEntrySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateCrmWorkOrderTimeEntry(supabase, context.params.entryId, currentUser.currentUser.id, {
      work_date: parsedBody.data.work_date,
      hours: parsedBody.data.hours,
      note: parsedBody.data.note,
    });

    if (error) return routeError(500, 'crm_work_order_time_entry_update_failed', error.message);
    if (!data) return routeError(404, 'crm_work_order_time_entry_not_found', 'Tidraden hittades inte eller tillhör en annan användare');

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_time_entry_update_unexpected', e?.message || 'Failed to update time entry');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await deleteCrmWorkOrderTimeEntry(supabase, context.params.entryId, currentUser.currentUser.id);

    if (error) return routeError(500, 'crm_work_order_time_entry_delete_failed', error.message);
    if (!data) return routeError(404, 'crm_work_order_time_entry_not_found', 'Tidraden hittades inte eller tillhör en annan användare');

    return ok({ id: context.params.entryId });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_time_entry_delete_unexpected', e?.message || 'Failed to delete time entry');
  }
}

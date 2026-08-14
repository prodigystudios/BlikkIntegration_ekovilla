import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { deleteCrmWorkOrderTimeEntry, updateCrmWorkOrderTimeEntry } from '@/lib/domains/crm/work-orders';
import { buildTimeEntryRow } from '@/lib/domains/time/entries';
import { explainWriteMiss, periodLockError } from '@/lib/domains/time/approvals';
import { createWorkOrderTimeEntrySchema, ok, requireSignedInUser, routeError, validationError } from '../../../_lib';

// Kontorets Tid-flik skriver i crm_time_entries — samma tabell som löneunderlaget. Periodlåset
// (fas 4.4) gäller därför också här, och svaren måste kunna säga det: triggern kastar P0001, och
// policyns lås filtrerar bort raden så en UPDATE träffar noll rader utan fel.
async function lockedOrNotFound(
  supabase: Parameters<typeof explainWriteMiss>[0],
  entryId: string,
  userId: string,
) {
  const miss = await explainWriteMiss(supabase, {
    table: 'crm_time_entries', dateColumn: 'work_date', id: entryId, userId,
  });
  if (miss.locked) return routeError(409, 'time_period_locked', miss.message);
  return routeError(404, 'crm_work_order_time_entry_not_found', 'Tidraden hittades inte eller tillhör en annan användare');
}

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

    // Ordern skickas med bara för att buildTimeEntryRow ska kunna validera en arbetsorderrad —
    // updateCrmWorkOrderTimeEntry skalar bort den igen, så en PATCH kan aldrig flytta raden till
    // ett annat jobb.
    const built = buildTimeEntryRow({
      kind: 'work_order',
      work_date: parsedBody.data.work_date,
      work_order_id: context.params.id,
      start_time: parsedBody.data.start_time,
      end_time: parsedBody.data.end_time,
      break_minutes: parsedBody.data.break_minutes,
      note: parsedBody.data.note,
    }, currentUser.currentUser.id);
    if (built.error || !built.row) return routeError(400, 'crm_work_order_time_entry_invalid', built.error || 'Ogiltig tidrad');

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateCrmWorkOrderTimeEntry(supabase, context.params.entryId, currentUser.currentUser.id, built.row);

    if (error) {
      const locked = periodLockError(error);
      if (locked) return routeError(locked.status, locked.code, locked.message);
      return routeError(500, 'crm_work_order_time_entry_update_failed', error.message);
    }
    if (!data) return lockedOrNotFound(supabase, context.params.entryId, currentUser.currentUser.id);

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

    if (error) {
      const locked = periodLockError(error);
      if (locked) return routeError(locked.status, locked.code, locked.message);
      return routeError(500, 'crm_work_order_time_entry_delete_failed', error.message);
    }
    if (!data) return lockedOrNotFound(supabase, context.params.entryId, currentUser.currentUser.id);

    return ok({ id: context.params.entryId });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_time_entry_delete_unexpected', e?.message || 'Failed to delete time entry');
  }
}

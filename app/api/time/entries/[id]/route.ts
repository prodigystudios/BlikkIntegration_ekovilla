import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { buildTimeEntryRow, deleteTimeEntry, updateTimeEntry } from '@/lib/domains/time/entries';
import { createTimeEntrySchema, explainWriteMiss, invalidUuidParam, ok, periodLockError, requirePermission, routeError, validationError } from '../../_lib';

type RouteContext = { params: { id: string } };

// PATCH /api/time/entries/<id> — rätta en egen tidrad.
//
// Hela raden byggs om i stället för att fält lappas: minuterna måste räknas ur de klockslag som
// faktiskt blir sparade, och en delvis uppdatering där bara sluttiden ändras skulle annars lämna en
// minutsumma som hör till den gamla. Formuläret skickar alltid hela raden.
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('time.entry.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = createTimeEntrySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const built = buildTimeEntryRow(parsed.data, gate.currentUser.id);
    if (built.error || !built.row) return routeError(400, 'time_entry_invalid', built.error || 'Ogiltig tidrad');

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateTimeEntry(supabase, context.params.id, gate.currentUser.id, built.row);
    if (error) {
      const locked = periodLockError(error);
      if (locked) return routeError(locked.status, locked.code, locked.message);
      return routeError(500, 'time_entry_update_failed', error.message);
    }
    // Noll rader = raden finns inte, tillhör någon annan, eller ligger i en låst period. De två
    // första ska svara likadant: annars går det att avgöra att en rad existerar genom att försöka
    // ändra den. Den tredje är den egna raden och ska förklaras — se explainWriteMiss.
    if (!data) {
      const miss = await explainWriteMiss(supabase, {
        table: 'crm_time_entries', dateColumn: 'work_date', id: context.params.id, userId: gate.currentUser.id,
      });
      if (miss.locked) return routeError(409, 'time_period_locked', miss.message);
      return routeError(404, 'time_entry_not_found', 'Tidraden hittades inte');
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'time_entry_update_unexpected', e?.message || 'Kunde inte spara tidraden');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('time.entry.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await deleteTimeEntry(supabase, context.params.id, gate.currentUser.id);
    if (error) {
      const locked = periodLockError(error);
      if (locked) return routeError(locked.status, locked.code, locked.message);
      return routeError(500, 'time_entry_delete_failed', error.message);
    }
    if (!data) {
      const miss = await explainWriteMiss(supabase, {
        table: 'crm_time_entries', dateColumn: 'work_date', id: context.params.id, userId: gate.currentUser.id,
      });
      if (miss.locked) return routeError(409, 'time_period_locked', miss.message);
      return routeError(404, 'time_entry_not_found', 'Tidraden hittades inte');
    }

    return ok({ id: data.id });
  } catch (e: any) {
    return routeError(500, 'time_entry_delete_unexpected', e?.message || 'Kunde inte ta bort tidraden');
  }
}

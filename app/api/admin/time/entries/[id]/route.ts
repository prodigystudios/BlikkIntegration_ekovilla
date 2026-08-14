import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { explainWriteMiss, periodLockError } from '@/lib/domains/time/approvals';
import {
  adminDeleteTimeEntry,
  adminUpdateTimeEntry,
  buildTimeEntryRow,
  getTimeEntryForCorrection,
  mergeCorrection,
} from '@/lib/domains/time/entries';
import {
  correctTimeEntrySchema,
  invalidUuidParam,
  ok,
  requirePermission,
  routeError,
  validationError,
} from '@/app/api/time/_lib';

// Adminrättelse av EN ANNAN PERSONS tidrad.
//
// Regeln var länge att ingen ändrar någon annans timmar — policyerna är `user_id = auth.uid()`, och
// vägen att rätta har varit att öppna perioden så personen rättar själv. Den regeln hade ett hål:
// en anställd som är sjukskriven, har slutat eller inte svarar när lönen ska köras. Då gick
// månaden inte att rätta alls, och med Blikk borta är det här enda systemet.
//
// ⚠️ ATTESTERAD TID ÄNDRAS INTE, inte ens härifrån. Låstriggern prövar RADENS ÄGARE, så en admin
// måste öppna personens period först — vilket kräver en anledning som sparas på attestraden och
// visas för den anställde i /tid. Rättelsen lämnar alltså spår i båda ändarna: varför perioden
// öppnades, och exakt vad som ändrades.
//
// ⚠️ REVISIONSLOGGEN SKRIVS AV EN DATABASTRIGGER, inte här. Det är avsiktligt: en serverväg som
// glömmer logga, eller en UPDATE körd direkt i SQL-editorn, ska inte kunna gå förbi den.
// Se supabase/sql/20260814_time_admin_corrections.sql.

type RouteContext = { params: { id: string } };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('time.entry.write.all');
    // Uppdelad i två steg i stället för husets `return gate.response`: Next's genererade routetyp
    // tillåter inte `null` i returen, och den ena grenen kan inte smalna av den andra åt oss.
    if (gate.response) return gate.response;
    if (!gate.currentUser) return routeError(401, 'unauthorized', 'Unauthorized');
    // Husets hjälpare returnerar null när id:t ÄR giltigt — den ska prövas, inte returneras rakt av.
    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = correctTimeEntrySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });

    // Ägaren läses ur DATABASEN, aldrig ur anropet. Kom user_id från klienten kunde en rättelse
    // flytta någons timmar till en annan persons löneunderlag med en handskriven request.
    const existing = await getTimeEntryForCorrection(supabase, context.params.id);
    if (existing.error) return routeError(500, 'time_entry_lookup_failed', existing.error.message);
    if (!existing.data) return routeError(404, 'time_entry_not_found', 'Tidraden hittades inte');
    const current = existing.data as Parameters<typeof mergeCorrection>[0] & { user_id: string };

    const built = buildTimeEntryRow(mergeCorrection(current, parsed.data), current.user_id);
    if (built.error || !built.row) return routeError(400, 'time_entry_invalid', built.error || 'Ogiltig tidrad');

    const { data, error } = await adminUpdateTimeEntry(supabase, context.params.id, built.row);
    if (error) {
      const locked = periodLockError(error);
      if (locked) return routeError(locked.status, locked.code, locked.message);
      return routeError(500, 'time_entry_update_failed', error.message);
    }
    // Noll rader betyder nästan alltid att periodlåset i policyns USING filtrerade bort raden —
    // en UPDATE som inte passerar USING ger noll rader UTAN fel. explainWriteMiss läser raden på
    // nytt (SELECT-policyn bär inget lås) och svarar med skillnaden mellan inlämnad och attesterad.
    if (!data) {
      const miss = await explainWriteMiss(supabase, {
        table: 'crm_time_entries', dateColumn: 'work_date', id: context.params.id, userId: current.user_id,
      });
      if (miss.locked) return routeError(409, 'time_period_locked', miss.message);
      return routeError(404, 'time_entry_not_found', 'Tidraden hittades inte');
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'admin_time_entry_update_unexpected', e?.message || 'Kunde inte rätta tidraden');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('time.entry.write.all');
    // Uppdelad i två steg i stället för husets `return gate.response`: Next's genererade routetyp
    // tillåter inte `null` i returen, och den ena grenen kan inte smalna av den andra åt oss.
    if (gate.response) return gate.response;
    if (!gate.currentUser) return routeError(401, 'unauthorized', 'Unauthorized');
    // Husets hjälpare returnerar null när id:t ÄR giltigt — den ska prövas, inte returneras rakt av.
    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });

    // Ägaren behövs innan raderingen: efteråt finns ingen rad att förklara ett låst svar med.
    const existing = await getTimeEntryForCorrection(supabase, context.params.id);
    if (existing.error) return routeError(500, 'time_entry_lookup_failed', existing.error.message);
    if (!existing.data) return routeError(404, 'time_entry_not_found', 'Tidraden hittades inte');
    const ownerId = (existing.data as { user_id: string }).user_id;

    const { data, error } = await adminDeleteTimeEntry(supabase, context.params.id);
    if (error) {
      const locked = periodLockError(error);
      if (locked) return routeError(locked.status, locked.code, locked.message);
      return routeError(500, 'time_entry_delete_failed', error.message);
    }
    if (!data) {
      const miss = await explainWriteMiss(supabase, {
        table: 'crm_time_entries', dateColumn: 'work_date', id: context.params.id, userId: ownerId,
      });
      if (miss.locked) return routeError(409, 'time_period_locked', miss.message);
      return routeError(404, 'time_entry_not_found', 'Tidraden hittades inte');
    }

    return ok({ id: context.params.id });
  } catch (e: any) {
    return routeError(500, 'admin_time_entry_delete_unexpected', e?.message || 'Kunde inte ta bort tidraden');
  }
}

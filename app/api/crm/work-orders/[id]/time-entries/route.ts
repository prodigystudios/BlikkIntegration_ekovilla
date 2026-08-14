import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmWorkOrderTimeEntry, listCrmWorkOrderTimeEntries } from '@/lib/domains/crm/work-orders';
import { buildTimeEntryRow } from '@/lib/domains/time/entries';
import { periodLockError } from '@/lib/domains/time/approvals';
import { createWorkOrderTimeEntrySchema, ok, requireSignedInUser, routeError, validationError } from '../../_lib';

// Två klienter skriver hit: kontorets vy (/crm/arbetsorder/[id]) och fältvyn
// (/arbetsorder/[id]) — den senare bara för attestansvariga, som ett testfönster. Besättningen
// rapporterar fortfarande i Blikk, som läses ut för hand före varje lönekörning, och en öppen flik
// i fält hade blivit en andra plats att rapportera på. Villkoret bor i
// app/arbetsorder/[id]/page.tsx (`canReportTime`) och tas bort vid cutovern.
//
// Raderna är INTE bara intern uppföljning: de ligger i crm_time_entries, alltså samma tabell som
// löneunderlaget, och bär klockslag sedan 20260814_time_entries_clock_check.sql.

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

    // Samma rulle som /tid: buildTimeEntryRow räknar minuterna ur klockslagen och lämnar `hours`
    // till databastriggern. Fliken skrev tidigare timmar direkt, vilket gjorde de raderna omöjliga
    // att räkna övertid på — de är löneunderlag, inte bara kontorets uppföljning.
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
    const { data, error } = await createCrmWorkOrderTimeEntry(supabase, built.row);

    if (error) {
      // Kontorets uppföljningstid ligger i SAMMA tabell som löneunderlaget (crm_time_entries), så
      // periodlåset från fas 4.4 gäller även här. Utan den här raden blir "månaden är attesterad"
      // ett 500 med rå Postgres-text.
      const locked = periodLockError(error);
      if (locked) return routeError(locked.status, locked.code, locked.message);
      return routeError(500, 'crm_work_order_time_entry_create_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_work_order_time_entry_unexpected', e?.message || 'Failed to create work order time entry');
  }
}
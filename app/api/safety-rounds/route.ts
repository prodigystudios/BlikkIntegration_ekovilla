import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { invalidUuidParam, ok, routeError, validationError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { resolveJobAddress } from '@/lib/domains/planning/display';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { startRoundSchema } from '@/lib/domains/safetyRounds/schemas';
import {
  countOpenActionsForOrder,
  getSafetyRoundOrderHeader,
  listSafetyRounds,
  startSafetyRound,
} from '@/lib/domains/safetyRounds/store';
import { DEFAULT_EMPLOYER, DEFAULT_WORK_TYPE } from '@/lib/domains/safetyRounds/types';
import { requireSafetyRoundReader } from './_lib';

// Skyddsronderna — listan (/skyddsrond, eller en orders ronder på kortet) och starten av en ny rond.
//
// Sessionsklienten genomgående: RLS på safety_rounds gör auktoriseringen, och nyckelkontrollen här
// är den första av två spärrar. Ingen admin-klient någonstans.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const guard = await requireSafetyRoundReader();
    if (guard.response) return guard.response;

    const workOrderId = new URL(req.url).searchParams.get('work_order_id');
    if (workOrderId) {
      const badId = invalidUuidParam(workOrderId);
      if (badId) return badId;
    }

    const supabase = createRouteHandlerClient({ cookies });
    const [list, open] = await Promise.all([
      listSafetyRounds(supabase, { workOrderId: workOrderId ?? undefined }),
      workOrderId ? countOpenActionsForOrder(supabase, workOrderId) : Promise.resolve(null),
    ]);
    if (list.error) return routeError(500, 'safety_round_list_failed', list.error.message);
    if (open?.error) console.warn('[safety-rounds] öppna åtgärder:', open.error.message);

    return ok({
      items: list.data ?? [],
      open_actions: open && !open.error ? open.count ?? 0 : null,
      can_write: guard.canWrite,
    });
  } catch (e: unknown) {
    console.error('[safety-rounds] listan:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_list_unexpected', 'Kunde inte hämta skyddsronderna.');
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const parsed = startRoundSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);
    const { work_order_id: workOrderId } = parsed.data;

    const supabase = createRouteHandlerClient({ cookies });

    // Adressen löses upp HÄR, med samma regel som resten av appen (resolveJobAddress), ur de smala
    // adressfälten funktionen lämnar ut. SQL:en kopierar den som fritext.
    const { data: order, error: orderError } = await getSafetyRoundOrderHeader(supabase, workOrderId);
    if (orderError) {
      if (orderError.code === '42501') return routeError(403, 'safety_round_forbidden', 'Du har inte behörighet att starta skyddsronder.');
      return routeError(500, 'safety_round_order_read_failed', orderError.message);
    }
    if (!order) return routeError(404, 'safety_round_order_not_found', 'Arbetsordern hittades inte.');

    const { data: roundId, error } = await startSafetyRound(supabase, {
      workOrderId,
      // Svensk kalenderdag — toISOString() hade gett GÅRDAGEN mellan midnatt och två.
      heldOn: stockholmTodayISO(),
      siteAddress: resolveJobAddress(order.work_address, order.customer_address),
      employer: DEFAULT_EMPLOYER,
      workType: DEFAULT_WORK_TYPE,
    });
    if (error || !roundId) {
      if (error?.code === '23505') {
        return routeError(409, 'safety_round_number_conflict', 'Någon annan startade en rond på ordern samtidigt. Försök igen.');
      }
      if (error?.code === '42501') return routeError(403, 'safety_round_forbidden', 'Du har inte behörighet att starta skyddsronder.');
      if (error?.code === 'P0002') return routeError(404, 'safety_round_order_not_found', 'Arbetsordern hittades inte.');
      return routeError(500, 'safety_round_start_failed', error?.message || 'Kunde inte starta skyddsronden.');
    }

    return ok({ id: roundId as string }, 201);
  } catch (e: unknown) {
    console.error('[safety-rounds] starta:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_start_unexpected', 'Kunde inte starta skyddsronden.');
  }
}

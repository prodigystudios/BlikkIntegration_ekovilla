import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getDepotStockWithForecast } from '@/lib/domains/planning/depotStock';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { ok, routeError, requirePermission } from '../_lib';

// Saldo per depå och material (leveranser − härledd förbrukning), plus den tidsfasade prognosen:
// när tar depån slut, hur mycket behövs och senast vilken dag måste beställningen skickas.
//
// Båda ur EN läsning, med flit — se getDepotStockWithForecast. Två läsningar kan se olika ögonblick,
// och då säger banderollen och prognoskortet olika saker om samma depå på samma skärm.
export async function GET() {
  try {
    const gate = await requirePermission('planning.schedule.read');
    if (gate.response) return gate.response;

    const supabase = createRouteHandlerClient({ cookies });
    // stockholmTodayISO(), aldrig new Date() nere i domänen: servern kör UTC, och mellan midnatt
    // och 02:00 svensk tid är de olika kalenderdagar. "Idag" avgör vad som räknas som en försenad
    // leverans och vad som är ett behov som viks in — en dag fel flyttar båda.
    const { data, forecast, error } = await getDepotStockWithForecast(supabase, stockholmTodayISO());
    if (error) return routeError(500, 'planning_depot_stock_failed', error.message);

    return ok({ depots: data, forecast });
  } catch (e: any) {
    return routeError(500, 'planning_depot_stock_unexpected', e?.message || 'Failed to load depot stock');
  }
}

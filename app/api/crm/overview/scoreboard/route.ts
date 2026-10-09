import { z } from 'zod';
import { overviewDaySchema } from '../_dates';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { ok, routeError, validationError, requireCrmUser } from '@/app/api/crm/_shared';
import { fetchWeeklyScoreboard, type ScoreboardWindow } from '@/lib/domains/crm/weeklyScoreboard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Läser med admin-klienten. Kakan läses visserligen av requireCrmUser, men en GET-route i Next 14
// som tappar den läsningen cachar varje fetch — också supabase-js. Billig försäkring.
export const fetchCache = 'force-no-store';

// Riktiga datum, inte bara formen: veckans gränser går in i databasfilter sedan veckobytet.
const dateSchema = overviewDaySchema;

const querySchema = z.object({
  today: dateSchema,
  week_start: dateSchema,
  week_end: dateSchema,
});

function daysBetween(fromDay: string, toDay: string) {
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

// Lagets veckotavla: veckans utfall per säljare mot veckomålen. Veckan kommer från klienten, som
// /api/crm/overview:s fönster — räknad i svenska dagar (getCrmOverviewWindow), oavsett läsarens zon.
export async function GET(req: Request) {
  try {
    // Samma grind som rapporteringen: varje CRM-användare får se lagets siffror per säljare.
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      today: url.searchParams.get('today') || undefined,
      week_start: url.searchParams.get('week_start') || undefined,
      week_end: url.searchParams.get('week_end') || undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const window: ScoreboardWindow = {
      today: parsed.data.today,
      weekStart: parsed.data.week_start,
      weekEnd: parsed.data.week_end,
    };
    // Exakt en vecka, och dagen inom den. Fönstret är klientens, och läsningen går förbi RLS — utan
    // taket hade vilken CRM-användare som helst kunnat begära lagets siffror över godtycklig historik.
    if (daysBetween(window.weekStart, window.weekEnd) !== 7) {
      return routeError(400, 'invalid_window', 'Veckan måste vara exakt sju dagar.');
    }
    if (window.today < window.weekStart || window.today >= window.weekEnd) {
      return routeError(400, 'invalid_window', 'Dagens datum måste ligga inom veckan.');
    }

    // Admin-klient med flit: sessionen ger en säljare bara de egna samtalen, och tavlan ska visa
    // hela laget. Samma motivering som /api/crm/reports. Svaret är summor per säljare, inga rader.
    const scoreboard = await fetchWeeklyScoreboard(getSupabaseAdmin(), window);

    return ok({ scoreboard });
  } catch (e: any) {
    return routeError(500, 'crm_overview_scoreboard_failed', e?.message || 'Kunde inte räkna veckotavlan.');
  }
}

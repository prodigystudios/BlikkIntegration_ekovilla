import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listCrmGoals, mapCrmGoalRows, upsertCrmGoals } from '@/lib/crm/goals';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import {
  listCrmGoalsQuerySchema,
  ok,
  requireCrmAdmin,
  requireCrmUser,
  routeError,
  upsertCrmGoalsSchema,
  validationError,
} from './_lib';

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsedQuery = listCrmGoalsQuerySchema.safeParse({
      period_type: url.searchParams.get('period_type') || undefined,
      period_start: url.searchParams.get('period_start') || undefined,
    });
    if (!parsedQuery.success) return validationError(parsedQuery.error);

    const supabase = getSupabaseAdmin();
    const query = await listCrmGoals(supabase, {
      periodType: parsedQuery.data.period_type,
      periodStart: parsedQuery.data.period_start,
    });
    const { data, error } = await query;
    if (error) {
      return routeError(500, 'crm_goals_list_failed', error.message);
    }

    return ok({
      period_type: parsedQuery.data.period_type,
      period_start: parsedQuery.data.period_start,
      items: mapCrmGoalRows(data as any[] | null | undefined),
    });
  } catch (e: any) {
    return routeError(500, 'crm_goals_unexpected', e?.message || 'Failed to list goals');
  }
}

export async function POST(req: Request) {
  try {
    const crmUser = await requireCrmAdmin();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = upsertCrmGoalsSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await upsertCrmGoals(
      supabase,
      parsedBody.data.goals.map((item) => ({
        ...item,
        period_type: parsedBody.data.period_type,
        period_start: parsedBody.data.period_start,
        created_by: crmUser.currentUser!.id,
        updated_by: crmUser.currentUser!.id,
      })),
    );

    if (error) {
      return routeError(500, 'crm_goals_upsert_failed', error.message);
    }

    return ok({
      period_type: parsedBody.data.period_type,
      period_start: parsedBody.data.period_start,
      items: mapCrmGoalRows(data as any[] | null | undefined),
    });
  } catch (e: any) {
    return routeError(500, 'crm_goals_unexpected', e?.message || 'Failed to save goals');
  }
}
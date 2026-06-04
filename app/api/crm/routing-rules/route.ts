import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { z } from 'zod';
import { listRoutingRules, upsertRoutingRule, SWEDISH_COUNTIES } from '@/lib/domains/crm/routingRules';
import { ok, requireCrmAdmin, requireCrmUser, routeError, validationError } from '../_shared';

const upsertSchema = z.object({
  county: z.enum(SWEDISH_COUNTIES as unknown as [string, ...string[]]),
  user_id: z.string().uuid('Ogiltig användare'),
});

export async function GET() {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listRoutingRules(supabase);
    if (error) return routeError(500, 'routing_rules_list_failed', error.message);
    return ok({ items: data ?? [] });
  } catch (e: unknown) {
    return routeError(500, 'routing_rules_unexpected', e instanceof Error ? e.message : 'Failed');
  }
}

export async function POST(req: Request) {
  try {
    const crmAdmin = await requireCrmAdmin();
    if (crmAdmin.response || !crmAdmin.currentUser) return crmAdmin.response;

    const parsed = upsertSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await upsertRoutingRule(supabase, {
      county: parsed.data.county,
      user_id: parsed.data.user_id,
      created_by: crmAdmin.currentUser.id,
    });
    if (error) return routeError(500, 'routing_rules_upsert_failed', error.message);
    return ok({ item: data }, 201);
  } catch (e: unknown) {
    return routeError(500, 'routing_rules_upsert_unexpected', e instanceof Error ? e.message : 'Failed');
  }
}

import { createSessionClient } from '@/lib/supabase/session';
import { deleteRoutingRule } from '@/lib/domains/crm/routingRules';
import { ok, requireCrmAdmin, routeError } from '../../_shared';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const crmAdmin = await requireCrmAdmin();
    if (crmAdmin.response) return crmAdmin.response;

    const supabase = createSessionClient();
    const { error } = await deleteRoutingRule(supabase, params.id);
    if (error) return routeError(500, 'routing_rules_delete_failed', error.message);
    return ok({ deleted: true });
  } catch (e: unknown) {
    return routeError(500, 'routing_rules_delete_unexpected', e instanceof Error ? e.message : 'Failed');
  }
}

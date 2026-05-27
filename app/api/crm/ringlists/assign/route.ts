import { getSupabaseAdmin } from '@/lib/supabase/server';
import { assignCrmProspects } from '@/lib/crm/ringlists';
import {
  assignCrmRinglistProspectsSchema,
  ok,
  requireCrmAdmin,
  routeError,
  validationError,
} from '../_lib';

export async function POST(req: Request) {
  try {
    const crmAdmin = await requireCrmAdmin();
    if (crmAdmin.response) return crmAdmin.response;

    const parsedBody = assignCrmRinglistProspectsSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = getSupabaseAdmin();
    const { data, error } = await assignCrmProspects(supabase, parsedBody.data.prospect_ids, parsedBody.data.assigned_to);

    if (error) {
      return routeError(500, 'crm_ringlists_assign_failed', error.message);
    }

    return ok({ items: data || [] });
  } catch (e: any) {
    return routeError(500, 'crm_ringlists_assign_unexpected', e?.message || 'Failed to assign prospects');
  }
}
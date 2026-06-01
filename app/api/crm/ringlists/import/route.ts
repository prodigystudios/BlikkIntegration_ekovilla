// getSupabaseAdmin: bulk ringlist import creates prospects on behalf of other users and
// requires elevated access beyond what the importer's own RLS policies allow.
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { importCrmProspects } from '@/lib/domains/crm/ringlists';
import {
  importCrmRinglistRowsSchema,
  ok,
  requireCrmAdmin,
  routeError,
  validationError,
} from '../_lib';

export async function POST(req: Request) {
  try {
    const crmAdmin = await requireCrmAdmin();
    if (crmAdmin.response || !crmAdmin.currentUser) return crmAdmin.response;

    const parsedBody = importCrmRinglistRowsSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = getSupabaseAdmin();
    const result = await importCrmProspects(
      supabase,
      parsedBody.data.rows,
      crmAdmin.currentUser.id,
      parsedBody.data.assigned_to,
    );

    if (result.error) {
      return routeError(500, 'crm_ringlists_import_failed', result.error.message);
    }

    return ok(result.data, 201);
  } catch (e: any) {
    return routeError(500, 'crm_ringlists_import_unexpected', e?.message || 'Failed to import ringlist rows');
  }
}
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmProspect, listCrmProspects } from '@/lib/crm/prospects';
import {
  createCrmProspectSchema,
  listCrmProspectsQuerySchema,
  ok,
  requireCrmUser,
  routeError,
  validationError,
} from './_lib';

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsedQuery = listCrmProspectsQuerySchema.safeParse({
      q: url.searchParams.get('q') || undefined,
    });
    if (!parsedQuery.success) return validationError(parsedQuery.error);

    const supabase = createRouteHandlerClient({ cookies });
    const query = await listCrmProspects(supabase, parsedQuery.data.q);
    const { data, error } = await query;
    if (error) {
      return routeError(500, 'crm_prospects_list_failed', error.message);
    }

    return ok({ items: data || [] });
  } catch (e: any) {
    return routeError(500, 'crm_prospects_unexpected', e?.message || 'Failed to list prospects');
  }
}

export async function POST(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = createCrmProspectSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const payload = {
      ...parsedBody.data,
      status: 'new' as const,
      created_by: crmUser.currentUser.id,
      assigned_to: crmUser.currentUser.id,
    };

    const { data, error } = await createCrmProspect(supabase, payload);

    if (error) {
      return routeError(500, 'crm_prospect_create_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_prospect_unexpected', e?.message || 'Failed to create prospect');
  }
}
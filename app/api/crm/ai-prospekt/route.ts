import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import {
  createCrmAiProspectSuggestion,
  listCrmAiProspectSuggestions,
  mapCrmAiProspectSuggestionRows,
} from '@/lib/crm/aiProspects';
import {
  createCrmAiProspectSuggestionSchema,
  listCrmAiProspectSuggestionsQuerySchema,
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
    const parsedQuery = listCrmAiProspectSuggestionsQuerySchema.safeParse({
      q: url.searchParams.get('q') || undefined,
      status: url.searchParams.get('status') || undefined,
    });
    if (!parsedQuery.success) return validationError(parsedQuery.error);

    const supabase = createRouteHandlerClient({ cookies });
    const query = await listCrmAiProspectSuggestions(supabase, {
      search: parsedQuery.data.q,
      status: parsedQuery.data.status,
    });
    const { data, error } = await query;
    if (error) {
      return routeError(500, 'crm_ai_prospekt_list_failed', error.message);
    }

    return ok({ items: mapCrmAiProspectSuggestionRows(data as any[] | null | undefined) });
  } catch (e: any) {
    return routeError(500, 'crm_ai_prospekt_unexpected', e?.message || 'Failed to list AI prospects');
  }
}

export async function POST(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = createCrmAiProspectSuggestionSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createCrmAiProspectSuggestion(supabase, {
      ...parsedBody.data,
      created_by: crmUser.currentUser.id,
    });

    if (error) {
      return routeError(500, 'crm_ai_prospekt_create_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_ai_prospekt_unexpected', e?.message || 'Failed to create AI prospect suggestion');
  }
}
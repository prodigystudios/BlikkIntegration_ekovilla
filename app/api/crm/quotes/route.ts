import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmQuote, getCrmQuote, getCrmQuoteFilterCounts, listCrmQuotesWithFilters, CRM_QUOTES_PAGE_SIZE } from '@/lib/domains/crm/quotes';
import { pushQuoteToFortnox } from '@/lib/domains/fortnox/offers';
import { FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import {
  authorizeQuoteAssignee,
  createCrmQuoteSchema,
  listCrmQuotesQuerySchema,
  ok,
  requireCrmUser,
  requirePermission,
  routeError,
  validationError,
} from './_lib';

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsedQuery = listCrmQuotesQuerySchema.safeParse({
      q: url.searchParams.get('q') || undefined,
      status: url.searchParams.get('status') || undefined,
      prospect_id: url.searchParams.get('prospect_id') || undefined,
      customer_id: url.searchParams.get('customer_id') || undefined,
      limit: url.searchParams.get('limit') || undefined,
      offset: url.searchParams.get('offset') || undefined,
      filter: url.searchParams.get('filter') || undefined,
      assignee: url.searchParams.get('assignee') || undefined,
      sort: url.searchParams.get('sort') || undefined,
    });

    if (!parsedQuery.success) return validationError(parsedQuery.error);

    // Assignee scope: a comma-separated list of user ids (the client resolves 'mine' to the
    // current user id before sending). Empty = everyone.
    const assignedToIn = (parsedQuery.data.assignee || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const offset = parsedQuery.data.offset ?? 0;
    const limit = parsedQuery.data.limit ?? CRM_QUOTES_PAGE_SIZE;
    const scope = {
      search: parsedQuery.data.q,
      assignedToIn,
      prospectId: parsedQuery.data.prospect_id,
      customerId: parsedQuery.data.customer_id,
    };

    const supabase = createRouteHandlerClient({ cookies });
    const query = await listCrmQuotesWithFilters(supabase, {
      ...scope,
      status: parsedQuery.data.status,
      filter: parsedQuery.data.filter,
      limit,
      offset,
      sort: parsedQuery.data.sort,
    });
    const { data, error, count } = await query;

    if (error) {
      return routeError(500, 'crm_quotes_list_failed', error.message);
    }

    // Per-tab counts (scoped to the same search + assignee filter). Only the offer list asks for
    // them (counts=1, first page); the board, the customer detail and the overview skip the extra
    // count queries. Same contract as the work-orders route.
    const wantCounts = url.searchParams.get('counts') === '1' && offset === 0;
    const counts = wantCounts ? await getCrmQuoteFilterCounts(supabase, scope) : undefined;

    return ok({ items: data || [], total: count ?? 0, offset, limit, counts });
  } catch (e: any) {
    return routeError(500, 'crm_quotes_unexpected', e?.message || 'Failed to list quotes');
  }
}

export async function POST(req: Request) {
  try {
    const crmUser = await requirePermission('crm.offer.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = createCrmQuoteSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    // Ansvarig säljare är normalt den som skapar offerten. En administratör får ange någon
    // annan direkt vid skapandet — chefen som gör offerten åt en säljare slipper då skapa
    // den i sitt eget namn och flytta den efteråt.
    const assignee = await authorizeQuoteAssignee(parsedBody.data.assigned_to, crmUser.currentUser.id);
    if (assignee.response) return assignee.response;

    const supabase = createRouteHandlerClient({ cookies });
    const payload = {
      ...parsedBody.data,
      created_by: crmUser.currentUser.id,
      assigned_to: assignee.assignedTo ?? crmUser.currentUser.id,
      currency_code: parsedBody.data.currency_code || 'SEK',
    };

    const { data, error } = await createCrmQuote(supabase, payload);

    if (error) {
      return routeError(500, 'crm_quote_create_failed', error.message);
    }

    // Auto-push to Fortnox. Non-fatal: quote creation always succeeds. A push failure (other
    // than "not connected") is surfaced as fortnox_error so the seller sees the offer didn't
    // reach Fortnox — mirroring the PATCH auto-sync — instead of it failing silently.
    let fortnoxError: string | null = null;
    let responseItem = data;
    if (data) {
      try {
        await pushQuoteToFortnox(data.id);
        // Re-read so the response carries the fresh fortnox_offer_number / sync status.
        const refreshed = await getCrmQuote(supabase, data.id);
        if (refreshed.data) responseItem = refreshed.data;
      } catch (e) {
        if (!(e instanceof FortnoxNotConnectedError)) {
          console.error('[fortnox] Auto-push offert misslyckades:', (e as any)?.message);
          fortnoxError = friendlyFortnoxMessage(e);
        }
      }
    }

    return ok({ item: responseItem, fortnox_error: fortnoxError }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_quote_unexpected', e?.message || 'Failed to create quote');
  }
}
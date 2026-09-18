import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { z } from 'zod';
import { getCrmQuoteCallIdentity } from '@/lib/domains/crm/quotes';
import { attachCrmCallUserNames, createCrmCall, listCrmQuoteCalls, quoteCallIdentity } from '@/lib/domains/crm/calls';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { invalidUuidParam, ok, requireCrmUser, requireCrmWriter, routeError, validationError } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

/**
 * Offertens samtalslogg — läs och skriv, mot EN offert.
 *
 * ── Grinden ──
 *
 * ⚠️ Ordningen är hela säkerheten, precis som i uppgiftsflödet (../tasks/route.ts). Offerten läses
 * FÖRST med sessionsklienten. Kommer ingen rad tillbaka svarar vi 404 och den elevated frågan körs
 * aldrig — det är alltså RLS på crm_quotes som avgör vem som når samtalen, inte id:t i adressen.
 *
 * ── Varför läsningen är elevated ──
 *
 * crm_calls_select_visible är "eget samtal, egen tilldelad kund, eller admin". Utan elevering hade
 * en säljare som öppnar en kollegas offert fått ett tomt kort på en offert hen har all rätt att se.
 * Policyn lämnas orörd med flit; se listCrmQuoteCalls.
 *
 * ── Varför skrivningen INTE är elevated ──
 *
 * Insert går via sessionsklienten, så crm_calls_insert_visible gäller som vanligt: bara sälj/admin,
 * och alltid i eget namn (user_id = auth.uid()). Samma linje som uppgiftsflödet drog för PATCH —
 * läsning får eleveras bakom en grind, skrivning aldrig.
 */

const CreateSchema = z.object({
  outcome: z.enum(['no_answer', 'follow_up', 'positive', 'negative']),
  summary: z.string().trim().min(1, 'Sammanfattning krävs').max(4000),
  next_step: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null),
    z.string().max(2000).nullable(),
  ).optional().default(null),
  // Klockslaget samtalet ägde rum. Utelämnat = nu (databasens default).
  call_at: z.string().datetime({ offset: true }).optional(),
});

export async function GET(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    // Grinden. Sessionsklienten med flit — det är den som bär anroparens RLS.
    const supabase = createRouteHandlerClient({ cookies });
    const { data: quote, error: quoteError } = await getCrmQuoteCallIdentity(supabase, context.params.id);
    if (quoteError || !quote) {
      return routeError(404, 'crm_quote_not_found', 'Offerten hittades inte');
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await listCrmQuoteCalls(admin, context.params.id);
    if (error) return routeError(500, 'crm_quote_calls_failed', error.message);

    // Vem som loggade samtalet: profiles-RLS är self-only, så namnet måste slås upp elevated —
    // annars visar kortet en rå uuid för allt en kollega loggat.
    const items = await attachCrmCallUserNames(admin, (data ?? []) as Array<{ user_id: string }>);

    return ok({ items });
  } catch (e: any) {
    return routeError(500, 'crm_quote_calls_unexpected', e?.message || 'Kunde inte hämta offertens samtal');
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    // Samma skrivgrind som resten av CRM:et; läsroller kommer inte hit.
    const writer = await requireCrmWriter();
    if (writer.response || !writer.currentUser) return writer.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data: quote, error: quoteError } = await getCrmQuoteCallIdentity(supabase, context.params.id);
    if (quoteError || !quote) {
      return routeError(404, 'crm_quote_not_found', 'Offerten hittades inte');
    }

    const { data, error } = await createCrmCall(supabase, {
      ...quoteCallIdentity(quote as Parameters<typeof quoteCallIdentity>[0]),
      quote_id: context.params.id,
      user_id: writer.currentUser.id,
      outcome: parsed.data.outcome,
      summary: parsed.data.summary,
      next_step: parsed.data.next_step,
      ...(parsed.data.call_at ? { call_at: parsed.data.call_at } : {}),
    });

    if (error) {
      // RLS filtrerar hellre än nekar: insert-policyn kräver sälj/admin i eget namn. Säg det rakt
      // ut i stället för att låta ett 500 se ut som ett haveri.
      return routeError(403, 'crm_call_create_denied', 'Samtalet kunde inte loggas på den här offerten');
    }

    const [item] = await attachCrmCallUserNames(getSupabaseAdmin(), [data as { user_id: string }]);
    return ok({ item });
  } catch (e: any) {
    return routeError(500, 'crm_quote_call_create_unexpected', e?.message || 'Kunde inte logga samtalet');
  }
}

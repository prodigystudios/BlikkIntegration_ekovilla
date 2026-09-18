import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { z } from 'zod';
import { getCrmQuoteCallIdentity } from '@/lib/domains/crm/quotes';
import { attachCrmCallUserNames, createCrmCall, listCrmQuoteCalls, quoteCallIdentity } from '@/lib/domains/crm/calls';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { invalidUuidParam, ok, requireCrmUser, requirePermission, routeError, validationError } from '../../_lib';
import { quoteCustomerName } from '@/app/crm/lib/quoteDisplay';

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
    // 🧨 crm.call.write, INTE crm.write. Det är nyckeln POST /api/crm/calls och PATCH
    // /api/crm/calls/[id] gatar på, och den insert-policyn på crm_calls kräver. Med crm.write hade
    // routen släppt igenom en roll som databasen sedan nekar — och användaren fått ett fel som
    // låter som att offerten var problemet.
    const writer = await requirePermission('crm.call.write');
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
      // Namnet avgörs av den delade regeln, inte av en egen ordning här.
      ...quoteCallIdentity(quote as any, quoteCustomerName(quote as any)),
      quote_id: context.params.id,
      user_id: writer.currentUser.id,
      outcome: parsed.data.outcome,
      summary: parsed.data.summary,
      next_step: parsed.data.next_step,
      ...(parsed.data.call_at ? { call_at: parsed.data.call_at } : {}),
    });

    if (error) {
      // ⚠️ Skilj NEKAT från TRASIGT. Allt-är-403 gjorde ett brutet villkor (t.ex.
      // crm_calls_reference_or_company_check) och en tappad anslutning oskiljbara från en
      // behörighetsspärr — och slängde meddelandet som hade förklarat vilket.
      const denied = error.code === '42501' || /row-level security/i.test(error.message || '');
      return denied
        ? routeError(403, 'crm_call_create_denied', 'Samtalet kunde inte loggas på den här offerten')
        : routeError(500, 'crm_call_create_failed', error.message);
    }

    // Raden går tillbaka som den är: kortet skriver "Du" på sitt eget samtal, så ett namnuppslag
    // mot profiles hade varit en extra rundtur för ett fält ingen ritar.
    return ok({ item: { ...(data as Record<string, unknown>), user_name: null } }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_quote_call_create_unexpected', e?.message || 'Kunde inte logga samtalet');
  }
}

import { z } from 'zod';
import { createSessionClient } from '@/lib/supabase/session';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import {
  PARTNER_INELIGIBLE_MESSAGES,
  PORTAL_RESELLER_UUID,
  inviteAdminSchema,
  inviteStoreSchema,
} from '@/lib/domains/portal/partners';
import { invitePortalReseller } from '@/lib/domains/portal/partnersStore';
import { RESELLER_ID_PATTERN } from '@/lib/domains/portal/resellers';
import { invalidUuidParam, ok, routeError, validationError, requirePermission } from '../../../../_shared';

type RouteContext = { params: { customerId: string } };

// Bjud in ett företag till portalen från kundkortet, eller skicka inbjudan igen (RESELLER_PORTAL_CRM_PLAN.md 10a,
// kontraktets flöde 5). Reglerna bor i invitePortalReseller; här är bara HTTP.
//
//   201 { resellerId, attempt, created: true, delivery }    inbjudan köad, och ett första utskick gjort
//   200 { …, created: false }                               samma formulär en gång till; inget nytt köat
//   404 customer_not_found / portal_reseller_not_found
//   409 portal_integration_off                              integrationen är inte påslagen i miljön
//   409 portal_partner_not_flagged                          kortet är inte flaggat
//   409 portal_reseller_id_taken                            id:t hör till ett annat kort: öppna formuläret igen
//   409 portal_invite_changed                               någon annan skickade en inbjudan under tiden
//   422 portal_partner_ineligible                           privatkund, eller inget kundnummer i Fortnox
//
// Två klienter: sessionen för kortet, flaggan och läsningarna (RLS: crm.portal.manage), service-rollen för butikens
// rad, inbjudan och kön, som bara service_role skriver. Se "Reviewed elevations" i SUPABASE_CONVENTIONS.md.

// Ett första utskick, högst 15 s mot portalen.
export const maxDuration = 60;

const bodySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('new'),
    resellerId: z.string().regex(PORTAL_RESELLER_UUID, 'Formuläret saknar företagets id. Öppna det igen.'),
    store: inviteStoreSchema,
    admin: inviteAdminSchema,
  }),
  z.object({
    mode: z.literal('resend'),
    resellerId: z.string().regex(RESELLER_ID_PATTERN, 'Ogiltigt företags-id.'),
    admin: inviteAdminSchema,
    expectedAttempt: z.number().int().min(0).max(1_000_000),
  }),
]);

export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.portal.manage');
    if (gate.response || !gate.currentUser) return gate.response;
    const invalid = invalidUuidParam(context.params.customerId);
    if (invalid) return invalid;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const outcome = await invitePortalReseller(
      {
        session: createSessionClient(),
        admin: getSupabaseAdmin(),
        env: process.env,
        actor: { id: gate.currentUser.id, name: gate.currentUser.name ?? null },
        now: () => new Date(),
      },
      { ...parsed.data, customerId: context.params.customerId },
    );

    switch (outcome.kind) {
      case 'integration_off':
        return routeError(409, 'portal_integration_off', `Integrationen med portalen är inte påslagen här. ${outcome.message}`);
      case 'not_found':
        return routeError(404, 'customer_not_found', 'Kunden finns inte.');
      case 'ineligible':
        return routeError(422, 'portal_partner_ineligible', PARTNER_INELIGIBLE_MESSAGES[outcome.reason]);
      case 'not_partner':
        return routeError(409, 'portal_partner_not_flagged', 'Markera kunden som återförsäljare eller partner först.');
      case 'reseller_id_taken':
        return routeError(409, 'portal_reseller_id_taken', 'Formuläret har gått ut. Stäng det och öppna det igen.');
      case 'store_not_found':
        return routeError(404, 'portal_reseller_not_found', 'Företaget finns inte på den här kunden.');
      case 'changed':
        return routeError(
          409,
          'portal_invite_changed',
          'Någon har skickat en inbjudan till företaget under tiden. Ladda om sidan och se efter innan du skickar igen.',
        );
      case 'db_error':
        return routeError(500, 'portal_invite_db_error', outcome.message);
      case 'invited':
        return ok(
          { resellerId: outcome.resellerId, attempt: outcome.attempt, created: outcome.created, delivery: outcome.delivery },
          outcome.created ? 201 : 200,
        );
    }
  } catch (e: any) {
    return routeError(500, 'portal_invite_unexpected', e?.message || 'Inbjudan kunde inte skickas');
  }
}

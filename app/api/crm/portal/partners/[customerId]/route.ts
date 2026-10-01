import { z } from 'zod';
import { createSessionClient } from '@/lib/supabase/session';
import { PORTAL_PARTNER_TYPES } from '@/lib/domains/portal/partners';
import { readPortalPartner, setPortalPartnerType } from '@/lib/domains/portal/partnersStore';
import { invalidUuidParam, ok, routeError, validationError, requirePermission } from '../../../_shared';

type RouteContext = { params: { customerId: string } };

// Partnerrutan på kundkortet (RESELLER_PORTAL_CRM_PLAN.md 10a): flaggan och kortets företag i portalen.
//
//   GET  200 { partner }                 flaggan, om kortet kan bjudas in, formulärets förval och företagen
//   PUT  200 { partnerType }             sätter eller tar bort flaggan (null)
//        404 customer_not_found          kortet finns inte för sessionen
//        422 portal_partner_not_business ett privatkundskort kan inte flaggas
//
// Bara sessionen: RLS kräver crm.portal.manage för flaggan, företagen och inbjudningarna.

export const dynamic = 'force-dynamic';
// Next 14.2 räknar inte PUT som dynamisk. Routen läser kakan och klarar sig ändå, men en fetch-cache här hade visat
// en gammal flagga utan att någon märkt det.
export const fetchCache = 'force-no-store';

const bodySchema = z.object({
  partnerType: z.enum(PORTAL_PARTNER_TYPES, { errorMap: () => ({ message: 'Välj återförsäljare eller partner.' }) }).nullable(),
});

export async function GET(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.portal.manage');
    if (gate.response || !gate.currentUser) return gate.response;
    const invalid = invalidUuidParam(context.params.customerId);
    if (invalid) return invalid;

    const partner = await readPortalPartner(createSessionClient(), context.params.customerId);
    if (!partner) return routeError(404, 'customer_not_found', 'Kunden finns inte.');
    return ok({ partner });
  } catch (e: any) {
    return routeError(500, 'portal_partner_unexpected', e?.message || 'Partnerrutan gick inte att läsa');
  }
}

export async function PUT(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.portal.manage');
    if (gate.response || !gate.currentUser) return gate.response;
    const invalid = invalidUuidParam(context.params.customerId);
    if (invalid) return invalid;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const outcome = await setPortalPartnerType(
      createSessionClient(),
      context.params.customerId,
      parsed.data.partnerType,
      gate.currentUser.id,
    );
    switch (outcome.kind) {
      case 'saved':
        return ok({ partnerType: outcome.partnerType });
      case 'not_found':
        return routeError(404, 'customer_not_found', 'Kunden finns inte.');
      case 'not_business':
        return routeError(422, 'portal_partner_not_business', 'Bara ett företagskort kan bli partner i portalen.');
      case 'forbidden':
        return routeError(403, 'forbidden', 'Forbidden');
      case 'db_error':
        return routeError(500, 'portal_partner_save_failed', outcome.message);
    }
  } catch (e: any) {
    return routeError(500, 'portal_partner_unexpected', e?.message || 'Flaggan kunde inte sparas');
  }
}

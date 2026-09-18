import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { updateCrmCall } from '@/lib/domains/crm/calls';
import {
  ok,
  pickProvidedFields,
  requirePermission,
  routeError,
  updateCrmCallSchema,
  validationError,
} from '../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.call.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const rawBody = await req.json().catch(() => null);
    const parsedBody = updateCrmCallSchema.safeParse(rawBody);
    if (!parsedBody.success) return validationError(parsedBody.error);

    // 🧨 Bara de fält som FAKTISKT skickades. Schemat fyller company_name, contact_name, phone,
    // email, city och source med `.default(null)`, och en update med hela objektet nollade dem —
    // samtalssidan skickar bara kund, utfall, sammanfattning och nästa steg när en kund är vald.
    // Det syntes inte förrän samtal började bära kontaktuppgifter härledda ur en offert. Samma
    // skydd som offert- och orderrutterna redan har.
    const patch = pickProvidedFields(parsedBody.data, rawBody);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateCrmCall(supabase, context.params.id, patch as Parameters<typeof updateCrmCall>[2]);

    if (error) {
      return routeError(500, 'crm_call_update_failed', error.message);
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_call_update_unexpected', e?.message || 'Failed to update call');
  }
}
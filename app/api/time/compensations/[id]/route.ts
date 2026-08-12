import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { deleteCompensation, updateCompensation } from '@/lib/domains/time/compensations';
import { invalidUuidParam, ok, requirePermission, routeError, updateCompensationSchema, validationError } from '../../_lib';

type RouteContext = { params: { id: string } };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('time.entry.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const rawBody = await req.json().catch(() => null);
    const parsed = updateCompensationSchema.safeParse(rawBody);
    if (!parsed.success) return validationError(parsed.error);

    // Skriv bara det klienten faktiskt skickade — Zod fyller i defaults för utelämnade fält, och att
    // spara dem skulle nolla kolumner ingen rörde. Samma regel som pickProvidedFields i CRM.
    const sentKeys = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? Object.keys(rawBody) : [];
    const patch = Object.fromEntries(Object.entries(parsed.data).filter(([key]) => sentKeys.includes(key)));
    if (Object.keys(patch).length === 0) return routeError(400, 'time_compensation_empty_patch', 'Inget att uppdatera');
    if ((patch as { kind?: string }).kind === 'expense') (patch as Record<string, unknown>).quantity = null;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateCompensation(supabase, context.params.id, gate.currentUser.id, patch);
    if (error) return routeError(500, 'time_compensation_update_failed', error.message);
    if (!data) return routeError(404, 'time_compensation_not_found', 'Posten hittades inte');

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'time_compensation_update_unexpected', e?.message || 'Kunde inte spara posten');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('time.entry.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await deleteCompensation(supabase, context.params.id, gate.currentUser.id);
    if (error) return routeError(500, 'time_compensation_delete_failed', error.message);
    if (!data) return routeError(404, 'time_compensation_not_found', 'Posten hittades inte');

    return ok({ id: data.id });
  } catch (e: any) {
    return routeError(500, 'time_compensation_delete_unexpected', e?.message || 'Kunde inte ta bort posten');
  }
}

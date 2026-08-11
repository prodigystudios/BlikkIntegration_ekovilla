import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { updateTimeReference } from '@/lib/domains/time/reference';
import { invalidUuidParam, ok, requirePermission, routeError, timeReferenceKindSchema, updateTimeReferenceSchema, validationError } from '../../../_lib';

type RouteContext = { params: { kind: string; id: string } };

// PATCH /api/time/reference/<kind>/<id> — redigera en referensrad.
//
// Typiskt ett fält i taget: admin fyller i `payroll_code` efter Blikk-importen, eller kryssar bort
// `is_active` när en frånvarotyp inte används längre. Radering finns inte med flit — historiken får
// aldrig tappa sin lönesort, så en oanvänd rad inaktiveras i stället.
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('time.reference.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsedKind = timeReferenceKindSchema.safeParse(context.params.kind);
    if (!parsedKind.success) return routeError(400, 'time_reference_unknown_kind', 'Okänd referenstyp');

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const rawBody = await req.json().catch(() => null);
    const parsed = updateTimeReferenceSchema.safeParse(rawBody);
    if (!parsed.success) return validationError(parsed.error);

    // Skriv bara det klienten faktiskt skickade. Zod fyller i defaults för utelämnade fält, och att
    // spara dem skulle nolla kolumner ingen rörde — samma regel som pickProvidedFields i CRM.
    const sentKeys = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? Object.keys(rawBody) : [];
    const patch = Object.fromEntries(Object.entries(parsed.data).filter(([key]) => sentKeys.includes(key)));
    if (parsedKind.data !== 'time_code') delete (patch as Record<string, unknown>).billable;
    if (Object.keys(patch).length === 0) return routeError(400, 'time_reference_empty_patch', 'Inget att uppdatera');

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateTimeReference(supabase, parsedKind.data, context.params.id, patch);
    if (error) return routeError(500, 'time_reference_update_failed', error.message);
    if (!data) return routeError(404, 'time_reference_not_found', 'Raden hittades inte');

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'time_reference_update_unexpected', e?.message || 'Kunde inte spara raden');
  }
}

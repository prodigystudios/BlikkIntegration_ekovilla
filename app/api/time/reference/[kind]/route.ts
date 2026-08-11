import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createTimeReference } from '@/lib/domains/time/reference';
import { createTimeReferenceSchema, ok, requirePermission, routeError, timeReferenceKindSchema, validationError } from '../../_lib';

type RouteContext = { params: { kind: string } };

// POST /api/time/reference/<kind> — lägg till en tidkod, ett internprojekt eller en frånvarotyp.
//
// Behövs vid sidan av Blikk-importen: listorna lever vidare efter att Blikk kopplats bort, och en
// ny frånvarotyp ska inte kräva en deploy.
export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('time.reference.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsedKind = timeReferenceKindSchema.safeParse(context.params.kind);
    if (!parsedKind.success) return routeError(400, 'time_reference_unknown_kind', 'Okänd referenstyp');

    const rawBody = await req.json().catch(() => null);
    const parsed = createTimeReferenceSchema.safeParse(rawBody);
    if (!parsed.success) return validationError(parsed.error);

    // `billable` finns bara på tidkoder — skickas den till en annan tabell blir det ett fel från
    // PostgREST om en kolumn som inte existerar, inte ett ignorerat fält.
    const { billable, ...rest } = parsed.data;
    const input = parsedKind.data === 'time_code' ? { ...rest, billable: billable ?? null } : rest;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createTimeReference(supabase, parsedKind.data, input);
    if (error) return routeError(500, 'time_reference_create_failed', error.message);

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'time_reference_create_unexpected', e?.message || 'Kunde inte skapa raden');
  }
}

import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCompensation, listCompensations } from '@/lib/domains/time/compensations';
import { createCompensationSchema, ok, rangeQuerySchema, requirePermission, requireSignedInUser, routeError, validationError } from '../_lib';

// Traktamenten, utlägg och milersättning. Egna poster med eget datum — de hör inte till ett visst
// arbetspass, och ett utlägg kan finnas en dag man inte jobbat.
//
// Samma avgränsning som tidraderna: RLS ger den egna raden, time.entry.read.all ger allas.

export async function GET(req: Request) {
  try {
    const user = await requireSignedInUser();
    if (user.response || !user.currentUser) return user.response;

    const url = new URL(req.url);
    const parsed = rangeQuerySchema.safeParse({ from: url.searchParams.get('from'), to: url.searchParams.get('to') });
    if (!parsed.success) return validationError(parsed.error);
    if (parsed.data.from > parsed.data.to) return routeError(400, 'invalid_range', 'Från-datum är efter till-datum');

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listCompensations(supabase, parsed.data, { userId: user.currentUser.id });
    if (error) return routeError(500, 'time_compensations_list_failed', error.message);

    return ok({ items: data ?? [] });
  } catch (e: any) {
    return routeError(500, 'time_compensations_unexpected', e?.message || 'Kunde inte hämta ersättningar');
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requirePermission('time.entry.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = createCompensationSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    // Utlägg har ingen kvantitet — beloppet är hela sanningen där. Skickas en ändå nollas den, så
    // "3 utlägg" inte råkar bli en siffra någon summerar.
    const quantity = parsed.data.kind === 'expense' ? null : (parsed.data.quantity ?? null);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createCompensation(supabase, gate.currentUser.id, { ...parsed.data, quantity });
    if (error) return routeError(500, 'time_compensation_create_failed', error.message);

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'time_compensation_create_unexpected', e?.message || 'Kunde inte spara ersättningen');
  }
}

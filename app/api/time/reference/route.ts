import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listTimeReference, TIME_REFERENCE_KINDS, type TimeReferenceItem } from '@/lib/domains/time/reference';
import { ok, requireSignedInUser, routeError } from '../_lib';

// GET /api/time/reference — alla tre listorna i ett svar.
//
// Tidrapportformuläret behöver alla tre för att kunna byta rapporttyp utan ny rundtur (dagens
// Blikk-modal gör en hämtning per flik och blinkar till varje gång). Adminvyn använder samma
// endpoint med ?includeInactive=1.
//
// Bara inloggning krävs för läsning: varje anställd måste kunna välja frånvarotyp, och listorna är
// inte hemliga — namnen stod redan i Blikks dropdown för alla. RLS:en säger detsamma
// (20260811_time_reference_tables.sql: select using (true)). Skrivning kräver time.reference.manage.
export async function GET(req: Request) {
  try {
    const user = await requireSignedInUser();
    if (user.response || !user.currentUser) return user.response;

    // Inaktiva rader visas bara för den som kan hantera dem — annars går en inaktiverad rad inte
    // att återaktivera i adminvyn.
    const includeInactive = new URL(req.url).searchParams.get('includeInactive') === '1';

    const supabase = createRouteHandlerClient({ cookies });
    const results = await Promise.all(
      TIME_REFERENCE_KINDS.map(async (kind) => {
        const { data, error } = await listTimeReference(supabase, kind, { includeInactive });
        if (error) throw new Error(`${kind}: ${error.message}`);
        return [kind, (data ?? []) as unknown as TimeReferenceItem[]] as const;
      }),
    );

    return ok(Object.fromEntries(results));
  } catch (e: any) {
    return routeError(500, 'time_reference_list_failed', e?.message || 'Kunde inte hämta referensdata');
  }
}

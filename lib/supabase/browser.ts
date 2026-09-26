import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// Uttryckligen SupabaseClient (schema `any`, som auth-helpers-klienten): `ReturnType<typeof
// createBrowserClient>` fyller i generiken med sina gränser i stället för standardvärdena och ger
// klienten ett schema där realtime-callbacks och radtyper tappar sin kontextuella typning.
let browserClient: SupabaseClient | undefined;

/**
 * Webbläsarklienten — EN per flik.
 *
 * Ett tjugotal effekter har `supabase` i sin dependency-array, och flera av dem river och startar
 * realtime-prenumerationer (DashboardTasks, NotificationBell). En ny klient per render hade kört dem
 * på varje render och gett en självmatande loop, plus N klienter som förnyar samma refresh-token
 * samtidigt. `@supabase/ssr` 0.7.0 är själv singleton i webbläsaren, men det är ett standardval i
 * biblioteket — här är stabiliteten vår egen.
 *
 * Under serverrenderingen av en klientkomponent finns inget `window`: då byggs en ny klient per
 * anrop, så att ingenting delas mellan olika användares requests.
 */
export function getBrowserClient(): SupabaseClient {
  const create = () =>
    createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  if (typeof window === 'undefined') return create();
  return (browserClient ??= create());
}

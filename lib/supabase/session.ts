import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * Sessionsklienten: anon-nyckeln + inloggade användarens kakor, så RLS avgör vad som syns. Samma
 * klient i route handlers och server-komponenter — `@supabase/ssr` har bara en serverklient, så
 * frågan "vilken klient tål en server-komponent?" finns inte längre. Service-role ligger kvar i
 * `./server` (`getSupabaseAdmin`) och är ett medvetet, granskat undantag.
 *
 * Egen modul, inte i `./server`: 31 testfiler mockar `@/lib/supabase/server` med en fabrik som bara
 * ger admin-klienten, och skript importerar den utanför Next. Här kan sessionsklienten mockas för sig.
 */
export function createSessionClient() {
  const cookieStore = cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // I en server-komponent tillåter Next inte cookies().set() — det var den kraschen som dödade
        // /arbetsorder/[id] när token hunnit gå ut. Middleware har redan förnyat sessionen och lagt
        // set-cookie på svaret, så här räcker det att den förnyade sessionen finns i minnet.
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // server-komponent: ignoreras med flit, se ovan
        }
      },
    },
  });
}

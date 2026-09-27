/**
 * Vilken miljö appen kör i, för spärrarna som avgör om något får nå riktiga mottagare.
 *
 * Ren logik: miljön kommer in som argument (`process.env` hos anroparen), så att allt går att testa,
 * och modulen importerar inget — den ska gå att använda från vilken kod som helst.
 */

type Env = Record<string, string | undefined>;

/** Värdar som alltid är den här datorn. */
export const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

/** Pekar adressen på den här datorn? En ogiltig eller saknad adress är inte lokal. */
export function isLocalUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOCAL_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Är det här prods driftsättning? För UTGÅENDE trafik till riktiga mottagare, så svaret faller
 * STÄNGT: alla tre måste stämma.
 *   - `NODE_ENV=production`: `next dev` sätter alltid development, också när `vercel env pull` lagt
 *     `VERCEL_ENV=production` i .env.local.
 *   - `VERCEL_ENV=production`: en förhandsversion, eller ett produktionsbygge utanför Vercel
 *     (`next start` lokalt, CI), är inte prod. Samma krav som materialbeställningens spärr
 *     (`materialOrderSendMode` i lib/domains/planning/materialOrders.ts).
 *   - databasen är inte lokal: `next start` mot den lokala stacken med prods Vercel-variabler är inte prod.
 *
 * Saknas `VERCEL_ENV` i prod stannar utskicket i stället för att gå fel — det syns och går att laga.
 *
 * ⚠️ Inte samma fråga som `isFortnoxProductionRuntime` (lib/domains/fortnox/connectionGuard.ts), som
 * med flit faller ÖPPET: prod får aldrig förlora möjligheten att koppla om Fortnox.
 */
export function isProductionDeployment(env: Env): boolean {
  return (
    env.NODE_ENV === 'production' &&
    env.VERCEL_ENV === 'production' &&
    !isLocalUrl(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL)
  );
}

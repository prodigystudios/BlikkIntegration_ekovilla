import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';

/**
 * Har den inloggade en viss behörighetsnyckel? Läses i en SERVER-KOMPONENT.
 *
 * Behörigheten läses i sidan och inte i klienten: sidan är rätt ställe för åtkomstbeslut, och en
 * klient som frågar själv hade blinkat till med fel UI medan svaret var på väg.
 *
 * ⚠️ `createServerComponentClient` och INTE getEffectivePermissions() från lib/auth/permissions:
 * den senare bygger en route-handler-klient, som försöker skriva cookies vid tokenförnyelse och
 * därför inte hör hemma i en server-komponent. Samma mönster och samma skäl som
 * app/crm/offerter/quotePermissions.ts och app/arbetsorder/[id]/page.tsx.
 *
 * Failar closed: ett fel i RPC:n ger `false`, alltså läsläge.
 *
 * Ligger i app/crm/lib/ och inte hos en enskild sida därför att samma fråga nu ställs från två
 * håll (offertlistan och Säljtavlan) — bägge renderar den delade QuoteDetailPanel och måste ge
 * den samma svar. När nycklarna en dag trädas in i AppShell (project_full_rbac_frontend)
 * försvinner den här vägen igen.
 */
export async function hasCrmPermission(key: string): Promise<boolean> {
  try {
    const supabase = createServerComponentClient({ cookies });
    const { data: permissions } = await supabase.rpc('effective_permissions');
    return Array.isArray(permissions)
      && permissions.some((row) => (typeof row === 'string' ? row : String(row)) === key);
  } catch {
    return false;
  }
}

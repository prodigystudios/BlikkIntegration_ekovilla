import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import type { PermissionKey } from '@/lib/auth/permissions';

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
export async function hasCrmPermission(key: PermissionKey): Promise<boolean> {
  return (await hasCrmPermissions([key]))[key];
}

/**
 * Flera nycklar på EN rundtur till databasen.
 *
 * Offertlistan och Säljtavlan behöver två (`crm.write` för att få skapa uppgifter alls,
 * `crm.admin` för att få lägga dem på någon annan). Två anrop till hasCrmPermission hade blivit
 * två `effective_permissions`-anrop per sidladdning för samma svar.
 *
 * Returnerar alltid en post per efterfrågad nyckel, så en uppslagning aldrig ger `undefined`.
 *
 * ⚠️ Nyckeln är typad `PermissionKey`, inte `string`. En felstavning kompilerar annars och failar
 * closed — knappen renderas bara aldrig, och ingenting säger varför.
 */
export async function hasCrmPermissions<K extends PermissionKey>(keys: readonly K[]): Promise<Record<K, boolean>> {
  const out = Object.fromEntries(keys.map((key) => [key, false])) as Record<K, boolean>;

  try {
    const supabase = createServerComponentClient({ cookies });
    const { data: permissions } = await supabase.rpc('effective_permissions');
    if (!Array.isArray(permissions)) return out;

    const granted = new Set(permissions.map((row) => (typeof row === 'string' ? row : String(row))));
    for (const key of keys) out[key] = granted.has(key);
    return out;
  } catch {
    return out;
  }
}

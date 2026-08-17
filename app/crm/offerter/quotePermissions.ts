import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';

/**
 * Får den inloggade byta ansvarig säljare på en offert?
 *
 * Behörigheten läses i sidan och inte i klienten: sidan är rätt ställe för åtkomstbeslut, och
 * en klient som frågar själv hade blinkat till med fel sidopanel medan svaret var på väg.
 *
 * `createServerComponentClient` och INTE getEffectivePermissions(): den senare bygger en
 * route-handler-klient, som försöker skriva cookies vid tokenförnyelse och därför inte hör
 * hemma i en server-komponent. Samma mönster (och samma skäl) som app/arbetsorder/[id]/page.tsx.
 *
 * Ligger i en egen modul och inte i page.tsx: Next.js App Router tillåter bara ett känt
 * urval exporter ur en sidfil.
 */
export async function canReassignQuote(): Promise<boolean> {
  const supabase = createServerComponentClient({ cookies });
  const { data: permissions } = await supabase.rpc('effective_permissions');
  return Array.isArray(permissions)
    && permissions.some((row) => (typeof row === 'string' ? row : String(row)) === 'crm.admin');
}

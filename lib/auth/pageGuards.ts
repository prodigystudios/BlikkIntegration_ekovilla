import { redirect } from 'next/navigation';
import { getEffectivePermissions, type PermissionKey } from '@/lib/auth/permissions';

/**
 * Sidgrind för server-komponenter (sidor och segmentlayouter): kräver nyckeln.
 *
 * Samma effektiva behörigheter som API-grindarna (requirePermission) och RLS (has_permission). EN
 * läsning, request-cachad: vid en full sidladdning har rotlayouten redan gjort den; vid en
 * klientnavigering in i segmentet (då rotlayouten inte renderas om) är den ett RPC-anrop.
 * Ingen profil läses: middleware kräver redan en session för alla sidor som använder grinden, och utan
 * session är mängden tom — nekad hamnar då på `deniedTo`, som middleware skickar till inloggningen.
 *
 * ⚠️ `deniedTo` får ALDRIG vara en sida som själv redirectar tillbaka hit för den som nekas — då blir
 * det ERR_TOO_MANY_REDIRECTS och ingen sida alls, inte ens utloggningen. `/` (default) har ingen grind
 * och renderar alltid (lönebyrån skickas därifrån till /ekonomi, som renderar sitt eget nekande).
 * Failar stängt: misslyckas läsningen är mängden tom och sidan nekas — Start finns kvar.
 */
export async function requirePagePermission(key: PermissionKey, deniedTo = '/'): Promise<void> {
  const permissions = await getEffectivePermissions();
  if (!permissions.has(key)) redirect(deniedTo);
}

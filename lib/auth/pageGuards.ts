import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/getUserProfile';
import { getEffectivePermissions, type PermissionKey } from '@/lib/auth/permissions';

/**
 * Sidgrind för server-komponenter (sidor och segmentlayouter): kräver inloggning och nyckeln.
 *
 * Samma effektiva behörigheter som API-grindarna (requirePermission) och RLS (has_permission), och
 * båda läsningarna är request-cachade — rotlayouten har redan gjort dem, så grinden kostar inget extra.
 *
 * ⚠️ `deniedTo` får ALDRIG vara en sida som själv redirectar tillbaka hit för den som nekas — då blir
 * det ERR_TOO_MANY_REDIRECTS och ingen sida alls, inte ens utloggningen. `/` (default) har ingen grind
 * och renderar alltid (lönebyrån skickas därifrån till /ekonomi, som renderar sitt eget nekande).
 * Failar stängt: misslyckas läsningen är mängden tom och sidan nekas — Start finns kvar.
 */
export async function requirePagePermission(key: PermissionKey, deniedTo = '/'): Promise<void> {
  const [profile, permissions] = await Promise.all([getUserProfile(), getEffectivePermissions()]);
  if (!profile) redirect('/auth/sign-in');
  if (!permissions.has(key)) redirect(deniedTo);
}

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Grinden för portalens cron-route (fas 4b). Vercel skickar `Authorization: Bearer <CRON_SECRET>` till varje cron när
 * variabeln finns, som för de två befintliga cron-routerna. Här jämförs den i konstant tid (planens krav): över
 * sha256 av båda, så att längderna alltid är lika, timingSafeEqual aldrig kastar och längden inte läcker.
 *
 * Utan CRON_SECRET är routen avstängd (503), aldrig öppen.
 */
export type PortalCronAuth = { ok: true } | { ok: false; status: 401 | 503 };

export function checkPortalCronAuth(authorization: string | null, secret: string | undefined): PortalCronAuth {
  const expected = (secret ?? '').trim();
  if (!expected) return { ok: false, status: 503 };
  const header = (authorization ?? '').trim();
  const bearer = /^bearer\s/i.test(header) ? header.slice(7).trim() : '';
  if (!bearer) return { ok: false, status: 401 };
  const a = createHash('sha256').update(bearer, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, status: 401 };
}

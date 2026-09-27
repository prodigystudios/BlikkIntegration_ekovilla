import { isFortnoxProductionRuntime } from '@/lib/domains/fortnox/connectionGuard';
import { isUsablePortalSecret } from './signature';

/**
 * Integrationens miljövariabler, och spärren som håller varje miljö till rätt portal.
 *
 *   PORTAL_CRM_SHARED_SECRET   den delade hemligheten, olika per miljö (`openssl rand -hex 32`)
 *   RESELLER_PORTAL_URL        portalens adress, dit CRM:et skickar
 *
 * Saknas hemligheten är integrationen AV: portalens routes svarar 503 och inget skickas. Så går koden
 * ut mörk i prod tills hemligheten sätts (RESELLER_PORTAL_CRM_PLAN.md, fas 9).
 *
 * 🧨 Spärren: prod får bara skicka till prodportalen, och ingen annan miljö får skicka dit. Lokalt och
 * i testmiljön finns riktiga butiker i prodportalen, och ett testjobbs status eller en testprislista
 * får aldrig nå dem. Prod avgörs som i Fortnox-spärren (`isFortnoxProductionRuntime`), så att "prod"
 * betyder samma sak i båda.
 */

/** Prodportalens värd. Den enda som prod får skicka till, och den enda som ingen annan miljö får. */
export const PRODUCTION_PORTAL_HOST = 'partner.ekovilla.se';

type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Hemligheten, trimmad, eller null om den saknas eller är för kort för att vara säker. */
export function readPortalSecret(env: Env): string | null {
  const secret = env.PORTAL_CRM_SHARED_SECRET?.trim();
  return isUsablePortalSecret(secret) ? secret : null;
}

export type PortalTarget =
  | { ok: true; baseUrl: string }
  | { ok: false; reason: 'not_configured' | 'invalid_url' | 'insecure_url' | 'wrong_environment'; message: string };

/**
 * Vart CRM:et får skicka i den här miljön. `baseUrl` saknar avslutande snedstreck; anroparen lägger
 * till sökvägen (`/api/ekovilla/events`).
 */
export function resolvePortalTarget(env: Env): PortalTarget {
  if (!readPortalSecret(env)) {
    return { ok: false, reason: 'not_configured', message: 'PORTAL_CRM_SHARED_SECRET saknas eller är för kort.' };
  }
  const raw = env.RESELLER_PORTAL_URL?.trim();
  if (!raw) return { ok: false, reason: 'not_configured', message: 'RESELLER_PORTAL_URL saknas.' };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url', message: `RESELLER_PORTAL_URL är ingen adress: ${raw}` };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(host))) {
    return { ok: false, reason: 'insecure_url', message: 'RESELLER_PORTAL_URL måste vara https (http bara mot localhost).' };
  }

  const production = isFortnoxProductionRuntime(env);
  const isProductionPortal = host === PRODUCTION_PORTAL_HOST;
  if (production && !isProductionPortal) {
    return {
      ok: false,
      reason: 'wrong_environment',
      message: `Prod skickar bara till ${PRODUCTION_PORTAL_HOST}, inte till ${host}.`,
    };
  }
  if (!production && isProductionPortal) {
    return {
      ok: false,
      reason: 'wrong_environment',
      message: `Bara prod får skicka till ${PRODUCTION_PORTAL_HOST}. Den här miljön är inte prod.`,
    };
  }

  // Sökväg och frågesträng i variabeln tas inte med: anroparen bygger sökvägen själv.
  return { ok: true, baseUrl: url.origin };
}

import { isLocalUrl, isProductionDeployment, LOCAL_HOSTNAMES } from '@/lib/env';
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
 * 🧨 Spärren är en lista över TILLÅTNA värdar per miljö, inte en förbudslista: prod skickar bara
 * till prodportalen; lokalt och testmiljön bara till portalens testmiljö eller den här datorn. I
 * prodportalen finns riktiga butiker, och ett testjobbs status eller en testprislista får aldrig nå
 * dem. En förbudslista hade släppt igenom andra stavningar av samma värd, som `partner.ekovilla.se.`
 * med avslutande punkt, eller portalens egna Vercel-adresser. Prod avgörs med
 * `isProductionDeployment` (lib/env.ts), som faller stängt.
 *
 * 🧨 Utanför prod är också DATABASEN låst, se `isPortalDatabaseAllowed`.
 */

export const PRODUCTION_PORTAL_HOST = 'partner.ekovilla.se';
export const TEST_PORTAL_HOST = 'test.partner.ekovilla.se';

/** CRM:ets testprojekt i Supabase (`ekovilla-crm-test`, RESELLER_PORTAL_CRM_PLAN.md T2). */
export const TEST_DATABASE_HOST = 'aquwuqnqzuxljzkfoinn.supabase.co';

/** Skälet när `isPortalDatabaseAllowed` nekar. Upprepar inte adressen. */
export const WRONG_DATABASE_MESSAGE =
  'Utanför prod körs integrationen bara mot den lokala databasen eller testprojektet ekovilla-crm-test.';

type Env = Record<string, string | undefined>;

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/\.$/, '');
  } catch {
    return null;
  }
}

/**
 * Får integrationen köra mot den här miljöns databas? (T4b i planen.)
 *
 * Portalspärren i `resolvePortalTarget` ser bara vart CRM:et skickar, inte varifrån. Ärver testmiljön
 * prods Supabase-nycklar, t.ex. genom en allmän Preview-variabel i Vercel, godtar den testportalen,
 * och då tar "Skicka väntande nu" händelser ur PRODS kö och skickar dem till testportalen, där de
 * försvinner. Åt andra hållet hade testportalens jobb skrivits in i prods databas.
 *
 * Utanför prod måste därför VARJE satt databasadress vara den här datorn eller testprojektet. Det gäller
 * `SUPABASE_URL`, som serverklienten läser först, och `NEXT_PUBLIC_SUPABASE_URL`. Det är en lista över
 * tillåtna, som portalvärdarna: prods adress står med flit inte i koden. Är ingen adress satt finns
 * ingen databas och alltså ingen kö att tömma. I prod prövas inget här.
 *
 * Prövas i `resolvePortalTarget` (utskicket), `runPortalCron` (hela bakgrundsarbetet) och grinden för
 * portalens anrop (app/api/portal/_shared.ts). Köandet i användarens egna åtgärder (ett svar, ett
 * dokument) spärras inte: med fel databas är VARJE åtgärd i appen en skrivning i fel databas, och det
 * fångar testmiljöns kontroll (T6), inte portalen.
 */
export function isPortalDatabaseAllowed(env: Env): boolean {
  if (isProductionDeployment(env)) return true;
  return [env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_URL]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .every((value) => isLocalUrl(value) || hostnameOf(value) === TEST_DATABASE_HOST);
}

/** Hemligheten, trimmad, eller null om den saknas eller är för kort för att vara säker. */
export function readPortalSecret(env: Env): string | null {
  const secret = env.PORTAL_CRM_SHARED_SECRET?.trim();
  return isUsablePortalSecret(secret) ? secret : null;
}

export type PortalTarget =
  | { ok: true; baseUrl: string; secret: string }
  | { ok: false; reason: 'not_configured' | 'invalid_url' | 'insecure_url' | 'wrong_environment'; message: string };

/**
 * Vart CRM:et får skicka i den här miljön, och med vilken hemlighet. `baseUrl` saknar avslutande
 * snedstreck; anroparen lägger till sökvägen (`/api/ekovilla/events`). Meddelandena upprepar aldrig
 * variabelns värde: har variablerna förväxlats står hemligheten där.
 */
export function resolvePortalTarget(env: Env): PortalTarget {
  const secret = readPortalSecret(env);
  if (!secret) {
    return { ok: false, reason: 'not_configured', message: 'PORTAL_CRM_SHARED_SECRET saknas eller är för kort.' };
  }
  const raw = env.RESELLER_PORTAL_URL?.trim();
  if (!raw) return { ok: false, reason: 'not_configured', message: 'RESELLER_PORTAL_URL saknas.' };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url', message: 'RESELLER_PORTAL_URL är ingen giltig adress.' };
  }
  // `partner.ekovilla.se.` (med avslutande punkt) är samma värd i DNS.
  const host = url.hostname.replace(/\.$/, '');
  const local = LOCAL_HOSTNAMES.has(host);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return { ok: false, reason: 'insecure_url', message: 'RESELLER_PORTAL_URL måste vara https (http bara mot den här datorn).' };
  }

  if (isProductionDeployment(env)) {
    if (host !== PRODUCTION_PORTAL_HOST) {
      return { ok: false, reason: 'wrong_environment', message: `Prod skickar bara till ${PRODUCTION_PORTAL_HOST}, inte till ${host}.` };
    }
  } else if (host !== TEST_PORTAL_HOST && !local) {
    return {
      ok: false,
      reason: 'wrong_environment',
      message: `Utanför prod skickar CRM:et bara till ${TEST_PORTAL_HOST} eller den här datorn, inte till ${host}.`,
    };
  } else if (!isPortalDatabaseAllowed(env)) {
    return { ok: false, reason: 'wrong_environment', message: WRONG_DATABASE_MESSAGE };
  }

  // Sökväg och frågesträng i variabeln tas inte med: anroparen bygger sökvägen själv.
  return { ok: true, baseUrl: `${url.protocol}//${url.port ? `${host}:${url.port}` : host}`, secret };
}

import { FORTNOX_API_BASE } from './client';
import type { FortnoxCompanySettingsResponse } from './offerPdf';

/**
 * Vilket Fortnox-bolag får kopplas i den här miljön?
 *
 * 🧨 Utanför produktion kör appen mot en lokal databas med påhittad data — men Fortnox-inloggningen i
 * webbläsaren är ofta redan inloggad på det RIKTIGA bolaget. Godkänns kopplingen där sparas det riktiga
 * bolagets tokens lokalt, och varje offert, order och faktura man provar går till Fortnox på riktigt.
 * Utanför produktion får därför bara bolag i FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS kopplas (testbolaget).
 * Saknas listan får inget bolag kopplas alls — spärren faller stängd, inte öppen.
 *
 * Listan sätts BARA i .env.development.local. .env.local pekar på prods databas; står listan där och
 * någon kör dev utan .env.development.local, skulle en koppling av testbolaget skriva över prods enda
 * `fortnox_integrations`-rad — och prod skicka sina fakturor till testbolaget.
 */
export type FortnoxConnectionPolicy = { mode: 'any' } | { mode: 'allowlist'; allowed: string[] };

type Env = Record<string, string | undefined>;

/**
 * Produktion = en produktionsbyggd app mot en databas som inte är lokal, och som inte uttryckligen är
 * en förhandsversion. Medvetet INTE bara `VERCEL_ENV === 'production'`:
 *   - saknas VERCEL_ENV vid körning i prod hade prod inte längre kunnat koppla om Fortnox (efter ett
 *     invalid_grant) — spärren får aldrig ändra prods beteende;
 *   - `vercel env pull` för produktion lägger VERCEL_ENV=production i .env.local, och då hade spärren
 *     tyst varit av i `next dev`. `next dev` sätter alltid NODE_ENV=development.
 */
export function isFortnoxProductionRuntime(env: Env): boolean {
  if (env.NODE_ENV !== 'production') return false;
  if (isLocalSupabaseUrl(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL)) return false;
  if (env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'development') return false;
  return true;
}

/** Samma URL som getSupabaseAdmin skriver kopplingen till. Delas med skripten under scripts/fortnox/. */
export function isLocalSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ['127.0.0.1', 'localhost', '0.0.0.0', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function fortnoxConnectionPolicy(env: Env): FortnoxConnectionPolicy {
  if (isFortnoxProductionRuntime(env)) return { mode: 'any' };
  const allowed = (env.FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS ?? '')
    .split(/[,;\s]+/)
    .map(normalizeOrgNumber)
    .filter(Boolean);
  return { mode: 'allowlist', allowed };
}

/**
 * Bara siffrorna, och den tioställiga formen: "559341-9673", "5593419673" och den sekelprefixade
 * "16559341-9673" är samma bolag (samma regel som inferCustomerType i customers.ts).
 */
export function normalizeOrgNumber(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length === 12 ? digits.slice(-10) : digits;
}

export type FortnoxCompanyVerdict = { ok: true } | { ok: false; message: string };

const NO_ALLOWLIST_MESSAGE =
  'Fortnox kan inte kopplas i den här miljön: FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS är inte satt ' +
  '(den hör hemma i .env.development.local).';

/**
 * Prövas innan användaren skickas till Fortnox: är listan tom avvisas ALLA bolag ändå, så det finns
 * ingen anledning att låta Fortnox först godkänna kopplingen för det riktiga bolaget.
 */
export function fortnoxConnectPreflight(env: Env): FortnoxCompanyVerdict {
  const policy = fortnoxConnectionPolicy(env);
  if (policy.mode === 'allowlist' && policy.allowed.length === 0) {
    return { ok: false, message: NO_ALLOWLIST_MESSAGE };
  }
  return { ok: true };
}

export function judgeFortnoxCompany(
  policy: FortnoxConnectionPolicy,
  orgNumber: string | null,
): FortnoxCompanyVerdict {
  if (policy.mode === 'any') return { ok: true };
  if (policy.allowed.length === 0) return { ok: false, message: NO_ALLOWLIST_MESSAGE };
  const org = normalizeOrgNumber(orgNumber);
  if (!org) {
    return {
      ok: false,
      message: 'Kunde inte läsa Fortnox-bolagets organisationsnummer. Kopplingen sparades inte.',
    };
  }
  if (!policy.allowed.includes(org)) {
    return {
      ok: false,
      message:
        `Fortnox-bolaget med org.nr ${orgNumber} får inte kopplas utanför produktion. Kopplingen ` +
        'sparades inte — logga in på testbolaget i Fortnox och koppla igen.',
    };
  }
  return { ok: true };
}

/**
 * Läser bolagets organisationsnummer med den NYA token, innan något har sparats. `no-store` som alla
 * live-läsningar mot Fortnox (FORTNOX_INTEGRATION.md), och en timeout så att callbacken inte hänger.
 * Felet loggas med status men aldrig med token.
 */
async function fetchFortnoxOrgNumber(accessToken: string): Promise<string | null> {
  const res = await fetch(`${FORTNOX_API_BASE}/settings/company`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.warn('[fortnox] Uppslaget av bolagets organisationsnummer misslyckades', { status: res.status });
    return null;
  }
  const body = (await res.json().catch(() => null)) as {
    CompanySettings?: FortnoxCompanySettingsResponse;
  } | null;
  return body?.CompanySettings?.OrganizationNumber ?? null;
}

/**
 * Kastar om bolaget inte får kopplas i den här miljön. Anropas i OAuth-callbacken mellan
 * token-utbytet och sparandet, så att ett otillåtet bolags tokens aldrig når databasen.
 * Ett fel vid uppslaget räknas som "okänt bolag" — spärren faller stängd.
 */
export async function assertFortnoxCompanyAllowed(accessToken: string, env: Env = process.env): Promise<void> {
  const policy = fortnoxConnectionPolicy(env);
  if (policy.mode === 'any') return;
  if (policy.allowed.length === 0) throw new Error(NO_ALLOWLIST_MESSAGE);
  const orgNumber = await fetchFortnoxOrgNumber(accessToken).catch((e: unknown) => {
    console.warn('[fortnox] Uppslaget av bolagets organisationsnummer kastade', {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  });
  const verdict = judgeFortnoxCompany(policy, orgNumber);
  if (!verdict.ok) throw new Error(verdict.message);
}

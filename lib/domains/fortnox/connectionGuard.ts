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
 * I produktion (VERCEL_ENV=production) prövas ingenting och Fortnox anropas inte — samma beteende som
 * innan spärren fanns. NODE_ENV duger inte som signal: den är 'production' även i Vercels
 * förhandsversioner. Samma val som materialOrderSendMode.
 */
export type FortnoxConnectionPolicy = { mode: 'any' } | { mode: 'allowlist'; allowed: string[] };

export function fortnoxConnectionPolicy(env: Record<string, string | undefined>): FortnoxConnectionPolicy {
  if (env.VERCEL_ENV === 'production') return { mode: 'any' };
  const allowed = (env.FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS ?? '')
    .split(',')
    .map(normalizeOrgNumber)
    .filter(Boolean);
  return { mode: 'allowlist', allowed };
}

/** Bara siffrorna: "559341-9673" och "5593419673" är samma bolag. */
export function normalizeOrgNumber(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

export type FortnoxCompanyVerdict = { ok: true } | { ok: false; message: string };

export function judgeFortnoxCompany(
  policy: FortnoxConnectionPolicy,
  orgNumber: string | null,
): FortnoxCompanyVerdict {
  if (policy.mode === 'any') return { ok: true };
  if (policy.allowed.length === 0) {
    return {
      ok: false,
      message:
        'Fortnox kan inte kopplas i den här miljön: FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS är inte satt. ' +
        'Kopplingen sparades inte.',
    };
  }
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

/** Läser bolagets organisationsnummer med den NYA token, innan något har sparats. */
async function fetchFortnoxOrgNumber(accessToken: string): Promise<string | null> {
  const res = await fetch(`${FORTNOX_API_BASE}/settings/company`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
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
export async function assertFortnoxCompanyAllowed(
  accessToken: string,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const policy = fortnoxConnectionPolicy(env);
  if (policy.mode === 'any') return;
  const orgNumber = await fetchFortnoxOrgNumber(accessToken).catch(() => null);
  const verdict = judgeFortnoxCompany(policy, orgNumber);
  if (!verdict.ok) throw new Error(verdict.message);
}

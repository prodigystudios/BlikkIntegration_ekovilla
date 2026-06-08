import { getSupabaseAdmin } from '@/lib/supabase/server';
import type { FortnoxTokenResponse } from './types';

export const FORTNOX_API_BASE = 'https://api.fortnox.se/3';
export const FORTNOX_TOKEN_URL = 'https://apps.fortnox.se/oauth-v1/token';
export const FORTNOX_AUTH_URL = 'https://apps.fortnox.se/oauth-v1/auth';

// Scopes required by this integration.
// settings: needed for the terms-of-payment register (/termsofpayments) – per
//   Fortnox docs, "Terms Of Payments" is under the Settings scope. Must be enabled
//   on the Fortnox app registration, otherwise authorization fails with invalid_scope.
// price: needed for the price-list register (/pricelists).
// NOTE: changing this requires reconnecting Fortnox – existing tokens keep their
// originally-granted scopes until a new authorization is performed.
export const FORTNOX_SCOPES = 'article customer order offer invoice price settings';

export class FortnoxNotConnectedError extends Error {
  constructor() {
    super('Fortnox är inte kopplat. Anslut via CRM-inställningar.');
    this.name = 'FortnoxNotConnectedError';
  }
}

// Thrown when a concurrent push to the same document is already in flight (a fresh claim is
// held). Lets routes return 409 instead of creating a duplicate Fortnox document.
export class FortnoxPushInProgressError extends Error {
  constructor() {
    super('En synk mot Fortnox pågår redan för den här posten. Försök igen om en liten stund.');
    this.name = 'FortnoxPushInProgressError';
  }
}

export class FortnoxApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Fortnox's own error code + message (parsed from the response body) so callers
    // can translate them to user-friendly text. `message` keeps the full technical
    // string for logs.
    public readonly fortnoxCode?: number,
    public readonly fortnoxMessage?: string,
  ) {
    super(message);
    this.name = 'FortnoxApiError';
  }
}

// Fortnox error bodies look like { "ErrorInformation": { "code": 2001243, "message": "..." } }.
function parseFortnoxError(text: string): { code?: number; message?: string } {
  try {
    const info = (JSON.parse(text) as { ErrorInformation?: { code?: unknown; message?: unknown } })?.ErrorInformation;
    if (!info) return {};
    const code = typeof info.code === 'number' ? info.code : Number(info.code) || undefined;
    const message = typeof info.message === 'string' ? info.message : undefined;
    return { code, message };
  } catch {
    return {};
  }
}

function buildFortnoxError(status: number, method: string, path: string, text: string): FortnoxApiError {
  const { code, message } = parseFortnoxError(text);
  return new FortnoxApiError(status, `Fortnox ${method} ${path} misslyckades (${status}): ${text}`, code, message);
}

// Known Fortnox error codes → plain-language Swedish a salesperson understands.
// Add codes here as we hit them; unknown codes fall back to Fortnox's own message.
const FRIENDLY_FORTNOX_MESSAGES: Record<number, string> = {
  2001243: 'Offerten är låst eftersom en arbetsorder redan har skapats från den. Den går inte att ändra i efterhand.',
  2000499: 'Det finns redan en order kopplad till den här offerten.',
  2000310: 'Posten används redan i Fortnox och kan inte ändras eller tas bort.',
  2000204: 'En obligatorisk uppgift saknas i Fortnox. Komplettera kund-/offertuppgifterna och försök igen.',
  1000030: 'Kunde inte hämta dokumentet från Fortnox. Försök igen om en stund.',
};

// Turn any thrown Fortnox error into a message safe to show a non-technical user.
export function friendlyFortnoxMessage(e: unknown): string {
  if (e instanceof FortnoxNotConnectedError) {
    return 'Fortnox är inte kopplat. Be en administratör ansluta Fortnox i CRM-inställningarna.';
  }
  if (e instanceof FortnoxPushInProgressError) {
    return e.message;
  }
  if (e instanceof FortnoxApiError) {
    if (e.fortnoxCode && FRIENDLY_FORTNOX_MESSAGES[e.fortnoxCode]) {
      return FRIENDLY_FORTNOX_MESSAGES[e.fortnoxCode];
    }
    // Fortnox's own message is Swedish and usually readable — far better than the raw
    // "Fortnox PUT ... (400): {json}" technical string.
    if (e.fortnoxMessage) return e.fortnoxMessage;
    return 'Något gick fel mot Fortnox. Försök igen, eller kontakta support om det kvarstår.';
  }
  return 'Något gick fel. Försök igen.';
}

function getClientCredentials() {
  const clientId = process.env.FORTNOX_CLIENT_ID;
  const clientSecret = process.env.FORTNOX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('FORTNOX_CLIENT_ID och FORTNOX_CLIENT_SECRET måste vara satta i miljön.');
  }
  return { clientId, clientSecret };
}

function basicAuthHeader(clientId: string, clientSecret: string) {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

// Refresh access token using refresh_token. Returns new token response or throws.
export async function refreshAccessToken(refreshToken: string): Promise<FortnoxTokenResponse> {
  const { clientId, clientSecret } = getClientCredentials();

  const res = await fetch(FORTNOX_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new FortnoxApiError(res.status, `Token refresh misslyckades: ${text}`);
  }

  return res.json() as Promise<FortnoxTokenResponse>;
}

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// Single-flight guard: when a refresh is in progress, concurrent callers await
// the same promise instead of each firing their own. Fortnox rotates the
// refresh_token on every refresh and invalidates the previous one, so two
// parallel refreshes would leave the second with an invalid_grant and break the
// token chain. Scoped per process – the dominant race source (batched sync GETs)
// runs in one process, so this fully covers it.
let inflightRefresh: Promise<string> | null = null;

// Refresh the access token and persist the rotated tokens. Re-reads the row
// first and re-checks expiry: a caller queued behind the lock may find the token
// already refreshed by the call it waited on, in which case it must NOT refresh
// again with the now-rotated refresh_token.
async function refreshAndPersist(): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('fortnox_integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('provider', 'fortnox')
    .maybeSingle();

  if (!data) throw new FortnoxNotConnectedError();

  const expiresAt = new Date(data.expires_at).getTime();
  if (Date.now() + TOKEN_EXPIRY_BUFFER_MS < expiresAt) {
    return data.access_token;
  }

  const refreshed = await refreshAccessToken(data.refresh_token);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  await supabase
    .from('fortnox_integrations')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('provider', 'fortnox');

  return refreshed.access_token;
}

// Returns a valid access token, refreshing if needed (5-minute buffer).
async function getValidAccessToken(): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('fortnox_integrations')
    .select('access_token, expires_at')
    .eq('provider', 'fortnox')
    .maybeSingle();

  if (!data) throw new FortnoxNotConnectedError();

  const expiresAt = new Date(data.expires_at).getTime();
  if (Date.now() + TOKEN_EXPIRY_BUFFER_MS < expiresAt) {
    return data.access_token;
  }

  // Near/at expiry: collapse all concurrent refreshes into one in-flight call.
  // Cleared on settle so the next expiry cycle (or a retry after failure) starts fresh.
  if (!inflightRefresh) {
    inflightRefresh = refreshAndPersist().finally(() => {
      inflightRefresh = null;
    });
  }
  return inflightRefresh;
}

// Perform a GET request to the Fortnox API.
export async function fortnoxGet<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const token = await getValidAccessToken();
  const url = new URL(`${FORTNOX_API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    // Never serve a cached response – Next.js App Router caches fetch() by
    // default, which would return stale Fortnox data after a write.
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw buildFortnoxError(res.status, 'GET', path, text);
  }

  return res.json() as Promise<T>;
}

// Perform a GET that returns a binary document (e.g. an offer/order/invoice PDF
// from the `/print` endpoints). Unlike fortnoxGet this requests a non-JSON body and
// returns the raw bytes + content type.
export async function fortnoxGetBinary(
  path: string,
  accept = 'application/pdf',
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const token = await getValidAccessToken();

  const res = await fetch(`${FORTNOX_API_BASE}${path}`, {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw buildFortnoxError(res.status, 'GET', path, text);
  }

  const buf = await res.arrayBuffer();
  // Fall back to application/pdf (the actual document type), NOT `accept` — callers pass
  // accept='application/json' as a Fortnox workaround, so using it as the fallback would
  // mislabel a valid PDF that arrives without a Content-Type header.
  return { bytes: new Uint8Array(buf), contentType: res.headers.get('content-type') || 'application/pdf' };
}

// Perform a PUT request to the Fortnox API (e.g. offer → order conversion).
export async function fortnoxPut<T>(path: string, body?: unknown): Promise<T> {
  const token = await getValidAccessToken();

  const res = await fetch(`${FORTNOX_API_BASE}${path}`, {
    method: 'PUT',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw buildFortnoxError(res.status, 'PUT', path, text);
  }

  return res.json() as Promise<T>;
}

// Perform a POST request to the Fortnox API.
export async function fortnoxPost<T>(path: string, body: unknown): Promise<T> {
  const token = await getValidAccessToken();

  const res = await fetch(`${FORTNOX_API_BASE}${path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw buildFortnoxError(res.status, 'POST', path, text);
  }

  return res.json() as Promise<T>;
}

// Perform a DELETE request to the Fortnox API. Fortnox returns an empty body
// (204) on success, so unlike GET/POST/PUT this does not parse JSON.
export async function fortnoxDelete(path: string): Promise<void> {
  const token = await getValidAccessToken();

  const res = await fetch(`${FORTNOX_API_BASE}${path}`, {
    method: 'DELETE',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw buildFortnoxError(res.status, 'DELETE', path, text);
  }
}

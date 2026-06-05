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

export class FortnoxApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'FortnoxApiError';
  }
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

// Returns a valid access token, refreshing if needed (5-minute buffer).
async function getValidAccessToken(): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('fortnox_integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('provider', 'fortnox')
    .maybeSingle();

  if (!data) throw new FortnoxNotConnectedError();

  const expiresAt = new Date(data.expires_at).getTime();
  const bufferMs = 5 * 60 * 1000;

  if (Date.now() + bufferMs >= expiresAt) {
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

  return data.access_token;
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
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new FortnoxApiError(res.status, `Fortnox GET ${path} misslyckades (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

// Perform a PUT request to the Fortnox API (e.g. offer → order conversion).
export async function fortnoxPut<T>(path: string, body?: unknown): Promise<T> {
  const token = await getValidAccessToken();

  const res = await fetch(`${FORTNOX_API_BASE}${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new FortnoxApiError(res.status, `Fortnox PUT ${path} misslyckades (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

// Perform a POST request to the Fortnox API.
export async function fortnoxPost<T>(path: string, body: unknown): Promise<T> {
  const token = await getValidAccessToken();

  const res = await fetch(`${FORTNOX_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new FortnoxApiError(res.status, `Fortnox POST ${path} misslyckades (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

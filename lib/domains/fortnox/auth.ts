import { getSupabaseAdmin } from '@/lib/supabase/server';
import {
  FORTNOX_AUTH_URL,
  FORTNOX_TOKEN_URL,
  FORTNOX_SCOPES,
  FortnoxApiError,
} from './client';
import type { FortnoxTokenResponse, FortnoxConnectionStatus } from './types';

function getClientCredentials() {
  const clientId = process.env.FORTNOX_CLIENT_ID;
  const clientSecret = process.env.FORTNOX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('FORTNOX_CLIENT_ID och FORTNOX_CLIENT_SECRET måste vara satta i miljön.');
  }
  return { clientId, clientSecret };
}

function getRedirectUri(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${appUrl}/api/fortnox/auth/callback`;
}

export function isFortnoxTestMode(): boolean {
  return process.env.FORTNOX_ENVIRONMENT === 'test';
}

// Build the Fortnox OAuth authorization URL.
// state: CSRF token to verify in the callback.
export function buildFortnoxAuthUrl(state: string): string {
  const { clientId } = getClientCredentials();
  const url = new URL(FORTNOX_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', getRedirectUri());
  url.searchParams.set('scope', FORTNOX_SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  return url.toString();
}

// Exchange authorization code for access + refresh tokens.
export async function exchangeCodeForToken(code: string): Promise<FortnoxTokenResponse> {
  const { clientId, clientSecret } = getClientCredentials();

  const res = await fetch(FORTNOX_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(),
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new FortnoxApiError(res.status, `Fortnox token exchange misslyckades: ${text}`);
  }

  return res.json() as Promise<FortnoxTokenResponse>;
}

// Save (upsert) integration tokens to DB. Uses service role – approved use.
export async function saveFortnoxIntegration(
  tokenData: FortnoxTokenResponse,
  userId: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('fortnox_integrations')
    .upsert(
      {
        provider: 'fortnox',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
        scope: tokenData.scope,
        connected_by: userId,
        connected_at: now,
        updated_at: now,
      },
      { onConflict: 'provider' },
    );

  if (error) throw new Error(`Kunde inte spara Fortnox-integration: ${error.message}`);
}

// Remove the Fortnox integration (disconnect).
export async function disconnectFortnoxIntegration(): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('fortnox_integrations')
    .delete()
    .eq('provider', 'fortnox');

  if (error) throw new Error(`Kunde inte ta bort Fortnox-integration: ${error.message}`);
}

// Returns connection status (safe to expose via API – no tokens included).
export async function getFortnoxConnectionStatus(): Promise<FortnoxConnectionStatus> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('fortnox_integrations')
    .select('connected_by, connected_at, scope')
    .eq('provider', 'fortnox')
    .maybeSingle();

  return {
    connected: !!data,
    connected_by: data?.connected_by ?? null,
    connected_at: data?.connected_at ?? null,
    scope: data?.scope ?? null,
    is_test_mode: isFortnoxTestMode(),
  };
}

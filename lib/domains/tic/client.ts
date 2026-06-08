// HTTP client for the tic.io LENS API (v2). Server-only — reads TIC_API_KEY from the
// environment and authenticates with the `x-api-key` header (server-to-server flow).
// Mirrors the shape of lib/domains/fortnox/client.ts (typed errors + friendly messages).

export const TIC_API_BASE = process.env.TIC_API_BASE || 'https://lens-api.tic.io';

export class TicNotConfiguredError extends Error {
  constructor() {
    super('tic.io är inte konfigurerat (TIC_API_KEY saknas i miljön).');
    this.name = 'TicNotConfiguredError';
  }
}

export class TicApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'TicApiError';
  }
}

// Turn any thrown tic.io error into a message safe to show a non-technical user.
export function friendlyTicMessage(e: unknown): string {
  if (e instanceof TicNotConfiguredError) {
    return 'Företagsuppslag är inte aktiverat. Be en administratör konfigurera tic.io.';
  }
  if (e instanceof TicApiError) {
    if (e.status === 401) {
      return 'Uppslagstjänsten avvisade förfrågan. Kontrollera att API-nyckeln är giltig.';
    }
    // tic.io returns 403 when the endpoint isn't included in your subscription plan
    // (e.g. person search requires the Enterprise+ tier) — the key is valid, the plan
    // simply lacks the feature, so don't blame the API key here.
    if (e.status === 403) {
      return 'Det här uppslaget ingår inte i din tic.io-licens. Personsök kräver en högre licensnivå (Enterprise+).';
    }
    if (e.status === 429) {
      return 'För många sökningar mot uppslagstjänsten just nu. Försök igen om en stund.';
    }
    return 'Kunde inte hämta uppgifter från uppslagstjänsten. Försök igen.';
  }
  return 'Något gick fel vid uppslaget. Försök igen.';
}

// Map a thrown tic.io error to an HTTP response shape for the API routes (DRY across
// the company + person search routes).
export function ticRouteErrorInfo(e: unknown): { status: number; code: string; message: string } {
  if (e instanceof TicNotConfiguredError) {
    return { status: 503, code: 'tic_not_configured', message: friendlyTicMessage(e) };
  }
  if (e instanceof TicApiError) {
    return { status: 502, code: 'tic_api_error', message: friendlyTicMessage(e) };
  }
  return { status: 500, code: 'tic_search_failed', message: friendlyTicMessage(e) };
}

// Perform a GET request to the tic.io LENS API.
export async function ticGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const apiKey = process.env.TIC_API_KEY;
  if (!apiKey) throw new TicNotConfiguredError();

  const url = new URL(`${TIC_API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    // Next.js App Router caches fetch() by default; lookups must always be live.
    cache: 'no-store',
    headers: {
      'x-api-key': apiKey,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new TicApiError(res.status, `tic.io GET ${path} misslyckades (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

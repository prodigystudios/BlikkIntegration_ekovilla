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
  constructor(
    public readonly status: number,
    message: string,
    // The raw tic.io response body, kept for server-side logging/diagnosis.
    public readonly body?: string,
  ) {
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
    // 403 = tic.io accepted the key but denied access to this endpoint. Causes:
    // the key's plan/tier lacks the feature, an IP allow-list that excludes the
    // server, or a key restriction. NOTE: this is generic — do not assume person
    // search here (company search is the only live lookup), and the same 403 can
    // come from a proxy/WAF in front of the API. The real reason is in the logs.
    if (e.status === 403) {
      return 'Uppslagstjänsten nekade förfrågan – API-nyckeln saknar behörighet för uppslaget. Kontrollera licensnivå och eventuell IP-begränsning på nyckeln.';
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
  // Trim defensively: a stray newline/space in the prod env value (common when keys are
  // pasted into a dashboard) would otherwise be sent in the header and rejected with 403/401.
  const apiKey = process.env.TIC_API_KEY?.trim();
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
    // Log the real status + body so production failures (tier/IP/key) are diagnosable —
    // friendlyTicMessage only returns a generic user-facing string.
    console.error(`[tic.io] GET ${path} → ${res.status} (base ${TIC_API_BASE}): ${text.slice(0, 500)}`);
    throw new TicApiError(res.status, `tic.io GET ${path} misslyckades (${res.status}): ${text}`, text);
  }

  return res.json() as Promise<T>;
}

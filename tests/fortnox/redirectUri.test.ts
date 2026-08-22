import { describe, it, expect, afterEach, vi } from 'vitest';

// getRedirectUri är inte exporterad — den observeras genom auth-URL:en, som är det som faktiskt
// skickas till Fortnox. Regressionsvakt efter domänbytet: värdet måste matcha den registrerade
// adressen exakt, annars avvisar Fortnox hela flödet.

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

const saved = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  nodeEnv: process.env.NODE_ENV,
  clientId: process.env.FORTNOX_CLIENT_ID,
  clientSecret: process.env.FORTNOX_CLIENT_SECRET,
};

function setEnv(appUrl: string | undefined, nodeEnv: string) {
  if (appUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = appUrl;
  vi.stubEnv('NODE_ENV', nodeEnv);
  process.env.FORTNOX_CLIENT_ID = 'id';
  process.env.FORTNOX_CLIENT_SECRET = 'secret';
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const [key, value] of [
    ['NEXT_PUBLIC_APP_URL', saved.appUrl],
    ['FORTNOX_CLIENT_ID', saved.clientId],
    ['FORTNOX_CLIENT_SECRET', saved.clientSecret],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function redirectUriFromAuthUrl(): Promise<string> {
  const { buildFortnoxAuthUrl } = await import('@/lib/domains/fortnox/auth');
  const url = new URL(buildFortnoxAuthUrl('state-123'));
  return url.searchParams.get('redirect_uri') || '';
}

describe('Fortnox redirect_uri', () => {
  it('byggs av NEXT_PUBLIC_APP_URL och den registrerade sökvägen', async () => {
    setEnv('https://app.ekovilla.se', 'production');
    expect(await redirectUriFromAuthUrl()).toBe('https://app.ekovilla.se/api/fortnox/auth/callback');
  });

  it('tål ett avslutande snedstreck utan att bygga dubbla //', async () => {
    setEnv('https://app.ekovilla.se/', 'production');
    expect(await redirectUriFromAuthUrl()).toBe('https://app.ekovilla.se/api/fortnox/auth/callback');
  });

  it('kastar i produktion när variabeln saknas i stället för att tyst bygga localhost', async () => {
    setEnv(undefined, 'production');
    await expect(redirectUriFromAuthUrl()).rejects.toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it('kastar också på tom sträng — en satt men tom variabel är samma sak som saknad', async () => {
    setEnv('   ', 'production');
    await expect(redirectUriFromAuthUrl()).rejects.toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it('behåller localhost-fallbacken utanför produktion', async () => {
    setEnv(undefined, 'development');
    expect(await redirectUriFromAuthUrl()).toBe('http://localhost:3000/api/fortnox/auth/callback');
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { getPublicOrigin } from '@/lib/publicOrigin';

// getPublicOrigin är den enda kanoniska källan till appens egen domän. Efter flytten till
// app.ekovilla.se bär den vikten av länkar som mejlas till kunder och skrivs in i Blikk — den
// gamla vercel.app-adressen svarar fortfarande, så host-härledningen räcker inte som garanti.

const ENV_KEYS = ['NEXT_PUBLIC_SITE_URL', 'SITE_URL', 'PUBLIC_SITE_URL'] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

afterEach(() => {
  clearEnv();
  for (const k of ENV_KEYS) if (saved[k] !== undefined) process.env[k] = saved[k];
});

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe('getPublicOrigin', () => {
  it('låter NEXT_PUBLIC_SITE_URL vinna över hosten — poängen med hela övningen', () => {
    clearEnv();
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.ekovilla.se';
    const origin = getPublicOrigin(
      req('https://blikk-integration-ekovilla.vercel.app/api/storage/save', {
        'x-forwarded-host': 'blikk-integration-ekovilla.vercel.app',
        'x-forwarded-proto': 'https',
      }),
    );
    expect(origin).toBe('https://app.ekovilla.se');
  });

  it('trimmar avslutande snedstreck på overriden', () => {
    clearEnv();
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.ekovilla.se/';
    expect(getPublicOrigin(req('https://x.test/'))).toBe('https://app.ekovilla.se');
  });

  it('ignorerar en override utan protokoll i stället för att bygga en trasig URL', () => {
    clearEnv();
    process.env.NEXT_PUBLIC_SITE_URL = 'app.ekovilla.se';
    const origin = getPublicOrigin(
      req('https://app.ekovilla.se/x', { 'x-forwarded-host': 'app.ekovilla.se', 'x-forwarded-proto': 'https' }),
    );
    expect(origin).toBe('https://app.ekovilla.se');
  });

  it('faller tillbaka på x-forwarded-host när ingen override är satt', () => {
    clearEnv();
    expect(
      getPublicOrigin(req('https://internal/x', { 'x-forwarded-host': 'app.ekovilla.se', 'x-forwarded-proto': 'https' })),
    ).toBe('https://app.ekovilla.se');
  });

  it('utan override bär den gamla domänen vidare — vilket är precis varför overriden behövs', () => {
    clearEnv();
    expect(
      getPublicOrigin(
        req('https://internal/x', {
          'x-forwarded-host': 'blikk-integration-ekovilla.vercel.app',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe('https://blikk-integration-ekovilla.vercel.app');
  });

  it('antar http för localhost och https för allt annat när proto-headern saknas', () => {
    clearEnv();
    expect(getPublicOrigin(req('http://localhost:3000/x', { host: 'localhost:3000' }))).toBe('http://localhost:3000');
    expect(getPublicOrigin(req('https://app.ekovilla.se/x', { host: 'app.ekovilla.se' }))).toBe('https://app.ekovilla.se');
  });
});

describe('getCanonicalOrigin', () => {
  it('läser NEXT_PUBLIC_SITE_URL när den är satt', async () => {
    clearEnv();
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.ekovilla.se';
    const { getCanonicalOrigin } = await import('@/lib/publicOrigin');
    expect(getCanonicalOrigin()).toBe('https://app.ekovilla.se');
  });

  it('trimmar avslutande snedstreck — metadataBase ska inte ge dubbla //', async () => {
    clearEnv();
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.ekovilla.se/';
    const { getCanonicalOrigin } = await import('@/lib/publicOrigin');
    expect(getCanonicalOrigin()).toBe('https://app.ekovilla.se');
  });

  it('faller tillbaka på den kanoniska domänen i stället för att kasta i bygget', async () => {
    clearEnv();
    const { getCanonicalOrigin, CANONICAL_ORIGIN_FALLBACK } = await import('@/lib/publicOrigin');
    expect(getCanonicalOrigin()).toBe(CANONICAL_ORIGIN_FALLBACK);
    expect(CANONICAL_ORIGIN_FALLBACK).toBe('https://app.ekovilla.se');
  });

  it('ger alltid något new URL() accepterar — metadataBase kraschar annars bygget', async () => {
    const { getCanonicalOrigin } = await import('@/lib/publicOrigin');
    for (const value of ['', '   ', 'app.ekovilla.se', 'https://app.ekovilla.se']) {
      clearEnv();
      process.env.NEXT_PUBLIC_SITE_URL = value;
      expect(() => new URL(getCanonicalOrigin())).not.toThrow();
    }
  });
});

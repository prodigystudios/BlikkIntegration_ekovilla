import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Klienterna efter bytet till @supabase/ssr. Biblioteket mockas: det som prövas är VÅR adapter —
// att en förnyelse i en server-komponent inte kraschar sidan, och att webbläsaren får en enda klient.

// `cookieSet` är en vanlig funktion och INTE vi.fn(): Vitest fäller testet när en vi.fn() med
// mockImplementation kastar, även om koden under test fångar kastet — just det testet nedan prövar.
const h = vi.hoisted(() => ({
  setCalls: [] as unknown[][],
  setThrows: false,
  cookieSet(...args: unknown[]) {
    h.setCalls.push(args);
    if (h.setThrows) throw new Error('Cookies can only be modified in a Server Action or Route Handler');
  },
  createServerClient: vi.fn((_url: string, _key: string, options: any) => ({ options })),
  createBrowserClient: vi.fn(() => ({ id: Math.random() })),
}));

vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => [{ name: 'sb-test-auth-token', value: 'base64-abc' }],
    set: (...args: unknown[]) => h.cookieSet(...args),
  }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: h.createServerClient,
  createBrowserClient: h.createBrowserClient,
}));

import { createSessionClient } from '@/lib/supabase/session';
import { getBrowserClient } from '@/lib/supabase/browser';

function sessionCookieAdapter() {
  return (createSessionClient() as any).options.cookies as {
    getAll: () => { name: string; value: string }[];
    setAll: (cookies: { name: string; value: string; options: Record<string, unknown> }[]) => void;
  };
}

describe('createSessionClient', () => {
  beforeEach(() => {
    h.setCalls = [];
    h.setThrows = false;
  });

  it('läser kakorna ur requesten', () => {
    expect(sessionCookieAdapter().getAll()).toEqual([{ name: 'sb-test-auth-token', value: 'base64-abc' }]);
  });

  it('skriver förnyade kakor där Next tillåter det (route handler)', () => {
    sessionCookieAdapter().setAll([{ name: 'sb-test-auth-token', value: 'base64-new', options: { path: '/' } }]);
    expect(h.setCalls).toEqual([['sb-test-auth-token', 'base64-new', { path: '/' }]]);
  });

  // 🧨 Det här var kraschen: token gick ut, klienten förnyade mitt i renderingen av en
  // server-komponent, och cookies().set() kastade — sidan dog med "Application error".
  it('kraschar inte när en server-komponent förnyar sessionen', () => {
    h.setThrows = true;
    expect(() =>
      sessionCookieAdapter().setAll([{ name: 'sb-test-auth-token', value: 'base64-new', options: {} }]),
    ).not.toThrow();
    expect(h.setCalls).toHaveLength(1); // försöket gjordes — det är kastet som sväljs, inte skrivningen som hoppas över
  });
});

describe('getBrowserClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Ett tjugotal effekter har klienten i sin dependency-array; en ny klient per render hade startat
  // om realtime-prenumerationerna på varje render.
  it('ger samma klient i webbläsaren', () => {
    vi.stubGlobal('window', {});
    expect(getBrowserClient()).toBe(getBrowserClient());
  });

  it('delar ingen klient under serverrenderingen', () => {
    expect(typeof window).toBe('undefined');
    expect(getBrowserClient()).not.toBe(getBrowserClient());
  });
});

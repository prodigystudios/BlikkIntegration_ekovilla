import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mockar före modulimporter.
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn() }));

import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { POST } from '@/app/api/push/subscription/route';

const mockClient = vi.mocked(createRouteHandlerClient);

type Captured = { table: string; payload: any; options: any } | null;
let captured: Captured = null;

const OLD = 'https://blikk-integration-ekovilla.vercel.app';
const NEW = 'https://app.ekovilla.se';

const ENV_KEYS = ['NEXT_PUBLIC_SITE_URL', 'SITE_URL', 'PUBLIC_SITE_URL'] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

function setSupabase({ userId = 'user-1', upsertError = null as null | { message: string } } = {}) {
  mockClient.mockReturnValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from: (table: string) => ({
      upsert: (payload: any, options: any) => {
        captured = { table, payload, options };
        return { error: upsertError };
      },
    }),
  } as any);
}

function req(host: string, body?: unknown) {
  return new Request('https://internal/api/push/subscription', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-host': host.replace(/^https?:\/\//, ''), 'x-forwarded-proto': 'https' },
    body: JSON.stringify(
      body ?? { subscription: { endpoint: 'https://fcm.example/abc', keys: { p256dh: 'p', auth: 'a' } }, userAgent: 'Test/1.0' },
    ),
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  captured = null;
  for (const k of ENV_KEYS) delete process.env[k];
  setSupabase();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    delete process.env[k];
    if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
  }
});

describe('POST /api/push/subscription — origin-stämpling', () => {
  it('stämplar den nya domänen när requesten kommer dit', async () => {
    const res = await POST(req(NEW));
    expect(res.status).toBe(200);
    expect(captured?.table).toBe('dashboard_push_subscriptions');
    expect(captured?.payload.origin).toBe(NEW);
  });

  it('stämplar den GAMLA domänen när requesten kommer dit — raden hör hemma där', async () => {
    const res = await POST(req(OLD));
    expect(res.status).toBe(200);
    expect(captured?.payload.origin).toBe(OLD);
  });

  it('NEXT_PUBLIC_SITE_URL får INTE läcka in i stämplingen', async () => {
    // Regressionsvakt. getPublicOrigin svarar alltid med den kanoniska domänen, och hade den
    // använts här skulle en prenumeration skapad på den gamla adressen stämplats som om den hörde
    // hemma på den nya. Då blir kolumnen oanvändbar för att skilja gamla rader från nya, och
    // städningen i supabase/sql/manual/ skulle rensa fel rader.
    process.env.NEXT_PUBLIC_SITE_URL = NEW;
    await POST(req(OLD));
    expect(captured?.payload.origin).toBe(OLD);
    expect(captured?.payload.origin).not.toBe(NEW);
  });

  it('faller tillbaka på host-headern när x-forwarded-host saknas', async () => {
    const r = new Request('https://internal/api/push/subscription', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'app.ekovilla.se' },
      body: JSON.stringify({ subscription: { endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } } }),
    });
    await POST(r as any);
    expect(captured?.payload.origin).toBe(NEW);
  });
});

describe('POST /api/push/subscription — upsert av befintlig rad', () => {
  it('går på endpoint, så samma enhet uppdaterar sin rad i stället för att skapa en till', async () => {
    await POST(req(NEW));
    expect(captured?.options).toEqual({ onConflict: 'endpoint' });
  });

  it('origin ingår i nyttolasten — det är så BEFINTLIGA rader får sin stämpel', async () => {
    // Upserten sätter varje fält i payloaden även på konfliktvägen (ON CONFLICT DO UPDATE).
    // Saknades origin här skulle bara nyskapade rader någonsin få ett värde, och alla rader som
    // fanns före deployen förblivit null hur ofta enheten än hörde av sig.
    await POST(req(OLD));
    expect(Object.keys(captured?.payload ?? {})).toEqual(
      expect.arrayContaining(['user_id', 'endpoint', 'p256dh', 'auth', 'user_agent', 'origin', 'updated_at']),
    );
    expect(captured?.payload.origin).toBe(OLD);
  });

  it('bär med användaren och prenumerationens nycklar oförändrade', async () => {
    await POST(req(NEW));
    expect(captured?.payload).toMatchObject({
      user_id: 'user-1',
      endpoint: 'https://fcm.example/abc',
      p256dh: 'p',
      auth: 'a',
      user_agent: 'Test/1.0',
    });
  });
});

describe('POST /api/push/subscription — oförändrat beteende', () => {
  it('401 utan session, och rör inte tabellen', async () => {
    mockClient.mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: () => { throw new Error('får inte nås'); },
    } as any);
    const res = await POST(req(NEW));
    expect(res.status).toBe(401);
    expect(captured).toBeNull();
  });

  it('400 på trasig body', async () => {
    const res = await POST(req(NEW, { subscription: { endpoint: '' } }));
    expect(res.status).toBe(400);
    expect(captured).toBeNull();
  });

  it('500 när upserten failar', async () => {
    setSupabase({ upsertError: { message: 'boom' } });
    const res = await POST(req(NEW));
    expect(res.status).toBe(500);
  });
});

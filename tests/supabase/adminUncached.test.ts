import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseAdmin, getSupabaseAdminUncached } from '@/lib/supabase/server';

// Den ocachade klienten läser och sparar Fortnox-tokenen. Två cachar ger annars ett gammalt svar:
//   - Next 14:s datacache i en route med bara GET (eller bara PUT) som inte läser kakan → `cache: 'no-store'`;
//   - React/Next memoisering av GET under en rendering av en serverkomponent, som bortser från `cache` → en egen signal.
describe('getSupabaseAdminUncached', () => {
  let inits: RequestInit[] = [];

  beforeEach(() => {
    inits = [];
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:1');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        inits.push(init);
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('går förbi båda cacharna, för läsningar och skrivningar', async () => {
    const supabase = getSupabaseAdminUncached();
    await supabase.from('fortnox_integrations').select('*').eq('provider', 'fortnox').maybeSingle();
    await supabase.from('fortnox_integrations').update({ refresh_claimed_at: null }).eq('provider', 'fortnox').select('id');

    expect(inits).toHaveLength(2);
    for (const init of inits) {
      expect(init.cache).toBe('no-store');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal?.aborted).toBe(false);
    }
  });

  it('lämnar den vanliga klienten som den är', async () => {
    await getSupabaseAdmin().from('fortnox_integrations').select('refresh_token');
    expect(inits[0].cache).toBeUndefined();
    expect(inits[0].signal ?? undefined).toBeUndefined();
  });
});

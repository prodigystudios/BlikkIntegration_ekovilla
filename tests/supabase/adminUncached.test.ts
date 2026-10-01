import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseAdmin, getSupabaseAdminUncached } from '@/lib/supabase/server';

// Next 14 cachar fetch i en route med bara GET (eller bara PUT) som inte läser kakan — också supabase-js anrop. Den
// ocachade klienten måste säga `no-store` på VARJE anrop; Fortnox-tokenen läses och sparas med den.
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

  it('sätter no-store på läsningar och skrivningar', async () => {
    const supabase = getSupabaseAdminUncached();
    await supabase.from('fortnox_integrations').select('refresh_token').eq('provider', 'fortnox').maybeSingle();
    await supabase.from('fortnox_integrations').update({ refresh_token: 'x' }).eq('provider', 'fortnox').select('id');

    expect(inits).toHaveLength(2);
    expect(inits.map((i) => i.cache)).toEqual(['no-store', 'no-store']);
  });

  it('lämnar den vanliga klienten som den är', async () => {
    await getSupabaseAdmin().from('fortnox_integrations').select('refresh_token');
    expect(inits[0].cache).toBeUndefined();
  });
});

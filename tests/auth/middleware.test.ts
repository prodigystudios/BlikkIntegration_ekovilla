import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Middleware efter bytet till @supabase/ssr. Klienten mockas så att getSession() gör det riktiga
// klienten gör när token gått ut: skriver om kakorna via setAll, och svarar sedan med eller utan session.

const h = vi.hoisted(() => ({
  refreshed: [] as { name: string; value: string; options: Record<string, unknown> }[],
  session: null as null | { access_token: string },
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: any) => ({
    auth: {
      getSession: async () => {
        if (h.refreshed.length) options.cookies.setAll(h.refreshed);
        return { data: { session: h.session } };
      },
    },
  }),
}));

import { middleware } from '@/middleware';

const TOKEN = 'sb-test-auth-token';

function request(path: string) {
  return new NextRequest(`http://localhost${path}`, { headers: { cookie: `${TOKEN}=old` } });
}

describe('middleware och sessionskakorna', () => {
  beforeEach(() => {
    h.refreshed = [];
    h.session = null;
  });

  it('ger den förnyade kakan till webbläsaren OCH till sidan i samma request', async () => {
    h.refreshed = [{ name: TOKEN, value: 'base64-new', options: { path: '/' } }];
    h.session = { access_token: 'new' };
    const res = await middleware(request('/crm'));
    expect(res.cookies.get(TOKEN)?.value).toBe('base64-new');
    // Utan det här läser sidan fortfarande den gamla token och förnyar en gång till med samma
    // refresh-token — utanför Supabase återanvändningsfönster loggar det ut hela token-familjen.
    expect(res.headers.get('x-middleware-request-cookie')).toContain(`${TOKEN}=base64-new`);
  });

  // En kaka som inte går att läsa (t.ex. auth-helpers gamla format) rensas under getSession. Rensningen
  // måste följa med redirecten, annars ligger den trasiga kakan kvar och varje sidladdning börjar om.
  it('låter en rensad kaka följa med redirecten till inloggningen', async () => {
    h.refreshed = [{ name: TOKEN, value: '', options: { path: '/', maxAge: 0 } }];
    const res = await middleware(request('/crm'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/auth/sign-in');
    const cleared = res.cookies.get(TOKEN);
    expect(cleared?.value).toBe('');
    expect(cleared?.maxAge).toBe(0);
  });

  it('låter kakorna följa med 401-svaret på API:t', async () => {
    h.refreshed = [{ name: TOKEN, value: '', options: { path: '/', maxAge: 0 } }];
    const res = await middleware(request('/api/crm/customers'));
    expect(res.status).toBe(401);
    expect(res.cookies.get(TOKEN)?.maxAge).toBe(0);
  });

  it('låter kakorna följa med när en inloggad skickas bort från inloggningssidan', async () => {
    h.refreshed = [{ name: TOKEN, value: 'base64-new', options: { path: '/' } }];
    h.session = { access_token: 'new' };
    const res = await middleware(request('/auth/sign-in'));
    expect(res.status).toBe(307);
    expect(res.cookies.get(TOKEN)?.value).toBe('base64-new');
  });
});

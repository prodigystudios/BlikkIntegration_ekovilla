import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Spärren mot att koppla det RIKTIGA Fortnox-bolaget utanför produktion. Riskbilden: en lokal
// dev-server med påhittad data, men webbläsaren redan inloggad på Fortnox som det riktiga bolaget —
// en godkänd koppling hade skickat varje provad offert och faktura till Fortnox på riktigt.
// Lika viktigt: spärren får ALDRIG ändra prods beteende.

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/app/api/fortnox/_shared', () => ({
  requireCrmAdmin: vi.fn(),
  routeError: vi.fn((status: number, code: string) => new Response(code, { status })),
}));
vi.mock('@/lib/domains/fortnox/auth', () => ({
  buildFortnoxAuthUrl: vi.fn(() => 'https://apps.fortnox.se/oauth-v1/auth?client_id=x'),
  exchangeCodeForToken: vi.fn(),
  saveFortnoxIntegration: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

import { cookies } from 'next/headers';
import { requireCrmAdmin } from '@/app/api/fortnox/_shared';
import { exchangeCodeForToken, saveFortnoxIntegration } from '@/lib/domains/fortnox/auth';
import {
  assertFortnoxCompanyAllowed,
  fortnoxConnectPreflight,
  fortnoxConnectionPolicy,
  isFortnoxProductionRuntime,
  judgeFortnoxCompany,
  normalizeOrgNumber,
} from '@/lib/domains/fortnox/connectionGuard';
import { GET as callback } from '@/app/api/fortnox/auth/callback/route';
import { GET as initiate } from '@/app/api/fortnox/auth/route';

const TEST_COMPANY = '559341-9673';
const REAL_COMPANY = '556677-8899';
const PROD_DB = 'https://prodref.supabase.co';
const LOCAL_DB = 'http://127.0.0.1:55321';

const PROD = { NODE_ENV: 'production', VERCEL_ENV: 'production', SUPABASE_URL: PROD_DB };
const LOCAL_DEV = {
  NODE_ENV: 'development',
  SUPABASE_URL: LOCAL_DB,
  FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS: TEST_COMPANY,
};

function companyResponse(orgNumber: string | null) {
  return new Response(JSON.stringify({ CompanySettings: { Name: 'Bolag', OrganizationNumber: orgNumber } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('isFortnoxProductionRuntime', () => {
  it('är prod: produktionsbygge mot en hostad databas på Vercel production', () => {
    expect(isFortnoxProductionRuntime(PROD)).toBe(true);
  });

  it('är prod även om VERCEL_ENV saknas vid körning — prod får aldrig spärras av misstag', () => {
    expect(isFortnoxProductionRuntime({ NODE_ENV: 'production', SUPABASE_URL: PROD_DB })).toBe(true);
    expect(isFortnoxProductionRuntime({ NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: PROD_DB })).toBe(true);
  });

  it('är aldrig prod i next dev — inte ens när `vercel env pull` lagt VERCEL_ENV=production i .env.local', () => {
    expect(isFortnoxProductionRuntime({ NODE_ENV: 'development', VERCEL_ENV: 'production', SUPABASE_URL: PROD_DB })).toBe(false);
  });

  it('är inte prod mot en lokal databas, oavsett bygge', () => {
    expect(isFortnoxProductionRuntime({ NODE_ENV: 'production', VERCEL_ENV: 'production', SUPABASE_URL: LOCAL_DB })).toBe(false);
    expect(isFortnoxProductionRuntime({ NODE_ENV: 'production', SUPABASE_URL: 'http://localhost:55321' })).toBe(false);
  });

  it('är inte prod i en förhandsversion — de kör med NODE_ENV=production', () => {
    expect(isFortnoxProductionRuntime({ NODE_ENV: 'production', VERCEL_ENV: 'preview', SUPABASE_URL: PROD_DB })).toBe(false);
  });
});

describe('normalizeOrgNumber', () => {
  it('jämför bara siffror — bindestreck och mellanslag spelar ingen roll', () => {
    expect(normalizeOrgNumber('559341-9673')).toBe('5593419673');
    expect(normalizeOrgNumber(' 5593419673 ')).toBe('5593419673');
    expect(normalizeOrgNumber(null)).toBe('');
  });

  it('tolkar den sekelprefixade tolvställiga formen som samma bolag', () => {
    expect(normalizeOrgNumber('16559341-9673')).toBe('5593419673');
  });
});

describe('fortnoxConnectionPolicy', () => {
  it('prövar ingenting i produktion', () => {
    expect(fortnoxConnectionPolicy(PROD)).toEqual({ mode: 'any' });
  });

  it('kräver tillåtelselistan lokalt', () => {
    expect(fortnoxConnectionPolicy(LOCAL_DEV)).toEqual({ mode: 'allowlist', allowed: ['5593419673'] });
  });

  it('läser listan med komma, semikolon eller mellanslag och ignorerar tomma poster', () => {
    const policy = fortnoxConnectionPolicy({ ...LOCAL_DEV, FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS: ' 559341-9673 ; ,5560000000 5561111111' });
    expect(policy).toEqual({ mode: 'allowlist', allowed: ['5593419673', '5560000000', '5561111111'] });
  });
});

describe('judgeFortnoxCompany', () => {
  const allowlist = { mode: 'allowlist' as const, allowed: ['5593419673'] };

  it('godtar allt i produktion', () => {
    expect(judgeFortnoxCompany({ mode: 'any' }, REAL_COMPANY)).toEqual({ ok: true });
  });

  it('godtar testbolaget, med eller utan bindestreck', () => {
    expect(judgeFortnoxCompany(allowlist, TEST_COMPANY)).toEqual({ ok: true });
    expect(judgeFortnoxCompany(allowlist, '5593419673')).toEqual({ ok: true });
  });

  it('avvisar ett annat bolag och säger vilket', () => {
    const verdict = judgeFortnoxCompany(allowlist, REAL_COMPANY);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.message).toContain(REAL_COMPANY);
  });

  it('faller stängd: okänt organisationsnummer avvisas', () => {
    for (const org of [null, '']) {
      const verdict = judgeFortnoxCompany(allowlist, org);
      expect(!verdict.ok && verdict.message).toContain('Kunde inte läsa');
    }
  });

  it('faller stängd: utan tillåtelselista får inget bolag kopplas, inte ens testbolaget', () => {
    const verdict = judgeFortnoxCompany({ mode: 'allowlist', allowed: [] }, TEST_COMPANY);
    expect(!verdict.ok && verdict.message).toContain('FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS');
  });
});

describe('fortnoxConnectPreflight', () => {
  it('stoppar före Fortnox när listan saknas utanför prod', () => {
    const verdict = fortnoxConnectPreflight({ NODE_ENV: 'development', SUPABASE_URL: LOCAL_DB });
    expect(!verdict.ok && verdict.message).toContain('.env.development.local');
  });

  it('släpper igenom med lista, och alltid i prod', () => {
    expect(fortnoxConnectPreflight(LOCAL_DEV)).toEqual({ ok: true });
    expect(fortnoxConnectPreflight(PROD)).toEqual({ ok: true });
  });
});

describe('assertFortnoxCompanyAllowed', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('anropar inte Fortnox alls i produktion — prods beteende är oförändrat', async () => {
    await expect(assertFortnoxCompanyAllowed('token', PROD)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('frågar /settings/company med den NYA token, utan cache, och godtar testbolaget', async () => {
    fetchMock.mockResolvedValue(companyResponse(TEST_COMPANY));
    await expect(assertFortnoxCompanyAllowed('ny-token', LOCAL_DEV)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.fortnox.se/3/settings/company',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: 'Bearer ny-token' }),
      }),
    );
  });

  it('kastar för det riktiga bolaget', async () => {
    fetchMock.mockResolvedValue(companyResponse(REAL_COMPANY));
    await expect(assertFortnoxCompanyAllowed('token', LOCAL_DEV)).rejects.toThrow(REAL_COMPANY);
  });

  it('kastar "kunde inte läsa" när uppslaget misslyckas — ett fel är inget godkännande', async () => {
    fetchMock.mockResolvedValue(new Response('fel', { status: 500 }));
    await expect(assertFortnoxCompanyAllowed('token', LOCAL_DEV)).rejects.toThrow('Kunde inte läsa');

    fetchMock.mockRejectedValue(new Error('nätverket'));
    await expect(assertFortnoxCompanyAllowed('token', LOCAL_DEV)).rejects.toThrow('Kunde inte läsa');
  });

  it('frågar inte Fortnox när listan är tom — avslaget är ändå givet', async () => {
    await expect(
      assertFortnoxCompanyAllowed('token', { NODE_ENV: 'development', SUPABASE_URL: LOCAL_DB }),
    ).rejects.toThrow('FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function stubRuntime(env: Record<string, string>) {
  for (const key of ['NODE_ENV', 'VERCEL_ENV', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS']) {
    vi.stubEnv(key, env[key] ?? '');
  }
}

describe('OAuth-callbacken', () => {
  const fetchMock = vi.fn();
  const request = () => new Request('http://localhost:3000/api/fortnox/auth/callback?code=kod&state=st');

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(cookies).mockReturnValue({ get: () => ({ value: 'st' }), delete: vi.fn() } as never);
    vi.mocked(requireCrmAdmin).mockResolvedValue({ currentUser: { id: 'admin-1' } } as never);
    vi.mocked(exchangeCodeForToken).mockResolvedValue({
      access_token: 'ny-token',
      refresh_token: 'r',
      expires_in: 3600,
      scope: 's',
    } as never);
    vi.mocked(saveFortnoxIntegration).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sparar ALDRIG det riktiga bolagets tokens utanför produktion', async () => {
    stubRuntime(LOCAL_DEV);
    fetchMock.mockResolvedValue(companyResponse(REAL_COMPANY));

    const res = await callback(request());

    expect(saveFortnoxIntegration).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toContain('fortnox_error=');
    expect(res.headers.get('location')).not.toContain('fortnox_connected');
  });

  it('sparar ingenting när bolaget inte går att läsa', async () => {
    stubRuntime(LOCAL_DEV);
    fetchMock.mockResolvedValue(new Response('fel', { status: 500 }));

    const res = await callback(request());

    expect(saveFortnoxIntegration).not.toHaveBeenCalled();
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('Kunde inte läsa');
  });

  it('sparar testbolagets tokens utanför produktion', async () => {
    stubRuntime(LOCAL_DEV);
    fetchMock.mockResolvedValue(companyResponse(TEST_COMPANY));

    const res = await callback(request());

    expect(saveFortnoxIntegration).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'ny-token' }), 'admin-1');
    expect(res.headers.get('location')).toContain('fortnox_connected=1');
  });

  it('i produktion sparas kopplingen som förut, utan uppslag — även utan VERCEL_ENV', async () => {
    for (const env of [PROD, { NODE_ENV: 'production', SUPABASE_URL: PROD_DB }]) {
      stubRuntime(env);
      fetchMock.mockReset();
      vi.mocked(saveFortnoxIntegration).mockClear();

      const res = await callback(request());

      expect(fetchMock).not.toHaveBeenCalled();
      expect(saveFortnoxIntegration).toHaveBeenCalledTimes(1);
      expect(res.headers.get('location')).toContain('fortnox_connected=1');
    }
  });
});

describe('Starten av OAuth-flödet', () => {
  const request = () => new Request('http://localhost:3000/api/fortnox/auth');

  beforeEach(() => {
    vi.mocked(cookies).mockReturnValue({ set: vi.fn() } as never);
    vi.mocked(requireCrmAdmin).mockResolvedValue({ currentUser: { id: 'admin-1' } } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('skickar inte användaren till Fortnox utanför prod utan tillåtelselista', async () => {
    stubRuntime({ NODE_ENV: 'development', SUPABASE_URL: LOCAL_DB });

    const res = await initiate(request());
    const location = decodeURIComponent(res.headers.get('location') ?? '');

    expect(location).toContain('/crm/installningar?fortnox_error=');
    expect(location).not.toContain('fortnox.se');
  });

  it('skickar till Fortnox lokalt med lista, och i prod som förut', async () => {
    for (const env of [LOCAL_DEV, PROD]) {
      stubRuntime(env);
      const res = await initiate(request());
      expect(res.headers.get('location')).toContain('apps.fortnox.se');
    }
  });
});

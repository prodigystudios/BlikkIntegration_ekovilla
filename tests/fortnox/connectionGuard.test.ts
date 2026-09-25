import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Spärren mot att koppla det RIKTIGA Fortnox-bolaget utanför produktion. Riskbilden: en lokal
// dev-server med påhittad data, men webbläsaren redan inloggad på Fortnox som det riktiga bolaget —
// en godkänd koppling hade skickat varje provad offert och faktura till Fortnox på riktigt.

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/app/api/fortnox/_shared', () => ({ requireCrmAdmin: vi.fn() }));
vi.mock('@/lib/domains/fortnox/auth', () => ({
  exchangeCodeForToken: vi.fn(),
  saveFortnoxIntegration: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

import { cookies } from 'next/headers';
import { requireCrmAdmin } from '@/app/api/fortnox/_shared';
import { exchangeCodeForToken, saveFortnoxIntegration } from '@/lib/domains/fortnox/auth';
import {
  assertFortnoxCompanyAllowed,
  fortnoxConnectionPolicy,
  judgeFortnoxCompany,
  normalizeOrgNumber,
} from '@/lib/domains/fortnox/connectionGuard';
import { GET } from '@/app/api/fortnox/auth/callback/route';

const TEST_COMPANY = '559341-9673';
const REAL_COMPANY = '556677-8899';

function companyResponse(orgNumber: string | null) {
  return new Response(JSON.stringify({ CompanySettings: { Name: 'Bolag', OrganizationNumber: orgNumber } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('normalizeOrgNumber', () => {
  it('jämför bara siffror — bindestreck och mellanslag spelar ingen roll', () => {
    expect(normalizeOrgNumber('559341-9673')).toBe('5593419673');
    expect(normalizeOrgNumber(' 5593419673 ')).toBe('5593419673');
    expect(normalizeOrgNumber(null)).toBe('');
  });
});

describe('fortnoxConnectionPolicy', () => {
  it('prövar ingenting i produktion', () => {
    expect(fortnoxConnectionPolicy({ VERCEL_ENV: 'production' })).toEqual({ mode: 'any' });
  });

  it('kräver tillåtelselistan överallt annars — lokalt, i preview och i Vercels development', () => {
    for (const VERCEL_ENV of [undefined, 'preview', 'development']) {
      expect(fortnoxConnectionPolicy({ VERCEL_ENV, FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS: TEST_COMPANY })).toEqual({
        mode: 'allowlist',
        allowed: ['5593419673'],
      });
    }
  });

  it('NODE_ENV=production räcker INTE — förhandsversioner kör med det', () => {
    expect(fortnoxConnectionPolicy({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }).mode).toBe('allowlist');
  });

  it('läser en kommaseparerad lista och ignorerar tomma poster', () => {
    const policy = fortnoxConnectionPolicy({ FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS: ' 559341-9673 , ,5560000000' });
    expect(policy).toEqual({ mode: 'allowlist', allowed: ['5593419673', '5560000000'] });
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
    expect(judgeFortnoxCompany(allowlist, null).ok).toBe(false);
    expect(judgeFortnoxCompany(allowlist, '').ok).toBe(false);
  });

  it('faller stängd: utan tillåtelselista får inget bolag kopplas, inte ens testbolaget', () => {
    expect(judgeFortnoxCompany({ mode: 'allowlist', allowed: [] }, TEST_COMPANY).ok).toBe(false);
  });
});

describe('assertFortnoxCompanyAllowed', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('anropar inte Fortnox alls i produktion — prods beteende är oförändrat', async () => {
    await expect(assertFortnoxCompanyAllowed('token', { VERCEL_ENV: 'production' })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('frågar /settings/company med den NYA token och godtar testbolaget', async () => {
    fetchMock.mockResolvedValue(companyResponse(TEST_COMPANY));
    await expect(
      assertFortnoxCompanyAllowed('ny-token', { FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS: TEST_COMPANY }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.fortnox.se/3/settings/company',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer ny-token' }) }),
    );
  });

  it('kastar för det riktiga bolaget', async () => {
    fetchMock.mockResolvedValue(companyResponse(REAL_COMPANY));
    await expect(
      assertFortnoxCompanyAllowed('token', { FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS: TEST_COMPANY }),
    ).rejects.toThrow(REAL_COMPANY);
  });

  it('kastar när uppslaget misslyckas — ett fel är inget godkännande', async () => {
    fetchMock.mockResolvedValue(new Response('fel', { status: 500 }));
    await expect(
      assertFortnoxCompanyAllowed('token', { FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS: TEST_COMPANY }),
    ).rejects.toThrow();

    fetchMock.mockRejectedValue(new Error('nätverket'));
    await expect(
      assertFortnoxCompanyAllowed('token', { FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS: TEST_COMPANY }),
    ).rejects.toThrow();
  });
});

describe('OAuth-callbacken', () => {
  const fetchMock = vi.fn();
  const request = () => new Request('http://localhost:3000/api/fortnox/auth/callback?code=kod&state=st');

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
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
  });

  it('sparar ALDRIG det riktiga bolagets tokens utanför produktion', async () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS', TEST_COMPANY);
    fetchMock.mockResolvedValue(companyResponse(REAL_COMPANY));

    const res = await GET(request());

    expect(saveFortnoxIntegration).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toContain('fortnox_error=');
    expect(res.headers.get('location')).not.toContain('fortnox_connected');
  });

  it('sparar testbolagets tokens utanför produktion', async () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS', TEST_COMPANY);
    fetchMock.mockResolvedValue(companyResponse(TEST_COMPANY));

    const res = await GET(request());

    expect(saveFortnoxIntegration).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'ny-token' }), 'admin-1');
    expect(res.headers.get('location')).toContain('fortnox_connected=1');
  });

  it('i produktion sparas kopplingen som förut, utan uppslag', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS', '');

    const res = await GET(request());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(saveFortnoxIntegration).toHaveBeenCalledTimes(1);
    expect(res.headers.get('location')).toContain('fortnox_connected=1');
  });
});

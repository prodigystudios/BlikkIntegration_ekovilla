import { describe, it, expect } from 'vitest';
import { readPortalSecret, resolvePortalTarget } from '@/lib/domains/portal/config';

const SECRET = 'a'.repeat(64);

// Miljöerna som de ser ut vid körning.
const LOCAL = { NODE_ENV: 'development', SUPABASE_URL: 'http://127.0.0.1:55321', PORTAL_CRM_SHARED_SECRET: SECRET };
const PREVIEW = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'preview',
  SUPABASE_URL: 'https://testref.supabase.co',
  PORTAL_CRM_SHARED_SECRET: SECRET,
};
const PROD = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
  SUPABASE_URL: 'https://prodref.supabase.co',
  PORTAL_CRM_SHARED_SECRET: SECRET,
};

const PROD_PORTAL = 'https://partner.ekovilla.se';
const TEST_PORTAL = 'https://test.partner.ekovilla.se';

describe('readPortalSecret', () => {
  it('trimmar hemligheten och godtar den när den är lång nog', () => {
    expect(readPortalSecret({ PORTAL_CRM_SHARED_SECRET: `  ${SECRET}\n` })).toBe(SECRET);
  });

  it('ger null för en saknad, tom eller kort hemlighet — då är integrationen av', () => {
    expect(readPortalSecret({})).toBeNull();
    expect(readPortalSecret({ PORTAL_CRM_SHARED_SECRET: '' })).toBeNull();
    expect(readPortalSecret({ PORTAL_CRM_SHARED_SECRET: '   ' })).toBeNull();
    expect(readPortalSecret({ PORTAL_CRM_SHARED_SECRET: 'x'.repeat(31) })).toBeNull();
  });
});

describe('resolvePortalTarget', () => {
  it('är av utan hemlighet eller adress', () => {
    expect(resolvePortalTarget({ ...LOCAL, PORTAL_CRM_SHARED_SECRET: '' })).toMatchObject({ ok: false, reason: 'not_configured' });
    expect(resolvePortalTarget(LOCAL)).toMatchObject({ ok: false, reason: 'not_configured' });
  });

  it('nekar en ogiltig adress och http utanför den här datorn', () => {
    expect(resolvePortalTarget({ ...LOCAL, RESELLER_PORTAL_URL: 'inte en adress' })).toMatchObject({ reason: 'invalid_url' });
    expect(resolvePortalTarget({ ...PREVIEW, RESELLER_PORTAL_URL: 'http://test.partner.ekovilla.se' })).toMatchObject({
      reason: 'insecure_url',
    });
  });

  it('upprepar aldrig variabelns värde — har variablerna förväxlats står hemligheten där', () => {
    const swapped = resolvePortalTarget({ ...LOCAL, RESELLER_PORTAL_URL: SECRET });
    expect(swapped).toMatchObject({ ok: false, reason: 'invalid_url' });
    expect(JSON.stringify(swapped)).not.toContain(SECRET);
  });

  it('lämnar hemligheten med adressen, så att utskicket har en enda källa', () => {
    expect(resolvePortalTarget({ ...LOCAL, PORTAL_CRM_SHARED_SECRET: ` ${SECRET}\n`, RESELLER_PORTAL_URL: 'http://localhost:3001' })).toEqual({
      ok: true,
      baseUrl: 'http://localhost:3001',
      secret: SECRET,
    });
  });

  it('lokalt: den lokala portalen över http, eller portalens testmiljö', () => {
    expect(resolvePortalTarget({ ...LOCAL, RESELLER_PORTAL_URL: 'http://localhost:3001/' })).toMatchObject({
      ok: true,
      baseUrl: 'http://localhost:3001',
    });
    expect(resolvePortalTarget({ ...LOCAL, RESELLER_PORTAL_URL: 'http://127.0.0.1:3001' })).toMatchObject({ ok: true });
    expect(resolvePortalTarget({ ...LOCAL, RESELLER_PORTAL_URL: TEST_PORTAL })).toMatchObject({ ok: true, baseUrl: TEST_PORTAL });
  });

  it('testmiljön: portalens testmiljö', () => {
    expect(resolvePortalTarget({ ...PREVIEW, RESELLER_PORTAL_URL: TEST_PORTAL })).toMatchObject({ ok: true, baseUrl: TEST_PORTAL });
  });

  it('prod: bara prodportalen, och sökvägen i variabeln tas inte med', () => {
    expect(resolvePortalTarget({ ...PROD, RESELLER_PORTAL_URL: `${PROD_PORTAL}/api/ekovilla` })).toMatchObject({
      ok: true,
      baseUrl: PROD_PORTAL,
    });
    expect(resolvePortalTarget({ ...PROD, RESELLER_PORTAL_URL: 'https://PARTNER.ekovilla.se' })).toMatchObject({ ok: true });
    // Avslutande punkt är samma värd i DNS.
    expect(resolvePortalTarget({ ...PROD, RESELLER_PORTAL_URL: 'https://partner.ekovilla.se.' })).toMatchObject({
      ok: true,
      baseUrl: PROD_PORTAL,
    });
  });

  it('🧨 ingen miljö utom prod får skicka till prodportalen, i någon stavning', () => {
    for (const env of [LOCAL, PREVIEW]) {
      for (const url of [PROD_PORTAL, 'https://partner.ekovilla.se.', 'https://PARTNER.EKOVILLA.SE']) {
        expect(resolvePortalTarget({ ...env, RESELLER_PORTAL_URL: url })).toMatchObject({ ok: false, reason: 'wrong_environment' });
      }
    }
  });

  it('🧨 utanför prod: bara portalens testmiljö eller den här datorn, ingen annan värd', () => {
    for (const url of ['https://aterforsaljare-ekovilla.vercel.app', 'https://example.com', 'https://test.partner.ekovilla.se.example.com']) {
      expect(resolvePortalTarget({ ...PREVIEW, RESELLER_PORTAL_URL: url })).toMatchObject({ ok: false, reason: 'wrong_environment' });
    }
  });

  it('🧨 prod skickar inte till testportalen, localhost eller en liknande värd', () => {
    for (const url of [TEST_PORTAL, 'http://localhost:3001', 'https://partner.ekovilla.se.example.com']) {
      expect(resolvePortalTarget({ ...PROD, RESELLER_PORTAL_URL: url })).toMatchObject({ ok: false, reason: 'wrong_environment' });
    }
  });

  it('🧨 de tvetydiga fallen räknas INTE som prod: prodportalen nekas', () => {
    const ambiguous = [
      // Produktionsbygge utanför Vercel (`next start`, CI) mot en riktig databas.
      { NODE_ENV: 'production', SUPABASE_URL: 'https://prodref.supabase.co' },
      { NODE_ENV: 'production', VERCEL_ENV: 'development', SUPABASE_URL: 'https://prodref.supabase.co' },
      // `vercel env pull` lade VERCEL_ENV=production i .env.local, men det är `next dev`.
      { NODE_ENV: 'development', VERCEL_ENV: 'production', SUPABASE_URL: 'https://prodref.supabase.co' },
      // Prods variabler mot den lokala stacken, med bara den publika adressen satt.
      { NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321' },
    ];
    for (const env of ambiguous) {
      expect(resolvePortalTarget({ ...env, PORTAL_CRM_SHARED_SECRET: SECRET, RESELLER_PORTAL_URL: PROD_PORTAL })).toMatchObject({
        ok: false,
        reason: 'wrong_environment',
      });
      expect(resolvePortalTarget({ ...env, PORTAL_CRM_SHARED_SECRET: SECRET, RESELLER_PORTAL_URL: TEST_PORTAL })).toMatchObject({ ok: true });
    }
  });
});

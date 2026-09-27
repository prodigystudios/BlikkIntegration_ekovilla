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

  it('nekar en ogiltig adress och http utanför localhost', () => {
    expect(resolvePortalTarget({ ...LOCAL, RESELLER_PORTAL_URL: 'inte en adress' })).toMatchObject({ reason: 'invalid_url' });
    expect(resolvePortalTarget({ ...PREVIEW, RESELLER_PORTAL_URL: 'http://test.partner.ekovilla.se' })).toMatchObject({
      reason: 'insecure_url',
    });
  });

  it('lokalt: den lokala portalen över http', () => {
    expect(resolvePortalTarget({ ...LOCAL, RESELLER_PORTAL_URL: 'http://localhost:3001/' })).toEqual({
      ok: true,
      baseUrl: 'http://localhost:3001',
    });
  });

  it('testmiljön: portalens testmiljö', () => {
    expect(resolvePortalTarget({ ...PREVIEW, RESELLER_PORTAL_URL: 'https://test.partner.ekovilla.se' })).toEqual({
      ok: true,
      baseUrl: 'https://test.partner.ekovilla.se',
    });
  });

  it('prod: bara prodportalen, och sökvägen i variabeln tas inte med', () => {
    expect(resolvePortalTarget({ ...PROD, RESELLER_PORTAL_URL: 'https://partner.ekovilla.se/api/ekovilla' })).toEqual({
      ok: true,
      baseUrl: 'https://partner.ekovilla.se',
    });
    expect(resolvePortalTarget({ ...PROD, RESELLER_PORTAL_URL: 'https://PARTNER.ekovilla.se' })).toMatchObject({ ok: true });
  });

  it('🧨 ingen miljö utom prod får skicka till prodportalen', () => {
    for (const env of [LOCAL, PREVIEW]) {
      expect(resolvePortalTarget({ ...env, RESELLER_PORTAL_URL: 'https://partner.ekovilla.se' })).toMatchObject({
        ok: false,
        reason: 'wrong_environment',
      });
    }
    // En produktionsbyggd app mot en lokal databas (`next start` lokalt) är inte prod.
    expect(
      resolvePortalTarget({ ...PROD, SUPABASE_URL: 'http://127.0.0.1:55321', RESELLER_PORTAL_URL: 'https://partner.ekovilla.se' }),
    ).toMatchObject({ ok: false, reason: 'wrong_environment' });
  });

  it('🧨 prod skickar inte till testportalen, localhost eller en liknande värd', () => {
    for (const url of ['https://test.partner.ekovilla.se', 'http://localhost:3001', 'https://partner.ekovilla.se.example.com']) {
      expect(resolvePortalTarget({ ...PROD, RESELLER_PORTAL_URL: url })).toMatchObject({ ok: false, reason: 'wrong_environment' });
    }
  });
});

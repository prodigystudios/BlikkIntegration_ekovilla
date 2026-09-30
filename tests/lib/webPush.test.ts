import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// sendWebPush mot en mockad web-push. Ingen push lämnar testet.
//
// Det som vaktas är spärren (RESELLER_PORTAL_CRM_PLAN.md T1): utanför prod skickas ingen push alls,
// oavsett nycklar, och i prod är beteendet som förut.

const { sendNotification, setVapidDetails } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));
vi.mock('web-push', () => ({ default: { sendNotification, setVapidDetails } }));

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/hemlig-enhetsnyckel',
  keys: { p256dh: 'p', auth: 'a' },
};
const payload = { title: 'Ny beställning från Norrbygg', body: 'B-1001', url: '/' };

// Nycklarna läses när modulen laddas, så modulen laddas om efter att miljön satts.
async function loadWebPush() {
  vi.resetModules();
  return import('@/lib/webPush');
}

beforeEach(() => {
  sendNotification.mockReset();
  setVapidDetails.mockClear();
  sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  vi.stubEnv('PUSH_VAPID_PUBLIC_KEY', 'pub');
  vi.stubEnv('PUSH_VAPID_PRIVATE_KEY', 'priv');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('utanför prod', () => {
  it('i en förhandsversion skickas ingen push, också med nycklar; bara tjänsten och rubriken loggas', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('SUPABASE_URL', 'https://testref.supabase.co');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sendWebPush, isWebPushConfigured } = await loadWebPush();
    await expect(sendWebPush(subscription, payload)).resolves.toEqual({ skipped: true });
    expect(sendNotification).not.toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('fcm.googleapis.com');
    expect(logged).toContain('Norrbygg');
    expect(logged).not.toContain('hemlig-enhetsnyckel');
    // Enheter kan fortfarande prenumerera i testmiljön.
    expect(isWebPushConfigured()).toBe(true);
  });

  it('lokalt skickas ingen push, också med prods VERCEL_ENV och databas', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SUPABASE_URL', 'https://prodref.supabase.co');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sendWebPush } = await loadWebPush();
    await expect(sendWebPush(subscription, payload)).resolves.toEqual({ skipped: true });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('saknade nycklar ger skipped, inget kast', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('PUSH_VAPID_PRIVATE_KEY', '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sendWebPush } = await loadWebPush();
    await expect(sendWebPush(subscription, payload)).resolves.toEqual({ skipped: true });
  });
});

describe('i prod', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SUPABASE_URL', 'https://prodref.supabase.co');
  });

  it('skickar pushen med innehållet som JSON', async () => {
    const { sendWebPush } = await loadWebPush();
    await expect(sendWebPush(subscription, payload)).resolves.toEqual({ skipped: false });
    expect(sendNotification).toHaveBeenCalledWith(subscription, JSON.stringify(payload));
  });

  it('ett fel från pushtjänsten kastas vidare, så att anroparen kan rensa döda enheter', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('Gone'), { statusCode: 410 }));
    const { sendWebPush } = await loadWebPush();
    await expect(sendWebPush(subscription, payload)).rejects.toMatchObject({ statusCode: 410 });
  });

  it('kastar när nycklarna saknas', async () => {
    vi.stubEnv('PUSH_VAPID_PRIVATE_KEY', '');
    const { sendWebPush } = await loadWebPush();
    await expect(sendWebPush(subscription, payload)).rejects.toThrow('Push VAPID keys are not configured');
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

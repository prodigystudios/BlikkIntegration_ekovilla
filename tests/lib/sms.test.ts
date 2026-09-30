import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// sendSms mot en mockad Twilio. Inget sms lämnar testet.
//
// Det som vaktas är spärren (RESELLER_PORTAL_CRM_PLAN.md T1): utanför prod skickas inget sms alls,
// oavsett nycklar, och i prod är beteendet som förut.

const { create, twilioFactory } = vi.hoisted(() => {
  const create = vi.fn();
  const twilioFactory = vi.fn(() => ({ messages: { create } }));
  return { create, twilioFactory };
});
vi.mock('twilio', () => ({ default: twilioFactory }));

import { sendSms } from '@/lib/sms';

const args = { to: '+46701234567', body: 'Hej! Vi kommer måndag 6/10.' };

function stubProduction() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('SUPABASE_URL', 'https://prodref.supabase.co');
}

beforeEach(() => {
  create.mockReset();
  twilioFactory.mockClear();
  create.mockResolvedValue({ sid: 'SM123', status: 'accepted', to: args.to });
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test');
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'token');
  vi.stubEnv('TWILIO_MESSAGING_SERVICE_SID', 'MG_test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('utanför prod', () => {
  it('i en förhandsversion skickas inget, också med nycklar; mottagaren och texten loggas', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('SUPABASE_URL', 'https://testref.supabase.co');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sendSms(args)).resolves.toEqual({ sid: null, status: null, to: args.to, skipped: true });
    expect(twilioFactory).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain(args.to);
    expect(logged).toContain('måndag 6/10');
  });

  it('lokalt skickas inget, också med prods VERCEL_ENV och databas', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SUPABASE_URL', 'https://prodref.supabase.co');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sendSms(args)).resolves.toMatchObject({ skipped: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('saknade nycklar ger skipped, inget kast', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('TWILIO_ACCOUNT_SID', '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sendSms(args)).resolves.toMatchObject({ skipped: true });
  });
});

describe('i prod', () => {
  beforeEach(() => {
    stubProduction();
  });

  it('skickar via Twilio och ger Twilios id', async () => {
    await expect(sendSms(args)).resolves.toEqual({ sid: 'SM123', status: 'accepted', to: args.to, skipped: false });
    expect(create).toHaveBeenCalledWith({
      to: args.to,
      body: args.body,
      messagingServiceSid: 'MG_test',
      statusCallback: undefined,
    });
  });

  it('kastar när nycklarna saknas', async () => {
    vi.stubEnv('TWILIO_AUTH_TOKEN', '');
    await expect(sendSms(args)).rejects.toThrow('SMS not configured');
    expect(create).not.toHaveBeenCalled();
  });
});

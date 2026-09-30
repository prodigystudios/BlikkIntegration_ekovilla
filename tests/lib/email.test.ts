import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// sendEmail mot en mockad Resend. Inget mail lämnar testet.
//
// Det som vaktas är det beställningsmailet vilar på: att idempotensnyckeln faktiskt når SDK:n (annars
// blir varje nytt försök efter ett nätverksfel ett andra lass säckar), att ett överhoppat utskick inte
// ser ut som ett skickat, och att Resends felnamn överlever så att ett definitivt avslag går att skilja
// från ett oklart utfall.

const { send, ResendCtor } = vi.hoisted(() => {
  const send = vi.fn();
  // `function`, inte en pil: koden gör `new Resend(...)`, och en pilfunktion går inte att konstruera.
  const ResendCtor = vi.fn(function () {
    return { emails: { send } };
  });
  return { send, ResendCtor };
});
vi.mock('resend', () => ({ Resend: ResendCtor }));

import { sendEmail, EmailSendError, parseMailAllowlist, splitByAllowlist } from '@/lib/email';

const base = { to: 'fabriken@example.com', subject: 'Beställning #14', text: 'Hej' };

/** Prods driftsättning enligt `isProductionDeployment` (lib/env.ts): alla tre krävs. */
function stubProduction() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('SUPABASE_URL', 'https://prodref.supabase.co');
}

/** En förhandsversion i Vercel, som testmiljön: NODE_ENV är production även där. */
function stubPreview() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('SUPABASE_URL', 'https://testref.supabase.co');
}

// Testerna utanför `utanför prod` prövar prods väg, så miljön är prods tills ett test säger annat.
beforeEach(() => {
  send.mockReset();
  ResendCtor.mockClear();
  send.mockResolvedValue({ data: { id: 'email_123' }, error: null });
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('MAIL_FROM', 'no-reply@example.com');
  vi.stubEnv('NONPROD_MAIL_ALLOWLIST', '');
  stubProduction();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('idempotensnyckeln', () => {
  it('skickas vidare till SDK:n som request-option', async () => {
    await sendEmail(base, { idempotencyKey: 'material-order/abc/1' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: 'material-order/abc/1' });
  });

  it('utelämnas helt utan nyckel — befintliga anropare skickar som förut', async () => {
    await sendEmail(base);
    expect(send.mock.calls[0][1]).toBeUndefined();
  });

  it('hamnar inte i mailets innehåll', async () => {
    await sendEmail(base, { idempotencyKey: 'material-order/abc/1' });
    expect(JSON.stringify(send.mock.calls[0][0])).not.toContain('material-order/abc/1');
  });
});

describe('bcc', () => {
  it('skickas med, trimmad', async () => {
    await sendEmail({ ...base, bcc: [' order@example.com ', ''] });
    expect(send.mock.calls[0][0].bcc).toEqual(['order@example.com']);
  });

  it('en ensam sträng blir en lista', async () => {
    await sendEmail({ ...base, bcc: 'order@example.com' });
    expect(send.mock.calls[0][0].bcc).toEqual(['order@example.com']);
  });

  it('utelämnas när den saknas eller bara är tomma värden', async () => {
    await sendEmail(base);
    await sendEmail({ ...base, bcc: ['  '] });
    expect(send.mock.calls[0][0].bcc).toBeUndefined();
    expect(send.mock.calls[1][0].bcc).toBeUndefined();
  });
});

describe('svaret', () => {
  it('ger Resends id vid lyckat utskick', async () => {
    await expect(sendEmail(base)).resolves.toEqual({ id: 'email_123', skipped: false });
  });

  it('ett fel kastar EmailSendError med Resends felnamn och meddelande oförändrade', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'Invalid `to` field' } });
    const err = await sendEmail(base).catch((e) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('validation_error');
    expect(err.message).toBe('Invalid `to` field');
  });

  it('HTTP-koden följer med när felkroppen bär den', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', message: 'Too many', statusCode: 429 } });
    const err = await sendEmail(base).catch((e) => e);
    expect(err.statusCode).toBe(429);
  });

  it('ett felsvar utan namn blir unknown_error — aldrig ett lyckat utskick', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'Bad gateway' } });
    const err = await sendEmail(base).catch((e) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.code).toBe('unknown_error');
    expect(err.statusCode).toBeNull();
  });

  /**
   * SDK:n svarar { data: null, error: null } på ett felsvar vars kropp är JSON null. Det får inte se ut som
   * ett mottaget mail: id saknas, och skipped är false — anroparen ska läsa det som oklart.
   */
  it('ett svar utan id ger id null och skipped false', async () => {
    send.mockResolvedValue({ data: null, error: null });
    await expect(sendEmail(base)).resolves.toEqual({ id: null, skipped: false });
  });

  /** Nätverksfel och 5xx kommer från SDK:n som application_error — koden måste överleva oförändrad. */
  it('application_error bärs igenom, så anroparen kan behandla det som oklart', async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: 'application_error', message: 'Unable to fetch data. The request could not be resolved.' },
    });
    const err = await sendEmail(base).catch((e) => e);
    expect(err.code).toBe('application_error');
  });
});

describe('utan konfiguration', () => {
  it('utanför produktion: hoppar över, säger det, och rör inte Resend', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sendEmail(base, { idempotencyKey: 'k' })).resolves.toEqual({ id: null, skipped: true });
    expect(ResendCtor).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  /** NODE_ENV är production också i Vercels förhandsversioner. Där kastade det förut. */
  it('i en förhandsversion: hoppar över i stället för att kasta', async () => {
    stubPreview();
    vi.stubEnv('RESEND_API_KEY', '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sendEmail(base)).resolves.toEqual({ id: null, skipped: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('i produktion: kastar i stället för att tyst låta bli', async () => {
    vi.stubEnv('MAIL_FROM', '');
    const err = await sendEmail(base).catch((e) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.code).toBe('not_configured');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('utanför prod: bara mottagare i NONPROD_MAIL_ALLOWLIST', () => {
  beforeEach(() => {
    stubPreview();
  });

  it('en mottagare utanför listan får inget mail, och det loggas', async () => {
    vi.stubEnv('NONPROD_MAIL_ALLOWLIST', 'william@example.com');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sendEmail(base, { idempotencyKey: 'k' })).resolves.toEqual({ id: null, skipped: true });
    expect(ResendCtor).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).toContain('fabriken@example.com');
  });

  it('en tom lista släpper inte igenom någon', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sendEmail(base)).resolves.toEqual({ id: null, skipped: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('en mottagare i listan får mailet, oavsett versaler och visningsnamn', async () => {
    vi.stubEnv('NONPROD_MAIL_ALLOWLIST', ' William@Example.com ');
    await expect(sendEmail({ ...base, to: 'William Ali <william@EXAMPLE.com>' })).resolves.toEqual({
      id: 'email_123',
      skipped: false,
    });
    expect(send.mock.calls[0][0].to).toEqual(['William Ali <william@EXAMPLE.com>']);
  });

  it('bara de tillåtna i to och bcc får mailet; resten loggas', async () => {
    vi.stubEnv('NONPROD_MAIL_ALLOWLIST', 'a@example.com, b@example.com');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sendEmail({ ...base, to: ['a@example.com', 'kund@example.com'], bcc: ['b@example.com', 'order@example.com'] });
    expect(send.mock.calls[0][0].to).toEqual(['a@example.com']);
    expect(send.mock.calls[0][0].bcc).toEqual(['b@example.com']);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('kund@example.com');
    expect(logged).toContain('order@example.com');
  });

  it('bcc tas bort helt när ingen i den är tillåten', async () => {
    vi.stubEnv('NONPROD_MAIL_ALLOWLIST', 'a@example.com');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sendEmail({ ...base, to: 'a@example.com', bcc: 'order@example.com' });
    expect(send.mock.calls[0][0].bcc).toBeUndefined();
  });

  /** Resend kräver en mottagare i `to`; en tillåten bcc ensam blir inget mail. */
  it('ingen tillåten i to: inget skickas, också när bcc är tillåten', async () => {
    vi.stubEnv('NONPROD_MAIL_ALLOWLIST', 'b@example.com');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sendEmail({ ...base, bcc: 'b@example.com' })).resolves.toEqual({ id: null, skipped: true });
    expect(send).not.toHaveBeenCalled();
  });

  /** `vercel env pull` lägger VERCEL_ENV=production i .env.local, men `next dev` är inte prod. */
  it('lokalt med prods VERCEL_ENV gäller spärren ändå', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SUPABASE_URL', 'https://prodref.supabase.co');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sendEmail(base)).resolves.toEqual({ id: null, skipped: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('i prod gäller listan inte: alla mottagare får mailet, också med en lista satt', async () => {
    stubProduction();
    vi.stubEnv('NONPROD_MAIL_ALLOWLIST', 'a@example.com');
    await sendEmail({ ...base, to: ['a@example.com', 'kund@example.com'], bcc: 'order@example.com' });
    expect(send.mock.calls[0][0].to).toEqual(['a@example.com', 'kund@example.com']);
    expect(send.mock.calls[0][0].bcc).toEqual(['order@example.com']);
  });
});

describe('parseMailAllowlist och splitByAllowlist', () => {
  it('delar på komma, semikolon och blanksteg och jämför adressen med gemener', () => {
    const list = parseMailAllowlist(' A@example.com,b@example.com;\nc@example.com  ');
    expect([...list]).toEqual(['a@example.com', 'b@example.com', 'c@example.com']);
  });

  it('en tom eller saknad lista är tom', () => {
    expect(parseMailAllowlist('').size).toBe(0);
    expect(parseMailAllowlist(undefined).size).toBe(0);
    expect(parseMailAllowlist(' , ; ').size).toBe(0);
  });

  it('en domän eller en del av en adress släpper inte igenom något', () => {
    const list = parseMailAllowlist('example.com, @example.com, a@example');
    expect(splitByAllowlist(['a@example.com'], list)).toEqual({ allowed: [], blocked: ['a@example.com'] });
  });

  it('en mottagare med flera adresser spärras, också när den sista är tillåten', () => {
    const list = parseMailAllowlist('a@example.com');
    for (const recipient of ['kund@riktig.se, Anna <a@example.com>', 'kund@riktig.se;a@example.com', 'a@example.com <a@example.com>']) {
      expect(splitByAllowlist([recipient], list)).toEqual({ allowed: [], blocked: [recipient] });
    }
  });

  it('behåller mottagaren som den skrevs', () => {
    const list = parseMailAllowlist('a@example.com');
    expect(splitByAllowlist(['Anna <A@Example.com>', 'kund@example.com'], list)).toEqual({
      allowed: ['Anna <A@Example.com>'],
      blocked: ['kund@example.com'],
    });
  });
});

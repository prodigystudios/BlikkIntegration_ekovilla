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

import { sendEmail, EmailSendError } from '@/lib/email';

const base = { to: 'fabriken@example.com', subject: 'Beställning #14', text: 'Hej' };

beforeEach(() => {
  send.mockReset();
  ResendCtor.mockClear();
  send.mockResolvedValue({ data: { id: 'email_123' }, error: null });
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('MAIL_FROM', 'no-reply@example.com');
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
    // Pinnad: annars beror testet på vilken NODE_ENV sviten råkar köras under.
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sendEmail(base, { idempotencyKey: 'k' })).resolves.toEqual({ id: null, skipped: true });
    expect(ResendCtor).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('i produktion: kastar i stället för att tyst låta bli', async () => {
    vi.stubEnv('MAIL_FROM', '');
    vi.stubEnv('NODE_ENV', 'production');
    const err = await sendEmail(base).catch((e) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.code).toBe('not_configured');
    expect(send).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Utskicket av en materialbeställning. Databasens regler (claim/finalize/release) är provkörda i Postgres för
// sig; det som prövas HÄR är att koden anropar dem i rätt ordning och ALDRIG åt fel håll:
//
// 🧨 inget utskick när spärren är på · samma nyckel inom ett försök · ett oklart utfall släpps aldrig till ett
//    nytt försök och registreras aldrig som skickat · det LAGRADE mailet skickas, inget omrenderat.

vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email')>();
  return { ...actual, sendEmail: vi.fn() };
});
vi.mock('@/lib/domains/planning/materialOrdersStore', () => ({
  getOrder: vi.fn(),
  claimSend: vi.fn(),
  finalizeSend: vi.fn(),
  releaseSend: vi.fn(),
  resolveSend: vi.fn(),
  recordSendError: vi.fn(async () => {}),
}));
vi.mock('@/lib/domains/planning/materialOrdersService', () => ({
  composeFromRegistry: vi.fn(),
  draftInputOf: vi.fn(() => ({ lines: [], other_lines: [], message: null })),
  warningsForOrder: vi.fn(async () => []),
}));

import { EmailSendError, sendEmail } from '@/lib/email';
import { claimSend, finalizeSend, getOrder, recordSendError, releaseSend } from '@/lib/domains/planning/materialOrdersStore';
import { composeFromRegistry, warningsForOrder } from '@/lib/domains/planning/materialOrdersService';
import { MIN_SEND_WINDOW_MS, REQUEST_BUDGET_MS, SEND_TIMEOUT_MS, sendMaterialOrder } from '@/lib/domains/planning/materialOrdersSend';
import { warningsFingerprint } from '@/lib/domains/planning/materialOrders';

const LIVE = { VERCEL_ENV: 'production', MATERIAL_ORDER_SEND_ENABLED: 'true' };
const STORED = {
  recipient_email: 'fabrik@example.fi',
  email_subject: 'Materialbeställning #14 från Ekovilla – leverans senast torsdag 1 oktober',
  email_text: 'Hej Pekka,\n\n...LAGRAD TEXT...',
  email_language: 'sv' as const,
  from_address: 'Ekovilla <order@ekovilla.se>',
  reply_to: 'order@ekovilla.se',
  bcc: 'order@ekovilla.se',
};
const ORDER = {
  id: 'order-1',
  order_no: 14,
  supplier_id: 'sup-1',
  status: 'draft',
  revision: 3,
  send_attempt: 1,
  lines: [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 216, requested_on: '2026-10-01' }, { depot_id: 'd2', material: 'EKOVILLA', sacks: 108, requested_on: '2026-10-01' }],
  other_lines: [],
  message: null,
  composed_by_name: 'William',
  supplier_name: 'Ekovilla Oy',
  ...STORED,
};
const deps = (env: Record<string, string> = LIVE) => ({
  supabase: { __client: 'session' } as never,
  env,
  today: '2026-09-17',
  actor: { id: 'u1', name: 'William' },
});
const input = { orderId: 'order-1', revision: 3, attempt: 1, acknowledgedWarnings: null as string | null };

beforeEach(() => {
  vi.clearAllMocks();
  (getOrder as any).mockResolvedValue({ data: { ...ORDER }, error: null });
  (composeFromRegistry as any).mockResolvedValue({ ok: true, composed: { ...STORED }, supplier: { active: true, lead_time_days: 7 } });
  (warningsForOrder as any).mockResolvedValue([]);
  (claimSend as any).mockResolvedValue({ data: 'claimed', error: null });
  (sendEmail as any).mockResolvedValue({ id: 'email_abc', skipped: false });
  (finalizeSend as any).mockResolvedValue({ data: 2, error: null });
  (releaseSend as any).mockResolvedValue({ data: 'released', error: null });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('spärren', () => {
  it.each([[{}], [{ VERCEL_ENV: 'preview', MATERIAL_ORDER_SEND_ENABLED: 'true' }], [{ VERCEL_ENV: 'production' }]])(
    'blockerat (%o): ingen läsning, inget claim, inget mail',
    async (env) => {
      const r = await sendMaterialOrder(deps(env as Record<string, string>), input);
      expect(r.kind).toBe('blocked');
      expect(getOrder).not.toHaveBeenCalled();
      expect(claimSend).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    },
  );
});

describe('ett utkast kontrolleras före claim', () => {
  it('fel revision: konflikt, inget claim', async () => {
    const r = await sendMaterialOrder(deps(), { ...input, revision: 2 });
    expect(r).toMatchObject({ kind: 'conflict', code: 'revision_changed' });
    expect(claimSend).not.toHaveBeenCalled();
  });

  /** Ändrad adress, mall eller depåadress sedan granskningen: mailet ingen sett får inte gå. */
  it('registret säger något annat än det lagrade mailet: granska igen, inget claim', async () => {
    (composeFromRegistry as any).mockResolvedValue({
      ok: true,
      composed: { ...STORED, recipient_email: 'ny-adress@example.fi' },
      supplier: { active: true, lead_time_days: 7 },
    });
    const r = await sendMaterialOrder(deps(), input);
    expect(r).toMatchObject({ kind: 'conflict', code: 'needs_review' });
    expect(claimSend).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('underlaget håller inte längre (t.ex. passerat datum): granska igen', async () => {
    (composeFromRegistry as any).mockResolvedValue({ ok: false, failure: { kind: 'invalid', lineProblems: [{ kind: 'date_in_past' }], templateProblems: [] } });
    expect((await sendMaterialOrder(deps(), input)).kind).toBe('conflict');
    expect(claimSend).not.toHaveBeenCalled();
  });

  it('en inaktiv leverantör skickas inte', async () => {
    (composeFromRegistry as any).mockResolvedValue({ ok: true, composed: { ...STORED }, supplier: { active: false, lead_time_days: 7 } });
    expect((await sendMaterialOrder(deps(), input)).kind).toBe('conflict');
    expect(claimSend).not.toHaveBeenCalled();
  });

  it('okvitterade varningar: inget claim, och de aktuella varningarna med sitt avtryck tillbaka', async () => {
    (warningsForOrder as any).mockResolvedValue([{ kind: 'lead_time_zero' }]);
    const r = await sendMaterialOrder(deps(), input);
    expect(r).toMatchObject({ kind: 'acknowledge_required', fingerprint: warningsFingerprint([{ kind: 'lead_time_zero' }]) });
    expect(claimSend).not.toHaveBeenCalled();
  });

  it('kvitterade varningar (samma avtryck): skickas', async () => {
    const warnings = [{ kind: 'lead_time_zero' }, { kind: 'unknown_pallet_size', material: 'PAROC' }];
    (warningsForOrder as any).mockResolvedValue(warnings);
    // Ordningen spelar ingen roll för avtrycket.
    const fp = warningsFingerprint([...warnings].reverse() as never);
    expect((await sendMaterialOrder(deps(), { ...input, acknowledgedWarnings: fp })).kind).toBe('sent');
  });

  /**
   * 🧨 GRANSKNINGSFYNDET. En kvittering av "okänd pallstorlek" får inte godkänna en varning om ett lass som
   * bokades in efter granskningen — det hade blivit två lass.
   */
  it('en NY varning efter kvitteringen: inget claim', async () => {
    const seen = [{ kind: 'unknown_pallet_size', material: 'PAROC' }];
    (warningsForOrder as any).mockResolvedValue([...seen, { kind: 'open_inflow', depot_name: 'Syd', material: 'PAROC', sacks: 87, next_arrival: '2026-09-20' }]);
    const r = await sendMaterialOrder(deps(), { ...input, acknowledgedWarnings: warningsFingerprint(seen as never) });
    expect(r.kind).toBe('acknowledge_required');
    expect(claimSend).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('lyckat utskick', () => {
  it('skickar det LAGRADE mailet med försökets nyckel och registrerar med Resends id', async () => {
    const r = await sendMaterialOrder(deps(), input);
    expect(r).toEqual({ kind: 'sent', order_no: 14, created: 2, expected: 2 });
    expect(claimSend).toHaveBeenCalledWith(expect.anything(), 'order-1', 3, 1);
    const [args, options] = (sendEmail as any).mock.calls[0];
    expect(args).toEqual({
      to: STORED.recipient_email,
      from: STORED.from_address,
      replyTo: STORED.reply_to,
      bcc: STORED.bcc,
      subject: STORED.email_subject,
      text: STORED.email_text,
    });
    expect(options).toEqual({ idempotencyKey: 'material-order/order-1/1' });
    expect(finalizeSend).toHaveBeenCalledWith(expect.anything(), 'order-1', 'email_abc');
    expect(releaseSend).not.toHaveBeenCalled();
  });

  /**
   * Ett omförsök av ett pågående utskick: inga kontroller mot registret (bytes är frysta och MÅSTE vara samma),
   * samma nyckel. Här står det lagrade mailet medvetet i konflikt med registret — det får inte hindra omförsöket.
   */
  it('omförsök av ett pågående utskick: samma bytes och samma nyckel, utan registerkontroll', async () => {
    (getOrder as any).mockResolvedValue({ data: { ...ORDER, status: 'sending' }, error: null });
    (claimSend as any).mockResolvedValue({ data: 'reclaimed', error: null });
    (composeFromRegistry as any).mockResolvedValue({ ok: true, composed: { ...STORED, email_text: 'ANNAN' }, supplier: { active: false } });
    const r = await sendMaterialOrder(deps(), input);
    expect(r.kind).toBe('sent');
    expect(composeFromRegistry).not.toHaveBeenCalled();
    expect((sendEmail as any).mock.calls[0][1]).toEqual({ idempotencyKey: 'material-order/order-1/1' });
    expect((sendEmail as any).mock.calls[0][0].text).toBe(STORED.email_text);
  });

  it('en redan skickad order skickas inte igen', async () => {
    (getOrder as any).mockResolvedValue({ data: { ...ORDER, status: 'sent' }, error: null });
    expect((await sendMaterialOrder(deps(), input)).kind).toBe('already_sent');
    expect(claimSend).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('claim säger nej', () => {
  it.each(['in_progress', 'revision_changed', 'attempt_changed', 'window_expired', 'not_reviewed', 'lines_invalid'])(
    '%s: konflikt, inget mail',
    async (answer) => {
      (claimSend as any).mockResolvedValue({ data: answer, error: null });
      const r = await sendMaterialOrder(deps(), input);
      expect(r).toMatchObject({ kind: 'conflict', code: answer });
      expect(sendEmail).not.toHaveBeenCalled();
    },
  );
});

describe('Resend svarar med ett fel', () => {
  it('ett bevisat avslag på ett försök som aldrig skickats om: släpps till utkast', async () => {
    (sendEmail as any).mockRejectedValue(new EmailSendError('validation_error', 'Invalid `to`'));
    const r = await sendMaterialOrder(deps(), input);
    expect(r).toMatchObject({ kind: 'rejected', code: 'validation_error', attempt: 2 });
    expect(releaseSend).toHaveBeenCalledWith(expect.anything(), 'order-1', 1, 'validation_error', 'Invalid `to`');
    expect(finalizeSend).not.toHaveBeenCalled();
  });

  /** 🧨 Databasen svarar 'retried': ett avslag på ett omförsök bevisar inget om det första anropet. */
  it('ett avslag som databasen inte vill släppa (retried) är OKLART, inte avvisat', async () => {
    (sendEmail as any).mockRejectedValue(new EmailSendError('rate_limit_exceeded', 'Too many'));
    (releaseSend as any).mockResolvedValue({ data: 'retried', error: null });
    const r = await sendMaterialOrder(deps(), input);
    expect(r.kind).toBe('unknown');
    expect(recordSendError).toHaveBeenCalled();
    expect(finalizeSend).not.toHaveBeenCalled();
  });

  it.each(['application_error', 'internal_server_error', 'invalid_idempotent_request', 'concurrent_idempotent_requests', 'unknown_error'])(
    '%s är oklart: aldrig release, aldrig finalize',
    async (code) => {
      (sendEmail as any).mockRejectedValue(new EmailSendError(code, 'x'));
      const r = await sendMaterialOrder(deps(), input);
      expect(r.kind).toBe('unknown');
      expect(releaseSend).not.toHaveBeenCalled();
      expect(finalizeSend).not.toHaveBeenCalled();
      expect(recordSendError).toHaveBeenCalledWith(expect.anything(), 'order-1', 1, code, 'x');
    },
  );

  it('ett annat undantag (inte från Resend) är också oklart', async () => {
    (sendEmail as any).mockRejectedValue(new TypeError('boom'));
    expect((await sendMaterialOrder(deps(), input)).kind).toBe('unknown');
    expect(releaseSend).not.toHaveBeenCalled();
  });
});

describe('Resend svarar inte som väntat', () => {
  it(`inget svar inom ${SEND_TIMEOUT_MS} ms: oklart`, async () => {
    vi.useFakeTimers();
    (sendEmail as any).mockReturnValue(new Promise(() => {}));
    const pending = sendMaterialOrder(deps(), input);
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 10);
    const r = await pending;
    expect(r.kind).toBe('unknown');
    expect(finalizeSend).not.toHaveBeenCalled();
    expect(releaseSend).not.toHaveBeenCalled();
    expect(recordSendError).toHaveBeenCalledWith(expect.anything(), 'order-1', 1, 'timeout', expect.any(String));
  });

  it('svar utan id: oklart, aldrig finalize', async () => {
    (sendEmail as any).mockResolvedValue({ id: null, skipped: false });
    expect((await sendMaterialOrder(deps(), input)).kind).toBe('unknown');
    expect(finalizeSend).not.toHaveBeenCalled();
  });

  it('överhoppat (mail ej konfigurerat) på ett försök som aldrig skickats om: släpps', async () => {
    (sendEmail as any).mockResolvedValue({ id: null, skipped: true });
    expect((await sendMaterialOrder(deps(), input)).kind).toBe('rejected');
    expect(releaseSend).toHaveBeenCalled();
    expect(finalizeSend).not.toHaveBeenCalled();
  });

  it('överhoppat på ett omförsök (retried): oklart', async () => {
    (sendEmail as any).mockResolvedValue({ id: null, skipped: true });
    (releaseSend as any).mockResolvedValue({ data: 'retried', error: null });
    expect((await sendMaterialOrder(deps(), input)).kind).toBe('unknown');
  });

  /** Mailet gick, men registreringen föll. "Försök igen" får samma id från Resend — inget nytt mail. */
  it('finalize felar: oklart med rådet att försöka igen', async () => {
    (finalizeSend as any).mockResolvedValue({ data: null, error: { message: 'db down' } });
    const r = await sendMaterialOrder(deps(), input);
    expect(r.kind).toBe('unknown');
    expect(r.kind === 'unknown' && r.message).toMatch(/inget nytt mail/);
    expect(releaseSend).not.toHaveBeenCalled();
  });
});

describe('tidsbudgeten', () => {
  it('Resends tak ryms i routens maxDuration', async () => {
    const { maxDuration } = await import('@/app/api/crm/planering/material-orders/[id]/send/route');
    expect(SEND_TIMEOUT_MS).toBeLessThan(REQUEST_BUDGET_MS);
    expect(REQUEST_BUDGET_MS).toBeLessThan(maxDuration * 1000);
  });

  it('räcker inte tiden efter kontrollerna tas inget utskick', async () => {
    let t = 0;
    (warningsForOrder as any).mockImplementation(async () => {
      t = REQUEST_BUDGET_MS - MIN_SEND_WINDOW_MS + 1;
      return [];
    });
    const r = await sendMaterialOrder({ ...deps(), now: () => t }, input);
    expect(r).toMatchObject({ kind: 'conflict', code: 'slow_checks' });
    expect(claimSend).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('ett oklart svar säger när man kan försöka igen', async () => {
    (sendEmail as any).mockRejectedValue(new EmailSendError('application_error', 'x'));
    const r = await sendMaterialOrder(deps(), input);
    expect(r).toMatchObject({ kind: 'unknown', retry_after_seconds: 120 });
  });
});

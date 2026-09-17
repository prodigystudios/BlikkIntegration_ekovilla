type SendEmailArgs = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string | string[];
  bcc?: string | string[];
};

export type SendEmailOptions = {
  /**
   * Skickas som Resends `Idempotency-Key`. Samma nyckel inom 24 timmar ger INTE ett andra mail, utan
   * samma svar som första gången.
   *
   * 🧨 Utan nyckel är varje nytt försök ett nytt mail. För ett utskick där ett andra exemplar kostar
   * något — en materialbeställning blir två lass säckar — är ett nätverksfel annars omöjligt att
   * försöka igen på säkert: man vet inte om det första gick fram. Bygg nyckeln av det som gör
   * utskicket unikt (t.ex. `material-order/<id>/<försök>`), aldrig av en tidsstämpel.
   */
  idempotencyKey?: string;
};

export type SendEmailResult = {
  /** Resends id för mailet, eller null när inget skickades (skipped) eller svaret saknade id. */
  id: string | null;
  /**
   * true när utskicket HOPPADES ÖVER för att RESEND_API_KEY/MAIL_FROM saknas utanför produktion.
   *
   * ⚠️ Ett överhoppat utskick får aldrig räknas som skickat. Anropare som bokför ett utskick måste
   * fråga efter det här fältet — att funktionen inte kastade betyder inte att något gick iväg.
   */
  skipped: boolean;
};

/**
 * Resend svarade med ett fel. `code` är Resends egna felnamn, oförändrat (t.ex. `validation_error`,
 * `rate_limit_exceeded`, `application_error`), så att anroparen kan skilja ett definitivt avslag från
 * ett oklart utfall.
 *
 * ⚠️ `application_error` är OKLART, inte ett avslag: SDK:n använder samma namn för nätverksfel, 5xx och
 * svar som inte gick att tolka. Mailet kan ha gått iväg.
 *
 * Ärver Error med samma meddelande som förut, så befintliga anropare som läser `e.message` påverkas inte.
 */
export class EmailSendError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'EmailSendError';
    this.code = code;
  }
}

function env(name: string): string {
  return (process.env[name] || '').trim();
}

function addressList(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const list = (Array.isArray(value) ? value : [value]).map((item) => String(item).trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/**
 * Skicka ett mail via Resend.
 *
 * 🧨 SKICKAR PÅ RIKTIGT I VARJE MILJÖ DÄR RESEND_API_KEY OCH MAIL_FROM FINNS — också lokalt (.env.local
 * har dem) och i Vercels preview. Bara när de saknas utanför produktion loggar funktionen och returnerar
 * `skipped: true`. En lokal QA av ett mailflöde kan alltså nå riktiga mottagare.
 */
export async function sendEmail(args: SendEmailArgs, options: SendEmailOptions = {}): Promise<SendEmailResult> {
  const apiKey = env('RESEND_API_KEY');
  const from = (args.from || env('MAIL_FROM')).trim();

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === 'production') {
      throw new EmailSendError('not_configured', 'Email not configured (need RESEND_API_KEY and MAIL_FROM)');
    }
    console.warn('[email] Skipping send (missing RESEND_API_KEY/MAIL_FROM)', {
      hasKey: !!apiKey,
      from,
      to: args.to,
      subject: args.subject,
    });
    return { id: null, skipped: true };
  }

  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);

  const to = Array.isArray(args.to) ? args.to : [args.to];
  const replyTo = args.replyTo
    ? (Array.isArray(args.replyTo) ? args.replyTo : [args.replyTo]).map((item) => String(item).trim()).filter(Boolean)
    : undefined;
  const bcc = addressList(args.bcc);
  const html = args.html || undefined;
  const text = typeof args.text === 'string' ? args.text : '';

  const res = await resend.emails.send(
    {
      from,
      to,
      replyTo,
      bcc,
      subject: args.subject,
      html,
      text,
    },
    options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
  );

  if (res.error) {
    throw new EmailSendError(res.error.name || 'unknown_error', res.error.message || 'Unknown email error');
  }
  return { id: res.data?.id ?? null, skipped: false };
}

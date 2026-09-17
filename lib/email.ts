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
   * Skickas som Resends `Idempotency-Key`. Samma nyckel med SAMMA innehåll inom 24 timmar ger inte ett
   * andra mail, utan samma svar som första gången.
   *
   * 🧨 Utan nyckel är varje nytt försök ett nytt mail. För ett utskick där ett andra exemplar kostar
   * något — en materialbeställning blir två lass säckar — är ett nätverksfel annars omöjligt att
   * försöka igen på säkert: man vet inte om det första gick fram.
   *
   * ⚠️ En återanvänd nyckel kan också ge 409, och BÅDA betyder att ett mail kan ha gått iväg:
   * - `invalid_idempotent_request` — samma nyckel men ANNAT innehåll. Rendera därför mailet en gång,
   *   lagra det och skicka det lagrade byte för byte vid varje nytt försök. Ett omrenderat mail (en
   *   tidsstämpel, ett ändrat namn) är ett annat innehåll.
   * - `concurrent_idempotent_requests` — det första anropet med nyckeln pågår fortfarande.
   * Behandla aldrig ett 409 som "avvisat, skicka igen".
   *
   * Bygg nyckeln av det som gör utskicket unikt (t.ex. `material-order/<id>/<försök>`), där försöket står
   * STILL genom alla omförsök av samma utskick och bara räknas upp när ett utskick bevisligen inte gick
   * iväg. Aldrig en tidsstämpel. Bara tecken upp till U+00FF — annat kastar SDK:n när headern byggs.
   */
  idempotencyKey?: string;
};

export type SendEmailResult = {
  /**
   * Resends id för mailet, eller null när inget skickades (skipped) eller svaret saknade id.
   *
   * ⚠️ `id === null && !skipped` är OKLART, inte skickat: SDK:n kan svara `{ data: null, error: null }`
   * på ett felsvar vars kropp är JSON `null`. Räkna ett utskick som mottaget bara när id finns.
   */
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
 * Resend svarade med ett fel. `code` är Resends egna felnamn, oförändrat, och `statusCode` HTTP-koden när
 * svaret bar en.
 *
 * ⚠️ ETT FEL ÄR OKLART TILLS MOTSATSEN ÄR VISAD. Klassificera med en FAST LISTA över koder som bevisligen
 * betyder "inget skickades" (t.ex. `validation_error`, `missing_required_field`, `invalid_from_address`)
 * och behandla allt annat som att mailet kan ha gått iväg. Oklart är bland annat:
 * - `application_error` — SDK:n använder den för nätverksfel, HTML-felsidor och svar som inte gick att
 *   tolka, också ett 200 som Resend faktiskt tog emot.
 * - `internal_server_error`, `service_unavailable` och andra namn en 5xx kan bära.
 * - `unknown_error` — ett felsvar utan namn, t.ex. från en gateway.
 * - 409-koderna för idempotens, se SendEmailOptions.
 *
 * Fel som INTE är EmailSendError (misslyckad import av SDK:n, en nyckel med tecken över U+00FF) kastas
 * innan något skickats.
 *
 * Ärver Error med samma meddelande som förut, så befintliga anropare som läser `e.message` påverkas inte.
 */
export class EmailSendError extends Error {
  readonly code: string;
  readonly statusCode: number | null;
  constructor(code: string, message: string, statusCode: number | null = null) {
    super(message);
    this.name = 'EmailSendError';
    this.code = code;
    this.statusCode = statusCode;
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
    // statusCode finns i Resends felkropp men inte i SDK:ns typ.
    const statusCode = (res.error as { statusCode?: unknown }).statusCode;
    throw new EmailSendError(
      res.error.name || 'unknown_error',
      res.error.message || 'Unknown email error',
      typeof statusCode === 'number' ? statusCode : null,
    );
  }
  return { id: res.data?.id ?? null, skipped: false };
}

import { isProductionDeployment } from '@/lib/env';

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
   * true när utskicket HOPPADES ÖVER utanför prod: RESEND_API_KEY/MAIL_FROM saknas, eller ingen
   * mottagare i `to` står i NONPROD_MAIL_ALLOWLIST (se `sendEmail`).
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

/** Själva adressen, med gemener: `Namn <a@b.se>` och ` A@B.se ` blir båda `a@b.se`. */
function bareAddress(value: string): string {
  const angled = /<([^<>]*)>\s*$/.exec(value);
  return (angled ? angled[1] : value).trim().toLowerCase();
}

/**
 * NONPROD_MAIL_ALLOWLIST: hela adresser, separerade med komma, semikolon eller blanksteg. Tom = ingen
 * adress är tillåten, och inget mail lämnar miljön.
 */
export function parseMailAllowlist(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw || '')
      .split(/[\s,;]+/)
      .map(bareAddress)
      .filter(Boolean),
  );
}

/**
 * Dela mottagarna i dem som står i listan och de andra. Jämförelsen gäller bara adressen, utan
 * hänsyn till versaler eller ett visningsnamn; det som skickas är mottagaren som den skrevs.
 */
export function splitByAllowlist(
  recipients: string[] | undefined,
  allowlist: ReadonlySet<string>,
): { allowed: string[]; blocked: string[] } {
  const allowed: string[] = [];
  const blocked: string[] = [];
  for (const recipient of recipients ?? []) {
    (allowlist.has(bareAddress(recipient)) ? allowed : blocked).push(recipient);
  }
  return { allowed, blocked };
}

/**
 * Skicka ett mail via Resend.
 *
 * Utanför prod (`isProductionDeployment`, lib/env.ts — lokalt, Vercels förhandsversioner, testmiljön)
 * går mailet bara till mottagare i NONPROD_MAIL_ALLOWLIST. De andra tas bort ur `to` och `bcc` och
 * loggas; blir ingen i `to` kvar skickas inget och svaret är `skipped: true`. Saknade nycklar ger också
 * `skipped: true` där. I prod skickas till alla, och saknade nycklar kastar.
 *
 * ⚠️ Alla anropare frågar inte efter `skipped` — planeringens bekräftelser och kundnotisen bokför ett
 * utskick som inte kastade som skickat. Utanför prod kan det alltså stå "skickat" för ett mail som bara
 * loggades.
 */
export async function sendEmail(args: SendEmailArgs, options: SendEmailOptions = {}): Promise<SendEmailResult> {
  const production = isProductionDeployment(process.env);
  const apiKey = env('RESEND_API_KEY');
  const from = (args.from || env('MAIL_FROM')).trim();

  if (!apiKey || !from) {
    if (production) {
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

  let to = Array.isArray(args.to) ? args.to : [args.to];
  let bcc = addressList(args.bcc);

  if (!production) {
    const allowlist = parseMailAllowlist(process.env.NONPROD_MAIL_ALLOWLIST);
    const toSplit = splitByAllowlist(to, allowlist);
    const bccSplit = splitByAllowlist(bcc, allowlist);
    const blocked = [...toSplit.blocked, ...bccSplit.blocked];
    if (blocked.length > 0) {
      console.warn('[email] Utanför prod: skickas inte till mottagare utanför NONPROD_MAIL_ALLOWLIST', {
        blocked,
        subject: args.subject,
      });
    }
    if (toSplit.allowed.length === 0) return { id: null, skipped: true };
    to = toSplit.allowed;
    bcc = bccSplit.allowed.length > 0 ? bccSplit.allowed : undefined;
  }

  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);

  const replyTo = args.replyTo
    ? (Array.isArray(args.replyTo) ? args.replyTo : [args.replyTo]).map((item) => String(item).trim()).filter(Boolean)
    : undefined;
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

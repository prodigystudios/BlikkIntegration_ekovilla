import { isProductionDeployment } from '@/lib/env';

export type SendSmsArgs = {
  to: string;
  body: string;
  messagingServiceSid?: string;
  statusCallback?: string;
};

export type SendSmsResult = {
  /** Twilios id, eller null när inget skickades (skipped). */
  sid: string | null;
  status: string | null;
  to: string;
  /**
   * true när sms:et bara loggades: utanför prod skickas inget sms, se `sendSms`.
   *
   * ⚠️ Ett överhoppat sms får aldrig räknas som skickat. Anropare som bokför ett utskick måste fråga
   * efter det här fältet.
   */
  skipped: boolean;
};

function env(name: string): string {
  return (process.env[name] || '').trim();
}

/**
 * Skicka ett sms via Twilio.
 *
 * Utanför prod (`isProductionDeployment`, lib/env.ts — lokalt, Vercels förhandsversioner, testmiljön)
 * skickas INGET sms, oavsett nycklar: mottagaren och texten loggas och svaret är `skipped: true`. Det
 * finns ingen lista över tillåtna nummer, eftersom sms:en går till kunder och montörer. I prod kastar
 * saknade nycklar.
 *
 * ⚠️ Alla anropare frågar inte efter `skipped` — planeringens bekräftelser, kundnotisen och
 * tidpåminnelsen bokför ett sms som inte kastade som skickat. Utanför prod kan det alltså stå
 * "skickat" för ett sms som bara loggades.
 */
export async function sendSms(args: SendSmsArgs): Promise<SendSmsResult> {
  if (!isProductionDeployment(process.env)) {
    console.warn('[sms] Utanför prod: sms:et skickas inte', { to: args.to, body: args.body });
    return { sid: null, status: null, to: args.to, skipped: true };
  }

  const accountSid = env('TWILIO_ACCOUNT_SID');
  const authToken = env('TWILIO_AUTH_TOKEN');
  const messagingServiceSid = (args.messagingServiceSid || env('TWILIO_MESSAGING_SERVICE_SID')).trim();
  const statusCallback = (args.statusCallback || env('TWILIO_STATUS_CALLBACK_URL')).trim();

  if (!accountSid || !authToken || !messagingServiceSid) {
    throw new Error('SMS not configured (need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID)');
  }

  const twilioModule = await import('twilio');
  const twilio = twilioModule.default;
  const client = twilio(accountSid, authToken);

  const message = await client.messages.create({
    to: args.to,
    body: args.body,
    messagingServiceSid,
    statusCallback: statusCallback || undefined,
  });

  return {
    sid: message.sid,
    status: message.status || null,
    to: message.to || args.to,
    skipped: false,
  };
}

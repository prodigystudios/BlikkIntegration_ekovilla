import webpush, { PushSubscription } from 'web-push';
import { isProductionDeployment } from '@/lib/env';

const publicKey = (process.env.PUSH_VAPID_PUBLIC_KEY || '').trim();
const privateKey = (process.env.PUSH_VAPID_PRIVATE_KEY || '').trim();
const subject = (process.env.PUSH_VAPID_SUBJECT || 'mailto:admin@example.com').trim();

let configured = false;

function ensureConfigured() {
  if (configured) return;
  if (!publicKey || !privateKey) {
    throw new Error('Push VAPID keys are not configured. Set PUSH_VAPID_PUBLIC_KEY and PUSH_VAPID_PRIVATE_KEY.');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export function isWebPushConfigured() {
  return Boolean(publicKey && privateKey);
}

export function getWebPushPublicKey() {
  return publicKey;
}

/**
 * Skicka en push till en enhet.
 *
 * Utanför prod (`isProductionDeployment`, lib/env.ts — lokalt, Vercels förhandsversioner, testmiljön)
 * skickas INGEN push, oavsett nycklar: rubriken och mottagartjänsten loggas och svaret är
 * `skipped: true`. Enheter kan fortfarande prenumerera där (`isWebPushConfigured` ändras inte), så
 * testmiljön kan ha egna VAPID-nycklar.
 *
 * ⚠️ Anroparna frågar inte efter `skipped` och bokför en push som inte kastade som lyckad
 * (`last_success_at`, påminnelsens `reminder_sent_at`). Utanför prod stämmer de alltså inte.
 */
export async function sendWebPush(
  subscription: PushSubscription,
  payload: Record<string, unknown>,
): Promise<{ skipped: boolean }> {
  if (!isProductionDeployment(process.env)) {
    // Bara pushtjänstens värdnamn: hela endpoint-adressen identifierar enheten hos tjänsten.
    let service = 'okänd';
    try {
      service = new URL(subscription.endpoint).hostname;
    } catch {}
    console.warn('[push] Utanför prod: pushen skickas inte', { service, title: payload.title });
    return { skipped: true };
  }
  ensureConfigured();
  await webpush.sendNotification(subscription, JSON.stringify(payload));
  return { skipped: false };
}

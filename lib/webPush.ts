import webpush, { PushSubscription } from 'web-push';

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

export async function sendWebPush(
  subscription: PushSubscription,
  payload: Record<string, unknown>,
) {
  ensureConfigured();
  return webpush.sendNotification(subscription, JSON.stringify(payload));
}
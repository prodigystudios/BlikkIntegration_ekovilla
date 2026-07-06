"use client";

import { useCallback, useEffect, useState } from 'react';

// Shared web-push opt-in for the current device. Wraps the existing /api/push endpoints and the
// service worker registered app-wide in app/register-sw.tsx. Used by the notification bell so any
// user can enable phone notifications without going to the dashboard notes card.
//
// Per-device: each browser/PWA install registers its own subscription. iOS requires an installed
// PWA (16.4+). No subscription → the bell still works, there's just no push.
export type PushSubscriptionState = {
  supported: boolean;
  enabled: boolean;
  permission: NotificationPermission;
  loading: boolean;
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};

export function usePushSubscription(): PushSubscriptionState {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reflect the device's current state: support, OS permission, and whether a subscription exists.
  const sync = useCallback(async () => {
    const isSupported =
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof window !== 'undefined' &&
      'PushManager' in window &&
      'Notification' in window;
    setSupported(isSupported);
    if (!isSupported) return;
    setPermission(Notification.permission);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setEnabled(Boolean(subscription));
    } catch {
      setEnabled(false);
    }
  }, []);

  useEffect(() => { void sync(); }, [sync]);

  const enable = useCallback(async () => {
    if (!supported) {
      setError('Den här enheten stöder inte pushnotiser.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const registrationPromise = navigator.serviceWorker
        .getRegistration('/sw.js')
        .then((registration) => registration || navigator.serviceWorker.ready);

      const keyRes = await fetch('/api/push/public-key');
      const keyJson = await keyRes.json().catch(() => null);
      if (!keyRes.ok) throw new Error(keyJson?.error || 'Kunde inte läsa push-nyckel.');
      const publicKey = String(keyJson?.publicKey || '');
      if (!publicKey) throw new Error('Push är inte konfigurerat.');

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        throw new Error('Notiser måste tillåtas för att de ska nå den här enheten.');
      }

      const registration = await registrationPromise;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(publicKey),
        });
      }

      const saveRes = await fetch('/api/push/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON(), userAgent: navigator.userAgent }),
      });
      const saveJson = await saveRes.json().catch(() => null);
      if (!saveRes.ok) throw new Error(saveJson?.error || 'Kunde inte aktivera notiser.');

      setEnabled(true);
    } catch (e: any) {
      setEnabled(false);
      setError(String(e?.message || e || 'Kunde inte aktivera notiser.'));
    } finally {
      setLoading(false);
    }
  }, [supported]);

  const disable = useCallback(async () => {
    if (!supported) return;
    setLoading(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push/subscription', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setEnabled(false);
    } catch (e: any) {
      setError(String(e?.message || e || 'Kunde inte stänga av notiser.'));
    } finally {
      setLoading(false);
    }
  }, [supported]);

  return { supported, enabled, permission, loading, error, enable, disable };
}

// VAPID public key (URL-safe base64) → Uint8Array for pushManager.subscribe.
function base64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  decidePushSync,
  readFlag,
  shouldPersistEndpoint,
  writeFlag,
  PUSH_OPT_OUT_KEY,
  PUSH_PROMPT_DISMISSED_KEY,
  type PushPermission,
  type StorageLike,
} from '@/lib/domains/notifications/pushSync';

// Shared web-push opt-in for the current device. Wraps the existing /api/push endpoints and the
// service worker registered app-wide inline in app/layout.tsx. Used by the notification bell so any
// user can enable phone notifications without going to the dashboard notes card.
//
// Per-device: each browser/PWA install registers its own subscription. iOS requires an installed
// PWA (16.4+). No subscription → the bell still works, there's just no push.
//
// Efter domänbytet till app.ekovilla.se bär hooken också återaktiveringen. Prenumeration,
// service worker OCH Notification.permission är alla origin-scopade, så den som hade notiser på
// blikk-integration-ekovilla.vercel.app står som obeslutad här. Grenvalet ligger i
// lib/domains/notifications/pushSync.ts.
export type PushSubscriptionState = {
  supported: boolean;
  enabled: boolean;
  permission: NotificationPermission;
  loading: boolean;
  error: string | null;
  /** Notiser är varken på eller aktivt bortvalda här, och uppmaningen är inte avfärdad. */
  needsReactivation: boolean;
  /** Avfärda uppmaningen. Sparas lokalt så den inte återkommer vid varje inloggning. */
  dismissReactivation: () => void;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};

// Storage kan saknas helt (SSR) eller kasta vid åtkomst (vissa privatlägen kastar redan på
// `window.localStorage`). Båda fallen ska ge null, inte ett kastat fel.
function safeStorage(kind: 'local' | 'session'): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

async function postSubscription(subscription: PushSubscription): Promise<Response> {
  return fetch('/api/push/subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: subscription.toJSON(), userAgent: navigator.userAgent }),
  });
}

export function usePushSubscription(): PushSubscriptionState {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReactivation, setNeedsReactivation] = useState(false);

  // Reflect the device's current state — and act on it. Fyra utfall, se pushSync.ts.
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

    let subscription: PushSubscription | null = null;
    try {
      const registration = await navigator.serviceWorker.ready;
      subscription = await registration.pushManager.getSubscription();
    } catch {
      setEnabled(false);
      return;
    }

    setEnabled(Boolean(subscription));

    const action = decidePushSync({
      hasSubscription: Boolean(subscription),
      permission: Notification.permission as PushPermission,
      optedOut: readFlag(safeStorage('local'), PUSH_OPT_OUT_KEY),
      promptDismissed: readFlag(safeStorage('local'), PUSH_PROMPT_DISMISSED_KEY),
    });

    if (action === 'persist' && subscription) {
      setNeedsReactivation(false);
      if (shouldPersistEndpoint(safeStorage('session'), subscription.endpoint)) {
        await postSubscription(subscription).catch(() => null);
      }
      return;
    }

    if (action === 'resubscribe-silently') {
      setNeedsReactivation(false);
      try {
        const keyRes = await fetch('/api/push/public-key');
        const keyJson = await keyRes.json().catch(() => null);
        const publicKey = String(keyJson?.publicKey || '');
        if (!keyRes.ok || !publicKey) return;
        const registration = await navigator.serviceWorker.ready;
        const fresh = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(publicKey),
        });
        const saveRes = await postSubscription(fresh);
        if (saveRes.ok) setEnabled(true);
      } catch {
        // Tyst med flit: det här är en bakgrundsåtgärd användaren inte bett om, och den som
        // behöver notiser kan alltid slå på dem från notisklockan.
      }
      return;
    }

    setNeedsReactivation(action === 'prompt');
  }, []);

  useEffect(() => { void sync(); }, [sync]);

  const dismissReactivation = useCallback(() => {
    writeFlag(safeStorage('local'), PUSH_PROMPT_DISMISSED_KEY, true);
    setNeedsReactivation(false);
  }, []);

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

      const saveRes = await postSubscription(subscription);
      const saveJson = await saveRes.json().catch(() => null);
      if (!saveRes.ok) throw new Error(saveJson?.error || 'Kunde inte aktivera notiser.');

      // Ett aktivt ja rensar både av-valet och ett tidigare avfärdande, så att en framtida
      // avaktivering kan uppmana igen.
      writeFlag(safeStorage('local'), PUSH_OPT_OUT_KEY, false);
      writeFlag(safeStorage('local'), PUSH_PROMPT_DISMISSED_KEY, false);
      setNeedsReactivation(false);
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
      // Minns av-valet. Utan det ser nästa synk "tillstånd beviljat, ingen prenumeration" och
      // skulle tyst prenumerera om — alltså slå på det användaren just stängde av.
      writeFlag(safeStorage('local'), PUSH_OPT_OUT_KEY, true);
      setNeedsReactivation(false);
      setEnabled(false);
    } catch (e: any) {
      setError(String(e?.message || e || 'Kunde inte stänga av notiser.'));
    } finally {
      setLoading(false);
    }
  }, [supported]);

  return {
    supported,
    enabled,
    permission,
    loading,
    error,
    needsReactivation,
    dismissReactivation,
    enable,
    disable,
  };
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

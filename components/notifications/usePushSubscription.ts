"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  browserStorage,
  decidePushSync,
  markEndpointPersisted,
  readFlag,
  shouldPersistEndpoint,
  writeFlag,
  PUSH_HAD_SUBSCRIPTION_KEY,
  PUSH_OPT_OUT_KEY,
  PUSH_PROMPT_DISMISSED_KEY,
  type PushPermission,
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

// Notisklockan är monterad TVÅ gånger samtidigt (mobil topprad + desktopskena, båda monterade och
// CSS-dolda — se NotificationBell.tsx), och uppmaningen i dashboarden är en tredje. Sedan synken
// började skriva räcker det inte att den är idempotent: tre samtidiga pushManager.subscribe() kan
// avvisas med InvalidStateError. Spärren ligger på modulnivå och delas därför av alla instanser.
let silentResubscribeInFlight = false;

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
      optedOut: readFlag(browserStorage('local'), PUSH_OPT_OUT_KEY),
      promptDismissed: readFlag(browserStorage('local'), PUSH_PROMPT_DISMISSED_KEY),
      hadSubscription: readFlag(browserStorage('local'), PUSH_HAD_SUBSCRIPTION_KEY),
    });

    if (action === 'persist' && subscription) {
      setNeedsReactivation(false);
      // Att vi ser en prenumeration ÄR beviset markören står för.
      writeFlag(browserStorage('local'), PUSH_HAD_SUBSCRIPTION_KEY, true);
      if (shouldPersistEndpoint(browserStorage('session'), subscription.endpoint)) {
        const res = await postSubscription(subscription).catch(() => null);
        // Kvittera först på ok. Ett 401 vid montering (utgången session) ska inte göra att
        // stämplingen hoppas över resten av sessionen.
        if (res?.ok) markEndpointPersisted(browserStorage('session'), subscription.endpoint);
      }
      return;
    }

    if (action === 'resubscribe-silently') {
      setNeedsReactivation(false);
      if (silentResubscribeInFlight) return;
      silentResubscribeInFlight = true;
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
        if (saveRes.ok) {
          markEndpointPersisted(browserStorage('session'), fresh.endpoint);
          setEnabled(true);
        }
      } catch {
        // Tyst med flit: det här är en bakgrundsåtgärd användaren inte bett om, och den som
        // behöver notiser kan alltid slå på dem från notisklockan.
      } finally {
        silentResubscribeInFlight = false;
      }
      return;
    }

    setNeedsReactivation(action === 'prompt');
  }, []);

  useEffect(() => { void sync(); }, [sync]);

  const dismissReactivation = useCallback(() => {
    writeFlag(browserStorage('local'), PUSH_PROMPT_DISMISSED_KEY, true);
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

      // Nyckeln hämtas parallellt men väntas INTE in före requestPermission(). iOS/Safari ger
      // bara en kortlivad user activation, och ett await däremellan kan äta upp den — då avvisas
      // prompten eller subscribe() kastar NotAllowedError. Installatörerna kör iOS-PWA, så det är
      // just den vägen som bär migreringen.
      const keyPromise = (async () => {
        const keyRes = await fetch('/api/push/public-key');
        const keyJson = await keyRes.json().catch(() => null);
        if (!keyRes.ok) throw new Error(keyJson?.error || 'Kunde inte läsa push-nyckel.');
        const key = String(keyJson?.publicKey || '');
        if (!key) throw new Error('Push är inte konfigurerat.');
        return key;
      })();
      // Utan detta blir ett fel i hämtningen en obehandlad rejection om prompten avbryts först.
      keyPromise.catch(() => {});

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        throw new Error('Notiser måste tillåtas för att de ska nå den här enheten.');
      }

      const publicKey = await keyPromise;
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
      writeFlag(browserStorage('local'), PUSH_OPT_OUT_KEY, false);
      writeFlag(browserStorage('local'), PUSH_PROMPT_DISMISSED_KEY, false);
      writeFlag(browserStorage('local'), PUSH_HAD_SUBSCRIPTION_KEY, true);
      markEndpointPersisted(browserStorage('session'), subscription.endpoint);
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
        const delRes = await fetch('/api/push/subscription', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!delRes.ok) throw new Error('Kunde inte stänga av notiser. Försök igen.');
        // unsubscribe() KASTAR INTE vid misslyckande — den resolvar false. Utan kontrollen hade vi
        // skrivit av-valet och visat "avstängt" med prenumerationen kvar i webbläsaren, och nästa
        // synk hade POST:at om den och återuppväckt raden vi just raderade.
        const removed = await subscription.unsubscribe();
        if (!removed) throw new Error('Notiserna kunde inte stängas av i webbläsaren. Försök igen.');
      }
      // Minns av-valet. Utan det ser nästa synk "tillstånd beviljat, ingen prenumeration" och
      // skulle tyst prenumerera om — alltså slå på det användaren just stängde av.
      writeFlag(browserStorage('local'), PUSH_OPT_OUT_KEY, true);
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

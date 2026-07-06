"use client";

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

// Discreet "install to home screen" nudge for logged-in users on a mobile browser. Two realities:
//   • Android/Chromium fires `beforeinstallprompt` → we show a real "Installera"-button that opens
//     the native install dialog.
//   • iOS Safari can't be prompted programmatically (Apple), so we show the manual instruction
//     (Share → Lägg till på hemskärmen) — the only way A2HS works there.
// Hidden once installed (standalone), on desktop, on public pages, and after the user dismisses it.
// Driving installs matters: iOS web push only works from an installed PWA.

const DISMISS_KEY = 'ekovilla_install_prompt_dismissed_v1';
// Logged-out / public surfaces where an install nudge doesn't belong.
const HIDDEN_PREFIXES = ['/auth', '/kund/offert'];
// App chrome green (var(--crm-primary) is scoped to .crm-shell, which doesn't wrap this banner).
const BRAND_GREEN = '#1a3f26';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export default function InstallPrompt({ loggedIn }: { loggedIn: boolean }) {
  const pathname = usePathname() || '/';
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!loggedIn) return;

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return; // already installed

    if (!window.matchMedia('(max-width: 820px)').matches) return; // mobile only

    try { if (localStorage.getItem(DISMISS_KEY)) return; } catch { /* ignore */ }

    const ua = window.navigator.userAgent;
    if (/iphone|ipad|ipod/i.test(ua)) {
      setIsIOS(true);
      // A2HS is Safari-only on iOS; other iOS browsers (Chrome/Firefox/Edge) can't add to home screen.
      if (!/crios|fxios|edgios/i.test(ua)) setShow(true);
      return;
    }

    // Android/Chromium: reveal only once the browser says it's installable.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    const onInstalled = () => {
      setShow(false);
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [loggedIn]);

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    dismiss();
  };

  if (!show) return null;
  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  return (
    <div
      className="crm-sheet-in fixed inset-x-3 z-[1200] lg:hidden"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
      role="dialog"
      aria-label="Installera Ekovilla"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.18)]">
        <img
          src="/favicon-192.png"
          alt=""
          className="h-11 w-11 shrink-0 rounded-xl"
          style={{ boxShadow: '0 2px 8px rgba(26,63,38,0.22)' }}
        />
        <div className="min-w-0 flex-1">
          {isIOS ? (
            <>
              <p className="m-0 text-sm font-bold text-slate-900">Lägg Ekovilla på hemskärmen</p>
              <p className="m-0 mt-0.5 text-[12px] leading-snug text-slate-600">
                Tryck på
                <ShareGlyph />
                i verktygsfältet och välj &ldquo;Lägg till på hemskärmen&rdquo;.
              </p>
            </>
          ) : (
            <>
              <p className="m-0 text-sm font-bold text-slate-900">Installera Ekovilla</p>
              <p className="m-0 mt-0.5 text-[12px] leading-snug text-slate-600">
                Snabbare åtkomst och notiser direkt på hemskärmen.
              </p>
            </>
          )}
        </div>

        {!isIOS && (
          <button
            type="button"
            onClick={install}
            className="shrink-0 rounded-lg px-3 py-2 text-[13px] font-semibold text-white"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            Installera
          </button>
        )}

        <button
          type="button"
          aria-label="Stäng"
          onClick={dismiss}
          className="flex h-8 w-8 shrink-0 items-center justify-center !rounded-full !border !border-slate-200 !bg-slate-50 !p-0 text-slate-500 transition hover:!bg-slate-100 hover:text-slate-700"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// iOS share glyph (box with an up arrow) shown inline in the instruction.
function ShareGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mx-1 inline-block -translate-y-px align-middle text-slate-700"
    >
      <path d="M12 15V3" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7" />
    </svg>
  );
}

"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBackGuard, leaveHrefFromClick, type BackGuard } from '@/lib/domains/crm/leaveGuard';

// Stoppet för osparade ändringar. Delas av offertformuläret och arbetsordern; dialogen är
// UnsavedChangesDialog. Besluten bor i lib/domains/crm/leaveGuard.ts — här bor bara kopplingen till
// webbläsaren och routern.
//
// Fyra vägar ut ur en sida, och vad som fångar dem:
//
//   • En länk (sidomenyn, "Öppna kundkort", vilken <Link> som helst) — klicket fångas i
//     capture-fasen, före Next:s egen Link-hanterare, och blir vår dialog.
//   • Sidans egen Tillbaka-knapp — anroparen frågar via `ask(href)`.
//   • Webbläsarens bakåtpil / svep — ett tvillingsteg i historiken, se createBackGuard.
//   • Stänga fliken, ladda om, skriva en adress — webbläsarens egen ruta (beforeunload). ⚠️ Den går
//     inte att ersätta: webbläsare tillåter ingen egen dialog där, och texten går inte att ändra.

type PendingLeave = { kind: 'href'; href: string } | { kind: 'back' };

export type LeaveGuard = {
  /** Står frågan öppen? */
  pending: boolean;
  /** Fråga innan sidan lämnas till `href` (sidans egen Tillbaka-knapp). */
  ask: (href: string) => void;
  /** Lämna medvetet, utan att fråga — t.ex. en tur till kundkortet med utkastet undanlagt. */
  navigate: (href: string) => void;
  /** "Lämna utan att spara". */
  confirm: () => void;
  /** "Stanna kvar". */
  cancel: () => void;
};

export function useLeaveGuard({
  active,
  captureBack = true,
  fallbackHref,
  onLeave,
}: {
  /** Finns det något osparat som vore förlorat om sidan lämnades nu? */
  active: boolean;
  /**
   * Får bakåtpilen fångas just nu? false medan sidan själv är på väg att byta adress — se
   * "SIDAN FÅR INTE BYTA SIN EGEN ADRESS" i createBackGuard.
   */
  captureBack?: boolean;
  /** Vart "Lämna" går efter bakåt när fliken öppnades direkt på sidan och inget ligger bakom den. */
  fallbackHref: string;
  /** Körs precis innan sidan lämnas, även i webbläsarens egen ruta. Offerten lägger undan sitt utkast här. */
  onLeave?: () => void;
}): LeaveGuard {
  const router = useRouter();
  const [pending, setPending] = useState<PendingLeave | null>(null);

  // Lyssnarna nedan registreras en gång och läser läget vid händelsen, inte när de skapades.
  const guardingRef = useRef(false);
  const onLeaveRef = useRef(onLeave);
  // Satt när användaren valt att lämna. Därefter ska varken beforeunload fråga (en bakåt till en
  // annan origin är en riktig sidavlastning) eller vakten laddas om på vägen ut.
  const leavingRef = useRef(false);
  const guardRef = useRef<BackGuard | null>(null);
  function guard(): BackGuard {
    if (!guardRef.current) {
      guardRef.current = createBackGuard({
        state: () => window.history.state,
        // ⚠️ Prototypens metod, inte `window.history.replaceState`: Next lappar den på instansen, och
        // den lappade kopierar in Next:s state i ett null och dispatchar en routeråterställning —
        // precis det vakten finns för att undvika. Se "NEXT FÅR INTE SE VÅRA STEG".
        replaceState: (state) => History.prototype.replaceState.call(window.history, state, '', window.location.href),
        // Den lappade duger här: en state med Next:s `__NA` släpps igenom orörd.
        pushState: (state) => window.history.pushState(state, '', window.location.href),
        back: () => window.history.back(),
        length: () => window.history.length,
        scrollRestoration: () => window.history.scrollRestoration,
        setScrollRestoration: (mode) => { window.history.scrollRestoration = mode; },
      });
    }
    return guardRef.current;
  }

  useEffect(() => {
    guardingRef.current = active && captureBack;
    onLeaveRef.current = onLeave;
  });

  // Ladda vakten medan något är osparat, ta bort den när inget är det längre.
  useEffect(() => {
    if (leavingRef.current) return;
    if (active && captureBack) guard().arm();
    else guard().disarm();
  }, [active, captureBack]);

  useEffect(() => {
    const backGuard = guard();
    function onPopState() {
      const outcome = backGuard.onPopState(guardingRef.current && !leavingRef.current);
      if (outcome.kind === 'navigate') {
        if (outcome.replace) router.replace(outcome.href);
        else router.push(outcome.href);
      } else if (outcome.kind === 'blocked') setPending({ kind: 'back' });
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [router]);

  useEffect(() => () => guardRef.current?.release(), []);

  useEffect(() => {
    if (!active) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (leavingRef.current) return;
      onLeaveRef.current?.();
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);

  useEffect(() => {
    if (!active || pending) return;
    function onClick(e: MouseEvent) {
      const anchor = (e.target as Element | null)?.closest?.('a') ?? null;
      const href = leaveHrefFromClick({
        defaultPrevented: e.defaultPrevented,
        button: e.button,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        anchor: anchor
          ? { href: anchor.href, rawHref: anchor.getAttribute('href'), target: anchor.target, download: anchor.hasAttribute('download') }
          : null,
      }, window.location.href);
      if (!href) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ kind: 'href', href });
    }
    document.addEventListener('click', onClick, true); // capture-fasen → före Next:s Link
    return () => document.removeEventListener('click', onClick, true);
  }, [active, pending]);

  function leaveTo(href: string) {
    if (!guard().leaveTo(href)) router.push(href);
  }

  return {
    pending: pending !== null,
    ask: (href) => setPending({ kind: 'href', href }),
    navigate: (href) => {
      leavingRef.current = true;
      leaveTo(href);
    },
    confirm: () => {
      if (!pending) return;
      setPending(null);
      leavingRef.current = true;
      onLeaveRef.current?.();
      if (pending.kind === 'back') {
        guard().leaveBack(fallbackHref);
        return;
      }
      leaveTo(pending.href);
    },
    cancel: () => setPending(null),
  };
}

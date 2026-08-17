"use client";

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/shared/cn';
import type { UserRole } from '@/lib/roles';
import { getVisibleCrmNavItems } from '../crm/_lib/nav';
import { getVisibleAppNavItems } from '../_lib/appNav';
import ProfileMenu from './ProfileMenu';
import NotificationBell from '@/components/notifications/NotificationBell';

// Unified, context-aware app sidebar. Outside /crm it shows the app-level nav;
// inside /crm it swaps to the CRM nav (plus a "back to start" item). Mirrors the
// proven CrmSidebar chrome (collapse rail, mobile drawer, expandable groups) but
// is the single shell chrome for the whole app — no separate global header.
//
// On desktop it rests as a narrow icon rail and peeks open on hover, so navigating
// costs no clicks and reading costs no width. The panel is fixed and floats over the
// content while peeking — a spacer holds the rail's column — so the page never
// reflows under the cursor. Pinning (the chevron) is the opt-out for a permanently
// open sidebar and is the only state that is remembered.

type NavNode = { href: string; label: string; children?: NavNode[] };

function isHrefActive(href: string, pathname: string) {
  if (href === '/') return pathname === '/';
  if (href === '/crm') return pathname === '/crm';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function activeChildHref(children: NavNode[], pathname: string): string | null {
  const matches = children
    .filter((c) => pathname === c.href || pathname.startsWith(`${c.href}/`))
    .sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.href ?? null;
}

const fallbackIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const navIcons: Record<string, JSX.Element> = {
  '/': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11l9-7 9 7" /><path d="M9 22V12h6v10" />
    </svg>
  ),
  '/crm': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  '/crm/offerter': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  '/crm/kunder': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  '/crm/rapportering': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
    </svg>
  ),
  '/crm/samtal': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  ),
  '/crm/uppgifter': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  ),
  '/crm/saljtavla': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="5" height="16" rx="1" /><rect x="9.5" y="4" width="5" height="10" rx="1" /><rect x="16" y="4" width="5" height="13" rx="1" />
    </svg>
  ),
  '/crm/arbetsorder': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    </svg>
  ),
  '/crm/planering': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  '/crm/ringlistor': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  '/crm/ai-prospekt': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
    </svg>
  ),
  '/crm/coach': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  ),
  '/crm/dokument': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  ),
  '/crm/korjournal': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l1.5-4.5A2 2 0 018.4 7h7.2a2 2 0 011.9 1.5L19 13M5 13h14M5 13v4m14-4v4M7 17h.01M17 17h.01" />
    </svg>
  ),
  '/crm/installningar': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  // "Planering (äldre)" sits directly under "Planering" in APP_NAV_ITEMS, which warns
  // about exactly this misnavigation — a clock badge keeps the calendar family but makes
  // the two tell apart at a glance now that the rail shows icons only.
  '/plannering': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h6" />
      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      <circle cx="17.5" cy="17.5" r="4.5" /><path d="M17.5 15.5v2l1.5 1" />
    </svg>
  ),
  '/offert/kalkylator': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="10" x2="10" y2="10" /><line x1="14" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="10" y2="14" /><line x1="14" y1="14" x2="16" y2="14" />
    </svg>
  ),
  '/egenkontroll': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  ),
  '/archive': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="4" rx="1" /><path d="M5 7v12a2 2 0 002 2h10a2 2 0 002-2V7" /><path d="M9 12h6" />
    </svg>
  ),
  '/tidrapport': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  '/mina-jobb': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><path d="M9 15l2 2 4-4" />
    </svg>
  ),
  '/bestallning-klader': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4h6" /><path d="M9 4l-2 2-2 1v3h3v10h8V10h3V7l-2-1-2-2" />
    </svg>
  ),
  '/material-kvalitet': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="7" /><rect x="13" y="7" width="3" height="11" />
    </svg>
  ),
  '/mina-dokument': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h8l4 4v13a1 1 0 01-1 1H6a2 2 0 01-2-2V5a2 2 0 012-2z" /><path d="M14 3v5h5" />
    </svg>
  ),
  '/kontakt-lista': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  ),
  '/dokument-information': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  '/nyheter': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h13v16H6a2 2 0 01-2-2z" /><path d="M17 8h3v10a2 2 0 01-2 2" /><line x1="7" y1="8" x2="14" y2="8" /><line x1="7" y1="12" x2="14" y2="12" /><line x1="7" y1="16" x2="11" y2="16" />
    </svg>
  ),
  '/felanmalan': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  '/admin': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z" /><path d="M10 11l2 2 4-4" />
    </svg>
  ),
};

// v2 key: the model changed from "collapsed yes/no" to "pinned open vs. hover rail",
// so old stored preferences are deliberately not carried over — everyone starts on
// the rail and re-pins if they want the labels up permanently.
const PINNED_KEY = 'app-sidebar-pinned';

// A short open delay keeps the panel shut when the mouse merely sweeps across the rail
// on its way into the content; the longer close delay forgives the diagonal move down
// into a nav group.
const PEEK_OPEN_MS = 120;
const PEEK_CLOSE_MS = 180;

// Whether the panel is holding focus because someone tabbed into it, as opposed to
// merely clicking a button in it — only the former should keep it open once the mouse
// has left. Engines that don't know the selector throw on matches(), and there the
// mouse is the more trustworthy signal.
function hasKeyboardFocusInside(el: HTMLElement | null) {
  const active = document.activeElement;
  if (!el || !(active instanceof HTMLElement) || !el.contains(active)) return false;
  try {
    return active.matches(':focus-visible');
  } catch {
    return false;
  }
}

// An anchored popover opened from inside the panel (ProfileMenu) renders through a
// portal but is positioned against its trigger, so collapsing the rail would leave it
// floating detached over the content. The notification sheet deliberately does not
// match — it carries its own full-screen overlay and wants the rail out of the way.
function hasAnchoredPopoverInside(el: HTMLElement | null) {
  return !!el?.querySelector('[aria-haspopup][aria-expanded="true"]');
}

export default function AppSidebar({
  role,
  userName,
  userInitial = 'U',
}: {
  role: UserRole | null;
  userName?: string | null;
  userInitial?: string;
}) {
  const pathname = usePathname();
  const inCrm = pathname === '/crm' || pathname.startsWith('/crm/');
  // konsult has the same viewing permissions as sales (see lib/roles.ts).
  const effRole: UserRole | null = role === 'konsult' ? 'sales' : role;

  const items: NavNode[] = useMemo(() => {
    if (inCrm) {
      return getVisibleCrmNavItems(effRole).map((item) => ({
        href: item.href,
        label: item.label,
        children: item.children?.map((c) => ({ href: c.href, label: c.label })),
      }));
    }
    return getVisibleAppNavItems(effRole).map((item) => ({ href: item.href, label: item.label }));
  }, [inCrm, effRole]);

  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // null until the stored preference and the pointer type are known. Rail is the
  // rendered default, so the server renders the rail and the common case never flashes
  // wide-then-narrow on load; only a pinned sidebar widens after hydration.
  const [pinnedPref, setPinnedPref] = useState<boolean | null>(null);
  const [peeking, setPeeking] = useState(false);
  const [hoverCapable, setHoverCapable] = useState<boolean | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The rail is a pointer affordance: without hover there is nothing to peek with, and
  // the footer's profile/logout menu would be unreachable behind a bare chevron. Those
  // devices keep the always-open sidebar unless the user says otherwise.
  const pinned = pinnedPref ?? hoverCapable === false;

  // Icons-only state. Everything below keys its compact styling off this, so the hover
  // peek renders the exact same chrome as a pinned sidebar — one code path, not two.
  const rail = !pinned && !peeking;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PINNED_KEY);
      if (stored === '1') setPinnedPref(true);
      else if (stored === '0') setPinnedPref(false);
    } catch { /* ignore */ }
  }, []);

  // Touch devices fire a sticky :hover on tap, which would leave the panel stuck open
  // with nothing to dismiss it, so the peek is limited to real pointers. Those devices
  // keep the rail plus its tooltips and the pin button.
  useEffect(() => {
    const media = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setHoverCapable(media.matches);
    update();
    // Same fallback the other matchMedia call sites in this repo use: this effect runs
    // in the shell around every authenticated page, so a throw here is a blank app.
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => () => { if (peekTimer.current) clearTimeout(peekTimer.current); }, []);

  const clearPeekTimer = () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = null;
  };

  const openPeek = useCallback((immediate: boolean) => {
    if (hoverCapable !== true) return;
    clearPeekTimer();
    if (immediate) setPeeking(true);
    else peekTimer.current = setTimeout(() => setPeeking(true), PEEK_OPEN_MS);
  }, [hoverCapable]);

  const endPeek = useCallback(() => {
    clearPeekTimer();
    setPeeking(false);
  }, []);

  // Blur bubbles on every move between children, so the delay doubles as the guard
  // against collapsing mid-tab; the focus check keeps the panel open for a keyboard
  // user whose mouse happens to wander off it. It has to be :focus-visible and not
  // plain focus — clicking a nav group toggle leaves that button focused, and a
  // contains() check would then pin the panel open over the content indefinitely.
  const closePeek = useCallback(() => {
    clearPeekTimer();
    peekTimer.current = setTimeout(() => {
      const el = asideRef.current;
      if (hasKeyboardFocusInside(el) || hasAnchoredPopoverInside(el)) return;
      setPeeking(false);
    }, PEEK_CLOSE_MS);
  }, []);

  // React events cross portal boundaries along the component tree, so the notification
  // sheet's and ProfileMenu's contents would otherwise re-open the peek from behind
  // their own overlays. Only focus that actually lands inside the panel counts.
  const isInsideAside = (target: EventTarget | null) =>
    target instanceof Node && !!asideRef.current?.contains(target);

  const togglePinned = () => {
    const next = !pinned;
    setPinnedPref(next);
    try { window.localStorage.setItem(PINNED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  };

  useEffect(() => {
    setPendingHref(null);
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  // Escape dismisses the peek the way it dismisses any other overlay. Focus follows it
  // out, otherwise the next Tab would resume inside a panel that is no longer readable.
  useEffect(() => {
    if (!peeking) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && asideRef.current?.contains(active)) active.blur();
      endPeek();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [peeking, endPeek]);

  const brandSub = inCrm ? 'CRM' : 'Arbetsyta';

  const renderLink = (node: NavNode, active: boolean, isChild: boolean) => {
    const pending = pendingHref === node.href && !active;
    const icon = navIcons[node.href] ?? fallbackIcon;
    return (
      <Link
        href={node.href}
        aria-current={active ? 'page' : undefined}
        title={rail ? node.label : undefined}
        onClick={() => { if (!active) setPendingHref(node.href); }}
        className={cn(
          'flex items-center gap-3 rounded-xl text-sm font-medium no-underline transition-colors',
          isChild ? 'py-2 pl-11 pr-3 text-[13px]' : 'px-3 py-2.5',
          rail && !isChild && 'lg:justify-center lg:gap-0 lg:px-0',
          active ? 'text-white' : pending ? 'text-emerald-300' : 'hover:text-white',
        )}
        style={
          active
            ? { backgroundColor: 'var(--crm-sidebar-active)', color: 'var(--crm-sidebar-text-active)' }
            : pending
              ? { color: '#6ee7b7' }
              : { color: 'var(--crm-sidebar-text)' }
        }
        onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--crm-sidebar-hover)'; }}
        onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = ''; }}
      >
        {/* h-5 is the label's line box: the icon, not the hidden text, sets the row height
            on the rail, so a row measures the same open as closed. */}
        {!isChild && <span className={cn('flex h-5 shrink-0 items-center', active ? 'text-emerald-300' : '')}>{icon}</span>}
        <span className={cn('truncate crm-fade-in', rail && 'lg:hidden')}>{node.label}</span>
      </Link>
    );
  };

  return (
    <>
      {/* Mobile top bar */}
      <div
        className="flex items-center gap-3 px-4 pb-2.5 lg:hidden"
        style={{ backgroundColor: 'var(--crm-sidebar-bg)', paddingTop: 'calc(0.625rem + env(safe-area-inset-top))' }}
      >
        <Link href="/" title="Till start" onClick={() => setPendingHref('/')} className="flex items-center gap-3 no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/Ekovilla_vit.png" alt="Ekovilla" className="h-5 w-auto" />
          <span className="text-[11px] font-medium" style={{ color: 'var(--crm-sidebar-text-muted)' }}>{brandSub}</span>
        </Link>
        <NotificationBell className="ml-auto" />
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Öppna meny"
          aria-haspopup="dialog"
          aria-expanded={mobileOpen}
          aria-controls="app-sidebar-nav"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/25 bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </div>

      {/* Backdrop (mobile) */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Stäng meny"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}

      {/* Desktop layout column. The panel itself is fixed, so a peek floats over the
          content instead of reflowing the whole page every time the mouse passes. */}
      <div
        aria-hidden="true"
        className={cn(
          'hidden shrink-0 lg:block lg:transition-[width] lg:duration-200',
          pinned ? 'lg:w-56' : 'lg:w-[68px]',
        )}
      />

      <aside
        ref={asideRef}
        id="app-sidebar-nav"
        aria-label="Navigation"
        onMouseEnter={() => openPeek(false)}
        onMouseLeave={closePeek}
        onFocus={(e) => { if (isInsideAside(e.target)) openPeek(true); }}
        onBlur={(e) => { if (isInsideAside(e.target)) closePeek(); }}
        className={cn(
          'app-sidebar flex w-56 shrink-0 flex-col overflow-y-auto',
          // Mobile: off-canvas drawer from the RIGHT (better thumb reach).
          'fixed right-0 top-0 z-50 h-[100dvh] transition-transform duration-300 ease-out',
          mobileOpen ? 'translate-x-0' : 'translate-x-full',
          // Desktop: fixed left rail floating above the content (the spacer holds the column).
          'lg:left-0 lg:right-auto lg:top-0 lg:z-40 lg:h-[100dvh] lg:translate-x-0 lg:transition-[width] lg:duration-200',
          rail ? 'lg:w-[68px]' : 'lg:w-56',
          // Only a peek floats; a pinned sidebar sits flush in its own column.
          !pinned && !rail && 'lg:shadow-[0_24px_60px_-12px_rgba(2,20,12,0.55)]',
        )}
        style={{ backgroundColor: 'var(--crm-sidebar-bg)' }}
      >
        {/* Logo + collapse toggle. The band holds one height across rail and peek — 20px
            top padding + 24px logo + 8px gap + 32px control + 12px bottom padding = 96px,
            the rail's stack measured exactly — so everything below it keeps its line and
            nothing walks upward under the cursor when the panel opens. */}
        <div className={cn('flex items-center justify-between px-4 pb-3 [padding-top:calc(1.25rem+env(safe-area-inset-top))] lg:min-h-24 lg:pt-5', rail && 'lg:flex-col lg:items-center lg:gap-2 lg:px-3')}>
          <Link
            href="/"
            title="Till start"
            onClick={() => setPendingHref('/')}
            className={cn('crm-fade-in block no-underline', rail && 'lg:hidden')}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/Ekovilla_vit.png" alt="Ekovilla" className="h-6 w-auto" />
            <p className="mt-1 text-[11px] font-medium" style={{ color: 'var(--crm-sidebar-text-muted)' }}>{brandSub}</p>
          </Link>
          <Link
            href="/"
            title="Till start"
            onClick={() => setPendingHref('/')}
            className={cn('crm-fade-in hidden', rail ? 'lg:block' : 'lg:hidden')}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/Ekovilla_logga_vit.png" alt="Ekovilla" className="h-6 w-6 object-contain" />
          </Link>
          {/* Desktop: notification bell + pin toggle, grouped top-right (mobile has the bell in the top bar). */}
          {/* Centred rather than top-aligned: the band is now taller than the brand block,
              and self-start would float the controls above the logo instead of beside it. */}
          <div className={cn('ml-auto hidden items-center gap-1 lg:flex', rail && 'lg:ml-0 lg:flex-col')}>
            {/* The sheet is anchored to the sidebar's layout column, so the peek has to be
                gone before it opens. It can't be left to the mouse: the overlay is inserted
                under a stationary cursor, and no mouseleave fires until the pointer moves. */}
            <span onClickCapture={endPeek} className="contents">
              <NotificationBell collapsed={!pinned} className="h-8 w-8 rounded-lg border border-white/20 bg-transparent p-0 text-white/80 hover:border-white/30 hover:bg-white/10 hover:text-white" />
            </span>
            {/* 68px of rail fits the logo and one control, and the bell is the one carrying
                information (the unread badge). A pointer that can click this button has
                already opened the panel by reaching it, so the rail loses nothing by leaving
                it out. Devices without hover never peek — there the rail keeps the button,
                since it is their only way back to a pinned sidebar. */}
            {(!rail || hoverCapable === false) && (
              <button
                type="button"
                onClick={togglePinned}
                aria-pressed={pinned}
                aria-label={pinned ? 'Lossa menyn' : 'Fäst menyn öppen'}
                title={pinned ? 'Lossa menyn — den visas då vid hover' : 'Fäst menyn öppen'}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn('transition-transform', !pinned && 'rotate-180')}>
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Stäng meny"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 lg:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="mx-3 mb-3 h-px" style={{ backgroundColor: 'var(--crm-sidebar-border)' }} />

        {/* Back to start (CRM context only) */}
        {inCrm && (
          <div className="px-2 pb-1">
            <Link
              href="/"
              onClick={() => setPendingHref('/')}
              title={rail ? 'Till start' : undefined}
              className={cn('flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium no-underline transition-colors hover:text-white', rail && 'lg:justify-center lg:gap-0 lg:px-0')}
              style={{ color: 'var(--crm-sidebar-text-muted)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--crm-sidebar-hover)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ''; }}
            >
              <span className="flex h-5 shrink-0 items-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </span>
              <span className={cn('truncate crm-fade-in', rail && 'lg:hidden')}>Till start</span>
            </Link>
          </div>
        )}

        {/* Nav items */}
        <nav className="flex-1 px-2">
          <ul role="list" className="grid list-none gap-0.5 p-0">
            {items.map((item) => {
              const children = item.children ?? [];
              if (children.length > 0) {
                const childActive = activeChildHref(children, pathname);
                const groupActive = childActive !== null;
                const open = expanded[item.href] ?? groupActive;
                const icon = navIcons[item.href] ?? fallbackIcon;
                return (
                  <li key={item.href}>
                    <button
                      type="button"
                      aria-expanded={open}
                      title={rail ? item.label : undefined}
                      onClick={() => setExpanded((prev) => ({ ...prev, [item.href]: !open }))}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                        rail && 'lg:justify-center lg:gap-0 lg:px-0',
                        groupActive ? 'text-white' : 'hover:text-white',
                      )}
                      style={{ color: groupActive ? '#ffffff' : 'var(--crm-sidebar-text)' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--crm-sidebar-hover)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ''; }}
                    >
                      <span className={cn('flex h-5 shrink-0 items-center', groupActive ? 'text-emerald-300' : '')}>{navIcons[item.href] ?? fallbackIcon}</span>
                      <span className={cn('flex-1 truncate text-left crm-fade-in', rail && 'lg:hidden')}>{item.label}</span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn('shrink-0 transition-transform', open && 'rotate-180', rail && 'lg:hidden')}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {open && (
                      <ul role="list" className={cn('mt-0.5 grid list-none gap-0.5 p-0', rail && 'lg:hidden')}>
                        {children.map((child) => (
                          <li key={child.href}>{renderLink(child, childActive === child.href, true)}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              }
              return <li key={item.href}>{renderLink(item, isHrefActive(item.href, pathname), false)}</li>;
            })}
          </ul>
        </nav>

        {/* User + account menu */}
        <div className="mx-3 mt-2 mb-3 h-px" style={{ backgroundColor: 'var(--crm-sidebar-border)' }} />
        {/* min-h-10 is the profile button's height (22px icon + padding + border): without it
            the footer row shrinks to the avatar on the rail and the avatar hops on hover. */}
        <div className={cn('flex items-center gap-2.5 px-4 pb-5 lg:min-h-10', rail && 'lg:justify-center lg:px-2')}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
            {userInitial}
          </div>
          <div className={cn('min-w-0 flex-1', rail && 'lg:hidden')}>
            <p className="truncate text-[13px] font-semibold text-white">{userName || 'Användare'}</p>
            <p className="truncate text-[11px]" style={{ color: 'var(--crm-sidebar-text-muted)' }}>{role || 'roll saknas'}</p>
          </div>
          <div className={cn('shrink-0', rail && 'lg:hidden')}>
            <ProfileMenu fullName={userName || null} role={role} placement="up" />
          </div>
        </div>
      </aside>
    </>
  );
}

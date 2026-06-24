"use client";
import Link from 'next/link';
import React, { useMemo, useEffect, useState } from 'react';
import { QuickLinksGrid, QuickLink, QuickLinksIconBar, QuickLinksSidebar, QuickLinksStrip } from './QuickLinks';
import DashboardNotes from './DashboardNotes';
import dynamic from 'next/dynamic';
const DashboardSchedule = dynamic(() => import('./DashboardSchedule'));
import DashboardTasks from './DashboardTasks';
import DashboardDocumentApprovals from './DashboardDocumentApprovals';
import TimeReportModal from './TimeReportModal';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import SectionCard from '../ui/SectionCard';
import type { UserRole } from '../../lib/roles';
import NewsModal, { type NewsItem } from './NewsModal';

// Base mapping of NAV_LINKS (contains all). We'll adapt to QuickLink shape.
const baseExtra: Record<string, Omit<QuickLink, 'href' | 'title'>> = {
  '/egenkontroll': { desc: 'Skapa & arkivera egenkontroller', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
      <path d="M9 11.5l2 2 4-5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
    </svg>
  ) },
  '/archive': { desc: 'Arkiverade egenkontroller', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
      <path d="M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z" />
      <path d="M3 4h18v3H3Z" />
      <path d="M9 11h6" strokeLinecap="round" />
    </svg>
  ) },
  '/crm/korjournal': { desc: 'Registrera och granska resor', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
      <path d="M4 16l2-8h12l2 8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  ) },
  '/planering': { desc: 'Se och planera uppdrag', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M8 2v4M16 2v4M3 10h18" strokeLinecap="round" />
    </svg>
  ) },
  '/material-kvalitet': { desc: 'Intern uppföljning & värden', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
      <path d="M4 18V9l8-5 8 5v9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 22v-7h6v7" strokeLinecap="round" />
    </svg>
  ) },
  '/kontakt-lista': { desc: 'Kontakt & adresser', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" fill="none" aria-hidden>
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) },
  '/dokument-information': { desc: 'Dokument & information', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" fill="none" aria-hidden>
      <path d="M6 2h7l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
      <path d="M13 2v6h6" />
      <path d="M8 13h8M8 17h5" strokeLinecap="round" />
    </svg>
  ) },
  '/crm/dokument': { desc: 'Dokumentbibliotek', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" fill="none" aria-hidden>
      <path d="M3.5 6a2 2 0 0 1 2-2h5l2 2H18.5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V6Z" />
      <path d="M7 12h10M7 16h7" strokeLinecap="round" />
    </svg>
  ) },
  '/mina-dokument': { desc: 'Dokument att läsa och godkänna', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
      <path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v5h5" />
      <path d="M8 14l2.2 2.2L16 10.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) },
  '/bestallning-klader': { desc: 'Beställ kläder & material', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" fill="none" aria-hidden>
      <path d="M6 6h15l-1.2 8.5a2 2 0 0 1-2 1.7H9.3a2 2 0 0 1-2-1.6L5.2 3.7A1 1 0 0 0 4.2 3H2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
    </svg>
  ) },
  '/admin': { desc: 'Hantera användare & behörigheter', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1 1 0 0 0 .2-1l-.6-1.1a7 7 0 0 0 0-1.8l.6-1.1a1 1 0 0 0-.2-1l-1.2-1.2a1 1 0 0 0-1-.2l-1.1.6a7 7 0 0 0-1.8 0l-1.1-.6a1 1 0 0 0-1 .2L9.6 7a1 1 0 0 0-.2 1l.6 1.1a7 7 0 0 0 0 1.8L9.4 12a1 1 0 0 0 .2 1l1.2 1.2a1 1 0 0 0 1 .2l1.1-.6a7 7 0 0 0 1.8 0l1.1.6a1 1 0 0 0 1-.2Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) },
  '/offert': { desc: 'Skapa offert', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" fill="none" aria-hidden>
      <path d="M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>
      <line x1="8" y1="6" x2="16" y2="6"/>
      <line x1="8" y1="10" x2="16" y2="10"/>
      <line x1="8" y1="14" x2="12" y2="14"/>
    </svg>
  ) },
  '/offert/kalkylator': { desc: 'Kalkylera offert (ROT, marginal, etablering)', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" fill="none" aria-hidden>
      <path d="M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>
      <line x1="8" y1="6" x2="16" y2="6"/>
      <line x1="8" y1="10" x2="16" y2="10"/>
      <line x1="8" y1="14" x2="12" y2="14"/>
    </svg>
  ) },
  '/tidrapport': { desc: 'Veckovy & rapportera tid', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" fill="none" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M8 3v4M16 3v4" strokeLinecap="round" />
      <path d="M3 10h18" strokeLinecap="round" />
      <path d="M12 14v-2" strokeLinecap="round" />
      <path d="M12 14a3 3 0 1 0 3 3" strokeLinecap="round" />
    </svg>
  ) },
  '/crm': { desc: 'Säljstöd, prospekt och uppföljning', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Z" />
      <path d="M8 9h8M8 12h8M8 15h5" strokeLinecap="round" />
    </svg>
  ) },
};
// Dashboard main component (expects role only after cleanup of deprecated userQuickHrefs prop)
export function ClientDashboard({ role }: { role: UserRole | null }) {
  const NEWS_SEEN_KEY = 'dashboard.news.lastSeenId';
  const DESKTOP_BREAKPOINT = 1180;
  const stickyTop = 92;

  // konsult should have the same viewing permissions as sales.
  const effectiveRole: UserRole | null = role === 'konsult' ? 'sales' : role;

  // Responsive flags (client-only)
  const [isSmall, setIsSmall] = useState(false); // <= 640px
  const [isXS, setIsXS] = useState(false); // <= 420px
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      setIsSmall(w <= 768);
      setIsXS(w <= 460);
      setIsDesktop(w >= DESKTOP_BREAKPOINT);
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  // News modal (shown once per news item)
  const [newsItem, setNewsItem] = useState<NewsItem | null>(null);
  const [newsOpen, setNewsOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/news/latest', { cache: 'no-store' });
        if (!res.ok) return;
        const j = await res.json();
        const item = (j?.item || null) as NewsItem | null;
        if (!alive || !item?.id) return;

        let lastSeen: string | null = null;
        try { lastSeen = localStorage.getItem(NEWS_SEEN_KEY); } catch { /* ignore */ }

        setNewsItem(item);
        if (!lastSeen || lastSeen !== item.id) {
          setNewsOpen(true);
        }
      } catch {
        // ignore
      }
    })();
    return () => { alive = false; };
  }, []);

  const closeNews = () => {
    setNewsOpen(false);
    if (newsItem?.id) {
      try { localStorage.setItem(NEWS_SEEN_KEY, newsItem.id); } catch { /* ignore */ }
    }
  };
  const links: QuickLink[] = useMemo(() => {
    if (role === 'konsult') {
      return [
        { href: '/offert/kalkylator', title: 'Kalkylator Försäljning Privat', ...baseExtra['/offert/kalkylator'] },
        { href: '/crm/dokument', title: 'Dokument', ...baseExtra['/crm/dokument'] },
        { href: '/kontakt-lista', title: 'Kontakt', ...baseExtra['/kontakt-lista'] },
      ];
    }
    // Explicit role-based sets as requested
    if (effectiveRole === 'member') {
      return [
        { href: '/egenkontroll', title: 'Skapa egenkontroll', ...baseExtra['/egenkontroll'] },
        { href: '/bestallning-klader', title: 'Beställ kläder & annat', ...baseExtra['/bestallning-klader'] },
        { href: '/tidrapport', title: 'Tidrapport', ...baseExtra['/tidrapport'] },
        { href: '/kontakt-lista', title: 'Kontakt', ...baseExtra['/kontakt-lista'] },
        { href: '/mina-dokument', title: 'Mina dokument', ...baseExtra['/mina-dokument'] },
        { href: '/dokument-information', title: 'Dokument & information', ...baseExtra['/dokument-information'] },
      ];
    }
    if (effectiveRole === 'sales') {
      return [
        { href: '/crm', title: 'CRM', ...baseExtra['/crm'] },
        { href: '/archive', title: 'Egenkontroll arkiv', ...baseExtra['/archive'] },
        { href: '/crm/korjournal', title: 'Körjournal', ...baseExtra['/crm/korjournal'] },
        { href: '/plannering', title: 'Planering', ...baseExtra['/planering'] },
        { href: '/kontakt-lista', title: 'Kontakt', ...baseExtra['/kontakt-lista'] },
        { href: '/mina-dokument', title: 'Mina dokument', ...baseExtra['/mina-dokument'] },
        { href: '/crm/dokument', title: 'Dokument', ...baseExtra['/crm/dokument'] },
        { href: '/offert/kalkylator', title: 'Kalkylator Försäljning Privat', ...baseExtra['/offert/kalkylator'] },
      ];
    }
    if (effectiveRole === 'admin') {
      return [
        { href: '/crm', title: 'CRM', ...baseExtra['/crm'] },
        { href: '/egenkontroll', title: 'Ny egenkontroll', ...baseExtra['/egenkontroll'] },
        { href: '/archive', title: 'Egenkontroll arkiv', ...baseExtra['/archive'] },
        { href: '/crm/korjournal', title: 'Körjournal', ...baseExtra['/crm/korjournal'] },
        { href: '/plannering', title: 'Planering', ...baseExtra['/planering'] },
        { href: '/tidrapport', title: 'Tidrapport', ...baseExtra['/tidrapport'] },
        { href: '/mina-dokument', title: 'Mina dokument', ...baseExtra['/mina-dokument'] },
        { href: '/crm/dokument', title: 'Dokument', ...baseExtra['/crm/dokument'] },
        { href: '/admin', title: 'Admin', ...baseExtra['/admin'] },
        { href: '/offert', title: 'Skapa offert', ...baseExtra['/offert'] },
        { href: '/offert/kalkylator', title: 'Kalkylator Försäljning Privat', ...baseExtra['/offert/kalkylator'] },
      ];
    }
    // Fallback before role known: minimal set
    return [
      { href: '/egenkontroll', title: 'Egenkontroll', ...baseExtra['/egenkontroll'] },
    ];
  }, [effectiveRole, role]);
  const [mini, setMini] = useState(false);
  const [showDesktopApprovals, setShowDesktopApprovals] = useState(true);
  const [showAllDesktopLinks, setShowAllDesktopLinks] = useState(false);
  const [showDesktopTasks, setShowDesktopTasks] = useState(true);
  const [timeModalOpen, setTimeModalOpen] = useState(false);
  const [timePrefill, setTimePrefill] = useState<{ project?: string; projectId?: string; date?: string } | null>(null);
  // Persist mini preference in localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('dashboard.quicklinks.mini');
      if (raw === '1') setMini(true);
      // On first visit or no preference, auto-compact on very small screens
      if (raw == null) {
        const w = window.innerWidth;
        if (w <= 480) setMini(true);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('dashboard.quicklinks.mini', mini ? '1' : '0'); } catch {}
  }, [mini]);

  // Toast
  const toast = useToast();
  const desktopSidebarLinks = useMemo(() => showAllDesktopLinks ? links : links.slice(0, 6), [links, showAllDesktopLinks]);
  const todayMeta = useMemo(() => {
    const now = new Date();
    const weekday = now.toLocaleDateString('sv-SE', { weekday: 'long' });
    const monthDay = now.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' });
    const hour = now.getHours();
    const greeting = hour < 10 ? 'God morgon' : hour < 17 ? 'Hej' : 'God kväll';
    return {
      greeting,
      weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1),
      monthDay,
    };
  }, []);

  const surfaceCardStyle: React.CSSProperties = {
    border: '1px solid #e5e7eb',
    background: '#fff',
    borderRadius: isSmall ? 18 : 20,
    padding: isSmall ? (isXS ? 14 : 18) : 24,
    display: 'grid',
    gap: isSmall ? 16 : 22,
    boxShadow: '0 10px 26px rgba(15, 23, 42, 0.04)'
  };

  const desktopShellStyle: React.CSSProperties = {
    padding: 24,
    maxWidth: 1580,
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 260px) minmax(0, 1.6fr) minmax(280px, 340px)',
    gap: 24,
    alignItems: 'start'
  };

  const desktopRailStyle: React.CSSProperties = {
    position: 'sticky',
    top: stickyTop,
    display: 'grid',
    gap: 18,
    alignSelf: 'start'
  };

  const desktopMainStyle: React.CSSProperties = {
    display: 'grid',
    gap: 24,
    minWidth: 0,
  };

  const desktopQuickLinksCardStyle: React.CSSProperties = {
    ...surfaceCardStyle,
    padding: 18,
    gap: 14,
    border: '1px solid #dbe4ef',
    background: 'linear-gradient(180deg,#fcfdff 0%,#f5f8fc 100%)',
    boxShadow: '0 12px 28px rgba(15,23,42,0.06)',
  };

  const desktopDenseCardStyle: React.CSSProperties = {
    ...surfaceCardStyle,
    padding: 20,
    gap: 16,
  };

  const miniToggleBtnClass = 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm leading-none text-slate-700 shadow-[0_2px_4px_rgba(0,0,0,0.06)] transition-colors hover:bg-slate-50';

  const renderHeroSection = (showQuickLinks: boolean) => (
    <section
      className={cn(
        'relative grid overflow-hidden rounded-[24px] border border-[#d6e4d8] bg-[linear-gradient(135deg,#f7fbf8_0%,#eef8f0_42%,#f7fbff_100%)] shadow-[0_24px_56px_rgba(15,23,42,0.10)]',
        isDesktop ? 'gap-4 p-[22px]' : isSmall ? (isXS ? 'gap-3 p-[14px]' : 'gap-3 p-4') : 'gap-[18px] p-6'
      )}
    >
      <div className="pointer-events-none absolute inset-[1px] rounded-[23px] border border-white/70" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[88px] bg-[linear-gradient(180deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0)_100%)]" />
      <div
        className={cn(
          'absolute rounded-full bg-[radial-gradient(circle,rgba(34,197,94,0.16)_0%,rgba(34,197,94,0)_72%)] blur-[2px]',
          isSmall ? '-right-[26px] -top-[42px] h-[140px] w-[140px]' : '-right-[18px] -top-[54px] h-[190px] w-[190px]'
        )}
      />
      <div className="pointer-events-none absolute -left-[64px] bottom-[-92px] h-[220px] w-[220px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.10)_0%,rgba(59,130,246,0)_72%)]" />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className={cn('grid', isSmall ? 'max-w-full gap-2' : 'max-w-[680px] gap-2.5', isDesktop ? 'max-w-full' : '')}>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#d9e5dc] bg-white/80 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.3px] text-green-700">
            {todayMeta.greeting}
            <span className="h-1 w-1 rounded-full bg-green-500" />
            {todayMeta.weekday}
          </div>
          <div className="grid gap-1.5">
            <h1
              className={cn(
                'm-0 leading-[1.02] tracking-[-1.1px] text-slate-900',
                isSmall ? (isXS ? 'text-[26px]' : 'text-[30px]') : isDesktop ? 'text-[34px]' : 'text-[38px]'
              )}
            >
              Översikt
            </h1>
            <p
              className={cn(
                'm-0 leading-[1.45] text-slate-600',
                isSmall ? 'max-w-[520px] text-[13px]' : 'max-w-[560px] text-[15px]',
                isDesktop ? 'max-w-[720px]' : ''
              )}
            >
              {isDesktop
                ? 'Välkommen till din dashboard! Här har vi samlat allt du behöver för att snabbt komma igång med dagens arbete och hålla koll på det som är viktigt.'
                : 'Börja med dagens viktigaste saker. Snabb åtkomst till tidrapport, dokument och dina vanligaste genvägar.'}
            </p>
          </div>
        </div>
        <div className={cn('grid gap-2.5', isSmall ? 'min-w-full' : isDesktop ? 'min-w-[260px]' : 'min-w-[240px]')}>
          <button
            type="button"
            onClick={()=>{ setTimePrefill(null); setTimeModalOpen(true); }}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-[16px] border border-green-600 bg-[linear-gradient(180deg,#22c55e_0%,#16a34a_100%)] font-bold text-white shadow-[0_16px_28px_rgba(22,163,74,0.24)] transition-[transform,box-shadow,background] hover:-translate-y-0.5 hover:bg-[linear-gradient(180deg,#20b455_0%,#15803d_100%)] hover:shadow-[0_20px_36px_rgba(22,163,74,0.26)]',
              isSmall ? 'px-4 py-3 text-[13px]' : 'px-[18px] py-[13px] text-[13px]'
            )}
          >
            <span aria-hidden className="inline-flex">
              <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth={2} stroke="#fff" fill="none"><path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </span>
            Rapportera tid
          </button>
          <div className={cn('grid gap-2.5', isSmall || isDesktop ? 'grid-cols-1' : 'grid-cols-2')}>
            <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-white/80 bg-white/88 shadow-[0_12px_28px_rgba(15,23,42,0.08)] backdrop-blur-[6px]', isSmall ? 'px-3 py-2.5' : 'px-[14px] py-3')}>
              <div className="grid gap-0.5">
                <span className="text-[11px] font-bold uppercase tracking-[0.3px] text-slate-500">Idag</span>
                <strong className={cn('text-slate-900', isSmall ? 'text-[15px]' : 'text-base')}>{todayMeta.monthDay}</strong>
              </div>
              <span className="text-xs text-slate-500">Fokus på det viktigaste först.</span>
            </div>
            {!isSmall && !isDesktop && (
              <div className="grid gap-1 rounded-[20px] border border-white/80 bg-white/88 px-[14px] py-3 shadow-[0_12px_28px_rgba(15,23,42,0.08)] backdrop-blur-[6px]">
                <span className="text-[11px] font-bold uppercase tracking-[0.3px] text-slate-500">Snabbt nu</span>
                <strong className="text-base text-slate-900">Öppna dokument</strong>
                <Link href="/mina-dokument" className="text-xs font-bold text-blue-600 no-underline hover:text-blue-700">Gå till mina dokument</Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {showQuickLinks && !mini && (
        <div className={cn('grid', isSmall ? 'gap-2' : 'gap-2.5')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <h2 className={cn('m-0 text-slate-900', isSmall ? 'text-base' : 'text-[19px]')}>Snabba genvägar</h2>
              {!isSmall && <p className="m-0 text-[13px] text-slate-500">Det du använder mest ska ligga först och kräva så lite scroll som möjligt.</p>}
            </div>
            <div className="flex items-center gap-2">
              {isSmall && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                  Svep för fler
                  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="#94a3b8" d="M8 5l7 7-7 7"/></svg>
                </span>
              )}
              <button onClick={()=>setMini(true)} className={miniToggleBtnClass} aria-label="Minimera och visa endast ikoner" title="Minimera och visa endast ikoner">Minimera</button>
            </div>
          </div>
          {isSmall ? (
            <QuickLinksStrip links={links} compact={true} extraCompact={isXS} />
          ) : (
            <QuickLinksGrid links={links} compact={false} extraCompact={false} />
          )}
        </div>
      )}
    </section>
  );

  return (
    <>
      {newsItem && (
        <NewsModal open={newsOpen} item={newsItem} onClose={closeNews} />
      )}
    <main className="dash-layout" style={isDesktop ? desktopShellStyle : {
      padding: isSmall ? (isXS ? 10 : 14) : 24,
      maxWidth: mini ? 1400 : 1200,
      margin: '0 auto',
      display: 'flex',
      flexDirection: mini ? 'row' : 'column',
      gap: mini ? 24 : (isSmall ? 20 : 32),
      alignItems: mini ? 'flex-start' : 'stretch'
    }}>
      {isDesktop ? (
        <>
          <aside style={desktopRailStyle}>
            <section style={desktopQuickLinksCardStyle}>
              <div className="grid gap-1">
                <h2 className="m-0 text-lg text-slate-900">Snabba genvägar</h2>
                <p className="m-0 text-[12.5px] leading-[1.45] text-slate-500">Lägg det du öppnar ofta nära till hands i stället för mitt i arbetsflödet.</p>
              </div>
              <QuickLinksSidebar links={desktopSidebarLinks} />
              {links.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllDesktopLinks((prev) => !prev)}
                  className={cn(miniToggleBtnClass, 'w-full justify-center px-3 py-2.5 text-[12.5px] font-bold')}
                >
                  {showAllDesktopLinks ? 'Visa färre' : `Visa fler (${links.length - 6})`}
                </button>
              )}
            </section>
          </aside>

          <div className="dash-main-col" style={desktopMainStyle}>
            {renderHeroSection(false)}

            <SectionCard className={cn(isSmall ? (isXS ? 'rounded-[18px] p-[14px]' : 'rounded-[18px] p-[18px]') : 'rounded-[20px] p-6', 'grid gap-[22px] shadow-[0_10px_26px_rgba(15,23,42,0.04)] min-h-0')}>
              <DashboardNotes compact desktopMode />
            </SectionCard>

            {effectiveRole !== 'sales' && (
              <section style={surfaceCardStyle}>
                <DashboardSchedule compact={false} onReportTime={(info: { projectId?: string; projectName?: string; orderNumber?: string; day?: string }) => {
                  const label = info.orderNumber ? `#${info.orderNumber}` : (info.projectName || info.projectId || '');
                  setTimePrefill({ project: label, projectId: info.projectId, date: info.day });
                  setTimeModalOpen(true);
                }} />
              </section>
            )}
          </div>

          <aside style={desktopRailStyle}>
            {showDesktopApprovals && (
              <section style={desktopDenseCardStyle}>
                <DashboardDocumentApprovals compact hideWhenEmpty onVisibilityChange={setShowDesktopApprovals} />
              </section>
            )}
            {showDesktopTasks && (
              <section style={desktopDenseCardStyle}>
                <DashboardTasks compact hideWhenEmpty onVisibilityChange={setShowDesktopTasks} />
              </section>
            )}
          </aside>
        </>
      ) : (
        <>
          {mini && (
            <aside className="dash-sidebar sticky top-3 flex min-w-[72px] flex-col gap-3.5">
              <div className="flex justify-center">
                <button onClick={()=>setMini(false)} className={miniToggleBtnClass} aria-label="Expandera genvägar">»</button>
              </div>
              <QuickLinksIconBar links={links} />
            </aside>
          )}
          <div className="dash-main-col" style={{ flex:1, display:'flex', flexDirection:'column', gap: mini ? 24 : (isSmall ? 20 : 32) }}>
            {renderHeroSection(true)}

            {effectiveRole !== 'sales' && (
              <div className={cn(isSmall ? 'order-[-1]' : 'order-none')}>
                <DashboardSchedule compact={isSmall || mini} onReportTime={(info: { projectId?: string; projectName?: string; orderNumber?: string; day?: string }) => {
                  const label = info.orderNumber ? `#${info.orderNumber}` : (info.projectName || info.projectId || '');
                  setTimePrefill({ project: label, projectId: info.projectId, date: info.day });
                  setTimeModalOpen(true);
                }} />
              </div>
            )}
            <SectionCard className={cn(isSmall ? (isXS ? 'rounded-[18px] p-[14px]' : 'rounded-[18px] p-[18px]') : 'rounded-[20px] p-6', 'grid gap-[22px] shadow-[0_10px_26px_rgba(15,23,42,0.04)]', mini ? 'order-[-1]' : 'order-none')}>
              <DashboardDocumentApprovals compact={isSmall || mini} />
            </SectionCard>
            <SectionCard className={cn(isSmall ? (isXS ? 'rounded-[18px] p-[14px]' : 'rounded-[18px] p-[18px]') : 'rounded-[20px] p-6', 'grid gap-[22px] shadow-[0_10px_26px_rgba(15,23,42,0.04)]', mini ? 'order-[-1]' : 'order-none')}>
              <DashboardTasks compact={isSmall || mini} />
            </SectionCard>
            <SectionCard className={cn(isSmall ? (isXS ? 'rounded-[18px] p-[14px]' : 'rounded-[18px] p-[18px]') : 'rounded-[20px] p-6', 'grid gap-[22px] shadow-[0_10px_26px_rgba(15,23,42,0.04)]', mini ? 'order-[-1]' : 'order-none')}>
              <DashboardNotes compact={isSmall || mini} />
            </SectionCard>
          </div>
        </>
      )}
      <TimeReportModal open={timeModalOpen} onClose={()=>setTimeModalOpen(false)}
        initialProject={timePrefill?.project || null}
        initialProjectId={timePrefill?.projectId || null}
        initialDate={timePrefill?.date || null}
        onSubmit={async (payload)=>{
        try {
          const minutes = Math.round(payload.totalHours * 60);
          const body = {
            date: payload.date,
            minutes,
            breakMinutes: payload.breakMinutes,
            start: payload.start,
            end: payload.end,
            projectId: payload.reportType === 'project' && payload.projectId ? Number(payload.projectId) : undefined,
            internalProjectId: payload.reportType === 'internal' && payload.internalProjectId ? Number(payload.internalProjectId) : undefined,
            absenceProjectId: payload.reportType === 'absence' && payload.absenceProjectId ? Number(payload.absenceProjectId) : undefined,
            activityId: payload.activityId ? Number(payload.activityId) : undefined,
            timeCodeId: payload.timecodeId ? Number(payload.timecodeId) : undefined,
            description: payload.description || undefined,
          };
          console.debug('[time-report] creating', body);
          const url = process.env.NODE_ENV !== 'production' ? '/api/blikk/time-reports?debug=1' : '/api/blikk/time-reports';
          const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const json = await res.json().catch(()=>({}));
          if (!res.ok || !json.ok) {
            console.warn('Time report create failed', json);
            toast.error(json?.error || 'Misslyckades att spara tid');
          } else {
            console.debug('Time report created', json);
            toast.success('Tidrapport sparad');
          }
        } catch (e:any) {
          console.warn('Time report create error', e);
          try { toast.error('Fel vid sparande av tid'); } catch {}
        }
      }} />
    </main>
    </>
  );
}

"use client";
import React, { useMemo, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { QuickLinksGrid, QuickLink } from './QuickLinks';
import DashboardNotes from './DashboardNotes';
const DashboardSchedule = dynamic(() => import('./DashboardSchedule'));
import DashboardTasks from './DashboardTasks';
import DashboardDocumentApprovals from './DashboardDocumentApprovals';
import TimeReportModal from './TimeReportModal';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { buildTimeReportBody } from '@/lib/domains/time-reports/payload';
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

const cardClass = cn(crm.cardInner, 'min-h-0');

export function ClientDashboard({ role }: { role: UserRole | null }) {
  const NEWS_SEEN_KEY = 'dashboard.news.lastSeenId';

  // konsult should have the same viewing permissions as sales.
  const effectiveRole: UserRole | null = role === 'konsult' ? 'sales' : role;

  const [isSmall, setIsSmall] = useState(false);
  useEffect(() => {
    const calc = () => setIsSmall(window.innerWidth <= 768);
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
        if (!lastSeen || lastSeen !== item.id) setNewsOpen(true);
      } catch { /* ignore */ }
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
        { href: '/offert/kalkylator', title: 'Kalkylator Försäljning Privat', ...baseExtra['/offert/kalkylator'] },
      ];
    }
    return [{ href: '/egenkontroll', title: 'Egenkontroll', ...baseExtra['/egenkontroll'] }];
  }, [effectiveRole, role]);

  const [timeModalOpen, setTimeModalOpen] = useState(false);
  const [timePrefill, setTimePrefill] = useState<{ project?: string; projectId?: string; date?: string } | null>(null);
  const toast = useToast();

  const todayMeta = useMemo(() => {
    const now = new Date();
    const weekday = now.toLocaleDateString('sv-SE', { weekday: 'long' });
    const monthDay = now.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' });
    const hour = now.getHours();
    const greeting = hour < 10 ? 'God morgon' : hour < 17 ? 'Hej' : 'God kväll';
    return { greeting, weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1), monthDay };
  }, []);

  const isMember = effectiveRole === 'member';
  const scheduleSection = effectiveRole !== 'sales' ? (
    <section className={cardClass}>
      <DashboardSchedule
        compact={isSmall}
        onReportTime={(info: { projectId?: string; projectName?: string; orderNumber?: string; day?: string }) => {
          const label = info.orderNumber ? `#${info.orderNumber}` : (info.projectName || info.projectId || '');
          setTimePrefill({ project: label, projectId: info.projectId, date: info.day });
          setTimeModalOpen(true);
        }}
      />
    </section>
  ) : null;

  return (
    <>
      {newsItem && <NewsModal open={newsOpen} item={newsItem} onClose={closeNews} />}

      <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-emerald-700">
              {todayMeta.greeting}
              <span className="h-1 w-1 rounded-full bg-emerald-500" />
              {todayMeta.weekday}
            </div>
            <h1 className="m-0 mt-1.5 text-xl font-bold tracking-tight text-slate-900">Översikt</h1>
            <p className="m-0 mt-1 text-sm text-slate-500">{todayMeta.monthDay} · fokus på det viktigaste först</p>
          </div>
          <button
            type="button"
            onClick={() => { setTimePrefill(null); setTimeModalOpen(true); }}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" fill="none" aria-hidden><path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Rapportera tid
          </button>
        </div>

        {/* Installers (members) get the work schedule first — their most important view */}
        {isMember && scheduleSection}

        {/* Quick links */}
        <section className={cn(crm.cardInner)}>
          <p className={cn('mb-3', crm.sectionTitle)}>Snabba genvägar</p>
          <QuickLinksGrid links={links} compact={isSmall} />
        </section>

        {/* Schedule below quick links for non-members (admin) */}
        {!isMember && scheduleSection}

        <section className={cardClass}>
          <DashboardDocumentApprovals compact={isSmall} />
        </section>
        <section className={cardClass}>
          <DashboardTasks compact={isSmall} />
        </section>
        <section className={cardClass}>
          <DashboardNotes compact={isSmall} />
        </section>
      </div>

      <TimeReportModal
        open={timeModalOpen}
        onClose={() => setTimeModalOpen(false)}
        initialProject={timePrefill?.project || null}
        initialProjectId={timePrefill?.projectId || null}
        initialDate={timePrefill?.date || null}
        onSubmit={async (payload) => {
          try {
            const body = buildTimeReportBody(payload as any);
            const url = process.env.NODE_ENV !== 'production' ? '/api/blikk/time-reports?debug=1' : '/api/blikk/time-reports';
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.ok) {
              toast.error(json?.error || 'Misslyckades att spara tid');
            } else {
              toast.success('Tidrapport sparad');
            }
          } catch {
            try { toast.error('Fel vid sparande av tid'); } catch { /* ignore */ }
          }
        }}
      />
    </>
  );
}

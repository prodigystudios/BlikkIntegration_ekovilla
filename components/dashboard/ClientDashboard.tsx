"use client";
import React, { useMemo, useEffect, useState } from 'react';
import { QuickLinksGrid, QuickLink, QuickLinksIconBar, QuickLinksStrip } from './QuickLinks';
import DashboardNotes from './DashboardNotes';
import dynamic from 'next/dynamic';
const DashboardSchedule = dynamic(() => import('./DashboardSchedule'));
import DashboardTasks from './DashboardTasks';
import TimeReportModal from './TimeReportModal';
import { useToast } from '@/lib/Toast';
import type { UserRole } from '../../lib/roles';
import { filterLinks, NAV_LINKS } from '../../lib/roles';
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
  '/korjournal': { desc: 'Registrera och granska resor', icon: (
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
  '/tidrapport': { desc: 'Veckovy & rapportera tid', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" fill="none" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M8 3v4M16 3v4" strokeLinecap="round" />
      <path d="M3 10h18" strokeLinecap="round" />
      <path d="M12 14v-2" strokeLinecap="round" />
      <path d="M12 14a3 3 0 1 0 3 3" strokeLinecap="round" />
    </svg>
  ) },
};
// Dashboard main component (expects role only after cleanup of deprecated userQuickHrefs prop)
export function ClientDashboard({ role }: { role: UserRole | null }) {
  const NEWS_SEEN_KEY = 'dashboard.news.lastSeenId';

  // konsult should have the same viewing permissions as sales.
  const effectiveRole: UserRole | null = role === 'konsult' ? 'sales' : role;

  // Responsive flags (client-only)
  const [isSmall, setIsSmall] = useState(false); // <= 640px
  const [isXS, setIsXS] = useState(false); // <= 420px
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      setIsSmall(w <= 768);
      setIsXS(w <= 460);
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
    // Explicit role-based sets as requested
    if (effectiveRole === 'member') {
      return [
        { href: '/egenkontroll', title: 'Skapa egenkontroll', ...baseExtra['/egenkontroll'] },
        { href: '/bestallning-klader', title: 'Beställ kläder & annat', ...baseExtra['/bestallning-klader'] },
        { href: '/tidrapport', title: 'Tidrapport', ...baseExtra['/tidrapport'] },
        { href: '/kontakt-lista', title: 'Kontakt', ...baseExtra['/kontakt-lista'] },
        { href: '/dokument-information', title: 'Dokument & information', ...baseExtra['/dokument-information'] },
      ];
    }
    if (effectiveRole === 'sales') {
      return [
        { href: '/archive', title: 'Egenkontroll arkiv', ...baseExtra['/archive'] },
        { href: '/korjournal', title: 'Körjournal', ...baseExtra['/korjournal'] },
        { href: '/plannering', title: 'Planering', ...baseExtra['/planering'] },
        { href: '/kontakt-lista', title: 'Kontakt', ...baseExtra['/kontakt-lista'] },
      ];
    }
    if (effectiveRole === 'admin') {
      return [
        { href: '/egenkontroll', title: 'Ny egenkontroll', ...baseExtra['/egenkontroll'] },
        { href: '/archive', title: 'Egenkontroll arkiv', ...baseExtra['/archive'] },
        { href: '/korjournal', title: 'Körjournal', ...baseExtra['/korjournal'] },
        { href: '/plannering', title: 'Planering', ...baseExtra['/planering'] },
        { href: '/tidrapport', title: 'Tidrapport', ...baseExtra['/tidrapport'] },
        { href: '/admin', title: 'Admin', ...baseExtra['/admin'] },
        { href: '/offert', title: 'Skapa offert', ...baseExtra['/offert'] },
      ];
    }
    // Fallback before role known: minimal set
    return [
      { href: '/egenkontroll', title: 'Egenkontroll', ...baseExtra['/egenkontroll'] },
    ];
  }, [effectiveRole]);
  const [mini, setMini] = useState(false);
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

  return (
    <>
      {newsItem && (
        <NewsModal open={newsOpen} item={newsItem} onClose={closeNews} />
      )}
    <main
      className="dash-layout"
      style={{
        padding: isSmall ? (isXS ? 10 : 14) : 24,
        maxWidth: mini ? 1400 : 1200,
        margin: '0 auto',
        display: 'flex',
        flexDirection: mini ? 'row' : 'column',
        gap: mini ? 24 : (isSmall ? 20 : 32),
        alignItems: mini ? 'flex-start' : 'stretch'
      }}
    >
      {mini && (
        <aside className="dash-sidebar" style={{ position:'sticky', top: 12, display:'flex', flexDirection:'column', gap:14, minWidth:72 }}>
          <div style={{ display:'flex', justifyContent:'center' }}>
            <button onClick={()=>setMini(false)} style={miniToggleBtn} aria-label="Expandera genvägar">»</button>
          </div>
          <QuickLinksIconBar links={links} />
        </aside>
      )}
      <div className="dash-main-col" style={{ flex:1, display:'flex', flexDirection:'column', gap: mini ? 24 : (isSmall ? 20 : 32) }}>
        <header style={{ display: 'flex', alignItems: isSmall ? 'flex-end' : 'center', gap: 12, justifyContent:'space-between', flexWrap:'wrap' }}>
          <h1 style={{ margin: 0, fontSize: isSmall ? (isXS ? 22 : 24) : 30, letterSpacing: -0.5 }}>Översikt</h1>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <button type="button" onClick={()=>{ setTimePrefill(null); setTimeModalOpen(true); }}
              style={{ display:'inline-flex', alignItems:'center', gap:8, fontSize:12, fontWeight:600, padding:'10px 14px', border:'1px solid #16a34a', background:'#16a34a', color:'#fff', borderRadius:10, boxShadow:'0 2px 4px rgba(16,185,129,0.35)', cursor:'pointer' }}
            >
              <span aria-hidden style={{ display:'inline-flex' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth={2} stroke="#fff" fill="none"><path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </span>
              Rapportera tid
            </button>
          </div>
        </header>
        {!mini && (
          <section
            style={{
              border: '1px solid #e5e7eb',
              background: '#fff',
              borderRadius: 16,
              padding: isSmall ? (isXS ? 10 : 14) : 24,
              display: 'grid',
              gap: isSmall ? 10 : 20,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap:12 }}>
              <h2 style={{ margin: 0, fontSize: isSmall ? 16 : 20 }}>Snabba genvägar</h2>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <button onClick={()=>setMini(true)} style={miniToggleBtn} aria-label="Minimera och visa endast ikoner" title="Minimera och visa endast ikoner">Minimera</button>
              </div>
            </div>
            {isSmall && (
              <div style={{ display:'flex', alignItems:'center', gap:6, color:'#64748b', fontSize:11 }}>
                <span>Svep i sidled för fler genvägar</span>
                <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="#94a3b8" d="M8 5l7 7-7 7"/></svg>
              </div>
            )}
            {isSmall ? (
              <QuickLinksStrip links={links} compact={true} extraCompact={isXS} />
            ) : (
              <QuickLinksGrid links={links} compact={false} extraCompact={false} />
            )}
          </section>
        )}
        {/* Tasks section */}
        <section
          style={{
            border: '1px solid #e5e7eb',
            background: '#fff',
            borderRadius: 16,
            padding: isSmall ? (isXS ? 14 : 18) : 24,
            display: 'grid',
            gap: isSmall ? 18 : 24,
            order: mini ? -1 : 0
          }}
        >
          <DashboardTasks compact={isSmall || mini} />
        </section>

        {/* Notes always visible; floats to top when mini */}
        <section
          style={{
            border: '1px solid #e5e7eb',
            background: '#fff',
            borderRadius: 16,
            padding: isSmall ? (isXS ? 14 : 18) : 24,
            display: 'grid',
            gap: isSmall ? 18 : 24,
            order: mini ? -1 : 0
          }}
        >
          <DashboardNotes compact={isSmall || mini} />
        </section>

        {/* Admin-only: Work schedule for current/next week */}
        {effectiveRole !== 'sales' && (
          <div style={{ order: isSmall ? -2 as any : 0 }}>
            <DashboardSchedule compact={isSmall || mini} onReportTime={(info: { projectId?: string; projectName?: string; orderNumber?: string; day?: string }) => {
              const label = info.orderNumber ? `#${info.orderNumber}` : (info.projectName || info.projectId || '');
              setTimePrefill({ project: label, projectId: info.projectId, date: info.day });
              setTimeModalOpen(true);
            }} />
          </div>
        )}
      </div>
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

const miniToggleBtn: React.CSSProperties = {
  border:'1px solid #e5e7eb',
  background:'#fff',
  borderRadius:8,
  padding:'6px 10px',
  cursor:'pointer',
  fontSize:14,
  lineHeight:1,
  boxShadow:'0 2px 4px rgba(0,0,0,0.06)',
  color:'#374151',
};

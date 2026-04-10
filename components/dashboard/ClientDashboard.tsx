"use client";
import React, { useMemo, useEffect, useState } from 'react';
import { QuickLinksGrid, QuickLink, QuickLinksIconBar, QuickLinksStrip } from './QuickLinks';
import DashboardNotes from './DashboardNotes';
import dynamic from 'next/dynamic';
const DashboardSchedule = dynamic(() => import('./DashboardSchedule'));
import DashboardTasks from './DashboardTasks';
import DashboardDocumentApprovals from './DashboardDocumentApprovals';
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
  '/dokument': { desc: 'Dokumentbibliotek', icon: (
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
    if (role === 'konsult') {
      return [
        { href: '/offert/kalkylator', title: 'Kalkylator Försäljning Privat', ...baseExtra['/offert/kalkylator'] },
        { href: '/plannering', title: 'Planering', ...baseExtra['/planering'] },
        { href: '/dokument', title: 'Dokument', ...baseExtra['/dokument'] },
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
        { href: '/archive', title: 'Egenkontroll arkiv', ...baseExtra['/archive'] },
        { href: '/korjournal', title: 'Körjournal', ...baseExtra['/korjournal'] },
        { href: '/plannering', title: 'Planering', ...baseExtra['/planering'] },
        { href: '/kontakt-lista', title: 'Kontakt', ...baseExtra['/kontakt-lista'] },
        { href: '/mina-dokument', title: 'Mina dokument', ...baseExtra['/mina-dokument'] },
        { href: '/dokument', title: 'Dokument', ...baseExtra['/dokument'] },
        { href: '/offert/kalkylator', title: 'Kalkylator Försäljning Privat', ...baseExtra['/offert/kalkylator'] },
      ];
    }
    if (effectiveRole === 'admin') {
      return [
        { href: '/egenkontroll', title: 'Ny egenkontroll', ...baseExtra['/egenkontroll'] },
        { href: '/archive', title: 'Egenkontroll arkiv', ...baseExtra['/archive'] },
        { href: '/korjournal', title: 'Körjournal', ...baseExtra['/korjournal'] },
        { href: '/plannering', title: 'Planering', ...baseExtra['/planering'] },
        { href: '/tidrapport', title: 'Tidrapport', ...baseExtra['/tidrapport'] },
        { href: '/mina-dokument', title: 'Mina dokument', ...baseExtra['/mina-dokument'] },
        { href: '/dokument', title: 'Dokument', ...baseExtra['/dokument'] },
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

  const heroCardStyle: React.CSSProperties = {
    border: '1px solid #dbe4ef',
    background: 'linear-gradient(135deg, #f7fbf8 0%, #eff8f1 48%, #f8fbff 100%)',
    borderRadius: 22,
    padding: isSmall ? (isXS ? 14 : 16) : 24,
    display: 'grid',
    gap: isSmall ? 12 : 18,
    boxShadow: '0 14px 34px rgba(15, 23, 42, 0.06)',
    overflow: 'hidden',
    position: 'relative'
  };

  const surfaceCardStyle: React.CSSProperties = {
    border: '1px solid #e5e7eb',
    background: '#fff',
    borderRadius: isSmall ? 18 : 20,
    padding: isSmall ? (isXS ? 14 : 18) : 24,
    display: 'grid',
    gap: isSmall ? 16 : 22,
    boxShadow: '0 10px 26px rgba(15, 23, 42, 0.04)'
  };

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
        <section style={heroCardStyle}>
          <div style={{ position:'absolute', right: isSmall ? -26 : -18, top: isSmall ? -42 : -54, width: isSmall ? 140 : 190, height: isSmall ? 140 : 190, borderRadius:'50%', background:'radial-gradient(circle, rgba(22,163,74,0.14) 0%, rgba(22,163,74,0) 70%)' }} />
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent:'space-between', gap: 12, flexWrap:'wrap', position:'relative' }}>
            <div style={{ display:'grid', gap: isSmall ? 8 : 10, maxWidth: 680 }}>
              <div style={{ display:'inline-flex', alignItems:'center', gap:8, width:'fit-content', padding:'6px 10px', borderRadius:999, background:'rgba(255,255,255,0.82)', border:'1px solid #d9e5dc', color:'#166534', fontSize:11, fontWeight:700, letterSpacing:0.3, textTransform:'uppercase' }}>
                {todayMeta.greeting}
                <span style={{ width:4, height:4, borderRadius:'50%', background:'#22c55e' }} />
                {todayMeta.weekday}
              </div>
              <div style={{ display:'grid', gap:6 }}>
                <h1 style={{ margin: 0, fontSize: isSmall ? (isXS ? 26 : 30) : 38, lineHeight: 1.02, letterSpacing: -1.1, color:'#0f172a' }}>Översikt</h1>
                <p style={{ margin: 0, fontSize: isSmall ? 13 : 16, lineHeight: 1.4, color:'#475569', maxWidth: isSmall ? 520 : 560 }}>
                  Börja med dagens viktigaste saker. Snabb åtkomst till tidrapport, dokument och dina vanligaste genvägar.
                </p>
              </div>
            </div>
            <div style={{ display:'grid', gap:10, minWidth: isSmall ? '100%' : 240 }}>
              <button type="button" onClick={()=>{ setTimePrefill(null); setTimeModalOpen(true); }}
                style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', gap:8, fontSize:13, fontWeight:700, padding: isSmall ? '12px 16px' : '13px 18px', border:'1px solid #16a34a', background:'#16a34a', color:'#fff', borderRadius:14, boxShadow:'0 12px 20px rgba(22,163,74,0.18)', cursor:'pointer' }}
              >
                <span aria-hidden style={{ display:'inline-flex' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth={2} stroke="#fff" fill="none"><path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </span>
                Rapportera tid
              </button>
              <div style={{ display:'grid', gridTemplateColumns: isSmall ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap:10 }}>
                <div style={{ border:'1px solid rgba(148,163,184,0.24)', background:'rgba(255,255,255,0.72)', borderRadius:16, padding: isSmall ? '10px 12px' : '12px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
                  <div style={{ display:'grid', gap:2 }}>
                    <span style={{ fontSize:11, fontWeight:700, letterSpacing:0.3, textTransform:'uppercase', color:'#64748b' }}>Idag</span>
                    <strong style={{ fontSize: isSmall ? 15 : 16, color:'#0f172a' }}>{todayMeta.monthDay}</strong>
                  </div>
                  <span style={{ fontSize:12, color:'#64748b' }}>Fokus på det viktigaste först.</span>
                </div>
                {!isSmall && (
                  <div style={{ border:'1px solid rgba(148,163,184,0.24)', background:'rgba(255,255,255,0.72)', borderRadius:16, padding:'12px 14px', display:'grid', gap:4 }}>
                    <span style={{ fontSize:11, fontWeight:700, letterSpacing:0.3, textTransform:'uppercase', color:'#64748b' }}>Snabbt nu</span>
                    <strong style={{ fontSize: 16, color:'#0f172a' }}>Öppna dokument</strong>
                    <a href="/mina-dokument" style={{ fontSize:12, fontWeight:700, color:'#2563eb', textDecoration:'none' }}>Gå till mina dokument</a>
                  </div>
                )}
              </div>
            </div>
          </div>

          {!mini && (
            <div style={{ display:'grid', gap: isSmall ? 8 : 10 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
                <div style={{ display:'grid', gap:4 }}>
                  <h2 style={{ margin:0, fontSize:isSmall ? 16 : 19, color:'#0f172a' }}>Snabba genvägar</h2>
                  {!isSmall && <p style={{ margin:0, fontSize:13, color:'#64748b' }}>Det du använder mest ska ligga först och kräva så lite scroll som möjligt.</p>}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {isSmall && (
                    <span style={{ display:'inline-flex', alignItems:'center', gap:6, color:'#64748b', fontSize:11 }}>
                      Svep för fler
                      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="#94a3b8" d="M8 5l7 7-7 7"/></svg>
                    </span>
                  )}
                  <button onClick={()=>setMini(true)} style={miniToggleBtn} aria-label="Minimera och visa endast ikoner" title="Minimera och visa endast ikoner">Minimera</button>
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

        {effectiveRole !== 'sales' && (
          <div style={{ order: isSmall ? -1 as any : 0 }}>
            <DashboardSchedule compact={isSmall || mini} onReportTime={(info: { projectId?: string; projectName?: string; orderNumber?: string; day?: string }) => {
              const label = info.orderNumber ? `#${info.orderNumber}` : (info.projectName || info.projectId || '');
              setTimePrefill({ project: label, projectId: info.projectId, date: info.day });
              setTimeModalOpen(true);
            }} />
          </div>
        )}
        {/* Tasks section */}
        <section
          style={{
            ...surfaceCardStyle,
            order: mini ? -1 : 0
          }}
        >
          <DashboardDocumentApprovals compact={isSmall || mini} />
        </section>

        <section
          style={{
            ...surfaceCardStyle,
            order: mini ? -1 : 0
          }}
        >
          <DashboardTasks compact={isSmall || mini} />
        </section>

        {/* Notes always visible; floats to top when mini */}
        <section
          style={{
            ...surfaceCardStyle,
            order: mini ? -1 : 0
          }}
        >
          <DashboardNotes compact={isSmall || mini} />
        </section>
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

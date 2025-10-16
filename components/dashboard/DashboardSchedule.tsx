"use client";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

type WeekMode = 'current' | 'next';

function startOfISOWeek(d: Date) {
  const day = d.getDay(); // 0..6, 1=Mon
  const mondayDelta = (day + 6) % 7; // days since Monday
  const res = new Date(d);
  res.setHours(0, 0, 0, 0);
  res.setDate(res.getDate() - mondayDelta);
  return res;
}
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function toISODateLocal(d: Date) { const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }

export default function DashboardSchedule({ compact = false }: { compact?: boolean }) {
  const supabase = createClientComponentClient();
  const [mode, setMode] = useState<WeekMode>('current');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [dayIdx, setDayIdx] = useState<number | null>(() => {
    // Default to current weekday (Mon=0..Fri=4). On weekend, show all (null).
    const dow = new Date().getDay(); // Sun=0 .. Sat=6
    return dow >= 1 && dow <= 5 ? dow - 1 : null;
  }); // 0=Mon .. 4=Fri, null=all

  // Detail modal state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<any | null>(null);
  const [detailBase, setDetailBase] = useState<any | null>(null);
  const [reportDraft, setReportDraft] = useState<{ day: string; amount: string }>({ day: '', amount: '' });

  type SegmentReport = { id: string; segment_id: string; report_day: string; amount: number; created_by: string | null; created_by_name: string | null; created_at: string };
  const [segmentReportsMap, setSegmentReportsMap] = useState<Record<string, SegmentReport[]>>({}); // key: segment_id

  const openDetail = useCallback(async (it: any) => {
    setDetailOpen(true);
    setDetailBase(it);
    setDetailError(null);
    setDetailData(null);
    // Default report draft: clamp to job range if possible
    try {
      const s = (it.start_day as string) || null;
      const e = (it.end_day as string) || s;
      const today = toISODateLocal(new Date());
      const def = s && e && s <= today && today <= e ? today : (s || today);
      setReportDraft({ day: def, amount: '' });
    } catch { setReportDraft({ day: '', amount: '' }); }
    // Load reports for this segment lazily if not present
    if (it.segment_id) {
      try {
        const known = segmentReportsMap[it.segment_id];
        if (!known) {
          const { data: rows } = await supabase
            .from('planning_segment_reports')
            .select('id, segment_id, report_day, amount, created_by, created_by_name, created_at')
            .eq('segment_id', it.segment_id)
            .order('report_day');
          if (Array.isArray(rows)) {
            setSegmentReportsMap(prev => ({ ...prev, [it.segment_id]: rows as any }));
          }
        }
      } catch { /* ignore */ }
    }
    // Try to enrich from Blikk API by order number, fallback to id
    const fetchViaLookup = async (): Promise<any | null> => {
      try {
        if (it.order_number) {
          const r = await fetch(`/api/projects/lookup?orderId=${encodeURIComponent(String(it.order_number))}`);
          const j = await r.json();
          if (r.ok) return j;
        }
      } catch { /* ignore */ }
      try {
        const idNum = Number(it.project_id);
        if (Number.isFinite(idNum) && idNum > 0) {
          const r = await fetch(`/api/projects/lookup?id=${idNum}`);
          const j = await r.json();
          if (r.ok) return j;
        }
      } catch { /* ignore */ }
      return null;
    };
    setDetailLoading(true);
    try {
      const j = await fetchViaLookup();
      if (j) setDetailData(j);
    } catch (e: any) {
      setDetailError(String(e?.message || e));
    } finally {
      setDetailLoading(false);
    }
  }, []);
  const closeDetail = useCallback(() => { setDetailOpen(false); setDetailData(null); setDetailBase(null); setDetailError(null); }, []);

  const range = useMemo(() => {
    const today = new Date();
    const weekStart = startOfISOWeek(today);
    const base = mode === 'current' ? weekStart : addDays(weekStart, 7);
    const startISO = toISODateLocal(base);
    const endISO = toISODateLocal(addDays(base, 6));
    const label = mode === 'current' ? 'Denna vecka' : 'Nästa vecka';
    // Build Mon..Sun ISO dates; only show Mon..Fri selector
    const days = Array.from({ length: 7 }, (_, i) => toISODateLocal(addDays(base, i)));
    return { startISO, endISO, label, weekStartISO: startISO, days };
  }, [mode]);

  useEffect(() => {
    // Load current user and name
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setCurrentUserId(user.id);
          let resolvedName: string | null = null;
          try {
            const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
            if (profile && (profile as any).full_name) resolvedName = (profile as any).full_name as string;
          } catch {}
          if (!resolvedName) {
            const meta: any = user.user_metadata || {};
            resolvedName = meta.full_name || meta.name || (user.email ? user.email.split('@')[0] : null);
          }
          setCurrentUserName(resolvedName);
        }
      } catch {}
    })();
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_my_jobs', { start_date: range.startISO, end_date: range.endISO });
        if (!cancelled) {
          if (error) {
            console.warn('[dashboard schedule] get_my_jobs error', error);
            setItems([]);
          } else {
            setItems(Array.isArray(data) ? data : []);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, range.startISO, range.endISO]);

  // When items change, fetch reports for listed segments
  useEffect(() => {
    const ids = Array.from(new Set((items.map(it => it.segment_id) as Array<unknown>)
      .filter((v): v is string => typeof v === 'string' && v.length > 0)));
    if (ids.length === 0) return;
    (async () => {
      try {
        const { data: rows } = await supabase
          .from('planning_segment_reports')
          .select('id, segment_id, report_day, amount, created_by, created_by_name, created_at')
          .in('segment_id', ids);
        if (Array.isArray(rows)) {
          const grouped: Record<string, SegmentReport[]> = {};
          for (const r of rows as any as SegmentReport[]) {
            if (!grouped[r.segment_id]) grouped[r.segment_id] = [];
            grouped[r.segment_id].push(r);
          }
          setSegmentReportsMap(prev => ({ ...prev, ...grouped }));
        }
      } catch {}
    })();
  }, [items, supabase]);

  // Realtime updates for segment reports
  useEffect(() => {
    const channel = supabase.channel('dashboard-segment-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_segment_reports' }, payload => {
        const row: any = payload.new || payload.old;
        if (!row?.segment_id) return;
        setSegmentReportsMap(prev => {
          const arr = prev[row.segment_id] ? [...prev[row.segment_id]] : [];
          if (payload.eventType === 'INSERT') {
            // avoid dup
            if (!arr.some(x => x.id === row.id)) arr.push(row);
          } else if (payload.eventType === 'UPDATE') {
            const i = arr.findIndex(x => x.id === row.id);
            if (i >= 0) arr[i] = row; else arr.push(row);
          } else if (payload.eventType === 'DELETE') {
            const i = arr.findIndex(x => x.id === row.id);
            if (i >= 0) arr.splice(i, 1);
          }
          // sort by day
          arr.sort((a, b) => (a.report_day || '').localeCompare(b.report_day));
          return { ...prev, [row.segment_id]: arr };
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase]);

  const reportedBySegment = useMemo(() => {
    const map = new Map<string, number>();
    for (const [segId, list] of Object.entries(segmentReportsMap)) {
      map.set(segId, list.reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
    }
    return map;
  }, [segmentReportsMap]);

  const addPartialReport = useCallback(async () => {
    const segId = detailBase?.segment_id as string | undefined;
    if (!segId) return;
    const amount = parseInt(reportDraft.amount, 10);
    const day = reportDraft.day;
    if (!Number.isFinite(amount) || amount <= 0 || !day) return;
    const payload: any = {
      segment_id: segId,
      report_day: day,
      amount,
      created_by: currentUserId,
      created_by_name: currentUserName || null
    };
    const { data, error } = await supabase.from('planning_segment_reports').insert(payload).select('*').single();
    if (!error) {
      setReportDraft(d => ({ ...d, amount: '' }));
      // Also withdraw from correct depot with idempotency key based on this partial report
      try {
        const jt = String(detailBase?.job_type || '').toLowerCase();
        const materialKind = jt.startsWith('vit') ? 'Vitull' : (jt.startsWith('eko') ? 'Ekovilla' : undefined);
        await fetch('/api/planning/consume-bags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: String(detailBase?.project_id || ''),
            installationDate: day,
            totalBags: amount,
            segmentId: segId,
            reportKey: data?.id ? `partial:${data.id}` : undefined,
            materialKind,
          })
        });
      } catch {}
    }
  }, [detailBase?.segment_id, detailBase?.job_type, detailBase?.project_id, reportDraft.amount, reportDraft.day, supabase, currentUserId, currentUserName]);

  const deletePartialReport = useCallback(async (id: string) => {
    await supabase.from('planning_segment_reports').delete().eq('id', id);
  }, [supabase]);

  const grouped = useMemo(() => {
    // If a specific Mon..Fri day is selected, show only jobs that include that date (start..end inclusive)
    if (dayIdx != null) {
      const selISO = range.days[dayIdx];
      const arr = items.filter((it) => {
        const s = (it.start_day as string) || selISO;
        const e = (it.end_day as string) || s;
        return s <= selISO && selISO <= e;
      });
      return arr.length ? [{ day: selISO, arr }] : [];
    }
    // Otherwise group by start_day (fallback)
    const map = new Map<string, any[]>();
    for (const it of items) {
      const k = (it.start_day as string) || 'okänd';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return Array.from(map.entries()).sort(([a],[b]) => a.localeCompare(b, 'sv')).map(([day, arr]) => ({ day, arr }));
  }, [items, dayIdx, range.days]);

  // Visual theme based on job type/material
  const getMaterialTheme = useCallback((jobType?: string) => {
    const jt = (jobType || '').toLowerCase();
    if (jt.startsWith('eko')) return { accent: '#16a34a', badgeBg: '#dcfce7', badgeFg: '#166534', label: 'Ekovilla' };
    if (jt.startsWith('vit')) return { accent: '#0284c7', badgeBg: '#e0f2fe', badgeFg: '#075985', label: 'Vitull' };
    return { accent: '#64748b', badgeBg: '#f1f5f9', badgeFg: '#334155', label: null as string | null };
  }, []);

  return (
    <section
      style={{
        border: '1px solid #e5e7eb',
        background: '#fff',
        borderRadius: 16,
        padding: compact ? 10 : 18,
        display: 'grid',
        gap: compact ? 8 : 14,
      }}
    >
      <div style={{ display:'flex', alignItems:'center', gap:compact ? 6 : 10, flexWrap:'wrap' }}>
        <h2 style={{ margin:0, fontSize: compact ? 14 : 16 }}>Arbetsschema</h2>
        <span style={{ fontSize: compact ? 11 : 12, color:'#64748b' }}>{range.label} • {range.startISO} – {range.endISO}</span>
        <div style={{ marginLeft:'auto', display:'inline-flex', gap:6, flexWrap:'wrap' }}>
          <button
            type="button"
            onClick={()=>setMode('current')}
            aria-pressed={mode==='current'}
            style={{
              fontSize: compact ? 11 : 12,
              padding: compact ? '2px 7px' : '4px 10px',
              border:'1px solid ' + (mode==='current' ? '#111827' : '#e5e7eb'),
              borderRadius:8,
              background:'#fff',
              color:'#111827',
              fontWeight: mode==='current' ? 600 : 500,
            }}
          >Denna vecka</button>
          <button
            type="button"
            onClick={()=>setMode('next')}
            aria-pressed={mode==='next'}
            style={{
              fontSize: compact ? 11 : 12,
              padding: compact ? '2px 7px' : '4px 10px',
              border:'1px solid ' + (mode==='next' ? '#111827' : '#e5e7eb'),
              borderRadius:8,
              background:'#fff',
              color:'#111827',
              fontWeight: mode==='next' ? 600 : 500,
            }}
          >Nästa vecka</button>
        </div>
      </div>

      {/* Mon–Fri selector */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
        <span style={{ fontSize:12, color:'#64748b' }}>Visa dag:</span>
        {['Mån','Tis','Ons','Tor','Fre'].map((label, idx) => {
          const active = dayIdx===idx;
          return (
            <button
              key={label}
              type="button"
              onClick={() => setDayIdx(idx)}
              aria-pressed={active}
              style={{
                fontSize: compact ? 11 : 12,
                padding: compact ? '4px 9px' : '6px 12px',
                border:'1px solid ' + (active ? '#0284c7' : '#e2e8f0'),
                borderRadius:999,
                background: active ? '#0284c7' : '#f8fafc',
                color: active ? '#ffffff' : '#334155',
                fontWeight: active ? 700 : 500,
                boxShadow: active ? '0 1px 1px rgba(2,132,199,0.25)' : '0 1px 1px rgba(0,0,0,0.02)'
              }}
              title={range.days[idx]}
            >{label}</button>
          );
        })}
        {(() => {
          const active = dayIdx==null;
          return (
            <button
              type="button"
              onClick={() => setDayIdx(null)}
              aria-pressed={active}
              style={{
                fontSize: compact ? 11 : 12,
                padding: compact ? '4px 9px' : '6px 12px',
                border:'1px solid ' + (active ? '#0284c7' : '#e2e8f0'),
                borderRadius:999,
                background: active ? '#0284c7' : '#f8fafc',
                color: active ? '#ffffff' : '#334155',
                fontWeight: active ? 700 : 500,
                boxShadow: active ? '0 1px 1px rgba(2,132,199,0.25)' : '0 1px 1px rgba(0,0,0,0.02)'
              }}
            >Alla</button>
          );
        })()}
      </div>

      {loading && <div style={{ fontSize:12, color:'#64748b' }}>Laddar…</div>}
      {!loading && grouped.length === 0 && <div style={{ fontSize:12, color:'#64748b' }}>Inga jobb planerade för vald period.</div>}

      {!loading && grouped.length > 0 && (
        <div style={{ display:'grid', gap: compact ? 8 : 10 }}>
          {grouped.map(({ day, arr }) => (
            <div key={day} style={{ display:'grid', gap: compact ? 4 : 6 }}>
              <div style={{ fontWeight:600, fontSize: compact ? 11 : 12, color:'#0f172a' }}>{day}</div>
              <div style={{ display:'grid', gap: compact ? 6 : 8 }}>
                {arr.map((it: any) => {
                  const title = [it.order_number ? String(it.order_number) : null, it.project_name].filter(Boolean).join(' - ');
                  const theme = getMaterialTheme(it.job_type);
                  const bagLabel = typeof it.bag_count === 'number' ? `${it.bag_count} säckar${theme.label ? ' ' + theme.label : ''}` : null;
                  const reported = it.segment_id ? (reportedBySegment.get(it.segment_id) || 0) : 0;
                  return (
                    <div
                      key={it.segment_id || `${it.project_id}|${it.start_day}`}
                      onClick={() => openDetail(it)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(it); } }}
                      role="button"
                      tabIndex={0}
                      style={{
                        border:'1px solid #e5e7eb',
                        borderLeft: `4px solid ${theme.accent}`,
                        borderRadius:10,
                        padding: compact ? 8 : 10,
                        cursor:'pointer',
                        background:'#ffffff',
                        boxShadow:'0 1px 2px rgba(0,0,0,0.04)'
                      }}
                    >
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ width:8, height:8, borderRadius:999, background: theme.accent, opacity:0.9 }} />
                        <span style={{ fontWeight:700, letterSpacing:0.1, fontSize: compact ? 12 : 13, color:'#0f172a', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{title}</span>
                        {/* Chevron */}
                        <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ color:'#94a3b8' }}>
                          <path fill="currentColor" d="M9 18l6-6-6-6" />
                        </svg>
                      </div>
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop: compact ? 6 : 8 }}>
                        {bagLabel && (
                          <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize: compact ? 10.5 : 11, color: theme.badgeFg, background: theme.badgeBg, border:`1px solid ${theme.accent}30`, padding:'3px 8px', borderRadius:999 }}>
                            {/* Bag icon */}
                            <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                              <path fill="currentColor" d="M7 6h10l1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L7 6zm1-2a4 4 0 0 1 8 0v2H8V4zm2 0a2 2 0 1 1 4 0v2h-4V4z" />
                            </svg>
                            {bagLabel}
                          </span>
                        )}
                          {reported > 0 && (
                            <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize: compact ? 10.5 : 11, color:'#0f172a', background:'#ecfeff', border:'1px solid #bae6fd', padding:'3px 8px', borderRadius:999 }} title={`Rapporterat: ${reported} säckar`}>
                              {/* Check icon */}
                              <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path fill="currentColor" d="M9 16.2l-3.5-3.5L4 14.2 9 19l12-12-1.5-1.5z" />
                              </svg>
                              Rapporterat: {reported}
                            </span>
                          )}
                        {it.truck && (
                          <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize: compact ? 10.5 : 11, color:'#334155', background:'#f1f5f9', border:'1px solid #e2e8f0', padding:'3px 8px', borderRadius:999 }}>
                            {/* Truck icon */}
                            <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                              <path fill="currentColor" d="M3 4h11v8h-1.5a2.5 2.5 0 0 0-2.45 2H8A3 3 0 0 0 5 17H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm13 5h2.586A2 2 0 0 1 20 9.586L21.414 11A2 2 0 0 1 22 12.414V16a1 1 0 0 1-1 1h-1a3 3 0 0 0-3-3h-1V9zM7 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
                            </svg>
                            {it.truck}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Detail Modal (project info) */}
      {detailOpen && (() => {
        const raw = (detailData?.project ?? detailData) || null;
        const location = raw?.workSiteAddress || raw?.location || null;
        const street = location?.streetAddress || raw?.street || raw?.addressLine1 || null;
        const postalCode = location?.postalCode || raw?.postalCode || raw?.zip || null;
        const city = location?.city || raw?.city || null;
        const address = [street, postalCode, city].filter(Boolean).join(', ');
        const mapsHref = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
        const description = raw?.description || raw?.notes || raw?.note || null;
        // Extract potential phone numbers from description
        const phoneList: Array<{ display: string; tel: string }> = (() => {
          if (!description || typeof description !== 'string') return [];
          const rx = /(\+?46|0)[\s\-]?(?:\d[\s\-]?){6,12}\d/g; // simple Swedish-friendly matcher
          const found = description.match(rx) || [];
          const norm = (s: string) => {
            const cleaned = s.replace(/[^\d+]/g, '');
            if (cleaned.startsWith('+')) return cleaned;
            if (cleaned.startsWith('0')) return '+46' + cleaned.slice(1);
            return cleaned.startsWith('46') ? ('+' + cleaned) : cleaned;
          };
          const uniq = Array.from(new Set(found.map(f => f.trim())));
          return uniq.map(display => ({ display, tel: norm(display) }));
        })();
        const headerTitle = [detailBase?.order_number ? `#${detailBase.order_number}` : null, detailBase?.project_name || 'Projekt'].filter(Boolean).join(' ');
        const segId = detailBase?.segment_id as string | undefined;
        const segReports = segId ? (segmentReportsMap[segId] || []) : [];
        const reportedTotal = segReports.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
        return (
          <div style={{ position: 'fixed', inset:0, zIndex: 260, background: 'rgba(15,23,42,0.5)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={closeDetail}>
            <div role="dialog" aria-modal="true" aria-busy={detailLoading ? true : undefined} onClick={e => e.stopPropagation()} style={{ width: 'min(720px, 92vw)', maxHeight: '80vh', overflowY: 'auto', background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, boxShadow:'0 12px 30px rgba(0,0,0,0.25)', display:'grid', gap:12, padding:16 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap' }}>
                <div style={{ display:'grid', gap:6, minWidth:0 }}>
                  <strong style={{ fontSize:16, color:'#0f172a' }}>{headerTitle}</strong>
                  {detailBase?.customer && <span style={{ fontSize:12, color:'#475569' }}>{detailBase.customer}</span>}
                </div>
                <div style={{ display:'inline-flex', gap:8, alignItems:'center' }}>
                  {detailBase?.order_number && (
                    <a
                      href={`/egenkontroll?orderId=${encodeURIComponent(String(detailBase.order_number))}`}
                      className="btn--plain btn--sm"
                      style={{ background:'#dcfce7', border:'1px solid #86efac', color:'#166534', borderRadius:6, padding:'6px 10px', fontSize:12 }}
                    >Starta egenkontroll</a>
                  )}
                  <button onClick={closeDetail} className="btn--plain btn--sm" style={{ background:'#fee2e2', border:'1px solid #fca5a5', color:'#b91c1c', borderRadius:6, padding:'6px 10px', fontSize:12 }}>Stäng</button>
                </div>
              </div>
              {detailLoading && (
                <div role="status" aria-live="polite" style={{ display:'grid', gap:10, padding:'8px 0' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" stroke="#cbd5e1" strokeWidth="3" opacity="0.35" />
                      <path d="M21 12a9 9 0 0 0-9-9" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round">
                        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
                      </path>
                    </svg>
                    <span style={{ fontSize:12, color:'#475569' }}>Hämtar detaljer…</span>
                  </div>
                  <div style={{ display:'grid', gap:6 }}>
                    <div style={{ height:12, background:'#e5e7eb', borderRadius:6 }} />
                    <div style={{ height:12, width:'85%', background:'#e5e7eb', borderRadius:6 }} />
                    <div style={{ height:12, width:'70%', background:'#e5e7eb', borderRadius:6 }} />
                    <div style={{ height:80, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8 }} />
                  </div>
                </div>
              )}
              {detailError && <div style={{ fontSize:12, color:'#b91c1c', background:'#fef2f2', border:'1px solid #fecaca', padding:'6px 8px', borderRadius:8 }}>Fel: {detailError}</div>}
              <div style={{ display:'grid', gap:12 }}>
                {mapsHref && (
                  <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <span style={{ fontSize:12, color:'#334155', fontWeight:600 }}>Adress:</span>
                    <span style={{ fontSize:12, color:'#334155' }}>{address}</span>
                    <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="btn--plain btn--xs" style={{ fontSize:11, border:'1px solid #cbd5e1', borderRadius:6, padding:'2px 8px', color:'#0369a1', background:'#e0f2fe' }}>Öppna i Kartor</a>
                  </div>
                )}
                {phoneList.length > 0 && (
                  <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <span style={{ fontSize:12, color:'#334155', fontWeight:600 }}>Kontakt:</span>
                    {phoneList.map(p => (
                      <a key={p.display} href={`tel:${p.tel}`} style={{ fontSize:12, color:'#0369a1', textDecoration:'none', border:'1px solid #cbd5e1', background:'#f0f9ff', padding:'2px 8px', borderRadius:6 }}>{p.display}</a>
                    ))}
                  </div>
                )}
                {description && (
                  <div style={{ display:'grid', gap:4 }}>
                    <span style={{ fontSize:12, color:'#334155', fontWeight:600 }}>Beskrivning</span>
                    <p style={{ fontSize:12, color:'#475569', whiteSpace:'pre-wrap', margin:0 }}>{description}</p>
                  </div>
                )}
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                  {detailBase?.truck && <span style={{ fontSize:11, color:'#475569', background:'#f1f5f9', border:'1px solid #e2e8f0', padding:'2px 6px', borderRadius: 999 }}>Lastbil: {detailBase.truck}</span>}
                  {typeof detailBase?.bag_count === 'number' && <span style={{ fontSize:11, color:'#475569', background:'#f1f5f9', border:'1px solid #e2e8f0', padding:'2px 6px', borderRadius: 999 }}>Plan: {detailBase.bag_count} säckar</span>}
                  {detailBase?.job_type && <span style={{ fontSize:11, color:'#475569', background:'#f1f5f9', border:'1px solid #e2e8f0', padding:'2px 6px', borderRadius: 999 }}>{detailBase.job_type}</span>}
                  {segId && reportedTotal > 0 && <span style={{ fontSize:11, color:'#0f172a', background:'#ecfeff', border:'1px solid #bae6fd', padding:'2px 6px', borderRadius: 999 }}>Rapporterat: {reportedTotal} säckar</span>}
                </div>
                {/* Rapportering UI for installers */}
                <div style={{ display:'grid', gap:8, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:10 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <strong style={{ fontSize:13, color:'#0f172a' }}>Rapportering</strong>
                    <div style={{ height:1, background:'#e5e7eb', flex:1 }} />
                    {segId && <span style={{ fontSize:11, color:'#64748b' }}>Totalt: {reportedTotal} säckar</span>}
                  </div>
                  {!segId && <div style={{ fontSize:12, color:'#64748b' }}>Denna post saknar segment-id och kan inte rapporteras här.</div>}
                  {segId && (
                    <>
                      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                        <label style={{ display:'grid', gap:4, fontSize:12 }}>
                          <span>Dag</span>
                          <input type="date" value={reportDraft.day} onChange={e => setReportDraft(d => ({ ...d, day: e.target.value }))} style={{ padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }} />
                        </label>
                        <label style={{ display:'grid', gap:4, fontSize:12 }}>
                          <span>Antal säckar</span>
                          <input type="number" min={1} value={reportDraft.amount} onChange={e => setReportDraft(d => ({ ...d, amount: e.target.value }))} placeholder="t.ex. 8" style={{ padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }} />
                        </label>
                        <button type="button" onClick={addPartialReport} className="btn--plain btn--sm" style={{ alignSelf:'end', height:34, padding:'6px 12px', border:'1px solid #16a34a', background:'#16a34a', color:'#fff', borderRadius:8 }}>Lägg till</button>
                      </div>
                      {segReports.length > 0 ? (
                        <div style={{ display:'grid', gap:6 }}>
                          {segReports.map(r => (
                            <div key={r.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', border:'1px solid #e5e7eb', background:'#fff', borderRadius:8, padding:'6px 8px' }}>
                              <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                                <span style={{ fontSize:12, color:'#0f172a' }}>{r.report_day}</span>
                                <span style={{ fontSize:12, color:'#334155', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:999, padding:'2px 8px' }}>{r.amount} säckar</span>
                                {r.created_by_name && <span style={{ fontSize:11, color:'#64748b' }}>av {r.created_by_name}</span>}
                              </div>
                              <button type="button" className="btn--plain btn--xs" onClick={() => deletePartialReport(r.id)} style={{ fontSize:11, padding:'4px 8px', border:'1px solid #fecaca', background:'#fee2e2', color:'#b91c1c', borderRadius:8 }}>Ta bort</button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize:12, color:'#64748b' }}>Inga delrapporter ännu.</div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}

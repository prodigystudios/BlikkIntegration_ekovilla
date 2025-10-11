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

  const openDetail = useCallback(async (it: any) => {
    setDetailOpen(true);
    setDetailBase(it);
    setDetailError(null);
    setDetailData(null);
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
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        <span style={{ fontSize:12, color:'#64748b', alignSelf:'center' }}>Visa dag:</span>
        {['Mån','Tis','Ons','Tor','Fre'].map((label, idx) => (
          <button
            key={label}
            type="button"
            onClick={() => setDayIdx(idx)}
            aria-pressed={dayIdx===idx}
            style={{
              fontSize: compact ? 11 : 12,
              padding: compact ? '2px 7px' : '4px 10px',
              border:'1px solid ' + (dayIdx===idx ? '#111827' : '#e5e7eb'),
              borderRadius:999,
              background:'#fff',
              color:'#111827',
              fontWeight: dayIdx===idx ? 600 : 500,
            }}
            title={range.days[idx]}
          >{label}</button>
        ))}
        <button
          type="button"
          onClick={() => setDayIdx(null)}
          aria-pressed={dayIdx==null}
          style={{
            fontSize: compact ? 11 : 12,
            padding: compact ? '2px 7px' : '4px 10px',
            border:'1px solid ' + (dayIdx==null ? '#111827' : '#e5e7eb'),
            borderRadius:999,
            background:'#fff',
            color:'#111827',
            fontWeight: dayIdx==null ? 600 : 500,
          }}
        >Alla</button>
      </div>

      {loading && <div style={{ fontSize:12, color:'#64748b' }}>Laddar…</div>}
      {!loading && grouped.length === 0 && <div style={{ fontSize:12, color:'#64748b' }}>Inga jobb planerade för vald period.</div>}

      {!loading && grouped.length > 0 && (
        <div style={{ display:'grid', gap: compact ? 8 : 10 }}>
          {grouped.map(({ day, arr }) => (
            <div key={day} style={{ display:'grid', gap: compact ? 4 : 6 }}>
              <div style={{ fontWeight:600, fontSize: compact ? 11 : 12, color:'#0f172a' }}>{day}</div>
              <div style={{ display:'grid', gap: compact ? 4 : 6 }}>
                {arr.map((it: any) => {
                  const title = [it.order_number ? String(it.order_number) : null, it.project_name].filter(Boolean).join(' - ');
                  const parts: string[] = [];
                  if (typeof it.bag_count === 'number') {
                    const jt = (it.job_type || '').toString().toLowerCase();
                    const material = jt.startsWith('eko') ? 'Ekovilla' : jt.startsWith('vit') ? 'Vitull' : null;
                    const bagPiece = material ? `${it.bag_count} säckar ${material}` : `${it.bag_count} säckar`;
                    parts.push(bagPiece);
                  }
                  if (it.truck) parts.push(it.truck as string);
                  const sub = parts.join(' - ');
                  return (
                    <div
                      key={it.segment_id || `${it.project_id}|${it.start_day}`}
                      onClick={() => openDetail(it)}
                      role="button"
                      tabIndex={0}
                      style={{ border:'1px solid #e5e7eb', borderRadius:8, padding: compact ? 5 : 8, cursor:'pointer' }}
                    >
                      <div style={{ display:'flex', alignItems:'center' }}>
                        <span style={{ fontWeight:600, fontSize: compact ? 12 : 13, color:'#0f172a' }}>{title}</span>
                      </div>
                      {sub && (
                        <div style={{ fontSize: compact ? 10.5 : 11, color:'#64748b', marginTop: compact ? 2 : 3 }}>{sub}</div>
                      )}
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
        const headerTitle = [detailBase?.order_number ? `#${detailBase.order_number}` : null, detailBase?.project_name || 'Projekt'].filter(Boolean).join(' ');
        return (
          <div style={{ position: 'fixed', inset:0, zIndex: 260, background: 'rgba(15,23,42,0.5)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={closeDetail}>
            <div role="dialog" aria-modal="true" aria-busy={detailLoading ? true : undefined} onClick={e => e.stopPropagation()} style={{ width: 'min(720px, 92vw)', maxHeight: '80vh', overflowY: 'auto', background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, boxShadow:'0 12px 30px rgba(0,0,0,0.25)', display:'grid', gap:12, padding:16 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ display:'grid', gap:6 }}>
                  <strong style={{ fontSize:16, color:'#0f172a' }}>{headerTitle}</strong>
                  {detailBase?.customer && <span style={{ fontSize:12, color:'#475569' }}>{detailBase.customer}</span>}
                </div>
                <button onClick={closeDetail} className="btn--plain btn--sm" style={{ background:'#fee2e2', border:'1px solid #fca5a5', color:'#b91c1c', borderRadius:6, padding:'6px 10px', fontSize:12 }}>Stäng</button>
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
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}

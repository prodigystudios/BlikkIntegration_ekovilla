"use client";
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import TimeReportModal, { TimeReportModalProps } from "../../components/dashboard/TimeReportModal";
import { useToast } from '@/lib/Toast';

// Simple shape for time reports coming back from our API.
interface TimeReportItem {
  id?: number | string;
  userId?: number | string;
  projectId?: number | string;
  projectName?: string | null;
  orderNumber?: string | null;
  projectNumber?: string | null; // internal project number from Blikk (project.number)
  internalProjectId?: number | string | null;
  internalProjectName?: string | null;
  absenceProjectId?: number | string | null;
  absenceProjectName?: string | null;
  activityId?: number | string | null;
  activityName?: string | null;
  timeCodeId?: number | string | null;
  timeCodeName?: string | null;
  timeArticleId?: number | string | null;
  date?: string; // yyyy-mm-dd or datetime
  hours?: number | string | null;
  minutes?: number | string | null;
  description?: string | null;
  clockStart?: string | null;
  clockEnd?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  breakMinutes?: number | string | null;
}

export default function TimeReportsPage() {
  const [items, setItems] = useState<TimeReportItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeModalOpen, setTimeModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<TimeReportItem | null>(null);
  const [modalInitialDate, setModalInitialDate] = useState<string | null>(null);
  const toast = useToast();
  const [refreshTick, setRefreshTick] = useState(0);
  // Weekly navigation state: store a Monday anchor date string (YYYY-MM-DD)
  const today = new Date();
  const calcMonday = (d: Date) => {
    const dow = d.getDay();
    const mondayDelta = (dow + 6) % 7; // days since Monday
    const m = new Date(d); m.setDate(m.getDate() - mondayDelta); m.setHours(0,0,0,0); return m;
  };
  const [weekStart, setWeekStart] = useState<string>(() => {
    // Avoid UTC shift by formatting local date components
    const m = calcMonday(today);
    const y = m.getFullYear();
    const mo = String(m.getMonth()+1).padStart(2,'0');
    const dd = String(m.getDate()).padStart(2,'0');
    return `${y}-${mo}-${dd}`;
  });
  const [page] = useState(1); // current page (kept for future pagination UI)
  const [pageSize] = useState(50); // Blikk max 100; use 50 to be safe

  // Compute week range (Monday..Sunday) from weekStart
  const { dateFrom, dateTo, weekDays, label } = useMemo(() => {
    // Use local-date formatting (avoid UTC shift)
    const toLocalDate = (d: Date) => {
      const y = d.getFullYear();
      const m = (d.getMonth()+1).toString().padStart(2,'0');
      const day = d.getDate().toString().padStart(2,'0');
      return `${y}-${m}-${day}`;
    };
    const base = new Date(weekStart + 'T00:00:00');
    const days: string[] = [];
    for (let i=0;i<7;i++) {
      const d = new Date(base); d.setDate(d.getDate()+i);
      days.push(toLocalDate(d));
    }
    const fromISO = days[0];
    const toISO = days[6];
    return { dateFrom: fromISO, dateTo: toISO, weekDays: days, label: 'Vecka' };
  }, [weekStart]);

  const formatLocal = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  };
  const goPrevWeek = useCallback(() => {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate()-7);
    setWeekStart(formatLocal(calcMonday(d)));
  }, [weekStart]);
  const goNextWeek = useCallback(() => {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate()+7);
    setWeekStart(formatLocal(calcMonday(d)));
  }, [weekStart]);
  const goTodayWeek = useCallback(() => {
    setWeekStart(formatLocal(calcMonday(new Date())));
  }, []);

  // Swedish weekday names (full) with uppercase first letter
  const swFull = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'] as const;
  const formatDayLabel = useCallback((isoDate: string) => {
    if (!isoDate) return '';
    const d = new Date(isoDate + 'T00:00:00');
    const wd = swFull[d.getDay()];
    const day = d.getDate();
    return `${wd} ${day}`;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);
        // Bubble debug flag through if present in location (?debug=1)
        try {
          const q = new URLSearchParams(window.location.search);
          if (q.get('debug') === '1') params.set('debug', '1');
        } catch {}
        const res = await fetch(`/api/blikk/time-reports?${params.toString()}`);
        const j = await res.json().catch(()=>({ ok:false, items:[] }));
        if (cancelled) return;
        if (!res.ok || !j.ok) {
          setError(j.error || 'Kunde inte hämta tidrapporter');
          setItems([]);
        } else {
          // Console debug if backend provided attempts/used (when ?debug=1)
          if ((j as any).attempts) {
            // eslint-disable-next-line no-console
            console.debug('Tidrapporter debug', { used: (j as any).used, attempts: (j as any).attempts });
          }
          let arr: any[] = Array.isArray(j.items) ? j.items : [];
          // If we received exactly pageSize items (50) we likely truncated; still map them.
          // Log first item for insight in debug mode
          try {
            const q = new URLSearchParams(window.location.search);
            if (q.get('debug') === '1' && arr.length) {
              // eslint-disable-next-line no-console
              console.debug('First raw time report item', arr[0]);
            }
          } catch {}
          const mapped: TimeReportItem[] = arr.map(r => ({
            id: r.id ?? r.timeReportId ?? r.reportId ?? undefined,
            userId: r.userId ?? r.user_id ?? r.user?.id ?? undefined,
            projectId: r.projectId ?? r.project_id ?? r.project?.id ?? undefined,
            projectName: r.projectName ?? r.project_name ?? r.project?.name ?? r.project?.title ?? null,
            orderNumber: r.orderNumber ?? r.order_number ?? r.project?.orderNumber ?? r.project?.order_number ?? r.project?.orderNo ?? null,
            projectNumber: r.projectNumber ?? r.project_number ?? r.project?.number ?? null,
            internalProjectId: r.internalProjectId ?? r.internal_project_id ?? r.internalProject?.id ?? null,
            internalProjectName: r.internalProjectName ?? r.internal_project_name ?? r.internalProject?.name ?? null,
            absenceProjectId: r.absenceProjectId ?? r.absence_project_id ?? r.absenceProject?.id ?? null,
            absenceProjectName: r.absenceProjectName ?? r.absence_project_name ?? r.absenceProject?.name ?? null,
            activityId: r.activityId ?? r.activity_id ?? r.activity?.id ?? null,
            activityName: r.activityName ?? r.activity_name ?? r.activity?.name ?? null,
            timeCodeId: r.timeCodeId ?? r.timecodeId ?? r.time_code_id ?? r.timeCode?.id ?? null,
            timeCodeName: r.timeCodeName ?? r.timecodeName ?? r.timeCode_name ?? r.timeCode?.name ?? r.timeCode?.code ?? null,
            timeArticleId: r.timeArticleId ?? r.time_article_id ?? r.timeArticle?.id ?? null,
            date: (r.date || r.reportDate || r.day || '').slice(0,10) || undefined,
            hours: typeof r.hours === 'number' ? r.hours : (r.minutes ? Number(r.minutes)/60 : null),
            minutes: typeof r.minutes === 'number' ? r.minutes : (typeof r.hours === 'number' ? Math.round(Number(r.hours)*60) : null),
            description: r.description || r.comment || r.internalComment || null,
            clockStart: r.clockStart || r.start || r.startTime || null,
            clockEnd: r.clockEnd || r.end || r.endTime || null,
            startTime: r.startTime || null,
            endTime: r.endTime || null,
            breakMinutes: r.breakMinutes ?? r.break ?? null,
          })).filter(x => x.date);
          setItems(mapped);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError('Fel vid hämtning');
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [page, pageSize, dateFrom, dateTo, refreshTick]);

  // Build week-aligned grouping (always 7 days, keep empty slots)
  const grouped = useMemo(() => {
    // Ensure we only group entries whose date falls within the visible week range
    const setWeek = new Set(weekDays);
    const map = new Map<string, TimeReportItem[]>();
    for (const it of items) {
      const d = it.date || '';
      if (!d || !setWeek.has(d)) continue;
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(it);
    }
    return weekDays.map(day => ({ day, arr: (map.get(day) || []) }));
  }, [items, weekDays]);

  const totalHours = useMemo(() => items.reduce((sum, r) => sum + (typeof r.hours === 'number' ? r.hours : 0), 0), [items]);

  return (
    <div style={{ padding: 16, display:'grid', gap:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
        <h1 style={{ margin:0, fontSize:20 }}>Veckans rapporter</h1>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
          <button type="button" className='btn--primary btn--sm' onClick={goPrevWeek}>← Föregående</button>
          <button type="button" className='btn--success btn--sm' onClick={goTodayWeek}>Denna vecka</button>
          <button type="button" className='btn--primary btn--sm' onClick={goNextWeek}>Nästa →</button>
        </div>
      </div>
  <div style={{ fontSize:12, color:'#64748b' }}>Vecka: <strong>{formatDayLabel(dateFrom)} → {formatDayLabel(dateTo)}</strong></div>
      <div style={{ fontSize:12, color:'#334155' }}>Totalt rapporterat: <strong>{totalHours.toFixed(2)} h</strong></div>
      {loading && (
        <div style={{ display:'grid', gap:14 }}>
          {weekDays.map(d => (
            <div key={d} style={{ border:'1px solid #e5e7eb', borderRadius:12, background:'#fff', padding:12, display:'grid', gap:10 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                <div style={{ width: 120, height: 14, borderRadius: 6, background:'#e5e7eb' }} />
                <div style={{ width: 140, height: 12, borderRadius: 999, background:'#e2e8f0' }} />
              </div>
              <div style={{ display:'grid', gap:8 }}>
                {[0,1].map(i => (
                  <div key={i} style={{ border:'1px solid #e2e8f0', borderRadius:10, padding:'8px 10px', background:'#f8fafc', display:'grid', gap:6 }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                      <div style={{ display:'flex', flexDirection:'column', gap:4, minWidth:0 }}>
                        <div style={{ width: 100, height: 10, borderRadius: 6, background:'#e5e7eb' }} />
                        <div style={{ width: 180, height: 10, borderRadius: 6, background:'#e5e7eb' }} />
                      </div>
                      <div style={{ width: 48, height: 10, borderRadius: 6, background:'#e5e7eb' }} />
                    </div>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      <div style={{ width: 140, height: 18, borderRadius: 999, background:'#e0e7ff' }} />
                      <div style={{ width: 120, height: 18, borderRadius: 999, background:'#e0f2fe' }} />
                      <div style={{ width: 150, height: 18, borderRadius: 999, background:'#fce7f3' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <div style={{ fontSize:12, color:'#b91c1c', background:'#fef2f2', border:'1px solid #fecaca', padding:'6px 8px', borderRadius:8 }}>Fel: {error}</div>}
      {!loading && !error && grouped.length === 0 && (
        <div style={{ fontSize:12, color:'#64748b' }}>Inga rapporter i vald period.</div>
      )}
      <div style={{ display:'grid', gap:14 }}>
        {grouped.map(g => {
          const dayHours = g.arr.reduce((sum, r) => sum + (typeof r.hours === 'number' ? r.hours : 0), 0);
          return (
            <div key={g.day} style={{ border:'1px solid #e5e7eb', borderRadius:12, background:'#fff', padding:12, display:'grid', gap:10 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'#0f172a' }}>{formatDayLabel(g.day)}</div>
                <div style={{ fontSize:12, color: dayHours > 0 ? '#166534' : '#64748b', background: dayHours > 0 ? '#dcfce7' : '#f1f5f9', border:'1px solid ' + (dayHours > 0 ? '#86efac' : '#e2e8f0'), padding:'4px 8px', borderRadius: 999 }}>{dayHours > 0 ? `Summa: ${dayHours.toFixed(2)} h` : 'Inget rapporterat'}</div>
              </div>
              <div style={{ display:'grid', gap:8 }}>
                {g.arr.sort((a,b)=> (a.clockStart||'').localeCompare(b.clockStart||'')).map(r => {
                  const start = r.clockStart || r.startTime || r.startTime || null;
                  const end = r.clockEnd || r.endTime || r.endTime || null;
                  const h = typeof r.hours === 'number' ? r.hours.toFixed(2) : (r.minutes ? (Number(r.minutes)/60).toFixed(2) : '');
                  return (
                    <div key={String(r.id)+String(r.clockStart)} style={{ display:'flex', flexDirection:'column', gap:4, border:'1px solid #e2e8f0', borderRadius:10, padding:'8px 10px', background:'#f8fafc' }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                        <div style={{ display:'flex', flexDirection:'column', gap:2, minWidth:0 }}>
                          <span style={{ fontSize:12, fontWeight:600, color:'#0f172a', whiteSpace:'nowrap' }}>{start || '—'} → {end || '—'}</span>
                          {r.description && <span style={{ fontSize:11, color:'#475569', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.description}</span>}
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <div style={{ fontSize:12, color:'#0f172a', fontWeight:600 }}>{h} h</div>
                          <button
                            type="button"
                            aria-label="Redigera"
                            onClick={() => { setEditItem(r); setEditModalOpen(true); }}
                            style={{ fontSize:11, padding:'4px 6px', border:'1px solid #94a3b8', background:'#fff', color:'#0f172a', borderRadius:6, cursor:'pointer' }}
                          >✎</button>
                          <button
                            type="button"
                            aria-label="Ta bort"
                            onClick={async () => {
                              if (!r.id) return;
                              const confirmDelete = window.confirm('Ta bort tidrapport?');
                              if (!confirmDelete) return;
                              try {
                                const res = await fetch(`/api/blikk/time-reports/${r.id}`, { method:'DELETE' });
                                const j = await res.json().catch(()=>({ ok:false }));
                                if (!res.ok || !j.ok) {
                                  toast.error((j as any).error || 'Kunde inte ta bort');
                                } else {
                                  toast.success('Tidrapport borttagen');
                                  try {
                                    const dbg = new URLSearchParams(window.location.search).get('debug') === '1';
                                    if (dbg && (j as any).usedPath) {
                                      // eslint-disable-next-line no-console
                                      console.debug('Delete usedPath', (j as any).usedPath);
                                    }
                                  } catch {}
                                  setRefreshTick(t=>t+1);
                                }
                              } catch (e:any) {
                                toast.error('Fel vid borttagning');
                              }
                            }}
                            style={{ fontSize:11, padding:'4px 6px', border:'1px solid #dc2626', background:'#fff', color:'#dc2626', borderRadius:6, cursor:'pointer' }}
                          >🗑</button>
                        </div>
                      </div>
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                        {(() => {
                          // Show target context: Absence -> Internal -> Project
                          if (r.absenceProjectId || r.absenceProjectName) {
                            return (
                              <span style={{ fontSize:10.5, background:'#ffe4e6', color:'#9f1239', border:'1px solid #fecdd3', padding:'2px 6px', borderRadius:999 }}>
                                Frånvaro{r.absenceProjectName ? ` – ${r.absenceProjectName}` : (r.absenceProjectId ? `: ${r.absenceProjectId}` : '')}
                              </span>
                            );
                          }
                          if (r.internalProjectId || r.internalProjectName) {
                            return (
                              <span style={{ fontSize:10.5, background:'#f1f5f9', color:'#0f172a', border:'1px solid #e2e8f0', padding:'2px 6px', borderRadius:999 }}>
                                Intern{r.internalProjectName ? ` – ${r.internalProjectName}` : (r.internalProjectId ? `: ${r.internalProjectId}` : '')}
                              </span>
                            );
                          }
                          // Priority for normal projects: projectNumber -> orderNumber -> projectName -> projectId
                          if (r.projectNumber) {
                            return <span style={{ fontSize:10.5, background:'#eef2ff', color:'#3730a3', border:'1px solid #c7d2fe', padding:'2px 6px', borderRadius:999 }}>#{r.projectNumber}{r.projectName ? ` – ${r.projectName}` : ''}</span>;
                          }
                          if (r.orderNumber) {
                            return <span style={{ fontSize:10.5, background:'#eef2ff', color:'#3730a3', border:'1px solid #c7d2fe', padding:'2px 6px', borderRadius:999 }}>Order: #{r.orderNumber}{r.projectName ? ` – ${r.projectName}` : ''}</span>;
                          }
                          if (r.projectName) {
                            return <span style={{ fontSize:10.5, background:'#eef2ff', color:'#3730a3', border:'1px solid #c7d2fe', padding:'2px 6px', borderRadius:999 }}>Projekt – {r.projectName}</span>;
                          }
                          if (r.projectId) {
                            return <span style={{ fontSize:10.5, background:'#eef2ff', color:'#3730a3', border:'1px solid #c7d2fe', padding:'2px 6px', borderRadius:999 }}>Projekt: {r.projectId}</span>;
                          }
                          return null;
                        })()}
                        {(r.timeCodeName || (r.timeCodeId && String(r.timeCodeId) !== '0')) && (
                          <span style={{ fontSize:10.5, background:'#ecfeff', color:'#0369a1', border:'1px solid #bae6fd', padding:'2px 6px', borderRadius:999 }}>
                            Tidkod: {r.timeCodeName ? r.timeCodeName : r.timeCodeId}
                          </span>
                        )}
                        {(r.activityName || (r.activityId && String(r.activityId) !== '0')) ? (
                          <span style={{ fontSize:10.5, background:'#fce7f3', color:'#be185d', border:'1px solid #fbcfe8', padding:'2px 6px', borderRadius:999 }}>
                            Aktivitet: {r.activityName ? r.activityName : r.activityId}
                          </span>
                        ) : null}
                        {Number(r.breakMinutes) > 0 ? (
                          <span style={{ fontSize:10.5, background:'#fef9c3', color:'#92400e', border:'1px solid #fde68a', padding:'2px 6px', borderRadius:999 }}>Rast: {r.breakMinutes}m</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {g.arr.length === 0 && (
                  <div style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => { setModalInitialDate(g.day); setTimeModalOpen(true); }}
                      style={{ display:'inline-flex', alignItems:'center', gap:8, fontSize: 12, fontWeight: 600, padding: '8px 12px', border: '1px solid #16a34a', background: '#16a34a', color: '#fff', borderRadius: 10 }}
                    >
                      Rapportera tid
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <TimeReportModal
        open={timeModalOpen}
        onClose={() => setTimeModalOpen(false)}
        initialDate={modalInitialDate}
        onSubmit={async (payload: Parameters<NonNullable<TimeReportModalProps['onSubmit']>>[0]) => {
          try {
            const minutes = Math.round(payload.totalHours * 60);
            const body: any = {
              date: payload.date,
              minutes,
              breakMinutes: payload.breakMinutes,
              start: payload.start,
              end: payload.end,
              // target id: exactly one of project/internal/absence
              projectId: payload.reportType === 'project' && payload.projectId ? Number(payload.projectId) : undefined,
              internalProjectId: payload.reportType === 'internal' && payload.internalProjectId ? Number(payload.internalProjectId) : undefined,
              absenceProjectId: payload.reportType === 'absence' && payload.absenceProjectId ? Number(payload.absenceProjectId) : undefined,
              activityId: payload.activityId ? Number(payload.activityId) : undefined,
              timeCodeId: payload.timecodeId ? Number(payload.timecodeId) : undefined,
              description: payload.description || undefined,
            };
            const url = process.env.NODE_ENV !== 'production' ? '/api/blikk/time-reports?debug=1' : '/api/blikk/time-reports';
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const json = await res.json().catch(()=>({}));
            if (!res.ok || !json.ok) {
              console.warn('Time report create failed', json);
              toast.error(json?.error || 'Misslyckades att spara tid');
            } else {
              toast.success('Tidrapport sparad');
              setTimeModalOpen(false);
              setModalInitialDate(null);
              // Trigger a lightweight re-fetch instead of full page reload
              setRefreshTick(t => t + 1);
            }
          } catch (e:any) {
            console.warn('Time report create error', e);
            toast.error('Fel vid sparande av tid');
          }
        }}
      />
      <TimeReportModal
        open={editModalOpen}
        onClose={() => { setEditModalOpen(false); setEditItem(null); }}
        editId={editItem?.id ? String(editItem.id) : null}
        initialDate={editItem?.date ? String(editItem.date) : null}
        initialStart={editItem?.clockStart || editItem?.startTime || null}
        initialEnd={editItem?.clockEnd || editItem?.endTime || null}
        initialBreakMinutes={typeof editItem?.breakMinutes === 'number' ? editItem.breakMinutes : (editItem?.breakMinutes ? Number(editItem.breakMinutes) : null)}
        initialDescription={editItem?.description || null}
        initialTimecodeId={editItem?.timeCodeId ? String(editItem.timeCodeId) : null}
        initialActivityId={editItem?.activityId ? String(editItem.activityId) : null}
        initialReportType={editItem ? (editItem.absenceProjectId ? 'absence' : (editItem.internalProjectId ? 'internal' : 'project')) : 'project'}
        initialProjectId={editItem?.projectId ? String(editItem.projectId) : null}
        initialInternalProjectId={editItem?.internalProjectId ? String(editItem.internalProjectId) : null}
        initialAbsenceProjectId={editItem?.absenceProjectId ? String(editItem.absenceProjectId) : null}
        onSubmit={async (payload: Parameters<NonNullable<TimeReportModalProps['onSubmit']>>[0]) => {
          if (!payload.editId) return;
          try {
            const minutes = Math.round(payload.totalHours * 60);
            const body: any = {
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
            const url = process.env.NODE_ENV !== 'production' ? `/api/blikk/time-reports/${payload.editId}?debug=1` : `/api/blikk/time-reports/${payload.editId}`;
            const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const json = await res.json().catch(()=>({}));
            if (!res.ok || !(json as any).ok) {
              console.warn('Time report update failed', json);
              toast.error((json as any)?.error || 'Misslyckades att uppdatera tid');
            } else {
              toast.success('Tidrapport uppdaterad');
              setEditModalOpen(false);
              setEditItem(null);
              setRefreshTick(t => t + 1);
            }
          } catch (e:any) {
            console.warn('Time report update error', e);
            toast.error('Fel vid uppdatering av tid');
          }
        }}
      />
    </div>
  );
}

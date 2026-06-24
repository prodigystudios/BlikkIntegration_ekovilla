"use client";
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import TimeReportModal, { TimeReportModalProps } from "../../components/dashboard/TimeReportModal";
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import { buildTimeReportBody } from '@/lib/domains/time-reports/payload';

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
  const [isSmall, setIsSmall] = useState(false); // <= 640px
  const [items, setItems] = useState<TimeReportItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeModalOpen, setTimeModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<TimeReportItem | null>(null);
  const [modalInitialDate, setModalInitialDate] = useState<string | null>(null);
  const toast = useToast();
  const [refreshTick, setRefreshTick] = useState(0);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<TimeReportItem | null>(null);
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

  // Travel report moved into TimeReportModal (collapsible section)

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

  // Responsive flag for mobile-specific UI affordances (e.g., floating action button)
  useEffect(() => {
    const calc = () => {
      const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
      setIsSmall(w <= 640);
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
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

  const performDelete = useCallback(async (item: TimeReportItem) => {
    if (!item.id) return;
    const idStr = String(item.id);
    setDeletingIds((ids) => Array.from(new Set([...ids, idStr])));
    try {
      const res = await fetch(`/api/blikk/time-reports/${item.id}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !j.ok) toast.error((j as any).error || 'Kunde inte ta bort');
      else { toast.success('Tidrapport borttagen'); setRefreshTick((t) => t + 1); }
    } catch {
      toast.error('Fel vid borttagning');
    } finally {
      setDeletingIds((ids) => ids.filter((x) => x !== idStr));
      setPendingDelete(null);
    }
  }, [toast]);

  return (
    <div className="mx-auto grid w-full max-w-[1000px] grid-cols-1 gap-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
      {/* Sticky header with week navigation for better mobile UX */}
      <div className="sticky top-0 z-[5] grid gap-1 border-b border-[#e0e8dc] bg-[#e5ede5]/95 pb-2 pt-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Veckans rapporter</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300" onClick={goPrevWeek}>← Föregående</button>
            <button type="button" className="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold text-white transition hover:opacity-90" style={{ backgroundColor: 'var(--crm-primary)' }} onClick={goTodayWeek}>Denna vecka</button>
            <button type="button" className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300" onClick={goNextWeek}>Nästa →</button>
          </div>
        </div>
        <div className="text-xs text-slate-500">Vecka: <strong className="font-semibold text-slate-700">{formatDayLabel(dateFrom)} → {formatDayLabel(dateTo)}</strong></div>
        <div className="text-xs text-slate-700">Totalt rapporterat: <strong className="font-semibold text-slate-900">{totalHours.toFixed(2)} h</strong></div>
      </div>
      {loading && (
        <div className="grid gap-3.5">
          {weekDays.map(d => (
            <div key={d} className="grid gap-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <div style={{ width: 120, height: 14, borderRadius: 6, background:'#e5e7eb' }} />
                <div style={{ width: 140, height: 12, borderRadius: 999, background:'#e2e8f0' }} />
              </div>
              <div className="grid gap-2">
                {[0,1].map(i => (
                  <div key={i} className="grid gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div style={{ display:'flex', flexDirection:'column', gap:4, minWidth:0 }}>
                        <div style={{ width: 100, height: 10, borderRadius: 6, background:'#e5e7eb' }} />
                        <div style={{ width: 180, height: 10, borderRadius: 6, background:'#e5e7eb' }} />
                      </div>
                      <div style={{ width: 48, height: 10, borderRadius: 6, background:'#e5e7eb' }} />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
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
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">Fel: {error}</div>}
      {!loading && !error && grouped.length === 0 && (
        <div className="text-xs text-slate-500">Inga rapporter i vald period.</div>
      )}
      <div className="grid gap-3.5">
        {grouped.map(g => {
          const dayHours = g.arr.reduce((sum, r) => sum + (typeof r.hours === 'number' ? r.hours : 0), 0);
          return (
            <div key={g.day} className="grid gap-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-[13px] font-semibold text-slate-900">{formatDayLabel(g.day)}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className={dayHours > 0 ? 'rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700' : 'rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-xs text-slate-500'}>{dayHours > 0 ? `Summa: ${dayHours.toFixed(2)} h` : 'Inget rapporterat'}</div>
                  <button
                    type="button"
                    aria-label={`Ny rapport för ${formatDayLabel(g.day)}`}
                    onClick={() => { setModalInitialDate(g.day); setTimeModalOpen(true); }}
                    className="inline-flex min-h-8 items-center justify-center rounded-lg border border-emerald-600 bg-white px-2 py-1.5 text-xs font-semibold text-emerald-700"
                  >
                    ➕
                  </button>
                </div>
              </div>
              <div className="grid gap-2">
                {g.arr.sort((a,b)=> (a.clockStart||'').localeCompare(b.clockStart||'')).map(r => {
                  const start = r.clockStart || r.startTime || r.startTime || null;
                  const end = r.clockEnd || r.endTime || r.endTime || null;
                  const h = typeof r.hours === 'number' ? r.hours.toFixed(2) : (r.minutes ? (Number(r.minutes)/60).toFixed(2) : '');
                  return (
                    <div key={String(r.id)+String(r.clockStart)} className="grid min-w-0 gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="grid min-w-0 gap-1">
                          <span className="break-words text-xs font-semibold text-slate-900">{start || '—'} → {end || '—'}</span>
                          {r.description && <span className="whitespace-pre-wrap break-words text-[11px] leading-[1.45] text-slate-600">{r.description}</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
                          <div className="text-xs font-semibold text-slate-900">{h} h</div>
                          <button
                            type="button"
                            aria-label="Redigera"
                            onClick={() => { setEditItem(r); setEditModalOpen(true); }}
                            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-900"
                            disabled={deletingIds.includes(String(r.id))}
                          >✎</button>
                          <button
                            type="button"
                            aria-label="Ta bort"
                            onClick={() => setPendingDelete(r)}
                            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-rose-300 bg-white px-2.5 py-2 text-[11px] font-semibold text-rose-700 transition hover:border-rose-400"
                            disabled={deletingIds.includes(String(r.id))}
                          >
                            {deletingIds.includes(String(r.id)) ? <span className="spinner dark spin" style={{ width:16, height:16 }} aria-hidden /> : '🗑'}
                          </button>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        {(() => {
                          // Show target context: Absence -> Internal -> Project
                          if (r.absenceProjectId || r.absenceProjectName) {
                            return (
                              <span className="break-words rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10.5px] text-rose-800">
                                Frånvaro{r.absenceProjectName ? ` – ${r.absenceProjectName}` : (r.absenceProjectId ? `: ${r.absenceProjectId}` : '')}
                              </span>
                            );
                          }
                          if (r.internalProjectId || r.internalProjectName) {
                            return (
                              <span className="break-words rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10.5px] text-slate-800">
                                Intern{r.internalProjectName ? ` – ${r.internalProjectName}` : (r.internalProjectId ? `: ${r.internalProjectId}` : '')}
                              </span>
                            );
                          }
                          // Priority for normal projects: projectNumber -> orderNumber -> projectName -> projectId
                          if (r.projectNumber) {
                            return <span className="break-words rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] text-emerald-800">#{r.projectNumber}{r.projectName ? ` – ${r.projectName}` : ''}</span>;
                          }
                          if (r.orderNumber) {
                            return <span className="break-words rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] text-emerald-800">Order: #{r.orderNumber}{r.projectName ? ` – ${r.projectName}` : ''}</span>;
                          }
                          if (r.projectName) {
                            return <span className="break-words rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] text-emerald-800">Projekt – {r.projectName}</span>;
                          }
                          if (r.projectId) {
                            return <span className="break-words rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] text-emerald-800">Projekt: {r.projectId}</span>;
                          }
                          return null;
                        })()}
                        {(r.timeCodeName || (r.timeCodeId && String(r.timeCodeId) !== '0')) && (
                          <span className="break-words rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10.5px] text-sky-800">
                            Tidkod: {r.timeCodeName ? r.timeCodeName : r.timeCodeId}
                          </span>
                        )}
                        {(r.activityName || (r.activityId && String(r.activityId) !== '0')) ? (
                          <span className="break-words rounded-full border border-pink-200 bg-pink-50 px-2 py-0.5 text-[10.5px] text-pink-700">
                            Aktivitet: {r.activityName ? r.activityName : r.activityId}
                          </span>
                        ) : null}
                        {Number(r.breakMinutes) > 0 ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] text-amber-800">Rast: {r.breakMinutes}m</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {g.arr.length === 0 && (
                  <div className="mt-1.5">
                    <button
                      type="button"
                      onClick={() => { setModalInitialDate(g.day); setTimeModalOpen(true); }}
                      className="inline-flex items-center gap-2 rounded-[10px] border border-emerald-700 bg-emerald-700 px-3 py-2 text-xs font-semibold text-white"
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
      {/* Floating action button for quick entry on mobile */}
      {isSmall && (
        <button
          type="button"
          onClick={() => { setModalInitialDate(formatLocal(new Date())); setTimeModalOpen(true); }}
          aria-label="Ny tidrapport"
          className="fixed right-4 z-10 inline-flex h-14 w-14 items-center justify-center rounded-full border border-emerald-700 bg-emerald-700 text-2xl text-white shadow-[0_8px_16px_rgba(20,44,27,0.30)]"
          style={{ bottom:'max(16px, env(safe-area-inset-bottom))' }}
        >+
        </button>
      )}
      <TimeReportModal
        open={timeModalOpen}
        onClose={() => setTimeModalOpen(false)}
        initialDate={modalInitialDate}
        onSubmit={async (payload: Parameters<NonNullable<TimeReportModalProps['onSubmit']>>[0]) => {
          try {
            const body = buildTimeReportBody(payload as any);
            const url = process.env.NODE_ENV !== 'production' ? '/api/blikk/time-reports?debug=1' : '/api/blikk/time-reports';
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const json = await res.json().catch(()=>({}));
            if (!res.ok || !json.ok) {
              console.warn('Time report create failed', json);
              toast.error(json?.error || 'Misslyckades att spara tid');
              return false;
            } else {
              toast.success('Tidrapport sparad');
              setTimeModalOpen(false);
              setModalInitialDate(null);
              // Trigger a lightweight re-fetch instead of full page reload
              setRefreshTick(t => t + 1);
              return true;
            }
          } catch (e:any) {
            console.warn('Time report create error', e);
            toast.error('Fel vid sparande av tid');
            return false;
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
            const body = buildTimeReportBody(payload as any);
            const url = process.env.NODE_ENV !== 'production' ? `/api/blikk/time-reports/${payload.editId}?debug=1` : `/api/blikk/time-reports/${payload.editId}`;
            const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const json = await res.json().catch(()=>({}));
            if (!res.ok || !(json as any).ok) {
              console.warn('Time report update failed', json);
              toast.error((json as any)?.error || 'Misslyckades att uppdatera tid');
              return false;
            } else {
              toast.success('Tidrapport uppdaterad');
              setEditModalOpen(false);
              setEditItem(null);
              setRefreshTick(t => t + 1);
              return true;
            }
          } catch (e:any) {
            console.warn('Time report update error', e);
            toast.error('Fel vid uppdatering av tid');
            return false;
          }
        }}
      />

      {pendingDelete ? (
        <CrmModal
          onClose={() => { if (!deletingIds.includes(String(pendingDelete.id))) setPendingDelete(null); }}
          ariaLabel="Ta bort tidrapport"
          maxWidth="sm:max-w-[420px]"
          header={
            <div className="grid gap-1">
              <span className={crm.sectionTitle}>Ta bort</span>
              <strong className="text-lg font-bold tracking-tight text-slate-900">Ta bort tidrapport</strong>
            </div>
          }
          footer={
            <>
              <button type="button" onClick={() => setPendingDelete(null)} disabled={deletingIds.includes(String(pendingDelete.id))} className={cn(crm.ghostButton, 'flex-1 sm:flex-none')}>
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => performDelete(pendingDelete)}
                disabled={deletingIds.includes(String(pendingDelete.id))}
                className="inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-rose-600 px-4 text-[13px] font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50 sm:ml-auto sm:flex-none"
              >
                {deletingIds.includes(String(pendingDelete.id)) ? 'Tar bort…' : 'Ta bort'}
              </button>
            </>
          }
        >
          <p className="m-0 text-sm leading-6 text-slate-600">Ta bort den här tidrapporten? Det går inte att ångra.</p>
        </CrmModal>
      ) : null}
    </div>
  );
}

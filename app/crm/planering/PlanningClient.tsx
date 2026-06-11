'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import type { OpsSegment, OpsTruck, SchedulableWorkOrder } from '@/lib/domains/planning/types';
import {
  addDays, addDaysISO, buildMonthWeeks, buildWeekDays, daysBetweenInclusive, fmtISO, isoWeek, startOfWeek, swedishMonthYear,
} from './planningDates';
import Backlog from './Backlog';
import WeekBoard from './WeekBoard';
import MonthGrid from './MonthGrid';

type View = 'week' | 'month';
type DragData =
  | { kind: 'backlog'; id: string }
  | { kind: 'segment'; id: string; start: string; end: string; truckId: string };

const API = '/api/crm/planering';

export default function PlanningClient({ canWrite }: { canWrite: boolean }) {
  const toast = useToast();
  const router = useRouter();

  const [view, setView] = useState<View>('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);

  const [backlog, setBacklog] = useState<SchedulableWorkOrder[]>([]);
  const [trucks, setTrucks] = useState<OpsTruck[]>([]);
  const [segments, setSegments] = useState<OpsSegment[]>([]);
  const [loadingBacklog, setLoadingBacklog] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hiddenTrucks, setHiddenTrucks] = useState<Set<string>>(new Set());
  const [backlogDropActive, setBacklogDropActive] = useState(false);
  const [truckPicker, setTruckPicker] = useState<{ dayISO: string; workOrderId: string } | null>(null);

  const dragRef = useRef<DragData | null>(null);
  const todayISO = useMemo(() => fmtISO(new Date()), []);

  // ── visible range (depends on view + offset) ──────────────────────────────
  const weekMonday = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset]);
  const weekDays = useMemo(() => buildWeekDays(weekMonday), [weekMonday]);
  const monthAnchor = useMemo(() => {
    const b = new Date();
    b.setHours(0, 0, 0, 0);
    b.setDate(1);
    b.setMonth(b.getMonth() + monthOffset);
    return b;
  }, [monthOffset]);
  const monthWeeks = useMemo(() => buildMonthWeeks(monthAnchor), [monthAnchor]);

  const range = useMemo(() => {
    if (view === 'week') return { from: weekDays[0].iso, to: weekDays[6].iso };
    const days = monthWeeks.flatMap((w) => w.days);
    return { from: days[0].iso, to: days[days.length - 1].iso };
  }, [view, weekDays, monthWeeks]);

  // ── data ──────────────────────────────────────────────────────────────────
  const loadBacklog = useCallback(async () => {
    const r = await fetch(`${API}/backlog`, { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Kunde inte hämta arbetsordrar');
    setBacklog(j.data.items as SchedulableWorkOrder[]);
  }, []);

  const loadSegments = useCallback(async (from: string, to: string) => {
    const r = await fetch(`${API}/segments?from=${from}&to=${to}`, { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Kunde inte hämta schemat');
    setSegments(j.data.segments as OpsSegment[]);
    setTrucks(j.data.trucks as OpsTruck[]);
  }, []);

  useEffect(() => {
    setLoadingBacklog(true);
    loadBacklog()
      .catch((e) => setError(e?.message || 'Något gick fel'))
      .finally(() => setLoadingBacklog(false));
  }, [loadBacklog]);

  useEffect(() => {
    loadSegments(range.from, range.to).catch((e) => setError(e?.message || 'Något gick fel'));
  }, [range.from, range.to, loadSegments]);

  const refresh = useCallback(async () => {
    try {
      await Promise.all([loadBacklog(), loadSegments(range.from, range.to)]);
    } catch {
      /* a transient refresh error shouldn't undo the action; next nav reloads */
    }
  }, [loadBacklog, loadSegments, range.from, range.to]);

  // ── mutations ───────────────────────────────────────────────────────────────
  const place = useCallback(
    async (workOrderId: string, truckId: string, startDay: string, endDay: string) => {
      const r = await fetch(`${API}/segments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_order_id: workOrderId, truck_id: truckId, start_day: startDay, end_day: endDay }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte placera ordern');
      toast.success('Order placerad');
      await refresh();
    },
    [refresh, toast],
  );

  const move = useCallback(
    async (id: string, patch: { truck_id?: string; start_day?: string; end_day?: string }) => {
      const r = await fetch(`${API}/segments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte flytta jobbet');
      await refresh();
    },
    [refresh, toast],
  );

  const unschedule = useCallback(
    async (id: string) => {
      const r = await fetch(`${API}/segments/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte avplanera');
      toast.success('Jobbet avplanerat');
      await refresh();
    },
    [refresh, toast],
  );

  // ── drag handlers ───────────────────────────────────────────────────────────
  const onBacklogDragStart = useCallback((e: React.DragEvent, item: SchedulableWorkOrder) => {
    dragRef.current = { kind: 'backlog', id: item.id };
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.effectAllowed = 'copyMove';
  }, []);

  const onSegDragStart = useCallback((e: React.DragEvent, seg: OpsSegment) => {
    dragRef.current = { kind: 'segment', id: seg.id, start: seg.start_day, end: seg.end_day, truckId: seg.truck_id };
    e.dataTransfer.setData('text/plain', seg.id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const onCellDrop = useCallback(
    (_e: React.DragEvent, truckId: string, dayISO: string) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (d.kind === 'backlog') void place(d.id, truckId, dayISO, dayISO);
      else {
        const span = daysBetweenInclusive(d.start, d.end);
        void move(d.id, { truck_id: truckId, start_day: dayISO, end_day: addDaysISO(dayISO, span - 1) });
      }
    },
    [place, move],
  );

  const onMonthDayDrop = useCallback(
    (_e: React.DragEvent, dayISO: string) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (d.kind === 'backlog') setTruckPicker({ dayISO, workOrderId: d.id });
      else {
        const span = daysBetweenInclusive(d.start, d.end);
        void move(d.id, { start_day: dayISO, end_day: addDaysISO(dayISO, span - 1) });
      }
    },
    [move],
  );

  const onBacklogDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setBacklogDropActive(false);
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.kind === 'segment') void unschedule(d.id);
    },
    [unschedule],
  );

  const onSegClick = useCallback((seg: OpsSegment) => router.push(`/crm/arbetsorder/${seg.work_order_id}`), [router]);

  // ── selection / click-to-place ───────────────────────────────────────────────
  const onSelect = useCallback((id: string) => setSelectedId((cur) => (cur === id ? null : id)), []);
  const onWeekCellClick = useCallback(
    (truckId: string, dayISO: string) => {
      if (!selectedId) return;
      void place(selectedId, truckId, dayISO, dayISO);
      setSelectedId(null);
    },
    [selectedId, place],
  );
  const onMonthDayClick = useCallback(
    (dayISO: string) => {
      if (selectedId) setTruckPicker({ dayISO, workOrderId: selectedId });
    },
    [selectedId],
  );
  const pickTruck = useCallback(
    (truckId: string) => {
      if (!truckPicker) return;
      void place(truckPicker.workOrderId, truckId, truckPicker.dayISO, truckPicker.dayISO);
      setTruckPicker(null);
      setSelectedId(null);
    },
    [truckPicker, place],
  );

  // ── filters ───────────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const matchJob = useCallback(
    (j: { ref: string; client_name: string; project_name: string; address: string | null }) =>
      !q || [j.ref, j.client_name, j.project_name, j.address].some((v) => (v ?? '').toLowerCase().includes(q)),
    [q],
  );
  const visibleBacklog = useMemo(() => backlog.filter((b) => matchJob(b)), [backlog, matchJob]);
  const visibleSegments = useMemo(
    () => segments.filter((s) => !hiddenTrucks.has(s.truck_id) && (s.job ? matchJob(s.job) : true)),
    [segments, hiddenTrucks, matchJob],
  );
  const visibleTrucks = useMemo(() => trucks.filter((t) => !hiddenTrucks.has(t.id)), [trucks, hiddenTrucks]);

  const toggleTruck = (id: string) =>
    setHiddenTrucks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const goToday = () => (view === 'week' ? setWeekOffset(0) : setMonthOffset(0));
  const goPrev = () => (view === 'week' ? setWeekOffset((o) => o - 1) : setMonthOffset((o) => o - 1));
  const goNext = () => (view === 'week' ? setWeekOffset((o) => o + 1) : setMonthOffset((o) => o + 1));

  const navLabel = view === 'week' ? swedishMonthYear(weekMonday) : swedishMonthYear(monthAnchor);
  const placing = canWrite && !!selectedId;
  const selected = backlog.find((b) => b.id === selectedId) ?? null;

  return (
    <div>
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={crm.pageTitle}>Planering</h1>
          <p className={crm.pageSubtitle}>Schemalägg arbetsordrar på bilar.</p>
        </div>

        <div className="inline-flex rounded-xl border border-[#e0e8dc] bg-white p-0.5">
          {(['week', 'month'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition',
                view === v ? 'text-white' : 'text-slate-500 hover:text-slate-800',
              )}
              style={view === v ? { backgroundColor: 'var(--crm-primary)' } : undefined}
            >
              {v === 'week' ? 'Vecka' : 'Månad'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[13px] font-bold text-slate-700">{navLabel}</span>
          <button className={crm.ghostButton} onClick={goPrev} aria-label="Bakåt">‹</button>
          <button className={crm.ghostButton} onClick={goToday}>Idag</button>
          <button className={crm.ghostButton} onClick={goNext} aria-label="Framåt">›</button>
          {view === 'week' && (
            <span className="ml-1 rounded-lg border border-[#e0e8dc] bg-white px-2.5 py-1 text-[11px] font-bold tabular-nums text-slate-600">
              v.{isoWeek(weekMonday)}
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div className="relative max-w-[280px] flex-1">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök Fortnox-nr, kund eller adress…"
            className="h-9 w-full rounded-lg border border-[#dce4d8] bg-white pl-9 pr-3 text-[13px] text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {trucks.map((t) => {
            const off = hiddenTrucks.has(t.id);
            return (
              <button
                key={t.id}
                onClick={() => toggleTruck(t.id)}
                className={cn(
                  'inline-flex h-[30px] items-center gap-2 rounded-full border px-3 text-[12px] font-semibold transition',
                  off ? 'border-[#e0e8dc] bg-[#f3f6f1] text-slate-400 opacity-60' : 'border-[#e0e8dc] bg-white text-slate-600 hover:border-[#c8d4c3]',
                )}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color || '#94a3b8' }} />
                {t.name}
              </button>
            );
          })}
        </div>
      </div>

      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      {selected && (
        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
          <strong>{selected.project_name}</strong> vald — klicka {view === 'week' ? 'en cell (bil + dag)' : 'en dag'} för att placera, eller dra kortet.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Backlog
          items={visibleBacklog}
          loading={loadingBacklog}
          canWrite={canWrite}
          selectedId={selectedId}
          onSelect={onSelect}
          onDragStartItem={onBacklogDragStart}
          onDropUnschedule={onBacklogDrop}
          onDragOver={(e) => {
            if (canWrite) {
              e.preventDefault();
              if (dragRef.current?.kind === 'segment') setBacklogDropActive(true);
            }
          }}
          dropActive={backlogDropActive}
        />

        {view === 'week' ? (
          <WeekBoard
            weekDays={weekDays}
            trucks={visibleTrucks}
            segments={visibleSegments}
            todayISO={todayISO}
            canWrite={canWrite}
            placing={placing}
            onCellClick={onWeekCellClick}
            onCellDrop={onCellDrop}
            onSegDragStart={onSegDragStart}
            onSegClick={onSegClick}
          />
        ) : (
          <MonthGrid
            weeks={monthWeeks}
            trucks={trucks}
            segments={visibleSegments}
            todayISO={todayISO}
            canWrite={canWrite}
            placing={placing}
            onDayClick={onMonthDayClick}
            onDayDrop={onMonthDayDrop}
            onSegDragStart={onSegDragStart}
            onSegClick={onSegClick}
          />
        )}
      </div>

      {/* Truck picker (month placement) */}
      {truckPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setTruckPicker(null)}>
          <div className="w-full max-w-xs rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-[13px] font-bold text-slate-900">Välj bil</h3>
            <div className="grid gap-1.5">
              {trucks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pickTruck(t.id)}
                  className="flex items-center gap-2.5 rounded-xl border border-[#e0e8dc] bg-white px-3 py-2 text-left text-[13px] font-semibold text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50"
                >
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.color || '#94a3b8' }} />
                  {t.name}
                </button>
              ))}
            </div>
            <button onClick={() => setTruckPicker(null)} className={cn(crm.ghostButton, 'mt-3 w-full')}>Avbryt</button>
          </div>
        </div>
      )}
    </div>
  );
}

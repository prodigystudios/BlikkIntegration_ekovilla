'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import type { OpsSegment, OpsTruck, SchedulableWorkOrder } from '@/lib/domains/planning/types';
import type { AssignablePerson, CrewMember } from '@/lib/domains/planning/crew';
import type { DayNote } from '@/lib/domains/planning/dayNotes';
import type { TruckCrewMember } from '@/lib/domains/planning/truckCrew';
import { DEFAULT_JOB_TYPES, type JobType, type JobTypeRow } from '@/lib/domains/planning/jobTypes';
import {
  addDays, addDaysISO, buildMonthWeeks, buildWeekDays, daysBetweenInclusive, fmtISO, isoWeek, startOfWeek, swedishMonthYear,
} from './planningDates';
import Backlog from './Backlog';
import WeekBoard from './WeekBoard';
import MonthGrid from './MonthGrid';
import type { SegmentActions } from './jobCard';
import { dayGroup, reorderWithinGroup } from '@/lib/domains/planning/order';
import ConfirmModal from './ConfirmModal';
import TruckManagerModal from './TruckManagerModal';
import DepotManagerModal from './DepotManagerModal';
import DepotStockModal from './DepotStockModal';
import JobTypeManagerModal from './JobTypeManagerModal';

type View = 'week' | 'month';
type DragData =
  | { kind: 'backlog'; id: string }
  | { kind: 'segment'; id: string; start: string; end: string; truckId: string };

const API = '/api/crm/planering';

export default function PlanningClient({
  canWrite,
  canManageTrucks,
  canManageDepots,
}: {
  canWrite: boolean;
  canManageTrucks: boolean;
  canManageDepots: boolean;
}) {
  const toast = useToast();
  const router = useRouter();

  const [view, setView] = useState<View>('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [showWeekend, setShowWeekend] = useState(false);

  const [backlog, setBacklog] = useState<SchedulableWorkOrder[]>([]);
  const [trucks, setTrucks] = useState<OpsTruck[]>([]);
  const [segments, setSegments] = useState<OpsSegment[]>([]);
  const [people, setPeople] = useState<AssignablePerson[]>([]);
  const [jobTypes, setJobTypes] = useState<JobType[]>(DEFAULT_JOB_TYPES);
  const [dayNotes, setDayNotes] = useState<DayNote[]>([]);
  const [truckCrew, setTruckCrew] = useState<TruckCrewMember[]>([]);
  const [loadingBacklog, setLoadingBacklog] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [salesFilter, setSalesFilter] = useState<string | null>(null);
  const [hiddenTrucks, setHiddenTrucks] = useState<Set<string>>(new Set());
  const [backlogDropActive, setBacklogDropActive] = useState(false);
  const [truckPicker, setTruckPicker] = useState<{ dayISO: string; workOrderId: string } | null>(null);
  const [confirmSeg, setConfirmSeg] = useState<OpsSegment | null>(null);
  const [truckManagerOpen, setTruckManagerOpen] = useState(false);
  const [depotManagerOpen, setDepotManagerOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [jobTypeManagerOpen, setJobTypeManagerOpen] = useState(false);

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

  const loadDayNotes = useCallback(async (from: string, to: string) => {
    const r = await fetch(`${API}/day-notes?from=${from}&to=${to}`, { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Kunde inte hämta noteringar');
    setDayNotes(j.data.notes as DayNote[]);
  }, []);

  const loadTruckCrew = useCallback(async (from: string, to: string) => {
    const r = await fetch(`${API}/truck-crew?from=${from}&to=${to}`, { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Kunde inte hämta bilbesättning');
    setTruckCrew(j.data.crew as TruckCrewMember[]);
  }, []);

  useEffect(() => {
    setLoadingBacklog(true);
    loadBacklog()
      .catch((e) => setError(e?.message || 'Något gick fel'))
      .finally(() => setLoadingBacklog(false));
  }, [loadBacklog]);

  // "Visa helg" preference, persisted across visits (weekends hidden by default for width).
  useEffect(() => {
    try {
      setShowWeekend(localStorage.getItem('crm-planning-show-weekend') === '1');
    } catch {
      /* ignore */
    }
  }, []);
  const toggleWeekend = useCallback(() => {
    setShowWeekend((v) => {
      const next = !v;
      try {
        localStorage.setItem('crm-planning-show-weekend', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Assignable crew (every named employee) — fetched once; a failure just leaves the picker empty.
  useEffect(() => {
    fetch(`${API}/crew`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setPeople(j.data.people as AssignablePerson[]);
      })
      .catch(() => {});
  }, []);

  // Job types (active ones) for the card chips + picker. Falls back to the built-in defaults before
  // the list loads (or if the migration hasn't run yet).
  const loadJobTypes = useCallback(async () => {
    const r = await fetch(`${API}/job-types`, { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) return;
    const active = (j.data.jobTypes as JobTypeRow[]).filter((t) => t.active).map((t) => ({ key: t.key, label: t.label, color: t.color }));
    if (active.length) setJobTypes(active);
  }, []);
  useEffect(() => {
    loadJobTypes().catch(() => {});
  }, [loadJobTypes]);

  useEffect(() => {
    loadSegments(range.from, range.to).catch((e) => setError(e?.message || 'Något gick fel'));
    loadDayNotes(range.from, range.to).catch(() => {});
    loadTruckCrew(range.from, range.to).catch(() => {});
  }, [range.from, range.to, loadSegments, loadDayNotes, loadTruckCrew]);

  // ── Realtime: ~10 planners work this board at once, so reflect each other's changes live to
  // avoid double-bookings + missed updates. Subscribe once to ops_* changes and debounce-refetch
  // the visible board (RLS still applies, so we only receive rows we may read). The ref keeps the
  // handler pointed at the current range/loaders without re-subscribing on every nav.
  const [supabase] = useState(() => createClientComponentClient());
  const reloadBoardRef = useRef<() => void>(() => {});
  reloadBoardRef.current = () => {
    loadSegments(range.from, range.to).catch(() => {});
    loadDayNotes(range.from, range.to).catch(() => {});
    loadTruckCrew(range.from, range.to).catch(() => {});
    loadBacklog().catch(() => {});
    loadJobTypes().catch(() => {});
  };

  useEffect(() => {
    const tables = [
      'ops_segments',
      'ops_segment_crew',
      'ops_truck_crew',
      'ops_day_notes',
      'ops_segment_reports',
      'ops_work_order_confirmations',
      'ops_trucks',
      'ops_depots',
      'ops_depot_deliveries',
      'ops_job_types',
    ];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ping = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => reloadBoardRef.current(), 400);
    };
    let ch = supabase.channel('planning-board-sync');
    for (const table of tables) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, ping);
    }
    ch.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(ch);
    };
  }, [supabase]);

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
    async (id: string, patch: { truck_id?: string; start_day?: string; end_day?: string; job_type?: string | null; on_hold?: boolean }) => {
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

  // Crew is per-segment, so add/remove patch the one segment's crew locally (snappy) rather than
  // refetching the whole board. A failed call toasts; the next nav/refresh resyncs from the server.
  const patchSegCrew = useCallback((segId: string, fn: (crew: CrewMember[]) => CrewMember[]) => {
    setSegments((prev) => prev.map((s) => (s.id === segId ? { ...s, crew: fn(s.crew) } : s)));
  }, []);

  const addCrew = useCallback(
    async (seg: OpsSegment, person: AssignablePerson) => {
      const r = await fetch(`${API}/segments/${seg.id}/crew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: person.id, member_name: person.full_name }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte lägga till montör');
      const item = j.data.item as CrewMember;
      patchSegCrew(seg.id, (crew) => [...crew.filter((c) => c.member_id !== person.id), item]);
    },
    [patchSegCrew, toast],
  );

  const removeCrew = useCallback(
    async (seg: OpsSegment, memberId: string) => {
      const r = await fetch(`${API}/segments/${seg.id}/crew?member_id=${memberId}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte ta bort montör');
      patchSegCrew(seg.id, (crew) => crew.filter((c) => c.member_id !== memberId));
    },
    [patchSegCrew, toast],
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
  const onSetJobType = useCallback((seg: OpsSegment, jobType: string | null) => void move(seg.id, { job_type: jobType }), [move]);
  const onToggleHold = useCallback((seg: OpsSegment, value: boolean) => void move(seg.id, { on_hold: value }), [move]);
  const onResize = useCallback((seg: OpsSegment, startDay: string, endDay: string) => void move(seg.id, { start_day: startDay, end_day: endDay }), [move]);
  const onSetStatus = useCallback(
    async (seg: OpsSegment, status: string) => {
      const r = await fetch(`/api/crm/work-orders/${seg.work_order_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte ändra status');
      toast.success('Status uppdaterad');
      await refresh();
    },
    [toast, refresh],
  );
  const openConfirm = useCallback((seg: OpsSegment) => setConfirmSeg(seg), []);

  // Day notes: optimistic local updates (a failed call resyncs from the server on the next nav).
  const addDayNote = useCallback(
    async (dayISO: string, body: string) => {
      const r = await fetch(`${API}/day-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_day: dayISO, body }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte spara noteringen');
      setDayNotes((prev) => [...prev, j.data.item as DayNote]);
    },
    [toast],
  );

  const removeDayNote = useCallback(
    async (id: string) => {
      setDayNotes((cur) => cur.filter((n) => n.id !== id));
      const r = await fetch(`${API}/day-notes/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.ok) {
        toast.error(j.error || 'Kunde inte ta bort noteringen');
        loadDayNotes(range.from, range.to).catch(() => {});
      }
    },
    [toast, loadDayNotes, range.from, range.to],
  );

  // Weekly truck crew: assign for the visible week (startDay/endDay come from the board). Optimistic.
  const addTruckCrew = useCallback(
    async (truckId: string, person: AssignablePerson, startDay: string, endDay: string) => {
      const r = await fetch(`${API}/truck-crew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ truck_id: truckId, member_id: person.id, member_name: person.full_name, start_day: startDay, end_day: endDay }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte lägga till i bilbesättningen');
      setTruckCrew((prev) => [...prev, j.data.item as TruckCrewMember]);
    },
    [toast],
  );

  const removeTruckCrew = useCallback(
    async (truckId: string, memberId: string) => {
      const row = truckCrew.find((c) => c.truck_id === truckId && c.member_id === memberId);
      if (!row) return;
      setTruckCrew((prev) => prev.filter((c) => c.id !== row.id));
      const r = await fetch(`${API}/truck-crew/${row.id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.ok) {
        toast.error(j.error || 'Kunde inte ta bort ur bilbesättningen');
        loadTruckCrew(range.from, range.to).catch(() => {});
      }
    },
    [toast, truckCrew, loadTruckCrew, range.from, range.to],
  );

  const copyTruckCrew = useCallback(
    async (truckId: string, sourceFrom: string, sourceTo: string) => {
      const r = await fetch(`${API}/truck-crew/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          truck_id: truckId,
          source_start: sourceFrom,
          source_end: sourceTo,
          target_start: addDaysISO(sourceFrom, 7),
          target_end: addDaysISO(sourceTo, 7),
        }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte kopiera besättningen');
      const copied = j.data.copied ?? 0;
      toast.success(copied > 0 ? `Besättning kopierad till nästa vecka (${copied})` : 'Nästa vecka har redan besättningen');
      loadTruckCrew(range.from, range.to).catch(() => {});
    },
    [toast, loadTruckCrew, range.from, range.to],
  );

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
  // Sales-responsible options for the backlog filter: assignees present in the backlog, named via
  // the people list (profiles are self-read-only, so we can't join names server-side).
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.full_name])), [people]);
  const salesOptions = useMemo(() => {
    const ids = [...new Set(backlog.map((b) => b.assigned_to).filter((v): v is string => Boolean(v)))];
    return ids
      .map((id) => ({ id, name: peopleById.get(id) ?? 'Okänd säljare' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  }, [backlog, peopleById]);

  const visibleBacklog = useMemo(
    () => backlog.filter((b) => matchJob(b) && (!salesFilter || b.assigned_to === salesFilter)),
    [backlog, matchJob, salesFilter],
  );
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

  // Reorder jobs that share a truck on the same day (sort_index) — nudges one earlier/later and
  // PATCHes the affected segments, then refreshes.
  const reorderSegment = useCallback(
    async (seg: OpsSegment, direction: 'up' | 'down') => {
      const changes = reorderWithinGroup(dayGroup(segments, seg), seg.id, direction);
      if (!changes.length) return;
      const results = await Promise.all(
        changes.map((ch) =>
          fetch(`${API}/segments/${ch.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_index: ch.sort_index }),
          }).then((r) => r.json()),
        ),
      );
      if (results.some((j) => !j.ok)) toast.error('Kunde inte ändra ordningen');
      await refresh();
    },
    [segments, refresh, toast],
  );

  const actions = useMemo<SegmentActions>(
    () => ({ onSetStatus, onSetJobType, onToggleHold, onOpenConfirm: openConfirm, onResize, onAddCrew: addCrew, onRemoveCrew: removeCrew, onReorder: reorderSegment }),
    [onSetStatus, onSetJobType, onToggleHold, openConfirm, onResize, addCrew, removeCrew, reorderSegment],
  );

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
          {view === 'week' && (
            <button
              onClick={toggleWeekend}
              className={cn(
                'ml-1 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition',
                showWeekend ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-[#e0e8dc] bg-white text-slate-500 hover:border-[#c8d4c3]',
              )}
            >
              {showWeekend ? 'Dölj helg' : 'Visa helg'}
            </button>
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

        {salesOptions.length > 0 && (
          <select
            value={salesFilter ?? ''}
            onChange={(e) => setSalesFilter(e.target.value || null)}
            aria-label="Filtrera på säljare"
            className="h-9 rounded-lg border border-[#dce4d8] bg-white px-2.5 text-[12.5px] text-slate-600 outline-none transition focus:border-emerald-500"
          >
            <option value="">Alla säljare</option>
            {salesOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
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
          {canManageTrucks && (
            <button
              onClick={() => setTruckManagerOpen(true)}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-dashed border-[#c8d4c3] bg-white px-3 text-[12px] font-semibold text-slate-500 transition hover:border-emerald-400 hover:text-emerald-600"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 17h4V5H2v12h3M15 17h6v-5l-3-3h-3M5.5 17a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0ZM16.5 17a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z" />
              </svg>
              Bilar
            </button>
          )}
          {canManageDepots && (
            <button
              onClick={() => setDepotManagerOpen(true)}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-dashed border-[#c8d4c3] bg-white px-3 text-[12px] font-semibold text-slate-500 transition hover:border-emerald-400 hover:text-emerald-600"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21V8l9-5 9 5v13M3 21h18M9 21v-6h6v6" />
              </svg>
              Depåer
            </button>
          )}
          {canManageTrucks && (
            <button
              onClick={() => setJobTypeManagerOpen(true)}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-dashed border-[#c8d4c3] bg-white px-3 text-[12px] font-semibold text-slate-500 transition hover:border-emerald-400 hover:text-emerald-600"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
              </svg>
              Jobbtyper
            </button>
          )}
          <button
            onClick={() => setStockOpen(true)}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-dashed border-[#c8d4c3] bg-white px-3 text-[12px] font-semibold text-slate-500 transition hover:border-emerald-400 hover:text-emerald-600"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7l9-4 9 4-9 4-9-4ZM3 7v10l9 4 9-4V7M12 11v10" />
            </svg>
            Lager
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      {selected && (
        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
          <strong>{selected.project_name}</strong> vald — klicka {view === 'week' ? 'en cell (bil + dag)' : 'en dag'} för att placera, eller dra kortet.
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
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
            showWeekend={showWeekend}
            trucks={visibleTrucks}
            segments={visibleSegments}
            todayISO={todayISO}
            canWrite={canWrite}
            placing={placing}
            people={people}
            jobTypes={jobTypes}
            onCellClick={onWeekCellClick}
            onCellDrop={onCellDrop}
            onSegDragStart={onSegDragStart}
            onSegClick={onSegClick}
            actions={actions}
            dayNotes={dayNotes}
            onAddNote={addDayNote}
            onRemoveNote={removeDayNote}
            truckCrew={truckCrew}
            onAddTruckCrew={addTruckCrew}
            onRemoveTruckCrew={removeTruckCrew}
            onCopyTruckCrew={copyTruckCrew}
          />
        ) : (
          <MonthGrid
            weeks={monthWeeks}
            trucks={trucks}
            segments={visibleSegments}
            todayISO={todayISO}
            canWrite={canWrite}
            placing={placing}
            people={people}
            jobTypes={jobTypes}
            onDayClick={onMonthDayClick}
            onDayDrop={onMonthDayDrop}
            onSegDragStart={onSegDragStart}
            onSegClick={onSegClick}
            actions={actions}
            dayNotes={dayNotes}
          />
        )}
      </div>

      {/* Legend — job-type colours (dot) + status rail colours, mirroring the card accents. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[10.5px] text-slate-500">
        <span className="font-bold text-slate-600">Jobbtyp:</span>
        {jobTypes.map((t) => (
          <span key={t.key} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
            {t.label}
          </span>
        ))}
        <span className="h-3 w-px bg-[#e0e8dc]" />
        <span className="font-bold text-slate-600">Status:</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" />Planerad</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-400" />Pågående</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Fakturera</span>
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

      {/* Order confirmation (SMS/email) */}
      {confirmSeg && (
        <ConfirmModal segment={confirmSeg} onClose={() => setConfirmSeg(null)} onSent={refresh} />
      )}

      {/* Fleet management */}
      {truckManagerOpen && (
        <TruckManagerModal
          onClose={() => setTruckManagerOpen(false)}
          onChanged={() => loadSegments(range.from, range.to).catch(() => {})}
        />
      )}

      {/* Depot management */}
      {depotManagerOpen && (
        <DepotManagerModal
          onClose={() => setDepotManagerOpen(false)}
          onChanged={() => loadSegments(range.from, range.to).catch(() => {})}
        />
      )}

      {/* Depot stock (balances + deliveries) */}
      {stockOpen && <DepotStockModal canWrite={canWrite} onClose={() => setStockOpen(false)} />}

      {/* Job-type management */}
      {jobTypeManagerOpen && (
        <JobTypeManagerModal onClose={() => setJobTypeManagerOpen(false)} onChanged={() => loadJobTypes().catch(() => {})} />
      )}
    </div>
  );
}

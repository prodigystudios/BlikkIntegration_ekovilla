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
import type { DefaultCrewMember } from '@/lib/domains/planning/defaultCrew';
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
import PlanningAdminModal from './PlanningAdminModal';
import ActivityLogModal from './ActivityLogModal';
import PlaceholderModal, { type PlaceholderInput } from './PlaceholderModal';

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
  const [stackWeeks, setStackWeeks] = useState(false);

  const [backlog, setBacklog] = useState<SchedulableWorkOrder[]>([]);
  const [trucks, setTrucks] = useState<OpsTruck[]>([]);
  const [segments, setSegments] = useState<OpsSegment[]>([]);
  const [people, setPeople] = useState<AssignablePerson[]>([]);
  const [jobTypes, setJobTypes] = useState<JobType[]>(DEFAULT_JOB_TYPES);
  const [dayNotes, setDayNotes] = useState<DayNote[]>([]);
  const [truckCrew, setTruckCrew] = useState<TruckCrewMember[]>([]);
  const [defaultCrew, setDefaultCrew] = useState<DefaultCrewMember[]>([]);
  const [loadingBacklog, setLoadingBacklog] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [salesFilter, setSalesFilter] = useState<string | null>(null);
  const [hiddenTrucks, setHiddenTrucks] = useState<Set<string>>(new Set());
  const [backlogDropActive, setBacklogDropActive] = useState(false);
  const [truckPicker, setTruckPicker] = useState<{ dayISO: string; workOrderId: string } | null>(null);
  const [copySeg, setCopySeg] = useState<OpsSegment | null>(null);
  const [confirmSeg, setConfirmSeg] = useState<OpsSegment | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [placeholderOpen, setPlaceholderOpen] = useState(false);

  const dragRef = useRef<DragData | null>(null);
  const todayISO = useMemo(() => fmtISO(new Date()), []);

  // ── visible range (depends on view + offset) ──────────────────────────────
  const weekMonday = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset]);
  const weekDays = useMemo(() => buildWeekDays(weekMonday), [weekMonday]);
  // "Hela månaden"-toggle: stack this week + each following week through the month end, each as
  // its own WeekBoard (otherwise just the single current week).
  const weekMondays = useMemo(() => {
    if (view !== 'week' || !stackWeeks) return [weekMonday];
    const end = new Date(weekMonday);
    end.setMonth(end.getMonth() + 1, 0); // last day of weekMonday's month
    const out: Date[] = [];
    for (let m = weekMonday; m.getTime() <= end.getTime(); m = addDays(m, 7)) out.push(m);
    return out.length ? out : [weekMonday];
  }, [view, stackWeeks, weekMonday]);
  const weekDaysList = useMemo(() => weekMondays.map((m) => buildWeekDays(m)), [weekMondays]);
  const monthAnchor = useMemo(() => {
    const b = new Date();
    b.setHours(0, 0, 0, 0);
    b.setDate(1);
    b.setMonth(b.getMonth() + monthOffset);
    return b;
  }, [monthOffset]);
  const monthWeeks = useMemo(() => buildMonthWeeks(monthAnchor), [monthAnchor]);

  const range = useMemo(() => {
    if (view === 'week') {
      const first = weekDaysList[0];
      const last = weekDaysList[weekDaysList.length - 1];
      return { from: first[0].iso, to: last[6].iso };
    }
    const days = monthWeeks.flatMap((w) => w.days);
    return { from: days[0].iso, to: days[days.length - 1].iso };
  }, [view, weekDaysList, monthWeeks]);

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

  // Default crew (standardbemanning) is range-independent — every truck's standing team. The board
  // falls back to it on weeks with no explicit truck crew.
  const loadDefaultCrew = useCallback(async () => {
    const r = await fetch(`${API}/default-crew`, { cache: 'no-store' });
    const j = await r.json();
    if (j.ok) setDefaultCrew(j.data.crew as DefaultCrewMember[]);
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
      setStackWeeks(localStorage.getItem('crm-planning-stack-weeks') === '1');
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
  const toggleStackWeeks = useCallback(() => {
    setStackWeeks((v) => {
      const next = !v;
      try {
        localStorage.setItem('crm-planning-stack-weeks', next ? '1' : '0');
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
    loadDefaultCrew().catch(() => {});
  }, [range.from, range.to, loadSegments, loadDayNotes, loadTruckCrew, loadDefaultCrew]);

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
    loadDefaultCrew().catch(() => {});
    loadBacklog().catch(() => {});
    loadJobTypes().catch(() => {});
  };

  useEffect(() => {
    const tables = [
      'ops_segments',
      'ops_segment_crew',
      'ops_truck_crew',
      'ops_truck_default_crew',
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

  // Placeholders have no work order to open; clicking one is a no-op (edit/link comes in a later slice).
  const onSegClick = useCallback(
    (seg: OpsSegment) => {
      if (seg.work_order_id) router.push(`/crm/arbetsorder/${seg.work_order_id}`);
    },
    [router],
  );
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

  // Fork a week from the truck's default crew so it can be edited independently; restore drops the
  // override and the lane falls back to the default again.
  const weekCrewAction = useCallback(
    async (action: 'materialize' | 'restore', truckId: string, startDay: string, endDay: string) => {
      const r = await fetch(`${API}/truck-crew/week`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, truck_id: truckId, start_day: startDay, end_day: endDay }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte uppdatera veckans besättning');
      loadTruckCrew(range.from, range.to).catch(() => {});
    },
    [toast, loadTruckCrew, range.from, range.to],
  );
  const forkWeek = useCallback((t: string, f: string, to: string) => weekCrewAction('materialize', t, f, to), [weekCrewAction]);
  const restoreWeek = useCallback((t: string, f: string, to: string) => weekCrewAction('restore', t, f, to), [weekCrewAction]);

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

  // Copy a scheduled job to another truck as a freestanding duplicate (its own ops_segment with the
  // same work order, dates and job type) — e.g. when two trucks share a big job.
  const copyToTruck = useCallback(
    async (truckId: string) => {
      if (!copySeg) return;
      const r = await fetch(`${API}/segments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_order_id: copySeg.work_order_id,
          truck_id: truckId,
          start_day: copySeg.start_day,
          end_day: copySeg.end_day,
          job_type: copySeg.job_type,
        }),
      });
      const j = await r.json();
      setCopySeg(null);
      if (!j.ok) return toast.error(j.error || 'Kunde inte kopiera jobbet');
      toast.success('Jobbet kopierat');
      await refresh();
    },
    [copySeg, refresh, toast],
  );

  // Create a placeholder card (booked slot before the real work order exists).
  const createPlaceholder = useCallback(
    async (input: PlaceholderInput) => {
      const r = await fetch(`${API}/placeholders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte skapa platshållaren');
      setPlaceholderOpen(false);
      toast.success('Platshållare skapad');
      await refresh();
    },
    [refresh, toast],
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
    () => ({ onSetStatus, onSetJobType, onToggleHold, onOpenConfirm: openConfirm, onResize, onAddCrew: addCrew, onRemoveCrew: removeCrew, onReorder: reorderSegment, onCopyToTruck: (seg) => setCopySeg(seg), onDelete: (seg) => unschedule(seg.id) }),
    [onSetStatus, onSetJobType, onToggleHold, openConfirm, onResize, addCrew, removeCrew, reorderSegment, unschedule],
  );

  return (
    <>
    <div className="planning-density">
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
          {view === 'week' && (
            <button
              onClick={toggleStackWeeks}
              className={cn(
                'ml-1 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition',
                stackWeeks ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-[#e0e8dc] bg-white text-slate-500 hover:border-[#c8d4c3]',
              )}
            >
              {stackWeeks ? 'En vecka' : 'Hela månaden'}
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
          <button
            onClick={() => setAdminOpen(true)}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-dashed border-[#c8d4c3] bg-white px-3 text-[12px] font-semibold text-slate-500 transition hover:border-emerald-400 hover:text-emerald-600"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
            Administrera
          </button>
          <button
            onClick={() => setActivityOpen(true)}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-dashed border-[#c8d4c3] bg-white px-3 text-[12px] font-semibold text-slate-500 transition hover:border-emerald-400 hover:text-emerald-600"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8v4l3 2M3.05 11a9 9 0 1 1 .5 4M3 21v-5h5" />
            </svg>
            Logg
          </button>
          {canWrite && (
            <button
              onClick={() => setPlaceholderOpen(true)}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-dashed border-[#c8d4c3] bg-white px-3 text-[12px] font-semibold text-slate-500 transition hover:border-emerald-400 hover:text-emerald-600"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4" />
              </svg>
              Ny platshållare
            </button>
          )}
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
          <div className="grid gap-4">
            {weekMondays.map((m, i) => {
              const wd = weekDaysList[i];
              return (
                <div key={wd[0].iso}>
                  {weekMondays.length > 1 && (
                    <div className="mb-1.5 flex items-center gap-2 px-1">
                      <span className="rounded-lg border border-[#e0e8dc] bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-600">v.{isoWeek(m)}</span>
                      <span className="text-[12px] font-semibold tabular-nums text-slate-500">{wd[0].dayLabel}–{wd[6].dayLabel}</span>
                    </div>
                  )}
                  <WeekBoard
                    weekDays={wd}
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
                    defaultCrew={defaultCrew}
                    onAddTruckCrew={addTruckCrew}
                    onRemoveTruckCrew={removeTruckCrew}
                    onCopyTruckCrew={copyTruckCrew}
                    onForkWeek={forkWeek}
                    onRestoreWeek={restoreWeek}
                  />
                </div>
              );
            })}
          </div>
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
    </div>

      {/* Modals/overlays live OUTSIDE .planning-density so their `fixed` positioning isn't thrown
          off by the zoom — they render at 100% and stay centred. */}
      {/* Truck picker (month placement) */}
      {truckPicker && (
        <div className="fixed inset-0 z-[2800] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setTruckPicker(null)}>
          <div className="planning-modal w-full max-w-xs rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
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

      {/* Copy-to-truck picker (freestanding duplicate of a scheduled job) */}
      {copySeg && (
        <div className="fixed inset-0 z-[2800] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setCopySeg(null)}>
          <div className="planning-modal w-full max-w-xs rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[13px] font-bold text-slate-900">Kopiera till bil</h3>
            <p className="mb-3 mt-0.5 text-[11px] text-slate-500">
              Skapar en kopia av <strong>{copySeg.job?.ref ?? 'jobbet'}</strong> på vald bil ({copySeg.start_day === copySeg.end_day ? copySeg.start_day : `${copySeg.start_day}–${copySeg.end_day}`}).
            </p>
            <div className="grid gap-1.5">
              {trucks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => copyToTruck(t.id)}
                  className="flex items-center gap-2.5 rounded-xl border border-[#e0e8dc] bg-white px-3 py-2 text-left text-[13px] font-semibold text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50"
                >
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.color || '#94a3b8' }} />
                  {t.name}
                  {t.id === copySeg.truck_id && <span className="ml-auto text-[10px] font-normal text-slate-400">nuvarande</span>}
                </button>
              ))}
            </div>
            <button onClick={() => setCopySeg(null)} className={cn(crm.ghostButton, 'mt-3 w-full')}>Avbryt</button>
          </div>
        </div>
      )}

      {/* Order confirmation (SMS/email) */}
      {confirmSeg && (
        <ConfirmModal segment={confirmSeg} onClose={() => setConfirmSeg(null)} onSent={refresh} />
      )}

      {/* Consolidated admin (bilar · depåer · jobbtyper · lager) */}
      {adminOpen && (
        <PlanningAdminModal
          canManageTrucks={canManageTrucks}
          canManageDepots={canManageDepots}
          canWrite={canWrite}
          onClose={() => setAdminOpen(false)}
          onChanged={() => {
            loadSegments(range.from, range.to).catch(() => {});
            loadJobTypes().catch(() => {});
          }}
        />
      )}

      {/* Activity log (audit trail) */}
      {activityOpen && <ActivityLogModal onClose={() => setActivityOpen(false)} />}

      {/* New placeholder (booked slot before a work order exists) */}
      {placeholderOpen && (
        <PlaceholderModal
          trucks={trucks}
          jobTypes={jobTypes}
          defaultDay={todayISO}
          onClose={() => setPlaceholderOpen(false)}
          onCreate={createPlaceholder}
        />
      )}
    </>
  );
}

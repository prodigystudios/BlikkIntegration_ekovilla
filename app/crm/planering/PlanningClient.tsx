'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { crm, workOrderStatusAccent } from '@/app/crm/lib/crmTokens';
import { withReturnTo } from '@/app/crm/lib/returnTo';
import type { OpsSegment, OpsTruck, SchedulableWorkOrder } from '@/lib/domains/planning/types';
import { matchesJobSearch, type JobDisplay } from '@/lib/domains/planning/display';
import type { AssignablePerson, CrewMember } from '@/lib/domains/planning/crew';
import type { DayNote } from '@/lib/domains/planning/dayNotes';
import { crewForTruckInRange, type TruckCrewMember } from '@/lib/domains/planning/truckCrew';
import type { DefaultCrewMember } from '@/lib/domains/planning/defaultCrew';
import type { DepotBalance } from '@/lib/domains/planning/depotStock';
import { DEFAULT_JOB_TYPES, type JobType, type JobTypeRow } from '@/lib/domains/planning/jobTypes';
import {
  addDays, addDaysISO, buildMonthWeeks, buildWeekDays, daysBetweenInclusive, fmtISO, isoWeek,
  sectionStart, startOfWeek, stockholmToday, swedishMonthYear, weeksBetweenMondays,
} from './planningDates';
import Backlog from './Backlog';
import BoardSectionNav from './BoardSectionNav';
import SearchField from './SearchField';
import WeekBoard from './WeekBoard';
import MonthGrid from './MonthGrid';
import type { SegmentActions } from './jobCard';
import { dayGroup, reorderWithinGroup } from '@/lib/domains/planning/order';
import ConfirmModal from './ConfirmModal';
import PlanningAdminModal from './PlanningAdminModal';
import ActivityLogModal from './ActivityLogModal';
import PlaceholderModal, { type PlaceholderInput } from './PlaceholderModal';
import InsightsView from './InsightsView';

type View = 'week' | 'month' | 'insights';
type DragData =
  | { kind: 'backlog'; id: string }
  | { kind: 'segment'; id: string; start: string; end: string; truckId: string };

const API = '/api/crm/planering';

// ── Vy-inställningar som överlever ett besök ──────────────────────────────────
//
// Planeraren ställer in samma sak varje gång annars: vilka bilar som ska synas, vilken säljares
// ordrar backloggen visar, vilken flik i backloggen.
//
// 🧨 NYCKLARNA HÄR ÄR AV TVÅ OLIKA SLAG, och skillnaden är hela poängen med `prefsLoaded`:
//
//   • `hiddenTrucks`, `salesFilter`, `backlogFilter`, `showWeekend` är RENA VYVAL — de filtrerar
//     eller döljer data som redan är hämtad och rör varken `range` eller någon fråga.
//   • `stackWeeks` ("Hela månaden") STYR INTERVALLET. Det är den som gav buggen: den vidgar
//     `range` efter mount, så tavlan hämtade två gånger och svaren kapplöpte (PR #135).
//
// `prefsLoaded` finns för den andra sorten och FÅR INTE tas bort så länge någon nyckel här styr
// vad som hämtas. Lägger du till en sådan nyckel gäller samma grind.
const PREF_KEYS = {
  showWeekend: 'crm-planning-show-weekend',
  stackWeeks: 'crm-planning-stack-weeks',
  hiddenTrucks: 'crm-planning-hidden-trucks',
  salesFilter: 'crm-planning-sales-filter',
  backlogFilter: 'crm-planning-backlog-filter',
} as const;

// ⚠️ `localStorage` KASTAR i privat läge och när kakor är blockerade — den är inte bara tom. Ett
// blockerat lager ska betyda att standardvärdena står, aldrig att tavlan inte renderar.
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignorera — inställningen gäller sessionen ut, den överlever bara inte */
  }
}

// A ticket dispenser that lets a loader tell whether its response is still the one we want.
//
// Several board loads can be in flight at once — a realtime event lands mid-load, you step periods
// quickly, or (the case that actually bit) the range widens right after mount. The network makes no
// promise about the order answers come back in, so without this the OLDER, narrower answer can land
// last and overwrite rows the newer one had already filled: the board renders a month of columns
// holding a single week of cards, with no error anywhere because both responses were `ok`.
//
// start() takes the next ticket; isCurrent() says whether it is still the newest.
//
// ⚠️ Held in a ref, NOT a useMemo. Every loader below lists its dispenser in a useCallback dep
// array, and those loaders are themselves effect dependencies — so a fresh object each render would
// give every loader a new identity, re-run the effects depending on them, and hammer the API in an
// endless reload loop. React documents useMemo as a performance hint it is free to discard, which
// makes it the wrong tool when the identity is load-bearing for correctness. A ref is guaranteed.
type LoadTicket = { start: () => number; isCurrent: (ticket: number) => boolean };

function useLoadTicket(): LoadTicket {
  const seq = useRef(0);
  const dispenser = useRef<LoadTicket | null>(null);
  if (dispenser.current === null) {
    dispenser.current = {
      start: () => (seq.current += 1),
      isCurrent: (ticket: number) => ticket === seq.current,
    };
  }
  return dispenser.current;
}

// Fetch under a ticket: resolves the payload while this is still the newest load, or null once a
// newer one has overtaken it.
//
// The guard wraps the WHOLE call, not just the parsed body. A superseded request that dies at the
// network or parse level — the connection drops, an HTML error page comes back where JSON was
// expected — must be dropped just as quietly as a superseded success: we no longer want its answer,
// so we have no business raising its failure over the board that replaced it.
async function fetchLatest<T>(ticketer: LoadTicket, url: string, fallbackMessage: string): Promise<T | null> {
  const ticket = ticketer.start();
  try {
    const response = await fetch(url, { cache: 'no-store' });
    // Parsed defensively: the routes answer their own failures as JSON with a Swedish message, but
    // a gateway 502 or a redirect to the login page returns HTML, and letting that hit .json()
    // unguarded put a raw English SyntaxError in the banner instead of the message written for it.
    const body = await response.json().catch(() => null);
    if (!ticketer.isCurrent(ticket)) return null;
    if (!body || !body.ok) throw new Error(body?.error || fallbackMessage);
    return body.data as T;
  } catch (e) {
    if (!ticketer.isCurrent(ticket)) return null;
    throw e;
  }
}

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
  // Whether the persisted view preferences have been read yet — see the effect that sets it.
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const [backlog, setBacklog] = useState<SchedulableWorkOrder[]>([]);
  const [trucks, setTrucks] = useState<OpsTruck[]>([]);
  const [segments, setSegments] = useState<OpsSegment[]>([]);
  const [people, setPeople] = useState<AssignablePerson[]>([]);
  const [jobTypes, setJobTypes] = useState<JobType[]>(DEFAULT_JOB_TYPES);
  const [dayNotes, setDayNotes] = useState<DayNote[]>([]);
  const [truckCrew, setTruckCrew] = useState<TruckCrewMember[]>([]);
  const [defaultCrew, setDefaultCrew] = useState<DefaultCrewMember[]>([]);
  const [depotStock, setDepotStock] = useState<DepotBalance[]>([]);
  const [loadingBacklog, setLoadingBacklog] = useState(true);
  const [backlogLoaded, setBacklogLoaded] = useState(false);
  const [boardLoaded, setBoardLoaded] = useState(false);
  // Two error slots, not one. The schedule and the backlog fail independently, and a successful
  // schedule load clears its own banner — sharing a single slot let that success wipe a live backlog
  // error, leaving the panel showing "Skapa en order i CRM:et…" over a list that had failed to load
  // rather than a list that is genuinely empty.
  const [error, setError] = useState<string | null>(null);
  const [backlogError, setBacklogError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Two searches, deliberately separate. One box used to filter both the schedule and the backlog,
  // which broke the one workflow it was meant to serve: searching the backlog for a job to place
  // simultaneously emptied the board, so you could no longer see what was already booked on the
  // days you were placing it into. The board box scopes the board; the backlog box (rendered
  // inside <Backlog>) scopes the backlog.
  const [boardSearch, setBoardSearch] = useState('');
  const [backlogSearch, setBacklogSearch] = useState('');
  const [salesFilter, setSalesFilter] = useState<string | null>(null);
  const [backlogFilter, setBacklogFilter] = useState<'unplanned' | 'planned' | 'all'>('unplanned');
  const [hiddenTrucks, setHiddenTrucks] = useState<Set<string>>(new Set());
  // 🧨 EN SKRIVNING MOT EN BORTVALD BIL AVDÖLJER DEN. Bortvalet är en avdammning av vyn, inte ett
  // förbud mot att planera på bilen — men ett jobb som hamnar på en dold bil filtreras bort ur
  // `visibleSegments` och SYNS INTE. Förut avslöjade nästa omladdning det; nu när bortvalet sitter
  // kvar gör den inte det, och planeraren som tror att placeringen misslyckades gör om den →
  // dubbelbokning. Att i stället utelämna dolda bilar ur väljarna var första försöket, men det
  // gjorde en avdammning till en permanent spärr utan förklaring. Det här får båda: målet finns
  // kvar, och resultatet går alltid att se.
  //
  // 📐 Anropas från SKRIVVÄGARNA (`place`, `copyToTruck`, `createPlaceholder`) och först efter en
  // lyckad skrivning — inte från knapparna. Alla tre bilväljarna går genom dem, och en nekad
  // placering ska inte tyst ändra planerarens filter. Ligger här uppe för att alla tre ska kunna
  // ha den i sin beroendelista; stabil identitet och funktionell uppdatering av samma skäl.
  const revealTruck = useCallback((id: string) => {
    setHiddenTrucks((prev) => {
      if (!prev.has(id)) return prev; // oförändrad mängd → ingen onödig omrendering
      const next = new Set(prev);
      next.delete(id);
      writePref(PREF_KEYS.hiddenTrucks, next.size ? JSON.stringify([...next]) : null);
      return next;
    });
  }, []);
  const [backlogDropActive, setBacklogDropActive] = useState(false);
  const [truckPicker, setTruckPicker] = useState<{ dayISO: string; workOrderId: string } | null>(null);
  const [copySeg, setCopySeg] = useState<OpsSegment | null>(null);
  const [confirmSeg, setConfirmSeg] = useState<OpsSegment | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [placeholderOpen, setPlaceholderOpen] = useState(false);

  const dragRef = useRef<DragData | null>(null);
  // ONE clock read for the whole board, anchored to Europe/Stockholm.
  //
  // The zone matters because this component is server-rendered before it hydrates and the server
  // runs on UTC — see stockholmToday in ./planningDates. Reading it once matters for a different
  // reason: "today" and the week/month offsets have to agree. When they each called the clock
  // separately, a board left open across midnight resolved them against different days, so
  // stepping to "next week" on a Sunday night jumped two weeks.
  //
  // (The anchor is still fixed at mount, so the today-highlight on a board left open overnight goes
  // stale until the next navigation. Consistently stale, which is the harmless kind — refreshing it
  // live needs a timer and belongs in its own change.)
  const todayAnchor = useMemo(() => stockholmToday(), []);
  const todayISO = useMemo(() => fmtISO(todayAnchor), [todayAnchor]);

  // ── visible range (depends on view + offset) ──────────────────────────────
  const weekMonday = useMemo(() => addDays(startOfWeek(todayAnchor), weekOffset * 7), [todayAnchor, weekOffset]);
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
    const b = new Date(todayAnchor); // copy — todayAnchor is shared and the setters below mutate
    b.setDate(1);
    b.setMonth(b.getMonth() + monthOffset);
    return b;
  }, [todayAnchor, monthOffset]);
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
  // One ticket dispenser per loader, never shared: they read different endpoints, so a day-notes
  // load must not invalidate an in-flight segments load. Each checks its ticket BEFORE inspecting
  // the payload — a superseded response's error is as moot as its data, and surfacing it would put
  // a red banner over a board that had just loaded fine.
  const backlogLoad = useLoadTicket();
  const segmentsLoad = useLoadTicket();
  const dayNotesLoad = useLoadTicket();
  const truckCrewLoad = useLoadTicket();
  const defaultCrewLoad = useLoadTicket();
  const depotStockLoad = useLoadTicket();

  // The backlog spinner is cleared HERE rather than by the effect that raised it, so that whichever
  // load is current owns it. Clearing it on a superseded response would drop the panel to its empty
  // state ("Skapa en order i CRM:et…") while a newer request is still in flight — reading as "you
  // have no work orders" — and leaving it to the mount effect alone would strand it spinning over
  // data that had already arrived, because the overtaking caller never touches it.
  const loadBacklog = useCallback(async () => {
    try {
      const data = await fetchLatest<{ items: SchedulableWorkOrder[] }>(backlogLoad, `${API}/backlog`, 'Kunde inte hämta arbetsordrar');
      if (!data) return; // superseded — the load that overtook this one owns the spinner now
      setBacklog(data.items);
      setBacklogError(null);
      setBacklogLoaded(true);
      setLoadingBacklog(false);
    } catch (e) {
      // fetchLatest only throws while current, so reaching here means this load still owns it.
      setLoadingBacklog(false);
      throw e;
    }
  }, [backlogLoad]);

  const loadSegments = useCallback(async (from: string, to: string) => {
    const data = await fetchLatest<{ segments: OpsSegment[]; trucks: OpsTruck[] }>(
      segmentsLoad,
      `${API}/segments?from=${from}&to=${to}`,
      'Kunde inte hämta schemat',
    );
    if (!data) return;
    setSegments(data.segments);
    setTrucks(data.trucks);
    setBoardLoaded(true);
    // A good load clears a stale banner. Nothing else in this component ever resets `error`, so
    // without this one transient blip would leave the red box up for the rest of the session while
    // every reload behind it quietly succeeded.
    setError(null);
  }, [segmentsLoad]);

  const loadDayNotes = useCallback(async (from: string, to: string) => {
    const data = await fetchLatest<{ notes: DayNote[] }>(dayNotesLoad, `${API}/day-notes?from=${from}&to=${to}`, 'Kunde inte hämta noteringar');
    if (data) setDayNotes(data.notes);
  }, [dayNotesLoad]);

  const loadTruckCrew = useCallback(async (from: string, to: string) => {
    const data = await fetchLatest<{ crew: TruckCrewMember[] }>(truckCrewLoad, `${API}/truck-crew?from=${from}&to=${to}`, 'Kunde inte hämta bilbesättning');
    if (data) setTruckCrew(data.crew);
  }, [truckCrewLoad]);

  // Default crew (standardbemanning) is range-independent — every truck's standing team. The board
  // falls back to it on weeks with no explicit truck crew.
  const loadDefaultCrew = useCallback(async () => {
    const data = await fetchLatest<{ crew: DefaultCrewMember[] }>(defaultCrewLoad, `${API}/default-crew`, 'Kunde inte hämta standardbemanning');
    if (data) setDefaultCrew(data.crew);
  }, [defaultCrewLoad]);

  // Depot stock + planned demand — range-independent (all open booked jobs vs current stock). Drives
  // the "lager räcker inte"-banner so planners catch a shortfall before over-committing.
  const loadDepotStock = useCallback(async () => {
    const data = await fetchLatest<{ depots: DepotBalance[] }>(depotStockLoad, `${API}/depot-stock`, 'Kunde inte hämta lagersaldo');
    if (data) setDepotStock(data.depots);
  }, [depotStockLoad]);

  useEffect(() => {
    setLoadingBacklog(true);
    // loadBacklog owns clearing the spinner — see its comment.
    loadBacklog().catch((e) => setBacklogError(e?.message || 'Kunde inte hämta arbetsordrar'));
  }, [loadBacklog]);

  // "Visa helg" + "Hela månaden" preferences, persisted across visits (weekends hidden by default
  // for width). Read after mount, not in a lazy useState initializer: this component is
  // server-rendered first and localStorage doesn't exist there, so seeding from it would make the
  // server and client markup disagree.
  //
  // prefsLoaded gates the range-driven load below. "Hela månaden" widens the range, so before this
  // ran the board fetched TWICE on every visit — once for the single week the server rendered, then
  // again for the month — and the two answers raced. Waiting one render costs nothing visible (the
  // skeleton is already up) and means only the correct range is ever asked for.
  useEffect(() => {
    setShowWeekend(readPref(PREF_KEYS.showWeekend) === '1');
    setStackWeeks(readPref(PREF_KEYS.stackWeeks) === '1');

    // Dolda bilar sparas som de DOLDA id:na, aldrig som de synliga. En bil som läggs till i
    // administrationen efteråt syns då av sig själv; hade vi sparat de synliga hade den varit
    // osynlig för alla som någon gång rört filtret, utan att någon förstod varför.
    // Ett id för en borttagen bil matchar ingenting och är ofarligt.
    const storedTrucks = readPref(PREF_KEYS.hiddenTrucks);
    if (storedTrucks) {
      try {
        const parsed: unknown = JSON.parse(storedTrucks);
        if (Array.isArray(parsed)) {
          setHiddenTrucks(new Set(parsed.filter((v): v is string => typeof v === 'string')));
        }
      } catch {
        /* trasigt värde: standardläget (inga dolda) är rätt svar */
      }
    }

    setSalesFilter(readPref(PREF_KEYS.salesFilter) || null);

    // Validera mot de tillåtna värdena. Ett okänt värde skulle annars ge en backlogg där INGEN
    // flik är markerad och listan filtrerar på något som inte går att välja bort.
    const storedBacklog = readPref(PREF_KEYS.backlogFilter);
    if (storedBacklog === 'unplanned' || storedBacklog === 'planned' || storedBacklog === 'all') {
      setBacklogFilter(storedBacklog);
    }

    setPrefsLoaded(true);
  }, []);
  const toggleWeekend = useCallback(() => {
    setShowWeekend((v) => {
      const next = !v;
      writePref(PREF_KEYS.showWeekend, next ? '1' : '0');
      return next;
    });
  }, []);
  const toggleStackWeeks = useCallback(() => {
    setStackWeeks((v) => {
      const next = !v;
      writePref(PREF_KEYS.stackWeeks, next ? '1' : '0');
      return next;
    });
  }, []);
  const chooseSalesFilter = useCallback((id: string | null) => {
    setSalesFilter(id);
    writePref(PREF_KEYS.salesFilter, id);
  }, []);
  const chooseBacklogFilter = useCallback((next: 'unplanned' | 'planned' | 'all') => {
    setBacklogFilter(next);
    writePref(PREF_KEYS.backlogFilter, next);
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
    // Hold until the persisted "Hela månaden" preference is in, so the first request already asks
    // for the range the board is about to render.
    if (!prefsLoaded) return;
    loadSegments(range.from, range.to).catch((e) => setError(e?.message || 'Något gick fel'));
    loadDayNotes(range.from, range.to).catch(() => {});
    loadTruckCrew(range.from, range.to).catch(() => {});
    loadDefaultCrew().catch(() => {});
    loadDepotStock().catch(() => {});
  }, [prefsLoaded, range.from, range.to, loadSegments, loadDayNotes, loadTruckCrew, loadDefaultCrew, loadDepotStock]);

  // ── Realtime: ~10 planners work this board at once, so reflect each other's changes live to
  // avoid double-bookings + missed updates. Subscribe once to ops_* changes and debounce-refetch
  // the visible board (RLS still applies, so we only receive rows we may read). The ref keeps the
  // handler pointed at the current range/loaders without re-subscribing on every nav.
  const [supabase] = useState(() => createClientComponentClient());
  const reloadBoardRef = useRef<() => void>(() => {});
  reloadBoardRef.current = () => {
    // A failed reload normally costs nothing visible — the board keeps the segments it already has,
    // so a red banner over a perfectly usable schedule would be pure noise, and these fire often
    // with ten planners on the board. The one case that must speak is a failure while nothing has
    // ever loaded: this reload supersedes whatever was in flight, so the response it displaced is
    // already discarded, and staying quiet would leave the "Laddar schema…" skeleton up for good
    // with no data and nothing to press.
    loadSegments(range.from, range.to).catch((e) => {
      if (!boardLoaded) setError(e?.message || 'Kunde inte hämta schemat');
    });
    loadDayNotes(range.from, range.to).catch(() => {});
    loadTruckCrew(range.from, range.to).catch(() => {});
    loadDefaultCrew().catch(() => {});
    loadDepotStock().catch(() => {});
    // Same rule as the schedule above: quiet while a list is already on screen, but a failure that
    // supersedes the only load that ever succeeded has to speak — otherwise the panel shows its
    // "Skapa en order i CRM:et…" empty state over orders that had in fact loaded.
    loadBacklog().catch((e) => {
      if (!backlogLoaded) setBacklogError(e?.message || 'Kunde inte hämta arbetsordrar');
    });
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
      revealTruck(truckId); // se noten vid revealTruck — annars hamnar jobbet utanför synfältet
      toast.success('Order placerad');
      // Append the created segment locally instead of refetching the whole board; bump the source
      // job's backlog count so its badge stays in sync.
      if (j.data?.item) {
        setSegments((prev) => [...prev, j.data.item as OpsSegment]);
        setBacklog((prev) => prev.map((b) => (b.id === workOrderId ? { ...b, segment_count: b.segment_count + 1 } : b)));
      } else {
        refresh();
      }
    },
    [refresh, toast, revealTruck],
  );

  const move = useCallback(
    async (id: string, patch: { truck_id?: string; start_day?: string; end_day?: string; job_type?: string | null; on_hold?: boolean }) => {
      // Optimistic: reflect the change locally at once so the card doesn't snap back to its old value
      // while the PATCH is in flight (and a full refetch lands). Re-sync from the server only on error.
      setSegments((cur) =>
        cur.map((s) =>
          s.id === id
            ? {
                ...s,
                ...(patch.truck_id !== undefined ? { truck_id: patch.truck_id } : {}),
                ...(patch.start_day !== undefined ? { start_day: patch.start_day } : {}),
                ...(patch.end_day !== undefined ? { end_day: patch.end_day } : {}),
                ...(patch.job_type !== undefined ? { job_type: patch.job_type } : {}),
                ...(patch.on_hold !== undefined ? { on_hold: patch.on_hold } : {}),
              }
            : s,
        ),
      );
      const r = await fetch(`${API}/segments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!j.ok) {
        toast.error(j.error || 'Kunde inte flytta jobbet');
        refresh();
      }
    },
    [refresh, toast],
  );

  const unschedule = useCallback(
    async (id: string) => {
      // Optimistic: drop the card at once + decrement the job's backlog placement count (so it hops
      // back to "Oplanerade" when its last placement is removed); re-sync only if the delete fails.
      const woId = segments.find((s) => s.id === id)?.work_order_id ?? null;
      setSegments((prev) => prev.filter((s) => s.id !== id));
      if (woId) setBacklog((prev) => prev.map((b) => (b.id === woId ? { ...b, segment_count: Math.max(0, b.segment_count - 1) } : b)));
      const r = await fetch(`${API}/segments/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.ok) {
        toast.error(j.error || 'Kunde inte avplanera');
        refresh();
        return;
      }
      toast.success('Jobbet avplanerat');
    },
    [segments, refresh, toast],
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
      // Tillbaka till tavlan, inte till orderlistan. (Vald vecka är komponentstate och ligger
      // inte i URL:en, så återkomsten landar på innevarande vecka.)
      if (seg.work_order_id) router.push(withReturnTo(`/crm/arbetsorder/${seg.work_order_id}`, '/crm/planering'));
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

  // The week matters: in "Hela månaden" the loaded range spans several weeks, so truckCrew holds one
  // row per week per person. Resolving on (truck, member) alone deleted whichever week happened to
  // come first — pick the row from the same week the caller clicked, using the very predicate the
  // board rendered that week's crew with.
  const removeTruckCrew = useCallback(
    async (truckId: string, memberId: string, startDay: string, endDay: string) => {
      const row = crewForTruckInRange(truckCrew, truckId, startDay, endDay).find((c) => c.member_id === memberId);
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
      revealTruck(truckId); // se noten vid revealTruck — en kopia på en dold bil är osynlig
      toast.success('Jobbet kopierat');
      await refresh();
    },
    [copySeg, refresh, toast, revealTruck],
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
      // Platshållarmodalen är den TREDJE bilväljaren, och dess förval är `trucks[0]` — som mycket
      // väl kan vara en bortvald bil. Samma regel som de andra två: en placering på en dold bil
      // avdöljer den, annars skapas något som inte syns. Se noten vid `revealTruck`.
      revealTruck(input.truck_id);
      toast.success('Platshållare skapad');
      await refresh();
    },
    [refresh, toast, revealTruck],
  );

  // ── filters ───────────────────────────────────────────────────────────────
  const matchBoard = useCallback((j: JobDisplay) => matchesJobSearch(j, boardSearch), [boardSearch]);
  const matchBacklog = useCallback((j: JobDisplay) => matchesJobSearch(j, backlogSearch), [backlogSearch]);
  // Sales-responsible options for the backlog filter: assignees present in the backlog, named via
  // the people list (profiles are self-read-only, so we can't join names server-side).
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.full_name])), [people]);
  const salesOptions = useMemo(() => {
    const ids = [...new Set(backlog.map((b) => b.assigned_to).filter((v): v is string => Boolean(v)))];
    // 🧨 DEN AKTIVA SÄLJAREN MÅSTE ALLTID FINNAS SOM VAL. Listan härleds ur den backlogg som är
    // laddad just nu, och sedan filtret sparas mellan besök är det fullt normalt att den sparade
    // säljaren inte har någon order kvar att planera. Saknas värdet bland optionerna matchar
    // `<select value>` ingenting, webbläsaren visar den FÖRSTA raden ("Alla säljare") — och
    // backloggen står tom, filtrerad på en säljare rutan påstår att man inte valt. Samma fälla som
    // arbetsorderns statusväljare redan bär en kommentar om.
    // Bonusen: villkoret `salesOptions.length > 0` i Backlog kan annars dölja hela väljaren, så
    // filtret hade inte ens gått att stänga av.
    if (salesFilter && !ids.includes(salesFilter)) ids.push(salesFilter);
    return ids
      .map((id) => ({ id, name: peopleById.get(id) ?? 'Okänd säljare' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  }, [backlog, peopleById, salesFilter]);

  // Search + sales-filtered set, then split by whether the job is already placed (segment_count): the
  // backlog defaults to showing only unplanned jobs so it doesn't fill up with scheduled work.
  const backlogBase = useMemo(
    () => backlog.filter((b) => matchBacklog(b) && (!salesFilter || b.assigned_to === salesFilter)),
    [backlog, matchBacklog, salesFilter],
  );
  const backlogCounts = useMemo(() => {
    const planned = backlogBase.reduce((n, b) => n + (b.segment_count > 0 ? 1 : 0), 0);
    return { planned, unplanned: backlogBase.length - planned, all: backlogBase.length };
  }, [backlogBase]);
  const visibleBacklog = useMemo(
    () =>
      backlogFilter === 'all'
        ? backlogBase
        : backlogBase.filter((b) => (backlogFilter === 'planned' ? b.segment_count > 0 : b.segment_count === 0)),
    [backlogBase, backlogFilter],
  );
  const visibleSegments = useMemo(
    () => segments.filter((s) => !hiddenTrucks.has(s.truck_id) && (s.job ? matchBoard(s.job) : true)),
    [segments, hiddenTrucks, matchBoard],
  );
  const visibleTrucks = useMemo(() => trucks.filter((t) => !hiddenTrucks.has(t.id)), [trucks, hiddenTrucks]);
  // ⚠️ Räknat på BILARNA, inte på `hiddenTrucks.size`. Mängden bär sparade id:n, och ett id för en
  // borttagen bil hade då hållit "Visa alla" uppe för alltid med ett tal som inte motsvarar något
  // på skärmen. Den hade dessutom blinkat förbi vid varje laddning: inställningarna läses efter
  // mount, medan `trucks` kommer med första hämtningen.
  const hiddenTruckCount = useMemo(() => trucks.filter((t) => hiddenTrucks.has(t.id)).length, [trucks, hiddenTrucks]);
  // Tavlan är tom för att filtret tömt den — inte för att inga bilar finns. `trucks.length > 0`
  // är det som skiljer de två, och skillnaden avgör vilket besked som är sant.
  const allTrucksHidden = trucks.length > 0 && visibleTrucks.length === 0;

  const toggleTruck = (id: string) =>
    setHiddenTrucks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Tom mängd → ta bort nyckeln i stället för att spara "[]". Samma regel som showAllTrucks och
      // revealTruck, så "inget dolt" alltid ser likadant ut i lagret.
      writePref(PREF_KEYS.hiddenTrucks, next.size ? JSON.stringify([...next]) : null);
      return next;
    });
  // ⚠️ Nollställningen finns FÖR att valet numera sitter kvar. Förut räckte en omladdning för att
  // få tillbaka alla bilar; nu gör den inte det, och en tavla där varje bil är bortvald är tom
  // utan att se trasig ut. Knappen visas bara när något faktiskt är dolt.
  const showAllTrucks = () => {
    setHiddenTrucks(new Set());
    writePref(PREF_KEYS.hiddenTrucks, null);
  };
  // 🧨 ATT VÄLJA EN DOLD BIL AVDÖLJER DEN. Bortvalet är en avdammning av vyn, inte ett förbud mot
  // att planera på bilen — men ett jobb som läggs på en dold bil filtreras bort ur
  // `visibleSegments` och SYNS INTE. Förut avslöjade nästa omladdning det; nu när bortvalet sitter
  // kvar gör den inte det, och planeraren som tror att placeringen misslyckades gör om den →
  // dubbelbokning. Att i stället utelämna dolda bilar ur väljarna var första försöket, men det
  // gjorde en avdammning till en permanent spärr utan förklaring. Det här får båda: målet finns
  // kvar, och resultatet går alltid att se.
  // (`revealTruck` bor högre upp — `createPlaceholder` behöver den i sin beroendelista.)

  const goToday = () => (view === 'week' ? setWeekOffset(0) : setMonthOffset(0));
  const goPrev = () => (view === 'week' ? setWeekOffset((o) => o - 1) : setMonthOffset((o) => o - 1));
  const goNext = () => (view === 'week' ? setWeekOffset((o) => o + 1) : setMonthOffset((o) => o + 1));

  // ── bottom pager ───────────────────────────────────────────────────────────
  // Moves a whole section — the chunk you just finished reading — rather than the header's single
  // week. In "Hela månaden" a section is a month's stack, and sectionStart owns where a step lands
  // (see planningDates): anchored on the month, NOT on how many weeks the current stack holds,
  // since August has five Mondays and September four and stepping by the stack's own width leaves
  // a week unreachable.
  //
  // The header's ‹ › keep their one-week step on purpose, for fine adjustment across a boundary.
  const stepNoun = view === 'month' || stackWeeks ? 'månad' : 'vecka';
  // Sits on the board COLUMN, not the two-column wrapper: below lg the grid collapses to a single
  // column with the backlog first, so anchoring on the wrapper would scroll to the backlog panel
  // instead of the schedule — the very scrolling the pager exists to avoid.
  const boardTopRef = useRef<HTMLDivElement>(null);

  // Land at the start of the new period. Without this you keep the scroll position you pressed at —
  // the bottom — and arrive looking at the end of the period you just moved into.
  const scrollToBoardTop = useCallback(() => {
    boardTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const goSection = useCallback(
    (dir: -1 | 1) => {
      if (view === 'month') setMonthOffset((o) => o + dir);
      else if (stackWeeks) {
        // weekOffset counts weeks from today's Monday, so convert the section target back into a
        // week delta.
        const delta = weeksBetweenMondays(weekMonday, sectionStart(weekMonday, dir));
        setWeekOffset((o) => o + delta);
      } else setWeekOffset((o) => o + dir);
      scrollToBoardTop();
    },
    [view, stackWeeks, weekMonday, scrollToBoardTop],
  );

  const goSectionToday = useCallback(() => {
    if (view === 'week') setWeekOffset(0);
    else setMonthOffset(0);
    scrollToBoardTop();
  }, [view, scrollToBoardTop]);

  const navLabel = view === 'week' ? swedishMonthYear(weekMonday) : swedishMonthYear(monthAnchor);
  const placing = canWrite && !!selectedId;
  const selected = backlog.find((b) => b.id === selectedId) ?? null;

  // Reorder jobs that share a truck on the same day (sort_index) — nudges one earlier/later and
  // PATCHes the affected segments, then refreshes.
  const reorderSegment = useCallback(
    async (seg: OpsSegment, direction: 'up' | 'down') => {
      const changes = reorderWithinGroup(dayGroup(segments, seg), seg.id, direction);
      if (!changes.length) return;
      // Optimistic: apply the new sort_index locally before the PATCHes land.
      const order = new Map(changes.map((c) => [c.id, c.sort_index]));
      setSegments((cur) => cur.map((s) => (order.has(s.id) ? { ...s, sort_index: order.get(s.id) as number } : s)));
      const results = await Promise.all(
        changes.map((ch) =>
          fetch(`${API}/segments/${ch.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_index: ch.sort_index }),
          }).then((r) => r.json()),
        ),
      );
      if (results.some((j) => !j.ok)) {
        toast.error('Kunde inte ändra ordningen');
        refresh();
      }
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
          {(['week', 'month', 'insights'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition',
                view === v ? 'text-white' : 'text-slate-500 hover:text-slate-800',
              )}
              style={view === v ? { backgroundColor: 'var(--crm-primary)' } : undefined}
            >
              {({ week: 'Vecka', month: 'Månad', insights: 'Insikter' } as const)[v]}
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
        {/* Scopes the schedule only — the backlog has its own box. */}
        <SearchField
          value={boardSearch}
          onChange={setBoardSearch}
          placeholder="Sök i schemat…"
          ariaLabel="Sök bland inplanerade jobb"
          className="max-w-[280px] flex-1"
        />

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
          {hiddenTruckCount > 0 && (
            <button
              onClick={showAllTrucks}
              title="Visa alla bilar igen"
              className="inline-flex h-[30px] items-center rounded-full border border-[#e0e8dc] bg-white px-3 text-[12px] font-semibold text-emerald-700 transition hover:border-emerald-400 hover:bg-emerald-50"
            >
              {/* "1 dolda" är fel svenska — samma numerusfel som listvyns "1 rader". */}
              Visa alla ({hiddenTruckCount} {hiddenTruckCount === 1 ? 'dold' : 'dolda'})
            </button>
          )}
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

      {/* Schedule errors only. A backlog failure is reported inside the backlog panel itself, where
          the empty list it explains actually is — see its loadError prop. */}
      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      {/* Depot stock shortfall — the booked work needs more sacks than the depot has in stock. */}
      {depotStock.some((d) => d.rows.some((r) => r.shortfall > 0)) && (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
          <div className="flex items-center gap-1.5 font-bold">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
            Lagret räcker inte för det som är bokat
          </div>
          <ul className="mt-1 grid gap-0.5 pl-0.5">
            {depotStock.flatMap((d) =>
              d.rows
                .filter((r) => r.shortfall > 0)
                .map((r) => (
                  <li key={`${d.depot_id}-${r.material}`} className="tabular-nums">
                    <strong>{d.depot_name}</strong> · {r.material}: planerat {r.planned}, lager {r.balance} <strong>(−{r.shortfall} säck)</strong>
                  </li>
                )),
            )}
          </ul>
          <div className="mt-1 text-[11px] text-rose-500">Registrera en påfyllning under Administrera → Lager.</div>
        </div>
      )}

      {selected && (
        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
          <strong>{selected.project_name}</strong> vald — klicka {view === 'week' ? 'en cell (bil + dag)' : 'en dag'} för att placera, eller dra kortet.
        </div>
      )}

      {view === 'insights' ? (
        <InsightsView weeks={8} />
      ) : (
      <>
      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Backlog
          items={visibleBacklog}
          loading={loadingBacklog}
          canWrite={canWrite}
          selectedId={selectedId}
          filter={backlogFilter}
          onFilterChange={chooseBacklogFilter}
          counts={backlogCounts}
          loadError={backlogError}
          search={backlogSearch}
          onSearchChange={setBacklogSearch}
          salesFilter={salesFilter}
          onSalesFilterChange={chooseSalesFilter}
          salesOptions={salesOptions}
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

        {!boardLoaded ? (
          // Skeleton while the schedule first loads — avoids flashing "Inga bilar upplagda än".
          <div className={cn(crm.card, 'p-3')}>
            <div className="grid gap-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-3 w-16 shrink-0 animate-pulse rounded bg-[#e8efe5]" />
                  <div className="h-14 flex-1 animate-pulse rounded-xl bg-[#eef3eb]" />
                </div>
              ))}
            </div>
            <div className="mt-2.5 text-center text-[11px] text-slate-400">Laddar schema…</div>
          </div>
        ) : allTrucksHidden ? (
          // ⚠️ Beskedet bor HÄR, inte i vyerna. Filtret ägs av den här komponenten, och båda
          // brädena är tomma av samma skäl: WeekBoard hade annars skrivit "Inga bilar upplagda än"
          // (som skickar planeraren till administrationen för att lägga upp bilar som redan finns)
          // och MonthGrid har ingen tomtext alls — en blank kalender utan förklaring. Sedan
          // bortvalet sparas står bägge kvar efter en omladdning. Ett tomt läge måste säga VARFÖR.
          <div className={cn(crm.card, 'grid justify-items-center gap-2 p-8')}>
            <p className="m-0 text-sm text-slate-500">
              Alla {hiddenTruckCount} bilar är bortvalda i filterraden, så det finns inget att visa.
            </p>
            <button
              onClick={showAllTrucks}
              className="rounded-full border border-[#e0e8dc] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-emerald-700 transition hover:border-emerald-400 hover:bg-emerald-50"
            >
              Visa alla bilar
            </button>
          </div>
        ) : (
          <div ref={boardTopRef} className="grid scroll-mt-3 gap-3">
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

            {/* Navigation at the end of the board, so reaching the end of a period doesn't mean
                scrolling back to the top to step past it. Moves a whole section, not a week. */}
            <BoardSectionNav
              label={navLabel}
              stepNoun={stepNoun}
              onPrev={() => goSection(-1)}
              onToday={goSectionToday}
              onNext={() => goSection(1)}
            />
          </div>
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
        <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${workOrderStatusAccent.scheduled}`} />Planerad</span>
        <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${workOrderStatusAccent.in_progress}`} />Pågående</span>
        <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${workOrderStatusAccent.completed}`} />Fakturera</span>
      </div>
      </>
      )}
    </div>

      {/* Modals/overlays live OUTSIDE .planning-density so their `fixed` positioning isn't thrown
          off by the zoom — they render at 100% and stay centred. */}
      {/* Truck picker (month placement) */}
      {truckPicker && (
        <div className="fixed inset-0 z-[2800] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setTruckPicker(null)}>
          <div className="w-full max-w-xs rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-[13px] font-bold text-slate-900">Välj bil</h3>
            {/* Alla bilar listas, även bortvalda — se `revealTruck`. En dold bil märks ut och
                avdöljs av valet, så jobbet aldrig hamnar utanför synfältet. */}
            <div className="grid gap-1.5">
              {trucks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pickTruck(t.id)}
                  className="flex items-center gap-2.5 rounded-xl border border-[#e0e8dc] bg-white px-3 py-2 text-left text-[13px] font-semibold text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50"
                >
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.color || '#94a3b8' }} />
                  {t.name}
                  {hiddenTrucks.has(t.id) && <span className="ml-auto text-[10px] font-normal text-slate-400">dold – visas igen</span>}
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
          <div className="w-full max-w-xs rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[13px] font-bold text-slate-900">Kopiera till bil</h3>
            <p className="mb-3 mt-0.5 text-[11px] text-slate-500">
              Skapar en kopia av <strong>{copySeg.job?.ref ?? 'jobbet'}</strong> på vald bil ({copySeg.start_day === copySeg.end_day ? copySeg.start_day : `${copySeg.start_day}–${copySeg.end_day}`}).
            </p>
            <div className="grid gap-1.5">
              {/* Se noten vid `revealTruck` — en kopia på en dold bil är en osynlig kopia. */}
              {trucks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => copyToTruck(t.id)}
                  className="flex items-center gap-2.5 rounded-xl border border-[#e0e8dc] bg-white px-3 py-2 text-left text-[13px] font-semibold text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50"
                >
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.color || '#94a3b8' }} />
                  {t.name}
                  {t.id === copySeg.truck_id ? (
                    <span className="ml-auto text-[10px] font-normal text-slate-400">nuvarande</span>
                  ) : hiddenTrucks.has(t.id) ? (
                    <span className="ml-auto text-[10px] font-normal text-slate-400">dold – visas igen</span>
                  ) : null}
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
            // Same rule as the realtime reload: quiet unless nothing has loaded yet. "Administrera"
            // sits above the skeleton, so a change made while the first load is still in flight
            // supersedes it — and a silent failure here would strand that skeleton for good.
            loadSegments(range.from, range.to).catch((e) => {
              if (!boardLoaded) setError(e?.message || 'Kunde inte hämta schemat');
            });
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

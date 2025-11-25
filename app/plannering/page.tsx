"use client";
export const dynamic = 'force-dynamic';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useProjectComments, formatRelativeTime } from '@/lib/useProjectComments';
import { startOfMonth, endOfMonth, fmtDate, isoWeekNumber, isoWeekYear, isoWeekKey, startOfIsoWeek, endOfIsoWeek, mondayFromIsoWeekKey } from './_lib/date';
import { deriveColors, creatorColor, creatorInitials } from './_lib/colors';
import EmailSummaryPanel from './components/EmailSummaryPanel';
import FiltersBar from './components/FiltersBar';
import CalendarMonthGrid from './components/CalendarMonthGrid';
import CalendarWeekdayLanes from './components/CalendarWeekdayLanes';
import CalendarDayList from './components/CalendarDayList';
import nextDynamic from 'next/dynamic';
const AdminJobTypes = nextDynamic(() => import('../admin/jobtypes/AdminJobTypes'), { ssr: false });
// NOTE: The file header was previously corrupted by an accidental paste of JSX outside any component.
// Restoring intended interface/type declarations here.

interface Project {
  id: string;
  name: string;
  orderNumber: string | null;
  customer: string;
  customerId: number | null;
  customerEmail: string | null;
  createdAt: string; // ISO timestamp
  status: string;
  salesResponsible: string | null;
  isManual: boolean;
}

interface ScheduledSegment {
  id: string;
  projectId: string; // FK to Project.id
  startDay: string;  // 'YYYY-MM-DD'
  endDay: string;    // 'YYYY-MM-DD'
  createdBy?: string | null;
  createdByName?: string | null;
  depotId?: string | null; // optional per-segment depot override
  sortIndex?: number | null; // explicit order within a truck/day
  truck?: string | null; // per-segment truck assignment (added)
}

interface ProjectScheduleMeta {
  projectId: string;
  truck?: string | null;
  color?: string | null;
  bagCount?: number | null;
  jobType?: string | null;
  client_notified?: boolean | null;
  client_notified_at?: string | null;
  client_notified_by?: string | null;
  actual_bags_used?: number | null;
  actual_bags_set_at?: string | null;
  actual_bags_set_by?: string | null;
}

// Partial bag reporting per segment/day
interface SegmentReport {
  id: string;
  segmentId: string; // FK to planning_segments.id
  reportDay: string; // 'YYYY-MM-DD'
  amount: number; // säckar
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt?: string | null; // ISO
  projectId?: string | null; // denormalized project id
}

// Small inline control to copy a segment to another truck
function CopyToTruckButton({ segmentId, day, currentTruck, trucks, onCopy }: { segmentId: string; day: string; currentTruck: string | null; trucks: string[]; onCopy: (targetTruck: string) => void }) {
  const [target, setTarget] = useState<string>('');
  const options = trucks.filter(t => t && t !== currentTruck);
  if (options.length === 0) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <select value={target} onChange={e => setTarget(e.target.value)} style={{ fontSize: 10, padding: '2px 4px', border: '1px solid #cbd5e1', borderRadius: 4 }}>
        <option value="">Välj lastbil…</option>
        {options.map(t => (<option key={t} value={t}>{t}</option>))}
      </select>
      <button
        type="button"
        className="btn--plain btn--xs"
        disabled={!target}
        onClick={(e) => { e.stopPropagation(); if (target) onCopy(target); }}
        title="Kopiera till annan lastbil"
        style={{ fontSize: 10, background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412', borderRadius: 4, padding: '2px 4px' }}
      >
        Kopiera
      </button>
    </span>
  );
}

// Normalize a raw project from /api/blikk/projects into our Project shape
function normalizeProject(p: any): Project {
  return {
    id: String(p.id),
    name: p.name || 'Okänt namn',
    orderNumber: p.orderNumber ?? null,
    customer: p.customer || 'Okänd kund',
    customerId: p.customerId != null && p.customerId !== '' ? Number(p.customerId) : null,
    customerEmail: p.customerEmail ?? null,
    createdAt: p.createdAt || new Date().toISOString(),
    status: p.status || 'unknown',
    salesResponsible: p.salesResponsible ?? null,
    isManual: p.isManual || false,
  };
}

// date helpers moved to ./_lib/date

function RefreshIcon({ size = 16, title = 'Uppdatera' }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={true}
      focusable={false}
    >
      <title>{title}</title>
      {/* Curved arrow around the circle */}
      <path d="M21 12a9 9 0 1 1-6.364-8.485" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* Arrow head at the top-right */}
      <path d="M19 4h4v4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon({ size = 16, title = 'Laddar' }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={true}
      focusable={false}
    >
      <title>{title}</title>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" fill="none" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

export default function PlanneringPage() {
  // Loading/data
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  // Lightweight refresh for initial projects list (for the backlog panel)
  const [projectsRefreshLoading, setProjectsRefreshLoading] = useState(false);
  // --- Lightweight in-memory caches & single-flight tracking ---
  const PROJECTS_CACHE_TTL = 60_000; // 60s
  const LOOKUP_CACHE_TTL = 5 * 60_000; // 5 min
  const CONTACT_CACHE_TTL = 10 * 60_000; // 10 min
  const projectsCacheRef = useRef<{ data: Project[]; fetchedAt: number } | null>(null);
  const lookupCacheRef = useRef<Map<string, { fetchedAt: number; data: any }>>(new Map());
  const lookupInFlightRef = useRef<Map<string, Promise<any>>>(new Map());
  const contactEmailCacheRef = useRef<Map<number, { email: string | null; fetchedAt: number }>>(new Map());
  const contactEmailInFlightRef = useRef<Map<number, Promise<string | null>>>(new Map());
  const lastPartialReportAtRef = useRef<number>(0);

  const refreshInitialProjects = useCallback(async (limit: number = 10) => {
    if (projectsRefreshLoading) return;
    // If we have a fresh cached list, reuse it to avoid a network burst.
    const cached = projectsCacheRef.current;
    const now = Date.now();
    if (cached && (now - cached.fetchedAt) < PROJECTS_CACHE_TTL) {
      // Reorder using cached data (same logic as successful fetch) so user still sees "recent" subset first.
      setProjectsRefreshLoading(true);
      try {
        const top = cached.data.slice(0, limit);
        setProjects(prev => {
          const prevMap = new Map<string, Project>(prev.map(p => [p.id, p] as const));
          for (const p of top) prevMap.set(p.id, p);
          const seen = new Set<string>();
          const out: Project[] = [];
          for (const p of top) { if (!seen.has(p.id)) { out.push(p); seen.add(p.id); } }
          for (const p of prev) { if (!seen.has(p.id)) { out.push(prevMap.get(p.id)!); } }
          return out;
        });
      } finally {
        setProjectsRefreshLoading(false);
      }
      return;
    }
    setProjectsRefreshLoading(true);
    try {
      const res = await fetch(`/api/blikk/projects?limit=${encodeURIComponent(String(limit))}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Fel vid hämtning');
      const normalized: Project[] = (j.projects || []).map(normalizeProject);
      projectsCacheRef.current = { data: normalized, fetchedAt: Date.now() };
      const top = normalized.slice(0, limit);
      setProjects(prev => {
        const prevMap = new Map<string, Project>(prev.map(p => [p.id, p] as const));
        for (const p of top) prevMap.set(p.id, p);
        const seen = new Set<string>();
        const out: Project[] = [];
        for (const p of top) { if (!seen.has(p.id)) { out.push(p); seen.add(p.id); } }
        for (const p of prev) { if (!seen.has(p.id)) { out.push(prevMap.get(p.id)!); } }
        return out;
      });
      setSource(j.source || source);
    } catch (e: any) {
      console.warn('[projects] refresh failed', e?.message || e);
    } finally {
      setProjectsRefreshLoading(false);
    }
  }, [projectsRefreshLoading, source]);
  // Segments allow non-contiguous scheduling of same project
  const [scheduledSegments, setScheduledSegments] = useState<ScheduledSegment[]>([]);
  // Per project scheduling metadata (shared across its segments)
  const [scheduleMeta, setScheduleMeta] = useState<Record<string, ProjectScheduleMeta>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  // Presence (who is currently viewing)
  const [presenceUsers, setPresenceUsers] = useState<Array<{ id?: string | null; name?: string | null; joinedAt?: string; presence_ref?: string }>>([]);
  // Editing presence (other users editing fields for a project/segment)
  interface RemoteEditEntry { userId: string | null | undefined; userName: string | null | undefined; projectId: string; segmentId?: string; field: string; ts: number; }
  const [remoteEditing, setRemoteEditing] = useState<Record<string, RemoteEditEntry>>({});
  const localEditingKeysRef = useRef<Set<string>>(new Set());

  // Calendar / UI state
  const [monthOffset, setMonthOffset] = useState(0);
  // Week selection (ISO week key: YYYY-Www). Empty = all weeks
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Multi-truck filter (replaces previous single truckFilter). Values are truck names; special token 'UNASSIGNED' for items without a truck.
  const [truckFilters, setTruckFilters] = useState<string[]>([]);
  const [truckFilterOpen, setTruckFilterOpen] = useState(false);
  const truckFilterRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!truckFilterOpen) return;
      if (truckFilterRef.current && !truckFilterRef.current.contains(e.target as Node)) {
        setTruckFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [truckFilterOpen]);
  const toggleTruck = (val: string) => {
    setTruckFilters(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  };
  const allSelected = truckFilters.length === 0; // interpret empty as all
  const summaryLabel = allSelected ? 'Alla' : truckFilters.length === 1 ? (truckFilters[0] === 'UNASSIGNED' ? 'Ingen lastbil' : truckFilters[0]) : `${truckFilters.length} valda`;
  // Hover/expand UI state for truck cards
  const [hoveredTruck, setHoveredTruck] = useState<string | null>(null);
  const [expandedTrucks, setExpandedTrucks] = useState<Record<string, boolean>>({});
  // Collapsible Depåer section (entire section collapses)
  const [depotsCollapsed, setDepotsCollapsed] = useState<boolean>(true);
  // Collapsible deliveries section
  const [deliveriesCollapsed, setDeliveriesCollapsed] = useState<boolean>(true);
  const [salesFilter, setSalesFilter] = useState<string>('');
  const [salesDirectory, setSalesDirectory] = useState<string[]>([]); // all sales/admin names from profiles
  const [calendarSearch, setCalendarSearch] = useState('');
  const [jumpTargetDay, setJumpTargetDay] = useState<string | null>(null);
  const [matchIndex, setMatchIndex] = useState(-1);

  // Project lookup / backlog
  const [searchOrder, setSearchOrder] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recentSearchedIds, setRecentSearchedIds] = useState<string[]>([]);

  // Manual project form
  const [manualName, setManualName] = useState('');
  const [manualCustomer, setManualCustomer] = useState('');
  const [manualOrderNumber, setManualOrderNumber] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  // Dynamic trucks (DB backed). Fallback to legacy static list until table populated.
  interface TruckRec { id: string; name: string; color?: string | null; team_member1_name?: string | null; team_member2_name?: string | null; depot_id?: string | null; team1_id?: string | null; team2_id?: string | null; }
  const defaultTrucks = ['mb blå', 'mb vit', 'volvo blå'];
  const defaultTruckColors: Record<string, string> = {
    'mb blå': '#38bdf8',
    'mb vit': '#94a3b8',
    'volvo blå': '#6366f1'
  };
  const [planningTrucks, setPlanningTrucks] = useState<TruckRec[]>([]);
  // Derived list of truck names for existing logic (always alphabetical)
  const trucks = useMemo(() => {
    if (!planningTrucks.length) return defaultTrucks;
    return [...planningTrucks]
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
      .map(t => t.name);
  }, [planningTrucks]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [newTruckName, setNewTruckName] = useState('');
  const [newTruckDepotId, setNewTruckDepotId] = useState<string>('');
  const [isCreatingTruck, setIsCreatingTruck] = useState(false);
  const [truckCreateError, setTruckCreateError] = useState<string>('');
  const [openDepotMenuTruckId, setOpenDepotMenuTruckId] = useState<string | null>(null);
  // Per-card depot override popover removed; selection now happens in the Segment Editor modal
  const jobTypes = ['Ekovilla', 'Vitull', 'Leverans', 'Utsugning', 'Snickerier', 'Övrigt'];
  // Crew directory suggestions (profiles with tag "Entreprenad") for team name inputs
  const [crewList, setCrewList] = useState<Array<{ id: string; name: string }>>([]);
  const crewNames = useMemo(() => crewList.map(c => c.name), [crewList]);

  useEffect(() => {
    let cancelled = false;
    async function loadCrewByTag() {
      if (!isAdmin) return; // admin-only endpoint
      try {
        const res = await fetch('/api/profiles/by-tag?tag=' + encodeURIComponent('Entreprenad'));
        if (!res.ok) return;
        const j = await res.json();
        const items: Array<{ id: string; full_name?: string | null }> = Array.isArray(j.items) ? j.items : [];
        const list = items
          .map((it) => ({ id: it.id, name: (it.full_name ?? '').trim() }))
          .filter((it) => it.name.length > 0);
        if (!cancelled) setCrewList(list);
      } catch (_) { /* ignore */ }
    }
    loadCrewByTag();
    return () => { cancelled = true; };
  }, [isAdmin]);

  // Depåer (loading sites)
  interface DepotRec { id: string; name: string; material_total: number | null; material_ekovilla_total?: number | null; material_vitull_total?: number | null; }
  const [depots, setDepots] = useState<DepotRec[]>([]);
  const [newDepotName, setNewDepotName] = useState('');
  const [depotEdits, setDepotEdits] = useState<Record<string, { material_ekovilla_total?: string; material_vitull_total?: string }>>({});
  // New delivery (admin: planera leverans)
  const [newDelivery, setNewDelivery] = useState<{ depotId: string; materialKind: 'Ekovilla' | 'Vitull'; amount: string; date: string }>({ depotId: '', materialKind: 'Ekovilla', amount: '', date: '' });
  const [savingDelivery, setSavingDelivery] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [deliveries, setDeliveries] = useState<Array<{ id: string; depot_id: string; material_kind: 'Ekovilla' | 'Vitull'; amount: number; delivery_date: string; created_by: string | null; created_at: string }>>([]);
  const [editingDeliveries, setEditingDeliveries] = useState<Record<string, { depotId?: string; materialKind?: 'Ekovilla' | 'Vitull'; amount?: string; date?: string }>>({});

  // Truck name editing state
  const [editingTruckNames, setEditingTruckNames] = useState<Record<string, string>>({});
  const [truckNameStatus, setTruckNameStatus] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({});
  const [truckNameErrors, setTruckNameErrors] = useState<Record<string, string>>({});

  // Per-segment extra crew (for the day)
  const [segmentCrew, setSegmentCrew] = useState<Record<string, Array<{ id: string | null; name: string }>>>({});

  // Fallback selection scheduling (if drag/drop misbehaves)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  // View mode: standard month grid or weekday lanes (all Mondays in a row, etc.)
  const [viewMode, setViewMode] = useState<'monthGrid' | 'weekdayLanes' | 'dayList'>('monthGrid');
  // Calendar preference: hide weekends
  const [hideWeekends, setHideWeekends] = useState(false);
  // Inline card controls have been retired in favor of the Segment Editor modal
  // Collapsible left sidebar (search/manual add/backlog)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Segment Editor (modal) state
  type SegmentEditorMode = 'create' | 'edit';
  interface SegmentEditorDraft {
    mode: SegmentEditorMode;
    projectId: string;
    segmentId?: string;
    startDay: string; // YYYY-MM-DD
    endDay: string;   // YYYY-MM-DD
    truck: string | null;
    bagCount: number | null;
    jobType: string | null;
    depotId: string | null; // null => use truck depot
    positionIndex?: number | null; // 1-based position within same truck/day (create convenience)
    crew?: Array<{ id: string | null; name: string }>; // per-segment extra crew
  }
  const [segEditorOpen, setSegEditorOpen] = useState(false);
  const [segEditor, setSegEditor] = useState<SegmentEditorDraft | null>(null);
  // Keep modal mounted during exit animation
  const [segEditorPortal, setSegEditorPortal] = useState(false);
  useEffect(() => {
    if (segEditorOpen) {
      setSegEditorPortal(true);
    } else if (segEditorPortal) {
      const t = setTimeout(() => setSegEditorPortal(false), 240); // match CSS transition duration
      return () => clearTimeout(t);
    }
  }, [segEditorOpen, segEditorPortal]);
  // Delay clearing editor draft until animation done
  useEffect(() => {
    if (!segEditorOpen && segEditor) {
      const t = setTimeout(() => { if (!segEditorOpen) setSegEditor(null); }, 260);
      return () => clearTimeout(t);
    }
  }, [segEditorOpen, segEditor]);
  const closeSegEditor = useCallback(() => { setSegEditorOpen(false); }, []);
  // Inline, styled confirmation (replaces window.confirm) for destructive actions inside Segment Editor
  const [confirmDeleteSegmentId, setConfirmDeleteSegmentId] = useState<string | null>(null);
  useEffect(() => {
    // Reset confirmation when switching segment or closing modal
    if (!segEditorOpen) setConfirmDeleteSegmentId(null);
    else if (segEditor?.segmentId && segEditor.segmentId !== confirmDeleteSegmentId) setConfirmDeleteSegmentId(null);
  }, [segEditorOpen, segEditor?.segmentId]);
  useEffect(() => {
    try {
      const v = localStorage.getItem('planner.sidebarCollapsed');
      if (v === '1') setSidebarCollapsed(true);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('planner.sidebarCollapsed', sidebarCollapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [sidebarCollapsed]);
  // Load/persist weekend visibility preference
  useEffect(() => {
    try {
      const v = localStorage.getItem('planner.hideWeekends');
      if (v === '1') setHideWeekends(true);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('planner.hideWeekends', hideWeekends ? '1' : '0'); } catch { /* ignore */ }
  }, [hideWeekends]);
  // UI hover state for backlog punch effect
  const [hoverBacklogId, setHoverBacklogId] = useState<string | null>(null);
  // Hover state for scheduled segment cards (used to show edit hint on hover)
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);
  // Floating next-month shortcut visibility (IntersectionObserver sentinel driven)
  const [showNextMonthShortcut, setShowNextMonthShortcut] = useState(false);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = bottomSentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver((entries) => {
      const entry = entries[0];
      // Show button only when sentinel fully (or mostly) in view
      setShowNextMonthShortcut(entry.isIntersecting && entry.intersectionRatio >= 0.6);
    }, { root: null, threshold: [0, 0.25, 0.5, 0.6, 0.75, 1], rootMargin: '0px 0px 400px 0px' });
    obs.observe(el);
    return () => { obs.disconnect(); };
  }, []);
  // Anchor ref for top of calendar area
  const calendarTopRef = useRef<HTMLDivElement | null>(null);
  const [pendingScrollToTop, setPendingScrollToTop] = useState(false);
  const jumpToNextMonth = useCallback(() => {
    setMonthOffset(o => o + 1);
    setPendingScrollToTop(true); // defer actual scrolling until after re-render/layout
  }, []);
  useEffect(() => {
    if (pendingScrollToTop) {
      // Use two RAFs to allow layout to settle if month content height changes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            const el = calendarTopRef.current;
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          } catch { /* ignore */ }
          setPendingScrollToTop(false);
        });
      });
    }
  }, [pendingScrollToTop, monthOffset]);

  // Segment reports (partial reporting before EK)
  const [segmentReports, setSegmentReports] = useState<SegmentReport[]>([]);
  // Simple draft used in Segment Editor to add a report
  const [reportDraft, setReportDraft] = useState<{ day: string; amount: string }>({ day: '', amount: '' });
  // Segment Editor crew input (name text)
  const [segCrewInput, setSegCrewInput] = useState<string>('');

  // Missing state (reintroduced after earlier cleanup)
  const [truckColorOverrides, setTruckColorOverrides] = useState<Record<string, string>>({});
  const [editingTeamNames, setEditingTeamNames] = useState<Record<string, { team1: string; team2: string; team1Id?: string | null; team2Id?: string | null }>>({});
  const [truckSaveStatus, setTruckSaveStatus] = useState<Record<string, { status: 'idle' | 'saving' | 'saved' | 'error'; ts: number }>>({});

  // Admin config modal (to declutter main page)
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminModalTab, setAdminModalTab] = useState<'trucks' | 'depots' | 'deliveries' | 'jobtypes'>('trucks');
  // Hide inline admin panels on main page (creation and depot totals) – manage via modal instead
  const showInlineAdminPanels = false;

  // Accent color generator for backlog cards (deterministic palette)
  function backlogAccent(p: Project) {
    if (p.isManual) return '#334155';
    const seed = p.name || p.id;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    const palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
    return palette[Math.abs(hash) % palette.length];
  }
  // Egenkontroll state (quality reports)
  const [egenkontrollOrderNumbers, setEgenkontrollOrderNumbers] = useState<Set<string>>(new Set());
  const [egenkontrollPaths, setEgenkontrollPaths] = useState<Record<string, string>>({});
  const [egenkontrollLoading, setEgenkontrollLoading] = useState<boolean>(false);
  const [egenkontrollError, setEgenkontrollError] = useState<string | null>(null);
  function hasEgenkontroll(orderNumber?: string | null) {
    if (!orderNumber) return false;
    const norm = orderNumber.replace(/^0+/, '') || orderNumber;
    return egenkontrollOrderNumbers.has(orderNumber) || egenkontrollOrderNumbers.has(norm);
  }
  function egenkontrollPath(orderNumber?: string | null) {
    if (!orderNumber) return null;
    const norm = orderNumber.replace(/^0+/, '') || orderNumber;
    return egenkontrollPaths[norm] || egenkontrollPaths[orderNumber] || null;
  }

  // Derived: remaining bags per project (plan minus reported so far)
  const remainingBagsByProject = useMemo(() => {
    const map = new Map<string, number>();
    const partialSum: Record<string, number> = {};
    for (const r of segmentReports) {
      const seg = scheduledSegments.find(s => s.id === r.segmentId);
      const pid = r.projectId || seg?.projectId || null;
      if (!pid) continue;
      partialSum[pid] = (partialSum[pid] || 0) + (Number(r.amount) || 0);
    }
    for (const [pid, meta] of Object.entries(scheduleMeta)) {
      const plan = Number(meta.bagCount) || 0;
      if (plan <= 0) continue;
      const proj = projects.find(p => p.id === pid);
      const order = proj?.orderNumber || null;
      const ekDone = order ? hasEgenkontroll(order) : false;
      const usedFromMeta = Number(meta.actual_bags_used) || 0;
      const usedPartial = partialSum[pid] || 0;
      const used = ekDone ? usedFromMeta : usedPartial;
      map.set(pid, Math.max(0, plan - used));
    }
    return map;
  }, [segmentReports, scheduleMeta, projects, hasEgenkontroll, scheduledSegments]);
  // Bag usage status (plan, used, remaining, overrun)
  type BagUsageStatus = { plan: number; used: number; remaining: number; overrun: number };
  const bagUsageStatusByProject = useMemo(() => {
    const status = new Map<string, BagUsageStatus>();
    const partialSum: Record<string, number> = {};
    for (const r of segmentReports) {
      const seg = scheduledSegments.find(s => s.id === r.segmentId);
      const pid = r.projectId || seg?.projectId || null;
      if (!pid) continue;
      partialSum[pid] = (partialSum[pid] || 0) + (Number(r.amount) || 0);
    }
    for (const [pid, meta] of Object.entries(scheduleMeta)) {
      const plan = Number(meta.bagCount) || 0;
      if (plan <= 0) continue;
      const proj = projects.find(p => p.id === pid);
      const order = proj?.orderNumber || null;
      const ekDone = order ? hasEgenkontroll(order) : false;
      const usedMeta = Number(meta.actual_bags_used) || 0;
      const usedPartial = partialSum[pid] || 0;
      const used = ekDone ? usedMeta : usedPartial;
      const remaining = Math.max(0, plan - used);
      const overrun = used > plan ? (used - plan) : 0;
      status.set(pid, { plan, used, remaining, overrun });
    }
    return status;
  }, [segmentReports, scheduleMeta, projects, hasEgenkontroll, scheduledSegments]);

  async function searchByOrderNumber(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const val = searchOrder.trim();
    if (!val) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/blikk/projects?orderNumber=${encodeURIComponent(val)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Fel vid sökning');
      const normalized: Project[] = (j.projects || []).map(normalizeProject);
      if (!normalized.length) {
        setSearchError('Inget projekt hittades');
      } else {
        setProjects(prev => {
          const ids = new Set(normalized.map(p => p.id));
          const rest = prev.filter(p => !ids.has(p.id));
          return [...normalized, ...rest];
        });
        setRecentSearchedIds(prev => {
          const merged = [...normalized.map(p => p.id), ...prev.filter(id => !normalized.some(n => n.id === id))];
          return merged.slice(0, 5);
        });
        setSource(j.source || source);
      }
    } catch (err: any) {
      setSearchError(String(err.message || err));
    } finally {
      setSearchLoading(false);
    }
  }

  function addManualProject(e: React.FormEvent) {
    e.preventDefault();
    setManualError(null);
    const name = manualName.trim();
    const customer = manualCustomer.trim();
    if (!name) return setManualError('Namn krävs');
    if (!customer) return setManualError('Kund krävs');
    const id = 'manual-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const proj: Project = {
      id,
      name,
      customer,
      orderNumber: manualOrderNumber.trim() || null,
      createdAt: new Date().toISOString(),
      status: 'MANUELL',
      isManual: true,
      customerId: null,
      customerEmail: null,
      salesResponsible: null
    };
    setProjects(prev => [proj, ...prev]);
    setManualName('');
    setManualCustomer('');
    setManualOrderNumber('');
  }

  // Load & parse existing egenkontroll PDF files from storage and map to order numbers
  // Stable identity so effects depending on it do not re-run every render
  const refreshEgenkontroller = useCallback(async () => {
    // Prevent overlapping loads
    if (egenkontrollLoading) return;
    setEgenkontrollLoading(true);
    setEgenkontrollError(null);
    try {
      const res = await fetch('/api/storage/list-all?prefix=Egenkontroller');
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Kunde inte hämta egenkontroller');
      const files: Array<{ path: string; name: string }> = j.files || [];
      const orderSet = new Set<string>();
      const paths: Record<string, string> = {};
      for (const f of files) {
        const name = f.name || '';
        if (!/\.pdf$/i.test(name)) continue;
        // Expected patterns (flexible):
        //  Egenkontroll_<kund>_<ordernr>.pdf
        //  Egenkontroll_<ordernr>.pdf
        //  Egenkontroll-<kund>-<ordernr>.pdf (fallback)
        // Extract last numeric token (>= 2 digits) before .pdf
        const base = name.replace(/\.pdf$/i, '');
        // Split on underscores & dashes to be tolerant
        const parts = base.split(/[_-]+/);
        let candidate = '';
        for (let i = parts.length - 1; i >= 0; i--) {
          const digits = parts[i].replace(/[^0-9]/g, '');
          if (digits.length >= 2) { candidate = digits; break; }
        }
        if (!candidate) continue;
        const norm = candidate.replace(/^0+/, '') || candidate; // preserve both with & without leading zeros
        const fullPath = f.path || `${'Egenkontroller'}/${name}`;
        orderSet.add(candidate);
        orderSet.add(norm);
        paths[candidate] = fullPath;
        paths[norm] = fullPath;
      }
      setEgenkontrollOrderNumbers(orderSet);
      setEgenkontrollPaths(paths);
    } catch (e: any) {
      setEgenkontrollError(String(e?.message || e));
      console.warn('[egenkontroll] refresh error', e);
    } finally {
      setEgenkontrollLoading(false);
    }
  }, [egenkontrollLoading]);

  // Initial fetch
  useEffect(() => {
    (async () => {
      try {
        setError(null);
        const res = await fetch('/api/blikk/projects');
        const j = await res.json();
        if (!res.ok) setError(j.error || 'Fel vid hämtning');
        const normalized: Project[] = (j.projects || []).map(normalizeProject);
        // Optional debug: count how many missing customerId
        try {
          const dbg = localStorage.getItem('contactFetchDebug') === '1' || (window as any).__contactFetchDebug;
          if (dbg) {
            const missing = normalized.filter(p => !p.customerId);
            if (missing.length) {
              console.debug('[projects][normalize] missing customerId count', missing.length, missing.map(m => ({ id: m.id, name: m.name, customer: m.customer })));
            }
          }
        } catch { /* ignore */ }
        // Merge with any projects already injected from segments to avoid overwriting
        setProjects(prev => {
          if (prev.length === 0) return normalized; // fast path
          const map = new Map<string, Project>();
          for (const p of prev) map.set(p.id, p);
          for (const p of normalized) map.set(p.id, p); // API data wins for overlapping ids
          return Array.from(map.values());
        });
        setSource(j.source || null);
      } catch (e: any) {
        setError(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    })();
    // Also load existing egenkontroll list
    refreshEgenkontroller();
  }, []);

  // Load persisted schedule + meta
  const supabase = createClientComponentClient();
  const [syncing, setSyncing] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const pendingOps = useRef<Promise<any>[]>([]);
  const createdIdsRef = useRef<Set<string>>(new Set());
  // Simple async op queue helper (re-add after accidental removal). Ensures we can await / flush later if needed.
  function enqueue<T>(p: PromiseLike<T>) {
    try {
      const wrapped = Promise.resolve(p).catch(err => { console.warn('[enqueue] op error', err); throw err; });
      pendingOps.current.push(wrapped);
      if (pendingOps.current.length > 200) {
        // Best effort: drop settled promises
        pendingOps.current = pendingOps.current.filter(pr => typeof (pr as any).status === 'undefined');
      }
    } catch (e) {
      console.warn('[enqueue] failed to enqueue', e);
    }
    return p;
  }

  // On-demand client email fetch: status map per project
  const [emailFetchStatus, setEmailFetchStatus] = useState<Record<string, 'idle' | 'loading' | 'error'>>({});
  const [emailToast, setEmailToast] = useState<{ pid: string; msg: string } | null>(null);
  // Client notification tracking (local only for now)
  const [pendingNotifyProjectId, setPendingNotifyProjectId] = useState<string | null>(null);
  // Job type/material color mapping (from admin settings)
  const [jobTypeColors, setJobTypeColors] = useState<Record<string, string>>({});
  function markClientNotified(pid: string) {
    const actor = currentUserName || currentUserId || 'okänd';
    const ts = new Date().toISOString();
    // optimistic update
    setScheduleMeta(prev => ({ ...prev, [pid]: { ...(prev[pid] || { projectId: pid }), client_notified: true, client_notified_at: ts, client_notified_by: actor } }));
    enqueue(supabase.from('planning_project_meta').upsert({
      project_id: pid,
      client_notified: true,
      client_notified_at: ts,
      client_notified_by: actor
    }).then(({ error }) => { if (error) console.warn('[notify] upsert error', error); }));
  }
  function undoClientNotified(pid: string) {
    setScheduleMeta(prev => ({ ...prev, [pid]: { ...(prev[pid] || { projectId: pid }), client_notified: false, client_notified_at: null, client_notified_by: null } }));
    enqueue(supabase.from('planning_project_meta').upsert({
      project_id: pid,
      client_notified: false,
      client_notified_at: null,
      client_notified_by: null
    }).then(({ error }) => { if (error) console.warn('[notify] undo error', error); }));
  }

  // Load and subscribe to job type/material colors
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('planning_job_type_colors')
          .select('job_type,color_hex');
        if (error) throw error;
        if (!cancelled) {
          const map: Record<string, string> = {};
          for (const r of (data || []) as any[]) map[r.job_type] = r.color_hex;
          setJobTypeColors(map);
        }
      } catch (e) {
        // non-fatal
        console.warn('[jobTypeColors] load error', e);
      }
    })();
    const ch = supabase
      .channel('rtc_job_type_colors')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_job_type_colors' }, (payload) => {
        setJobTypeColors(prev => {
          const next = { ...prev };
          const row: any = payload.new || payload.old;
          if (!row?.job_type) return next;
          if (payload.eventType === 'DELETE') {
            delete next[row.job_type];
          } else if (payload.new) {
            next[row.job_type] = row.color_hex;
          }
          return next;
        });
      })
      .subscribe();
    return () => { ch.unsubscribe(); cancelled = true; };
  }, [supabase]);

  // On-demand helpers for email fetching
  const ensureCustomerIdForProject = useCallback(async (projectId: string): Promise<number | null> => {
    const proj = projects.find(p => p.id === projectId);
    if (!proj) return null;
    if (proj.customerId != null) return proj.customerId as number;
    try {
      const r = await fetch(`/api/blikk/projects/${projectId}`);
      if (!r.ok) return null;
      const pj = await r.json();
      if (pj?.customerId != null) {
        const cid = Number(pj.customerId);
        setProjects(prev => prev.map(p => p.id === projectId ? { ...p, customerId: cid } : p));
        return cid;
      }
    } catch { /* ignore */ }
    return null;
  }, [projects]);

  const fetchContactEmailByCustomerId = useCallback(async (customerId: number): Promise<string | null> => {
    // Cache + single-flight
    const now = Date.now();
    const cached = contactEmailCacheRef.current.get(customerId);
    if (cached && (now - cached.fetchedAt) < CONTACT_CACHE_TTL) return cached.email;
    const inFlight = contactEmailInFlightRef.current.get(customerId);
    if (inFlight) return inFlight;
    const p = (async () => {
      let attempt = 0;
      while (attempt < 3) {
        attempt++;
        const res = await fetch(`/api/blikk/contacts/${customerId}`);
        if (res.status === 404) {
          contactEmailCacheRef.current.set(customerId, { email: null, fetchedAt: Date.now() });
          return null;
        }
        if (res.status === 429) {
          let waitMs = 1000;
          try {
            const body = await res.json().catch(() => ({}));
            if (typeof body?.waitInSeconds === 'number') waitMs = Math.min(body.waitInSeconds, 5) * 1000;
            else {
              const ra = Number(res.headers.get('Retry-After'));
              if (Number.isFinite(ra)) waitMs = Math.max(ra, 1) * 1000;
            }
          } catch { /* ignore */ }
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        if (!res.ok) {
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 200 * attempt));
            continue;
          }
          contactEmailCacheRef.current.set(customerId, { email: null, fetchedAt: Date.now() });
          return null;
        }
        const j = await res.json();
        const email = j?.contact?.email || j?.contact?.emailCandidates?.[0] || null;
        contactEmailCacheRef.current.set(customerId, { email, fetchedAt: Date.now() });
        return email || null;
      }
      contactEmailCacheRef.current.set(customerId, { email: null, fetchedAt: Date.now() });
      return null;
    })();
    contactEmailInFlightRef.current.set(customerId, p);
    try {
      const result = await p;
      return result;
    } finally {
      contactEmailInFlightRef.current.delete(customerId);
    }
  }, []);

  const openMailForSegment = useCallback((it: any, email: string) => {
    // Resolve segment + date span (allow explicit overrides from callers like the editor modal)
    const seg = scheduledSegments.find(s => s.id === it.segmentId);
    const startDay = it.startDay || (seg?.startDay) || it.day;
    const endDay = it.endDay || (seg?.endDay) || it.day;
    const single = startDay === endDay;
    const dateText = single ? startDay : `${startDay} – ${endDay}`;

    // Resolve truck for messaging: prefer the card's truck, else project meta's truck
    const metaTruck = scheduleMeta[it.project.id]?.truck || null;
    const effectiveTruck: string | null = (it.truck ?? metaTruck) || null;

    // Determine reference day to compute order-in-day (use the clicked card's day, else startDay)
    const refDay = it.day || startDay;

    // Compute position within same-truck jobs for that day, following the same sort logic as UI
    let orderInDay: number | null = null;
    let totalInDay = 0;
    if (refDay) {
      const sameDaySegs = scheduledSegments.filter(s => s.startDay <= refDay && s.endDay >= refDay);
      const sameTruckItems = sameDaySegs
        .map(s => {
          const p = projects.find(pp => pp.id === s.projectId);
          const t = scheduleMeta[s.projectId]?.truck || null;
          return p ? { segmentId: s.id, project: p, truck: t, sortIndex: s.sortIndex ?? null } : null;
        })
        .filter((x): x is { segmentId: string; project: any; truck: string | null; sortIndex: number | null } => !!x)
        .filter(x => (x.truck || null) === (effectiveTruck || null));
      const sorted = sameTruckItems.sort((a, b) => {
        const sa = a.sortIndex;
        const sb = b.sortIndex;
        if (sa != null && sb != null && sa !== sb) return sa - sb;
        if (sa != null && sb == null) return -1;
        if (sb != null && sa == null) return 1;
        const ao = a.project.orderNumber || '';
        const bo = b.project.orderNumber || '';
        if (ao && bo && ao !== bo) return ao.localeCompare(bo, 'sv');
        return a.project.name.localeCompare(b.project.name, 'sv');
      });
      totalInDay = sorted.length;
      const idx = sorted.findIndex(x => x.segmentId === it.segmentId);
      orderInDay = idx >= 0 ? idx + 1 : null;
    }

    const subject = encodeURIComponent(`Planerad isolering ${dateText} (${it.project.name}) Ordernummer #${it.project.orderNumber}`);
    const orderLine = (orderInDay && totalInDay)
      ? `du är planerad som Nr: ${orderInDay} av ${totalInDay} på lastbilen "${effectiveTruck || 'Ej tilldelad'}". Installatören kommer ringa dig på morgon vid installations tillfälle och meddela ungefärlig ankomst tid.`
      : `Lastbil: ${effectiveTruck || 'Ej tilldelad'}`;
    const bodyLines = [
      'ORDERBEKRÄFTELSE',
      '',

      'Hej,',
      '',
      'Vi vill informera att arbetet är planerat:',
      `Projekt: ${it.project.name}`,
      `Datum: ${dateText}`,
      `Ordernummer: ${it.project.orderNumber}`,
      orderLine,
      '',
      'Återkom gärna om något behöver justeras.',
      '',
      'Vänligen',
      '',
      (it.project.salesResponsible ? it.project.salesResponsible : 'Ekovilla')
    ].join('\n');
    const href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${encodeURIComponent(bodyLines)}`;
    if (typeof window !== 'undefined') window.location.href = href;
    setTimeout(() => setPendingNotifyProjectId(it.project.id), 200);
  }, [scheduledSegments, scheduleMeta, projects]);

  const handleEmailClick = useCallback(async (it: any) => {
    const pid = it.project.id as string;
    const current = projects.find(p => p.id === pid);
    if (!current) return;
    if (emailFetchStatus[pid] === 'loading') return; // de-dup
    if (current.customerEmail) { openMailForSegment(it, current.customerEmail); return; }
    setEmailFetchStatus(prev => ({ ...prev, [pid]: 'loading' }));
    setEmailToast({ pid, msg: 'Förbereder mail…' });
    try {
      const cid = await ensureCustomerIdForProject(pid);
      if (!cid) { alert('Kunde inte hitta kund-id för detta projekt.'); setEmailFetchStatus(prev => ({ ...prev, [pid]: 'error' })); setEmailToast(null); return; }
      const email = await fetchContactEmailByCustomerId(cid);
      if (!email) { alert('Ingen e‑postadress hittades för kunden.'); setEmailFetchStatus(prev => ({ ...prev, [pid]: 'error' })); setEmailToast(null); return; }
      setProjects(prev => prev.map(p => p.id === pid ? { ...p, customerEmail: email } : p));
      openMailForSegment(it, email);
      setEmailFetchStatus(prev => ({ ...prev, [pid]: 'idle' }));
      setEmailToast(null);
    } catch {
      setEmailFetchStatus(prev => ({ ...prev, [pid]: 'error' }));
      setEmailToast(null);
    }
  }, [projects, emailFetchStatus, ensureCustomerIdForProject, fetchContactEmailByCustomerId, openMailForSegment]);

  // Project detail modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, any>>({});
  // Shared comments hook for detail modal
  const { comments: detailComments, loading: detailCommentsLoading, error: detailCommentsError, refresh: refreshDetailComments } = useProjectComments(detailProjectId, { ttlMs: 120_000 });
  // Lightweight cache of project address lines for card display (DB-sourced only)
  const [projectAddresses, setProjectAddresses] = useState<Record<string, string>>({});
  const openProjectModal = useCallback(async (projectId: string) => {
    setDetailOpen(true);
  setDetailProjectId(projectId);
    setDetailError(null);
    const base = projects.find(p => p.id === projectId);
  // Abort previous in-flight modal lookup & trigger comment refresh
    const ctrl = new AbortController();
    const prevCtrl = (openProjectModal as any)._ctrl as AbortController | undefined;
    if (prevCtrl) { try { prevCtrl.abort(); } catch {} }
  (openProjectModal as any)._ctrl = ctrl;
  // Prefetch not needed — hook auto-fetches when `detailProjectId` changes
    const fetchViaLookup = async (): Promise<any | null> => {
      const keyOrder = base?.orderNumber ? `order:${base.orderNumber}` : null;
      const keyId = (() => { const idNum = Number(projectId); return Number.isFinite(idNum) && idNum > 0 ? `id:${idNum}` : null; })();
      const now = Date.now();
      const tryFetch = async (url: string, cacheKey: string) => {
        const cached = lookupCacheRef.current.get(cacheKey);
        if (cached && (now - cached.fetchedAt) < LOOKUP_CACHE_TTL) return cached.data;
        let single = lookupInFlightRef.current.get(cacheKey);
        if (!single) {
          single = fetch(url, { signal: ctrl.signal })
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
            .then(data => { lookupCacheRef.current.set(cacheKey, { data, fetchedAt: Date.now() }); return data; })
            .catch(err => { if (err?.name === 'AbortError') return null; return null; });
          lookupInFlightRef.current.set(cacheKey, single);
        }
        const data = await single;
        lookupInFlightRef.current.delete(cacheKey);
        return data;
      };
      try {
        if (keyOrder) {
          const data = await tryFetch(`/api/projects/lookup?orderId=${encodeURIComponent(base!.orderNumber!)}`, keyOrder);
          if (data) return { source: 'lookup:order', project: data };
        }
        if (keyId) {
          const data = await tryFetch(`/api/projects/lookup?id=${encodeURIComponent(projectId)}`, keyId);
          if (data) return { source: 'lookup:id', project: data };
        }
      } catch { /* ignore */ }
      return null;
    };

    const cache = detailCache[projectId];
    if (cache) {
      const hasAddress = !!(cache?.project?.address || cache?.project?.street || cache?.project?.city);
      const hasDesc = !!cache?.project?.description;
      const hasSeller = !!cache?.project?.salesResponsible || !!base?.salesResponsible;
      if (!(hasAddress && hasDesc && hasSeller)) {
        setDetailLoading(true);
        try {
          const enriched = await fetchViaLookup();
          if (enriched) setDetailCache(prev => ({ ...prev, [projectId]: enriched }));
        } finally { setDetailLoading(false); }
      }
      return;
    }

    setDetailLoading(true);
    try {
      const j = await fetchViaLookup();
      if (!j) throw new Error('Kunde inte hämta projektdetaljer');
      setDetailCache(prev => ({ ...prev, [projectId]: j }));
      // Prefetch comments (non-blocking)
  // Comments handled by shared hook; optional force refresh already triggered above.
    } catch (e: any) {
      setDetailError(String(e?.message || e));
    } finally {
      setDetailLoading(false);
    }
  }, [detailCache, projects]);
  const closeProjectModal = useCallback(() => { setDetailOpen(false); setDetailProjectId(null); setDetailError(null); }, []);

  // No lazy fallback: rely only on DB-provided address fields loaded into projectAddresses

  // Global overlay readiness: wait until core data ready (or timeout)
  const [gateReleased, setGateReleased] = useState(false);
  const globalReady = (!loading && !syncing && !egenkontrollLoading) || gateReleased;
  useEffect(() => {
    if (globalReady) return;
    const t = setTimeout(() => setGateReleased(true), 20000); // safety timeout after 20s
    return () => clearTimeout(t);
  }, [globalReady]);

  const overlayDetails = useMemo(() => {
    const steps: Array<{ label: string; state: 'pending' | 'done' | 'running'; note?: string }> = [];
    steps.push({ label: 'Projekt', state: loading ? 'pending' : 'done' });
    steps.push({ label: 'Planering', state: syncing ? 'running' : 'done' });
    steps.push({ label: 'Egenkontroll', state: egenkontrollLoading ? 'pending' : 'done' });
    return steps;
  }, [loading, syncing, egenkontrollLoading]);

  // Realtime + periodic refresh for egenkontroll report detection
  useEffect(() => {
    const bucket = (process.env.NEXT_PUBLIC_SUPABASE_BUCKET || process.env.SUPABASE_BUCKET || 'pdfs');
    const channel = supabase.channel('egenkontroll-watch')
      .on('postgres_changes', { event: 'INSERT', schema: 'storage', table: 'objects' }, payload => {
        try {
          const row: any = payload.new;
          if (!row) return;
          if (row.bucket_id !== bucket) return;
          const fullName: string = row.name || '';
          if (!fullName.startsWith('Egenkontroller/')) return;
          const base = fullName.split('/').pop()?.toLowerCase() || '';
          const matches = base.match(/\d{3,10}/g) || [];
          if (matches.length === 0) return;
          setEgenkontrollOrderNumbers(prev => {
            const next = new Set(prev);
            for (const m of matches) {
              const norm = m.replace(/^0+/, '') || m;
              next.add(norm);
            }
            return next;
          });
          // Store a representative path for each matched order number if not already present
          setEgenkontrollPaths(prev => {
            const out = { ...prev };
            for (const m of matches) {
              const norm = m.replace(/^0+/, '') || m;
              if (!out[norm]) out[norm] = fullName; // keep first seen; full refresh later may choose a newer one
            }
            return out;
          });
        } catch (e) {
          console.warn('[egenkontroll realtime parse error]', e);
        }
      })
      .subscribe();
    const interval = setInterval(() => { refreshEgenkontroller(); }, 5 * 60 * 1000);
    return () => { clearInterval(interval); supabase.removeChannel(channel); };
  }, [supabase, refreshEgenkontroller]);

  useEffect(() => {
    (async () => {
      try {
        setSyncing(true);
        // Load user first (client-side auth context)
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setCurrentUserId(user.id);
          // Try profile table for display name
          let resolvedName: string | null = null;
          const { data: profile } = await supabase.from('profiles').select('full_name, role').eq('id', user.id).maybeSingle();
          if (profile) {
            if ((profile as any).full_name) {
              resolvedName = (profile as any).full_name as string;
            }
            if ((profile as any).role === 'admin') setIsAdmin(true);
          }
          if (!resolvedName) {
            const meta: any = user.user_metadata || {};
            resolvedName = meta.full_name || meta.name || null;
          }
          if (!resolvedName && user.email) {
            resolvedName = user.email.split('@')[0];
          }
          if (resolvedName) setCurrentUserName(resolvedName);
        }
        const { data: segs, error: segErr } = await supabase.from('planning_segments').select('*');
        if (segErr) throw segErr;
        const { data: metas, error: metaErr } = await supabase.from('planning_project_meta').select('*');
        if (metaErr) throw metaErr;
        // Load segment reports (partial bag reports)
        try {
          const { data: repRows, error: repErr } = await supabase.from('planning_segment_reports').select('*');
          if (repErr) console.warn('[planning] segment reports load error', repErr);
          else if (Array.isArray(repRows)) {
            setSegmentReports(repRows.map((r: any) => ({ id: r.id, segmentId: r.segment_id, reportDay: r.report_day, amount: r.amount, createdBy: r.created_by ?? null, createdByName: r.created_by_name ?? null, createdAt: r.created_at || null, projectId: (r as any).project_id ?? null })));
          }
        } catch (e) {
          console.warn('[planning] segment reports load exception', e);
        }
        // Load per-segment crew assignments
        try {
          const { data: crewRows, error: crewErr } = await supabase.from('planning_segment_team_members').select('*');
          if (crewErr) console.warn('[planning] segment crew load error', crewErr);
          else if (Array.isArray(crewRows)) {
            const map: Record<string, Array<{ id: string | null; name: string }>> = {};
            for (const row of crewRows) {
              const sid = (row as any).segment_id as string;
              if (!map[sid]) map[sid] = [];
              map[sid].push({ id: (row as any).member_id || null, name: (row as any).member_name || '' });
            }
            setSegmentCrew(map);
          }
        } catch (e) {
          console.warn('[planning] segment crew load exception', e);
        }
        // Load dynamic trucks (open select) - team names are free text
        try {
          const { data: trucksData, error: trucksErr } = await supabase.from('planning_trucks').select('*').order('name');
          if (trucksErr) console.warn('[planning] trucks load error', trucksErr);
          else if (Array.isArray(trucksData)) {
            setPlanningTrucks(trucksData.map(t => ({ id: t.id, name: t.name, color: t.color, team_member1_name: t.team_member1_name, team_member2_name: t.team_member2_name, depot_id: (t as any).depot_id || null, team1_id: (t as any).team1_id || null, team2_id: (t as any).team2_id || null })));
            setTruckColorOverrides(prev => {
              const c = { ...prev };
              for (const t of trucksData) if (t.color) c[t.name] = t.color;
              return c;
            });
          }
        } catch (e) { console.warn('[planning] could not load trucks', e); }

        // Load depåer (loading sites)
        try {
          const { data: depRows, error: depErr } = await supabase.from('planning_depots').select('*').order('name');
          if (depErr) console.warn('[planning] depots load error', depErr);
          else if (Array.isArray(depRows)) setDepots(depRows as any);
        } catch (e) {
          console.warn('[planning] depots load exception', e);
        }
        // Load planned deliveries
        try {
          const { data: delRows, error: delErr } = await supabase.from('planning_depot_deliveries').select('*').order('delivery_date');
          if (delErr) console.warn('[planning] deliveries load error', delErr);
          else if (Array.isArray(delRows)) setDeliveries(delRows as any);
        } catch (e) {
          console.warn('[planning] deliveries load exception', e);
        }
        // Normalize into local shapes
        if (Array.isArray(segs)) {
          setScheduledSegments(segs.map(s => ({ id: s.id, projectId: s.project_id, startDay: s.start_day, endDay: s.end_day, createdBy: s.created_by, createdByName: s.created_by_name, depotId: (s as any).depot_id ?? null, sortIndex: (s as any).sort_index ?? null, truck: (s as any).truck ?? null })));
          // Inject projects from segments if not already present
          setProjects(prev => {
            const map = new Map(prev.map(p => [p.id, p]));
            for (const s of segs) {
              if (!map.has(s.project_id)) {
                map.set(s.project_id, {
                  id: s.project_id,
                  name: s.project_name,
                  customer: s.customer || '',
                  orderNumber: s.order_number || null,
                  createdAt: s.created_at || new Date().toISOString(),
                  status: s.is_manual ? 'MANUELL' : 'PLAN',
                  isManual: s.is_manual,
                  customerId: s.customer_id ?? null,
                  customerEmail: s.customer_email ?? null,
                  salesResponsible: s.sales_responsible ?? null
                });
              }
            }
            return Array.from(map.values());
          });
        }
        if (Array.isArray(metas)) {
          const metaObj: any = {};
          for (const m of metas) metaObj[m.project_id] = {
            projectId: m.project_id,
            truck: m.truck,
            bagCount: m.bag_count,
            jobType: m.job_type,
            color: m.color,
            client_notified: m.client_notified,
            client_notified_at: m.client_notified_at,
            client_notified_by: m.client_notified_by,
            actual_bags_used: m.actual_bags_used,
            actual_bags_set_at: m.actual_bags_set_at,
            actual_bags_set_by: m.actual_bags_set_by,
          };
          setScheduleMeta(metaObj);
          // Prefill address cache from stored meta if available
          try {
            const addrMap: Record<string, string> = {};
            for (const m of metas) {
              const street = (m as any).address_street as string | null | undefined;
              const postal = (m as any).address_postal as string | null | undefined;
              const city = (m as any).address_city as string | null | undefined;
              const parts = [street, city].filter(Boolean) as string[];
              // If postal is available, include it between street and city if street exists
              if (street && city && postal) {
                addrMap[m.project_id] = `${street}, ${city}`; // keep concise; we can add postal if desired
              } else if (parts.length) {
                addrMap[m.project_id] = parts.join(', ');
              }
            }
            if (Object.keys(addrMap).length) setProjectAddresses(prev => ({ ...addrMap, ...prev }));
          } catch { /* ignore */ }
        }
        // Fetch complete sales/admin directory via internal API (service role backed)
        try {
          const dirRes = await fetch('/api/planning/sales-directory');
          if (dirRes.ok) {
            const j = await dirRes.json();
            const names: string[] = Array.isArray(j.users) ? j.users.map((u: any) => u.name).filter((v: any): v is string => typeof v === 'string' && v.trim().length > 0) : [];
            const trimmed = names.map(n => n.trim());
            const unique: string[] = Array.from(new Set(trimmed)).filter(n => n.length > 0).sort((a, b) => a.localeCompare(b));
            setSalesDirectory(unique);
          } else {
            console.warn('[planning] directory fetch failed status', dirRes.status);
          }
        } catch (e) {
          console.warn('[planning] could not load sales directory', e);
        }
      } catch (e) {
        console.warn('[planning] initial load failed', e);
      } finally { setSyncing(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset report draft when switching segment in editor
  useEffect(() => {
    if (segEditor?.segmentId) {
      setReportDraft({ day: segEditor.startDay, amount: '' });
    } else {
      setReportDraft({ day: '', amount: '' });
    }
  }, [segEditor?.segmentId, segEditor?.startDay]);

  // Realtime subscription + presence tracking (recreate when auth identity changes so presence key updates)
  useEffect(() => {
    const presenceKey = currentUserId || 'anon-' + Math.random().toString(36).slice(2, 8);
    const channel = supabase.channel('planning-sync', { config: { presence: { key: presenceKey } } })
      // Presence events
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const users: any[] = [];
        for (const key of Object.keys(state)) {
          const entries = (state as any)[key];
          for (const entry of entries) users.push(entry);
        }
        setPresenceUsers(users);
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        setPresenceUsers(prev => {
          const map = new Map<string, any>();
          for (const p of prev) map.set(p.presence_ref || p.id || Math.random().toString(36), p);
          for (const np of newPresences) map.set(np.presence_ref || np.id || Math.random().toString(36), np);
          return Array.from(map.values());
        });
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        setPresenceUsers(prev => prev.filter(p => !leftPresences.some(lp => lp.presence_ref === p.presence_ref)));
      })
      // Data changes
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_segments' }, payload => {
        const row: any = payload.new || payload.old;
        if (payload.eventType === 'INSERT') {
          setScheduledSegments(prev => prev.some(s => s.id === row.id) ? prev : [...prev, { id: row.id, projectId: row.project_id, startDay: row.start_day, endDay: row.end_day, createdBy: row.created_by, createdByName: row.created_by_name, depotId: row.depot_id ?? null, sortIndex: row.sort_index ?? null, truck: row.truck ?? null }]);
          setProjects(prev => prev.some(p => p.id === row.project_id) ? prev : [...prev, {
            id: row.project_id,
            name: row.project_name,
            customer: row.customer || '',
            orderNumber: row.order_number || null,
            createdAt: row.created_at || new Date().toISOString(),
            status: row.is_manual ? 'MANUELL' : 'PLAN',
            isManual: row.is_manual,
            customerId: row.customer_id ?? null,
            customerEmail: row.customer_email ?? null,
            salesResponsible: row.sales_responsible ?? null
          }]);
        } else if (payload.eventType === 'UPDATE') {
          setScheduledSegments(prev => prev.map(s => s.id === row.id ? { ...s, startDay: row.start_day, endDay: row.end_day, createdByName: row.created_by_name ?? s.createdByName, depotId: row.depot_id ?? s.depotId ?? null, sortIndex: row.sort_index ?? s.sortIndex ?? null, truck: row.truck ?? s.truck ?? null } : s));
        } else if (payload.eventType === 'DELETE') {
          setScheduledSegments(prev => prev.filter(s => s.id !== row.id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_segment_team_members' }, payload => {
        const row: any = payload.new || payload.old;
        const segId = row?.segment_id;
        if (!segId) return;
        setSegmentCrew(prev => {
          const next = { ...prev } as any;
          if (payload.eventType === 'DELETE') {
            const list = (next[segId] || []).filter((m: any) => m.id !== (row.member_id || null) || m.name !== (row.member_name || ''));
            next[segId] = list;
            return next;
          }
          const list = (next[segId] || []).filter((m: any) => !(m.id === (row.member_id || null) && m.name === (row.member_name || '')));
          list.push({ id: row.member_id || null, name: row.member_name || '' });
          next[segId] = list;
          return next;
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_project_meta' }, payload => {
        const row: any = payload.new || payload.old;
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          setScheduleMeta(prev => ({
            ...prev, [row.project_id]: {
              projectId: row.project_id,
              truck: row.truck,
              bagCount: row.bag_count,
              jobType: row.job_type,
              color: row.color,
              client_notified: row.client_notified,
              client_notified_at: row.client_notified_at,
              client_notified_by: row.client_notified_by,
              actual_bags_used: (row as any).actual_bags_used,
              actual_bags_set_at: (row as any).actual_bags_set_at,
              actual_bags_set_by: (row as any).actual_bags_set_by,
            }
          }));
        } else if (payload.eventType === 'DELETE') {
          setScheduleMeta(prev => { const c = { ...prev }; delete c[row.project_id]; return c; });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_segment_reports' }, payload => {
        const row: any = payload.new || payload.old;
        if (payload.eventType === 'INSERT') {
          setSegmentReports(prev => prev.some(r => r.id === row.id) ? prev : [...prev, { id: row.id, segmentId: row.segment_id, reportDay: row.report_day, amount: row.amount, createdBy: row.created_by ?? null, createdByName: row.created_by_name ?? null, createdAt: row.created_at || null, projectId: (row as any).project_id ?? null }]);
        } else if (payload.eventType === 'UPDATE') {
          setSegmentReports(prev => prev.map(r => r.id === row.id ? { id: row.id, segmentId: row.segment_id, reportDay: row.report_day, amount: row.amount, createdBy: row.created_by ?? null, createdByName: row.created_by_name ?? null, createdAt: row.created_at || r.createdAt || null, projectId: (row as any).project_id ?? r.projectId ?? null } : r));
        } else if (payload.eventType === 'DELETE') {
          setSegmentReports(prev => prev.filter(r => r.id !== row.id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_trucks' }, payload => {
        const row: any = payload.new || payload.old;
        if (payload.eventType === 'INSERT') {
          setPlanningTrucks(prev => prev.some(t => t.id === row.id) ? prev : [...prev, { id: row.id, name: row.name, color: row.color, team_member1_name: row.team_member1_name, team_member2_name: row.team_member2_name, depot_id: row.depot_id || null, team1_id: row.team1_id || null, team2_id: row.team2_id || null }]);
          if (row.color) setTruckColorOverrides(prev => ({ ...prev, [row.name]: row.color }));
        } else if (payload.eventType === 'UPDATE') {
          setPlanningTrucks(prev => prev.map(t => t.id === row.id ? { id: row.id, name: row.name, color: row.color, team_member1_name: row.team_member1_name, team_member2_name: row.team_member2_name, depot_id: row.depot_id || null, team1_id: row.team1_id || null, team2_id: row.team2_id || null } : t));
          if (row.color) setTruckColorOverrides(prev => ({ ...prev, [row.name]: row.color }));
        } else if (payload.eventType === 'DELETE') {
          setPlanningTrucks(prev => prev.filter(t => t.id !== row.id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_depots' }, payload => {
        const row: any = payload.new || payload.old;
        if (payload.eventType === 'INSERT') {
          setDepots(prev => prev.some(d => d.id === row.id) ? prev : [...prev, { id: row.id, name: row.name, material_total: row.material_total, material_ekovilla_total: row.material_ekovilla_total, material_vitull_total: row.material_vitull_total }]);
        } else if (payload.eventType === 'UPDATE') {
          setDepots(prev => prev.map(d => d.id === row.id ? { id: row.id, name: row.name, material_total: row.material_total, material_ekovilla_total: row.material_ekovilla_total, material_vitull_total: row.material_vitull_total } : d));
        } else if (payload.eventType === 'DELETE') {
          setDepots(prev => prev.filter(d => d.id !== row.id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_depot_deliveries' }, payload => {
        const row: any = payload.new || payload.old;
        if (payload.eventType === 'INSERT') {
          setDeliveries(prev => prev.some(d => d.id === row.id) ? prev : [...prev, row]);
        } else if (payload.eventType === 'UPDATE') {
          setDeliveries(prev => prev.map(d => d.id === row.id ? { ...d, ...row } : d));
        } else if (payload.eventType === 'DELETE') {
          setDeliveries(prev => prev.filter(d => d.id !== row.id));
        }
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('live');
          // Track current viewer with metadata
          channel.track({ id: currentUserId, name: currentUserName, joinedAt: new Date().toISOString() });
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [supabase, currentUserId, currentUserName]);

  // Aggregations for reported bags
  const reportedBagsBySegment = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of segmentReports) {
      map.set(r.segmentId, (map.get(r.segmentId) || 0) + (r.amount || 0));
    }
    return map;
  }, [segmentReports]);
  const segmentIdToProjectId = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of scheduledSegments) m.set(s.id, s.projectId);
    return m;
  }, [scheduledSegments]);
  const reportedBagsByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of segmentReports) {
      const pid = r.projectId || segmentIdToProjectId.get(r.segmentId);
      if (!pid) continue;
      map.set(pid, (map.get(pid) || 0) + (r.amount || 0));
    }
    return map;
  }, [segmentReports, segmentIdToProjectId]);

  // Add/delete report actions
  const addPartialReport = useCallback(async () => {
    if (!segEditor?.segmentId || !currentUserId) return;
    // Cooldown to prevent accidental double clicks (1.5s)
    const now = Date.now();
    if (now - lastPartialReportAtRef.current < 1500) return;
    lastPartialReportAtRef.current = now;
    const day = (reportDraft.day || segEditor.startDay).trim();
    const amt = parseInt(reportDraft.amount, 10);
    if (!day || !Number.isFinite(amt) || amt <= 0) return;
    try {
      const payload: any = { segment_id: segEditor.segmentId, project_id: segEditor.projectId, report_day: day, amount: amt, created_by: currentUserId, created_by_name: currentUserName || null };
      const { data, error } = await supabase.from('planning_segment_reports').insert(payload).select('*').single();
      if (error) throw error;
      if (data) {
        setSegmentReports(prev => [...prev, { id: data.id, segmentId: data.segment_id, reportDay: data.report_day, amount: data.amount, createdBy: data.created_by ?? null, createdByName: data.created_by_name ?? null, createdAt: data.created_at || null, projectId: (data as any).project_id ?? segEditor.projectId }]);
        setReportDraft(d => ({ day: d.day, amount: '' }));
        // Also withdraw from correct depot with idempotency key based on this partial report
        try {
          const mat = (() => {
            const jt = (scheduleMeta[segEditor.projectId!]?.jobType || '').toLowerCase();
            if (jt.startsWith('vit')) return 'Vitull';
            if (jt.startsWith('eko')) return 'Ekovilla';
            return undefined;
          })();
          const resp = await fetch('/api/planning/consume-bags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: segEditor.projectId,
              installationDate: day,
              totalBags: amt,
              segmentId: segEditor.segmentId,
              reportKey: `partial:${data.id}`,
              materialKind: mat,
            })
          });
          try { const j = await resp.json(); console.log('[consume-bags planner]', j); } catch {}
        } catch (_) { /* ignore */ }
        // Post a short comment to Blikk project timeline (single-line to avoid UI truncation)
        try {
          const parts = [
            `DELRAPPORTERERING`,
            `Säckar blåsta: ${amt}`,
            `Datum: ${day}`,
            ...(currentUserName ? [`Av: ${currentUserName}`] : []),
          ];
          const commentText = parts.join(' — ');
          const resp2 = await fetch('/api/blikk/project/comment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: segEditor.projectId, text: commentText })
          });
          try { const j2 = await resp2.json(); console.log('[blikk comment planner]', j2); } catch {}
        } catch (_) { /* ignore */ }
      }
    } catch (e) {
      console.warn('[planning] addPartialReport failed', e);
    }
  }, [segEditor?.segmentId, reportDraft.day, reportDraft.amount, supabase, currentUserId, currentUserName]);
  const deletePartialReport = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('planning_segment_reports').delete().eq('id', id);
      if (error) throw error;
      setSegmentReports(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      console.warn('[planning] deletePartialReport failed', e);
    }
  }, [supabase]);

  // Secondary channel for editing broadcast events
  useEffect(() => {
    const editingChannel = supabase.channel('planning-edit');
    editingChannel
      .on('broadcast', { event: 'editing_start' }, payload => {
        const p: any = payload.payload;
        const key = `${p.userId || 'anon'}:${p.projectId}`;
        setRemoteEditing(prev => ({ ...prev, [key]: { userId: p.userId, userName: p.userName, projectId: p.projectId, segmentId: p.segmentId, field: p.field, ts: Date.now() } }));
      })
      .on('broadcast', { event: 'editing_stop' }, payload => {
        const p: any = payload.payload;
        const key = `${p.userId || 'anon'}:${p.projectId}`;
        setRemoteEditing(prev => { const c = { ...prev }; delete c[key]; return c; });
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          // Nothing initial to send
        }
      });
    const interval = setInterval(() => {
      // Expire stale entries ( > 45s )
      const cutoff = Date.now() - 45000;
      setRemoteEditing(prev => {
        let changed = false; const c: typeof prev = { ...prev };
        for (const [k, v] of Object.entries(prev)) {
          if (v.ts < cutoff) { delete c[k]; changed = true; }
        }
        return changed ? c : prev;
      });
    }, 10000);
    return () => { clearInterval(interval); supabase.removeChannel(editingChannel); };
  }, [supabase]);

  function broadcastEditStart(projectId: string, field: string, segmentId?: string) {
    if (!currentUserId && !currentUserName) return; // optional: allow anon but skip for noise
    const key = `${currentUserId || 'anon'}:${projectId}`;
    if (localEditingKeysRef.current.has(key)) return; // already broadcasting
    localEditingKeysRef.current.add(key);
    supabase.channel('planning-edit').send({ type: 'broadcast', event: 'editing_start', payload: { userId: currentUserId, userName: currentUserName, projectId, segmentId, field } });
  }
  function broadcastEditStop(projectId: string) {
    const key = `${currentUserId || 'anon'}:${projectId}`;
    if (!localEditingKeysRef.current.has(key)) return;
    localEditingKeysRef.current.delete(key);
    supabase.channel('planning-edit').send({ type: 'broadcast', event: 'editing_stop', payload: { userId: currentUserId, projectId } });
  }

  function getRemoteEditorsForProject(projectId: string) {
    return Object.values(remoteEditing).filter(e => e.projectId === projectId && e.userId !== currentUserId);
  }

  function getRemoteEditorsForField(projectId: string, field: string) {
    return Object.values(remoteEditing).filter(e => e.projectId === projectId && e.field === field && e.userId !== currentUserId);
  }

  function FieldPresence({ projectId, field, size = 14 }: { projectId: string; field: string; size?: number }) {
    const editors = getRemoteEditorsForField(projectId, field);
    if (editors.length === 0) return null;
    const shown = editors.slice(0, 3);
    return (
      <span title={"Redigerar: " + editors.map(e => e.userName || e.userId || 'Okänd').join(', ')} style={{ position: 'absolute', top: -6, right: -6, display: 'flex', gap: 2 }}>
        {shown.map(ed => {
          const name = (ed.userName || ed.userId || '?') as string;
          const initials = creatorInitials(name);
          const { bg } = creatorColor(name);
          return (
            <span key={(ed.userId || 'anon') + ed.field}
              style={{ width: size, height: size, background: bg, color: '#fff', fontSize: size * 0.45, fontWeight: 600, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 2px #fff, 0 0 0 3px rgba(0,0,0,0.15)' }}>{initials}</span>
          );
        })}
        {editors.length > shown.length && (
          <span style={{ width: size, height: size, borderRadius: '50%', background: '#334155', color: '#fff', fontSize: size * 0.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 2px #fff, 0 0 0 3px rgba(0,0,0,0.15)' }}>+{editors.length - shown.length}</span>
        )}
      </span>
    );
  }

  // Ensure we stop broadcasting edits on unmount
  useEffect(() => {
    return () => {
      for (const key of Array.from(localEditingKeysRef.current)) {
        const [, projectId] = key.split(':');
        supabase.channel('planning-edit').send({ type: 'broadcast', event: 'editing_stop', payload: { userId: currentUserId, projectId } });
      }
      localEditingKeysRef.current.clear();
    };
  }, [supabase, currentUserId]);

  const persistSegmentCreate = useCallback((seg: ScheduledSegment, project: Project) => {
    if (createdIdsRef.current.has(seg.id)) return;
    const payload: any = {
      id: seg.id,
      project_id: seg.projectId,
      project_name: project.name,            // NOT NULL
      customer: project.customer || null,
      order_number: project.orderNumber || null,
      source: project.isManual ? 'manual' : 'blikk', // NOT NULL constrained enum
      is_manual: project.isManual,
      start_day: seg.startDay,
      end_day: seg.endDay,
      created_by: currentUserId,
      created_by_name: currentUserName || currentUserId || project.customer || 'Okänd'
    };
    if (seg.depotId) payload.depot_id = seg.depotId;
    if (seg.truck !== undefined) payload.truck = seg.truck;
    if (seg.sortIndex != null) payload.sort_index = seg.sortIndex;
    enqueue(
      supabase.from('planning_segments')
        .upsert(payload, { onConflict: 'id', ignoreDuplicates: true })
        .select('id')
        .then(({ data, error }) => {
          if (error) {
            if ((error as any).code === '23505') {
              // Duplicate: treat as success to avoid spam
              createdIdsRef.current.add(seg.id);
            } else {
              console.warn('[persist create seg] error', error, payload);
              // Allow retry by not marking id as created
            }
          } else {
            createdIdsRef.current.add(seg.id);
            console.debug('[planning] upsert ok', data);
          }
        })
    );
  }, [supabase, currentUserId, currentUserName]);

  const persistSegmentUpdate = useCallback((seg: ScheduledSegment) => {
    enqueue(supabase.from('planning_segments').update({ start_day: seg.startDay, end_day: seg.endDay, truck: seg.truck ?? null }).eq('id', seg.id).select('id').then(({ data, error }) => { if (error) console.warn('[persist update seg] error', error); else console.debug('[planning] update ok', data); }));
  }, [supabase]);

  const deletedSegConfirmRef = useRef<Set<string>>(new Set());
  const persistSegmentDelete = useCallback((segmentId: string) => {
    // Only ask confirmation the first time user requests deletion for this segment id in this render lifecycle
    if (!deletedSegConfirmRef.current.has(segmentId)) {
      if (typeof window !== 'undefined') {
        const ok = window.confirm('Ta bort detta projekt från planeringen? Detta går inte att ångra.');
        if (!ok) return; // abort deletion
      }
      deletedSegConfirmRef.current.add(segmentId);
    }
    enqueue(
      supabase
        .from('planning_segments')
        .delete()
        .eq('id', segmentId)
        .select('id')
        .then(({ data, error }) => {
          if (error) console.warn('[persist delete seg] error', error);
          else console.debug('[planning] delete ok', data);
        })
    );
    // Best-effort cleanup of per-segment crew
    enqueue(
      supabase
        .from('planning_segment_team_members')
        .delete()
        .eq('segment_id', segmentId)
        .then(({ error }) => { if (error) console.warn('[persist delete seg-crew] error', error); })
    );
  }, [supabase]);

  // Depå helpers (admin guarded by RLS; UI also hides for non-admin)
  const upsertDepotTotals = useCallback((id: string, ekoStr?: string, vitStr?: string) => {
    const normEko = (ekoStr ?? '').trim();
    const normVit = (vitStr ?? '').trim();
    const eko = normEko === '' ? null : Number(normEko);
    const vit = normVit === '' ? null : Number(normVit);
    if (normEko !== '' && !Number.isFinite(eko)) return;
    if (normVit !== '' && !Number.isFinite(vit)) return;
    setDepots(prev => prev.map(d => d.id === id ? { ...d, material_ekovilla_total: eko as any, material_vitull_total: vit as any } : d));
    const payload: any = {};
    if (ekoStr !== undefined) payload.material_ekovilla_total = eko as any;
    if (vitStr !== undefined) payload.material_vitull_total = vit as any;
    enqueue(
      supabase.from('planning_depots')
        .update(payload)
        .eq('id', id)
        .select('id')
        .then(({ error }) => { if (error) console.warn('[depots] update error', error); })
    );
  }, [supabase]);

  const createDepot = useCallback((e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const name = newDepotName.trim();
    if (!name) return;
    setNewDepotName('');
    const payload: any = { name };
    if (currentUserId) payload.created_by = currentUserId;
    enqueue(
      supabase.from('planning_depots')
        .insert(payload)
        .select('*')
        .then(({ data, error }) => {
          if (error) { console.warn('[depots] create error', error); return; }
          if (Array.isArray(data) && data[0]) setDepots(prev => [...prev, data[0] as any]);
        })
    );
  }, [supabase, newDepotName, currentUserId]);

  const deleteDepot = useCallback((dep: DepotRec) => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Ta bort depå "${dep.name}"?`);
      if (!ok) return;
    }
    setDepots(prev => prev.filter(d => d.id !== dep.id));
    enqueue(
      supabase.from('planning_depots')
        .delete()
        .eq('id', dep.id)
        .then(({ error }) => { if (error) console.warn('[depots] delete error', error); })
    );
  }, [supabase]);

  // Create a planned delivery for a depot (material + amount + date)
  const createPlannedDelivery = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const depotId = newDelivery.depotId;
    const materialKind = newDelivery.materialKind;
    const amountNum = Number((newDelivery.amount || '').trim());
    const date = (newDelivery.date || '').trim();
    if (!depotId) { if (typeof window !== 'undefined') alert('Välj depå.'); return; }
    if (!date) { if (typeof window !== 'undefined') alert('Välj datum.'); return; }
    if (!Number.isFinite(amountNum) || amountNum <= 0) { if (typeof window !== 'undefined') alert('Ange ett antal > 0.'); return; }
    setSavingDelivery('saving');
    const payload: any = { depot_id: depotId, material_kind: materialKind, amount: amountNum, delivery_date: date };
    if (currentUserId) payload.created_by = currentUserId;
    try {
      const { data: inserted, error } = await supabase
        .from('planning_depot_deliveries')
        .insert(payload)
        .select('id')
        .single();
      if (error) { console.warn('[deliveries] create error', error); setSavingDelivery('error'); return; }
      // Optimistically add to local state so it appears immediately; realtime will reconcile if needed
      if (inserted && inserted.id) {
        const newRow = { id: inserted.id as string, depot_id: depotId, material_kind: materialKind, amount: amountNum, delivery_date: date, created_by: currentUserId || null, created_at: new Date().toISOString() } as any;
        setDeliveries(prev => prev.some(d => d.id === newRow.id) ? prev : [...prev, newRow]);
      }
      setSavingDelivery('saved');
      setNewDelivery({ depotId: '', materialKind: 'Ekovilla', amount: '', date: '' });
      setTimeout(() => setSavingDelivery('idle'), 1200);
    } catch (err) {
      console.warn('[deliveries] create exception', err);
      setSavingDelivery('error');
    }
  }, [newDelivery, supabase, currentUserId]);

  const updatePlannedDelivery = useCallback(async (id: string) => {
    const edit = editingDeliveries[id] || {};
    const payload: any = {};
    if (edit.depotId !== undefined) payload.depot_id = edit.depotId || null;
    if (edit.materialKind !== undefined) payload.material_kind = edit.materialKind;
    if (edit.amount !== undefined) {
      const num = Number((edit.amount || '').trim());
      if (!Number.isFinite(num) || num <= 0) { if (typeof window !== 'undefined') alert('Ange ett antal > 0.'); return; }
      payload.amount = num;
    }
    if (edit.date !== undefined) payload.delivery_date = (edit.date || '').trim();
    if (Object.keys(payload).length === 0) return;
    try {
      const { error } = await supabase.from('planning_depot_deliveries').update(payload).eq('id', id);
      if (error) { console.warn('[deliveries] update error', error); return; }
      setEditingDeliveries(prev => { const c = { ...prev }; delete c[id]; return c; });
    } catch (err) {
      console.warn('[deliveries] update exception', err);
    }
  }, [editingDeliveries, supabase]);

  const deletePlannedDelivery = useCallback(async (id: string) => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm('Ta bort denna leverans?');
      if (!ok) return;
    }
    // Optimistic removal so UI updates immediately
    setDeliveries(prev => prev.filter(d => d.id !== id));
    setEditingDeliveries(prev => { const c = { ...prev }; delete c[id]; return c; });
    try {
      const { error } = await supabase.from('planning_depot_deliveries').delete().eq('id', id);
      if (error) {
        console.warn('[deliveries] delete error', error);
        // Reconcile by refetching on error
        try {
          const { data: delRows } = await supabase.from('planning_depot_deliveries').select('*').order('delivery_date');
          if (Array.isArray(delRows)) setDeliveries(delRows as any);
        } catch (e) {
          console.warn('[deliveries] refetch after delete error', e);
        }
      }
    } catch (err) {
      console.warn('[deliveries] delete exception', err);
      // Reconcile by refetching on exception
      try {
        const { data: delRows } = await supabase.from('planning_depot_deliveries').select('*').order('delivery_date');
        if (Array.isArray(delRows)) setDeliveries(delRows as any);
      } catch (e) {
        console.warn('[deliveries] refetch after exception error', e);
      }
    }
  }, [supabase]);

  const groupedDeliveries = useMemo(() => {
    const byKey: Record<string, { depotId: string; material: 'Ekovilla' | 'Vitull'; date: string; items: typeof deliveries }> = {} as any;
    const sorted = [...deliveries].sort((a, b) => (a.delivery_date || '').localeCompare(b.delivery_date || '') || (a.depot_id || '').localeCompare(b.depot_id || '') || (a.material_kind || '').localeCompare(b.material_kind || ''));
    for (const d of sorted) {
      const key = `${d.depot_id}|${d.delivery_date}|${d.material_kind}`;
      if (!byKey[key]) byKey[key] = { depotId: d.depot_id, material: d.material_kind, date: d.delivery_date, items: [] as any };
      byKey[key].items.push(d as any);
    }
    return Object.values(byKey);
  }, [deliveries]);

  // Upcoming deliveries for current view (selected week or visible month)
  const upcomingDeliveriesForView = useMemo(() => {
    if (!deliveries || deliveries.length === 0) return [] as Array<{ id: string; depot_id: string; material_kind: 'Ekovilla' | 'Vitull'; amount: number; delivery_date: string }>;
    let start: string | null = null;
    let end: string | null = null;
    if (selectedWeekKey) {
      const monday = mondayFromIsoWeekKey(selectedWeekKey);
      if (monday) {
        const sunday = new Date(monday);
        sunday.setDate(sunday.getDate() + 6);
        start = fmtDate(monday);
        end = fmtDate(sunday);
      }
    } else {
      const base = new Date();
      base.setDate(1);
      base.setMonth(base.getMonth() + monthOffset);
      const s = startOfMonth(base);
      const e = endOfMonth(base);
      start = fmtDate(s);
      end = fmtDate(e);
    }
    const inRange = deliveries.filter(d => {
      const dt = d.delivery_date;
      if (!dt) return false;
      if (start && dt < start) return false;
      if (end && dt > end) return false;
      return true;
    });
    // Sort ascending by date then depot then material
    inRange.sort((a, b) => (a.delivery_date || '').localeCompare(b.delivery_date || '') || (a.depot_id || '').localeCompare(b.depot_id || '') || (a.material_kind || '').localeCompare(b.material_kind || ''));
    // Limit to avoid clutter
    return inRange.slice(0, 12);
  }, [deliveries, selectedWeekKey, monthOffset]);

  // Truck helpers (admin guarded by RLS; UI also hides for non-admin)
  const createTruck = useCallback(async () => {
    const name = newTruckName.trim();
    if (!name) return;
    setTruckCreateError('');
    // Basic validations
    if (name.length < 2) {
      setTruckCreateError('Namnet behöver vara minst 2 tecken.');
      return;
    }
    // Prevent obvious duplicates client-side to improve UX
    if (planningTrucks.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      setTruckCreateError('Det finns redan en lastbil med det namnet.');
      return;
    }
    const payload: any = { name };
    if (currentUserId) payload.created_by = currentUserId;
    if (newTruckDepotId) payload.depot_id = newTruckDepotId; else payload.depot_id = null;
    setIsCreatingTruck(true);
    enqueue((async () => {
      try {
        const { data, error } = await supabase.from('planning_trucks').insert(payload).select('id,name');
        if (error) {
          console.warn('[planning] createTruck error', error);
          const msg = String(error.message || '').toLowerCase();
          if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
            setTruckCreateError('Det finns redan en lastbil med det namnet.');
          } else if (msg.includes('row-level security') || msg.includes('permission denied') || msg.includes('not allowed')) {
            setTruckCreateError('Behörighet saknas för att skapa lastbil.');
          } else {
            setTruckCreateError('Kunde inte skapa lastbil. Försök igen.');
          }
        } else {
          console.debug('[planning] createTruck ok', data);
          setNewTruckName('');
          setNewTruckDepotId('');
          setTruckCreateError('');
        }
      } finally {
        setIsCreatingTruck(false);
      }
    })());
  }, [newTruckName, supabase, currentUserId, planningTrucks, newTruckDepotId]);

  const updateTruckColor = useCallback((truck: TruckRec, color: string) => {
    setTruckColorOverrides(prev => ({ ...prev, [truck.name]: color }));
    enqueue(supabase.from('planning_trucks').update({ color }).eq('id', truck.id));
  }, [supabase]);

  const updateTruckDepot = useCallback((truck: TruckRec, depotId: string | null) => {
    setPlanningTrucks(prev => prev.map(t => t.id === truck.id ? { ...t, depot_id: depotId } : t));
    enqueue(supabase.from('planning_trucks').update({ depot_id: depotId }).eq('id', truck.id));
  }, [supabase]);

  const updateTruckName = useCallback((truck: TruckRec, newNameRaw: string) => {
    const newName = (newNameRaw || '').trim();
    setTruckNameErrors(prev => ({ ...prev, [truck.id]: '' }));
    if (newName.length < 2) {
      setTruckNameErrors(prev => ({ ...prev, [truck.id]: 'Namnet behöver vara minst 2 tecken.' }));
      return;
    }
    if (planningTrucks.some(t => t.id !== truck.id && t.name.toLowerCase() === newName.toLowerCase())) {
      setTruckNameErrors(prev => ({ ...prev, [truck.id]: 'Det finns redan en lastbil med det namnet.' }));
      return;
    }
    if (newName === truck.name) return; // nothing to do
    setTruckNameStatus(prev => ({ ...prev, [truck.id]: 'saving' }));
    const oldName = truck.name;
    // Optimistic: update local name
    setPlanningTrucks(prev => prev.map(t => t.id === truck.id ? { ...t, name: newName } : t));
    // Move color override key if exists
    setTruckColorOverrides(prev => {
      if (!prev[oldName]) return prev;
      const { [oldName]: oldColor, ...rest } = prev as any;
      return { ...rest, [newName]: oldColor };
    });
    enqueue((async () => {
      try {
        const { error } = await supabase.from('planning_trucks').update({ name: newName }).eq('id', truck.id);
        if (error) throw error;
        // Update segments referencing the old name
        await supabase.from('planning_segments').update({ truck: newName }).eq('truck', oldName);
        setTruckNameStatus(prev => ({ ...prev, [truck.id]: 'saved' }));
        setEditingTruckNames(prev => { const { [truck.id]: _, ...rest } = prev; return rest; });
      } catch (e: any) {
        console.warn('[planning] updateTruckName error', e);
        // Revert local change
        setPlanningTrucks(prev => prev.map(t => t.id === truck.id ? { ...t, name: oldName } : t));
        // Revert override rename
        setTruckColorOverrides(prev => {
          const cur = { ...prev } as any;
          if (cur[newName]) { cur[oldName] = cur[newName]; delete cur[newName]; }
          return cur;
        });
        const msg = String(e?.message || '').toLowerCase();
        if (msg.includes('duplicate') || msg.includes('unique')) {
          setTruckNameErrors(prev => ({ ...prev, [truck.id]: 'Det finns redan en lastbil med det namnet.' }));
        } else if (msg.includes('permission') || msg.includes('security')) {
          setTruckNameErrors(prev => ({ ...prev, [truck.id]: 'Behörighet saknas för att byta namn.' }));
        } else {
          setTruckNameErrors(prev => ({ ...prev, [truck.id]: 'Kunde inte byta namn. Försök igen.' }));
        }
        setTruckNameStatus(prev => ({ ...prev, [truck.id]: 'error' }));
      }
    })());
  }, [planningTrucks, supabase, setPlanningTrucks]);

  const updateSegmentDepot = useCallback((segmentId: string, depotId: string | null) => {
    setScheduledSegments(prev => prev.map(s => s.id === segmentId ? { ...s, depotId } : s));
    enqueue(
      supabase.from('planning_segments')
        .update({ depot_id: depotId })
        .eq('id', segmentId)
        .select('id')
        .then(({ error }) => { if (error) console.warn('[planning] update segment depot error', error); })
    );
  }, [supabase]);

  const updateSegmentSortIndex = useCallback((segmentId: string, sortIndex: number | null) => {
    setScheduledSegments(prev => prev.map(s => s.id === segmentId ? { ...s, sortIndex } : s));
    enqueue(
      supabase.from('planning_segments')
        .update({ sort_index: sortIndex })
        .eq('id', segmentId)
        .select('id')
        .then(({ error }) => { if (error) console.warn('[planning] update segment sort_index error', error); })
    );
  }, [supabase]);

  // Persist a sequential order (0..n-1) for the given segments using their current visual order
  const setSequentialSortForSegments = useCallback((orderedSegmentIds: string[]) => {
    orderedSegmentIds.forEach((id, idx) => {
      const current = scheduledSegments.find(s => s.id === id)?.sortIndex ?? null;
      if (current !== idx) updateSegmentSortIndex(id, idx);
    });
  }, [scheduledSegments, updateSegmentSortIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpenDepotMenuTruckId(null); } };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, []);

  const deleteTruck = useCallback((truck: TruckRec) => {
    if (!window.confirm(`Ta bort lastbil "${truck.name}"?\nDetta går inte att ångra.`)) return;
    // Optimistic removal
    setPlanningTrucks(prev => prev.filter(t => t.id !== truck.id));
    setEditingTeamNames(prev => { const { [truck.id]: _, ...rest } = prev; return rest; });
    setTruckSaveStatus(prev => { const { [truck.id]: _, ...rest } = prev; return rest; });
    setTruckColorOverrides(prev => { const { [truck.name]: _, ...rest } = prev; return rest; });
    enqueue(
      supabase.from('planning_trucks')
        .delete()
        .eq('id', truck.id)
        .select('id')
        .then(({ error }) => {
          if (error) console.warn('[planning] deleteTruck error', error);
        })
    );
  }, [supabase]);

  // Duplicate a segment to another truck for the same day (creates a new segment spanning the same range)
  const duplicateSegmentToTruck = useCallback((segmentId: string, day: string, targetTruck: string) => {
    const src = scheduledSegments.find(s => s.id === segmentId);
    if (!src) return;
    // Keep the original span range but ensure the clicked day is within it
    if (day < src.startDay || day > src.endDay) return;
    const newSeg: ScheduledSegment = { id: genId(), projectId: src.projectId, startDay: src.startDay, endDay: src.endDay, depotId: src.depotId ?? null, sortIndex: null, truck: targetTruck };
    setScheduledSegments(prev => [...prev, newSeg]);
    const project = projects.find(p => p.id === src.projectId);
    if (project) persistSegmentCreate(newSeg, project);
  }, [scheduledSegments, projects, persistSegmentCreate]);

  // Explicit save workflow states
  const updateTruckTeamName = useCallback((truck: TruckRec, idx: 1 | 2, value: string) => {
    setEditingTeamNames(prev => {
      const cur = prev[truck.id] || { team1: truck.team_member1_name || '', team2: truck.team_member2_name || '', team1Id: truck.team1_id || null, team2Id: truck.team2_id || null };
      return { ...prev, [truck.id]: { ...cur, [idx === 1 ? 'team1' : 'team2']: value } };
    });
  }, []);

  const updateTruckTeamId = useCallback((truck: TruckRec, idx: 1 | 2, id: string | null) => {
    setEditingTeamNames(prev => {
      const cur = prev[truck.id] || { team1: truck.team_member1_name || '', team2: truck.team_member2_name || '', team1Id: truck.team1_id || null, team2Id: truck.team2_id || null } as any;
      const next = { ...cur } as any;
      if (idx === 1) next.team1Id = id; else next.team2Id = id;
      return { ...prev, [truck.id]: next };
    });
  }, []);

  const saveTruckTeamNames = useCallback((truck: TruckRec) => {
    const draft = editingTeamNames[truck.id] || { team1: truck.team_member1_name || '', team2: truck.team_member2_name || '', team1Id: truck.team1_id || null, team2Id: truck.team2_id || null };
    setTruckSaveStatus(prev => ({ ...prev, [truck.id]: { status: 'saving', ts: Date.now() } }));
    // Resolve target values
    const draftTeam1Id = (draft as any).team1Id ?? null;
    const draftTeam2Id = (draft as any).team2Id ?? null;
    let nm1 = draftTeam1Id ? (crewList.find(c => c.id === draftTeam1Id)?.name || draft.team1 || null) : (draft.team1 || null);
    let nm2 = draftTeam2Id ? (crewList.find(c => c.id === draftTeam2Id)?.name || draft.team2 || null) : (draft.team2 || null);

    // Optimistic UI: reflect both name and id locally
    setPlanningTrucks(prev => prev.map(t => t.id === truck.id ? { ...t, team_member1_name: nm1 ?? t.team_member1_name ?? null, team_member2_name: nm2 ?? t.team_member2_name ?? null, team1_id: draftTeam1Id, team2_id: draftTeam2Id } : t));

    // Prepare column-diff updates
    const idUpdate: any = {};
    const nameUpdate: any = {};
    if ((truck.team_member1_name || null) !== (nm1 || null)) nameUpdate.team_member1_name = nm1;
    if ((truck.team_member2_name || null) !== (nm2 || null)) nameUpdate.team_member2_name = nm2;

    async function reloadFromServer() {
      const { data: rows } = await supabase.from('planning_trucks').select('*').order('name');
      if (Array.isArray(rows)) setPlanningTrucks(rows.map(t => ({ id: t.id, name: t.name, color: t.color, team_member1_name: t.team_member1_name, team_member2_name: t.team_member2_name, depot_id: (t as any).depot_id || null, team1_id: (t as any).team1_id || null, team2_id: (t as any).team2_id || null })) as any);
    }

    enqueue((async () => {
      // Resolve missing names from profiles if needed before sending
      if (draftTeam1Id && !nm1) {
        const { data: p1 } = await supabase.from('profiles').select('full_name').eq('id', draftTeam1Id).maybeSingle();
        if (p1 && p1.full_name) nm1 = (p1 as any).full_name as string;
      }
      if (draftTeam2Id && !nm2) {
        const { data: p2 } = await supabase.from('profiles').select('full_name').eq('id', draftTeam2Id).maybeSingle();
        if (p2 && p2.full_name) nm2 = (p2 as any).full_name as string;
      }

      if ((truck.team1_id ?? null) !== (draftTeam1Id ?? null)) {
        idUpdate.team1_id = draftTeam1Id;
        if (nm1) idUpdate.team_member1_name = nm1; // only include if known
      }
      if ((truck.team2_id ?? null) !== (draftTeam2Id ?? null)) {
        idUpdate.team2_id = draftTeam2Id;
        if (nm2) idUpdate.team_member2_name = nm2;
      }

      // Prefer updating IDs first so DB trigger syncs names, if policy allows
      if (Object.keys(idUpdate).length > 0) {
        const { data: idRows, error: idErr } = await supabase.from('planning_trucks').update(idUpdate).eq('id', truck.id).select('*');
        if (!idErr && idRows && idRows[0]) {
          setPlanningTrucks(prev => prev.map(t => t.id === truck.id ? { ...t, team1_id: (idRows[0] as any).team1_id || null, team2_id: (idRows[0] as any).team2_id || null, team_member1_name: (idRows[0] as any).team_member1_name ?? t.team_member1_name, team_member2_name: (idRows[0] as any).team_member2_name ?? t.team_member2_name } : t));
        } else {
          // If updating IDs is not permitted/available, try updating names only
          if (Object.keys(nameUpdate).length > 0) {
            const { data: nameRows, error: nameErr } = await supabase.from('planning_trucks').update(nameUpdate).eq('id', truck.id).select('*');
            if (nameErr) {
              console.warn('[planning] saveTruckTeamNames fallback(name) error', nameErr);
              await reloadFromServer();
              setTruckSaveStatus(prev => ({ ...prev, [truck.id]: { status: 'error', ts: Date.now() } }));
              return;
            }
            if (nameRows && nameRows[0]) {
              setPlanningTrucks(prev => prev.map(t => t.id === truck.id ? { ...t, team_member1_name: (nameRows[0] as any).team_member1_name, team_member2_name: (nameRows[0] as any).team_member2_name } : t));
            }
          } else {
            // Nothing else to change and ID update failed
            await reloadFromServer();
            setTruckSaveStatus(prev => ({ ...prev, [truck.id]: { status: 'error', ts: Date.now() } }));
            return;
          }
        }
      } else if (Object.keys(nameUpdate).length > 0) {
        // Only names changed
        const { data: nameRows, error: nameErr } = await supabase.from('planning_trucks').update(nameUpdate).eq('id', truck.id).select('*');
        if (nameErr) {
          console.warn('[planning] saveTruckTeamNames(name only) error', nameErr);
          await reloadFromServer();
          setTruckSaveStatus(prev => ({ ...prev, [truck.id]: { status: 'error', ts: Date.now() } }));
          return;
        }
        if (nameRows && nameRows[0]) {
          setPlanningTrucks(prev => prev.map(t => t.id === truck.id ? { ...t, team_member1_name: (nameRows[0] as any).team_member1_name, team_member2_name: (nameRows[0] as any).team_member2_name } : t));
        }
      }

      // Clear edit draft and mark saved
      setEditingTeamNames(prev => { const { [truck.id]: _, ...rest } = prev; return rest; });
      setTruckSaveStatus(prev => ({ ...prev, [truck.id]: { status: 'saved', ts: Date.now() } }));
    })());
  }, [editingTeamNames, supabase, crewList]);

  const persistMetaUpsert = useCallback((projectId: string, meta: ProjectScheduleMeta) => {
    enqueue(supabase.from('planning_project_meta').upsert({
      project_id: projectId,
      truck: meta.truck,
      bag_count: meta.bagCount,
      job_type: meta.jobType,
      color: meta.color,
      client_notified: meta.client_notified ?? null,
      client_notified_at: meta.client_notified_at ?? null,
      client_notified_by: meta.client_notified_by ?? null,
      actual_bags_used: meta.actual_bags_used ?? null,
      actual_bags_set_at: meta.actual_bags_set_at ?? null,
      actual_bags_set_by: meta.actual_bags_set_by ?? null
    }).then(({ error }) => { if (error) console.warn('[persist meta upsert] error', error); }));
  }, [supabase]);

  // Capture original setter once
  const applyScheduledSegments = useCallback((updater: (prev: ScheduledSegment[]) => ScheduledSegment[]) => {
    setScheduledSegments(prev => {
      const next = updater(prev);
      // Diff for persistence
      const prevMap = new Map<string, ScheduledSegment>(prev.map(s => [s.id, s]));
      for (const seg of next) {
        const before = prevMap.get(seg.id);
        if (!before) {
          const project = projects.find(p => p.id === seg.projectId);
          if (project) persistSegmentCreate(seg, project);
        } else if (before.startDay !== seg.startDay || before.endDay !== seg.endDay) {
          persistSegmentUpdate(seg);
        }
        prevMap.delete(seg.id);
      }
      // Deletions
      for (const segId of prevMap.keys()) persistSegmentDelete(segId);
      return next;
    });
  }, [projects, persistSegmentCreate, persistSegmentDelete, persistSegmentUpdate]);

  // Calendar grid weeks
  const weeks = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const start = startOfMonth(base);
    const end = endOfMonth(base);
    const days: Array<{ date: string | null; inMonth: boolean }> = [];
    const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7; // Mon=0
    for (let i = 0, lead = weekdayIndex(start); i < lead; i++) days.push({ date: null, inMonth: false });
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push({ date: fmtDate(new Date(d)), inMonth: true });
    while (days.length % 7 !== 0) days.push({ date: null, inMonth: false });
    const fullWeeks: Array<Array<{ date: string | null; inMonth: boolean }>> = [];
    for (let i = 0; i < days.length; i += 7) fullWeeks.push(days.slice(i, i + 7));
    if (!hideWeekends) return fullWeeks;
    // When hiding weekends, collapse weeks to only Mon-Fri (indices 0..4)
    return fullWeeks.map(week => week.slice(0, 5));
  }, [monthOffset, hideWeekends]);

  // For weekday lanes view: collect all days in month grouped by weekday index (0=Mon)
  const weekdayLanes = useMemo(() => {
    if (viewMode !== 'weekdayLanes') return [] as Array<Array<{ date: string; inMonth: boolean }>>;
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const start = startOfMonth(base);
    const end = endOfMonth(base);
    const lanes: Array<Array<{ date: string; inMonth: boolean }>> = [[], [], [], [], [], [], []];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = fmtDate(new Date(d));
      const weekdayIndex = (d.getDay() + 6) % 7; // Mon=0
      lanes[weekdayIndex].push({ date: dateStr, inMonth: true });
    }
    if (!hideWeekends) return lanes;
    // Hide Sat(5) and Sun(6)
    return lanes.slice(0, 5);
  }, [viewMode, monthOffset, hideWeekends]);

  // Linear list of each day (for 'dayList' view)
  const daysOfMonth = useMemo(() => {
    if (viewMode !== 'dayList') return [] as string[];
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const start = startOfMonth(base);
    const end = endOfMonth(base);
    const out: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const idx = (d.getDay() + 6) % 7; // Mon=0
      if (hideWeekends && (idx === 5 || idx === 6)) continue;
      out.push(fmtDate(new Date(d)));
    }
    return out;
  }, [viewMode, monthOffset, hideWeekends]);

  const dayNames = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
  const visibleDayIndices = hideWeekends ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6];
  const visibleDayNames = visibleDayIndices.map(i => dayNames[i]);
  // Today marker (local date)
  const todayISO = useMemo(() => fmtDate(new Date()), []);

  // color helpers moved to ./_lib/colors

  // ISO week helpers moved to ./_lib/date

  // When selecting a week, auto jump to that month so it becomes visible
  useEffect(() => {
    if (!selectedWeekKey) return;
    const monday = mondayFromIsoWeekKey(selectedWeekKey);
    if (!monday) return;
    const today = new Date();
    const desiredOffset = (monday.getFullYear() - today.getFullYear()) * 12 + (monday.getMonth() - today.getMonth());
    setMonthOffset(desiredOffset);
  }, [selectedWeekKey]);

  // Truck colors
  const truckColors = useMemo(() => {
    const map: Record<string, { bg: string; border: string; text: string }> = {};
    for (const t of trucks) {
      let base = truckColorOverrides[t];
      if (!base) base = defaultTruckColors[t] || '#6366f1';
      map[t] = deriveColors(base);
    }
    return map;
  }, [truckColorOverrides, trucks]);

  // Resolve free-text team names
  const truckTeamNames = useCallback((truckName?: string | null) => {
    if (!truckName) return [] as string[];
    const rec = planningTrucks.find(t => t.name === truckName);
    if (!rec) return [];
    const out: string[] = [];
    if (rec.team_member1_name) out.push(rec.team_member1_name);
    if (rec.team_member2_name) out.push(rec.team_member2_name);
    return out;
  }, [planningTrucks]);

  // Expand scheduled items to per-day instances
  interface DayInstance extends ProjectScheduleMeta {
    segmentId: string;
    project: Project;
    day: string;
    spanStart: boolean;
    spanEnd: boolean;
    spanMiddle: boolean;
    totalSpan: number;
  }
  const itemsByDay = useMemo(() => {
    const map = new Map<string, DayInstance[]>();
    // Scheduled job segments → day instances
    for (const seg of scheduledSegments) {
      const project = projects.find(p => p.id === seg.projectId);
      if (!project) continue;
      const meta = scheduleMeta[seg.projectId] || { projectId: seg.projectId };
      const start = new Date(seg.startDay);
      const end = new Date(seg.endDay);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const day = fmtDate(d);
        const spanStart = day === seg.startDay;
        const spanEnd = day === seg.endDay;
        const totalSpan = Math.round((new Date(seg.endDay).getTime() - new Date(seg.startDay).getTime()) / 86400000) + 1;
        const inst: DayInstance = { ...meta, segmentId: seg.id, project, day, spanStart, spanEnd, spanMiddle: !spanStart && !spanEnd, totalSpan };
        // Prefer per-segment truck if set
        (inst as any).truck = (seg as any).truck ?? (inst as any).truck ?? null;
        const list = map.get(day) || [];
        list.push(inst);
        map.set(day, list);
      }
    }
    // Planned depot deliveries → simple 1-day info cards
    for (const del of deliveries) {
      if (!del.delivery_date) continue;
      const day = del.delivery_date;
      const depotName = depots.find(d => d.id === del.depot_id)?.name || 'Okänd depå';
      const project: Project = {
        id: `delivery:${del.id}`,
        name: `Leverans: ${del.material_kind}`,
        orderNumber: null,
        customer: depotName,
        customerId: null,
        customerEmail: null,
        createdAt: del.created_at || new Date().toISOString(),
        status: 'delivery',
        salesResponsible: null,
        isManual: true,
      };
      const inst: any = {
        segmentId: `delivery:${del.id}`,
        project,
        day,
        spanStart: true,
        spanEnd: true,
        spanMiddle: false,
        totalSpan: 1,
        truck: null,
        isDelivery: true,
        deliveryAmount: del.amount,
        deliveryMaterial: del.material_kind,
        deliveryDepotName: depotName,
        // Soft brand color for deliveries (green)
        color: '#22c55e',
      };
      const list = map.get(day) || [];
      list.push(inst as DayInstance);
      map.set(day, list);
    }
    return map;
  }, [scheduledSegments, scheduleMeta, projects, deliveries, depots]);

  function rowCreatorLabel(segmentId: string) {
    const seg = scheduledSegments.find(s => s.id === segmentId);
    return seg?.createdByName || null;
  }

  // Planned consumption per depå for the selected week (per material)
  const weeklyPlannedByDepot = useMemo(() => {
    const out: Record<string, { ekovilla: number; vitull: number }> = {};
    if (!selectedWeekKey) return out; // only compute when a week is selected
    for (const seg of scheduledSegments) {
      // Count only segments whose start day is in the selected week to avoid double-counting per-day instances
      if (isoWeekKey(seg.startDay) !== selectedWeekKey) continue;
      const meta = scheduleMeta[seg.projectId];
      const bag = meta?.bagCount;
      if (!(typeof bag === 'number' && bag > 0)) continue;
      // Resolve effective depot: segment override > truck's depot
      let effectiveDepotId: string | null = seg.depotId || null;
      if (!effectiveDepotId) {
        const truckName = (seg as any).truck ?? meta?.truck ?? null;
        if (truckName) {
          const truckRec = planningTrucks.find(t => t.name === truckName) || null;
          effectiveDepotId = truckRec?.depot_id ?? null;
        }
      }
      if (!effectiveDepotId) continue; // skip if no depot can be resolved
      const jt = (meta?.jobType || '').toLowerCase();
      const key = jt.startsWith('eko') ? 'ekovilla' : jt.startsWith('vit') ? 'vitull' : null;
      if (!key) continue;
      if (!out[effectiveDepotId]) out[effectiveDepotId] = { ekovilla: 0, vitull: 0 };
      out[effectiveDepotId][key] += bag;
    }
    return out;
  }, [selectedWeekKey, scheduledSegments, scheduleMeta, planningTrucks]);

  // Planned consumption per depå for the visible month (per material; only used when no week is selected)
  const monthlyPlannedByDepot = useMemo(() => {
    const out: Record<string, { ekovilla: number; vitull: number }> = {};
    if (selectedWeekKey) return out; // prefer weekly view when a week is chosen
    // Determine the current visible month from monthOffset
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const y = base.getFullYear();
    const m = String(base.getMonth() + 1).padStart(2, '0');
    const visibleMonthKey = `${y}-${m}`; // 'YYYY-MM'
    for (const seg of scheduledSegments) {
      // Only count segments whose start day is within the visible month
      if (!seg.startDay.startsWith(visibleMonthKey + '-')) continue;
      const meta = scheduleMeta[seg.projectId];
      const bag = meta?.bagCount;
      if (!(typeof bag === 'number' && bag > 0)) continue;
      // Resolve effective depot: segment override > truck's depot
      let effectiveDepotId: string | null = seg.depotId || null;
      if (!effectiveDepotId) {
        const truckName = meta?.truck || null;
        if (truckName) {
          const truckRec = planningTrucks.find(t => t.name === truckName) || null;
          effectiveDepotId = truckRec?.depot_id ?? null;
        }
      }
      if (!effectiveDepotId) continue;
      const jt = (meta?.jobType || '').toLowerCase();
      const key = jt.startsWith('eko') ? 'ekovilla' : jt.startsWith('vit') ? 'vitull' : null;
      if (!key) continue;
      if (!out[effectiveDepotId]) out[effectiveDepotId] = { ekovilla: 0, vitull: 0 };
      out[effectiveDepotId][key] += bag;
    }
    return out;
  }, [selectedWeekKey, monthOffset, scheduledSegments, scheduleMeta, planningTrucks]);

  // Map job type to material kind used in planning
  function materialFromJobType(jt?: string | null): 'Ekovilla' | 'Vitull' | null {
    const s = (jt || '').trim().toLowerCase();
    if (!s) return null;
    if (s.startsWith('eko')) return 'Ekovilla';
    if (s.startsWith('vit')) return 'Vitull';
    return null;
  }

  // Resolve effective depot for a segment: segment override > truck's depot
  function resolveEffectiveDepotId(seg: ScheduledSegment, meta: ProjectScheduleMeta | undefined, trucksList: TruckRec[]): string | null {
    if (seg.depotId) return seg.depotId;
    const tName = meta?.truck || null;
    if (!tName) return null;
    const t = trucksList.find(tt => tt.name === tName);
    return (t?.depot_id ?? null) as string | null;
  }

  // Stock projection for current view range (selected week or visible month)
  type MatStatus = { ok: boolean; minBalance: number; firstShortageDate?: string; needed?: number };
  type DepotStatus = { Ekovilla: MatStatus; Vitull: MatStatus };
  const stockCheckByDepot = useMemo(() => {
    const out: Record<string, DepotStatus> = {};
    if (!depots.length) return out;

    // Determine inclusive date range (we'll simulate from TODAY forward only)
    let startISO: string;
    let endISO: string;
    if (selectedWeekKey) {
      const mon = mondayFromIsoWeekKey(selectedWeekKey);
      if (!mon) return out;
      const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
      startISO = fmtDate(mon);
      endISO = fmtDate(sun);
    } else {
      const base = new Date();
      base.setDate(1);
      base.setMonth(base.getMonth() + monthOffset);
      const start = startOfMonth(base);
      const end = endOfMonth(base);
      startISO = fmtDate(start);
      endISO = fmtDate(end);
    }

    // We do not care about past days: start simulation from today
    const todayISO = fmtDate(new Date());
    const simStartISO = todayISO; // always from today, regardless of view start
    if (simStartISO > endISO) {
      // View ends before today; no future days to simulate
      for (const d of depots) {
        const startEko = (d.material_ekovilla_total ?? d.material_total ?? 0) || 0;
        const startVit = (d.material_vitull_total ?? 0) || 0;
        out[d.id] = {
          Ekovilla: { ok: true, minBalance: startEko, needed: 0 },
          Vitull: { ok: true, minBalance: startVit, needed: 0 },
        } as DepotStatus;
      }
      return out;
    }

    // Build day list
    const days: string[] = [];
    const d0 = new Date(simStartISO + 'T00:00:00');
    const d1 = new Date(endISO + 'T00:00:00');
    for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) days.push(fmtDate(new Date(d)));

    // Event buckets per depot/material/day
    type DayEvents = { in: number; out: number };
    const ev: Record<string, { Ekovilla: Record<string, DayEvents>; Vitull: Record<string, DayEvents> }> = {};
    const ensure = (depotId: string, mat: 'Ekovilla' | 'Vitull', day: string) => {
      if (!ev[depotId]) ev[depotId] = { Ekovilla: {}, Vitull: {} };
      const bucket = ev[depotId][mat];
      if (!bucket[day]) bucket[day] = { in: 0, out: 0 };
      return bucket[day];
    };

    // Add deliveries within [today .. end] (arrive at start of day)
    for (const del of deliveries) {
      if (!del.depot_id || !del.delivery_date || !del.material_kind) continue;
      if (del.delivery_date < simStartISO || del.delivery_date > endISO) continue;
      ensure(del.depot_id, del.material_kind, del.delivery_date).in += Math.max(0, del.amount || 0);
    }

    // Add planned consumption on segment start day, future only
    for (const seg of scheduledSegments) {
      if (seg.startDay < simStartISO || seg.startDay > endISO) continue;
      const meta = scheduleMeta[seg.projectId];
      const bag = meta?.bagCount;
      if (!(typeof bag === 'number' && bag > 0)) continue;
      const mat = materialFromJobType(meta?.jobType);
      if (!mat) continue;
      const depotId = resolveEffectiveDepotId(seg, meta, planningTrucks);
      if (!depotId) continue;
      ensure(depotId, mat, seg.startDay).out += bag;
    }

    // Simulate balances per depot/material
    for (const d of depots) {
      const startEko = (d.material_ekovilla_total ?? d.material_total ?? 0) || 0;
      const startVit = (d.material_vitull_total ?? 0) || 0;

      const sim = (mat: 'Ekovilla' | 'Vitull', startStock: number): MatStatus => {
        let stock = startStock;
        let minBal = startStock;
        let firstShort: string | undefined;
        for (const day of days) {
          const dayEv = ev[d.id]?.[mat]?.[day];
          if (dayEv) {
            stock += dayEv.in;
            stock -= dayEv.out;
          }
          if (stock < minBal) minBal = stock;
          if (stock < 0 && !firstShort) firstShort = day;
        }
        return {
          ok: minBal >= 0,
          minBalance: minBal,
          firstShortageDate: firstShort,
          needed: minBal < 0 ? Math.ceil(-minBal) : 0,
        };
      };

      out[d.id] = {
        Ekovilla: sim('Ekovilla', startEko),
        Vitull: sim('Vitull', startVit),
      };
    }

    return out;
  }, [depots, deliveries, scheduledSegments, scheduleMeta, planningTrucks, selectedWeekKey, monthOffset, /* today */ (new Date()).toDateString()]);

  // Avatar helpers moved to ./_lib/colors
  // Extract phone numbers from free text (tolerant to spaces/dashes); returns unique display/tel pairs
  function extractPhonesFromText(text: string): Array<{ display: string; tel: string }> {
    if (!text) return [];
    const found = new Map<string, { display: string; tel: string }>();
    // Match sequences that look like phone numbers: start with + or digit, include at least 7-8 digits total
    const re = /(?:(?:\+\d[\d\s-]{6,}\d)|(?:0\d[\d\s-]{5,}\d))/g;
    const matches = text.match(re) || [];
    for (const raw of matches) {
      const display = raw.trim().replace(/\s+/g, ' ');
      // Normalize for tel: remove spaces and dashes, keep leading + if present
      const tel = display.replace(/[^\d+]/g, '');
      // Use digits-only key to dedupe (ignore + for dedupe)
      const key = tel.replace(/\D/g, '');
      if (!found.has(key) && key.length >= 7) {
        found.set(key, { display, tel });
      }
    }
    return Array.from(found.values());
  }
  function CreatorAvatar({ segmentId, textColorOverride, size = 'md' }: { segmentId: string; textColorOverride?: string; size?: 'sm' | 'md' }) {
    const name = rowCreatorLabel(segmentId);
    if (!name) return null;
    const { bg, ring } = creatorColor(name);
    const initials = creatorInitials(name);
    const isSmall = size === 'sm';
    const style: React.CSSProperties = isSmall ? {
      width: 14,
      height: 14,
      borderRadius: '50%',
      background: bg,
      color: '#fff',
      fontSize: 8,
      fontWeight: 800,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 0 0 2px #fff, 0 1px 3px rgba(0,0,0,0.2)',
      border: '1px solid rgba(0,0,0,0.2)',
      letterSpacing: .4,
      lineHeight: 1,
      flexShrink: 0
    } : {
      width: 18,
      height: 18,
      borderRadius: '50%',
      background: bg,
      color: '#fff',
      fontSize: 9.5,
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: `0 0 0 1px rgba(0,0,0,0.18), 0 0 0 2px ${ring}`,
      letterSpacing: .5,
      flexShrink: 0
    };
    return (
      <span title={`Skapad av ${name}`}
        style={style}>{initials}</span>
    );
  }

  // Calendar search (only one implementation)
  const calendarMatchDays = useMemo(() => {
    const term = calendarSearch.trim().toLowerCase();
    if (!term) return [] as string[];
    const set = new Set<string>();
    for (const seg of scheduledSegments) {
      const project = projects.find(p => p.id === seg.projectId);
      if (!project) continue;
      const meta = scheduleMeta[seg.projectId] || {};
      const hay = [project.name, project.orderNumber || '', project.customer, meta.jobType || '', (meta.bagCount != null ? String(meta.bagCount) : '')].join(' ').toLowerCase();
      if (hay.includes(term)) set.add(seg.startDay);
    }
    return Array.from(set).sort();
  }, [calendarSearch, scheduledSegments, scheduleMeta, projects]);
  const firstCalendarMatchDay = calendarMatchDays[0] || null;
  function navigateToMatch(idx: number) {
    const day = calendarMatchDays[idx];
    if (!day) return;
    const target = new Date(day + 'T00:00:00');
    const base = new Date(); base.setDate(1);
    const desiredOffset = (target.getFullYear() - base.getFullYear()) * 12 + (target.getMonth() - base.getMonth());
    setMonthOffset(desiredOffset);
    setJumpTargetDay(day);
    setMatchIndex(idx);
  }
  function jumpToFirstMatch() { if (firstCalendarMatchDay) navigateToMatch(0); }
  useEffect(() => { setMatchIndex(-1); }, [calendarSearch]);
  useEffect(() => {
    if (!jumpTargetDay) return;
    const el = document.getElementById('calday-' + jumpTargetDay);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const t = setTimeout(() => setJumpTargetDay(null), 2500);
      return () => clearTimeout(t);
    }
  }, [weeks, jumpTargetDay]);

  // Build week dropdown options based on currently visible month weeks
  const weekOptions = useMemo(() => {
    const opts: Array<{ key: string; label: string }> = [];
    const seen = new Set<string>();
    for (const week of weeks) {
      const firstDay = week.find(c => c.date)?.date;
      if (!firstDay) continue;
      const key = isoWeekKey(firstDay);
      if (seen.has(key)) continue;
      seen.add(key);
      const s = startOfIsoWeek(firstDay);
      const e = endOfIsoWeek(firstDay);
      const sLabel = s.toLocaleDateString('sv-SE', { day: '2-digit', month: 'short' });
      const eLabel = e.toLocaleDateString('sv-SE', { day: '2-digit', month: 'short' });
      const w = isoWeekNumber(firstDay);
      const label = `v${w} (${sLabel} – ${eLabel})`;
      opts.push({ key, label });
    }
    return opts;
  }, [weeks]);

  // Persist selected week key between sessions
  useEffect(() => {
    try {
      const v = localStorage.getItem('planner.selectedWeekKey');
      if (v) setSelectedWeekKey(v);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('planner.selectedWeekKey', selectedWeekKey); } catch { /* ignore */ }
  }, [selectedWeekKey]);

  // Backlog lists
  const backlog = useMemo(() => projects.filter(p => !scheduledSegments.some(s => s.projectId === p.id) && !recentSearchedIds.includes(p.id)), [projects, scheduledSegments, recentSearchedIds]);

  // NOTE: Contact enrichment removed in this fresh baseline because Project no longer includes customerId/customerEmail.
  // Once we reintroduce those fields from the Blikk project API response, we can add a minimal effect here that:
  // 1. Collects scheduled project ids.
  // 2. Filters projects missing customerEmail with a numeric customerId.
  // 3. Sequentially fetches /api/blikk/contacts/{customerId} with light throttling.
  const filteredBacklog = useMemo(() => {
    if (!salesFilter) return backlog;
    if (salesFilter === '__NONE__') return backlog.filter(p => !p.salesResponsible);
    return backlog.filter(p => (p.salesResponsible || '').toLowerCase() === salesFilter.toLowerCase());
  }, [backlog, salesFilter]);
  const distinctSales = useMemo(() => {
    // Helper: normalize name (trim, collapse inner spaces, lowercase for key)
    const norm = (raw: string) => raw.trim().replace(/\s+/g, ' ').toLowerCase();
    // Prefer directory canonical names; only add project names if not present
    const map = new Map<string, string>();
    for (const n of salesDirectory) {
      if (!n) continue;
      const key = norm(n);
      if (!map.has(key)) map.set(key, n.trim().replace(/\s+/g, ' '));
    }
    for (const p of projects) {
      if (!p.salesResponsible) continue;
      const cleaned = p.salesResponsible.trim().replace(/\s+/g, ' ');
      const key = norm(cleaned);
      if (!map.has(key)) map.set(key, cleaned); // only add if not already from directory
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'sv-SE', { sensitivity: 'base' }));
  }, [projects, salesDirectory]);
  const searchedProjects = useMemo(() => recentSearchedIds.map(id => projects.find(p => p.id === id)).filter(Boolean) as Project[], [recentSearchedIds, projects]);

  // DnD handlers
  function onDragStart(e: React.DragEvent, id: string) { e.dataTransfer.setData('text/plain', id); setDraggingId(id); e.dataTransfer.effectAllowed = 'move'; }
  function onDragEnd() { setDraggingId(null); }
  function allowDrop(e: React.DragEvent) { e.preventDefault(); }
  // Small helpers for Segment Editor
  const genId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2));
  const addDaysLocal = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return fmtDate(d); };
  function openSegmentEditorForNew(projectId: string, day: string, overrideTruck?: string | null) {
    const meta = scheduleMeta[projectId] || { projectId } as ProjectScheduleMeta;
    const assumedTruck = overrideTruck !== undefined ? (overrideTruck || null) : (meta.truck ?? null);
    let positionIndex: number | null = null;
    if (assumedTruck) {
      const sameDay = itemsByDay.get(day) || [];
      const sameTruck = sameDay.filter(x => x.truck === assumedTruck && x.spanStart);
      positionIndex = sameTruck.length + 1; // default to end
    }
  setSegEditor({ mode: 'create', projectId, startDay: day, endDay: day, truck: assumedTruck, bagCount: (typeof meta.bagCount === 'number' ? meta.bagCount : null), jobType: meta.jobType ?? null, depotId: null, positionIndex, crew: [] });
  setSegCrewInput('');
    setSegEditorOpen(true);
  }
  function openSegmentEditorForExisting(segmentId: string) {
    const seg = scheduledSegments.find(s => s.id === segmentId);
    if (!seg) return;
    const meta = scheduleMeta[seg.projectId] || { projectId: seg.projectId } as ProjectScheduleMeta;
  setSegEditor({ mode: 'edit', projectId: seg.projectId, segmentId: seg.id, startDay: seg.startDay, endDay: seg.endDay, truck: (seg as any).truck ?? meta.truck ?? null, bagCount: (typeof meta.bagCount === 'number' ? meta.bagCount : null), jobType: meta.jobType ?? null, depotId: seg.depotId ?? null, crew: segmentCrew[seg.id] || [] });
  setSegCrewInput('');
    setSegEditorOpen(true);
  }
  const persistSegmentCrew = useCallback(async (segmentId: string, crewListDraft: Array<{ id: string | null; name: string }>) => {
    try {
      await supabase.from('planning_segment_team_members').delete().eq('segment_id', segmentId);
      const rows = (crewListDraft || [])
        .filter(m => (m.name || '').trim().length > 0)
        .map(m => ({ segment_id: segmentId, member_id: m.id || null, member_name: m.name.trim() }));
      if (rows.length > 0) {
        const { error } = await supabase.from('planning_segment_team_members').insert(rows).select('segment_id');
        if (error) console.warn('[planning] insert crew error', error);
      }
      setSegmentCrew(prev => {
        const cleaned = (crewListDraft || []).filter(m => (m.name || '').trim().length > 0);
        const seenIds = new Set<string>();
        const seenNames = new Set<string>();
        const uniq: Array<{ id: string | null; name: string }> = [];
        for (const m of cleaned) {
          const id = m.id || null;
          const nm = (m.name || '').trim();
          const keyName = nm.toLowerCase();
          if (id) {
            if (seenIds.has(id)) continue;
            seenIds.add(id);
          } else {
            if (seenNames.has(keyName)) continue;
            seenNames.add(keyName);
          }
          uniq.push({ id, name: nm });
        }
        return { ...prev, [segmentId]: uniq };
      });
    } catch (e) {
      console.warn('[planning] persistSegmentCrew exception', e);
    }
  }, [supabase]);
  function saveSegmentEditor() {
    if (!segEditor) return;
    const { mode, projectId, segmentId, startDay, endDay, truck, bagCount, jobType, depotId, positionIndex } = segEditor;
    // Update only project-scoped meta (truck is now per-segment)
    updateMeta(projectId, { bagCount, jobType });
    if (mode === 'create') {
      const newSeg: ScheduledSegment = { id: genId(), projectId, startDay, endDay, depotId: depotId ?? undefined, truck: truck ?? null } as any;
      applyScheduledSegments(prev => {
        const next = [...prev, newSeg];
        // If a truck and desired position provided, reorder within same truck/day
        if (truck && positionIndex && positionIndex > 0) {
          // Build list of start-day items for same group in visual order
          const group = next
            .filter(s => s.startDay === startDay && (((s as any).truck ?? (scheduleMeta[s.projectId]?.truck || null)) === truck))
            .sort((a, b) => ((a.sortIndex ?? 1e9) - (b.sortIndex ?? 1e9)) || a.id.localeCompare(b.id));
          // Ensure our new segment is present
          const ids = group.map(g => g.id);
          if (!ids.includes(newSeg.id)) ids.push(newSeg.id);
          // Move to requested 1-based position (clamped)
          const from = ids.indexOf(newSeg.id);
          const to = Math.max(0, Math.min(ids.length - 1, positionIndex - 1));
          if (from !== -1 && to !== from) {
            const [moved] = ids.splice(from, 1);
            ids.splice(to, 0, moved);
            setSequentialSortForSegments(ids);
          }
        }
        return next;
      });
      const project = projects.find(p => p.id === projectId);
      if (project) {
        persistSegmentCreate(newSeg, project);
        // On schedule: if address not stored yet, fetch once from Blikk and persist to meta
        try {
          if (!projectAddresses[project.id] && project.orderNumber) {
            (async () => {
              try {
                const r = await fetch(`/api/projects/lookup?orderId=${encodeURIComponent(project.orderNumber!)}`);
                if (r.ok) {
                  const raw = await r.json();
                  const location = raw?.workSiteAddress || raw?.location || null;
                  const street = location?.streetAddress || raw?.street || raw?.addressLine1 || null;
                  const postal = location?.postalCode || raw?.postalCode || raw?.zip || null;
                  const city = location?.city || raw?.city || null;
                  const line = [street, city].filter(Boolean).join(', ');
                  if (street || city) {
                    setProjectAddresses(prev => ({ ...prev, [project.id]: line }));
                    await supabase
                      .from('planning_project_meta')
                      .upsert({ project_id: project.id, address_street: street, address_postal: postal, address_city: city } as any, { onConflict: 'project_id' });
                  }
                }
              } catch { /* ignore */ }
            })();
          }
        } catch { /* ignore */ }
      }
      // Persist crew for newly created segment
      try {
        if (segEditor.crew && segEditor.crew.length > 0) {
          persistSegmentCrew(newSeg.id, segEditor.crew);
        } else {
          setSegmentCrew(prev => ({ ...prev, [newSeg.id]: [] }));
        }
      } catch { /* ignore */ }
    } else if (segmentId) {
      // Update segment and optionally reorder within same truck/day
      applyScheduledSegments(prev => {
        const next = prev.map(s => s.id === segmentId ? ({ ...s, startDay, endDay, depotId: depotId ?? null, truck: truck ?? null }) : s);
        if (truck && segEditor.positionIndex && segEditor.positionIndex > 0) {
          // Build list of start-day items for same group in visual order (after applying edits)
          const group = next
            .filter(s => s.startDay === startDay && (((s as any).truck ?? (scheduleMeta[s.projectId]?.truck || null)) === truck))
            .sort((a, b) => ((a.sortIndex ?? 1e9) - (b.sortIndex ?? 1e9)) || a.id.localeCompare(b.id));
          const ids = group.map(g => g.id);
          const from = ids.indexOf(segmentId);
          const to = Math.max(0, Math.min(Math.max(ids.length - 1, 0), segEditor.positionIndex - 1));
          if (from !== to) {
            if (from >= 0) {
              const [moved] = ids.splice(from, 1);
              ids.splice(to, 0, moved);
            } else {
              // If not found (e.g., changed truck), insert at target
              ids.splice(to, 0, segmentId);
            }
            setSequentialSortForSegments(ids);
          }
        }
        return next;
      });
      updateSegmentDepot(segmentId, depotId ?? null);
      // Persist segment-level truck
      setTimeout(() => {
        enqueue(supabase.from('planning_segments').update({ truck: truck ?? null }).eq('id', segmentId).select('id').then(({ error }) => { if (error) console.warn('[planning] update segment truck error', error); }));
      }, 0);
      // Persist any crew changes
      try { persistSegmentCrew(segmentId, segEditor.crew || []); } catch { /* ignore */ }
    }
    closeSegEditor();
  }
  // Drag & drop into a calendar day (optionally within a truck lane in day-list view)
  function onDropDay(e: React.DragEvent, day: string, laneTruck?: string | null) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    // If dragging a segment vs a backlog project
    const seg = scheduledSegments.find(s => s.id === id);
    if (seg) {
      // inclusive length
      const startOld = new Date(seg.startDay + 'T00:00:00');
      const endOld = new Date(seg.endDay + 'T00:00:00');
      const lengthDays = Math.round((endOld.getTime() - startOld.getTime()) / 86400000) + 1; // >=1
      const newStartStr = day;
      const newStartDate = new Date(day + 'T00:00:00');
      const newEndDate = new Date(newStartDate);
      newEndDate.setDate(newEndDate.getDate() + (lengthDays - 1));
      const newEndStr = fmtDate(newEndDate);
      // Guard: never allow end < start
      if (newEndDate < newStartDate) {
        console.warn('[DragMove] corrected inverted range', { seg, newStartStr, attemptedEnd: newEndStr });
        newEndDate.setTime(newStartDate.getTime());
      }
      console.debug('[DragMove] segment', { id: seg.id, oldStart: seg.startDay, oldEnd: seg.endDay, newStart: newStartStr, newEnd: newEndStr, lengthDays });
      applyScheduledSegments(prev => prev.map(s => s.id === id ? { ...s, startDay: newStartStr, endDay: newEndStr } : s));
      // Auto navigate month if moved to different month than currently shown
      const targetDate = newStartDate;
      const base = new Date(); base.setDate(1);
      const newOffset = (targetDate.getFullYear() - base.getFullYear()) * 12 + (targetDate.getMonth() - base.getMonth());
      setMonthOffset(o => o === newOffset ? o : newOffset);
      return;
    }
    const proj = projects.find(p => p.id === id);
    if (!proj) return;
    // Ensure meta exists (set truck if lane context provided)
    setScheduleMeta(m => {
      const existing = m[proj.id] || { projectId: proj.id } as ProjectScheduleMeta;
      const truckOverride = laneTruck === undefined ? existing.truck ?? null : (laneTruck || null);
      const merged = { ...existing, truck: truckOverride, bagCount: typeof existing.bagCount === 'number' ? existing.bagCount : null, jobType: existing.jobType ?? null, color: existing.color ?? null } as ProjectScheduleMeta;
      return { ...m, [proj.id]: merged };
    });
    openSegmentEditorForNew(proj.id, day, laneTruck === undefined ? undefined : (laneTruck || null));
  }

  // Click-based scheduling fallback: select a backlog project, then click a calendar day.
  function scheduleSelectedOnDay(day: string, laneTruck?: string | null) {
    if (!selectedProjectId) return;
    const proj = projects.find(p => p.id === selectedProjectId);
    setSelectedProjectId(null);
    if (!proj) return;
    // If laneTruck supplied (day-list truck lane), apply it immediately so editor pre-fills truck
    if (laneTruck !== undefined) {
      setScheduleMeta(m => {
        const existing = m[proj.id] || { projectId: proj.id } as ProjectScheduleMeta;
        const merged = { ...existing, truck: laneTruck || null } as ProjectScheduleMeta;
        return { ...m, [proj.id]: merged };
      });
    } else {
      setScheduleMeta(m => m[proj.id] ? m : { ...m, [proj.id]: { projectId: proj.id } });
    }
    openSegmentEditorForNew(proj.id, day, laneTruck === undefined ? undefined : (laneTruck || null));
  }
  function unschedule(segmentId: string) { applyScheduledSegments(prev => prev.filter(s => s.id !== segmentId)); }
  function extendSpan(segmentId: string, direction: 'forward' | 'back') {
    applyScheduledSegments(prev => prev.map(s => {
      if (s.id !== segmentId) return s;
      if (direction === 'forward') { const d = new Date(s.endDay); d.setDate(d.getDate() + 1); return { ...s, endDay: fmtDate(d) }; }
      const d = new Date(s.startDay); d.setDate(d.getDate() - 1); return { ...s, startDay: fmtDate(d) };
    }));
  }
  function shrinkSpan(segmentId: string, edge: 'end' | 'start') {
    applyScheduledSegments(prev => prev.map(s => {
      if (s.id !== segmentId) return s;
      const span = Math.round((new Date(s.endDay).getTime() - new Date(s.startDay).getTime()) / 86400000) + 1;
      if (span <= 1) return s;
      if (edge === 'end') { const d = new Date(s.endDay); d.setDate(d.getDate() - 1); return { ...s, endDay: fmtDate(d) }; }
      const d = new Date(s.startDay); d.setDate(d.getDate() + 1); return { ...s, startDay: fmtDate(d) };
    }));
  }

  // Update project meta helpers
  function updateMeta(projectId: string, patch: Partial<ProjectScheduleMeta>) {
    // Debounced meta writes: update local state immediately for UI, but delay DB upsert
    setScheduleMeta(m => {
      const merged = { ...(m[projectId] || { projectId }), ...patch } as ProjectScheduleMeta;
      scheduleMetaDebounced(projectId, merged);
      return { ...m, [projectId]: merged };
    });
  }

  // --- Debounce infrastructure for meta upserts ---
  const metaDebounceTimers = useRef<Record<string, any>>({});
  const latestMetaCache = useRef<Record<string, ProjectScheduleMeta>>({});
  const DEBOUNCE_MS = 450;

  function scheduleMetaDebounced(projectId: string, meta: ProjectScheduleMeta) {
    latestMetaCache.current[projectId] = meta;
    const existing = metaDebounceTimers.current[projectId];
    if (existing) clearTimeout(existing);
    metaDebounceTimers.current[projectId] = setTimeout(() => {
      const finalMeta = latestMetaCache.current[projectId];
      if (finalMeta) persistMetaUpsert(projectId, finalMeta);
      delete metaDebounceTimers.current[projectId];
    }, DEBOUNCE_MS);
  }

  // Flush debounced writes on unmount / page hide to avoid losing last edits
  useEffect(() => {
    function flushAll() {
      for (const [pid, timer] of Object.entries(metaDebounceTimers.current)) {
        clearTimeout(timer);
        const finalMeta = latestMetaCache.current[pid];
        if (finalMeta) persistMetaUpsert(pid, finalMeta);
        delete metaDebounceTimers.current[pid];
      }
    }
    window.addEventListener('beforeunload', flushAll);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
    return () => {
      flushAll();
      window.removeEventListener('beforeunload', flushAll);
    };
  }, [persistMetaUpsert]);

  return (
    <div style={{ padding: 16, display: 'grid', gap: 16, position: 'relative' }}>
      {(segEditorPortal && segEditor) && (() => {
        const p = projects.find(px => px.id === segEditor.projectId);
        const daysLen = Math.max(1, Math.round((new Date(segEditor.endDay + 'T00:00:00').getTime() - new Date(segEditor.startDay + 'T00:00:00').getTime()) / 86400000) + 1);
        const setDaysLen = (n: number) => {
          const len = Math.max(1, (n | 0));
          setSegEditor(ed => ed ? ({ ...ed, endDay: addDaysLocal(ed.startDay, len - 1) }) : ed);
        };
        return (
          <div onClick={closeSegEditor} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(1px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, opacity: segEditorOpen ? 1 : 0, transition: 'opacity .24s ease' }}>
            <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" style={{ width: 'min(900px, 94vw)', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.35)', transform: segEditorOpen ? 'translateY(0) scale(1)' : 'translateY(14px) scale(.96)', opacity: segEditorOpen ? 1 : 0, transition: 'transform .35s cubic-bezier(.16,.84,.36,1), opacity .25s ease' }}>
              <div style={{ position: 'relative', padding: '14px 18px', background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 70%)', color: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'grid', placeItems: 'center' }}>📅</div>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong style={{ fontSize: 16, letterSpacing: .2 }}>{segEditor.mode === 'create' ? 'Planera jobb' : 'Redigera planering'}</strong>
                    <span style={{ fontSize: 12, opacity: .95 }}>
                      {p?.orderNumber ? <span style={{ fontFamily: 'ui-monospace,monospace', background: '#ffffff', color: '#111827', border: '1px solid #e5e7eb', padding: '1px 6px', borderRadius: 6, marginRight: 6 }}>#{p.orderNumber}</span> : null}
                      {p?.name}
                    </span>
                  </div>
                </div>
                <button aria-label="Stäng" onClick={closeSegEditor} className="btn--plain btn--xs" style={{ position: 'absolute', right: 10, top: 10, background: 'rgba(255,255,255,0.22)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 10, padding: '6px 10px', fontSize: 14, lineHeight: 1 }}>×</button>
              </div>

              <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0,1fr))', gap: 14 }}>
                <div style={{ gridColumn: 'span 7', display: 'grid', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                      <span>Datum (start)</span>
                      <input type="date" value={segEditor.startDay} onChange={e => setSegEditor(ed => ed ? ({ ...ed, startDay: e.target.value, endDay: (new Date(ed.endDay) < new Date(e.target.value) ? e.target.value : ed.endDay) }) : ed)} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                    </label>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                      <span>Antal dagar</span>
                      <input type="number" min={1} value={daysLen} onChange={e => setDaysLen(parseInt(e.target.value || '1', 10))} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                    </label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                      <span>Lastbil</span>
                      <select value={segEditor.truck || ''} onChange={e => setSegEditor(ed => ed ? ({ ...ed, truck: e.target.value || null }) : ed)} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                        <option value="">Välj lastbil…</option>
                        {trucks.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    {segEditor.truck && (() => {
                      const sameDay = itemsByDay.get(segEditor.startDay) || [];
                      const sameTruck = sameDay.filter(x => x.truck === segEditor.truck && x.spanStart);
                      const currentIdx = segEditor.mode === 'edit' && segEditor.segmentId ? sameTruck.findIndex((x: any) => x.segmentId === segEditor.segmentId) : -1;
                      const maxPos = segEditor.mode === 'create'
                        ? (Math.max(0, sameTruck.length) + 1) // include the new one
                        : (currentIdx >= 0 ? Math.max(1, sameTruck.length) : Math.max(0, sameTruck.length) + 1);
                      const val = segEditor.positionIndex ?? (currentIdx >= 0 ? (currentIdx + 1) : maxPos);
                      return (
                        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                          <span>Placering (i lastbilsordning)</span>
                          <select value={val} onChange={e => setSegEditor(ed => ed ? ({ ...ed, positionIndex: parseInt(e.target.value, 10) || 1 }) : ed)} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                            {Array.from({ length: maxPos }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} / {maxPos}</option>)}
                          </select>
                        </label>
                      );
                    })()}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                      <span>Säckar</span>
                      <input type="number" min={0} value={segEditor.bagCount ?? ''} placeholder="t.ex. 18" onChange={e => setSegEditor(ed => ed ? ({ ...ed, bagCount: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0) }) : ed)} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                    </label>

                    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                      <span>Jobbtyp / Material</span>
                      <select value={segEditor.jobType || ''} onChange={e => setSegEditor(ed => ed ? ({ ...ed, jobType: e.target.value || null }) : ed)} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                        <option value="">Välj…</option>
                        {jobTypes.map(j => <option key={j} value={j}>{j}</option>)}
                      </select>
                    </label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                      <span>Depå (override)</span>
                      <select value={segEditor.depotId || ''} onChange={e => setSegEditor(ed => ed ? ({ ...ed, depotId: e.target.value || null }) : ed)} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                        <option value="">Ingen (använd lastbilens)</option>
                        {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </label>
                  </div>
                  {/* Per-segment extra crew (beyond truck base team) */}
                  <div style={{ display: 'grid', gap: 6 }}>
                    <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                      <span>Extra team (denna dag)</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(segEditor.crew || []).map((m, idx) => (
                          <span key={(m.id || m.name) + ':' + idx} style={{ fontSize: 11, background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#334155', padding: '2px 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {m.name}
                            <button type="button" className="btn--plain btn--xs" onClick={() => setSegEditor(ed => ed ? ({ ...ed, crew: (ed.crew || []).filter((_, i) => i !== idx) }) : ed)} title="Ta bort" style={{ fontSize: 11, padding: '0 4px', border: '1px solid #fecaca', background: '#fee2e2', color: '#b91c1c', borderRadius: 6 }}>×</button>
                          </span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input value={segCrewInput} onChange={e => setSegCrewInput(e.target.value)} list="planner-crew-names" placeholder="Lägg till namn…" style={{ flex: 1, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                        <datalist id="planner-crew-names">
                          {crewNames.map(n => <option key={n} value={n} />)}
                        </datalist>
                        <button type="button" className="btn--plain btn--xs" onClick={() => {
                          const name = (segCrewInput || '').trim();
                          if (!name) return;
                          const match = crewList.find(c => c.name.toLowerCase() === name.toLowerCase()) || null;
                          setSegEditor(ed => {
                            if (!ed) return ed;
                            const curr = ed.crew || [];
                            const lower = name.toLowerCase();
                            if (match?.id && curr.some(m => m.id === match.id)) return { ...ed, crew: curr };
                            if (!match?.id && curr.some(m => (m.name || '').toLowerCase() === lower)) return { ...ed, crew: curr };
                            return { ...ed, crew: [ ...curr, { id: match ? match.id : null, name } ] };
                          });
                          setSegCrewInput('');
                        }} style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8 }}>Lägg till</button>
                      </div>
                      <span style={{ fontSize: 10, color: '#64748b' }}>Används för att lägga till fler än två personer per lastbil för denna sektion/dag.</span>
                    </label>
                  </div>
                </div>
                <div style={{ gridColumn: 'span 5', display: 'grid', gap: 10 }}>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <h4 style={{ margin: 0, fontSize: 13, letterSpacing: .2, color: '#0f172a' }}>Översikt</h4>
                      <div style={{ height: 1, background: '#e5e7eb', flex: 1 }} />
                    </div>
                    {(() => {
                      const start = segEditor.startDay;
                      const end = segEditor.endDay;
                      const single = start === end;
                      const startW = dayNames[(new Date(start + 'T00:00:00').getDay() + 6) % 7];
                      const endW = dayNames[(new Date(end + 'T00:00:00').getDay() + 6) % 7];
                      const truckName = segEditor.truck || null;
                      const truckStyle = truckName && truckColors[truckName] ? truckColors[truckName] : null;
                      const depotName = segEditor.depotId ? (depots.find(d => d.id === segEditor.depotId)?.name || 'Okänd depå') : 'Lastbilens depå';
                      const lenDays = Math.max(1, Math.round((new Date(segEditor.endDay + 'T00:00:00').getTime() - new Date(segEditor.startDay + 'T00:00:00').getTime()) / 86400000) + 1);
                      const dayList = Array.from({ length: lenDays }, (_, i) => addDaysLocal(start, i));
                      return (
                        <div style={{ display: 'grid', gap: 8 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {p?.orderNumber ? <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, background: '#eef2ff', border: '1px solid #c7d2fe', color: '#111827', padding: '2px 8px', borderRadius: 999 }}>#{p.orderNumber}</span> : null}
                            <span style={{ fontSize: 12, background: '#ecfeff', border: '1px solid #a5f3fc', color: '#164e63', padding: '2px 8px', borderRadius: 999 }}>{single ? `${startW} ${start}` : `${startW} ${start} → ${endW} ${end}`}</span>
                            <span style={{ fontSize: 12, background: '#f0fdf4', border: '1px solid #86efac', color: '#14532d', padding: '2px 8px', borderRadius: 999 }}>{segEditor.bagCount != null ? `${segEditor.bagCount} säckar` : 'Säckar ej satta'}</span>
                            {(() => {
                              const jt = segEditor.jobType || '';
                              const clr = jt ? jobTypeColors[jt] : undefined;
                              const badgeStyle: React.CSSProperties = clr ? (
                                { fontSize: 12, background: '#ffffff', border: `1px solid ${clr}55`, color: clr, padding: '2px 8px', borderRadius: 999 }
                              ) : (
                                { fontSize: 12, background: '#f5f3ff', border: '1px solid #ddd6fe', color: '#3730a3', padding: '2px 8px', borderRadius: 999 }
                              );
                              return <span style={badgeStyle}>{jt || 'Jobbtyp ej vald'}</span>;
                            })()}
                            <span style={{ fontSize: 12, background: '#fff7ed', border: '1px solid #fed7aa', color: '#7c2d12', padding: '2px 8px', borderRadius: 999 }}>{depotName}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ fontSize: 12, color: '#475569' }}>Lastbil:</div>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 8, border: `1px solid ${truckStyle ? truckStyle.border : '#cbd5e1'}`, background: truckStyle ? truckStyle.bg : '#fff' }}>
                              <div style={{ width: 8, height: 8, borderRadius: 8, background: truckStyle ? truckStyle.border : '#94a3b8' }} />
                              <div style={{ fontSize: 12, color: truckStyle ? truckStyle.text : '#0f172a' }}>{truckName || 'Inte vald'}</div>
                            </div>
                          </div>
                          {/* Explicit list of all planned days for this project (across segments) */}
                          <div style={{ display: 'grid', gap: 6 }}>
                            <div style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>Dagar</div>
                            {(() => {
                              const segsForProject = scheduledSegments.filter(s => s.projectId === segEditor.projectId);
                              const allDays = new Set<string>();
                              for (const s of segsForProject) {
                                const sStart = s.startDay;
                                const sEnd = s.endDay;
                                const spanLen = Math.max(1, Math.round((new Date(sEnd + 'T00:00:00').getTime() - new Date(sStart + 'T00:00:00').getTime()) / 86400000) + 1);
                                for (let i = 0; i < spanLen; i++) {
                                  allDays.add(addDaysLocal(sStart, i));
                                }
                              }
                              const sorted = Array.from(allDays).sort();
                              return (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {sorted.map(d => {
                                    const w = dayNames[(new Date(d + 'T00:00:00').getDay() + 6) % 7];
                                    const inCurrentSpan = d >= start && d <= end;
                                    return (
                                      <span key={d} style={{ fontSize: 11, color: inCurrentSpan ? '#111827' : '#334155', background: inCurrentSpan ? '#ffffff' : '#f8fafc', border: '1px solid #e2e8f0', padding: '2px 8px', borderRadius: 999 }}>{w} {d}</span>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  {/* Rapportering (partial bags) */}
                  {segEditor.mode === 'edit' && segEditor.segmentId && (
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <h4 style={{ margin: 0, fontSize: 13, letterSpacing: .2, color: '#0f172a' }}>Rapportering</h4>
                        <div style={{ height: 1, background: '#e5e7eb', flex: 1 }} />
                        <span style={{ fontSize: 11, color: '#64748b' }}>Totalt: {reportedBagsBySegment.get(segEditor.segmentId) || 0} säckar</span>
                      </div>
                      <div style={{ display: 'grid', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <label style={{ fontSize: 12, display: 'grid', gap: 4 }}>
                            <span>Dag</span>
                            <input type="date" value={reportDraft.day} onChange={e => setReportDraft(d => ({ ...d, day: e.target.value }))} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                          </label>
                          <label style={{ fontSize: 12, display: 'grid', gap: 4 }}>
                            <span>Antal säckar</span>
                            <input type="number" min={1} value={reportDraft.amount} onChange={e => setReportDraft(d => ({ ...d, amount: e.target.value }))} placeholder="t.ex. 8" style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                          </label>
                          <button type="button" onClick={addPartialReport} className="btn--plain btn--xs" style={{ alignSelf: 'end', height: 32, padding: '6px 10px', border: '1px solid #16a34a', background: '#16a34a', color: '#fff', borderRadius: 8 }}>Lägg till</button>
                        </div>
                        {(() => {
                          const list = segmentReports.filter(r => r.segmentId === segEditor.segmentId).sort((a, b) => (a.reportDay || '').localeCompare(b.reportDay));
                          return list.length > 0 ? (
                            <div style={{ display: 'grid', gap: 6 }}>
                              {list.map(r => (
                                <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '6px 8px' }}>
                                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                    <span style={{ fontSize: 12, color: '#0f172a' }}>{r.reportDay}</span>
                                    <span style={{ fontSize: 12, color: '#334155', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 999, padding: '2px 8px' }}>{r.amount} säckar</span>
                                    {r.createdByName && <span style={{ fontSize: 11, color: '#64748b' }}>av {r.createdByName}</span>}
                                  </div>
                                  <button type="button" className="btn--plain btn--xs" onClick={() => deletePartialReport(r.id)} style={{ fontSize: 11, padding: '4px 8px', border: '1px solid #fecaca', background: '#fee2e2', color: '#b91c1c', borderRadius: 8 }}>Ta bort</button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: '#64748b' }}>Inga delrapporter ännu.</div>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center', padding: 12, background: '#f8fafc', borderTop: '1px solid #e5e7eb', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {p && (
                    <button
                      type="button"
                      onClick={() => handleEmailClick({ segmentId: segEditor.segmentId, project: p, truck: segEditor.truck, day: segEditor.startDay, startDay: segEditor.startDay, endDay: segEditor.endDay })}
                      disabled={emailFetchStatus[p.id] === 'loading'}
                      className="btn--plain btn--xs"
                      title={scheduleMeta[p.id]?.client_notified ? (scheduleMeta[p.id]?.client_notified_by ? `Notifierad av ${scheduleMeta[p.id]!.client_notified_by}` : 'Kund markerad som notifierad') : 'Skicka planeringsmail'}
                      style={{ fontSize: 12, border: '1px solid ' + (scheduleMeta[p.id]?.client_notified ? '#047857' : '#7dd3fc'), background: scheduleMeta[p.id]?.client_notified ? '#059669' : '#e0f2fe', color: scheduleMeta[p.id]?.client_notified ? '#fff' : '#0369a1', borderRadius: 10, padding: '8px 12px' }}
                    >
                      {scheduleMeta[p.id]?.client_notified ? 'Notifierad ✓' : 'Maila kund'}
                    </button>
                  )}
                  {segEditor.mode === 'edit' && segEditor.segmentId && (
                    confirmDeleteSegmentId === segEditor.segmentId ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, color: '#b91c1c', fontWeight: 500 }}>Bekräfta borttagning?</span>
                        <button type="button" onClick={() => { if (!segEditor.segmentId) return; unschedule(segEditor.segmentId); closeSegEditor(); }} className="btn--plain btn--xs" style={{ fontSize: 11, padding: '6px 10px', background: '#dc2626', border: '1px solid #b91c1c', color: '#fff', borderRadius: 8, boxShadow: '0 0 0 1px #fff inset' }}>Ja, ta bort</button>
                        <button type="button" onClick={() => setConfirmDeleteSegmentId(null)} className="btn--plain btn--xs" style={{ fontSize: 11, padding: '6px 10px', background: '#fff', border: '1px solid #cbd5e1', color: '#334155', borderRadius: 8 }}>Avbryt</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteSegmentId(segEditor.segmentId!)}
                        className="btn--plain btn--xs"
                        style={{ fontSize: 12, padding: '8px 12px', border: '1px solid #fca5a5', background: '#fee2e2', color: '#b91c1c', borderRadius: 10 }}
                        title="Ta bort denna planerade sektion"
                      >
                        Ta bort
                      </button>
                    )
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {segEditor.mode === 'edit' && segEditor.segmentId && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff7ed', border: '1px solid #fdba74', padding: '6px 8px', borderRadius: 8 }}>
                      <span style={{ fontSize: 12, color: '#7c2d12' }}>Kopiera till lastbil</span>
                      <CopyToTruckButton
                        segmentId={segEditor.segmentId}
                        day={segEditor.startDay}
                        currentTruck={segEditor.truck || null}
                        trucks={trucks}
                        onCopy={(target: string) => { duplicateSegmentToTruck(segEditor.segmentId!, segEditor.startDay, target); }}
                      />
                    </span>
                  )}
                  <button type="button" onClick={closeSegEditor} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '8px 12px', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 10 }}>Avbryt</button>
                  <button type="button" onClick={saveSegmentEditor} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '8px 12px', border: '1px solid #16a34a', background: '#16a34a', color: '#fff', borderRadius: 10, boxShadow: '0 2px 6px rgba(22,163,74,0.25)' }}>{segEditor.mode === 'create' ? 'Lägg till' : 'Spara'}</button>
                  {(() => {
                    const proj = p; const hasEK = !!(proj?.orderNumber && hasEgenkontroll(proj.orderNumber)); const pth = proj?.orderNumber ? egenkontrollPath(proj.orderNumber) : null; return hasEK ? (
                      <a
                        href={pth ? `/api/storage/download?path=${encodeURIComponent(pth)}` : '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn--plain btn--xs"
                        style={{ fontSize: 12, padding: '8px 12px', border: '1px solid #047857', background: '#059669', color: '#fff', borderRadius: 10 }}
                      >
                        Egenkontroll
                      </a>
                    ) : null;
                  })()}
                  {p && (
                    <button
                      type="button"
                      className="btn--plain btn--xs"
                      onClick={() => openProjectModal(p.id)}
                      style={{ fontSize: 12, padding: '8px 12px', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 10 }}
                    >
                      Öppna projekt
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {emailToast && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', backdropFilter: 'blur(1px)', zIndex: 3000, pointerEvents: 'none' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#111827', color: '#fff', padding: '10px 14px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.25)', zIndex: 3010 }}>
            <span style={{ width: 12, height: 12, borderRadius: 12, border: '2px solid #93c5fd', borderTopColor: '#1d4ed8', display: 'inline-block', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 12 }}>{emailToast.msg}</span>
            <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
          </div>
        </>
      )}
      {!globalReady && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'linear-gradient(135deg,#f8fafc,#e0f2fe)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, sans-serif' }} aria-busy="true" aria-live="polite">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: 'min(420px,90%)' }}>
            <div style={{ textAlign: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>Förbereder planering…</h2>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#475569' }}>Laddar data. Vänta innan du gör ändringar.</p>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {overlayDetails.map(step => {
                const color = step.state === 'done' ? '#059669' : step.state === 'running' ? '#2563eb' : '#334155';
                const icon = step.state === 'done' ? '✓' : step.state === 'running' ? '…' : '•';
                return (
                  <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#ffffffdd', border: '1px solid #e2e8f0', padding: '10px 14px', borderRadius: 10, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
                    <div style={{ width: 22, height: 22, borderRadius: 22, background: color, color: '#fff', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', letterSpacing: '.2px' }}>{step.label}{step.note ? ` (${step.note})` : ''}</div>
                      {/* no contact enrichment progress bar */}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#64748b' }}>Detta kan ta några sekunder.</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>Om detta inte stänger inom 15 sekunder kan du börja ändå.</div>
            </div>
            <button type="button" disabled={globalReady} onClick={() => setGateReleased(true)} style={{ marginTop: 4, fontSize: 12, padding: '8px 14px', background: globalReady ? '#059669' : '#e2e8f0', color: globalReady ? '#fff' : '#334155', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
              {globalReady ? 'Klar' : 'Fortsätt ändå'}
            </button>
          </div>
        </div>
      )}
      {pendingNotifyProjectId && (() => {
        const project = projects.find(p => p.id === pendingNotifyProjectId);
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '20px 22px', width: 'min(420px,90%)', display: 'grid', gap: 16, boxShadow: '0 8px 30px -6px rgba(0,0,0,0.25)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h3 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>Har kunden notifierats?</h3>
                <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>Bekräfta att du skickade eller informerade kunden om <strong>{project?.name}</strong>.</p>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => { if (project) markClientNotified(project.id); setPendingNotifyProjectId(null); }} style={{ flex: '1 1 120px', background: '#059669', color: '#fff', border: '1px solid #047857', borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Ja, notifierad</button>
                <button type="button" onClick={() => { setPendingNotifyProjectId(null); }} style={{ flex: '1 1 120px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Nej / Avbryt</button>
                {project && scheduleMeta[project.id]?.client_notified && (
                  <button type="button" onClick={() => { undoClientNotified(project.id); setPendingNotifyProjectId(null); }} style={{ flex: '1 1 100%', background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Ångra tidigare markering</button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      {/* Project Detail Modal */}
      {detailOpen && (() => {
        const pid = detailProjectId!;
        const base = projects.find(p => p.id === pid);
        const api = detailCache[pid];
        const raw = api?.project || api; // lookup returns full raw project
        const location = raw?.workSiteAddress || raw?.location || null;
        const street = location?.streetAddress || raw?.street || raw?.addressLine1 || null;
        const postalCode = location?.postalCode || raw?.postalCode || raw?.zip || null;
        const city = location?.city || raw?.city || null;
        const address = [street, postalCode, city].filter(Boolean).join(', ');
        const description = raw?.description || raw?.notes || raw?.note || null;
        const contactPhones = description ? extractPhonesFromText(description) : [];
        const segs = scheduledSegments.filter(s => s.projectId === pid);
        const meta = scheduleMeta[pid];
        const ekPath = egenkontrollPath(base?.orderNumber || null);
        const mapsHref = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
        const team = meta?.truck ? truckTeamNames(meta.truck) : [];
        const deriveSeller = (p: any): string | null => {
          const sr = p?.salesResponsible || p?.salesResponsibleUser || p?.salesUser || p?.salesRep || p?.responsibleSalesUser;
          if (Array.isArray(sr)) return sr.map((s: any) => (s && (s.name || s.fullName || s.title)) || '').filter(Boolean).join(', ') || null;
          if (typeof sr === 'string') return sr;
          if (sr && typeof sr === 'object') return sr.name || sr.fullName || sr.title || null;
          return p?.salesResponsibleName || p?.salesResponsibleFullName || null;
        };
        const seller = deriveSeller(raw) || base?.salesResponsible || null;
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1400, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={closeProjectModal}>
            <div role="dialog" aria-modal="true" aria-busy={detailLoading ? true : undefined} onClick={e => e.stopPropagation()} style={{ width: 'min(720px, 92vw)', maxHeight: '80vh', overflowY: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 12px 30px rgba(0,0,0,0.25)', display: 'grid', gap: 12, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'grid', gap: 8 }}>
                  <strong style={{ fontSize: 18, color: '#0f172a' }}>
                    {base?.orderNumber ? <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 13, background: '#eef2ff', border: '1px solid #c7d2fe', color: '#312e81', padding: '2px 6px', borderRadius: 6, marginRight: 8 }}>#{base.orderNumber}</span> : null}
                    {base?.name || 'Projekt'}
                  </strong>
                  <span style={{ fontSize: 12, color: '#475569' }}>{base?.customer}</span>
                </div>
                <button onClick={closeProjectModal} className="btn--plain btn--sm" style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>Stäng</button>
              </div>
              {detailLoading && (
                <div role="status" aria-live="polite" style={{ display: 'grid', gap: 10, padding: '8px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" stroke="#cbd5e1" strokeWidth="3" opacity="0.35" />
                      <path d="M21 12a9 9 0 0 0-9-9" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round">
                        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
                      </path>
                    </svg>
                    <span style={{ fontSize: 12, color: '#475569' }}>Hämtar detaljer…</span>
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ height: 12, background: '#e5e7eb', borderRadius: 6 }} />
                    <div style={{ height: 12, width: '85%', background: '#e5e7eb', borderRadius: 6 }} />
                    <div style={{ height: 12, width: '70%', background: '#e5e7eb', borderRadius: 6 }} />
                    <div style={{ height: 80, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }} />
                  </div>
                </div>
              )}
              {detailError && <div style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', padding: '6px 8px', borderRadius: 8 }}>Fel: {detailError}</div>}
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'grid', gap: 6 }}>
                  {mapsHref && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: '#334155', fontWeight: 600 }}>Adress:</span>
                      <span style={{ fontSize: 12, color: '#334155' }}>{address}</span>
                      <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="btn--plain btn--xs" style={{ fontSize: 11, border: '1px solid #cbd5e1', borderRadius: 6, padding: '2px 8px', color: '#0369a1', background: '#e0f2fe' }}>Öppna i Kartor</a>
                    </div>
                  )}
                  {contactPhones.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {contactPhones.map((ph, i) => (
                        <a key={ph.tel + ':' + i} href={`tel:${ph.tel}`} title={`Ring ${ph.display}`} style={{ fontSize: 11, color: '#065f46', background: '#ecfdf5', border: '1px solid #6ee7b7', padding: '2px 6px', borderRadius: 999, textDecoration: 'none' }}>
                          Kontakt: {ph.display}
                        </a>
                      ))}
                    </div>
                  )}
                  {description && (
                    <div style={{ display: 'grid', gap: 4 }}>
                      <span style={{ fontSize: 12, color: '#334155', fontWeight: 600 }}>Beskrivning</span>
                      <p style={{ fontSize: 12, color: '#475569', whiteSpace: 'pre-wrap', margin: 0 }}>{description}</p>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {seller && <span style={{ fontSize: 11, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '2px 6px', borderRadius: 999 }}>Sälj: {seller}</span>}
                    {meta?.truck && <span style={{ fontSize: 11, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '2px 6px', borderRadius: 999 }}>Lastbil: {meta.truck}</span>}
                    {team.length > 0 && <span style={{ fontSize: 11, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '2px 6px', borderRadius: 999 }}>Team: {team.join(', ')}</span>}
                    {typeof meta?.bagCount === 'number' && <span style={{ fontSize: 11, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '2px 6px', borderRadius: 999 }}>Plan: {meta.bagCount} säckar</span>}
                    {(() => { const pid = base?.id; const agg = pid ? (reportedBagsByProject.get(pid) || 0) : 0; return agg > 0 ? <span style={{ fontSize: 11, color: '#1e293b', background: '#ecfeff', border: '1px solid #bae6fd', padding: '2px 6px', borderRadius: 999 }}>Rapporterat: {agg} säckar</span> : null; })()}
                    {meta?.jobType && <span style={{ fontSize: 11, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '2px 6px', borderRadius: 999 }}>{meta.jobType}</span>}
                    {base?.createdAt && <span style={{ fontSize: 11, color: '#64748b' }}>Skapad {base.createdAt.slice(0, 10)}</span>}
                  </div>
                </div>
                {/* Partial reports history for this project */}
                {(() => {
                  const segIds = new Set(segs.map(s => s.id));
                  const list = segmentReports
                    .filter(r => (r.projectId === pid) || segIds.has(r.segmentId))
                    .sort((a, b) => (a.reportDay || '').localeCompare(b.reportDay) || (a.createdAt || '').localeCompare(b.createdAt || ''));
                  const total = list.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
                  return (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong style={{ fontSize: 13, color: '#0f172a' }}>Delrapporter</strong>
                        <div style={{ height: 1, background: '#e5e7eb', flex: 1 }} />
                        <span style={{ fontSize: 11, color: '#64748b' }}>Totalt: {total} säckar</span>
                      </div>
                      {list.length > 0 ? (
                        <div style={{ display: 'grid', gap: 6 }}>
                          {list.map(r => (
                            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '6px 8px' }}>
                              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 12, color: '#0f172a' }}>{r.reportDay}</span>
                                <span style={{ fontSize: 12, color: '#334155', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 999, padding: '2px 8px' }}>{r.amount} säckar</span>
                                {r.createdByName && <span style={{ fontSize: 11, color: '#64748b' }}>av {r.createdByName}</span>}
                                {r.createdAt && <span style={{ fontSize: 11, color: '#94a3b8' }}>{String(r.createdAt).slice(0, 16).replace('T', ' ')}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: '#64748b' }}>Inga delrapporter för detta projekt ännu.</div>
                      )}
                    </div>
                  );
                })()}
                {(segs.length > 0) && (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <strong style={{ fontSize: 13, color: '#0f172a' }}>Planering</strong>
                    <div style={{ fontSize: 12, color: '#475569' }}>Öppna en planering (dubbelklicka på en kalenderpost) för att se exakta dagar.</div>
                  </div>
                )}
                {/* Comments via shared hook */}
                {detailProjectId && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 13, color: '#0f172a' }}>Kommentarer</strong>
                      <div style={{ height: 1, background: '#e5e7eb', flex: 1 }} />
                      <button type="button" onClick={() => refreshDetailComments(true)} className="btn--plain btn--xs" style={{ fontSize: 11, padding: '2px 8px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer' }}>Uppdatera</button>
                    </div>
                    {detailCommentsLoading && detailComments.length === 0 && <div style={{ fontSize: 12, color: '#64748b' }}>Hämtar kommentarer…</div>}
                    {detailCommentsError && <div style={{ fontSize: 12, color: '#b91c1c' }}>Fel: {detailCommentsError}</div>}
                    {!detailCommentsLoading && !detailCommentsError && detailComments.length === 0 && <div style={{ fontSize: 12, color: '#64748b' }}>Inga kommentarer.</div>}
                    {!detailCommentsLoading && !detailCommentsError && detailComments.length > 0 && (
                      <div style={{ display: 'grid', gap: 6 }}>
                        {detailComments.slice(0, 12).map(c => (
                          <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, border: '1px solid #e2e8f0', background: '#fff', borderRadius: 8, padding: '6px 8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              {c.userName && <span style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>{c.userName}</span>}
                              {c.createdAt && <span style={{ fontSize: 10, color: '#64748b' }}>{formatRelativeTime(c.createdAt)}</span>}
                            </div>
                            <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap' }}>{c.text}</div>
                          </div>
                        ))}
                        {detailComments.length > 12 && <div style={{ fontSize: 11, color: '#64748b' }}>Visar första 12 av {detailComments.length} kommentarer.</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      {/* Email summary panel */}
      <EmailSummaryPanel projects={projects} />
      <h1 style={{ margin: 0 }}>Plannering {realtimeStatus === 'live' ? '🟢' : realtimeStatus === 'connecting' ? '🟡' : '🔴'}</h1>
      {presenceUsers.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>Online:</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            {presenceUsers.slice(0, 12).map(u => {
              const name = (u.name || u.id || 'Okänd') as string;
              const initials = creatorInitials(name);
              const { bg, ring } = creatorColor(name);
              return (
                <span key={u.presence_ref || (u.id + '-' + u.joinedAt) || Math.random().toString(36)} title={name}
                  style={{
                    width: 18, height: 18, borderRadius: '50%', background: bg, color: '#fff', fontSize: 10, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 1px rgba(0,0,0,0.25), 0 0 0 2px ${ring}`, letterSpacing: .5
                  }}>{initials}</span>
              );
            })}
            {presenceUsers.length > 12 && <span style={{ fontSize: 10, color: '#475569' }}>+{presenceUsers.length - 12}</span>}
          </div>
        </div>
      )}
      {syncing && <div style={{ fontSize: 11, color: '#64748b' }}>Synkar…</div>}
      <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>Dra projekt från listan till en dag i kalendern.</p>
      {source && <div style={{ fontSize: 11, color: '#9ca3af' }}>Källa: {source}</div>}
      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '6px 8px', borderRadius: 6, fontSize: 12 }}>Fel: {error}</div>}

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: sidebarCollapsed ? '1fr' : '290px 1fr', alignItems: 'start' }}>
        {/* Left: search / manual add / backlog */}
        {sidebarCollapsed ? null : (
          <div style={{
            display: 'grid',
            gap: 16,
            position: 'sticky',
            top: 75,
            alignSelf: 'start',
            maxHeight: 'calc(100vh - 80px)',
            overflowY: 'auto',
            paddingRight: 4
          }}>
            {/* Search & manual add */}
            <div style={{ display: 'grid', gap: 10 }}>
              <form onSubmit={searchByOrderNumber} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input value={searchOrder} onChange={e => setSearchOrder(e.target.value)} placeholder="Sök ordernummer..." style={{ flex: 1, border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 8px', fontSize: 13 }} />
                <button type="submit" disabled={!searchOrder.trim() || searchLoading} className="btn--plain btn--xs" style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '5px 10px', background: '#fff' }}>{searchLoading ? 'Söker…' : 'Sök'}</button>
                {searchOrder && !searchLoading && <button type="button" className="btn--plain btn--xs" style={{ fontSize: 11 }} onClick={() => { setSearchOrder(''); setSearchError(null); }}>Rensa</button>}
              </form>
              {searchError && <div style={{ fontSize: 11, color: '#b91c1c' }}>{searchError}</div>}
              <div style={{ padding: 10, border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc', display: 'grid', gap: 8 }}>
                <strong style={{ fontSize: 13, color: '#1e293b' }}>Lägg till manuellt</strong>
                <form onSubmit={addManualProject} style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Projektnamn" style={{ flex: 1, border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', fontSize: 12 }} />
                    <input value={manualCustomer} onChange={e => setManualCustomer(e.target.value)} placeholder="Kund" style={{ flex: 1, border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', fontSize: 12 }} />
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input value={manualOrderNumber} onChange={e => setManualOrderNumber(e.target.value)} placeholder="Ordernr (valfritt)" style={{ flex: 1, border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', fontSize: 12 }} />
                    <button type="submit" className="btn--plain btn--xs" disabled={!manualName.trim() || !manualCustomer.trim()} style={{ fontSize: 12, border: '1px solid #2563eb', color: '#1d4ed8', background: '#fff', padding: '6px 10px', borderRadius: 6 }}>Lägg till</button>
                  </div>
                  {manualError && <div style={{ fontSize: 11, color: '#b91c1c' }}>{manualError}</div>}
                  <div style={{ fontSize: 10, color: '#64748b' }}>Endast lokalt tills sparfunktion finns.</div>
                </form>
              </div>
            </div>

            {searchedProjects.length > 0 && (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: 14, margin: 0 }}>Sökresultat</h2>
                  <button type="button" className="btn--plain btn--xs" style={{ fontSize: 11 }} onClick={() => setRecentSearchedIds([])}>Rensa</button>
                </div>
                {searchedProjects.map(p => (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={e => onDragStart(e, p.id)}
                    onDragEnd={onDragEnd}
                    onClick={() => setSelectedProjectId(prev => prev === p.id ? null : p.id)}
                    style={{ position: 'relative', border: selectedProjectId === p.id ? '2px solid #6366f1' : '1px solid #6366f1', boxShadow: selectedProjectId === p.id ? '0 0 0 3px rgba(99,102,241,0.35)' : '0 0 0 3px rgba(99,102,241,0.25)', background: draggingId === p.id ? '#eef2ff' : '#ffffff', borderRadius: 8, padding: 10, cursor: 'grab', display: 'grid', gap: 4 }}>
                    <div style={{ position: 'absolute', top: -6, right: -6, background: '#6366f1', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 12 }}>Hittad</div>
                    {p.orderNumber && (egenkontrollOrderNumbers.has(p.orderNumber) || egenkontrollOrderNumbers.has(p.orderNumber.replace(/^0+/, '') || p.orderNumber)) && (
                      <div style={{ position: 'absolute', top: -6, left: -6, background: '#059669', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 12, boxShadow: '0 0 0 2px #fff' }} title="Egenkontroll finns">EK</div>
                    )}
                    <strong style={{ fontSize: 14 }}>
                      {p.orderNumber ? <span style={{ fontFamily: 'ui-monospace, monospace', background: '#eef2ff', color: '#312e81', padding: '2px 6px', borderRadius: 4, marginRight: 6, fontSize: 12, border: '1px solid #c7d2fe' }}>#{p.orderNumber}</span> : null}
                      {p.name}
                    </strong>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>{p.customer}</span>
                    {p.salesResponsible && <span style={{ fontSize: 10, color: '#475569', background: '#f1f5f9', padding: '2px 6px', borderRadius: 12, border: '1px solid #e2e8f0' }}>Sälj: {p.salesResponsible}</span>}
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>Skapad: {p.createdAt.slice(0, 10)}</span>
                  </div>
                ))}
                <hr style={{ border: 'none', height: 1, background: '#e5e7eb', margin: 0 }} />
              </div>
            )}

            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: 15, margin: 0 }}>Projekt</h2>
                <button className="btn--sm btn--primary" onClick={() => refreshInitialProjects(10)} disabled={projectsRefreshLoading} title="Uppdatera projekt">
                  {projectsRefreshLoading ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <SpinnerIcon size={14} />
                      Uppdaterar…
                    </span>
                  ) : (
                    <RefreshIcon size={16} />
                  )}
                </button>
              </div>
              {loading && <div style={{ fontSize: 12 }}>Laddar projekt…</div>}
              {!loading && backlog.length === 0 && <div style={{ fontSize: 12, color: '#64748b' }}>Inga fler oschemalagda.</div>}
              {filteredBacklog.map(p => {
                const accent = backlogAccent(p);
                const active = selectedProjectId === p.id;
                const hovered = hoverBacklogId === p.id;
                const baseBg = p.isManual ? '#f1f5f9' : '#ffffff';
                const elevated = draggingId === p.id || hovered || active;
                const gradient = `linear-gradient(135deg, ${accent}18, ${baseBg})`;
                return (
                  <div key={p.id}
                    draggable
                    onDragStart={e => onDragStart(e, p.id)}
                    onDragEnd={onDragEnd}
                    onMouseEnter={() => setHoverBacklogId(p.id)}
                    onMouseLeave={() => setHoverBacklogId(prev => prev === p.id ? null : prev)}
                    onClick={() => setSelectedProjectId(prev => prev === p.id ? null : p.id)}
                    style={{
                      position: 'relative',
                      border: active ? `2px solid ${accent}` : `1px solid ${p.isManual ? '#94a3b8' : '#e2e8f0'}`,
                      boxShadow: elevated ? `0 4px 10px -2px ${accent}55, 0 0 0 1px ${accent}40` : '0 1px 2px rgba(0,0,0,0.05)',
                      borderRadius: 10,
                      padding: '12px 12px 12px 14px',
                      background: elevated ? gradient : baseBg,
                      cursor: 'grab',
                      display: 'grid',
                      gap: 4,
                      transition: 'box-shadow 0.25s, transform 0.2s, background 0.3s, border 0.25s',
                      transform: elevated ? 'translateY(-2px)' : 'translateY(0)'
                    }}>
                    <span style={{ position: 'absolute', inset: 0, borderRadius: 10, pointerEvents: 'none', boxShadow: active ? `0 0 0 2px ${accent}` : 'none' }} />
                    <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, borderTopLeftRadius: 10, borderBottomLeftRadius: 10, background: accent, opacity: 0.9 }} />
                    {p.isManual && <span style={{ position: 'absolute', top: -7, left: 10, background: '#334155', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 12 }}>Manuell</span>}
                    {active && <span style={{ position: 'absolute', top: -7, right: 10, background: accent, color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 12 }}>Vald</span>}
                    {p.orderNumber && (egenkontrollOrderNumbers.has(p.orderNumber) || egenkontrollOrderNumbers.has(p.orderNumber.replace(/^0+/, '') || p.orderNumber)) && (
                      <span style={{ position: 'absolute', top: -7, left: p.isManual ? 70 : 10, background: '#059669', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 12 }}>EK</span>
                    )}
                    <strong style={{ fontSize: 14, lineHeight: 1.25, color: '#111827', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 4 }}>
                      {p.orderNumber && (
                        <span style={{ fontFamily: 'ui-monospace, monospace', background: '#ffffff', padding: '2px 6px', borderRadius: 4, fontSize: 12, border: `1px solid ${accent}55`, color: '#334155' }}>#{p.orderNumber}</span>
                      )}
                      <span>{p.name}</span>
                    </strong>
                    <div style={{ fontSize: 12, display: 'flex', gap: 6, flexDirection: 'column', alignItems: 'flex-start', color: '#475569' }}>
                      <span style={{ fontWeight: 500 }}>{p.customer}</span>
                      {p.salesResponsible && <span style={{ fontSize: 10, color: '#475569', background: '#f1f5f9', padding: '2px 6px', borderRadius: 12, border: '1px solid #e2e8f0' }}>Säljare: {p.salesResponsible}</span>}
                      <span style={{ fontSize: 10, color: '#64748b', background: '#f1f5f9', padding: '2px 6px', borderRadius: 12, border: '1px solid #e2e8f0' }}>Skapad {p.createdAt.slice(0, 10)}</span>
                    </div>
                  </div>
                );
              })}
              {selectedProjectId && <div style={{ fontSize: 11, color: '#b45309', background: '#fef3c7', border: '1px solid #fcd34d', padding: '4px 6px', borderRadius: 6 }}>Klicka på en dag i kalendern för att schemalägga vald projekt (fallback).</div>}
            </div>
          </div>
        )}

        {/* Calendar */}
  <div ref={calendarTopRef} style={{ display: 'grid', gap: 8 }}>
          <FiltersBar
            monthOffset={monthOffset}
            setMonthOffset={setMonthOffset}
            viewMode={viewMode}
            setViewMode={setViewMode}
            hideWeekends={hideWeekends}
            setHideWeekends={v => setHideWeekends(v)}
            refreshEgenkontroller={refreshEgenkontroller}
            egenkontrollLoading={egenkontrollLoading}
            egenkontrollError={egenkontrollError}
            egenkontrollCount={egenkontrollOrderNumbers.size}
            sidebarCollapsed={sidebarCollapsed}
            setSidebarCollapsed={setSidebarCollapsed}
            isAdmin={isAdmin}
            setAdminModalOpen={setAdminModalOpen}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, alignItems: 'stretch' }}>
            {trucks.map(tName => {
              const tRec = planningTrucks.find(pt => pt.name === tName);
              const c = truckColors[tName];
              const isOpen = hoveredTruck === tName || !!expandedTrucks[tName];
              if (!tRec) {
                // For legacy/default trucks without DB record, render compact only
                return (
                  <div key={tName}
                    style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', minWidth: 170 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 16, height: 16, background: c.bg, border: `3px solid ${c.border}`, borderRadius: 6 }} />
                      <span style={{ fontWeight: 700, color: c.text }}>{tName}</span>
                    </div>
                  </div>
                );
              }
              const teamNames = [tRec.team_member1_name, tRec.team_member2_name].filter(Boolean).join(', ');
              const depotName = (() => {
                const dep = depots.find(d => d.id === tRec.depot_id);
                return dep ? dep.name : 'Ingen';
              })();
              return (
                <div
                  key={tName}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onMouseEnter={() => setHoveredTruck(tName)}
                  onMouseLeave={() => setHoveredTruck(prev => (prev === tName ? null : prev))}
                  onFocus={() => setHoveredTruck(tName)}
                  onBlur={() => setHoveredTruck(prev => (prev === tName ? null : prev))}
                  onClick={() => setExpandedTrucks(prev => ({ ...prev, [tName]: !prev[tName] }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedTrucks(prev => ({ ...prev, [tName]: !prev[tName] })); } }}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 4,
                    padding: '8px 10px',
                    border: `1px solid ${isOpen ? '#cbd5e1' : '#e5e7eb'}`,
                    borderRadius: 10,
                    background: '#fff',
                    minWidth: 180,
                    boxShadow: isOpen ? '0 6px 16px rgba(2,6,23,0.06)' : 'none',
                    transition: 'box-shadow 150ms ease, border-color 150ms ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 16, height: 16, background: c.bg, border: `3px solid ${c.border}`, borderRadius: 6 }} />
                    <span style={{ fontWeight: 700, color: c.text }}>{tName}</span>
                    <span aria-hidden style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{isOpen ? '▲' : '▼'}</span>
                  </div>
                  <div aria-hidden={!isOpen} style={{
                    overflow: 'hidden',
                    maxHeight: isOpen ? 200 : 0,
                    opacity: isOpen ? 1 : 0,
                    transition: 'max-height 200ms ease, opacity 150ms ease',
                    display: 'grid', gap: 6, paddingTop: isOpen ? 6 : 0
                  }}>
                    <div style={{ fontSize: 12, color: '#475569' }}>
                      <span style={{ fontWeight: 600, color: '#374151' }}>Team: </span>
                      {teamNames || 'Ej tilldelad'}
                    </div>
                    <div style={{ fontSize: 12, color: '#475569' }}>
                      <span style={{ fontWeight: 600, color: '#374151' }}>Depå: </span>
                      {depotName}
                    </div>
                  </div>
                </div>
              );
            })}
            {isAdmin && showInlineAdminPanels && (
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '6px 8px', border: '1px dashed #94a3b8', borderRadius: 10, background: '#f8fafc', minWidth: 140 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#475569' }}>
                  <span style={{ width: 14, height: 14, background: '#fff', border: '2px dashed #94a3b8', borderRadius: 4 }} /> Ingen
                </div>
                <form onSubmit={e => { e.preventDefault(); createTruck(); }} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input value={newTruckName} onChange={e => { setTruckCreateError(''); setNewTruckName(e.target.value); }} placeholder="Ny lastbil" disabled={isCreatingTruck} style={{ fontSize: 11, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ fontSize: 11, color: '#475569', display: 'inline-block', width: 'auto' }}>Depå:</label>
                    <select value={newTruckDepotId} onChange={e => { setTruckCreateError(''); setNewTruckDepotId(e.target.value); }} disabled={isCreatingTruck} style={{ width: 160, fontSize: 11, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff' }}>
                      <option value="">Välj depå (valfritt)</option>
                      {depots.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  {truckCreateError && <div style={{ fontSize: 11, color: '#b91c1c' }}>{truckCreateError}</div>}
                  <button type="submit" disabled={!newTruckName.trim() || isCreatingTruck} className="btn--plain btn--xs" style={{ fontSize: 11, background: '#e0f2fe', border: '1px solid #7dd3fc', color: '#0369a1', borderRadius: 6, padding: '4px 6px' }}>{isCreatingTruck ? 'Lägger till…' : 'Lägg till'}</button>
                </form>
              </div>
            )}
          </div>
          {/* Depå overview + Leveranser as cards */}
          {(depots.length > 0 || upcomingDeliveriesForView.length > 0) && (
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start', marginTop: 6 }}>
              {depots.length > 0 && (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, background: '#ffffff' }}>
                  <button type="button" onClick={() => setDepotsCollapsed(v => !v)} aria-expanded={!depotsCollapsed}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Depåer</div>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>Från idag</span>
                    </div>
                    <span aria-hidden style={{ fontSize: 12, color: '#64748b' }}>{depotsCollapsed ? '▼' : '▲'}</span>
                  </button>
                  <div aria-hidden={depotsCollapsed} style={{ display: depotsCollapsed ? 'none' : 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', padding: '8px' }}>
                    {depots.map(d => {
                      const planned = selectedWeekKey ? weeklyPlannedByDepot[d.id] : monthlyPlannedByDepot[d.id];
                      const eko = d.material_ekovilla_total ?? d.material_total ?? 0;
                      const vit = d.material_vitull_total ?? 0;
                      const risk = stockCheckByDepot[d.id];
                      const ekoRisk = risk?.Ekovilla && !risk.Ekovilla.ok ? `E -${risk.Ekovilla.needed} ${risk.Ekovilla.firstShortageDate}` : null;
                      const vitRisk = risk?.Vitull && !risk.Vitull.ok ? `V -${risk.Vitull.needed} ${risk.Vitull.firstShortageDate}` : null;
                      return (
                        <div key={d.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '8px 10px', background: '#fff', display: 'grid', gap: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{d.name}</div>
                            {(ekoRisk || vitRisk) && (
                              <span style={{ fontSize: 11, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', padding: '1px 6px', borderRadius: 999 }}>
                                Risk: {ekoRisk}{ekoRisk && vitRisk ? ' • ' : ''}{vitRisk}
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, color: '#047857', background: '#ecfdf5', border: '1px solid #6ee7b7', padding: '1px 7px', borderRadius: 999 }}>Ekovilla: {eko}</span>
                            <span style={{ fontSize: 11, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #93c5fd', padding: '1px 7px', borderRadius: 999 }}>Vitull: {vit}</span>
                            {planned && (planned.ekovilla > 0 || planned.vitull > 0) ? (
                              <span style={{ fontSize: 11, color: '#0369a1', background: '#f0f9ff', border: '1px solid #bae6fd', padding: '1px 7px', borderRadius: 999 }}>Plan: E {planned.ekovilla || 0} • V {planned.vitull || 0}</span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {upcomingDeliveriesForView.length > 0 && (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, background: '#ffffff' }}>
                  <button type="button" onClick={() => setDeliveriesCollapsed(v => !v)} aria-expanded={!deliveriesCollapsed}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Kommande leveranser</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>{upcomingDeliveriesForView.length}</span>
                      <span aria-hidden style={{ fontSize: 12, color: '#64748b' }}>{deliveriesCollapsed ? '▼' : '▲'}</span>
                    </div>
                  </button>
                  <div aria-hidden={deliveriesCollapsed} style={{ display: deliveriesCollapsed ? 'none' : 'grid', gap: 6, padding: '8px' }}>
                    {upcomingDeliveriesForView.map(d => {
                      const dep = depots.find(x => x.id === d.depot_id);
                      const depName = dep ? dep.name : 'Okänd depå';
                      const isEko = d.material_kind === 'Ekovilla';
                      const matStyle = isEko
                        ? { bg: '#ecfdf5', border: '#6ee7b7', text: '#047857' }
                        : { bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8' };
                      return (
                        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid #f1f5f9', borderRadius: 8, background: '#fff' }}>
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#334155', background: '#f8fafc', border: '1px solid #e5e7eb', padding: '1px 6px', borderRadius: 6 }}>{d.delivery_date}</span>
                          <span style={{ color: '#64748b' }}>•</span>
                          <span style={{ fontSize: 12, color: '#111827' }}>{depName}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: matStyle.text as any, background: matStyle.bg as any, border: `1px solid ${matStyle.border}`, padding: '1px 7px', borderRadius: 999 }}>{d.material_kind} × {d.amount} säckar</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* (Removed duplicate corrupt admin depot panel block) */}

          {/* Filters below truck cards */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 10, background: '#ffffff' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#374151', display: 'inline-block', width: 'auto' }}>Sök i kalender:</label>
              <input value={calendarSearch} onChange={e => setCalendarSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (calendarMatchDays.length > 0) navigateToMatch((matchIndex + 1) % calendarMatchDays.length); } }} style={{ width: 190, border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 6px', fontSize: 12 }} placeholder="#1234 eller namn" />
              {calendarSearch && <button type="button" className="btn--plain btn--xs" style={{ fontSize: 11 }} onClick={() => setCalendarSearch('')}>X</button>}
              <button type="button" className="btn--plain btn--xs" disabled={!firstCalendarMatchDay} onClick={jumpToFirstMatch} style={{ fontSize: 11, border: '1px solid #d1d5db', borderRadius: 6, padding: '2px 8px', background: firstCalendarMatchDay ? '#fff' : '#f3f4f6', opacity: firstCalendarMatchDay ? 1 : 0.5 }}>Hoppa</button>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#374151', display: 'inline-block', width: 'auto' }}>Visa vecka:</label>
              <select value={selectedWeekKey} onChange={e => setSelectedWeekKey(e.target.value)} style={{ width: 200, fontSize: 12, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff' }}>
                <option value="">Alla veckor</option>
                {weekOptions.map(o => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
              {selectedWeekKey && <button type="button" className="btn--plain btn--xs" style={{ fontSize: 11 }} onClick={() => setSelectedWeekKey('')}>Rensa</button>}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', position: 'relative' }} ref={truckFilterRef}>
              <label style={{ fontSize: 12, color: '#374151' }}>Lastbil(er):</label>
              <button type="button" onClick={() => setTruckFilterOpen(o => !o)} aria-haspopup="true" aria-expanded={truckFilterOpen}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', minWidth: 200 }}>
                {(!allSelected && truckFilters.length === 1) && (() => { const t = truckFilters[0]; const swc = t === 'UNASSIGNED' ? '#94a3b8' : (truckColors[t]?.border || '#94a3b8'); const sw: React.CSSProperties = { width: 12, height: 12, borderRadius: 4, border: `2px solid ${swc}`, background: '#fff' }; return <span aria-hidden style={sw} />; })()}
                <span style={{ fontWeight: 600, color: '#111827' }}>{summaryLabel}</span>
                <span style={{ fontSize: 10, color: '#64748b' }}>{truckFilterOpen ? '▲' : '▼'}</span>
              </button>
              {truckFilters.length > 0 && (
                <button type="button" className="btn--plain btn--xs" onClick={() => setTruckFilters([])} style={{ fontSize: 11 }}>Rensa</button>
              )}
              {truckFilterOpen && (
                <div role="menu" aria-label="Välj lastbilar" style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 50, minWidth: 240, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 6px 16px rgba(0,0,0,0.18)', padding: 8, display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>Filtrera lastbilar</span>
                    <button type="button" className="btn--plain btn--xs" onClick={() => setTruckFilterOpen(false)} style={{ fontSize: 10 }}>Stäng</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={truckFilters.includes('UNASSIGNED')} onChange={() => toggleTruck('UNASSIGNED')} />
                      {(() => { const sw: React.CSSProperties = { width: 12, height: 12, borderRadius: 4, border: '2px solid #94a3b8', background: '#fff' }; return <span aria-hidden style={sw} />; })()}
                      <span style={{ flex: 1 }}>(Ingen lastbil)</span>
                      {truckFilters.includes('UNASSIGNED') && <span style={{ fontSize: 10, color: '#047857' }}>✓</span>}
                    </label>
                    {trucks.map(t => (
                      <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={truckFilters.includes(t)} onChange={() => toggleTruck(t)} />
                        {(() => { const swc = truckColors[t]?.border || '#94a3b8'; const sw: React.CSSProperties = { width: 12, height: 12, borderRadius: 4, border: `2px solid ${swc}`, background: '#fff' }; return <span aria-hidden style={sw} />; })()}
                        <span style={{ flex: 1 }}>{t}</span>
                        {truckFilters.includes(t) && <span style={{ fontSize: 10, color: '#047857' }}>✓</span>}
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4, borderTop: '1px solid #f1f5f9' }}>
                    <button type="button" className="btn--plain btn--xs" onClick={() => setTruckFilters([])} style={{ fontSize: 11, background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px' }}>Alla</button>
                    <button type="button" className="btn--plain btn--xs" onClick={() => setTruckFilterOpen(false)} style={{ fontSize: 11, background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#047857', borderRadius: 6, padding: '4px 8px' }}>Klar</button>
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#374151', display: 'inline-block', width: 'auto' }}>Sälj:</label>
              <select value={salesFilter} onChange={e => setSalesFilter(e.target.value)} style={{ width: 190, fontSize: 12, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff' }}>
                <option value="">Alla</option>
                <option value="__NONE__">(Ingen)</option>
                {distinctSales.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {salesFilter && <button type="button" className="btn--plain btn--xs" style={{ fontSize: 11 }} onClick={() => setSalesFilter('')}>Rensa</button>}
            </div>
          </div>

          {/* Admin settings modal */}
          {isAdmin && adminModalOpen && (
            <div role="dialog" aria-modal="true" aria-label="Admin-inställningar" onClick={() => setAdminModalOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
              <div onClick={e => e.stopPropagation()} style={{ width: 'min(100%, 980px)', maxHeight: '85vh', overflow: 'auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setAdminModalTab('trucks')} style={{ padding: '6px 10px', border: '1px solid ' + (adminModalTab === 'trucks' ? '#111827' : '#e5e7eb'), borderRadius: 8, background: adminModalTab === 'trucks' ? '#111827' : '#fff', color: adminModalTab === 'trucks' ? '#fff' : '#111827', fontSize: 13, fontWeight: 600 }}>Lastbilar</button>
                    <button onClick={() => setAdminModalTab('depots')} style={{ padding: '6px 10px', border: '1px solid ' + (adminModalTab === 'depots' ? '#111827' : '#e5e7eb'), borderRadius: 8, background: adminModalTab === 'depots' ? '#111827' : '#fff', color: adminModalTab === 'depots' ? '#fff' : '#111827', fontSize: 13, fontWeight: 600 }}>Depåer</button>
                    <button onClick={() => setAdminModalTab('deliveries')} style={{ padding: '6px 10px', border: '1px solid ' + (adminModalTab === 'deliveries' ? '#111827' : '#e5e7eb'), borderRadius: 8, background: adminModalTab === 'deliveries' ? '#111827' : '#fff', color: adminModalTab === 'deliveries' ? '#fff' : '#111827', fontSize: 13, fontWeight: 600 }}>Leveranser</button>
                    <button onClick={() => setAdminModalTab('jobtypes')} style={{ padding: '6px 10px', border: '1px solid ' + (adminModalTab === 'jobtypes' ? '#111827' : '#e5e7eb'), borderRadius: 8, background: adminModalTab === 'jobtypes' ? '#111827' : '#fff', color: adminModalTab === 'jobtypes' ? '#fff' : '#111827', fontSize: 13, fontWeight: 600 }}>Jobbtyper</button>
                  </div>
                  <button onClick={() => setAdminModalOpen(false)} className="btn--plain" aria-label="Stäng" style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 10px', background: '#fff' }}>Stäng</button>
                </div>
                <div style={{ padding: 14, display: 'grid', gap: 12 }}>
                  {adminModalTab === 'trucks' && (
                    <div style={{ display: 'grid', gap: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                        {[...planningTrucks].sort((a, b) => a.name.localeCompare(b.name, 'sv')).map(tRec => {
                          const currentColor = truckColorOverrides[tRec.name] || tRec.color || defaultTruckColors[tRec.name] || '#6366f1';
                          const edit = editingTeamNames[tRec.id] || { team1: tRec.team_member1_name || '', team2: tRec.team_member2_name || '', team1Id: tRec.team1_id || null, team2Id: tRec.team2_id || null };
                          const changed = (
                            edit.team1 !== (tRec.team_member1_name || '') ||
                            edit.team2 !== (tRec.team_member2_name || '') ||
                            ((edit as any).team1Id ?? null) !== (tRec.team1_id ?? null) ||
                            ((edit as any).team2Id ?? null) !== (tRec.team2_id ?? null)
                          );
                          const status = truckSaveStatus[tRec.id];
                          return (
                            <div key={tRec.id} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ width: 16, height: 16, background: currentColor, border: '3px solid #cbd5e1', borderRadius: 6 }} />
                                <input
                                  value={editingTruckNames[tRec.id] ?? tRec.name}
                                  onChange={e => setEditingTruckNames(prev => ({ ...prev, [tRec.id]: e.target.value }))}
                                  placeholder="Namn på lastbil"
                                  style={{ flex: '1 1 200px', minWidth: 140, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }}
                                />
                                <button
                                  type="button"
                                  className="btn--plain btn--xs"
                                  onClick={() => updateTruckName(tRec, editingTruckNames[tRec.id] ?? tRec.name)}
                                  disabled={(editingTruckNames[tRec.id] ?? tRec.name).trim() === tRec.name || truckNameStatus[tRec.id] === 'saving'}
                                  style={{ fontSize: 12, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }}
                                >
                                  {truckNameStatus[tRec.id] === 'saving' ? 'Sparar…' : 'Spara namn'}
                                </button>
                                {truckNameStatus[tRec.id] === 'saved' && <span style={{ fontSize: 12, color: '#059669' }}>✓</span>}
                                {truckNameErrors[tRec.id] && <span style={{ fontSize: 12, color: '#b91c1c' }}>{truckNameErrors[tRec.id]}</span>}
                                <input type="color" value={currentColor as string} onChange={e => updateTruckColor(tRec, e.target.value)} style={{ marginLeft: 'auto', width: 28, height: 28, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff' }} />
                              </div>
                              <div style={{ display: 'grid', gap: 8 }}>
                                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                                  <span>Team leader</span>
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <select
                                      value={edit.team1Id || tRec.team1_id || ''}
                                      onChange={e => { const val = e.target.value || null; updateTruckTeamId(tRec, 1, val); const nm = crewList.find(c => c.id === val)?.name || ''; if (nm) updateTruckTeamName(tRec, 1, nm); }}
                                      style={{ flex: 1, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }}
                                    >
                                      <option value="">Ej tilldelad</option>
                                      {crewList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                    <span style={{ fontSize: 11, color: '#6b7280' }}>{(edit.team1 ?? tRec.team_member1_name) || ''}</span>
                                  </div>
                                </label>
                                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                                  <span>personal</span>
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <select
                                      value={edit.team2Id || tRec.team2_id || ''}
                                      onChange={e => { const val = e.target.value || null; updateTruckTeamId(tRec, 2, val); const nm = crewList.find(c => c.id === val)?.name || ''; if (nm) updateTruckTeamName(tRec, 2, nm); }}
                                      style={{ flex: 1, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }}
                                    >
                                      <option value="">Ej tilldelad</option>
                                      {crewList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                    <span style={{ fontSize: 11, color: '#6b7280' }}>{(edit.team2 ?? tRec.team_member2_name) || ''}</span>
                                  </div>
                                </label>
                                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                                  <span>Depå</span>
                                  <select value={tRec.depot_id || ''} onChange={e => updateTruckDepot(tRec, e.target.value || null)} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                                    <option value="">Ingen depå</option>
                                    {depots.map(d => (<option key={d.id} value={d.id}>{d.name}</option>))}
                                  </select>
                                </label>
                              </div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <button type="button" disabled={!changed || status?.status === 'saving'} onClick={() => saveTruckTeamNames(tRec)} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }}>Spara</button>
                                <button type="button" onClick={() => { if (typeof window !== 'undefined') { const ok = window.confirm(`Ta bort lastbil \"${tRec.name}\"?`); if (!ok) return; } deleteTruck(tRec); }} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '6px 8px', border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', borderRadius: 8 }}>Ta bort</button>
                                {status?.status === 'saving' && <span style={{ fontSize: 12, color: '#64748b' }}>Sparar…</span>}
                                {status?.status === 'saved' && <span style={{ fontSize: 12, color: '#059669' }}>✓ Sparad</span>}
                                {status?.status === 'error' && <span style={{ fontSize: 12, color: '#b91c1c' }}>Fel</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ paddingTop: 6, borderTop: '1px dashed #e5e7eb' }}>
                        <form onSubmit={e => { e.preventDefault(); createTruck(); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <input value={newTruckName} onChange={e => { setTruckCreateError(''); setNewTruckName(e.target.value); }} placeholder="Ny lastbil" disabled={isCreatingTruck} style={{ minWidth: 220, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                          <select value={newTruckDepotId} onChange={e => { setTruckCreateError(''); setNewTruckDepotId(e.target.value); }} disabled={isCreatingTruck} style={{ minWidth: 200, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                            <option value="">Välj depå (valfritt)</option>
                            {depots.map(d => (<option key={d.id} value={d.id}>{d.name}</option>))}
                          </select>
                          {truckCreateError && <div style={{ fontSize: 12, color: '#b91c1c' }}>{truckCreateError}</div>}
                          <button type="submit" disabled={!newTruckName.trim() || isCreatingTruck} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #7dd3fc', background: '#e0f2fe', color: '#0369a1', borderRadius: 8 }}>{isCreatingTruck ? 'Lägger till…' : 'Lägg till'}</button>
                        </form>
                      </div>
                    </div>
                  )}
                  {adminModalTab === 'depots' && (
                    <div style={{ display: 'grid', gap: 12 }}>
                      <form onSubmit={createDepot} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input value={newDepotName} onChange={e => setNewDepotName(e.target.value)} placeholder="Ny depå" style={{ minWidth: 240, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                        <button type="submit" disabled={!newDepotName.trim()} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #7dd3fc', background: '#e0f2fe', color: '#0369a1', borderRadius: 8 }}>Lägg till</button>
                      </form>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {depots.map(dep => {
                          const edit = depotEdits[dep.id] || {};
                          const ekoVal = edit.material_ekovilla_total ?? (dep.material_ekovilla_total == null ? '' : String(dep.material_ekovilla_total));
                          const vitVal = edit.material_vitull_total ?? (dep.material_vitull_total == null ? '' : String(dep.material_vitull_total));
                          const saveBoth = () => upsertDepotTotals(dep.id, ekoVal, vitVal);
                          return (
                            <div key={dep.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', alignItems: 'center', gap: 10, padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                              <div style={{ fontWeight: 600 }}>{dep.name}</div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <label style={{ fontSize: 12 }}>Eko</label>
                                <input inputMode="numeric" pattern="[0-9]*" value={ekoVal} onChange={e => setDepotEdits(prev => ({ ...prev, [dep.id]: { ...prev[dep.id], material_ekovilla_total: e.target.value } }))} onBlur={saveBoth} placeholder="Antal" style={{ width: 90, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                              </div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <label style={{ fontSize: 12 }}>Vit</label>
                                <input inputMode="numeric" pattern="[0-9]*" value={vitVal} onChange={e => setDepotEdits(prev => ({ ...prev, [dep.id]: { ...prev[dep.id], material_vitull_total: e.target.value } }))} onBlur={saveBoth} placeholder="Antal" style={{ width: 90, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                              </div>
                              <button type="button" onClick={() => deleteDepot(dep)} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', borderRadius: 8 }}>Ta bort</button>
                            </div>
                          );
                        })}
                        {depots.length === 0 && <div style={{ color: '#6b7280' }}>Inga depåer</div>}
                      </div>
                    </div>
                  )}
                  {adminModalTab === 'deliveries' && (
                    <div style={{ display: 'grid', gap: 12 }}>
                      <div style={{ display: 'grid', gap: 8, padding: '8px 10px', border: '1px dashed #cbd5e1', borderRadius: 10, background: '#f8fafc' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>Planera leverans</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(160px, 1fr))', gap: 8, alignItems: 'center' }}>
                          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                            <span>Depå</span>
                            <select value={newDelivery.depotId} onChange={e => setNewDelivery(prev => ({ ...prev, depotId: e.target.value }))} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                              <option value="">Välj depå</option>
                              {depots.map(d => (<option key={d.id} value={d.id}>{d.name}</option>))}
                            </select>
                          </label>
                          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                            <span>Material</span>
                            <select value={newDelivery.materialKind} onChange={e => setNewDelivery(prev => ({ ...prev, materialKind: e.target.value as any }))} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                              <option value="Ekovilla">Ekovilla</option>
                              <option value="Vitull">Vitull</option>
                            </select>
                          </label>
                          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                            <span>Antal</span>
                            <input inputMode="numeric" pattern="[0-9]*" value={newDelivery.amount} onChange={e => setNewDelivery(prev => ({ ...prev, amount: e.target.value }))} placeholder="t.ex. 30" style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                          </label>
                          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                            <span>Datum</span>
                            <input type="date" value={newDelivery.date} onChange={e => setNewDelivery(prev => ({ ...prev, date: e.target.value }))} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                          </label>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <button type="button" onClick={createPlannedDelivery} disabled={savingDelivery === 'saving'} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #16a34a', background: '#dcfce7', color: '#166534', borderRadius: 8 }}>Spara leverans</button>
                          {savingDelivery === 'saving' && <span style={{ fontSize: 12, color: '#64748b' }}>Sparar…</span>}
                          {savingDelivery === 'saved' && <span style={{ fontSize: 12, color: '#059669' }}>✓ Sparad</span>}
                          {savingDelivery === 'error' && <span style={{ fontSize: 12, color: '#b91c1c' }}>Fel</span>}
                        </div>
                      </div>
                      <div style={{ display: 'grid', gap: 10 }}>
                        <div style={{ fontWeight: 700 }}>Kommande leveranser</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                setSavingDelivery('saving');
                                const { data, error } = await supabase.rpc('apply_due_deliveries');
                                if (error) { console.warn('[deliveries] apply_due_deliveries error', error); setSavingDelivery('error'); return; }
                                console.debug('[deliveries] applied count', data);
                                // Refresh depots & deliveries from server to reflect new totals / processed flags
                                await (async () => {
                                  try {
                                    const { data: depRows } = await supabase.from('planning_depots').select('*').order('name');
                                    if (Array.isArray(depRows)) setDepots(depRows as any);
                                  } catch (e) { /* ignore */ }
                                  try {
                                    const { data: delRows } = await supabase.from('planning_depot_deliveries').select('*').order('delivery_date');
                                    if (Array.isArray(delRows)) setDeliveries(delRows as any);
                                  } catch (e) { /* ignore */ }
                                })();
                                setSavingDelivery('saved');
                                setTimeout(() => setSavingDelivery('idle'), 1200);
                              } catch (e) {
                                console.warn('[deliveries] apply_due_deliveries exception', e);
                                setSavingDelivery('error');
                              }
                            }}
                            className="btn--plain btn--xs"
                            style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #16a34a', background: '#16a34a', color: '#fff', borderRadius: 8, boxShadow: '0 2px 4px rgba(16,185,129,0.4)' }}
                          >
                            Tillämpa dagens leveranser
                          </button>
                          <span style={{ fontSize: 11, color: '#64748b' }}>Lägger till alla leveranser med datum idag eller tidigare i depålager en gång.</span>
                        </div>
                        {groupedDeliveries.length === 0 && (
                          <div style={{ color: '#6b7280' }}>Inga planerade leveranser</div>
                        )}
                        {groupedDeliveries.map(group => {
                          const dep = depots.find(d => d.id === group.depotId);
                          const header = `${group.date} • ${dep ? dep.name : 'Okänd depå'} • ${group.material}`;
                          return (
                            <div key={`${group.depotId}|${group.date}|${group.material}`} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 8, background: '#fff', display: 'grid', gap: 6 }}>
                              <div style={{ fontWeight: 600 }}>{header}</div>
                              <div style={{ display: 'grid', gap: 6 }}>
                                {group.items.map(item => {
                                  const edit = editingDeliveries[item.id] || { depotId: item.depot_id, materialKind: item.material_kind, amount: String(item.amount), date: item.delivery_date };
                                  return (
                                    <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'center' }}>
                                      <select value={edit.depotId} onChange={e => setEditingDeliveries(prev => ({ ...prev, [item.id]: { ...edit, depotId: e.target.value } }))} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                                        {depots.map(d => (<option key={d.id} value={d.id}>{d.name}</option>))}
                                      </select>
                                      <select value={edit.materialKind} onChange={e => setEditingDeliveries(prev => ({ ...prev, [item.id]: { ...edit, materialKind: e.target.value as any } }))} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                                        <option value="Ekovilla">Ekovilla</option>
                                        <option value="Vitull">Vitull</option>
                                      </select>
                                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <input inputMode="numeric" pattern="[0-9]*" value={edit.amount} onChange={e => setEditingDeliveries(prev => ({ ...prev, [item.id]: { ...edit, amount: e.target.value } }))} style={{ width: 80, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                                        <input type="date" value={edit.date} onChange={e => setEditingDeliveries(prev => ({ ...prev, [item.id]: { ...edit, date: e.target.value } }))} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                                      </div>
                                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                        <button type="button" onClick={() => updatePlannedDelivery(item.id)} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8 }}>Spara</button>
                                        <button type="button" onClick={() => deletePlannedDelivery(item.id)} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', borderRadius: 8 }}>Ta bort</button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {adminModalTab === 'jobtypes' && (
                    <div style={{ display: 'grid', gap: 12 }}>
                      <AdminJobTypes />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {viewMode === 'monthGrid' && (
            <CalendarMonthGrid
              weeks={weeks}
              visibleDayNames={visibleDayNames}
              hideWeekends={hideWeekends}
              selectedWeekKey={selectedWeekKey}
              itemsByDay={itemsByDay as any}
              trucks={trucks}
              truckColors={truckColors}
              calendarSearch={calendarSearch}
              truckFilters={truckFilters}
              salesFilter={salesFilter}
              jumpTargetDay={jumpTargetDay}
              todayISO={todayISO}
              selectedProjectId={selectedProjectId}
              scheduledSegments={scheduledSegments as any}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropDay={onDropDay}
              allowDrop={allowDrop}
              scheduleSelectedOnDay={scheduleSelectedOnDay}
              openSegmentEditorForExisting={openSegmentEditorForExisting}
              setHoveredSegmentId={setHoveredSegmentId}
              hoveredSegmentId={hoveredSegmentId}
              setSelectedProjectId={(pid: string) => setSelectedProjectId(pid)}
              hasEgenkontroll={hasEgenkontroll}
              rowCreatorLabel={rowCreatorLabel}
              renderCreatorAvatar={(segmentId: string) => <CreatorAvatar segmentId={segmentId} size="sm" />}
              scheduleMeta={scheduleMeta as any}
              jobTypeColors={jobTypeColors}
              projectAddresses={projectAddresses}
              segmentCrew={segmentCrew}
              remainingBagsByProject={remainingBagsByProject}
              bagUsageStatusByProject={bagUsageStatusByProject}
            />
          )}

          {viewMode === 'weekdayLanes' && (
            <CalendarWeekdayLanes
              visibleDayNames={visibleDayNames}
              visibleDayIndices={visibleDayIndices}
              weekdayLanes={weekdayLanes as any}
              itemsByDay={itemsByDay as any}
              trucks={trucks}
              truckColors={truckColors}
              calendarSearch={calendarSearch}
              truckFilters={truckFilters}
              salesFilter={salesFilter}
              jumpTargetDay={jumpTargetDay}
              todayISO={todayISO}
              selectedProjectId={selectedProjectId}
              scheduledSegments={scheduledSegments as any}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropDay={onDropDay}
              allowDrop={allowDrop}
              scheduleSelectedOnDay={scheduleSelectedOnDay}
              openSegmentEditorForExisting={openSegmentEditorForExisting}
              setHoveredSegmentId={setHoveredSegmentId}
              hoveredSegmentId={hoveredSegmentId}
              setSelectedProjectId={(pid: string) => setSelectedProjectId(pid)}
              hasEgenkontroll={hasEgenkontroll}
              rowCreatorLabel={rowCreatorLabel}
              renderCreatorAvatar={(segmentId: string) => <CreatorAvatar segmentId={segmentId} size="sm" />}
              selectedWeekKey={selectedWeekKey}
              scheduleMeta={scheduleMeta as any}
              jobTypeColors={jobTypeColors}
              projectAddresses={projectAddresses}
              segmentCrew={segmentCrew}
              remainingBagsByProject={remainingBagsByProject}
              bagUsageStatusByProject={bagUsageStatusByProject}
            />
          )}

          {viewMode === 'dayList' && (
            <CalendarDayList
              weeks={weeks}
              dayNames={dayNames}
              hideWeekends={hideWeekends}
              itemsByDay={itemsByDay as any}
              trucks={trucks}
              truckColors={truckColors}
              calendarSearch={calendarSearch}
              truckFilters={truckFilters}
              salesFilter={salesFilter}
              todayISO={todayISO}
              selectedWeekKey={selectedWeekKey}
              scheduledSegments={scheduledSegments as any}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropDay={onDropDay}
              allowDrop={allowDrop}
              scheduleSelectedOnDay={scheduleSelectedOnDay}
              openSegmentEditorForExisting={openSegmentEditorForExisting}
              setHoveredSegmentId={setHoveredSegmentId}
              hoveredSegmentId={hoveredSegmentId}
              setSelectedProjectId={(pid: string) => setSelectedProjectId(pid)}
              selectedProjectId={selectedProjectId}
              hasEgenkontroll={hasEgenkontroll}
              rowCreatorLabel={rowCreatorLabel}
              renderCreatorAvatar={(segmentId: string) => <CreatorAvatar segmentId={segmentId} size="sm" />}
              jumpTargetDay={jumpTargetDay}
              scheduleMeta={scheduleMeta as any}
              truckTeamNames={truckTeamNames}
              jobTypeColors={jobTypeColors}
              projectAddresses={projectAddresses}
              segmentCrew={segmentCrew}
              remainingBagsByProject={remainingBagsByProject}
              bagUsageStatusByProject={bagUsageStatusByProject}
            />
          )}
        </div>
        {/* Floating next-month button (always mounted for animation) */}
        {!selectedWeekKey && (
          <button
            type="button"
            onClick={jumpToNextMonth}
            aria-label="Gå till nästa månad"
            title="Gå till nästa månad"
            style={{
              position: 'fixed',
              bottom: 24,
              left: '50%',
              zIndex: 2000,
              background: '#1d4ed8',
              color: '#fff',
              border: '1px solid #1e40af',
              borderRadius: 999,
              padding: '12px 18px',
              fontSize: 14,
              fontWeight: 600,
              boxShadow: showNextMonthShortcut ? '0 6px 16px rgba(0,0,0,0.25)' : '0 2px 6px rgba(0,0,0,0.15)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              opacity: showNextMonthShortcut ? 1 : 0,
              transform: showNextMonthShortcut ? 'translateY(0)' : 'translateY(12px)',
              pointerEvents: showNextMonthShortcut ? 'auto' : 'none',
              transition: 'opacity .35s ease, transform .35s ease, box-shadow .35s ease, background .2s ease'
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#2563eb'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#1d4ed8'; }}
          >
            Nästa månad →
          </button>
        )}
        {/* Bottom sentinel for IntersectionObserver trigger */}
        <div ref={bottomSentinelRef} aria-hidden style={{ height: 1, width: '100%' }} />
      </div>
    </div>
  );
}
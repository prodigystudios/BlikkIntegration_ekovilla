"use client";
export const dynamic = 'force-dynamic';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
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

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
// Format date in local time (avoid UTC shift that caused off-by-one day issues)
function fmtDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function PlanneringPage() {
  // Loading/data
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
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
  const [truckFilter, setTruckFilter] = useState<string>('');
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
  // Derived list of truck names for existing logic
  const trucks = planningTrucks.length ? planningTrucks.map(t => t.name) : defaultTrucks;
  const [isAdmin, setIsAdmin] = useState(false);
  const [newTruckName, setNewTruckName] = useState('');
  const [newTruckDepotId, setNewTruckDepotId] = useState<string>('');
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

  // Fallback selection scheduling (if drag/drop misbehaves)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  // View mode: standard month grid or weekday lanes (all Mondays in a row, etc.)
  const [viewMode, setViewMode] = useState<'monthGrid' | 'weekdayLanes' | 'dayList'>('monthGrid');
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
  }
  const [segEditorOpen, setSegEditorOpen] = useState(false);
  const [segEditor, setSegEditor] = useState<SegmentEditorDraft | null>(null);
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
  // UI hover state for backlog punch effect
  const [hoverBacklogId, setHoverBacklogId] = useState<string | null>(null);

  // Missing state (reintroduced after earlier cleanup)
  const [truckColorOverrides, setTruckColorOverrides] = useState<Record<string, string>>({});
  const [editingTeamNames, setEditingTeamNames] = useState<Record<string, { team1: string; team2: string; team1Id?: string | null; team2Id?: string | null }>>({});
  const [truckSaveStatus, setTruckSaveStatus] = useState<Record<string, { status: 'idle' | 'saving' | 'saved' | 'error'; ts: number }>>({});

  // Admin config modal (to declutter main page)
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminModalTab, setAdminModalTab] = useState<'trucks' | 'depots' | 'deliveries'>('trucks');
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
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting'|'live'|'error'>('connecting');
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
    let attempt = 0;
    while (attempt < 3) {
      attempt++;
      const res = await fetch(`/api/blikk/contacts/${customerId}`);
      if (res.status === 404) return null;
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
        return null;
      }
      const j = await res.json();
      const email = j?.contact?.email || j?.contact?.emailCandidates?.[0] || null;
      return email || null;
    }
    return null;
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
  const openProjectModal = useCallback(async (projectId: string) => {
    setDetailOpen(true);
    setDetailProjectId(projectId);
    setDetailError(null);
    const base = projects.find(p => p.id === projectId);
    const fetchViaLookup = async (): Promise<any | null> => {
      try {
        // Prefer order number query (Blikk uses it commonly); fallback to ID if numeric
        if (base?.orderNumber) {
          const r = await fetch(`/api/projects/lookup?orderId=${encodeURIComponent(base.orderNumber)}`);
          const j = await r.json();
          if (r.ok) return { source: 'lookup:order', project: j };
        }
        const idNum = Number(projectId);
        if (Number.isFinite(idNum) && idNum > 0) {
          const r = await fetch(`/api/projects/lookup?id=${idNum}`);
          const j = await r.json();
          if (r.ok) return { source: 'lookup:id', project: j };
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
    } catch (e: any) {
      setDetailError(String(e?.message || e));
    } finally {
      setDetailLoading(false);
    }
  }, [detailCache, projects]);
  const closeProjectModal = useCallback(() => { setDetailOpen(false); setDetailProjectId(null); setDetailError(null); }, []);

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
          setScheduledSegments(segs.map(s => ({ id: s.id, projectId: s.project_id, startDay: s.start_day, endDay: s.end_day, createdBy: s.created_by, createdByName: s.created_by_name, depotId: (s as any).depot_id ?? null, sortIndex: (s as any).sort_index ?? null })));
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
        }
        // Fetch complete sales/admin directory via internal API (service role backed)
        try {
          const dirRes = await fetch('/api/planning/sales-directory');
          if (dirRes.ok) {
            const j = await dirRes.json();
            const names: string[] = Array.isArray(j.users) ? j.users.map((u: any) => u.name).filter((v: any): v is string => typeof v === 'string' && v.trim().length > 0) : [];
            const trimmed = names.map(n => n.trim());
            const unique: string[] = Array.from(new Set(trimmed)).filter(n => n.length > 0).sort((a,b)=>a.localeCompare(b));
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
          setScheduledSegments(prev => prev.some(s => s.id === row.id) ? prev : [...prev, { id: row.id, projectId: row.project_id, startDay: row.start_day, endDay: row.end_day, createdBy: row.created_by, createdByName: row.created_by_name, depotId: row.depot_id ?? null, sortIndex: row.sort_index ?? null }]);
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
          setScheduledSegments(prev => prev.map(s => s.id === row.id ? { ...s, startDay: row.start_day, endDay: row.end_day, createdByName: row.created_by_name ?? s.createdByName, depotId: row.depot_id ?? s.depotId ?? null, sortIndex: row.sort_index ?? s.sortIndex ?? null } : s));
        } else if (payload.eventType === 'DELETE') {
          setScheduledSegments(prev => prev.filter(s => s.id !== row.id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_project_meta' }, payload => {
        const row: any = payload.new || payload.old;
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          setScheduleMeta(prev => ({ ...prev, [row.project_id]: {
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
          } }));
        } else if (payload.eventType === 'DELETE') {
          setScheduleMeta(prev => { const c = { ...prev }; delete c[row.project_id]; return c; });
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
    enqueue(supabase.from('planning_segments').update({ start_day: seg.startDay, end_day: seg.endDay }).eq('id', seg.id).select('id').then(({ data, error }) => { if (error) console.warn('[persist update seg] error', error); else console.debug('[planning] update ok', data); }));
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
      const { error } = await supabase.from('planning_depot_deliveries').insert(payload).select('id').single();
      if (error) { console.warn('[deliveries] create error', error); setSavingDelivery('error'); return; }
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
    try {
      const { error } = await supabase.from('planning_depot_deliveries').delete().eq('id', id);
      if (error) console.warn('[deliveries] delete error', error);
    } catch (err) {
      console.warn('[deliveries] delete exception', err);
    }
  }, [supabase]);

  const groupedDeliveries = useMemo(() => {
    const byKey: Record<string, { depotId: string; material: 'Ekovilla'|'Vitull'; date: string; items: typeof deliveries } > = {} as any;
    const sorted = [...deliveries].sort((a,b)=> (a.delivery_date||'').localeCompare(b.delivery_date||'') || (a.depot_id||'').localeCompare(b.depot_id||'') || (a.material_kind||'').localeCompare(b.material_kind||''));
    for (const d of sorted) {
      const key = `${d.depot_id}|${d.delivery_date}|${d.material_kind}`;
      if (!byKey[key]) byKey[key] = { depotId: d.depot_id, material: d.material_kind, date: d.delivery_date, items: [] as any };
      byKey[key].items.push(d as any);
    }
    return Object.values(byKey);
  }, [deliveries]);

  // Upcoming deliveries for current view (selected week or visible month)
  const upcomingDeliveriesForView = useMemo(() => {
    if (!deliveries || deliveries.length === 0) return [] as Array<{ id: string; depot_id: string; material_kind: 'Ekovilla'|'Vitull'; amount: number; delivery_date: string }>;
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
    inRange.sort((a,b)=> (a.delivery_date||'').localeCompare(b.delivery_date||'') || (a.depot_id||'').localeCompare(b.depot_id||'') || (a.material_kind||'').localeCompare(b.material_kind||''));
    // Limit to avoid clutter
    return inRange.slice(0, 12);
  }, [deliveries, selectedWeekKey, monthOffset]);

  // Truck helpers (admin guarded by RLS; UI also hides for non-admin)
  const createTruck = useCallback(async () => {
    const name = newTruckName.trim();
    if (!name) return;
    setNewTruckName('');
    const payload: any = { name };
    if (currentUserId) payload.created_by = currentUserId;
    if (newTruckDepotId) payload.depot_id = newTruckDepotId; else payload.depot_id = null;
    enqueue(
      supabase.from('planning_trucks')
        .insert(payload)
        .select('id,name')
        .then(({ data, error }) => {
          if (error) console.warn('[planning] createTruck error', error);
          else console.debug('[planning] createTruck ok', data);
          setNewTruckDepotId('');
        })
    );
  }, [newTruckName, supabase, currentUserId]);

  const updateTruckColor = useCallback((truck: TruckRec, color: string) => {
    setTruckColorOverrides(prev => ({ ...prev, [truck.name]: color }));
    enqueue(supabase.from('planning_trucks').update({ color }).eq('id', truck.id));
  }, [supabase]);

  const updateTruckDepot = useCallback((truck: TruckRec, depotId: string | null) => {
    setPlanningTrucks(prev => prev.map(t => t.id === truck.id ? { ...t, depot_id: depotId } : t));
    enqueue(supabase.from('planning_trucks').update({ depot_id: depotId }).eq('id', truck.id));
  }, [supabase]);

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
    const out: Array<Array<{ date: string | null; inMonth: boolean }>> = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [monthOffset]);

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
    return lanes;
  }, [viewMode, monthOffset]);

  // Linear list of each day (for 'dayList' view)
  const daysOfMonth = useMemo(() => {
    if (viewMode !== 'dayList') return [] as string[];
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const start = startOfMonth(base);
    const end = endOfMonth(base);
    const out: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(fmtDate(new Date(d)));
    return out;
  }, [viewMode, monthOffset]);

  const dayNames = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
  // Today marker (local date)
  const todayISO = useMemo(() => fmtDate(new Date()), []);

  // Helper to derive light background + contrast text from base color
  function deriveColors(base: string): { bg: string; border: string; text: string } {
    // Always force light-mode friendly colors: lighten aggressively and always use dark text.
    const hex = base.startsWith('#') ? base.slice(1) : base;
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return { bg: '#eef2ff', border: '#c7d2fe', text: '#1e293b' };
    const r = parseInt(hex.slice(0,2),16);
    const g = parseInt(hex.slice(2,4),16);
    const b = parseInt(hex.slice(4,6),16);
    const lighten = (ch: number) => Math.round(ch + (255 - ch) * 0.90); // stronger lighten to avoid dark blocks
    const lr = lighten(r), lg = lighten(g), lb = lighten(b);
    const bg = `#${lr.toString(16).padStart(2,'0')}${lg.toString(16).padStart(2,'0')}${lb.toString(16).padStart(2,'0')}`;
    // Force dark text for consistency (never flip to white)
    const text = '#1e293b';
    return { bg, border: '#' + hex, text };
  }

  function isoWeekNumber(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00');
    const target = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const firstThursdayDayNr = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - firstThursdayDayNr + 3);
    const diff = target.getTime() - firstThursday.getTime();
    return 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
  }

  // ISO week year helper (year that the ISO week belongs to)
  function isoWeekYear(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00');
    const target = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3); // shift to Thursday
    return target.getFullYear();
  }

  function isoWeekKey(dateStr: string) {
    const y = isoWeekYear(dateStr);
    const w = isoWeekNumber(dateStr);
    return `${y}-W${String(w).padStart(2, '0')}`;
  }

  function startOfIsoWeek(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00');
    const dayNr = (d.getDay() + 6) % 7; // Mon=0
    const start = new Date(d);
    start.setDate(start.getDate() - dayNr);
    return start;
  }

  function endOfIsoWeek(dateStr: string) {
    const start = startOfIsoWeek(dateStr);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return end;
  }

  // Parse ISO week key (YYYY-Www) to Monday date
  function mondayFromIsoWeekKey(key: string): Date | null {
    const m = key.match(/^(\d{4})-W(\d{2})$/);
    if (!m) return null;
    const year = parseInt(m[1], 10);
    const week = parseInt(m[2], 10);
    if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) return null;
    const jan4 = new Date(year, 0, 4);
    const dayNr = (jan4.getDay() + 6) % 7; // Mon=0
    const week1Monday = new Date(jan4);
    week1Monday.setDate(jan4.getDate() - dayNr);
    const monday = new Date(week1Monday);
    monday.setDate(week1Monday.getDate() + (week - 1) * 7);
    return monday;
  }

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
        const list = map.get(day) || [];
        list.push(inst);
        map.set(day, list);
      }
    }
    return map;
  }, [scheduledSegments, scheduleMeta, projects]);

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
        const truckName = meta?.truck || null;
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

  // Avatar helpers
  function creatorInitials(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) {
      const p = parts[0];
      if (p.length >= 2) return (p[0] + p[1]).toUpperCase();
      return p[0].toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  function creatorColor(key: string) {
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    // Two tones: solid + subtle ring
    return {
      bg: `hsl(${hue} 70% 42%)`,
      ring: `hsl(${hue} 75% 60% / 0.65)`
    };
  }
  function CreatorAvatar({ segmentId, textColorOverride }: { segmentId: string; textColorOverride?: string }) {
    const name = rowCreatorLabel(segmentId);
    if (!name) return null;
    const { bg, ring } = creatorColor(name);
    const initials = creatorInitials(name);
    return (
      <span title={`Skapad av ${name}`}
            style={{
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
            }}>{initials}</span>
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
    return Array.from(map.values()).sort((a,b)=>a.localeCompare(b,'sv-SE',{ sensitivity: 'base' }));
  }, [projects, salesDirectory]);
  const searchedProjects = useMemo(() => recentSearchedIds.map(id => projects.find(p => p.id === id)).filter(Boolean) as Project[], [recentSearchedIds, projects]);

  // DnD handlers
  function onDragStart(e: React.DragEvent, id: string) { e.dataTransfer.setData('text/plain', id); setDraggingId(id); e.dataTransfer.effectAllowed = 'move'; }
  function onDragEnd() { setDraggingId(null); }
  function allowDrop(e: React.DragEvent) { e.preventDefault(); }
  // Small helpers for Segment Editor
  const genId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2));
  const addDaysLocal = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return fmtDate(d); };
  function openSegmentEditorForNew(projectId: string, day: string) {
    const meta = scheduleMeta[projectId] || { projectId } as ProjectScheduleMeta;
    const assumedTruck = meta.truck ?? null;
    let positionIndex: number | null = null;
    if (assumedTruck) {
      const sameDay = itemsByDay.get(day) || [];
      const sameTruck = sameDay.filter(x => x.truck === assumedTruck && x.spanStart);
      positionIndex = sameTruck.length + 1; // default to end
    }
    setSegEditor({ mode: 'create', projectId, startDay: day, endDay: day, truck: assumedTruck, bagCount: (typeof meta.bagCount === 'number' ? meta.bagCount : null), jobType: meta.jobType ?? null, depotId: null, positionIndex });
    setSegEditorOpen(true);
  }
  function openSegmentEditorForExisting(segmentId: string) {
    const seg = scheduledSegments.find(s => s.id === segmentId);
    if (!seg) return;
    const meta = scheduleMeta[seg.projectId] || { projectId: seg.projectId } as ProjectScheduleMeta;
    setSegEditor({ mode: 'edit', projectId: seg.projectId, segmentId: seg.id, startDay: seg.startDay, endDay: seg.endDay, truck: meta.truck ?? null, bagCount: (typeof meta.bagCount === 'number' ? meta.bagCount : null), jobType: meta.jobType ?? null, depotId: seg.depotId ?? null });
    setSegEditorOpen(true);
  }
  function saveSegmentEditor() {
    if (!segEditor) return;
    const { mode, projectId, segmentId, startDay, endDay, truck, bagCount, jobType, depotId, positionIndex } = segEditor;
    // Update meta via debounced helper
    updateMeta(projectId, { truck, bagCount, jobType });
    if (mode === 'create') {
      const newSeg: ScheduledSegment = { id: genId(), projectId, startDay, endDay, depotId: depotId ?? undefined } as any;
      applyScheduledSegments(prev => {
        const next = [...prev, newSeg];
        // If a truck and desired position provided, reorder within same truck/day
        if (truck && positionIndex && positionIndex > 0) {
          // Build list of start-day items for same group in visual order
          const group = next
            .filter(s => s.startDay === startDay && s.projectId !== projectId ? (scheduleMeta[s.projectId]?.truck || null) === truck : true)
            .filter(s => s.startDay === startDay && (scheduleMeta[s.projectId]?.truck || null) === truck)
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
    } else if (segmentId) {
      applyScheduledSegments(prev => prev.map(s => s.id === segmentId ? ({ ...s, startDay, endDay, depotId: depotId ?? null }) : s));
      updateSegmentDepot(segmentId, depotId ?? null);
    }
    setSegEditorOpen(false);
    setSegEditor(null);
  }
  function onDropDay(e: React.DragEvent, day: string) {
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
    // Ensure meta exists then open editor for creation
    setScheduleMeta(m => m[proj.id] ? m : { ...m, [proj.id]: { projectId: proj.id, truck: null, bagCount: null, jobType: null, color: null } });
    openSegmentEditorForNew(proj.id, day);
  }

  // Click-based scheduling fallback: select a backlog project, then click a calendar day.
  function scheduleSelectedOnDay(day: string) {
    if (!selectedProjectId) return;
    const proj = projects.find(p => p.id === selectedProjectId);
    setSelectedProjectId(null);
    if (!proj) return;
    setScheduleMeta(m => m[proj.id] ? m : { ...m, [proj.id]: { projectId: proj.id } });
    openSegmentEditorForNew(proj.id, day);
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
      {segEditorOpen && segEditor && (() => {
        const p = projects.find(px => px.id === segEditor.projectId);
        const daysLen = Math.max(1, Math.round((new Date(segEditor.endDay + 'T00:00:00').getTime() - new Date(segEditor.startDay + 'T00:00:00').getTime()) / 86400000) + 1);
        const setDaysLen = (n: number) => {
          const len = Math.max(1, (n|0));
          setSegEditor(ed => ed ? ({ ...ed, endDay: addDaysLocal(ed.startDay, len - 1) }) : ed);
        };
        return (
          <div onClick={() => { setSegEditorOpen(false); setSegEditor(null); }} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(1px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" style={{ width: 'min(900px, 94vw)', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.35)' }}>
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
                <button aria-label="Stäng" onClick={() => { setSegEditorOpen(false); setSegEditor(null); }} className="btn--plain btn--xs" style={{ position: 'absolute', right: 10, top: 10, background: 'rgba(255,255,255,0.22)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 10, padding: '6px 10px', fontSize: 14, lineHeight: 1 }}>×</button>
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
                {segEditor.mode === 'create' && segEditor.truck && (() => {
                  const sameDay = itemsByDay.get(segEditor.startDay) || [];
                  const sameTruck = sameDay.filter(x => x.truck === segEditor.truck && x.spanStart);
                  const maxPos = Math.max(0, sameTruck.length) + 1; // include new
                  const val = segEditor.positionIndex ?? maxPos;
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
                      const startW = dayNames[(new Date(start+'T00:00:00').getDay()+6)%7];
                      const endW = dayNames[(new Date(end+'T00:00:00').getDay()+6)%7];
                      const truckName = segEditor.truck || null;
                      const truckStyle = truckName && truckColors[truckName] ? truckColors[truckName] : null;
                      const depotName = segEditor.depotId ? (depots.find(d => d.id === segEditor.depotId)?.name || 'Okänd depå') : 'Lastbilens depå';
                      return (
                        <div style={{ display: 'grid', gap: 8 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {p?.orderNumber ? <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, background: '#eef2ff', border: '1px solid #c7d2fe', color: '#111827', padding: '2px 8px', borderRadius: 999 }}>#{p.orderNumber}</span> : null}
                            <span style={{ fontSize: 12, background: '#ecfeff', border: '1px solid #a5f3fc', color: '#164e63', padding: '2px 8px', borderRadius: 999 }}>{single ? `${startW} ${start}` : `${startW} ${start} → ${endW} ${end}`}</span>
                            <span style={{ fontSize: 12, background: '#f0fdf4', border: '1px solid #86efac', color: '#14532d', padding: '2px 8px', borderRadius: 999 }}>{segEditor.bagCount != null ? `${segEditor.bagCount} säckar` : 'Säckar ej satta'}</span>
                            <span style={{ fontSize: 12, background: '#f5f3ff', border: '1px solid #ddd6fe', color: '#3730a3', padding: '2px 8px', borderRadius: 999 }}>{segEditor.jobType || 'Jobbtyp ej vald'}</span>
                            <span style={{ fontSize: 12, background: '#fff7ed', border: '1px solid #fed7aa', color: '#7c2d12', padding: '2px 8px', borderRadius: 999 }}>{depotName}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ fontSize: 12, color: '#475569' }}>Lastbil:</div>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 8, border: `1px solid ${truckStyle ? truckStyle.border : '#cbd5e1'}`, background: truckStyle ? truckStyle.bg : '#fff' }}>
                              <div style={{ width: 8, height: 8, borderRadius: 8, background: truckStyle ? truckStyle.border : '#94a3b8' }} />
                              <div style={{ fontSize: 12, color: truckStyle ? truckStyle.text : '#0f172a' }}>{truckName || 'Inte vald'}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center', padding: 12, background: '#f8fafc', borderTop: '1px solid #e5e7eb', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap:'wrap' }}>
                  {p && (
                    <button
                      type="button"
                      onClick={() => handleEmailClick({ segmentId: segEditor.segmentId, project: p, truck: segEditor.truck, day: segEditor.startDay, startDay: segEditor.startDay, endDay: segEditor.endDay })}
                      disabled={emailFetchStatus[p.id] === 'loading'}
                      className="btn--plain btn--xs"
                      title={scheduleMeta[p.id]?.client_notified ? (scheduleMeta[p.id]?.client_notified_by ? `Notifierad av ${scheduleMeta[p.id]!.client_notified_by}` : 'Kund markerad som notifierad') : 'Skicka planeringsmail'}
                      style={{ fontSize:12, border:'1px solid '+(scheduleMeta[p.id]?.client_notified ? '#047857' : '#7dd3fc'), background: scheduleMeta[p.id]?.client_notified ? '#059669' : '#e0f2fe', color: scheduleMeta[p.id]?.client_notified ? '#fff' : '#0369a1', borderRadius:10, padding:'8px 12px' }}
                    >
                      {scheduleMeta[p.id]?.client_notified ? 'Notifierad ✓' : 'Maila kund'}
                    </button>
                  )}
                  {segEditor.mode === 'edit' && segEditor.segmentId && (
                    confirmDeleteSegmentId === segEditor.segmentId ? (
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ fontSize:11, color:'#b91c1c', fontWeight:500 }}>Bekräfta borttagning?</span>
                        <button type="button" onClick={() => { if (!segEditor.segmentId) return; unschedule(segEditor.segmentId); setSegEditorOpen(false); setSegEditor(null); }} className="btn--plain btn--xs" style={{ fontSize:11, padding:'6px 10px', background:'#dc2626', border:'1px solid #b91c1c', color:'#fff', borderRadius:8, boxShadow:'0 0 0 1px #fff inset' }}>Ja, ta bort</button>
                        <button type="button" onClick={() => setConfirmDeleteSegmentId(null)} className="btn--plain btn--xs" style={{ fontSize:11, padding:'6px 10px', background:'#fff', border:'1px solid #cbd5e1', color:'#334155', borderRadius:8 }}>Avbryt</button>
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
                <div style={{ display: 'flex', gap: 8, flexWrap:'wrap' }}>
                  <button type="button" onClick={() => { setSegEditorOpen(false); setSegEditor(null); }} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '8px 12px', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 10 }}>Avbryt</button>
                  <button type="button" onClick={saveSegmentEditor} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '8px 12px', border: '1px solid #16a34a', background: '#16a34a', color: '#fff', borderRadius: 10, boxShadow: '0 2px 6px rgba(22,163,74,0.25)' }}>{segEditor.mode === 'create' ? 'Lägg till' : 'Spara'}</button>
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
          <div style={{ position: 'fixed', inset:0, zIndex: 2000, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius: 12, padding: '20px 22px', width: 'min(420px,90%)', display:'grid', gap:16, boxShadow:'0 8px 30px -6px rgba(0,0,0,0.25)' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <h3 style={{ margin:0, fontSize:18, color:'#0f172a' }}>Har kunden notifierats?</h3>
                <p style={{ margin:0, fontSize:13, color:'#475569' }}>Bekräfta att du skickade eller informerade kunden om <strong>{project?.name}</strong>.</p>
              </div>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                <button type="button" onClick={() => { if (project) markClientNotified(project.id); setPendingNotifyProjectId(null); }} style={{ flex:'1 1 120px', background:'#059669', color:'#fff', border:'1px solid #047857', borderRadius:8, padding:'10px 14px', fontSize:13, fontWeight:600, cursor:'pointer' }}>Ja, notifierad</button>
                <button type="button" onClick={() => { setPendingNotifyProjectId(null); }} style={{ flex:'1 1 120px', background:'#f1f5f9', color:'#334155', border:'1px solid #cbd5e1', borderRadius:8, padding:'10px 14px', fontSize:13, fontWeight:600, cursor:'pointer' }}>Nej / Avbryt</button>
                {project && scheduleMeta[project.id]?.client_notified && (
                  <button type="button" onClick={() => { undoClientNotified(project.id); setPendingNotifyProjectId(null); }} style={{ flex:'1 1 100%', background:'#fee2e2', color:'#b91c1c', border:'1px solid #fca5a5', borderRadius:8, padding:'8px 12px', fontSize:12, fontWeight:600, cursor:'pointer' }}>Ångra tidigare markering</button>
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
          <div style={{ position: 'fixed', inset:0, zIndex: 260, background: 'rgba(15,23,42,0.5)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={closeProjectModal}>
            <div role="dialog" aria-modal="true" aria-busy={detailLoading ? true : undefined} onClick={e => e.stopPropagation()} style={{ width: 'min(720px, 92vw)', maxHeight: '80vh', overflowY: 'auto', background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, boxShadow:'0 12px 30px rgba(0,0,0,0.25)', display:'grid', gap:12, padding:16 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ display:'grid', gap:8 }}>
                  <strong style={{ fontSize:18, color:'#0f172a' }}>
                    {base?.orderNumber ? <span style={{ fontFamily:'ui-monospace,monospace', fontSize:13, background:'#eef2ff', border:'1px solid #c7d2fe', color:'#312e81', padding:'2px 6px', borderRadius:6, marginRight:8 }}>#{base.orderNumber}</span> : null}
                    {base?.name || 'Projekt'}
                  </strong>
                  <span style={{ fontSize:12, color:'#475569' }}>{base?.customer}</span>
                </div>
                <button onClick={closeProjectModal} className="btn--plain btn--sm" style={{ background:'#fee2e2', border:'1px solid #fca5a5', color:'#b91c1c', borderRadius:6, padding:'6px 10px', fontSize:12 }}>Stäng</button>
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
                <div style={{ display:'grid', gap:6 }}>
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
                    {seller && <span style={{ fontSize:11, color:'#475569', background:'#f1f5f9', border:'1px solid #e2e8f0', padding:'2px 6px', borderRadius: 999 }}>Sälj: {seller}</span>}
                    {meta?.truck && <span style={{ fontSize:11, color:'#475569', background:'#f1f5f9', border:'1px solid #e2e8f0', padding:'2px 6px', borderRadius: 999 }}>Lastbil: {meta.truck}</span>}
                    {team.length > 0 && <span style={{ fontSize:11, color:'#475569', background:'#f1f5f9', border:'1px solid #e2e8f0', padding:'2px 6px', borderRadius: 999 }}>Team: {team.join(', ')}</span>}
                    {typeof meta?.bagCount === 'number' && <span style={{ fontSize:11, color:'#475569', background:'#f1f5f9', border:'1px solid #e2e8f0', padding:'2px 6px', borderRadius: 999 }}>Plan: {meta.bagCount} säckar</span>}
                    {typeof meta?.actual_bags_used === 'number' && <span style={{ fontSize:11, color:'#1e293b', background:'#ecfeff', border:'1px solid #bae6fd', padding:'2px 6px', borderRadius: 999 }}>Rapporterat: {meta.actual_bags_used} säckar</span>}
                    {meta?.jobType && <span style={{ fontSize:11, color:'#475569', background:'#f1f5f9', border:'1px solid #e2e8f0', padding:'2px 6px', borderRadius: 999 }}>{meta.jobType}</span>}
                    {base?.createdAt && <span style={{ fontSize:11, color:'#64748b' }}>Skapad {base.createdAt.slice(0,10)}</span>}
                  </div>
                </div>
                {(segs.length > 0) && (
                  <div style={{ display:'grid', gap:6 }}>
                    <strong style={{ fontSize:13, color:'#0f172a' }}>Planerade dagar</strong>
                    <div style={{ display:'grid', gap:6 }}>
                      {segs.map(s => (
                        <div key={s.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', border:'1px solid #e5e7eb', background:'#f8fafc', borderRadius:8, padding:'6px 8px' }}>
                          <div style={{ display:'grid' }}>
                            <span style={{ fontSize:12, color:'#0f172a', fontWeight:600 }}>{s.startDay}{s.endDay !== s.startDay ? ` – ${s.endDay}` : ''}</span>
                            <span style={{ fontSize:11, color:'#475569' }}>{base?.customer}</span>
                          </div>
                          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                            <button type="button" className="btn--plain btn--xs" onClick={() => handleEmailClick({ segmentId: s.id, project: base })} style={{ fontSize:11, border:'1px solid #7dd3fc', background:'#e0f2fe', color:'#0369a1', borderRadius:6, padding:'2px 8px' }}>Maila kund</button>
                            {ekPath && <a href={`/api/storage/download?path=${encodeURIComponent(ekPath)}`} target="_blank" rel="noopener noreferrer" className="btn--plain btn--xs" style={{ fontSize:11, border:'1px solid #047857', background:'#059669', color:'#fff', borderRadius:6, padding:'2px 8px' }}>Egenkontroll</a>}
                          </div>
                        </div>
                      ))}
                    </div>
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
  <div style={{ display: 'grid', gap: 16 }}>
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
                    <div style={{ position: 'absolute', top: -6, left: -6, background: '#059669', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 12, boxShadow:'0 0 0 2px #fff' }} title="Egenkontroll finns">EK</div>
                  )}
                  <strong style={{ fontSize: 14 }}>
                    {p.orderNumber ? <span style={{ fontFamily: 'ui-monospace, monospace', background: '#eef2ff', color: '#312e81', padding: '2px 6px', borderRadius: 4, marginRight: 6, fontSize: 12, border: '1px solid #c7d2fe' }}>#{p.orderNumber}</span> : null}
                    {p.name}
                  </strong>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>{p.customer}</span>
                  {p.salesResponsible && <span style={{ fontSize: 10, color: '#475569', background:'#f1f5f9', padding:'2px 6px', borderRadius:12, border:'1px solid #e2e8f0' }}>Sälj: {p.salesResponsible}</span>}
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>Skapad: {p.createdAt.slice(0, 10)}</span>
                </div>
              ))}
              <hr style={{ border: 'none', height: 1, background: '#e5e7eb', margin: 0 }} />
            </div>
          )}

          <div style={{ display: 'grid', gap: 8 }}>
            <h2 style={{ fontSize: 15, margin: 0 }}>Projekt</h2>
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
                    {p.salesResponsible && <span style={{ fontSize: 10, color: '#475569', background:'#f1f5f9', padding:'2px 6px', borderRadius:12, border:'1px solid #e2e8f0' }}>Säljare: {p.salesResponsible}</span>}
                    <span style={{ fontSize: 10, color: '#64748b', background: '#f1f5f9', padding: '2px 6px', borderRadius: 12, border:'1px solid #e2e8f0' }}>Skapad {p.createdAt.slice(0,10)}</span>
                  </div>
                </div>
              );
            })}
      {selectedProjectId && <div style={{ fontSize: 11, color: '#b45309', background: '#fef3c7', border: '1px solid #fcd34d', padding: '4px 6px', borderRadius: 6 }}>Klicka på en dag i kalendern för att schemalägga vald projekt (fallback).</div>}
          </div>
  </div>
  )}

        {/* Calendar */}
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn--plain btn--sm" onClick={() => setMonthOffset(o => o - 1)}>◀</button>
            <strong style={{ fontSize: 16 }}>{(() => { const d = new Date(); d.setMonth(d.getMonth() + monthOffset); return d.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' }); })()}</strong>
            <button className="btn--plain btn--sm" onClick={() => setMonthOffset(o => o + 1)}>▶</button>
            {monthOffset !== 0 && <button className="btn--plain btn--sm" onClick={() => setMonthOffset(0)}>Idag</button>}
            <div style={{ display: 'flex', gap: 4 }}>
              {(['monthGrid','weekdayLanes','dayList'] as const).map(modeKey => {
                const active = viewMode === modeKey;
                return (
                  <button
                    key={modeKey}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setViewMode(modeKey)}
                    className="btn--plain btn--sm"
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: active ? '2px solid #6366f1' : '1px solid #d1d5db',
                      background: active ? '#eef2ff' : '#fff',
                      fontWeight: active ? 600 : 500,
                      fontSize: 12,
                      color: active ? '#312e81' : '#374151'
                    }}
                  >{modeKey === 'monthGrid' ? 'Månad' : modeKey === 'weekdayLanes' ? 'Veckodagar' : 'Daglista'}</button>
                );
              })}
            </div>
            {/* Inline card control toggle removed; actions live in the modal */}
            <button type="button" className="btn--plain btn--sm" onClick={() => refreshEgenkontroller()} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
              {egenkontrollLoading ? 'Laddar EK…' : 'Uppdatera EK'}
            </button>
            {egenkontrollError && <span style={{ fontSize:10, color:'#b91c1c' }} title={egenkontrollError}>Fel EK</span>}
            {!egenkontrollLoading && egenkontrollOrderNumbers.size > 0 && <span style={{ fontSize:10, background:'#ecfdf5', color:'#047857', padding:'2px 6px', borderRadius:12, border:'1px solid #6ee7b7' }} title="Antal matchade egenkontroller">EK: {egenkontrollOrderNumbers.size}</span>}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn--plain btn--sm" onClick={() => setSidebarCollapsed(s => !s)}
              style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
              {sidebarCollapsed ? 'Visa projektpanel' : 'Dölj projektpanel'}
            </button>
            {isAdmin && (
              <button type="button" className="btn--plain btn--sm" onClick={() => setAdminModalOpen(true)}
                style={{ marginLeft: 'auto', border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 10px', fontSize: 12, background:'#fff' }}>
                Admin‑inställningar
              </button>
            )}
          </div>
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
                  <input value={newTruckName} onChange={e => setNewTruckName(e.target.value)} placeholder="Ny lastbil" style={{ fontSize: 11, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ fontSize: 11, color: '#475569', display: 'inline-block', width: 'auto' }}>Depå:</label>
                    <select value={newTruckDepotId} onChange={e => setNewTruckDepotId(e.target.value)} style={{ width: 160, fontSize: 11, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff' }}>
                      <option value="">Välj depå (valfritt)</option>
                      {depots.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" disabled={!newTruckName.trim()} className="btn--plain btn--xs" style={{ fontSize: 11, background: '#e0f2fe', border: '1px solid #7dd3fc', color: '#0369a1', borderRadius: 6, padding: '4px 6px' }}>Lägg till</button>
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
                              <span style={{ fontSize: 11, color:'#b91c1c', background:'#fef2f2', border:'1px solid #fecaca', padding:'1px 6px', borderRadius: 999 }}>
                                Risk: {ekoRisk}{ekoRisk && vitRisk ? ' • ' : ''}{vitRisk}
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, color:'#047857', background:'#ecfdf5', border:'1px solid #6ee7b7', padding:'1px 7px', borderRadius: 999 }}>Ekovilla: {eko}</span>
                            <span style={{ fontSize: 11, color:'#1d4ed8', background:'#eff6ff', border:'1px solid #93c5fd', padding:'1px 7px', borderRadius: 999 }}>Vitull: {vit}</span>
                            {planned && (planned.ekovilla > 0 || planned.vitull > 0) ? (
                              <span style={{ fontSize: 11, color:'#0369a1', background:'#f0f9ff', border:'1px solid #bae6fd', padding:'1px 7px', borderRadius: 999 }}>Plan: E {planned.ekovilla || 0} • V {planned.vitull || 0}</span>
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
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#334155', background:'#f8fafc', border:'1px solid #e5e7eb', padding:'1px 6px', borderRadius: 6 }}>{d.delivery_date}</span>
                          <span style={{ color: '#64748b' }}>•</span>
                          <span style={{ fontSize: 12, color: '#111827' }}>{depName}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: matStyle.text as any, background: matStyle.bg as any, border: `1px solid ${matStyle.border}`, padding:'1px 7px', borderRadius: 999 }}>{d.material_kind} × {d.amount} säckar</span>
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
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#374151', display: 'inline-block', width: 'auto' }}>Lastbil:</label>
              <select value={truckFilter} onChange={e => setTruckFilter(e.target.value)} style={{ width: 170, fontSize: 12, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff' }}>
                <option value="">Alla</option>
                <option value="UNASSIGNED">(Ingen vald)</option>
                {trucks.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {truckFilter && <button type="button" className="btn--plain btn--xs" style={{ fontSize: 11 }} onClick={() => setTruckFilter('')}>Rensa</button>}
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
              style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.35)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
              <div onClick={e=>e.stopPropagation()} style={{ width:'min(100%, 980px)', maxHeight:'85vh', overflow:'auto', background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, boxShadow:'0 20px 40px rgba(0,0,0,0.15)' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 14px', borderBottom:'1px solid #e5e7eb' }}>
                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={()=>setAdminModalTab('trucks')} style={{ padding:'6px 10px', border:'1px solid '+(adminModalTab==='trucks'?'#111827':'#e5e7eb'), borderRadius:8, background: adminModalTab==='trucks'?'#111827':'#fff', color: adminModalTab==='trucks'?'#fff':'#111827', fontSize:13, fontWeight:600 }}>Lastbilar</button>
                    <button onClick={()=>setAdminModalTab('depots')} style={{ padding:'6px 10px', border:'1px solid '+(adminModalTab==='depots'?'#111827':'#e5e7eb'), borderRadius:8, background: adminModalTab==='depots'?'#111827':'#fff', color: adminModalTab==='depots'?'#fff':'#111827', fontSize:13, fontWeight:600 }}>Depåer</button>
                    <button onClick={()=>setAdminModalTab('deliveries')} style={{ padding:'6px 10px', border:'1px solid '+(adminModalTab==='deliveries'?'#111827':'#e5e7eb'), borderRadius:8, background: adminModalTab==='deliveries'?'#111827':'#fff', color: adminModalTab==='deliveries'?'#fff':'#111827', fontSize:13, fontWeight:600 }}>Leveranser</button>
                  </div>
                  <button onClick={()=>setAdminModalOpen(false)} className="btn--plain" aria-label="Stäng" style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'6px 10px', background:'#fff' }}>Stäng</button>
                </div>
                <div style={{ padding:14, display:'grid', gap:12 }}>
                  {adminModalTab==='trucks' && (
                    <div style={{ display:'grid', gap: 12 }}>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:12 }}>
                        {planningTrucks.map(tRec => {
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
                            <div key={tRec.id} style={{ display:'flex', flexDirection:'column', gap:10, padding:10, border:'1px solid #e5e7eb', borderRadius:10, background:'#fff' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                <span style={{ width: 16, height: 16, background: currentColor, border: '3px solid #cbd5e1', borderRadius: 6 }} />
                                <strong>{tRec.name}</strong>
                                <input type="color" value={currentColor as string} onChange={e=>updateTruckColor(tRec, e.target.value)} style={{ marginLeft:'auto', width: 28, height: 28, border:'1px solid #cbd5e1', borderRadius:6, background:'#fff' }} />
                              </div>
                              <div style={{ display:'grid', gap:8 }}>
                                <label style={{ display:'grid', gap:4, fontSize:12 }}>
                                  <span>Team 1</span>
                                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                                    <select
                                      value={edit.team1Id || tRec.team1_id || ''}
                                      onChange={e=>{ const val = e.target.value || null; updateTruckTeamId(tRec, 1, val); const nm = crewList.find(c=>c.id===val)?.name || ''; if (nm) updateTruckTeamName(tRec, 1, nm); }}
                                      style={{ flex:1, padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }}
                                    >
                                      <option value="">Ej tilldelad</option>
                                      {crewList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                    <span style={{ fontSize:11, color:'#6b7280' }}>{(edit.team1 ?? tRec.team_member1_name) || ''}</span>
                                  </div>
                                </label>
                                <label style={{ display:'grid', gap:4, fontSize:12 }}>
                                  <span>Team 2</span>
                                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                                    <select
                                      value={edit.team2Id || tRec.team2_id || ''}
                                      onChange={e=>{ const val = e.target.value || null; updateTruckTeamId(tRec, 2, val); const nm = crewList.find(c=>c.id===val)?.name || ''; if (nm) updateTruckTeamName(tRec, 2, nm); }}
                                      style={{ flex:1, padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }}
                                    >
                                      <option value="">Ej tilldelad</option>
                                      {crewList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                    <span style={{ fontSize:11, color:'#6b7280' }}>{(edit.team2 ?? tRec.team_member2_name) || ''}</span>
                                  </div>
                                </label>
                                <label style={{ display:'grid', gap:4, fontSize:12 }}>
                                  <span>Depå</span>
                                  <select value={tRec.depot_id || ''} onChange={e=>updateTruckDepot(tRec, e.target.value || null)} style={{ padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }}>
                                    <option value="">Ingen depå</option>
                                    {depots.map(d => (<option key={d.id} value={d.id}>{d.name}</option>))}
                                  </select>
                                </label>
                              </div>
                              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                                <button type="button" disabled={!changed || status?.status === 'saving'} onClick={()=>saveTruckTeamNames(tRec)} className="btn--plain btn--xs" style={{ fontSize:12, padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8, background:'#fff' }}>Spara</button>
                                <button type="button" onClick={()=>{ if (typeof window!=='undefined'){ const ok = window.confirm(`Ta bort lastbil \"${tRec.name}\"?`); if (!ok) return;} deleteTruck(tRec); }} className="btn--plain btn--xs" style={{ fontSize:12, padding:'6px 8px', border:'1px solid #fecaca', background:'#fef2f2', color:'#b91c1c', borderRadius:8 }}>Ta bort</button>
                                {status?.status === 'saving' && <span style={{ fontSize: 12, color: '#64748b' }}>Sparar…</span>}
                                {status?.status === 'saved' && <span style={{ fontSize: 12, color: '#059669' }}>✓ Sparad</span>}
                                {status?.status === 'error' && <span style={{ fontSize: 12, color: '#b91c1c' }}>Fel</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ paddingTop:6, borderTop:'1px dashed #e5e7eb' }}>
                        <form onSubmit={e=>{e.preventDefault(); createTruck();}} style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                          <input value={newTruckName} onChange={e=>setNewTruckName(e.target.value)} placeholder="Ny lastbil" style={{ minWidth:220, padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }} />
                          <select value={newTruckDepotId} onChange={e=>setNewTruckDepotId(e.target.value)} style={{ minWidth:200, padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }}>
                            <option value="">Välj depå (valfritt)</option>
                            {depots.map(d => (<option key={d.id} value={d.id}>{d.name}</option>))}
                          </select>
                          <button type="submit" disabled={!newTruckName.trim()} className="btn--plain btn--xs" style={{ fontSize:12, padding:'6px 10px', border:'1px solid #7dd3fc', background:'#e0f2fe', color:'#0369a1', borderRadius:8 }}>Lägg till</button>
                        </form>
                      </div>
                    </div>
                  )}
                  {adminModalTab==='depots' && (
                    <div style={{ display:'grid', gap:12 }}>
                      <form onSubmit={createDepot} style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                        <input value={newDepotName} onChange={e=>setNewDepotName(e.target.value)} placeholder="Ny depå" style={{ minWidth:240, padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }} />
                        <button type="submit" disabled={!newDepotName.trim()} className="btn--plain btn--xs" style={{ fontSize:12, padding:'6px 10px', border:'1px solid #7dd3fc', background:'#e0f2fe', color:'#0369a1', borderRadius:8 }}>Lägg till</button>
                      </form>
                      <div style={{ display:'grid', gap:8 }}>
                        {depots.map(dep => {
                          const edit = depotEdits[dep.id] || {};
                          const ekoVal = edit.material_ekovilla_total ?? (dep.material_ekovilla_total == null ? '' : String(dep.material_ekovilla_total));
                          const vitVal = edit.material_vitull_total ?? (dep.material_vitull_total == null ? '' : String(dep.material_vitull_total));
                          const saveBoth = () => upsertDepotTotals(dep.id, ekoVal, vitVal);
                          return (
                            <div key={dep.id} style={{ display:'grid', gridTemplateColumns:'1fr auto auto auto', alignItems:'center', gap:10, padding:'6px 8px', border:'1px solid #e5e7eb', borderRadius:8 }}>
                              <div style={{ fontWeight:600 }}>{dep.name}</div>
                              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                                <label style={{ fontSize:12 }}>Eko</label>
                                <input inputMode="numeric" pattern="[0-9]*" value={ekoVal} onChange={e=>setDepotEdits(prev=>({ ...prev, [dep.id]: { ...prev[dep.id], material_ekovilla_total: e.target.value } }))} onBlur={saveBoth} placeholder="Antal" style={{ width:90, padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }} />
                              </div>
                              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                                <label style={{ fontSize:12 }}>Vit</label>
                                <input inputMode="numeric" pattern="[0-9]*" value={vitVal} onChange={e=>setDepotEdits(prev=>({ ...prev, [dep.id]: { ...prev[dep.id], material_vitull_total: e.target.value } }))} onBlur={saveBoth} placeholder="Antal" style={{ width:90, padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }} />
                              </div>
                              <button type="button" onClick={()=>deleteDepot(dep)} className="btn--plain btn--xs" style={{ fontSize:12, padding:'6px 10px', border:'1px solid #fecaca', background:'#fef2f2', color:'#b91c1c', borderRadius:8 }}>Ta bort</button>
                            </div>
                          );
                        })}
                        {depots.length === 0 && <div style={{ color:'#6b7280' }}>Inga depåer</div>}
                      </div>
                    </div>
                  )}
                  {adminModalTab==='deliveries' && (
                    <div style={{ display:'grid', gap:12 }}>
                      <div style={{ display:'grid', gap:8, padding:'8px 10px', border:'1px dashed #cbd5e1', borderRadius:10, background:'#f8fafc' }}>
                        <div style={{ fontWeight:700, color:'#0f172a' }}>Planera leverans</div>
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(160px, 1fr))', gap:8, alignItems:'center' }}>
                          <label style={{ display:'grid', gap:4, fontSize:12 }}>
                            <span>Depå</span>
                            <select value={newDelivery.depotId} onChange={e=>setNewDelivery(prev=>({ ...prev, depotId: e.target.value }))} style={{ padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }}>
                              <option value="">Välj depå</option>
                              {depots.map(d => (<option key={d.id} value={d.id}>{d.name}</option>))}
                            </select>
                          </label>
                          <label style={{ display:'grid', gap:4, fontSize:12 }}>
                            <span>Material</span>
                            <select value={newDelivery.materialKind} onChange={e=>setNewDelivery(prev=>({ ...prev, materialKind: e.target.value as any }))} style={{ padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }}>
                              <option value="Ekovilla">Ekovilla</option>
                              <option value="Vitull">Vitull</option>
                            </select>
                          </label>
                          <label style={{ display:'grid', gap:4, fontSize:12 }}>
                            <span>Antal</span>
                            <input inputMode="numeric" pattern="[0-9]*" value={newDelivery.amount} onChange={e=>setNewDelivery(prev=>({ ...prev, amount: e.target.value }))} placeholder="t.ex. 30" style={{ padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }} />
                          </label>
                          <label style={{ display:'grid', gap:4, fontSize:12 }}>
                            <span>Datum</span>
                            <input type="date" value={newDelivery.date} onChange={e=>setNewDelivery(prev=>({ ...prev, date: e.target.value }))} style={{ padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }} />
                          </label>
                        </div>
                        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                          <button type="button" onClick={createPlannedDelivery} disabled={savingDelivery==='saving'} className="btn--plain btn--xs" style={{ fontSize:12, padding:'6px 10px', border:'1px solid #16a34a', background:'#dcfce7', color:'#166534', borderRadius:8 }}>Spara leverans</button>
                          {savingDelivery==='saving' && <span style={{ fontSize:12, color:'#64748b' }}>Sparar…</span>}
                          {savingDelivery==='saved' && <span style={{ fontSize:12, color:'#059669' }}>✓ Sparad</span>}
                          {savingDelivery==='error' && <span style={{ fontSize:12, color:'#b91c1c' }}>Fel</span>}
                        </div>
                      </div>
                      <div style={{ display:'grid', gap:10 }}>
                        <div style={{ fontWeight:700 }}>Kommande leveranser</div>
                        {groupedDeliveries.length === 0 && (
                          <div style={{ color:'#6b7280' }}>Inga planerade leveranser</div>
                        )}
                        {groupedDeliveries.map(group => {
                          const dep = depots.find(d => d.id === group.depotId);
                          const header = `${group.date} • ${dep ? dep.name : 'Okänd depå'} • ${group.material}`;
                          return (
                            <div key={`${group.depotId}|${group.date}|${group.material}`} style={{ border:'1px solid #e5e7eb', borderRadius:10, padding:8, background:'#fff', display:'grid', gap:6 }}>
                              <div style={{ fontWeight:600 }}>{header}</div>
                              <div style={{ display:'grid', gap:6 }}>
                                {group.items.map(item => {
                                  const edit = editingDeliveries[item.id] || { depotId: item.depot_id, materialKind: item.material_kind, amount: String(item.amount), date: item.delivery_date };
                                  return (
                                    <div key={item.id} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:8, alignItems:'center' }}>
                                      <select value={edit.depotId} onChange={e=>setEditingDeliveries(prev=>({ ...prev, [item.id]: { ...edit, depotId: e.target.value } }))} style={{ padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }}>
                                        {depots.map(d => (<option key={d.id} value={d.id}>{d.name}</option>))}
                                      </select>
                                      <select value={edit.materialKind} onChange={e=>setEditingDeliveries(prev=>({ ...prev, [item.id]: { ...edit, materialKind: e.target.value as any } }))} style={{ padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }}>
                                        <option value="Ekovilla">Ekovilla</option>
                                        <option value="Vitull">Vitull</option>
                                      </select>
                                      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                                        <input inputMode="numeric" pattern="[0-9]*" value={edit.amount} onChange={e=>setEditingDeliveries(prev=>({ ...prev, [item.id]: { ...edit, amount: e.target.value } }))} style={{ width:80, padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }} />
                                        <input type="date" value={edit.date} onChange={e=>setEditingDeliveries(prev=>({ ...prev, [item.id]: { ...edit, date: e.target.value } }))} style={{ padding:'6px 8px', border:'1px solid #cbd5e1', borderRadius:8 }} />
                                      </div>
                                      <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                                        <button type="button" onClick={()=>updatePlannedDelivery(item.id)} className="btn--plain btn--xs" style={{ fontSize:12, padding:'6px 10px', border:'1px solid #cbd5e1', background:'#fff', borderRadius:8 }}>Spara</button>
                                        <button type="button" onClick={()=>deletePlannedDelivery(item.id)} className="btn--plain btn--xs" style={{ fontSize:12, padding:'6px 10px', border:'1px solid #fecaca', background:'#fef2f2', color:'#b91c1c', borderRadius:8 }}>Ta bort</button>
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
                </div>
              </div>
            </div>
          )}
          {viewMode === 'monthGrid' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', gap: 8, fontSize: 12, fontWeight: 600, color: '#374151' }}>
                <div style={{ textAlign: 'center' }}>Vecka</div>
                {dayNames.map(n => <div key={n} style={{ textAlign: 'center' }}>{n}</div>)}
              </div>
              {weeks.map((week, wi) => {
                const firstDay = week.find(c => c.date)?.date;
                const weekNum = firstDay ? isoWeekNumber(firstDay) : '';
                const weekBg = wi % 2 === 0 ? '#e0f2fe' : '#e0e7ff';
                // When a week is selected, only render the matching week row
                if (selectedWeekKey) {
                  if (!firstDay || isoWeekKey(firstDay) !== selectedWeekKey) return null;
                }
                return (
                  <div key={wi} style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', gap: 8, background: weekBg, padding: 6, borderRadius: 12, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: 'rgba(255,255,255,0.65)', backdropFilter: 'blur(2px)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 8, color: '#1e293b', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>{weekNum && `v${weekNum}`}</div>
                    {week.map((cell, ci) => {
                      if (!cell.date) return <div key={ci} style={{ minHeight: 160, border: '1px solid transparent', borderRadius: 8 }} />;
                      if (selectedWeekKey && isoWeekKey(cell.date) !== selectedWeekKey) {
                        // Hide days outside the selected ISO week (can happen for leading/trailing days in a month row)
                        return <div key={ci} style={{ minHeight: 160, border: '1px solid transparent', borderRadius: 8 }} />;
                      }
                      const day = cell.date;
                      const rawItems = itemsByDay.get(day) || [];
                      const searchVal = calendarSearch.trim().toLowerCase();
                      const items = rawItems.filter(it => {
                        if (truckFilter) {
                          if (truckFilter === 'UNASSIGNED') { if (it.truck) return false; }
                          else if (it.truck !== truckFilter) return false;
                        }
                        if (salesFilter) {
                          if (salesFilter === '__NONE__') { if (it.project.salesResponsible) return false; }
                          else if ((it.project.salesResponsible || '').toLowerCase() !== salesFilter.toLowerCase()) return false;
                        }
                        if (searchVal) {
                          const hay = [it.project.name, it.project.orderNumber || '', it.project.customer, it.jobType || '', (it.bagCount != null ? String(it.bagCount) : '')].join(' ').toLowerCase();
                          if (!hay.includes(searchVal)) return false;
                        }
                        return true;
                      })
                      // Sort by truck order (known trucks first in trucks[] order), unassigned last,
                      // and within the same truck use explicit sortIndex when set, then orderNumber/name
                      .sort((a, b) => {
                        if (a.truck === b.truck) {
                          const sa = scheduledSegments.find(s => s.id === a.segmentId)?.sortIndex ?? null;
                          const sb = scheduledSegments.find(s => s.id === b.segmentId)?.sortIndex ?? null;
                          if (sa != null && sb != null && sa !== sb) return sa - sb;
                          if (sa != null && sb == null) return -1;
                          if (sb != null && sa == null) return 1;
                          const ao = a.project.orderNumber || '';
                          const bo = b.project.orderNumber || '';
                          if (ao && bo && ao !== bo) return ao.localeCompare(bo, 'sv');
                          return a.project.name.localeCompare(b.project.name, 'sv');
                        }
                        const ia = a.truck ? trucks.indexOf(a.truck) : -1;
                        const ib = b.truck ? trucks.indexOf(b.truck) : -1;
                        const aUn = ia === -1 || !a.truck;
                        const bUn = ib === -1 || !b.truck;
                        if (aUn && !bUn) return 1; // unassigned/unknown last
                        if (bUn && !aUn) return -1;
                        if (!aUn && !bUn && ia !== ib) return ia - ib;
                        // both unassigned or unknown trucks: alphabetical by name
                        return (a.truck || '').localeCompare(b.truck || '', 'sv');
                      });
                      const isJumpHighlight = day === jumpTargetDay;
                      const isToday = day === todayISO;
                      return (
                        <div key={day}
                             id={`calday-${day}`}
                             onClick={() => scheduleSelectedOnDay(day)}
                             onDragOver={allowDrop}
                             onDrop={e => onDropDay(e, day)}
                             style={{ border: isJumpHighlight ? '2px solid #f59e0b' : (selectedProjectId ? '2px dashed #fbbf24' : (isToday ? '2px solid #60a5fa' : '1px solid rgba(148,163,184,0.4)')), boxShadow: isJumpHighlight ? '0 0 0 4px rgba(245,158,11,0.35)' : (isToday ? '0 0 0 3px rgba(59,130,246,0.25)' : '0 1px 2px rgba(0,0,0,0.05)'), transition: 'box-shadow 0.3s,border 0.3s', borderRadius: 10, padding: 8, minHeight: 160, background: '#ffffff', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', cursor: selectedProjectId ? 'copy' : 'default' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#111827' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span>{day.slice(8, 10)}/{day.slice(5, 7)}</span>
                              {isToday && (
                                <span aria-label="Idag" title="Idag" style={{ fontSize: 10, color: '#1d4ed8', background: '#dbeafe', border: '1px solid #93c5fd', padding: '0px 6px', borderRadius: 999 }}>Idag</span>
                              )}
                            </span>
                            {items.length > 0 && <span style={{ fontSize: 10, background: '#f3f4f6', padding: '2px 6px', borderRadius: 12 }}>{items.length}</span>}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {items.map(it => {
                              let display: null | { bg: string; border: string; text: string } = null;
                              if (it.color) {
                                const hex = it.color.startsWith('#') ? it.color.slice(1) : it.color;
                                if (/^[0-9a-fA-F]{6}$/.test(hex)) {
                                  const r = parseInt(hex.slice(0, 2), 16);
                                  const g = parseInt(hex.slice(2, 4), 16);
                                  const b = parseInt(hex.slice(4, 6), 16);
                                  const lighten = (ch: number) => Math.round(ch + (255 - ch) * 0.85);
                                  const lr = lighten(r), lg = lighten(g), lb = lighten(b);
                                  const bg = `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
                                  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                                  const text = brightness < 110 ? '#ffffff' : '#111827';
                                  display = { bg, border: '#' + hex, text };
                                }
                              } else if (it.truck) {
                                display = truckColors[it.truck];
                              }
                              const cardBorder = display ? display.border : '#c7d2fe';
                              const cardBg = display ? display.bg : '#eef2ff';
                              const searchVal2 = calendarSearch.trim().toLowerCase();
                              const highlight = calendarSearch && (it.project.name.toLowerCase().includes(searchVal2) || (it.project.orderNumber || '').toLowerCase().includes(searchVal2));
                              const isMid = (it as any).spanMiddle;
                              const isStart = (it as any).spanStart;
                              return (
                                <div key={`${it.segmentId}:${it.day}`} draggable onDragStart={e => onDragStart(e, it.segmentId)} onDragEnd={onDragEnd} onDoubleClick={() => openSegmentEditorForExisting(it.segmentId)} style={{ position: 'relative', border: `2px solid ${highlight ? '#f59e0b' : cardBorder}`, background: cardBg, borderRadius: 6, padding: 6, fontSize: 12, cursor: 'grab', display: 'grid', gap: 4, opacity: isMid ? 0.95 : 1, boxShadow: highlight ? '0 0 0 3px rgba(245,158,11,0.35)' : 'none' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2}}>
                                    <span style={{ fontWeight: 600, color: display ? display.text : '#312e81', display: 'flex', alignItems: 'center', columnGap: 6, rowGap: 2, flexWrap: 'wrap' }}>
                                      {it.project.orderNumber ? (
                                        <span style={{ fontFamily: 'ui-monospace, monospace', background: '#ffffff', color: display ? display.text : '#312e81', border: `1px solid ${cardBorder}`, padding: '1px 4px', borderRadius: 4, whiteSpace: 'nowrap' }} title="Ordernummer">#{it.project.orderNumber}</span>
                                      ) : null}
                                      <span style={{ color: display ? display.text : '#312e81', fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{it.project.name}</span>
                                      <button type="button" onClick={(e) => { e.stopPropagation(); openProjectModal(it.project.id); }} className="icon-btn" title="Öppna projekt" aria-label="Öppna projekt" style={{ display: 'inline-flex', alignItems: 'center', flex: '0 0 auto' }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                                        <span style={{ fontWeight: 600, fontSize: 10 }}>Öppna projekt</span>
                                      </button>
                                      <button type="button"
                                        onClick={(e) => { e.stopPropagation(); setSelectedProjectId(it.project.id); }}
                                        className="btn--plain btn--xs"
                                        title="Lägg till ny separat dag"
                                        style={{ fontSize: 10, background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#047857', borderRadius: 4, padding: '2px 4px' }}
                                      >
                                        Lägg till dag
                                      </button>
                                      {/* EK badge moved to bottom */}
                                    </span>
                                    {isStart && <span style={{ color: display ? display.text : '#6366f1' }}>{it.project.customer}</span>}
                                    {isStart && it.project.salesResponsible && <span style={{ fontSize: 10, color: display ? display.text : '#334155', background:'#ffffff30', padding:'2px 6px', borderRadius: 12, border:`1px solid ${cardBorder}55` }}>Sälj: {it.project.salesResponsible}</span>}
                                    {isStart && rowCreatorLabel(it.segmentId) && (
                                      <CreatorAvatar segmentId={it.segmentId} />
                                    )}
                                    {(it.bagCount != null || it.jobType) && (
                                      <span style={{ fontSize: 11, color: display ? display.text : '#374151' }}>
                                        {it.bagCount != null ? `${it.bagCount} säckar` : ''}
                                        {it.bagCount != null && it.jobType ? ' • ' : ''}
                                        {it.jobType || ''}
                                      </span>
                                    )}
                                      {isStart && scheduleMeta[it.project.id]?.actual_bags_used != null && (
                                        <span style={{ fontSize: 10, color: display ? display.text : '#1e293b', background:'#ffffff50', padding:'4px 6px', borderRadius:10, border:`1px solid ${cardBorder}55` }} title={`Rapporterat: ${scheduleMeta[it.project.id]?.actual_bags_used} säckar`}>
                                          säckar blåsta {scheduleMeta[it.project.id]!.actual_bags_used} st
                                        </span>
                                      )}
                                    {isStart && it.truck && (() => { const team = truckTeamNames(it.truck); return team.length ? <span style={{ fontSize: 10, color: display ? display.text : '#334155', background:'#ffffff40', padding:'2px 6px', borderRadius: 10, border:`1px solid ${cardBorder}40` }}>Team: {team.join(', ')}</span> : null; })()}
                                    {isStart && hasEgenkontroll(it.project.orderNumber) && (() => { const pth = egenkontrollPath(it.project.orderNumber); return (
                                      <a href={pth ? `/api/storage/download?path=${encodeURIComponent(pth)}` : '#'} target="_blank" rel="noopener noreferrer" style={{ textDecoration:'none', fontSize:10, background:'#059669', color:'#fff', padding:'2px 6px', borderRadius:8, alignSelf:'flex-start', border:'1px solid #047857', display:'inline-flex', gap:4, alignItems:'center', cursor:'pointer' }} title={pth ? 'Öppna egenkontroll (PDF)' : 'Egenkontroll hittad'}>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display:'block' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 12v6"/><path d="M9 15l3 3 3-3"/></svg>
                                        Rapporterad
                                      </a>
                                    ); })()}
                                    {/* Depot info shown; overrides are edited in modal */}
                                    {(() => {
                                      const seg = scheduledSegments.find(s => s.id === it.segmentId);
                                      const overrideId = seg?.depotId || null;
                                      const truckRec = it.truck ? planningTrucks.find(t => t.name === it.truck) : null;
                                      const effectiveId = overrideId ?? (truckRec?.depot_id ?? null);
                                      const eff = effectiveId ? depots.find(d => d.id === effectiveId) : null;
                                      return (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                          <span style={{ fontSize: 10, color: display ? display.text : '#475569', background:'#f1f5f9', padding:'2px 6px', borderRadius:12, border:`1px solid ${cardBorder}55` }}>Depå: {eff ? eff.name : 'Ingen'}</span>
                                        </span>
                                      );
                                    })()}
                                  </div>
                                  {/* Inline controls removed; use modal for edits and actions */}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {viewMode === 'weekdayLanes' && (
            <div style={{ display: 'grid', gap: 16 }}>
              {dayNames.map((name, idx) => {
                const lane = weekdayLanes[idx] || [];
                const laneDays = selectedWeekKey ? lane.filter(dObj => isoWeekKey(dObj.date) === selectedWeekKey) : lane;
                if (selectedWeekKey && laneDays.length === 0) return null;
                return (
                  <div key={name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ width: 60, fontSize: 12, fontWeight: 700, textAlign: 'center', padding: '6px 4px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8 }}>{name}</div>
                    <div style={{ flex: 1, overflowX: 'auto', display: 'flex', gap: 8 }}>
                      {(selectedWeekKey ? laneDays : lane).map(dObj => {
                        const day = dObj.date;
                        const rawItems = itemsByDay.get(day) || [];
                        const searchVal = calendarSearch.trim().toLowerCase();
                        const items = rawItems.filter(it => {
                          if (truckFilter) {
                            if (truckFilter === 'UNASSIGNED') { if (it.truck) return false; }
                            else if (it.truck !== truckFilter) return false;
                          }
                          if (salesFilter) {
                            if (salesFilter === '__NONE__') { if (it.project.salesResponsible) return false; }
                            else if ((it.project.salesResponsible || '').toLowerCase() !== salesFilter.toLowerCase()) return false;
                          }
                          if (searchVal) {
                            const hay = [it.project.name, it.project.orderNumber || '', it.project.customer, it.jobType || '', (it.bagCount != null ? String(it.bagCount) : '')].join(' ').toLowerCase();
                            if (!hay.includes(searchVal)) return false;
                          }
                          return true;
                        })
                        .sort((a, b) => {
                          if (a.truck === b.truck) {
                            const sa = scheduledSegments.find(s => s.id === a.segmentId)?.sortIndex ?? null;
                            const sb = scheduledSegments.find(s => s.id === b.segmentId)?.sortIndex ?? null;
                            if (sa != null && sb != null && sa !== sb) return sa - sb;
                            if (sa != null && sb == null) return -1;
                            if (sb != null && sa == null) return 1;
                            const ao = a.project.orderNumber || '';
                            const bo = b.project.orderNumber || '';
                            if (ao && bo && ao !== bo) return ao.localeCompare(bo, 'sv');
                            return a.project.name.localeCompare(b.project.name, 'sv');
                          }
                          const ia = a.truck ? trucks.indexOf(a.truck) : -1;
                          const ib = b.truck ? trucks.indexOf(b.truck) : -1;
                          const aUn = ia === -1 || !a.truck;
                          const bUn = ib === -1 || !b.truck;
                          if (aUn && !bUn) return 1;
                          if (bUn && !aUn) return -1;
                          if (!aUn && !bUn && ia !== ib) return ia - ib;
                          return (a.truck || '').localeCompare(b.truck || '', 'sv');
                        });
                        const isJumpHighlight = day === jumpTargetDay;
                        const isToday = day === todayISO;
                        return (
                          <div key={day}
                               id={`calday-${day}`}
                               onClick={() => scheduleSelectedOnDay(day)}
                               onDragOver={allowDrop}
                               onDrop={e => onDropDay(e, day)}
                               style={{ minWidth: 160, border: isJumpHighlight ? '2px solid #f59e0b' : (selectedProjectId ? '2px dashed #fbbf24' : (isToday ? '2px solid #60a5fa' : '1px solid rgba(148,163,184,0.4)')), boxShadow: isJumpHighlight ? '0 0 0 4px rgba(245,158,11,0.35)' : (isToday ? '0 0 0 3px rgba(59,130,246,0.25)' : '0 1px 2px rgba(0,0,0,0.05)'), borderRadius: 10, padding: 8, background: '#ffffff', display: 'flex', flexDirection: 'column', gap: 6, position: 'relative', cursor: selectedProjectId ? 'copy' : 'default' }}>
                            <div style={{ fontSize: 11, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#111827' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span>{day.slice(8, 10)}/{day.slice(5, 7)}</span>
                                {isToday && (
                                  <span aria-label="Idag" title="Idag" style={{ fontSize: 9, color: '#1d4ed8', background: '#dbeafe', border: '1px solid #93c5fd', padding: '0px 6px', borderRadius: 999 }}>Idag</span>
                                )}
                              </span>
                              {items.length > 0 && <span style={{ fontSize: 10, background: '#f3f4f6', padding: '2px 6px', borderRadius: 12 }}>{items.length}</span>}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {items.map(it => {
                                let display: null | { bg: string; border: string; text: string } = null;
                                if (it.color) {
                                  const hex = it.color.startsWith('#') ? it.color.slice(1) : it.color;
                                  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
                                    const r = parseInt(hex.slice(0, 2), 16);
                                    const g = parseInt(hex.slice(2, 4), 16);
                                    const b = parseInt(hex.slice(4, 6), 16);
                                    const lighten = (ch: number) => Math.round(ch + (255 - ch) * 0.85);
                                    const lr = lighten(r), lg = lighten(g), lb = lighten(b);
                                    const bg = `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
                                    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                                    const text = brightness < 110 ? '#ffffff' : '#111827';
                                    display = { bg, border: '#' + hex, text };
                                  }
                                } else if (it.truck) {
                                  display = truckColors[it.truck];
                                }
                                const cardBorder = display ? display.border : '#c7d2fe';
                                const cardBg = display ? display.bg : '#eef2ff';
                                const highlight = calendarSearch && (it.project.name.toLowerCase().includes(searchVal) || (it.project.orderNumber || '').toLowerCase().includes(searchVal));
                                const isMid = (it as any).spanMiddle;
                                const isStart = (it as any).spanStart;
                                // Compute ordering position and controls for this card within same-truck group
                                const groupSameTruck = items.filter(x => x.truck === it.truck);
                                const groupSorted = [...groupSameTruck].sort((a2, b2) => {
                                  const sa2 = scheduledSegments.find(s => s.id === a2.segmentId)?.sortIndex ?? null;
                                  const sb2 = scheduledSegments.find(s => s.id === b2.segmentId)?.sortIndex ?? null;
                                  if (sa2 != null && sb2 != null && sa2 !== sb2) return sa2 - sb2;
                                  if (sa2 != null && sb2 == null) return -1;
                                  if (sb2 != null && sa2 == null) return 1;
                                  const ao2 = a2.project.orderNumber || '';
                                  const bo2 = b2.project.orderNumber || '';
                                  if (ao2 && bo2 && ao2 !== bo2) return ao2.localeCompare(bo2, 'sv');
                                  return a2.project.name.localeCompare(b2.project.name, 'sv');
                                });
                                const pos = groupSorted.findIndex(x => x.segmentId === it.segmentId);
                                const canShowOrder = isStart && it.truck && groupSorted.length > 1 && pos >= 0;
                                const moveWithinGroup = (delta: number) => {
                                  if (!canShowOrder) return;
                                  const next = [...groupSorted.map(x => x.segmentId)];
                                  const from = pos;
                                  const to = from + delta;
                                  if (to < 0 || to >= next.length) return;
                                  const [moved] = next.splice(from, 1);
                                  next.splice(to, 0, moved);
                                  setSequentialSortForSegments(next);
                                };
                                return (
                                  <div key={`${it.segmentId}:${it.day}`} draggable onDragStart={e => onDragStart(e, it.segmentId)} onDragEnd={onDragEnd} onDoubleClick={() => openSegmentEditorForExisting(it.segmentId)} style={{ position: 'relative', border: `2px solid ${highlight ? '#f59e0b' : cardBorder}`, background: cardBg, borderRadius: 6, padding: 6, fontSize: 11, cursor: 'grab', display: 'grid', gap: 4, opacity: isMid ? 0.95 : 1, boxShadow: highlight ? '0 0 0 3px rgba(245,158,11,0.35)' : 'none' }}>
                                    {/* order controls moved to bottom control section */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <span style={{ fontWeight: 600, color: display ? display.text : '#312e81', display: 'flex', alignItems: 'center', columnGap: 6, rowGap: 2, flexWrap: 'wrap' }}>
                                        {it.project.orderNumber ? (
                                          <span style={{ fontFamily: 'ui-monospace, monospace', background: '#ffffff', color: display ? display.text : '#312e81', border: `1px solid ${cardBorder}`, padding: '1px 4px', borderRadius: 4, whiteSpace: 'nowrap' }} title="Ordernummer">#{it.project.orderNumber}</span>
                                        ) : null}
                                        <span style={{ color: display ? display.text : '#312e81', fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{it.project.name}</span>
                                        <button type="button" onClick={(e) => { e.stopPropagation(); openProjectModal(it.project.id); }} className="icon-btn" title="Öppna projekt" aria-label="Öppna projekt" style={{ display: 'inline-flex', alignItems: 'center', flex: '0 0 auto' }}>
                                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                                          <span style={{ fontWeight: 600, fontSize: 12 }}>Öppna projekt</span>
                                        </button>
                                        <button type="button"
                                          onClick={(e) => { e.stopPropagation(); setSelectedProjectId(it.project.id); }}
                                          className="btn--plain btn--xs"
                                          title="Lägg till ny separat dag"
                                          style={{ fontSize: 9, background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#047857', borderRadius: 4, padding: '1px 4px' }}
                                        >
                                          Lägg till dag
                                        </button>
                                        {/* EK badge moved to bottom */}
                                      </span>
                                      {isStart && <span style={{ color: display ? display.text : '#6366f1' }}>{it.project.customer}</span>}
                                      {isStart && it.project.salesResponsible && <span style={{ fontSize: 9, color: display ? display.text : '#334155', background:'#ffffff40', padding:'1px 5px', borderRadius: 10, border:`1px solid ${cardBorder}55` }}>Sälj: {it.project.salesResponsible}</span>}
                                      {isStart && rowCreatorLabel(it.segmentId) && (
                                        <CreatorAvatar segmentId={it.segmentId} />
                                      )}
                                      {(it.bagCount != null || it.jobType) && (
                                        <span style={{ fontSize: 10, color: display ? display.text : '#374151' }}>
                                          {it.bagCount != null ? `${it.bagCount} säckar` : ''}
                                          {it.bagCount != null && it.jobType ? ' • ' : ''}
                                          {it.jobType || ''}
                                        </span>
                                      )}
                                      {isStart && it.truck && (() => { const team = truckTeamNames(it.truck); return team.length ? <span style={{ fontSize: 9, color: display ? display.text : '#334155', background:'#ffffff30', padding:'1px 5px', borderRadius: 10, border:`1px solid ${cardBorder}40` }}>Team: {team.join(', ')}</span> : null; })()}
                                      {isStart && hasEgenkontroll(it.project.orderNumber) && (() => { const pth = egenkontrollPath(it.project.orderNumber); return (
                                        <a href={pth ? `/api/storage/download?path=${encodeURIComponent(pth)}` : '#'} target="_blank" rel="noopener noreferrer" style={{ textDecoration:'none', fontSize:9, background:'#059669', color:'#fff', padding:'1px 5px', borderRadius:8, alignSelf:'flex-start', border:'1px solid #047857', display:'inline-flex', gap:4, alignItems:'center', cursor:'pointer' }} title={pth ? 'Öppna egenkontroll (PDF)' : 'Egenkontroll hittad'}>
                                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display:'block' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 12v6"/><path d="M9 15l3 3 3-3"/></svg>
                                          Rapporterad
                                        </a>
                                      ); })()}
                                      {/* Depot info shown; overrides are edited in modal */}
                                      {(() => {
                                        const seg = scheduledSegments.find(s => s.id === it.segmentId);
                                        const overrideId = seg?.depotId || null;
                                        const truckRec = it.truck ? planningTrucks.find(t => t.name === it.truck) : null;
                                        const effectiveId = overrideId ?? (truckRec?.depot_id ?? null);
                                        const eff = effectiveId ? depots.find(d => d.id === effectiveId) : null;
                                        return (
                                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ fontSize: 9, color: display ? display.text : '#475569', background:'#f1f5f9', padding:'1px 5px', borderRadius:12, border:`1px solid ${cardBorder}55` }}>Depå: {eff ? eff.name : 'Ingen'}</span>
                                          </span>
                                        );
                                      })()}
                                    </div>
                                    {/* Inline card controls removed; edits happen in Segment Editor modal */}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {viewMode === 'dayList' && (
            <div style={{ display: 'grid', gap: 16 }}>
              {/* Weekly truck grid: for each week, render header and rows per truck */}
              {weeks.map((week, wi) => {
                // Collect all items for days in this week for filtering and deciding unassigned row
                const weekDays = week.map(c => c.date).filter(Boolean) as string[];
                const searchVal = calendarSearch.trim().toLowerCase();
                const dayHeaderBg = wi % 2 === 0 ? '#f1f5f9' : '#e5e7eb';
                const firstDay = week.find(c => c.date)?.date;
                if (selectedWeekKey) {
                  if (!firstDay || isoWeekKey(firstDay) !== selectedWeekKey) return null;
                }
                // Determine which weekend days to include based on whether they have any filtered items
                const dayHasAny = (weekdayIdx: number) => {
                  const cell = week[weekdayIdx];
                  const day = cell?.date;
                  if (!day) return false;
                  const raw = itemsByDay.get(day) || [];
                  const filtered = raw.filter(it => {
                    if (truckFilter) {
                      if (truckFilter === 'UNASSIGNED') { if (it.truck) return false; }
                      else if (it.truck !== truckFilter) return false;
                    }
                    if (salesFilter) {
                      if (salesFilter === '__NONE__') { if (it.project.salesResponsible) return false; }
                      else if ((it.project.salesResponsible || '').toLowerCase() !== salesFilter.toLowerCase()) return false;
                    }
                    if (searchVal) {
                      const hay = [it.project.name, it.project.orderNumber || '', it.project.customer, it.jobType || '', (it.bagCount != null ? String(it.bagCount) : '')].join(' ').toLowerCase();
                      if (!hay.includes(searchVal)) return false;
                    }
                    return true;
                  });
                  return filtered.length > 0;
                };
                const includeSat = dayHasAny(5);
                const includeSun = dayHasAny(6);
                const visibleIndices = [0,1,2,3,4].concat(includeSat ? [5] : []).concat(includeSun ? [6] : []);
                // Determine if there is any unassigned item in this week
                let hasUnassigned = false;
                for (const day of weekDays) {
                  const raw = itemsByDay.get(day) || [];
                  const filtered = raw.filter(it => {
                    if (truckFilter) {
                      if (truckFilter === 'UNASSIGNED') { if (it.truck) return false; }
                      else if (it.truck !== truckFilter) return false;
                    }
                    if (salesFilter) {
                      if (salesFilter === '__NONE__') { if (it.project.salesResponsible) return false; }
                      else if ((it.project.salesResponsible || '').toLowerCase() !== salesFilter.toLowerCase()) return false;
                    }
                    if (searchVal) {
                      const hay = [it.project.name, it.project.orderNumber || '', it.project.customer, it.jobType || '', (it.bagCount != null ? String(it.bagCount) : '')].join(' ').toLowerCase();
                      if (!hay.includes(searchVal)) return false;
                    }
                    return true;
                  });
                  if (filtered.some(it => !it.truck)) { hasUnassigned = true; break; }
                }
                const rows = [...trucks, ...(hasUnassigned ? ['__UNASSIGNED__'] : [])];
                const rowCount = rows.length;
                const weekNum = firstDay ? isoWeekNumber(firstDay) : '';
                const weekContainsToday = week.some(c => c.date === todayISO);
                return (
                  <div key={wi} style={{ display: 'grid', gap: 8, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', padding: 8 }}>
                    {/* Compact week label header */}
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color:'#0f172a', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius: 999, padding: '2px 8px' }}>{weekNum && `v${weekNum}`}</span>
                        {weekContainsToday && (
                          <span aria-label="Denna vecka innehåller idag" title="Denna vecka innehåller idag" style={{ fontSize: 10, color:'#1d4ed8', background:'#dbeafe', border:'1px solid #93c5fd', borderRadius:999, padding:'1px 6px' }}>Idag</span>
                        )}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(${visibleIndices.length}, 1fr)`, alignItems: 'center', gap: 6 }}>
                      {/* Header row: truck label col + 7 weekday headers */}
                      <div style={{ gridColumn: '1 / 2', fontSize: 12, fontWeight: 600, color:'#374151', textAlign:'left' }}>Lastbil</div>
                      {visibleIndices.map((idx, vi) => {
                        const cellDate = week[idx]?.date;
                        const isTodayHeader = cellDate === todayISO;
                        return (
                          <div key={`hdr-${idx}`} style={{ gridColumn: `${2 + vi} / ${3 + vi}`, background: dayHeaderBg, border: isTodayHeader ? '2px solid #60a5fa' : '1px solid #e5e7eb', boxShadow: isTodayHeader ? '0 0 0 3px rgba(59,130,246,0.25)' : undefined, borderRadius: 8, textAlign: 'center', padding: '4px 0', fontSize: 12, fontWeight: 600, color: '#374151' }}>{dayNames[idx]}</div>
                        );
                      })}
                      {/* Rows per truck */}
                      {rows.map((rowKey, ri) => (
                        <>
                          {/* Row background band with zebra striping and truck color accent */}
                          {(() => { const disp = rowKey !== '__UNASSIGNED__' ? truckColors[rowKey] : null; const laneColor = disp?.border || '#cbd5e1'; const zebra = ri % 2 === 0 ? '#ffffff' : '#f9fafb'; const endCol = 2 + visibleIndices.length; const style: React.CSSProperties = { gridColumn: `1 / ${endCol}`, gridRow: `${ri + 2} / ${ri + 3}`, background: zebra, borderLeft: `4px solid ${rowKey === '__UNASSIGNED__' ? '#cbd5e1' : laneColor}`, borderRadius: 8, opacity: 0.9 }; return <div key={`bg-${rowKey}`} style={style} />; })()}
                          <div key={`lbl-${rowKey}`} style={{ gridColumn: '1 / 2', gridRow: `${ri + 2} / ${ri + 3}`, fontSize: 12, fontWeight: 600, color:'#111827', display:'flex', alignItems:'center', gap: 8, flexWrap: 'wrap', paddingLeft: 8 }}>
                            {(() => { const disp = rowKey !== '__UNASSIGNED__' ? truckColors[rowKey] : null; const sw = { width: 12, height: 12, borderRadius: 4, border: `2px solid ${disp?.border || '#94a3b8'}`, background: '#fff' } as React.CSSProperties; return <span key={`sw-${rowKey}`} style={sw} />; })()}
                            <span>{rowKey === '__UNASSIGNED__' ? 'Ingen lastbil' : rowKey}</span>
                            {rowKey !== '__UNASSIGNED__' && (() => { const team = truckTeamNames(rowKey); return team.length ? (
                              <span style={{ fontSize: 10, fontWeight: 500, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 999, padding: '1px 8px' }} title={`Team: ${team.join(', ')}`}>
                                Team: {team.join(', ')}
                              </span>
                            ) : null; })()}
                            {(() => {
                              // Weekly total bags for this truck: count only span starts within this week
                              let sum = 0;
                              for (const day of weekDays) {
                                const raw = itemsByDay.get(day) || [];
                                const list = raw.filter(it => {
                                  const matchTruck = rowKey === '__UNASSIGNED__' ? !it.truck : it.truck === rowKey;
                                  if (!matchTruck) return false;
                                  if (truckFilter) {
                                    if (truckFilter === 'UNASSIGNED') { if (it.truck) return false; }
                                    else if (it.truck !== truckFilter) return false;
                                  }
                                  if (salesFilter) {
                                    if (salesFilter === '__NONE__') { if (it.project.salesResponsible) return false; }
                                    else if ((it.project.salesResponsible || '').toLowerCase() !== salesFilter.toLowerCase()) return false;
                                  }
                                  if (searchVal) {
                                    const hay = [it.project.name, it.project.orderNumber || '', it.project.customer, it.jobType || '', (it.bagCount != null ? String(it.bagCount) : '')].join(' ').toLowerCase();
                                    if (!hay.includes(searchVal)) return false;
                                  }
                                  return true;
                                });
                                for (const it of list) {
                                  const isStart = (it as any).spanStart;
                                  if (!isStart) continue; // only count the start day of a span
                                  if (typeof it.bagCount === 'number' && it.bagCount > 0) sum += it.bagCount;
                                }
                              }
                              return sum > 0 ? (
                                <span style={{ fontSize: 10, fontWeight: 600, color: '#334155', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 999, padding: '1px 8px' }} title={`Totalt säckar denna vecka: ${sum}`}>
                                  {sum} säckar
                                </span>
                              ) : null;
                            })()}
                          </div>
                          {visibleIndices.map((weekdayIdx, vi) => {
                            const day = week[weekdayIdx]?.date || null;
                            const raw = day ? (itemsByDay.get(day) || []) : [];
                            const list = raw.filter(it => {
                              const matchTruck = rowKey === '__UNASSIGNED__' ? !it.truck : it.truck === rowKey;
                              if (!matchTruck) return false;
                              if (truckFilter) {
                                if (truckFilter === 'UNASSIGNED') { if (it.truck) return false; }
                                else if (it.truck !== truckFilter) return false;
                              }
                              if (salesFilter) {
                                if (salesFilter === '__NONE__') { if (it.project.salesResponsible) return false; }
                                else if ((it.project.salesResponsible || '').toLowerCase() !== salesFilter.toLowerCase()) return false;
                              }
                              if (searchVal) {
                                const hay = [it.project.name, it.project.orderNumber || '', it.project.customer, it.jobType || '', (it.bagCount != null ? String(it.bagCount) : '')].join(' ').toLowerCase();
                                if (!hay.includes(searchVal)) return false;
                              }
                              return true;
                            })
                            .sort((a, b) => {
                              const sa = scheduledSegments.find(s => s.id === a.segmentId)?.sortIndex ?? null;
                              const sb = scheduledSegments.find(s => s.id === b.segmentId)?.sortIndex ?? null;
                              if (sa != null && sb != null && sa !== sb) return sa - sb;
                              if (sa != null && sb == null) return -1;
                              if (sb != null && sa == null) return 1;
                              const ao = a.project.orderNumber || '';
                              const bo = b.project.orderNumber || '';
                              if (ao && bo && ao !== bo) return ao.localeCompare(bo, 'sv');
                              return a.project.name.localeCompare(b.project.name, 'sv');
                            });
                            const isJumpHighlight = !!day && day === jumpTargetDay;
                            const disp = rowKey !== '__UNASSIGNED__' ? truckColors[rowKey] : null;
                            const laneColor = disp?.border || '#cbd5e1';
                            const gridCol = 2 + vi;
                            const isTodayCell = !!day && day === todayISO;
                            return (
                              <div key={`cell-${rowKey}-${weekdayIdx}-${day || 'x'}`} id={day ? `calday-${day}` : undefined}
                                   onClick={day ? () => scheduleSelectedOnDay(day) : undefined}
                                   onDragOver={allowDrop}
                                   onDrop={day ? (e => onDropDay(e, day)) : undefined}
                                  style={{ gridColumn: `${gridCol} / ${gridCol + 1}`, gridRow: `${ri + 2} / ${ri + 3}`, minHeight: 48, border: isJumpHighlight ? '2px solid #f59e0b' : (selectedProjectId ? '2px dashed #fbbf24' : (isTodayCell ? '2px solid #60a5fa' : '1px solid rgba(148,163,184,0.35)')), boxShadow: isTodayCell ? '0 0 0 2px rgba(59,130,246,0.18)' : undefined, borderRadius: 8, padding: 6, background: '#ffffff', display: 'flex', flexDirection: 'column', gap: 4, borderLeft: `4px solid ${rowKey === '__UNASSIGNED__' ? '#cbd5e1' : laneColor}` }}>
                                {list.length === 0 && <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>}
                                {list.map(it => {
                                  let display: null | { bg: string; border: string; text: string } = null;
                                  if (it.color) {
                                    const hex = it.color.startsWith('#') ? it.color.slice(1) : it.color;
                                    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
                                      const r = parseInt(hex.slice(0, 2), 16);
                                      const g = parseInt(hex.slice(2, 4), 16);
                                      const b = parseInt(hex.slice(4, 6), 16);
                                      const lighten = (ch: number) => Math.round(ch + (255 - ch) * 0.85);
                                      const lr = lighten(r), lg = lighten(g), lb = lighten(b);
                                      const bg = `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
                                      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                                      const text = brightness < 110 ? '#ffffff' : '#111827';
                                      display = { bg, border: '#' + hex, text };
                                    }
                                  } else if (it.truck) {
                                    display = truckColors[it.truck];
                                  }
                                  const cardBorder = display ? display.border : '#c7d2fe';
                                  const cardBg = display ? display.bg : '#eef2ff';
                                  const highlight = calendarSearch && (it.project.name.toLowerCase().includes(searchVal) || (it.project.orderNumber || '').toLowerCase().includes(searchVal));
                                  const isMid = (it as any).spanMiddle;
                                  const isStart = (it as any).spanStart;
                                  return (
                                    <div key={`${it.segmentId}:${it.day}`} draggable onDragStart={e => onDragStart(e, it.segmentId)} onDragEnd={onDragEnd}
                                         style={{ position: 'relative', border: `2px solid ${highlight ? '#f59e0b' : cardBorder}`, background: cardBg, borderRadius: 6, padding: 6, fontSize: 11, cursor: 'grab', display: 'grid', gap: 4, opacity: isMid ? 0.95 : 1 }}>
                                      <span style={{ fontWeight: 600, color: display ? display.text : '#312e81', display: 'flex', alignItems: 'center', columnGap: 6, rowGap: 2, flexWrap: 'wrap' }}>
                                        {it.project.orderNumber ? (
                                            <span style={{ fontFamily: 'ui-monospace, monospace', background: '#ffffff', color: display ? display.text : '#312e81', border: `1px solid ${cardBorder}`, padding: '1px 4px', borderRadius: 4, whiteSpace: 'nowrap' }} title="Ordernummer">#{it.project.orderNumber}</span>
                                          ) : null}
                                          <span style={{ color: display ? display.text : '#312e81', fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{it.project.name}</span>
                                          <button type="button" onClick={(e) => { e.stopPropagation(); openProjectModal(it.project.id); }} className="icon-btn" title="Öppna projekt" aria-label="Öppna projekt" style={{ display: 'inline-flex', alignItems: 'center', flex: '0 0 auto' }}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                                            <span style={{ fontWeight: 600, fontSize: 12 }}>Öppna projekt</span>
                                          </button>
                                          <button type="button"
                                            onClick={(e) => { e.stopPropagation(); setSelectedProjectId(it.project.id); }}
                                            className="btn--plain btn--xs"
                                            title="Lägg till ny separat dag"
                                            style={{ fontSize: 9, background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#047857', borderRadius: 4, padding: '1px 4px' }}
                                          >
                                            lägg till ny dag
                                          </button>
                                      </span>
                                      {(it.bagCount != null || it.jobType) && (
                                        <span style={{ fontSize: 10, color: display ? display.text : '#374151' }}>
                                          {it.bagCount != null ? `${it.bagCount} säckar` : ''}
                                          {it.bagCount != null && it.jobType ? ' • ' : ''}
                                          {it.jobType || ''}
                                        </span>
                                      )}
                                      {isStart && scheduleMeta[it.project.id]?.actual_bags_used != null && (
                                        <span style={{ fontSize: 9, color: display ? display.text : '#1e293b', background:'#ffffff50', padding:'2px 5px', borderRadius:10, border:`1px solid ${cardBorder}55` }} title={`Rapporterat: ${scheduleMeta[it.project.id]?.actual_bags_used} säckar`}>
                                          säckar blåsta {scheduleMeta[it.project.id]!.actual_bags_used} st
                                        </span>
                                      )}
                                      {isStart && hasEgenkontroll(it.project.orderNumber) && (() => { const pth = egenkontrollPath(it.project.orderNumber); return (
                                        <a href={pth ? `/api/storage/download?path=${encodeURIComponent(pth)}` : '#'} target="_blank" rel="noopener noreferrer" style={{ textDecoration:'none', fontSize:9, background:'#059669', color:'#fff', padding:'1px 5px', borderRadius:8, alignSelf:'flex-start', border:'1px solid #047857', display:'inline-flex', gap:4, alignItems:'center', cursor:'pointer' }} title={pth ? 'Öppna egenkontroll (PDF)' : 'Egenkontroll hittad'}>
                                          Rapporterad
                                        </a>
                                      ); })()}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Small floating panel showing all found distinct customer emails
function EmailSummaryPanel({ projects }: { projects: Project[] }) {
  const [open, setOpen] = useState(false);
  const emails = useMemo(() => {
    const map = new Map<string, { email: string; customers: Set<string>; projectIds: Set<string> }>();
    for (const p of projects) {
      if (!p.customerEmail) continue;
      const key = p.customerEmail.toLowerCase();
      if (!map.has(key)) map.set(key, { email: p.customerEmail, customers: new Set(), projectIds: new Set() });
      const entry = map.get(key)!;
      entry.customers.add(p.customer);
      entry.projectIds.add(p.id);
    }
    return Array.from(map.values()).sort((a, b) => a.email.localeCompare(b.email));
  }, [projects]);
  const total = emails.length;
  const copyAll = () => {
    const list = emails.map(e => e.email).join(', ');
    navigator.clipboard.writeText(list).catch(() => {});
  };
  if (!total) return null;
  return (
    <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 20, maxWidth: 320, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#ffffffdd', backdropFilter: 'blur(4px)', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>E‑post ({total})</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setOpen(o => !o)} style={{ fontSize: 11, border: '1px solid #cbd5e1', background: '#fff', padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}>{open ? 'Göm' : 'Visa'}</button>
            <button onClick={copyAll} disabled={!total} title="Kopiera alla" style={{ fontSize: 11, border: '1px solid #2563eb', background: '#1d4ed8', color: '#fff', padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}>Kopiera</button>
          </div>
        </div>
        {open && (
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'grid', gap: 4 }}>
            {emails.map(e => (
              <div key={e.email} style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 6px', background: '#f8fafc', display: 'grid', gap: 2 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#1e293b', wordBreak: 'break-all' }}>{e.email}</div>
                <div style={{ fontSize: 10, color: '#475569', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <span style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: 4 }}>{e.customers.size} kund</span>
                  <span style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: 4 }}>{e.projectIds.size} proj</span>
                  <button onClick={() => navigator.clipboard.writeText(e.email).catch(() => {})} style={{ fontSize: 10, border: '1px solid #cbd5e1', background: '#fff', padding: '0 4px', borderRadius: 4, cursor: 'pointer' }}>kopiera</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

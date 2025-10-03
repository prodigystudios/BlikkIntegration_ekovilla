"use client";
export const dynamic = 'force-dynamic';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';

// Types
interface Project {
  id: string;
  name: string;
  orderNumber?: string | null;
  customer: string;
  createdAt: string;
  status: string;
  isManual?: boolean; // local only flag
  salesResponsible?: string | null; // from Blikk API (who created / sales responsible)
}
// Legacy ScheduledItem replaced by segment+meta model
interface ScheduledSegment {
  id: string;          // unique segment id
  projectId: string;   // reference Project.id
  startDay: string;    // YYYY-MM-DD inclusive
  endDay: string;      // inclusive
  createdBy?: string | null;
  createdByName?: string | null;
}

interface ProjectScheduleMeta {
  projectId: string;
  truck?: string | null;
  color?: string | null;
  bagCount?: number | null;
  jobType?: string | null;
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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingTruckFor, setEditingTruckFor] = useState<string | null>(null);
  const [truckFilter, setTruckFilter] = useState<string>('');
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
  interface TruckRec { id: string; name: string; color?: string | null; team_member1_name?: string | null; team_member2_name?: string | null; }
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
  const jobTypes = ['Ekovilla', 'Vitull', 'Leverans', 'Utsugning', 'Snickerier', 'Övrigt'];

  // Fallback selection scheduling (if drag/drop misbehaves)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  // View mode: standard month grid or weekday lanes (all Mondays in a row, etc.)
  const [viewMode, setViewMode] = useState<'monthGrid' | 'weekdayLanes' | 'dayList'>('monthGrid');
  const [showCardControls, setShowCardControls] = useState(true);
  // UI hover state for backlog punch effect
  const [hoverBacklogId, setHoverBacklogId] = useState<string | null>(null);

  // Accent color generator for backlog cards (deterministic palette)
  function backlogAccent(p: Project) {
    if (p.isManual) return '#334155';
    const seed = p.name || p.id;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    const palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
    return palette[Math.abs(hash) % palette.length];
  }

  // Truck color overrides (base color for each truck -> derived palette)
  const [truckColorOverrides, setTruckColorOverrides] = useState<Record<string, string>>({
    ...defaultTruckColors
  });
  // Explicit save workflow for team names
  const [editingTeamNames, setEditingTeamNames] = useState<Record<string, { team1: string; team2: string }>>({});
  const [truckSaveStatus, setTruckSaveStatus] = useState<Record<string, { status: 'idle' | 'saving' | 'saved' | 'error'; ts: number }>>({});

  function deriveColors(baseHex: string) {
    let hex = baseHex.startsWith('#') ? baseHex.slice(1) : baseHex;
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) hex = '6366f1';
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const lighten = (ch: number) => Math.round(ch + (255 - ch) * 0.85);
    const lr = lighten(r), lg = lighten(g), lb = lighten(b);
    const bg = `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    const text = brightness < 110 ? '#ffffff' : '#111827';
    return { border: '#' + hex, bg, text };
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
  const normalized: Project[] = (j.projects || []).map((p: any) => ({ ...p, id: String(p.id), orderNumber: p.orderNumber ?? null, salesResponsible: p.salesResponsible ?? null }));
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
      isManual: true
    };
    setProjects(prev => [proj, ...prev]);
    setManualName('');
    setManualCustomer('');
    setManualOrderNumber('');
  }

  // Initial fetch
  useEffect(() => {
    (async () => {
      try {
        setError(null);
        const res = await fetch('/api/blikk/projects');
        const j = await res.json();
        if (!res.ok) setError(j.error || 'Fel vid hämtning');
  const normalized: Project[] = (j.projects || []).map((p: any) => ({ ...p, id: String(p.id), orderNumber: p.orderNumber ?? null, salesResponsible: p.salesResponsible ?? null }));
        setProjects(normalized);
        setSource(j.source || null);
      } catch (e: any) {
        setError(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load persisted schedule + meta
  const supabase = createClientComponentClient();
  const [syncing, setSyncing] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting'|'live'|'error'>('connecting');
  const pendingOps = useRef<Promise<any>[]>([]);
  const createdIdsRef = useRef<Set<string>>(new Set());

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
            setPlanningTrucks(trucksData.map(t => ({ id: t.id, name: t.name, color: t.color, team_member1_name: t.team_member1_name, team_member2_name: t.team_member2_name })));
            setTruckColorOverrides(prev => {
              const c = { ...prev };
              for (const t of trucksData) if (t.color) c[t.name] = t.color;
              return c;
            });
          }
        } catch (e) { console.warn('[planning] could not load trucks', e); }
        // Normalize into local shapes
        if (Array.isArray(segs)) {
          setScheduledSegments(segs.map(s => ({ id: s.id, projectId: s.project_id, startDay: s.start_day, endDay: s.end_day, createdBy: s.created_by, createdByName: s.created_by_name })));
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
                  isManual: s.is_manual
                });
              }
            }
            return Array.from(map.values());
          });
        }
        if (Array.isArray(metas)) {
          const metaObj: any = {};
            for (const m of metas) metaObj[m.project_id] = { projectId: m.project_id, truck: m.truck, bagCount: m.bag_count, jobType: m.job_type, color: m.color };
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
          setScheduledSegments(prev => prev.some(s => s.id === row.id) ? prev : [...prev, { id: row.id, projectId: row.project_id, startDay: row.start_day, endDay: row.end_day, createdBy: row.created_by, createdByName: row.created_by_name }]);
          setProjects(prev => prev.some(p => p.id === row.project_id) ? prev : [...prev, {
            id: row.project_id,
            name: row.project_name,
            customer: row.customer || '',
            orderNumber: row.order_number || null,
            createdAt: row.created_at || new Date().toISOString(),
            status: row.is_manual ? 'MANUELL' : 'PLAN',
            isManual: row.is_manual
          }]);
        } else if (payload.eventType === 'UPDATE') {
          setScheduledSegments(prev => prev.map(s => s.id === row.id ? { ...s, startDay: row.start_day, endDay: row.end_day, createdByName: row.created_by_name ?? s.createdByName } : s));
        } else if (payload.eventType === 'DELETE') {
          setScheduledSegments(prev => prev.filter(s => s.id !== row.id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_project_meta' }, payload => {
        const row: any = payload.new || payload.old;
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          setScheduleMeta(prev => ({ ...prev, [row.project_id]: { projectId: row.project_id, truck: row.truck, bagCount: row.bag_count, jobType: row.job_type, color: row.color } }));
        } else if (payload.eventType === 'DELETE') {
          setScheduleMeta(prev => { const c = { ...prev }; delete c[row.project_id]; return c; });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_trucks' }, payload => {
        const row: any = payload.new || payload.old;
        if (payload.eventType === 'INSERT') {
          setPlanningTrucks(prev => prev.some(t => t.id === row.id) ? prev : [...prev, { id: row.id, name: row.name, color: row.color, team_member1_name: row.team_member1_name, team_member2_name: row.team_member2_name }]);
          if (row.color) setTruckColorOverrides(prev => ({ ...prev, [row.name]: row.color }));
        } else if (payload.eventType === 'UPDATE') {
          setPlanningTrucks(prev => prev.map(t => t.id === row.id ? { id: row.id, name: row.name, color: row.color, team_member1_name: row.team_member1_name, team_member2_name: row.team_member2_name } : t));
          if (row.color) setTruckColorOverrides(prev => ({ ...prev, [row.name]: row.color }));
        } else if (payload.eventType === 'DELETE') {
          setPlanningTrucks(prev => prev.filter(t => t.id !== row.id));
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
    };
  }, [currentUserId, supabase]);

  // Helper to queue writes (single definition)
  function enqueue(pLike: Promise<any> | PromiseLike<any>) {
    const p = Promise.resolve(pLike);
    pendingOps.current.push(p);
    p.finally(() => { pendingOps.current = pendingOps.current.filter(x => x !== p); });
  }

  // Persist segment create/update/delete
  const persistSegmentCreate = useCallback((seg: ScheduledSegment, project: Project) => {
    // Avoid duplicate attempts if local diff logic fires twice before realtime echo
    const payload = {
      id: seg.id,
      project_id: project.id,
      project_name: project.name,
      customer: project.customer,
      order_number: project.orderNumber,
      source: project.isManual ? 'manual' : 'blikk',
      is_manual: project.isManual,
      start_day: seg.startDay,
      end_day: seg.endDay,
      created_by: currentUserId,
      created_by_name: currentUserName || currentUserId || project.customer || 'Okänd'
    } as const;
    if (createdIdsRef.current.has(seg.id)) {
      return; // already attempted
    }
    createdIdsRef.current.add(seg.id);
    console.debug('[planning] upserting segment', payload);
    enqueue(supabase.from('planning_segments')
      .upsert(payload, { onConflict: 'id', ignoreDuplicates: true })
      .select('id')
      .then(({ data, error }) => {
        if (error && error.code !== '23505') console.warn('[persist create seg] error', error);
        else if (!error) console.debug('[planning] upsert ok', data);
      })
    );
  }, [supabase, currentUserId, currentUserName]);

  const persistSegmentUpdate = useCallback((seg: ScheduledSegment) => {
    enqueue(supabase.from('planning_segments').update({ start_day: seg.startDay, end_day: seg.endDay }).eq('id', seg.id).select('id').then(({ data, error }) => { if (error) console.warn('[persist update seg] error', error); else console.debug('[planning] update ok', data); }));
  }, [supabase]);

  const persistSegmentDelete = useCallback((segmentId: string) => {
    enqueue(supabase.from('planning_segments').delete().eq('id', segmentId).select('id').then(({ data, error }) => { if (error) console.warn('[persist delete seg] error', error); else console.debug('[planning] delete ok', data); }));
  }, [supabase]);

  // Truck helpers (admin guarded by RLS; UI also hides for non-admin)
  const createTruck = useCallback(async () => {
    const name = newTruckName.trim();
    if (!name) return;
    setNewTruckName('');
    const payload: any = { name };
    if (currentUserId) payload.created_by = currentUserId;
    enqueue(
      supabase.from('planning_trucks')
        .insert(payload)
        .select('id,name')
        .then(({ data, error }) => {
          if (error) console.warn('[planning] createTruck error', error);
          else console.debug('[planning] createTruck ok', data);
        })
    );
  }, [newTruckName, supabase, currentUserId]);

  const updateTruckColor = useCallback((truck: TruckRec, color: string) => {
    setTruckColorOverrides(prev => ({ ...prev, [truck.name]: color }));
    enqueue(supabase.from('planning_trucks').update({ color }).eq('id', truck.id));
  }, [supabase]);

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
      const cur = prev[truck.id] || { team1: truck.team_member1_name || '', team2: truck.team_member2_name || '' };
      return { ...prev, [truck.id]: { ...cur, [idx === 1 ? 'team1' : 'team2']: value } };
    });
  }, []);

  const saveTruckTeamNames = useCallback((truck: TruckRec) => {
    const draft = editingTeamNames[truck.id] || { team1: truck.team_member1_name || '', team2: truck.team_member2_name || '' };
    setTruckSaveStatus(prev => ({ ...prev, [truck.id]: { status: 'saving', ts: Date.now() } }));
    enqueue(
      supabase.from('planning_trucks')
        .update({ team_member1_name: draft.team1 || null, team_member2_name: draft.team2 || null })
        .eq('id', truck.id)
        .select('id, team_member1_name, team_member2_name')
        .then(({ data, error }) => {
          setTruckSaveStatus(prev => ({ ...prev, [truck.id]: { status: error ? 'error' : 'saved', ts: Date.now() } }));
          if (error) console.warn('[planning] saveTruckTeamNames error', error);
          if (!error && data && data[0]) {
            setPlanningTrucks(prev => prev.map(t => t.id === truck.id ? { ...t, team_member1_name: data[0].team_member1_name, team_member2_name: data[0].team_member2_name } : t));
          }
        })
    );
  }, [editingTeamNames, supabase]);

  const persistMetaUpsert = useCallback((projectId: string, meta: ProjectScheduleMeta) => {
    enqueue(supabase.from('planning_project_meta').upsert({
      project_id: projectId,
      truck: meta.truck,
      bag_count: meta.bagCount,
      job_type: meta.jobType,
      color: meta.color
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

  // Backlog lists
  const backlog = useMemo(() => projects.filter(p => !scheduledSegments.some(s => s.projectId === p.id) && !recentSearchedIds.includes(p.id)), [projects, scheduledSegments, recentSearchedIds]);
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
    // create meta if missing
    setScheduleMeta(m => m[proj.id] ? m : { ...m, [proj.id]: { projectId: proj.id, truck: null, bagCount: null, jobType: null, color: null } });
  const newSeg: ScheduledSegment = { id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2) ), projectId: proj.id, startDay: day, endDay: day };
    applyScheduledSegments(prev => [...prev, newSeg]);
    setTimeout(() => setEditingTruckFor(proj.id), 0);
  }

  // Click-based scheduling fallback: select a backlog project, then click a calendar day.
  function scheduleSelectedOnDay(day: string) {
    if (!selectedProjectId) return;
    const proj = projects.find(p => p.id === selectedProjectId);
    setSelectedProjectId(null);
    if (!proj) return;
    setScheduleMeta(m => m[proj.id] ? m : { ...m, [proj.id]: { projectId: proj.id } });
  const newSeg: ScheduledSegment = { id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2)), projectId: proj.id, startDay: day, endDay: day };
    applyScheduledSegments(prev => [...prev, newSeg]);
    setTimeout(() => setEditingTruckFor(proj.id), 0);
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
    <div style={{ padding: 16, display: 'grid', gap: 16 }}>
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

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '290px 1fr', alignItems: 'start' }}>
        {/* Left: search / manual add / backlog */}
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
                <div key={p.id} draggable onDragStart={e => onDragStart(e, p.id)} onDragEnd={onDragEnd} style={{ position: 'relative', border: '1px solid #6366f1', boxShadow: '0 0 0 3px rgba(99,102,241,0.25)', background: draggingId === p.id ? '#eef2ff' : '#ffffff', borderRadius: 8, padding: 10, cursor: 'grab', display: 'grid', gap: 4 }}>
                  <div style={{ position: 'absolute', top: -6, right: -6, background: '#6366f1', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 12 }}>Hittad</div>
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

        {/* Calendar */}
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
            <button type="button" className="btn--plain btn--sm" onClick={() => setShowCardControls(v => !v)} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>{showCardControls ? 'Dölj kontroller' : 'Visa kontroller'}</button>
          </div>
          {/* Legend */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#374151' }}>Sök i kalender:</label>
              <input value={calendarSearch} onChange={e => setCalendarSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (calendarMatchDays.length > 0) navigateToMatch((matchIndex + 1) % calendarMatchDays.length); } }} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 6px', fontSize: 12 }} placeholder="#1234 eller namn" />
              {calendarSearch && <button type="button" className="btn--plain btn--xs" style={{ fontSize: 11 }} onClick={() => setCalendarSearch('')}>X</button>}
              <button type="button" className="btn--plain btn--xs" disabled={!firstCalendarMatchDay} onClick={jumpToFirstMatch} style={{ fontSize: 11, border: '1px solid #d1d5db', borderRadius: 6, padding: '2px 8px', background: firstCalendarMatchDay ? '#fff' : '#f3f4f6', opacity: firstCalendarMatchDay ? 1 : 0.5 }}>Hoppa</button>
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#374151' }}>Lastbil:</label>
              <select value={truckFilter} onChange={e => setTruckFilter(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff' }}>
                <option value="">Alla</option>
                <option value="UNASSIGNED">(Ingen vald)</option>
                {trucks.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {truckFilter && <button type="button" className="btn--plain btn--xs" style={{ fontSize: 11 }} onClick={() => setTruckFilter('')}>Rensa</button>}
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#374151' }}>Sälj:</label>
              <select value={salesFilter} onChange={e => setSalesFilter(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff' }}>
                <option value="">Alla</option>
                <option value="__NONE__">(Ingen)</option>
                {distinctSales.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {salesFilter && <button type="button" className="btn--plain btn--xs" style={{ fontSize: 11 }} onClick={() => setSalesFilter('')}>Rensa</button>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, alignItems: 'stretch' }}>
            {trucks.map(tName => {
              const tRec = planningTrucks.find(pt => pt.name === tName);
              const c = truckColors[tName];
              const current = truckColorOverrides[tName] || defaultTruckColors[tName] || '#6366f1';
              if (!tRec) {
                return (
                  <div key={tName} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', minWidth: 170 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 16, height: 16, background: c.bg, border: `3px solid ${c.border}`, borderRadius: 6 }} />
                      <span style={{ fontWeight: 600, color: c.text }}>{tName}</span>
                    </div>
                  </div>
                );
              }
              const edit = editingTeamNames[tRec.id] || { team1: tRec.team_member1_name || '', team2: tRec.team_member2_name || '' };
              const changed = edit.team1 !== (tRec.team_member1_name || '') || edit.team2 !== (tRec.team_member2_name || '');
              const status = truckSaveStatus[tRec.id];
              return (
                <div key={tName} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', minWidth: 180, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 16, height: 16, background: c.bg, border: `3px solid ${c.border}`, borderRadius: 6 }} />
                    <span style={{ fontWeight: 600, color: c.text }}>{tName}</span>
                    {isAdmin && (
                      <input type="color" value={current} aria-label={`Ändra färg för ${tName}`} onChange={e => updateTruckColor(tRec, e.target.value)} style={{ width: 26, height: 26, padding: 0, border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', background: '#fff', marginLeft: 'auto' }} />
                    )}
                    {isAdmin && (
                      <button type="button" onClick={() => deleteTruck(tRec)} title="Ta bort" style={{ marginLeft: 4, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 10, padding: '4px 6px', borderRadius: 6, cursor: 'pointer' }}>✕</button>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <label style={{ fontSize: 10, color: '#475569' }}>Team 1</label>
                      <input disabled={!isAdmin} value={edit.team1} onChange={e => updateTruckTeamName(tRec, 1, e.target.value)} placeholder="Namn" style={{ fontSize: 11, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <label style={{ fontSize: 10, color: '#475569' }}>Team 2</label>
                      <input disabled={!isAdmin} value={edit.team2} onChange={e => updateTruckTeamName(tRec, 2, e.target.value)} placeholder="Namn" style={{ fontSize: 11, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
                    </div>
                    {isAdmin && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" disabled={!changed || status?.status === 'saving'} onClick={() => saveTruckTeamNames(tRec)} className="btn--plain btn--xs" style={{ fontSize: 10, padding: '4px 8px', background: changed ? '#e0f2fe' : '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, color: '#0369a1', opacity: changed ? 1 : 0.6 }}>Spara</button>
                        {status?.status === 'saving' && <span style={{ fontSize: 10, color: '#64748b' }}>Sparar…</span>}
                        {status?.status === 'saved' && <span style={{ fontSize: 10, color: '#059669' }}>✓ Sparad</span>}
                        {status?.status === 'error' && <span style={{ fontSize: 10, color: '#b91c1c' }}>Fel</span>}
                        {changed && !status && <span style={{ fontSize: 10, color: '#b45309' }}>Ej sparad</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '6px 8px', border: '1px dashed #94a3b8', borderRadius: 10, background: '#f8fafc', minWidth: 140 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#475569' }}>
                <span style={{ width: 14, height: 14, background: '#fff', border: '2px dashed #94a3b8', borderRadius: 4 }} /> Ingen
              </div>
              {isAdmin && (
                <form onSubmit={e => { e.preventDefault(); createTruck(); }} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <input value={newTruckName} onChange={e => setNewTruckName(e.target.value)} placeholder="Ny lastbil" style={{ fontSize: 11, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
                  <button type="submit" disabled={!newTruckName.trim()} className="btn--plain btn--xs" style={{ fontSize: 11, background: '#e0f2fe', border: '1px solid #7dd3fc', color: '#0369a1', borderRadius: 6, padding: '4px 6px' }}>Lägg till</button>
                </form>
              )}
            </div>
          </div>
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
                return (
                  <div key={wi} style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', gap: 8, background: weekBg, padding: 6, borderRadius: 12, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: 'rgba(255,255,255,0.65)', backdropFilter: 'blur(2px)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 8, color: '#1e293b', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>{weekNum && `v${weekNum}`}</div>
                    {week.map((cell, ci) => {
                      if (!cell.date) return <div key={ci} style={{ minHeight: 160, border: '1px solid transparent', borderRadius: 8 }} />;
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
                      });
                      const isJumpHighlight = day === jumpTargetDay;
                      return (
                        <div key={day}
                             id={`calday-${day}`}
                             onClick={() => scheduleSelectedOnDay(day)}
                             onDragOver={allowDrop}
                             onDrop={e => onDropDay(e, day)}
                             style={{ border: isJumpHighlight ? '2px solid #f59e0b' : (selectedProjectId ? '2px dashed #fbbf24' : '1px solid rgba(148,163,184,0.4)'), boxShadow: isJumpHighlight ? '0 0 0 4px rgba(245,158,11,0.35)' : '0 1px 2px rgba(0,0,0,0.05)', transition: 'box-shadow 0.3s,border 0.3s', borderRadius: 10, padding: 8, minHeight: 160, background: '#ffffff', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', cursor: selectedProjectId ? 'copy' : 'default' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#111827' }}>
                            <span>{day.slice(8, 10)}/{day.slice(5, 7)}</span>
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
                                <div key={`${it.segmentId}:${it.day}`} draggable onDragStart={e => onDragStart(e, it.segmentId)} onDragEnd={onDragEnd} style={{ position: 'relative', border: `2px solid ${highlight ? '#f59e0b' : cardBorder}`, background: cardBg, borderRadius: 6, padding: 6, fontSize: 12, cursor: 'grab', display: 'grid', gap: 4, opacity: isMid ? 0.95 : 1, boxShadow: highlight ? '0 0 0 3px rgba(245,158,11,0.35)' : 'none' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <span style={{ fontWeight: 600, color: display ? display.text : '#312e81' }}>
                                      {it.project.orderNumber ? <span style={{ fontFamily: 'ui-monospace, monospace', background: '#ffffff', color: display ? display.text : '#312e81', border: `1px solid ${cardBorder}`, padding: '1px 4px', borderRadius: 4, marginRight: 4 }}>#{it.project.orderNumber}</span> : null}
                                      {it.project.name}
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
                                    {isStart && it.truck && (() => { const team = truckTeamNames(it.truck); return team.length ? <span style={{ fontSize: 10, color: display ? display.text : '#334155', background:'#ffffff40', padding:'2px 6px', borderRadius: 10, border:`1px solid ${cardBorder}40` }}>Team: {team.join(', ')}</span> : null; })()}
                                  </div>
                                  {isStart && showCardControls && (
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                                      <div style={{ position: 'relative', display: 'inline-block' }}>
                                        <FieldPresence projectId={it.project.id} field="truck" />
                                        {editingTruckFor === it.project.id ? (
                                        <select autoFocus value={it.truck || ''} onChange={e => { const val = e.target.value || null; updateMeta(it.project.id, { truck: val }); setEditingTruckFor(null); broadcastEditStop(it.project.id); }} onBlur={() => { setEditingTruckFor(null); broadcastEditStop(it.project.id); }} style={{ fontSize: 11, padding: '2px 6px', border: `1px solid ${cardBorder}`, borderRadius: 6 }}>
                                          <option value="">Välj lastbil…</option>
                                          {trucks.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                      ) : (
                                        <button type="button" className="btn--plain btn--xs" onClick={() => { setEditingTruckFor(it.project.id); broadcastEditStart(it.project.id, 'truck', it.segmentId); }} style={{ fontSize: 11, border: `1px solid ${cardBorder}`, borderRadius: 4, padding: '2px 6px', background: '#fff', color: display ? display.text : '#312e81' }}>{it.truck ? `Lastbil: ${it.truck}` : 'Välj lastbil'}</button>
                                      )}
                                      </div>
                                      <div style={{ position: 'relative', display: 'inline-block' }}>
                                        <FieldPresence projectId={it.project.id} field="bagCount" />
                                      <input type="number" min={0} placeholder="Säckar" value={it.bagCount ?? ''} onFocus={() => broadcastEditStart(it.project.id, 'bagCount', it.segmentId)} onBlur={() => broadcastEditStop(it.project.id)} onChange={e => { const v = e.target.value; updateMeta(it.project.id, { bagCount: v === '' ? null : Math.max(0, parseInt(v, 10) || 0) }); }} style={{ width: 70, fontSize: 11, padding: '4px 6px', border: `1px solid ${cardBorder}`, borderRadius: 6 }} />
                                      </div>
                                      <div style={{ position: 'relative', display: 'inline-block' }}>
                                        <FieldPresence projectId={it.project.id} field="jobType" />
                                      <select value={it.jobType || ''} onFocus={() => broadcastEditStart(it.project.id, 'jobType', it.segmentId)} onBlur={() => broadcastEditStop(it.project.id)} onChange={e => { const v = e.target.value || null; updateMeta(it.project.id, { jobType: v }); }} style={{ fontSize: 11, padding: '4px 6px', border: `1px solid ${cardBorder}`, borderRadius: 6 }}>
                                        <option value="">Typ av jobb…</option>
                                        {jobTypes.map(j => <option key={j} value={j}>{j}</option>)}
                                      </select>
                                      </div>
                                      <div style={{ display: 'grid', gap: 4 }}>
                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                          <strong style={{ fontSize: 10 }}>Längd:</strong>
                                          <button type="button" className="btn--plain btn--xs" title="Förläng med föregående dag" onClick={() => extendSpan(it.segmentId, 'back')} style={{ fontSize: 10, padding: '6px 6px' }}>Förläng föregående</button>
                                          <button type="button" className="btn--plain btn--xs" title="Förläng med nästkommande dag" onClick={() => extendSpan(it.segmentId, 'forward')} style={{ fontSize: 10, padding: '6px 6px' }}>Förläng nästa</button>
                                          <button type="button" className="btn--plain btn--xs" title="Ta bort första dagen" disabled={(it as any).totalSpan <= 1} onClick={() => shrinkSpan(it.segmentId, 'start')} style={{ fontSize: 10, padding: '6px 6px', opacity: (it as any).totalSpan <= 1 ? 0.35 : 1 }}>Ta bort första</button>
                                          <button type="button" className="btn--plain btn--xs" title="Ta bort sista dagen" disabled={(it as any).totalSpan <= 1} onClick={() => shrinkSpan(it.segmentId, 'end')} style={{ fontSize: 10, padding: '6px 6px', opacity: (it as any).totalSpan <= 1 ? 0.35 : 1 }}>Ta bort sista</button>
                                          <span style={{ fontSize: 10, background: '#f1f5f9', padding: '2px 6px', borderRadius: 12, border: '1px solid #e2e8f0' }}>{(it as any).totalSpan} dagar</span>
                                        </div>
                                      </div>
                                      <button type="button" className="btn--plain btn--xs" onClick={() => unschedule(it.segmentId)} style={{ fontSize: 11, background: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 4, padding: '2px 6px' }}>Ta bort</button>
                                      <button type="button" className="btn--plain btn--xs" title="Ny separat dag" onClick={() => setSelectedProjectId(it.project.id)} style={{ fontSize: 11, background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#047857', borderRadius: 4, padding: '2px 6px' }}>Ny dag</button>
                                    </div>
                                  )}
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
                return (
                  <div key={name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ width: 60, fontSize: 12, fontWeight: 700, textAlign: 'center', padding: '6px 4px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8 }}>{name}</div>
                    <div style={{ flex: 1, overflowX: 'auto', display: 'flex', gap: 8 }}>
                      {lane.map(dObj => {
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
                        });
                        const isJumpHighlight = day === jumpTargetDay;
                        return (
                          <div key={day}
                               id={`calday-${day}`}
                               onClick={() => scheduleSelectedOnDay(day)}
                               onDragOver={allowDrop}
                               onDrop={e => onDropDay(e, day)}
                               style={{ minWidth: 160, border: isJumpHighlight ? '2px solid #f59e0b' : (selectedProjectId ? '2px dashed #fbbf24' : '1px solid rgba(148,163,184,0.4)'), boxShadow: isJumpHighlight ? '0 0 0 4px rgba(245,158,11,0.35)' : '0 1px 2px rgba(0,0,0,0.05)', borderRadius: 10, padding: 8, background: '#ffffff', display: 'flex', flexDirection: 'column', gap: 6, position: 'relative', cursor: selectedProjectId ? 'copy' : 'default' }}>
                            <div style={{ fontSize: 11, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#111827' }}>
                              <span>{day.slice(8, 10)}/{day.slice(5, 7)}</span>
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
                                return (
                                  <div key={`${it.segmentId}:${it.day}`} draggable onDragStart={e => onDragStart(e, it.segmentId)} onDragEnd={onDragEnd} style={{ position: 'relative', border: `2px solid ${highlight ? '#f59e0b' : cardBorder}`, background: cardBg, borderRadius: 6, padding: 6, fontSize: 11, cursor: 'grab', display: 'grid', gap: 4, opacity: isMid ? 0.95 : 1, boxShadow: highlight ? '0 0 0 3px rgba(245,158,11,0.35)' : 'none' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <span style={{ fontWeight: 600, color: display ? display.text : '#312e81' }}>
                                        {it.project.orderNumber ? <span style={{ fontFamily: 'ui-monospace, monospace', background: '#ffffff', color: display ? display.text : '#312e81', border: `1px solid ${cardBorder}`, padding: '1px 4px', borderRadius: 4, marginRight: 4 }}>#{it.project.orderNumber}</span> : null}
                                        {it.project.name}
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
                                    </div>
                                    {isStart && showCardControls && (
                                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                                        <div style={{ position: 'relative', display: 'inline-block' }}>
                                          <FieldPresence projectId={it.project.id} field="truck" size={12} />
                                          {editingTruckFor === it.project.id ? (
                                          <select autoFocus value={it.truck || ''} onChange={e => { const val = e.target.value || null; updateMeta(it.project.id, { truck: val }); setEditingTruckFor(null); broadcastEditStop(it.project.id); }} onBlur={() => { setEditingTruckFor(null); broadcastEditStop(it.project.id); }} style={{ fontSize: 10, padding: '2px 4px', border: `1px solid ${cardBorder}`, borderRadius: 4 }}>
                                            <option value="">Lastbil…</option>
                                            {trucks.map(t => <option key={t} value={t}>{t}</option>)}
                                          </select>
                                        ) : (
                                          <button type="button" className="btn--plain btn--xs" onClick={() => { setEditingTruckFor(it.project.id); broadcastEditStart(it.project.id, 'truck', it.segmentId); }} style={{ fontSize: 10, border: `1px solid ${cardBorder}`, borderRadius: 4, padding: '2px 4px', background: '#fff', color: display ? display.text : '#312e81' }}>{it.truck ? it.truck : 'Välj lastbil'}</button>
                                        )}
                                        </div>
                                        <div style={{ position: 'relative', display: 'inline-block' }}>
                                          <FieldPresence projectId={it.project.id} field="bagCount" size={12} />
                                        <input type="number" min={0} placeholder="Säck" value={it.bagCount ?? ''} onFocus={() => broadcastEditStart(it.project.id, 'bagCount', it.segmentId)} onBlur={() => broadcastEditStop(it.project.id)} onChange={e => { const v = e.target.value; updateMeta(it.project.id, { bagCount: v === '' ? null : Math.max(0, parseInt(v, 10) || 0) }); }} style={{ width: 50, fontSize: 10, padding: '2px 4px', border: `1px solid ${cardBorder}`, borderRadius: 4 }} />
                                        </div>
                                        <div style={{ position: 'relative', display: 'inline-block' }}>
                                          <FieldPresence projectId={it.project.id} field="jobType" size={12} />
                                        <select value={it.jobType || ''} onFocus={() => broadcastEditStart(it.project.id, 'jobType', it.segmentId)} onBlur={() => broadcastEditStop(it.project.id)} onChange={e => { const v = e.target.value || null; updateMeta(it.project.id, { jobType: v }); }} style={{ fontSize: 10, padding: '2px 4px', border: `1px solid ${cardBorder}`, borderRadius: 4 }}>
                                          <option value="">Jobb…</option>
                                          {jobTypes.map(j => <option key={j} value={j}>{j}</option>)}
                                        </select>
                                        </div>
                                        <div style={{ display: 'grid', gap: 4 }}>
                                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                            <strong style={{ fontSize: 10 }}>Längd:</strong>
                                            <button type="button" className="btn--plain btn--xs" title="Förläng med föregående dag" onClick={() => extendSpan(it.segmentId, 'back')} style={{ fontSize: 10, padding: '2px 6px' }}>Förläng föregående</button>
                                            <button type="button" className="btn--plain btn--xs" title="Förläng med nästkommande dag" onClick={() => extendSpan(it.segmentId, 'forward')} style={{ fontSize: 10, padding: '2px 6px' }}>Förläng nästa</button>
                                            <button type="button" className="btn--plain btn--xs" title="Ta bort första dagen" disabled={(it as any).totalSpan <= 1} onClick={() => shrinkSpan(it.segmentId, 'start')} style={{ fontSize: 10, padding: '2px 6px', opacity: (it as any).totalSpan <= 1 ? 0.35 : 1 }}>Ta bort första</button>
                                            <button type="button" className="btn--plain btn--xs" title="Ta bort sista dagen" disabled={(it as any).totalSpan <= 1} onClick={() => shrinkSpan(it.segmentId, 'end')} style={{ fontSize: 10, padding: '2px 6px', opacity: (it as any).totalSpan <= 1 ? 0.35 : 1 }}>Ta bort sista</button>
                                            <span style={{ fontSize: 10, background: '#f1f5f9', padding: '2px 6px', borderRadius: 12, border: '1px solid #e2e8f0' }}>{(it as any).totalSpan} dagar</span>
                                          </div>
                                        </div>
                                        <button type="button" className="btn--plain btn--xs" onClick={() => unschedule(it.segmentId)} style={{ fontSize: 10, background: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 4, padding: '2px 4px' }}>X</button>
                                        <button type="button" className="btn--plain btn--xs" title="Ny separat dag" onClick={() => setSelectedProjectId(it.project.id)} style={{ fontSize: 10, background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#047857', borderRadius: 4, padding: '2px 4px' }}>+Dag</button>
                                      </div>
                                    )}
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
            <div style={{ display: 'grid', gap: 6 }}>
              {daysOfMonth.map(day => {
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
                });
                const isJumpHighlight = day === jumpTargetDay;
                return (
                  <div key={day} style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
                    <div
                      id={`calday-${day}`}
                      onClick={() => scheduleSelectedOnDay(day)}
                      onDragOver={allowDrop}
                      onDrop={e => onDropDay(e, day)}
                      style={{ width: 130, flexShrink: 0, border: isJumpHighlight ? '2px solid #f59e0b' : (selectedProjectId ? '2px dashed #fbbf24' : '1px solid #cbd5e1'), background: '#f8fafc', borderRadius: 8, padding: '6px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: selectedProjectId ? 'copy' : 'default' }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{day.slice(8,10)}/{day.slice(5,7)}</span>
                      <span style={{ fontSize: 10, color: '#64748b' }}>{new Date(day + 'T00:00:00').toLocaleDateString('sv-SE', { weekday: 'short' })}</span>
                    </div>
                    <div style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, background: '#ffffff', minHeight: 54, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {items.length === 0 && <div style={{ fontSize: 11, color: '#94a3b8' }}>—</div>}
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
                        return (
                          <div key={`${it.segmentId}:${it.day}`}
                               draggable
                               onDragStart={e => onDragStart(e, it.segmentId)}
                               onDragEnd={onDragEnd}
                               style={{ position: 'relative', border: `2px solid ${highlight ? '#f59e0b' : cardBorder}`, background: cardBg, borderRadius: 6, padding: 6, fontSize: 11, cursor: 'grab', display: 'grid', gap: 4, opacity: isMid ? 0.9 : 1, boxShadow: highlight ? '0 0 0 3px rgba(245,158,11,0.35)' : 'none', minWidth: 180 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontWeight: 600, color: display ? display.text : '#312e81', lineHeight: 1.2 }}>
                                {it.project.orderNumber ? <span style={{ fontFamily: 'ui-monospace, monospace', background: '#ffffff', color: display ? display.text : '#312e81', border: `1px solid ${cardBorder}`, padding: '1px 4px', borderRadius: 4, marginRight: 4 }}>#{it.project.orderNumber}</span> : null}
                                {it.project.name}
                              </span>
                              {isStart && <span style={{ color: display ? display.text : '#6366f1', fontSize: 10 }}>{it.project.customer}</span>}
                              {isStart && it.project.salesResponsible && <span style={{ fontSize: 9, color: display ? display.text : '#334155', background:'#ffffff50', padding:'1px 5px', borderRadius: 10, border:`1px solid ${cardBorder}55` }}>Sälj: {it.project.salesResponsible}</span>}
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
                              {isStart && it.truck && (() => { const team = truckTeamNames(it.truck); return team.length ? <span style={{ fontSize: 9, color: display ? display.text : '#334155', background:'#ffffff40', padding:'1px 5px', borderRadius: 10, border:`1px solid ${cardBorder}40` }}>Team: {team.join(', ')}</span> : null; })()}
                            </div>
                            {isStart && showCardControls && (
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                                <div style={{ position: 'relative', display: 'inline-block' }}>
                                  <FieldPresence projectId={it.project.id} field="truck" size={12} />
                                  {editingTruckFor === it.project.id ? (
                                  <select autoFocus value={it.truck || ''} onChange={e => { const val = e.target.value || null; updateMeta(it.project.id, { truck: val }); setEditingTruckFor(null); broadcastEditStop(it.project.id); }} onBlur={() => { setEditingTruckFor(null); broadcastEditStop(it.project.id); }} style={{ fontSize: 10, padding: '2px 4px', border: `1px solid ${cardBorder}`, borderRadius: 4 }}>
                                    <option value="">Lastbil…</option>
                                    {trucks.map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                ) : (
                                  <button type="button" className="btn--plain btn--xs" onClick={() => { setEditingTruckFor(it.project.id); broadcastEditStart(it.project.id, 'truck', it.segmentId); }} style={{ fontSize: 10, border: `1px solid ${cardBorder}`, borderRadius: 4, padding: '2px 4px', background: '#fff', color: display ? display.text : '#312e81' }}>{it.truck ? it.truck : 'Välj lastbil'}</button>
                                )}
                                </div>
                                <div style={{ position: 'relative', display: 'inline-block' }}>
                                  <FieldPresence projectId={it.project.id} field="bagCount" size={12} />
                                <input type="number" min={0} placeholder="Säck" value={it.bagCount ?? ''} onFocus={() => broadcastEditStart(it.project.id, 'bagCount', it.segmentId)} onBlur={() => broadcastEditStop(it.project.id)} onChange={e => { const v = e.target.value; updateMeta(it.project.id, { bagCount: v === '' ? null : Math.max(0, parseInt(v, 10) || 0) }); }} style={{ width: 50, fontSize: 10, padding: '2px 4px', border: `1px solid ${cardBorder}`, borderRadius: 4 }} />
                                </div>
                                <div style={{ position: 'relative', display: 'inline-block' }}>
                                  <FieldPresence projectId={it.project.id} field="jobType" size={12} />
                                <select value={it.jobType || ''} onFocus={() => broadcastEditStart(it.project.id, 'jobType', it.segmentId)} onBlur={() => broadcastEditStop(it.project.id)} onChange={e => { const v = e.target.value || null; updateMeta(it.project.id, { jobType: v }); }} style={{ fontSize: 10, padding: '2px 4px', border: `1px solid ${cardBorder}`, borderRadius: 4 }}>
                                  <option value="">Jobb…</option>
                                  {jobTypes.map(j => <option key={j} value={j}>{j}</option>)}
                                </select>
                                </div>
                                <div style={{ display: 'grid', gap: 4 }}>
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                    <strong style={{ fontSize: 10 }}>Längd:</strong>
                                    <button type="button" className="btn--plain btn--xs" title="Förläng med föregående dag" onClick={() => extendSpan(it.segmentId, 'back')} style={{ fontSize: 10, padding: '2px 6px' }}>Förläng föregående</button>
                                    <button type="button" className="btn--plain btn--xs" title="Förläng med nästkommande dag" onClick={() => extendSpan(it.segmentId, 'forward')} style={{ fontSize: 10, padding: '2px 6px' }}>Förläng nästa</button>
                                    <button type="button" className="btn--plain btn--xs" title="Ta bort första dagen" disabled={(it as any).totalSpan <= 1} onClick={() => shrinkSpan(it.segmentId, 'start')} style={{ fontSize: 10, padding: '2px 6px', opacity: (it as any).totalSpan <= 1 ? 0.35 : 1 }}>Ta bort första</button>
                                    <button type="button" className="btn--plain btn--xs" title="Ta bort sista dagen" disabled={(it as any).totalSpan <= 1} onClick={() => shrinkSpan(it.segmentId, 'end')} style={{ fontSize: 10, padding: '2px 6px', opacity: (it as any).totalSpan <= 1 ? 0.35 : 1 }}>Ta bort sista</button>
                                    <span style={{ fontSize: 10, background: '#f1f5f9', padding: '2px 6px', borderRadius: 12, border: '1px solid #e2e8f0' }}>{(it as any).totalSpan} dagar</span>
                                  </div>
                                </div>
                                <button type="button" className="btn--plain btn--xs" onClick={() => unschedule(it.segmentId)} style={{ fontSize: 10, background: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 4, padding: '2px 4px' }}>X</button>
                                <button type="button" className="btn--plain btn--xs" title="Ny separat dag" onClick={() => setSelectedProjectId(it.project.id)} style={{ fontSize: 10, background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#047857', borderRadius: 4, padding: '2px 4px' }}>+Dag</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
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

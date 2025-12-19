"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

type EventRow = {
  id: string;
  created_at: string;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  project_id: string | null;
  segment_id: string | null;
  details: any | null;
};

function prettyAction(a: string) {
  if (a === 'segment_created') return 'Skapade segment';
  if (a === 'segment_deleted') return 'Tog bort segment';
  if (a === 'segment_moved') return 'Flyttade segment';
  if (a === 'segment_updated') return 'Uppdaterade segment';
  if (a === 'meta_updated') return 'Uppdaterade projektinfo';
  if (a === 'meta_created') return 'Skapade projektinfo';
  if (a === 'meta_deleted') return 'Tog bort projektinfo';
  if (a === 'assignment_created') return 'La till bemanning';
  if (a === 'assignment_updated') return 'Uppdaterade bemanning';
  if (a === 'assignment_deleted') return 'Tog bort bemanning';
  return a;
}

export default function ActivityLogModal({
  open,
  onClose,
  startISO,
  endISO,
  projectOrderMap,
}: {
  open: boolean;
  onClose: () => void;
  startISO: string;
  endISO: string;
  projectOrderMap?: Record<string, string>;
}) {
  const supabase = createClientComponentClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [pageLoading, setPageLoading] = useState<boolean>(false);
  const lastCursorRef = useRef<string | null>(null);

  const limit = 200; // batch size per page

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('planning_activity_events')
        .select('*')
        .gte('created_at', `${startISO} 00:00:00+00`)
        .lte('created_at', `${endISO} 23:59:59+00`)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      const rows = (data || []) as EventRow[];
      setEvents(rows);
      lastCursorRef.current = rows.length ? rows[rows.length - 1].created_at : null;
      setHasMore(rows.length === limit);
    } catch (e: any) {
      setError(e?.message || 'Fel vid hämtning av aktivitet');
    } finally {
      setLoading(false);
    }
  }, [supabase, startISO, endISO]);

  const loadMore = useCallback(async () => {
    if (!lastCursorRef.current || pageLoading) return;
    setPageLoading(true);
    try {
      const { data, error } = await supabase
        .from('planning_activity_events')
        .select('*')
        .gte('created_at', `${startISO} 00:00:00+00`)
        .lte('created_at', `${endISO} 23:59:59+00`)
        .lt('created_at', lastCursorRef.current)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      const rows = (data || []) as EventRow[];
      setEvents(prev => [...prev, ...rows]);
      lastCursorRef.current = rows.length ? rows[rows.length - 1].created_at : lastCursorRef.current;
      setHasMore(rows.length === limit);
    } catch (e: any) {
      setError(e?.message || 'Fel vid hämtning');
    } finally {
      setPageLoading(false);
    }
  }, [pageLoading, supabase, startISO, endISO]);

  useEffect(() => {
    if (!open) return;
    loadInitial();
  }, [open, loadInitial]);

  // Optional realtime updates while modal open (prepend newest)
  useEffect(() => {
    if (!open) return;
    const ch = supabase
      .channel('activity-modal')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_activity_events' }, (payload: any) => {
        const newRow = (payload.new || payload.record) as EventRow;
        if (!newRow) return;
        const created = new Date(newRow.created_at);
        const start = new Date(`${startISO}T00:00:00Z`);
        const end = new Date(`${endISO}T23:59:59Z`);
        if (created >= start && created <= end) {
          setEvents(prev => [newRow, ...prev]);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [open, supabase, startISO, endISO]);

  // Group by day and then by project
  // Filtering state
  const [actorFilter, setActorFilter] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [truckFilter, setTruckFilter] = useState<string>('');
  const [orderSearch, setOrderSearch] = useState<string>('');

  const actorOptions = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) if (e.actor_name) s.add(e.actor_name);
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'sv'));
  }, [events]);

  const actionOptions = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) if (e.action) s.add(e.action);
    return Array.from(s).sort();
  }, [events]);

  const truckOptions = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) {
      const t = extractTruck(e);
      if (t) s.add(t);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'sv'));
  }, [events]);

  const filtered = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return events.filter((e) => {
      if (actorFilter && (e.actor_name || '') !== actorFilter) return false;
      if (actionFilter && e.action !== actionFilter) return false;
      if (truckFilter) {
        const t = extractTruck(e);
        if ((t || '') !== truckFilter) return false;
      }
      if (q) {
        const label = extractOrderLabel(e).toLowerCase();
        if (!label.includes(q)) return false;
      }
      return true;
    });
  }, [events, actorFilter, actionFilter, truckFilter, orderSearch]);

  const groups = useMemo(() => {
    const byDay = new Map<string, EventRow[]>();
    for (const e of filtered) {
      const day = new Date(e.created_at).toLocaleDateString('sv-SE');
      const arr = byDay.get(day) || [];
      arr.push(e);
      byDay.set(day, arr);
    }
    // sort days desc
    const dayEntries = Array.from(byDay.entries()).sort((a, b) => {
      const da = a[0].split('-').reverse().join('-'); // not ideal for sv-SE; fallback to date compare below
      const db = b[0].split('-').reverse().join('-');
      return new Date(db).getTime() - new Date(da).getTime();
    });
    // within day, sort by time desc
    for (const [, arr] of dayEntries) arr.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return dayEntries;
  }, [filtered]);

  function extractTruck(e: EventRow): string {
    // Prefer the "after" state when moving/updates; fall back to current or new value
    const details: any = e.details || {};
    const ctx: any = details.context || {};
    const ch: any = details.changed || {};
    // Common cases
    if (ctx.truck_after) return String(ctx.truck_after);
    if (ch.truck?.new) return String(ch.truck.new);
    if (ctx.truck) return String(ctx.truck);
    // For created rows, truck may be in details.new
    if (details.new?.truck != null) return String(details.new.truck);
    return '';
  }

  function extractTruckAssignment(e: EventRow): string {
    const details: any = e.details || {};
    const ctx: any = details.context || {};
    const ch: any = details.changed || {};
    const tBefore = ctx.truck_before ?? ch.truck?.old ?? '';
    const tAfter = ctx.truck_after ?? ch.truck?.new ?? '';
    if (tBefore && tAfter && String(tBefore) !== String(tAfter)) return `${tBefore}→${tAfter}`;
    const single = extractTruck(e);
    return single || '—';
  }

  function extractOrderLabel(e: EventRow): string {
    return e.project_id && projectOrderMap && projectOrderMap[e.project_id]
      ? `#${projectOrderMap[e.project_id]}`
      : (e.project_id || '');
  }

  function extractDataChange(e: EventRow): string {
    const details: any = e.details || {};
    const ctx: any = details.context || {};
    const ch: any = details.changed || {};
    // For moves, show date change succinctly
    if (e.action === 'segment_moved') {
      const sBefore = ctx.start_before ?? ch.start_day?.old ?? '';
      const sAfter = ctx.start_after ?? ch.start_day?.new ?? '';
      const eBefore = ctx.end_before ?? ch.end_day?.old ?? '';
      const eAfter = ctx.end_after ?? ch.end_day?.new ?? '';
      if ((sBefore || sAfter) || (eBefore || eAfter)) {
        const parts: string[] = [];
        if (sBefore || sAfter) parts.push(`${sBefore}→${sAfter}`);
        if (eBefore || eAfter) parts.push(`${eBefore}→${eAfter}`);
        return parts.join(' · ');
      }
      return '—';
    }
    // For updates, show top 3 diff keys (excluding truck which is shown separately)
    if (e.action === 'segment_updated' || e.action === 'meta_updated' || e.action === 'assignment_updated') {
      const keys = Object.keys(ch).filter(k => k !== 'truck');
      if (keys.length === 0) return '—';
      const top = keys.slice(0, 3).map(k => {
        const d = ch[k];
        const oldV = typeof d?.old === 'string' ? d.old : JSON.stringify(d?.old ?? '');
        const newV = typeof d?.new === 'string' ? d.new : JSON.stringify(d?.new ?? '');
        return `${k}: ${oldV}→${newV}`;
      }).join(' · ');
      return top + (keys.length > 3 ? ' …' : '');
    }
    // Created/deleted defaults
    if (e.action.endsWith('_created')) return 'Ny';
    if (e.action.endsWith('_deleted')) return 'Borttagen';
    return '—';
  }

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 'min(1400px, 98vw)', maxHeight: '90vh', background: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <strong style={{ fontSize: 16 }}>Aktivitetslogg</strong>
            <span style={{ fontSize: 12, color: '#64748b' }}>Visar {startISO} – {endISO}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {loading && <span style={{ fontSize: 12, color: '#64748b' }}>Laddar…</span>}
            {error && <span style={{ fontSize: 12, color: '#b91c1c' }}>{error}</span>}
            <button type="button" className="btn--plain btn--sm" onClick={onClose} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 10px' }}>Stäng</button>
          </div>
        </div>

        <div style={{ padding: 12, overflow: 'auto' }}>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#64748b' }}>Namn</label>
              <select value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} style={{ fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 6px' }}>
                <option value="">Alla</option>
                {actorOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#64748b' }}>Händelse</label>
              <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} style={{ fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 6px' }}>
                <option value="">Alla</option>
                {actionOptions.map(a => <option key={a} value={a}>{prettyAction(a)}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#64748b' }}>Lastbil</label>
              <select value={truckFilter} onChange={(e) => setTruckFilter(e.target.value)} style={{ fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 6px' }}>
                <option value="">Alla</option>
                {truckOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#64748b' }}>Ordernr</label>
              <input value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} placeholder="#1234" style={{ fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 8px', width: 140 }} />
            </div>
            <button type="button" className="btn--plain btn--sm" onClick={() => { setActorFilter(''); setActionFilter(''); setTruckFilter(''); setOrderSearch(''); }}
              style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>Rensa</button>
          </div>

          {groups.length === 0 && !loading && (
            <div style={{ fontSize: 13, color: '#64748b' }}>Ingen aktivitet i intervallet.</div>
          )}
          {groups.map(([day, items]) => {
            return (
              <div key={day} style={{ marginBottom: 16 }}>
                <div style={{ position: 'sticky', top: 0, background: '#fff', padding: '6px 0', zIndex: 1 }}>
                  <div style={{ fontWeight: 700, color: '#111827', borderBottom: '1px solid #f3f4f6', paddingBottom: 4 }}>{day}</div>
                </div>
                {/* Column header for this day */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 200px 220px 140px 200px 1fr',
                  gap: 12,
                  alignItems: 'center',
                  marginTop: 8,
                  padding: '6px 8px',
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  color: '#475569',
                  fontSize: 12,
                  fontWeight: 600,
                }}>
                  <div>Datum/Tid</div>
                  <div>Namn</div>
                  <div>Händelse</div>
                  <div>Ordernr</div>
                  <div>Lastbil</div>
                  <div>Ändring</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                  {items.map((e) => {
                    const ts = new Date(e.created_at);
                    const time = ts.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
                    const actionText = prettyAction(e.action);
                    const orderLabel = extractOrderLabel(e);
                    const truckAssignment = extractTruckAssignment(e);
                    const dataChange = extractDataChange(e);

                    return (
                      <div key={e.id} style={{
                        display: 'grid',
                        gridTemplateColumns: '140px 200px 220px 140px 200px 1fr',
                        gap: 12,
                        alignItems: 'center',
                        padding: '6px 8px',
                        border: '1px solid #f1f5f9',
                        borderRadius: 8,
                        background: '#fff',
                      }}>
                        <div style={{ color: '#64748b', fontSize: 12 }}>{time}</div>
                        <div style={{ color: '#111827', fontSize: 13 }}>{e.actor_name || 'Någon'}</div>
                        <div style={{ color: '#0f172a', fontSize: 13 }}>{actionText}</div>
                        <div style={{ color: '#0f172a', fontSize: 13, whiteSpace: 'nowrap' }}>{orderLabel || '—'}</div>
                        <div style={{ color: '#0f172a', fontSize: 13, whiteSpace: 'nowrap' }}>{truckAssignment}</div>
                        <div style={{ color: '#334155', fontSize: 13, whiteSpace: 'normal', wordBreak: 'break-word' }}>{dataChange}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {hasMore && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
              <button type="button" className="btn--plain btn--sm" onClick={loadMore} disabled={pageLoading} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 12px' }}>
                {pageLoading ? 'Laddar…' : 'Visa fler'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

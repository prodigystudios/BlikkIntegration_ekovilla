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
  const groups = useMemo(() => {
    const byDay = new Map<string, EventRow[]>();
    for (const e of events) {
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
  }, [events]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 'min(1100px, 96vw)', maxHeight: '90vh', background: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column' }}>
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
          {groups.length === 0 && !loading && (
            <div style={{ fontSize: 13, color: '#64748b' }}>Ingen aktivitet i intervallet.</div>
          )}
          {groups.map(([day, items]) => {
            return (
              <div key={day} style={{ marginBottom: 16 }}>
                <div style={{ position: 'sticky', top: 0, background: '#fff', padding: '6px 0', zIndex: 1 }}>
                  <div style={{ fontWeight: 700, color: '#111827', borderBottom: '1px solid #f3f4f6', paddingBottom: 4 }}>{day}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {items.map((e) => {
                    const ts = new Date(e.created_at);
                    const time = ts.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
                    const a = prettyAction(e.action);
                    const orderLabel = e.project_id && projectOrderMap && projectOrderMap[e.project_id] ? `#${projectOrderMap[e.project_id]}` : (e.project_id || '');
                    let description: string;
                    if (e.action === 'segment_moved') {
                      const ctx = (e.details?.context || {}) as any;
                      const tBefore = ctx.truck_before || e.details?.changed?.truck?.old || '';
                      const tAfter = ctx.truck_after || e.details?.changed?.truck?.new || '';
                      const sBefore = ctx.start_before || e.details?.changed?.start_day?.old || '';
                      const sAfter = ctx.start_after || e.details?.changed?.start_day?.new || '';
                      description = `${orderLabel} ${tBefore}→${tAfter} ${sBefore}→${sAfter}`.trim();
                    } else {
                      description = orderLabel ? `(${orderLabel})` : `(${e.entity_id})`;
                    }
                    return (
                      <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 12, alignItems: 'baseline' }}>
                        <span style={{ color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>{time}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ color: '#111827' }}><strong>{e.actor_name || 'Någon'}</strong> {a} {description}</div>
                          {/* Optional: show small diff summary for updates */}
                          {e.details?.changed && (e.action === 'segment_updated' || e.action === 'meta_updated' || e.action === 'assignment_updated') && (
                            <div style={{ fontSize: 12, color: '#64748b' }}>
                              {Object.keys(e.details.changed).slice(0, 5).map((k) => {
                                const ch = e.details.changed[k];
                                const oldV = typeof ch?.old === 'string' ? ch.old : JSON.stringify(ch?.old ?? '');
                                const newV = typeof ch?.new === 'string' ? ch.new : JSON.stringify(ch?.new ?? '');
                                return (<span key={k} style={{ marginRight: 8 }}>{k}: {oldV} → {newV}</span>);
                              })}
                              {Object.keys(e.details.changed).length > 5 && <span>…</span>}
                            </div>
                          )}
                        </div>
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

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { ActivityEvent } from '@/lib/domains/planning/activity';

const API = '/api/crm/planering/activity';
const PAGE = 100;

// Swedish chip labels per action key (see logActivity calls in the mutation routes). Falls back to
// the raw key for anything not mapped, so a new action still renders.
const ACTION_LABELS: Record<string, string> = {
  'segment.create': 'Placerad',
  'segment.move': 'Flyttad',
  'segment.reorder': 'Omordnad',
  'segment.jobtype': 'Jobbtyp',
  'segment.hold': 'Pausad',
  'segment.resume': 'Återupptagen',
  'segment.update': 'Uppdaterad',
  'segment.delete': 'Borttagen',
  'crew.add': 'Besättning +',
  'crew.remove': 'Besättning −',
  'truck_crew.assign': 'Bilbesättning +',
  'truck_crew.remove': 'Bilbesättning −',
  'truck_crew.copy': 'Bilbesättning kopierad',
  'day_note.add': 'Anteckning +',
  'day_note.remove': 'Anteckning −',
  'confirmation.send': 'Bekräftelse',
};

// Coarse tone per entity type for the chip colour.
function chipTone(entityType: string): string {
  switch (entityType) {
    case 'segment': return 'bg-sky-50 text-sky-700 border-sky-200';
    case 'crew':
    case 'truck_crew': return 'bg-violet-50 text-violet-700 border-violet-200';
    case 'day_note': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'confirmation': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    default: return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}

const dayFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit' });

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export default function ActivityLogModal({ onClose }: { onClose: () => void }) {
  const [supabase] = useState(() => createClientComponentClient());
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');

  // Debounced text inputs so we don't refetch on every keystroke.
  const [debounced, setDebounced] = useState({ search: '', actor: '' });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ search: search.trim(), actor: actorFilter.trim() }), 300);
    return () => clearTimeout(t);
  }, [search, actorFilter]);

  const filters = useMemo(
    () => ({ search: debounced.search, actor: debounced.actor, action: actionFilter }),
    [debounced.search, debounced.actor, actionFilter],
  );

  const buildQuery = useCallback(
    (before?: string) => {
      const p = new URLSearchParams({ limit: String(PAGE) });
      if (before) p.set('before', before);
      if (filters.search) p.set('search', filters.search);
      if (filters.actor) p.set('actor', filters.actor);
      if (filters.action) p.set('action', filters.action);
      return `${API}?${p.toString()}`;
    },
    [filters],
  );

  // (Re)load the first page whenever the filters change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(buildQuery())
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json?.ok) throw new Error(json?.error?.message || 'Kunde inte ladda aktivitetsloggen');
        const list = (json.data?.events ?? []) as ActivityEvent[];
        setEvents(list);
        setReachedEnd(list.length < PAGE);
      })
      .catch((e) => !cancelled && setError(e?.message || 'Kunde inte ladda aktivitetsloggen'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [buildQuery]);

  const loadMore = useCallback(() => {
    if (loadingMore || reachedEnd || !events.length) return;
    setLoadingMore(true);
    fetch(buildQuery(events[events.length - 1].created_at))
      .then((r) => r.json())
      .then((json) => {
        if (!json?.ok) throw new Error(json?.error?.message || 'Kunde inte ladda fler');
        const list = (json.data?.events ?? []) as ActivityEvent[];
        setEvents((prev) => [...prev, ...list]);
        setReachedEnd(list.length < PAGE);
      })
      .catch((e) => setError(e?.message || 'Kunde inte ladda fler'))
      .finally(() => setLoadingMore(false));
  }, [buildQuery, events, loadingMore, reachedEnd]);

  // Does a freshly-inserted event match the active filters? (client-side gate for live prepend)
  const matchesFilters = useCallback(
    (e: ActivityEvent) => {
      if (filters.action && e.action !== filters.action) return false;
      if (filters.actor && !(e.actor_name ?? '').toLowerCase().includes(filters.actor.toLowerCase())) return false;
      if (filters.search && !(e.summary ?? '').toLowerCase().includes(filters.search.toLowerCase())) return false;
      return true;
    },
    [filters],
  );

  // Live-prepend new events while the modal is open (its own channel — does NOT trigger the board's
  // debounced reload).
  useEffect(() => {
    const ch = supabase
      .channel('planning-activity-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ops_activity_events' }, (payload) => {
        const e = payload.new as ActivityEvent;
        if (!matchesFilters(e)) return;
        setEvents((prev) => (prev.some((p) => p.id === e.id) ? prev : [e, ...prev]));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, matchesFilters]);

  // Group events by calendar day for date headers.
  const groups = useMemo(() => {
    const map = new Map<string, ActivityEvent[]>();
    for (const e of events) {
      const k = dayKey(e.created_at);
      const arr = map.get(k);
      if (arr) arr.push(e);
      else map.set(k, [e]);
    }
    return [...map.entries()];
  }, [events]);

  return (
    <div className="fixed inset-0 z-[2800] flex items-center justify-center bg-slate-900/40 p-4 sm:p-6" onClick={onClose}>
      <div
        className="planning-modal flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#e0e8dc] bg-white px-4 py-3">
          <h3 className="text-[14px] font-bold text-slate-900">Aktivitetslogg</h3>
          <button onClick={onClose} aria-label="Stäng" className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[#e0e8dc] bg-white px-4 py-2.5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök (jobb, åtgärd)…"
            className="h-9 min-w-0 flex-1 rounded-lg border border-[#dce4d8] bg-white px-2.5 text-[12.5px] text-slate-600 outline-none transition focus:border-emerald-500"
          />
          <input
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            placeholder="Person"
            className="h-9 w-28 rounded-lg border border-[#dce4d8] bg-white px-2.5 text-[12.5px] text-slate-600 outline-none transition focus:border-emerald-500"
          />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            aria-label="Filtrera på åtgärd"
            className="h-9 rounded-lg border border-[#dce4d8] bg-white px-2.5 text-[12.5px] text-slate-600 outline-none transition focus:border-emerald-500"
          >
            <option value="">Alla åtgärder</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        {/* Feed */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          {loading ? (
            <div className="py-10 text-center text-[13px] text-slate-400">Laddar…</div>
          ) : events.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-slate-400">Inga händelser matchar.</div>
          ) : (
            <div className="space-y-4">
              {groups.map(([day, items]) => (
                <div key={day}>
                  <div className="sticky top-0 z-10 -mx-1 mb-1.5 bg-[#f9fbf7]/90 px-1 py-0.5 text-[11px] font-bold capitalize text-slate-500 backdrop-blur">
                    {dayFmt.format(new Date(`${day}T00:00:00`))}
                  </div>
                  <ul className="space-y-1">
                    {items.map((e) => (
                      <li key={e.id} className="flex items-start gap-2.5 rounded-xl border border-[#e8efe4] bg-white px-3 py-2">
                        <span className="mt-0.5 w-[42px] shrink-0 text-[11px] font-semibold tabular-nums text-slate-400">
                          {timeFmt.format(new Date(e.created_at))}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className={cn('inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-semibold', chipTone(e.entity_type))}>
                              {ACTION_LABELS[e.action] ?? e.action}
                            </span>
                            <span className="truncate text-[12.5px] text-slate-700">{e.summary}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-400">{e.actor_name || 'Okänd'}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {!reachedEnd && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className={cn(crm.ghostButton, 'w-full')}
                >
                  {loadingMore ? 'Laddar…' : 'Visa fler'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { cn } from '@/lib/shared/cn';
import { mapNotificationRow } from '@/lib/domains/notifications/mappers';
import type { NotificationRow, NotificationView } from '@/lib/domains/notifications/types';

// App-shell notification bell. Self-contained: fetches its own user + data, subscribes to
// Realtime so the badge and list stay live. Reusable for any notification type. Rendered in
// AppSidebar (mobile top bar + desktop account footer).
export default function NotificationBell({ className, collapsed = false }: { className?: string; collapsed?: boolean }) {
  const supabase = createClientComponentClient();
  const router = useRouter();
  // Unique per instance: the mobile top-bar bell and the desktop sidebar bell are BOTH mounted
  // (CSS-hidden, not unmounted) on one singleton client, so a shared channel name would collide
  // (duplicate subscribe → CHANNEL_ERROR) and break live updates.
  const channelId = useId();
  const [userId, setUserId] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationView[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  // Panelen visar OLÄSTA som standard; "Visa lästa" växlar till hela historiken (30 senaste).
  const [showRead, setShowRead] = useState(false);
  const showReadRef = useRef(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => { showReadRef.current = showRead; }, [showRead]);

  // Resolve the current user + initial unread count.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!alive || !user) return;
        setUserId(user.id);
        const res = await fetch('/api/notifications/unread-count', { cache: 'no-store' });
        if (!alive || !res.ok) return;
        const j = await res.json();
        setUnread(j?.data?.count ?? 0);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [supabase]);

  // Realtime: keep the badge + open list live. Filter to our own rows client-side.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`realtime:notifications:${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, (payload) => {
        const row: any = payload.eventType === 'DELETE' ? payload.old : payload.new;
        if (!row || row.recipient_user_id !== userId) return;
        if (payload.eventType === 'INSERT') {
          setUnread((c) => c + 1);
          setItems((prev) => (prev.some((n) => n.id === row.id) ? prev : [mapNotificationRow(row as NotificationRow), ...prev]));
        } else if (payload.eventType === 'UPDATE') {
          setItems((prev) => {
            const next = prev.map((n) => (n.id === row.id ? mapNotificationRow(row as NotificationRow) : n));
            // In unread-only mode a row that just became read leaves the list.
            return showReadRef.current ? next : next.filter((n) => !n.read);
          });
          // Recompute badge from the freshest server truth rather than guessing deltas.
          refreshCount();
        } else if (payload.eventType === 'DELETE') {
          setItems((prev) => prev.filter((n) => n.id !== row.id));
          refreshCount();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, userId]);

  const refreshCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/unread-count', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      setUnread(j?.data?.count ?? 0);
    } catch { /* ignore */ }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/notifications?limit=30&unreadOnly=${!showRead}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('failed');
      const j = await res.json();
      setItems((j?.data?.items || []) as NotificationView[]);
    } catch {
      setError('Kunde inte ladda notiser.');
    } finally {
      setLoading(false);
    }
  }, [showRead]);

  const openPanel = () => { setOpen(true); loadList(); };

  // Reload when the reader toggles between unread-only and all (only while the panel is open).
  useEffect(() => { if (open) loadList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [showRead]);

  const onRowClick = async (n: NotificationView) => {
    setOpen(false);
    if (!n.read) {
      // In unread-only mode the row leaves the list once read; otherwise it just greys out.
      setItems((prev) => (showReadRef.current ? prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)) : prev.filter((x) => x.id !== n.id)));
      setUnread((c) => Math.max(0, c - 1));
      try { await fetch(`/api/notifications/${n.id}/read`, { method: 'POST' }); } catch { /* ignore */ }
    }
    if (n.href) router.push(n.href);
  };

  const markAll = async () => {
    // Unread-only view empties; "show read" view keeps rows but greys them.
    setItems((prev) => (showReadRef.current ? prev.map((x) => ({ ...x, read: true })) : []));
    setUnread(0);
    try { await fetch('/api/notifications/read-all', { method: 'POST' }); } catch { /* ignore */ }
  };

  const badge = unread > 99 ? '99+' : String(unread);

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        aria-label={unread > 0 ? `Notiser (${unread} olästa)` : 'Notiser'}
        className={cn(
          'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/25 bg-white/10 text-white transition-colors hover:bg-white/20',
          className,
        )}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-[18px] text-white">
            {badge}
          </span>
        )}
      </button>

      {mounted && open && createPortal(
        <div
          className="crm-overlay-in fixed inset-0 z-[2900] flex items-start justify-center bg-slate-950/50 px-3 [backdrop-filter:blur(4px)] lg:justify-start lg:px-0"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Notiser"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              // Phone / tablet (< lg): a centred top dropdown below the top bar. Desktop (lg): a
              // sheet anchored just right of the sidebar — offset follows the collapsed width.
              'mt-[calc(3.75rem+env(safe-area-inset-top))] flex max-h-[75dvh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-[0_20px_50px_rgba(15,23,42,0.30)] sm:w-[380px] lg:mt-3 lg:max-h-[70vh] lg:shadow-[0_30px_80px_rgba(15,23,42,0.28)]',
              collapsed ? 'lg:ml-[5rem]' : 'lg:ml-[14.75rem]',
            )}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <strong className="text-sm font-bold text-slate-900">Notiser</strong>
              <div className="flex items-center gap-2">
                {items.some((n) => !n.read) && (
                  <button type="button" onClick={markAll} className="text-[12px] font-semibold text-emerald-700 hover:text-emerald-800">
                    Markera alla som lästa
                  </button>
                )}
                <button type="button" onClick={() => setShowRead((s) => !s)} className="text-[12px] font-semibold text-slate-500 hover:text-slate-700">
                  {showRead ? 'Visa olästa' : 'Visa lästa'}
                </button>
                <button
                  type="button"
                  aria-label="Stäng"
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-8 items-center justify-center !rounded-full !border !border-slate-200 !bg-slate-50 !p-0 text-slate-500 transition hover:!bg-slate-100 hover:text-slate-700"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto [padding-bottom:env(safe-area-inset-bottom)]">
              {loading && <p className="m-0 px-4 py-6 text-center text-xs text-slate-500">Laddar…</p>}
              {error && <p className="m-0 px-4 py-6 text-center text-xs text-red-700">{error}</p>}
              {!loading && !error && items.length === 0 && (
                <p className="m-0 px-4 py-8 text-center text-sm text-slate-500">
                  {showRead ? 'Inga notiser ännu.' : 'Inga olästa notiser.'}
                </p>
              )}
              {!loading && !error && items.length > 0 && (
                <ul role="list" className="m-0 grid list-none gap-0 p-0">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => onRowClick(n)}
                        className={cn(
                          'grid w-full gap-0.5 border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50',
                          !n.read && 'bg-emerald-50/50',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />}
                          <span className={cn('text-[13px] text-slate-900', !n.read ? 'font-bold' : 'font-semibold')}>{n.title}</span>
                        </div>
                        {n.body && <span className="text-[12px] text-slate-600">{n.body}</span>}
                        <span className="text-[11px] text-slate-400">{formatWhen(n.created_at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

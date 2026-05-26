"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { cn } from '@/lib/shared/cn';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import SectionCard from '../ui/SectionCard';

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: 'open' | 'done' | string;
  due_date: string | null; // YYYY-MM-DD
  created_at: string;
  updated_at: string;
  created_by: string;
  assigned_to: string;
  source: string | null;
};

export default function DashboardTasks({ compact, hideWhenEmpty, onVisibilityChange }: { compact?: boolean; hideWhenEmpty?: boolean; onVisibilityChange?: (visible: boolean) => void }) {
  const supabase = createClientComponentClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<'connecting'|'on'|'off'>('off');
  const mounted = useRef(false);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        if (!user) { setItems([]); return; }
        setUserId(user.id);
        const { data, error: selErr } = await supabase
          .from('tasks')
          .select('id,title,description,status,due_date,created_at,updated_at,created_by,assigned_to,source')
          .or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`)
          .order('status', { ascending: true })
          .order('due_date', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false });
        if (selErr) throw selErr;
        setItems(data || []);
      } catch (e:any) {
        setError('Kunde inte ladda uppgifter.');
      } finally {
        setLoading(false); mounted.current = true;
      }
    })();
  }, [supabase]);

  // Realtime for assigned + created
  useEffect(() => {
    if (!userId) return;
    setLive('connecting');
    const channel = supabase
      .channel('realtime:tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
        setItems(prev => {
          const row: any = payload.eventType === 'DELETE' ? payload.old : payload.new;
          const visible = row.assigned_to === userId || row.created_by === userId;
          switch (payload.eventType) {
            case 'INSERT':
              if (!visible) return prev;
              if (prev.some(t => t.id === row.id)) return prev;
              return [row as Task, ...prev];
            case 'UPDATE': {
              const exists = prev.some(t => t.id === row.id);
              if (!visible) return prev.filter(t => t.id !== row.id);
              if (!exists) return [row as Task, ...prev];
              return prev.map(t => t.id === row.id ? { ...(row as Task) } : t);
            }
            case 'DELETE':
              return prev.filter(t => t.id !== row.id);
            default:
              return prev;
          }
        });
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setLive('on');
        if (status === 'CHANNEL_ERROR' || status === 'CLOSED') setLive('off');
      });
    return () => { supabase.removeChannel(channel); setLive('off'); };
  }, [supabase, userId]);

  const grouped = useMemo(() => {
    const open = items.filter(t => t.status !== 'done');
    const done = items.filter(t => t.status === 'done');
    const byDue = (a: Task, b: Task) => (a.due_date||'9999-12-31').localeCompare(b.due_date||'9999-12-31') || a.created_at.localeCompare(b.created_at) * -1;
    return { open: open.sort(byDue), done: done.sort((a,b)=> b.updated_at.localeCompare(a.updated_at)) };
  }, [items]);
  const visibleOpen = compact ? grouped.open.slice(0, 3) : grouped.open;
  const shouldRender = loading || !!error || items.length > 0;

  useEffect(() => {
    onVisibilityChange?.(shouldRender);
  }, [onVisibilityChange, shouldRender]);

  const markDone = async (id: string, done: boolean) => {
    const prev = items;
    setItems(list => list.map(t => t.id === id ? { ...t, status: done ? 'done' : 'open' } : t));
    const { error: err } = await supabase.from('tasks').update({ status: done ? 'done' : 'open' }).eq('id', id);
    if (err) setItems(prev);
  };

  if (hideWhenEmpty && !shouldRender) {
    return null;
  }

  const liveTextClass =
    live === 'on'
      ? 'text-emerald-700'
      : live === 'connecting'
        ? 'text-amber-600'
        : 'text-slate-500';

  const liveDotClass =
    live === 'on'
      ? 'bg-emerald-500'
      : live === 'connecting'
        ? 'bg-amber-500'
        : 'bg-slate-400';

  return (
    <div className={cn('flex flex-col', compact ? 'gap-3' : 'gap-4')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className={cn('m-0 flex flex-wrap items-center gap-2 font-bold text-slate-900', compact ? 'text-base' : 'text-xl')}>
            Uppgifter
            <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', liveTextClass)}>
              <span className={cn('h-2 w-2 rounded-full', liveDotClass)} />
              {live==='on' ? 'Live' : live==='connecting' ? 'Ansluter…' : 'Offline'}
            </span>
          </h2>
          {(!compact || grouped.open.length > 0) && <p className={cn('m-0 text-slate-500', compact ? 'text-xs' : 'text-[13px]')}>Visa det som fortfarande kräver åtgärd först, och dölj resten tills det behövs.</p>}
        </div>
        <Badge className="gap-2 px-2.5 py-1 text-[11.5px] text-slate-700">
          {grouped.open.length} öppna
        </Badge>
      </div>
      {loading && <p className="m-0 text-xs text-slate-500">Laddar…</p>}
      {error && <p className="m-0 text-xs text-red-700">{error}</p>}
      {!loading && grouped.open.length === 0 && grouped.done.length === 0 && (
        <p className={cn('m-0 text-slate-500', compact ? 'text-xs' : 'text-sm')}>Inga uppgifter ännu.</p>
      )}
      {!loading && grouped.open.length === 0 && grouped.done.length > 0 && (
        <div className={cn('inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-50 text-slate-600 font-semibold', compact ? 'px-2.5 py-2 text-xs' : 'px-3 py-2.5 text-[13px]')}>
          Inga öppna uppgifter just nu.
        </div>
      )}
      {grouped.open.length > 0 && (
        <div className="grid gap-2">
          {visibleOpen.map(t => (
            <TaskRow key={t.id} t={t} onToggle={() => markDone(t.id, true)} compact={compact} />
          ))}
          {compact && grouped.open.length > visibleOpen.length && (
            <div className="px-0.5 pt-0.5 text-xs text-slate-500">
              +{grouped.open.length - visibleOpen.length} fler öppna uppgifter visas i full vy.
            </div>
          )}
        </div>
      )}
      {grouped.done.length > 0 && (
        <details>
          <summary className={cn('cursor-pointer text-slate-700', compact ? 'text-xs' : 'text-[13px]')}>Klara ({grouped.done.length})</summary>
          <div className="mt-2 grid gap-2">
            {grouped.done.map(t => (
              <TaskRow key={t.id} t={t} onToggle={() => markDone(t.id, false)} compact={compact} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function TaskRow({ t, onToggle, compact }: { t: Task; onToggle: ()=>void; compact?: boolean }) {
  const due = t.due_date ? new Date(t.due_date+'T00:00:00') : null;
  const dueStr = due ? due.toLocaleDateString('sv-SE') : null;
  return (
    <SectionCard className={cn('grid gap-1.5 bg-slate-50 shadow-none', compact ? 'rounded-[10px] px-2.5 py-2' : 'rounded-[10px] px-3 py-2.5')}>
      <div className="flex items-center gap-2">
        <strong className={cn('text-slate-900', compact ? 'text-[13.5px]' : 'text-[15px]')}>{t.title}</strong>
        {t.source && <span className="ml-auto text-[11px] text-slate-500">{t.source}</span>}
      </div>
      {t.description && <p className={cn('m-0 whitespace-pre-wrap text-slate-900', compact ? 'text-[12.5px]' : 'text-sm')}>{t.description}</p>}
      <div className="flex items-center gap-2.5">
        {dueStr && <span className={cn('text-slate-700', compact ? 'text-[11px]' : 'text-xs')}>Senast: {dueStr}</span>}
        <div className="ml-auto">
          {t.status === 'done' ? (
            <Button onClick={onToggle} variant="secondary" size={compact ? 'sm' : 'md'} title="Markera som öppen" className={cn(compact ? 'min-h-8 rounded-lg px-2.5' : 'rounded-lg')}>Återöppna</Button>
          ) : (
            <Button onClick={onToggle} size={compact ? 'sm' : 'md'} title="Markera som klar" className={cn('border-slate-900 bg-slate-900 text-white hover:bg-slate-950', compact ? 'min-h-8 rounded-lg px-2.5' : 'rounded-lg')}>Markera klar</Button>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

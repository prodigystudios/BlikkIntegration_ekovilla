"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

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

export default function DashboardTasks({ compact }: { compact?: boolean }) {
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

  const markDone = async (id: string, done: boolean) => {
    const prev = items;
    setItems(list => list.map(t => t.id === id ? { ...t, status: done ? 'done' : 'open' } : t));
    const { error: err } = await supabase.from('tasks').update({ status: done ? 'done' : 'open' }).eq('id', id);
    if (err) setItems(prev);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap: compact?12:16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <h2 style={{ margin:0, fontSize: compact?16:20, display:'flex', alignItems:'center', gap:8 }}>
          Uppgifter
          <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:500, color: live==='on'? '#059669': live==='connecting'? '#d97706':'#6b7280' }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background: live==='on'? '#10b981': live==='connecting'? '#f59e0b':'#9ca3af' }} />
            {live==='on' ? 'Live' : live==='connecting' ? 'Ansluter…' : 'Offline'}
          </span>
        </h2>
      </div>
      {loading && <p style={{ margin:0, fontSize:12, color:'#6b7280' }}>Laddar…</p>}
      {error && <p style={{ margin:0, fontSize:12, color:'#b91c1c' }}>{error}</p>}
      {!loading && grouped.open.length === 0 && grouped.done.length === 0 && (
        <p style={{ margin:0, fontSize: compact?12:14, color:'#6b7280' }}>Inga uppgifter ännu.</p>
      )}
      {grouped.open.length > 0 && (
        <div style={{ display:'grid', gap:8 }}>
          {grouped.open.map(t => (
            <TaskRow key={t.id} t={t} onToggle={() => markDone(t.id, true)} compact={compact} />
          ))}
        </div>
      )}
      {grouped.done.length > 0 && (
        <details>
          <summary style={{ cursor:'pointer', color:'#374151', fontSize: compact?12:13 }}>Klara ({grouped.done.length})</summary>
          <div style={{ display:'grid', gap:8, marginTop:8 }}>
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
    <div style={{ border:'1px solid #e5e7eb', background:'#f8fafc', borderRadius:10, padding: compact? '8px 10px':'10px 12px', display:'grid', gap:6 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <strong style={{ fontSize: compact?13.5:15 }}>{t.title}</strong>
        {t.source && <span style={{ marginLeft: 'auto', fontSize:11, color:'#6b7280' }}>{t.source}</span>}
      </div>
      {t.description && <p style={{ margin:0, whiteSpace:'pre-wrap', fontSize: compact?12.5:14, color:'#111827' }}>{t.description}</p>}
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        {dueStr && <span style={{ fontSize: compact?11:12, color:'#374151' }}>Senast: {dueStr}</span>}
        <div style={{ marginLeft:'auto' }}>
          {t.status === 'done' ? (
            <button onClick={onToggle} style={btnGhost(compact)} title="Markera som öppen">Återöppna</button>
          ) : (
            <button onClick={onToggle} style={btnPrimary(compact)} title="Markera som klar">Markera klar</button>
          )}
        </div>
      </div>
    </div>
  );
}

const btnPrimary = (compact?: boolean): React.CSSProperties => ({ padding: compact? '6px 10px':'8px 12px', background:'#111827', color:'#fff', borderRadius:8, border:'1px solid #111827', cursor:'pointer', fontSize: compact?12:13 });
const btnGhost = (compact?: boolean): React.CSSProperties => ({ padding: compact? '5px 9px':'7px 11px', background:'#fff', color:'#111827', borderRadius:8, border:'1px solid #d1d5db', cursor:'pointer', fontSize: compact?12:13 });

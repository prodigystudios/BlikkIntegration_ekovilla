"use client";
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

interface NoteItem { id: string; text: string; done: boolean; created: number; syncing?: boolean; error?: string; }

const STORAGE_KEY = 'dashboard_notes_v1';

export function DashboardNotes({ compact }: { compact?: boolean }) {
  const [items, setItems] = useState<NoteItem[]>([]);
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<'all'|'open'|'done'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClientComponentClient();
  const mounted = useRef(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [live, setLive] = useState<'connecting'|'on'|'off'>('off');

  // Initial load: fetch from Supabase; fallback to localStorage if offline / error
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        if (!user) {
          setItems([]);
          return;
        }
        setUserId(user.id);
        const { data, error: selErr } = await supabase
          .from('dashboard_notes')
          .select('id,text,done,created_at')
          .order('created_at', { ascending: true });
        if (selErr) throw selErr;
        const rows = (data || []).map(r => ({ id: r.id, text: r.text, done: r.done, created: new Date(r.created_at).getTime() } as NoteItem));
        setItems(rows);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch {}
      } catch (e:any) {
        // fallback
        try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setItems(JSON.parse(raw)); } catch {}
        setError('Kunde inte hämta anteckningar (offline?).');
      } finally {
        setLoading(false); mounted.current = true;
      }
    })();
  }, [supabase]);

  // Realtime subscription
  useEffect(() => {
    if (!userId) return;
    setLive('connecting');
    const channel = supabase
      .channel('realtime:dashboard_notes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'dashboard_notes',
        filter: `user_id=eq.${userId}`
      }, (payload) => {
        setItems(prev => {
          switch (payload.eventType) {
            case 'INSERT': {
              const r: any = payload.new;
              if (prev.some(p => p.id === r.id)) return prev.map(p => p.id === r.id ? { ...p, syncing: false } : p);
              return [...prev, { id: r.id, text: r.text, done: r.done, created: new Date(r.created_at).getTime() }];
            }
            case 'UPDATE': {
              const r: any = payload.new;
              return prev.map(p => p.id === r.id ? { ...p, text: r.text, done: r.done, syncing: false } : p);
            }
            case 'DELETE': {
              const r: any = payload.old;
              return prev.filter(p => p.id !== r.id);
            }
            default:
              return prev;
          }
        });
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setLive('on');
        if (status === 'CHANNEL_ERROR' || status === 'CLOSED') setLive('off');
      });

    return () => {
      supabase.removeChannel(channel);
      setLive('off');
    };
  }, [supabase, userId]);

  // Persist local cache for offline resilience
  useEffect(() => {
    if (!mounted.current) return; // skip first set from load
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch {}
  }, [items]);

  const addItem = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    if (!userId) {
      setError('Ingen användare inloggad.');
      return;
    }
    const tempId = crypto.randomUUID();
    const optimistic: NoteItem = { id: tempId, text, done: false, created: Date.now(), syncing: true };
    setItems(list => [...list, optimistic]);
    setDraft('');
    const { data, error: insErr } = await supabase
      .from('dashboard_notes')
      .insert({ text, done: false, user_id: userId })
      .select('id,text,done,created_at')
      .single();
    if (insErr || !data) {
      setItems(list => list.map(i => i.id === tempId ? { ...i, syncing: false, error: 'Ej sparad' } : i));
      return;
    }
    setItems(list => list.map(i => i.id === tempId ? { id: data.id, text: data.text, done: data.done, created: new Date(data.created_at).getTime() } : i));
  }, [draft, supabase, userId]);

  const toggle = async (id: string) => {
    setItems(list => list.map(i => i.id === id ? { ...i, done: !i.done, syncing: true } : i));
    const item = items.find(i => i.id === id);
    if (!item) return;
    const { error: updErr } = await supabase.from('dashboard_notes').update({ done: !item.done }).eq('id', id);
    if (updErr) {
      // revert
      setItems(list => list.map(i => i.id === id ? { ...i, done: item.done, syncing: false } : i));
    } else {
      setItems(list => list.map(i => i.id === id ? { ...i, syncing: false } : i));
    }
  };
  const remove = async (id: string) => {
    const prev = items;
    setItems(list => list.filter(i => i.id !== id));
    const { error: delErr } = await supabase.from('dashboard_notes').delete().eq('id', id);
    if (delErr) {
      // restore
      setItems(prev);
    }
  };
  const edit = async (id: string, text: string) => {
    setItems(list => list.map(i => i.id === id ? { ...i, text, syncing: true } : i));
    const { error: updErr } = await supabase.from('dashboard_notes').update({ text }).eq('id', id);
    setItems(list => list.map(i => i.id === id ? { ...i, syncing: !!updErr } : i));
  };
  const clearDone = async () => {
    const doneIds = items.filter(i => i.done).map(i => i.id);
    if (!doneIds.length) return;
    const prev = items;
    setItems(list => list.filter(i => !i.done));
    const { error: delErr } = await supabase.from('dashboard_notes').delete().in('id', doneIds);
    if (delErr) {
      setItems(prev);
    }
  };

  const visible = items.filter(i => filter==='all' ? true : filter==='open' ? !i.done : i.done);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:compact?12:16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:compact?8:12, flexWrap: compact? 'wrap':'nowrap' }}>
        <h2 style={{ margin:0, fontSize:compact?16:20, display:'flex', alignItems:'center', gap:8 }}>
          Anteckningar & Todo
          <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:500, color: live==='on'? '#059669': live==='connecting'? '#d97706':'#6b7280' }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background: live==='on'? '#10b981': live==='connecting'? '#f59e0b':'#9ca3af', boxShadow: live==='on'? '0 0 4px #10b981':'' }} />
            {live==='on' ? 'Live' : live==='connecting' ? 'Ansluter…' : 'Offline'}
          </span>
        </h2>
        <div style={{ marginLeft:'auto', display:'flex', gap:compact?4:6 }}>
          {(['all','open','done'] as const).map(f => (
            <button key={f} onClick={()=>setFilter(f)} style={{ ...filterBtn, ...(filter===f? filterBtnActive : {}) }}>{f==='all'?'Alla': f==='open'?'Öppna':'Klart'}</button>
          ))}
        </div>
      </div>
      {error && (
        <div style={{ fontSize:12, color:'#b91c1c' }}>{error}</div>
      )}
      <form onSubmit={e=>{e.preventDefault(); addItem();}} style={{ display:'flex', gap:compact?6:8 }}>
        <input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Lägg till anteckning eller uppgift" style={{ ...input, fontSize: compact?13:14, padding: compact? '6px 8px':'8px 10px' }} />
        <button type="submit" style={{ ...btnPrimary, padding: compact? '6px 12px':'8px 14px', fontSize: compact?13:14 }} disabled={!draft.trim()}>Lägg till</button>
      </form>
      {loading && <p style={{ margin:0, fontSize:12, color:'#6b7280' }}>Laddar…</p>}
      {!loading && items.length === 0 && (
        <p style={{ margin:0, fontSize:compact?12:14, color:'#6b7280' }}>Inga anteckningar ännu. Lägg till din första ovan.</p>
      )}
      {items.length > 0 && (
        <ul style={{ listStyle:'none', padding:0, margin:0, display:'flex', flexDirection:'column', gap:compact?4:6 }}>
          {visible.sort((a,b)=> a.done===b.done ? b.created - a.created : a.done?1:-1).map(item => (
            <NoteRow key={item.id} item={item} onToggle={()=>toggle(item.id)} onRemove={()=>remove(item.id)} onEdit={(t)=>edit(item.id,t)} compact={compact} />
          ))}
        </ul>
      )}
      {items.some(i=>i.done) && (
        <div style={{ display:'flex', justifyContent:'flex-end' }}>
          <button style={{ ...miniBtn, padding: compact? '5px 8px':'6px 10px', fontSize: compact?11:12 }} onClick={clearDone}>Rensa klara</button>
        </div>
      )}
    </div>
  );
}

function NoteRow({ item, onToggle, onRemove, onEdit, compact }: { item: NoteItem; onToggle: ()=>void; onRemove: ()=>void; onEdit:(t:string)=>void; compact?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  useEffect(()=>{ setDraft(item.text); }, [item.text]);
  return (
  <li style={{ display:'flex', alignItems:'center', gap:compact?8:10, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding: compact? '6px 10px':'8px 12px', opacity:item.syncing?0.7:1 }}>
      <button onClick={onToggle} aria-label={item.done? 'Markera som ej klar':'Markera som klar'} style={{ ...checkBtn, width: compact?18:20, height: compact?18:20, ...(item.done? checkBtnDone : {}) }}>
        {item.done && (
          <svg width="14" height="14" viewBox="0 0 24 24" stroke="#fff" strokeWidth={3} fill="none"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        )}
      </button>
      {!editing && (
        <div onDoubleClick={()=>setEditing(true)} style={{ flex:1, fontSize:compact?13:14, color:item.done? '#64748b':'#111827', textDecoration:item.done?'line-through':'none', cursor:'text', display:'flex', alignItems:'center', gap:6 }}>
          <span>{item.text}</span>
          {item.syncing && !item.error && <span style={{ fontSize:10, color:'#6b7280' }}>⟳</span>}
          {item.error && <span style={{ fontSize:10, color:'#b91c1c' }} title={item.error}>⚠</span>}
        </div>
      )}
      {editing && (
        <form onSubmit={e=>{e.preventDefault(); onEdit(draft.trim() || item.text); setEditing(false);}} style={{ flex:1 }}>
          <input autoFocus value={draft} onChange={e=>setDraft(e.target.value)} onBlur={()=>{ setEditing(false); setDraft(item.text); }} style={{ ...input, padding: compact? '3px 5px':'4px 6px', fontSize:compact?12.5:13, width:'100%' }} />
        </form>
      )}
      <button onClick={()=>setEditing(true)} style={{ ...iconBtn, padding: compact? '3px 4px':'4px 6px', fontSize: compact?11:12 }} aria-label="Redigera">✏️</button>
      <button onClick={onRemove} style={{ ...iconBtn, padding: compact? '3px 4px':'4px 6px', fontSize: compact?11:12, color:'#b91c1c' }} aria-label="Ta bort">🗑️</button>
    </li>
  );
}

// Shared styles (mirrors admin styling look & feel)
const input: React.CSSProperties = { padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14, outline:'none', background:'#fff' };
const btnPrimary: React.CSSProperties = { padding:'8px 14px', borderRadius:8, border:'1px solid #111827', background:'#111827', color:'#fff', fontSize:14, cursor:'pointer', fontWeight:500 };
const filterBtn: React.CSSProperties = { padding:'6px 12px', borderRadius:999, background:'#fff', border:'1px solid #d1d5db', cursor:'pointer', fontSize:12, color:'#111827' };
const filterBtnActive: React.CSSProperties = { background:'#2563eb', color:'#fff', border:'1px solid #2563eb' };
const iconBtn: React.CSSProperties = { padding:'4px 6px', fontSize:12, lineHeight:1, cursor:'pointer', background:'#f1f5f9', borderRadius:6, border:'1px solid #e2e8f0' };
const miniBtn: React.CSSProperties = { padding:'6px 10px', background:'#334155', color:'#fff', borderRadius:6, fontSize:12, cursor:'pointer', border:'1px solid #334155' };
const checkBtn: React.CSSProperties = { width:20, height:20, borderRadius:6, border:'1px solid #cbd5e1', background:'#fff', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' };
const checkBtnDone: React.CSSProperties = { background:'#16a34a', border:'1px solid #16a34a' };

export default DashboardNotes;

"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

type Row = { job_type: string; color_hex: string };

const DEFAULT_JOB_TYPES = ['Ekovilla', 'Vitull', 'Leverans', 'Utsugning', 'Snickerier', 'Övrigt'];

export default function AdminJobTypes() {
  const supabase = createClientComponentClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newColor, setNewColor] = useState('#475569');

  useEffect(() => {
    let isCancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data, error } = await supabase
          .from('planning_job_type_colors')
          .select('job_type,color_hex')
          .order('job_type');
        if (error) throw error;
        if (!isCancelled) setRows((data || []) as any);
      } catch (e: any) {
        if (!isCancelled) setError(e?.message || String(e));
      } finally {
        if (!isCancelled) setLoading(false);
      }
    })();
    const sub = supabase
      .channel('jobtype-colors')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_job_type_colors' }, (payload) => {
        setRows(prev => {
          const rec = (payload.new as any) || (payload.old as any);
          const jt = rec?.job_type as string;
          if (!jt) return prev;
          if (payload.eventType === 'DELETE') return prev.filter(r => r.job_type !== jt);
          const color_hex = (payload.new as any)?.color_hex as string;
          const existing = prev.find(r => r.job_type === jt);
          if (existing) return prev.map(r => r.job_type === jt ? { job_type: jt, color_hex } : r);
          return [...prev, { job_type: jt, color_hex }];
        });
      })
      .subscribe();
    return () => { sub.unsubscribe(); isCancelled = true; };
  }, [supabase]);

  const byType = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.job_type, r.color_hex);
    return m;
  }, [rows]);

  const allTypes = useMemo(() => {
    const set = new Set<string>(DEFAULT_JOB_TYPES);
    for (const r of rows) set.add(r.job_type);
    return Array.from(set).sort((a,b)=>a.localeCompare(b,'sv'));
  }, [rows]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const items = allTypes.map(j => ({ job_type: j, color_hex: byType.get(j) || '' }));
    if (!q) return items;
    return items.filter(it => it.job_type.toLowerCase().includes(q));
  }, [allTypes, byType, filter]);

  async function save(job_type: string, color_hex: string) {
    setError(null);
    try {
      if (!/^#?[0-9a-fA-F]{6}$/.test(color_hex)) throw new Error('Ogiltig färg. Använd hex, t.ex. #1d4ed8');
      const hex = color_hex.startsWith('#') ? color_hex : '#' + color_hex;
      const { error } = await supabase
        .from('planning_job_type_colors')
        .upsert({ job_type, color_hex: hex })
        .select()
        .single();
      if (error) throw error;
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function remove(job_type: string) {
    setError(null);
    try {
      const { error } = await supabase
        .from('planning_job_type_colors')
        .delete()
        .eq('job_type', job_type);
      if (error) throw error;
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function addCustom() {
    const key = newKey.trim();
    if (!key) return;
    await save(key, newColor);
    setNewKey('');
  }

  return (
    <div style={{ padding: 16, display:'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Färger för Jobbtyp/Material</h2>
      <p style={{ margin: 0, color:'#6b7280' }}>Välj färg som visas på planeringskortens jobbtyp/material. Lämna tom för standard.</p>
      <div style={{ display:'flex', gap: 8, alignItems:'center', flexWrap:'wrap' }}>
        <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filtrera..." style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8 }} />
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <input value={newKey} onChange={e=>setNewKey(e.target.value)} placeholder="Ny jobbtyp…" style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8 }} />
          <input type="color" value={newColor} onChange={e=>setNewColor(e.target.value)} style={{ width:28, height:28, border:'1px solid #cbd5e1', borderRadius:6, background:'#fff' }} />
          <button onClick={addCustom} className="btn--plain" style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>Lägg till</button>
        </div>
      </div>
      {error && <div style={{ color:'#b91c1c' }}>Fel: {error}</div>}
      {loading ? (
        <div>Laddar…</div>
      ) : (
        <div style={{ display:'grid', gap: 8 }}>
          {visible.map(r => (
            <div key={r.job_type} style={{ display:'grid', gridTemplateColumns:'1fr auto auto auto', gap:10, alignItems:'center', padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontWeight: 600 }}>{r.job_type}</span>
                {r.color_hex ? (
                  <span style={{ fontSize:12, color:r.color_hex }}>Exempel</span>
                ) : (
                  <span style={{ fontSize:12, color:'#6b7280' }}>Standardfärg</span>
                )}
              </div>
              <input type="color" value={r.color_hex || '#475569'} onChange={e => save(r.job_type, e.target.value)} style={{ width:28, height:28, border:'1px solid #cbd5e1', borderRadius:6, background:'#fff' }} />
              <button onClick={() => save(r.job_type, r.color_hex || '#475569')} className="btn--sm btn--success">Spara</button>
              <button onClick={() => remove(r.job_type)} className="btn--sm btn--danger">Rensa</button>
            </div>
          ))}
          {visible.length === 0 && <div style={{ color:'#6b7280' }}>Inget att visa.</div>}
        </div>
      )}
    </div>
  );
}

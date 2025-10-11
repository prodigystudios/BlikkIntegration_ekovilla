"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

type UsageRow = {
  id: string;
  project_id: string;
  installation_date: string | null;
  depot_id: string;
  bags_used: number;
  source_key: string | null;
  created_at: string;
};

type Depot = { id: string; name: string; material_total: number | null };

export default function AdminDepotUsage() {
  const supabase = createClientComponentClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [q, setQ] = useState('');
  const [days, setDays] = useState(14);

  useEffect(() => {
    let isCancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const sinceISO = new Date(Date.now() - days * 86400_000).toISOString();
        const { data: usage, error: usageErr } = await supabase
          .from('planning_depot_usage')
          .select('*')
          .gte('created_at', sinceISO)
          .order('created_at', { ascending: false })
          .limit(200);
        if (usageErr) throw usageErr;
        const { data: depRows, error: depErr } = await supabase
          .from('planning_depots')
          .select('*')
          .order('name');
        if (depErr) throw depErr;
        if (!isCancelled) {
          setRows((usage || []) as any);
          setDepots((depRows || []) as any);
        }
      } catch (e: any) {
        if (!isCancelled) setError(e?.message || String(e));
      } finally { if (!isCancelled) setLoading(false); }
    })();
    return () => { isCancelled = true; };
  }, [supabase, days]);

  const depotName = (id: string) => depots.find(d => d.id === id)?.name || 'Okänd depå';

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(r => r.project_id.toLowerCase().includes(term) || (depotName(r.depot_id)).toLowerCase().includes(term) || (r.source_key || '').toLowerCase().includes(term));
  }, [rows, q, depots]);

  const totalBags = filtered.reduce((acc, r) => acc + (Number(r.bags_used)||0), 0);

  return (
    <div style={{ padding: 16, display:'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Depå-uttag (senaste {days} dagar)</h2>
      <div style={{ display:'flex', gap: 12, alignItems:'center', flexWrap:'wrap' }}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Sök (projekt, depå, nyckel)" style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8 }} />
        <label style={{ display:'flex', gap:8, alignItems:'center' }}>
          Visa dagar:
          <select value={days} onChange={e=>setDays(Number(e.target.value))}>
            <option value={7}>7</option>
            <option value={14}>14</option>
            <option value={30}>30</option>
            <option value={90}>90</option>
          </select>
        </label>
        <div style={{ marginLeft:'auto', fontWeight:600 }}>Summa säckar: {totalBags}</div>
      </div>
      {error && <div style={{ color:'#b91c1c' }}>Fel: {error}</div>}
      {loading ? (
        <div>Laddar…</div>
      ) : (
        <div style={{ display:'grid', gap: 6 }}>
          {filtered.map(r => (
            <div key={r.id} style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto auto', gap:8, alignItems:'center', padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:8 }}>
              <div>
                <div style={{ fontWeight:600 }}>{depotName(r.depot_id)}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>{new Date(r.created_at).toLocaleString()}</div>
              </div>
              <div>
                <div style={{ fontWeight:600 }}>Projekt: {r.project_id}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>Installationsdatum: {r.installation_date || '—'}</div>
              </div>
              <div style={{ justifySelf:'end', fontWeight:700 }}>{r.bags_used} säckar</div>
              <div style={{ justifySelf:'end', fontSize:12, color:'#6b7280' }}>{r.source_key || '—'}</div>
            </div>
          ))}
          {filtered.length === 0 && <div style={{ color:'#6b7280' }}>Inga uttag funna.</div>}
        </div>
      )}
    </div>
  );
}

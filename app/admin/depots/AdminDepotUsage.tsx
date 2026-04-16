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
  const uniqueProjects = new Set(filtered.map((row) => row.project_id)).size;
  const uniqueDepots = new Set(filtered.map((row) => row.depot_id)).size;

  return (
    <main style={{ padding: 12, display:'grid', gap:20 }}>
      <section style={{ border:'1px solid #dbe4ef', borderRadius:24, padding:20, background:'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)', boxShadow:'0 14px 36px rgba(15,23,42,0.04)', display:'grid', gap:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'flex-start', flexWrap:'wrap' }}>
          <div style={{ display:'grid', gap:6, maxWidth:760 }}>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <span style={eyebrowStyle}>Depå-uttag</span>
              <span style={chipStyle}>{filtered.length} rader</span>
              <span style={chipStyle}>{days} dagar</span>
            </div>
            <h1 style={{ margin:0, fontSize:28, color:'#0f172a' }}>Förbrukning och uttag i ett tydligare flöde</h1>
            <p style={{ margin:0, fontSize:14, color:'#475569', lineHeight:1.55 }}>Följ senaste depåuttag, filtrera på projekt eller depå och få en snabb summering av förbrukningen.</p>
          </div>
          <div style={{ display:'flex', gap: 12, alignItems:'center', flexWrap:'wrap' }}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Sök projekt, depå eller nyckel" style={{ ...fieldStyle, minWidth:260 }} />
        <label style={{ display:'flex', gap:8, alignItems:'center' }}>
          Visa dagar:
          <select value={days} onChange={e=>setDays(Number(e.target.value))} style={fieldStyle}>
            <option value={7}>7</option>
            <option value={14}>14</option>
            <option value={30}>30</option>
            <option value={90}>90</option>
          </select>
        </label>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:8 }}>
          <div style={miniStatStyle}><span style={miniLabelStyle}>Säckar</span><strong style={miniValueStyle}>{totalBags}</strong></div>
          <div style={miniStatStyle}><span style={miniLabelStyle}>Projekt</span><strong style={miniValueStyle}>{uniqueProjects}</strong></div>
          <div style={miniStatStyle}><span style={miniLabelStyle}>Depåer</span><strong style={miniValueStyle}>{uniqueDepots}</strong></div>
        </div>
      </section>
      {error && <div style={{ color:'#b91c1c' }}>Fel: {error}</div>}
      {loading ? (
        <div>Laddar…</div>
      ) : (
        <div style={{ display:'grid', gap: 10 }}>
          {filtered.map(r => (
            <div key={r.id} style={{ display:'grid', gridTemplateColumns:'minmax(0, 1fr) minmax(0, 1fr) auto auto', gap:10, alignItems:'center', padding:'12px 14px', border:'1px solid #dbe4ef', borderRadius:16, background:'#fff', boxShadow:'0 8px 20px rgba(15,23,42,0.03)' }}>
              <div>
                <div style={{ fontWeight:700, color:'#0f172a' }}>{depotName(r.depot_id)}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>{new Date(r.created_at).toLocaleString('sv-SE')}</div>
              </div>
              <div>
                <div style={{ fontWeight:700, color:'#0f172a' }}>Projekt: {r.project_id}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>Installationsdatum: {r.installation_date || '—'}</div>
              </div>
              <div style={{ justifySelf:'end', fontWeight:800, color:'#0f172a' }}>{r.bags_used} säckar</div>
              <div style={{ justifySelf:'end', fontSize:12, color:'#6b7280' }}>{r.source_key || '—'}</div>
            </div>
          ))}
          {filtered.length === 0 && <div style={{ color:'#6b7280' }}>Inga uttag funna.</div>}
        </div>
      )}
    </main>
  );
}

const eyebrowStyle: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 10px', borderRadius:999, background:'#dbeafe', border:'1px solid #bfdbfe', color:'#2563eb', fontSize:11, fontWeight:800, letterSpacing:0.35, textTransform:'uppercase' };
const chipStyle: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 8px', borderRadius:999, background:'#f8fafc', border:'1px solid #e2e8f0', color:'#475569', fontSize:12, fontWeight:700 };
const fieldStyle: React.CSSProperties = { padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:10, fontSize:14, outline:'none', background:'#fff' };
const miniStatStyle: React.CSSProperties = { display:'grid', gap:5, padding:'12px 12px 10px', borderRadius:16, border:'1px solid #dbe4ef', background:'#fff' };
const miniLabelStyle: React.CSSProperties = { fontSize:11, fontWeight:800, letterSpacing:0.3, textTransform:'uppercase', color:'#64748b' };
const miniValueStyle: React.CSSProperties = { fontSize:20, fontWeight:800, color:'#0f172a' };

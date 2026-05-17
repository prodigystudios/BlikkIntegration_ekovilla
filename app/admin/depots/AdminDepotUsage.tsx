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
type ProjectLookupMeta = { orderNumber: string | null; projectName: string | null };

export default function AdminDepotUsage() {
  const supabase = createClientComponentClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [projectMeta, setProjectMeta] = useState<Record<string, ProjectLookupMeta>>({});
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

  useEffect(() => {
    const missingProjectIds = Array.from(new Set(rows.map((row) => row.project_id).filter(Boolean))).filter((projectId) => !(projectId in projectMeta));
    if (missingProjectIds.length === 0) return;

    let isCancelled = false;

    (async () => {
      const entries = await Promise.all(missingProjectIds.map(async (projectId) => {
        try {
          const res = await fetch(`/api/projects/lookup?id=${encodeURIComponent(projectId)}`);
          if (!res.ok) return [projectId, { orderNumber: null, projectName: null }] as const;
          const project = await res.json();
          return [
            projectId,
            {
              orderNumber: asString(project?.orderNumber ?? project?.order_number ?? project?.project?.orderNumber ?? project?.project?.order_number ?? project?.project?.orderNo ?? null),
              projectName: asString(project?.name ?? project?.project?.name ?? project?.projectName ?? project?.project_name ?? null),
            },
          ] as const;
        } catch {
          return [projectId, { orderNumber: null, projectName: null }] as const;
        }
      }));

      if (isCancelled) return;

      setProjectMeta((prev) => {
        const next = { ...prev };
        for (const [projectId, meta] of entries) next[projectId] = meta;
        return next;
      });
    })();

    return () => { isCancelled = true; };
  }, [rows, projectMeta]);

  const depotName = (id: string) => depots.find(d => d.id === id)?.name || 'Okänd depå';
  const projectLabel = (projectId: string) => {
    const meta = projectMeta[projectId];
    if (meta?.orderNumber) return `#${meta.orderNumber}`;
    if (meta?.projectName) return meta.projectName;
    return projectId;
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => {
      const meta = projectMeta[row.project_id];
      return [
        row.project_id,
        meta?.orderNumber || '',
        meta?.projectName || '',
        depotName(row.depot_id),
        row.source_key || '',
      ].some((value) => value.toLowerCase().includes(term));
    });
  }, [rows, q, depots, projectMeta]);

  const totalBags = filtered.reduce((acc, r) => acc + (Number(r.bags_used)||0), 0);
  const uniqueProjects = new Set(filtered.map((row) => row.project_id)).size;
  const uniqueDepots = new Set(filtered.map((row) => row.depot_id)).size;

  return (
    <main style={{ padding: 12, display:'grid', gap:20, maxWidth:1240, margin:'0 auto' }}>
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
          <div style={{ display:'flex', gap: 12, alignItems:'center', flexWrap:'wrap', width:'min(100%, 460px)' }}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Sök ordernummer, projekt, depå eller nyckel" style={{ ...fieldStyle, minWidth:260 }} />
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
            <article key={r.id} style={usageCardStyle}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
                <div style={{ display:'grid', gap:4, minWidth:0, flex:'1 1 220px' }}>
                  <div style={{ fontWeight:700, color:'#0f172a' }}>{depotName(r.depot_id)}</div>
                  <div style={{ fontSize:12, color:'#6b7280' }}>{new Date(r.created_at).toLocaleString('sv-SE')}</div>
                </div>
                <div style={bagsBadgeStyle}>{r.bags_used} säckar</div>
              </div>

              <div style={usageMetaGridStyle}>
                <div style={usageMetaCardStyle}>
                  <span style={usageMetaLabelStyle}>Order</span>
                  <strong style={usageMetaValueStyle}>{projectLabel(r.project_id)}</strong>
                  <span style={usageMetaSubtleStyle}>Projekt-ID: {r.project_id}</span>
                </div>
                <div style={usageMetaCardStyle}>
                  <span style={usageMetaLabelStyle}>Installationsdatum</span>
                  <strong style={usageMetaValueStyle}>{r.installation_date || '—'}</strong>
                </div>
                <div style={usageMetaCardStyle}>
                  <span style={usageMetaLabelStyle}>Källa</span>
                  <strong style={usageMetaValueStyle}>{r.source_key || '—'}</strong>
                </div>
              </div>
            </article>
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
const usageCardStyle: React.CSSProperties = { display:'grid', gap:12, padding:'14px 14px 12px', border:'1px solid #dbe4ef', borderRadius:18, background:'#fff', boxShadow:'0 8px 20px rgba(15,23,42,0.03)' };
const bagsBadgeStyle: React.CSSProperties = { display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'8px 10px', borderRadius:999, background:'#eff6ff', border:'1px solid #bfdbfe', color:'#1d4ed8', fontSize:13, fontWeight:800, whiteSpace:'nowrap' };
const usageMetaGridStyle: React.CSSProperties = { display:'grid', gap:10, gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))' };
const usageMetaCardStyle: React.CSSProperties = { display:'grid', gap:4, padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:14, background:'#f8fbff' };
const usageMetaLabelStyle: React.CSSProperties = { fontSize:11, fontWeight:800, letterSpacing:0.3, textTransform:'uppercase', color:'#64748b' };
const usageMetaValueStyle: React.CSSProperties = { fontSize:14, fontWeight:700, color:'#0f172a', wordBreak:'break-word' };
const usageMetaSubtleStyle: React.CSSProperties = { fontSize:12, color:'#64748b', wordBreak:'break-word' };

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

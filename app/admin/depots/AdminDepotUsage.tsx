"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { crm } from '../../crm/lib/crmTokens';
import { cn } from '../../../lib/shared/cn';
import { ADMIN_CARD, ADMIN_ERROR_BOX, ADMIN_INSET, ADMIN_LABEL, AdminEmptyState } from '../components/adminUi';

type UsageRow = {
  id: string;
  project_id: string;
  order_number?: string | null;
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
        row.order_number || '',
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
    <div className="grid gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="m-0 text-lg font-bold text-slate-900">Depå-uttag</h2>
          <p className="m-0 text-sm text-slate-600">Senaste uttagen per depå och projekt.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 lg:w-[460px]">
          <Input value={q} onChange={e=>setQ(e.target.value)} placeholder="Sök ordernummer, projekt, depå eller nyckel" className="min-w-[260px] flex-1" />
          <label className="flex w-auto items-center gap-2 text-sm text-slate-700">
            <span>Visa dagar:</span>
            <Select value={days} onChange={e=>setDays(Number(e.target.value))} className="w-auto min-w-[92px]">
              <option value={7}>7</option>
              <option value={14}>14</option>
              <option value={30}>30</option>
              <option value={90}>90</option>
            </Select>
          </label>
        </div>
      </div>

      <p className="m-0 text-[11px] text-slate-500">
        <span className="font-semibold tabular-nums">{totalBags}</span> säckar · <span className="tabular-nums">{uniqueProjects}</span> projekt · <span className="tabular-nums">{uniqueDepots}</span> depåer
      </p>

      {error && <div role="alert" className={ADMIN_ERROR_BOX}>{error}</div>}
      {loading ? (
        <p role="status" className="m-0 text-sm text-slate-500">Laddar…</p>
      ) : (
        <div className="grid gap-2.5">
          {filtered.map(r => (
            <article key={r.id} className={cn(ADMIN_CARD, 'grid gap-3 p-4')}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid min-w-0 flex-1 basis-[220px] gap-1">
                  <div className="text-[13px] font-bold text-slate-900">{depotName(r.depot_id)}</div>
                  <div className="text-[11px] text-slate-500">{new Date(r.created_at).toLocaleString('sv-SE')}</div>
                </div>
                <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700 tabular-nums')}>{r.bags_used} säckar</span>
              </div>

              <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
                <div className={cn(ADMIN_INSET, 'min-w-0 grid gap-1 px-3 py-2.5')}>
                  <span className={ADMIN_LABEL}>Order</span>
                  <strong className="min-w-0 break-all text-sm font-semibold text-slate-900">{r.order_number ? `#${r.order_number}` : projectLabel(r.project_id)}</strong>
                  <span className="break-words text-xs text-slate-500">Projekt-ID: {r.project_id}</span>
                </div>
                <div className={cn(ADMIN_INSET, 'min-w-0 grid gap-1 px-3 py-2.5')}>
                  <span className={ADMIN_LABEL}>Installationsdatum</span>
                  <strong className="min-w-0 break-all text-sm font-semibold text-slate-900">{r.installation_date || '—'}</strong>
                </div>
                <div className={cn(ADMIN_INSET, 'min-w-0 grid gap-1 px-3 py-2.5')}>
                  <span className={ADMIN_LABEL}>Källa</span>
                  <strong className="min-w-0 break-all text-sm font-semibold text-slate-900">{r.source_key || '—'}</strong>
                </div>
              </div>
            </article>
          ))}
          {filtered.length === 0 && !error && (
            <AdminEmptyState title="Inga uttag funna" description="Prova fler dagar eller en bredare sökning för att se fler poster." />
          )}
        </div>
      )}
    </div>
  );
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

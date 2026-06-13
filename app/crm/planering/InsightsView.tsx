'use client';

import { useEffect, useState } from 'react';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatCurrency } from '@/app/crm/lib/format';
import type { PlanningInsights } from '@/lib/domains/planning/insights';

const REVENUE = '#1a3f26';
const SACKS = '#0284c7';
const TRUCK_PALETTE = ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0d9488', '#a05c6b', '#5a7d9a', '#8a7a4e'];
const compact = new Intl.NumberFormat('sv-SE', { notation: 'compact', maximumFractionDigits: 1 });
const kr = (v: number) => formatCurrency(v, 'SEK');

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[#e0e8dc] bg-white p-4">
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-[20px] font-extrabold tracking-tight tabular-nums text-[#142c1b]">{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-slate-500">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#e0e8dc] bg-white p-4">
      <h3 className="text-[13.5px] font-extrabold text-[#142c1b]">{title}</h3>
      {hint && <p className="mb-2 mt-0.5 text-[11.5px] text-slate-500">{hint}</p>}
      <div className="mt-2 h-[240px]">{children}</div>
    </div>
  );
}

export default function InsightsView({ weeks = 8 }: { weeks?: number }) {
  const [data, setData] = useState<PlanningInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/crm/planering/insights?weeks=${weeks}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!active) return;
        if (!j.ok) throw new Error(j.error || 'Kunde inte ladda insikterna');
        setData(j.data as PlanningInsights);
      })
      .catch((e) => active && setError(e?.message || 'Kunde inte ladda insikterna'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [weeks]);

  if (loading) return <div className="grid place-items-center py-20 text-[13px] text-slate-400">Laddar insikter…</div>;
  if (error) return <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>;
  if (!data) return null;

  const totalRevenue = data.weeks.reduce((s, w) => s + w.revenue, 0);
  const totalSacks = data.weeks.reduce((s, w) => s + w.sacks, 0);
  const axisTick = { fontSize: 11, fill: '#64748b' } as const;

  return (
    <div className="grid gap-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={`Schemalagt · ${weeks} v`} value={kr(totalRevenue)} sub="omsättning ex moms" />
        <Kpi label={`Säckar · ${weeks} v`} value={`${totalSacks}`} sub="planerat att blåsa" />
        <Kpi label="Oplanerat värde" value={kr(data.backlog.revenue)} sub={`${data.backlog.sacks} säck väntar`} />
        <Kpi label="Oplanerade jobb" value={`${data.backlog.count}`} sub="väntar på planering" />
      </div>

      {/* Revenue + sacks per week */}
      <ChartCard title="Omsättning & säckar per vecka" hint={`Schemalagt arbete kommande ${weeks} veckor (omsättning = staplar, säckar = linje).`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.weeks} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef3eb" vertical={false} />
            <XAxis dataKey="label" tick={axisTick} />
            <YAxis yAxisId="rev" tickFormatter={(v) => compact.format(Number(v))} tick={axisTick} width={44} />
            <YAxis yAxisId="sacks" orientation="right" tick={axisTick} width={32} />
            <Tooltip
              formatter={(value, name) => (name === 'Säckar' ? [`${value} säck`, name] : [kr(Number(value)), name])}
              labelStyle={{ color: '#0f172a', fontWeight: 700 }}
              contentStyle={{ borderRadius: 12, border: '1px solid #e0e8dc', fontSize: 12 }}
            />
            <Bar yAxisId="rev" dataKey="revenue" name="Omsättning" fill={REVENUE} radius={[4, 4, 0, 0]} maxBarSize={38} />
            <Line yAxisId="sacks" type="monotone" dataKey="sacks" name="Säckar" stroke={SACKS} strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Per truck */}
        <ChartCard title="Omsättning per bil" hint="Belastning per lastbil i perioden.">
          {data.byTruck.length === 0 ? (
            <div className="grid h-full place-items-center text-[12px] text-slate-400">Inget schemalagt än.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={data.byTruck} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef3eb" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => compact.format(Number(v))} tick={axisTick} />
                <YAxis type="category" dataKey="truck_name" tick={axisTick} width={70} />
                <Tooltip formatter={(value) => [kr(Number(value)), 'Omsättning']} contentStyle={{ borderRadius: 12, border: '1px solid #e0e8dc', fontSize: 12 }} />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]} maxBarSize={26}>
                  {data.byTruck.map((t, i) => (
                    <Cell key={t.truck_id} fill={TRUCK_PALETTE[i % TRUCK_PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Per material */}
        <ChartCard title="Säckbehov per material" hint="Underlag för depåpåfyllning.">
          {data.byMaterial.length === 0 ? (
            <div className="grid h-full place-items-center text-[12px] text-slate-400">Inget schemalagt än.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byMaterial} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef3eb" vertical={false} />
                <XAxis dataKey="material" tick={axisTick} />
                <YAxis tick={axisTick} width={36} />
                <Tooltip formatter={(value) => [`${value} säck`, 'Behov']} contentStyle={{ borderRadius: 12, border: '1px solid #e0e8dc', fontSize: 12 }} />
                <Bar dataKey="sacks" fill={SACKS} radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

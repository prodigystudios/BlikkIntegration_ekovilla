"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import {
  aggregateBuckets,
  buildBatchCsvLines,
  buildMonthlyReportCsvLines,
  sanitizeFilename,
  type AggBucket,
  type SampleRow,
} from './aggregate';

function downloadCsv(filename: string, lines: string[]) {
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const primaryBtn =
  'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

export default function MaterialKvalitetPage() {
  const [rows, setRows] = useState<SampleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<'batch' | 'date'>('batch');
  const [materialFilter, setMaterialFilter] = useState<string>('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchDeltaX, setTouchDeltaX] = useState(0);
  const isTouch = typeof navigator !== 'undefined' && ((navigator as any).maxTouchPoints || 0) > 0;
  const SWIPE_THRESHOLD = isTouch ? 40 : 60;

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch('/api/material-quality/list', { cache: 'no-store' });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || 'Kunde inte hämta data');
        setRows(j.rows || []);
      } catch (e: any) {
        setError(e?.message || 'Fel vid hämtning');
      } finally { setLoading(false); }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = materialFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((x) => (x.material_used || '').toLowerCase().includes(q));
  }, [rows, materialFilter]);

  const batches = useMemo(() => aggregateBuckets(filtered, group), [filtered, group]);

  useEffect(() => { setActiveIndex(0); }, [group, materialFilter]);
  useEffect(() => {
    if (batches.length === 0) { if (activeIndex !== 0) setActiveIndex(0); return; }
    if (activeIndex < 0) setActiveIndex(0);
    else if (activeIndex >= batches.length) setActiveIndex(batches.length - 1);
  }, [batches, activeIndex]);

  function exportBatchRaw(batchKey: string) {
    setExporting(`batch-${batchKey}`);
    try {
      downloadCsv(`material_batch_${sanitizeFilename(batchKey)}.csv`, buildBatchCsvLines(filtered, batchKey));
    } finally { setExporting(null); }
  }

  function exportMonthlyReport() {
    setExporting('month');
    try {
      downloadCsv('material_monthly_report.csv', buildMonthlyReportCsvLines(filtered));
    } finally { setExporting(null); }
  }

  return (
    <div className="mx-auto grid w-full max-w-[1000px] grid-cols-1 gap-4">
      <div>
        <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Materialkvalitet</h1>
        <p className="m-0 mt-1 text-sm text-slate-500">Intern uppföljning av densitet, dammighet och klumpighet.</p>
      </div>

      <div className={cn(crm.cardInner, 'flex flex-wrap items-end gap-3')}>
        <label className="grid gap-1.5">
          <span className={crm.label}>Filtrera material</span>
          <input className={crm.input} value={materialFilter} onChange={(e) => setMaterialFilter(e.target.value)} placeholder="Materialnamn" />
        </label>
        <label className="grid gap-1.5">
          <span className={crm.label}>Gruppering</span>
          <select className={crm.select} value={group} onChange={(e) => setGroup(e.target.value as any)}>
            <option value="batch">Per batch</option>
            <option value="date">Per installationsdatum</option>
          </select>
        </label>
        <button
          type="button"
          className={cn(primaryBtn, 'sm:ml-auto')}
          style={{ backgroundColor: 'var(--crm-primary)' }}
          disabled={loading || exporting !== null}
          onClick={exportMonthlyReport}
          title="Exportera medelvärden per månad (alla filtrerade rader)"
        >
          {exporting === 'month' ? 'Export…' : 'Exportera månadsrapport'}
        </button>
      </div>

      {loading && <div className="text-sm text-slate-400">Laddar…</div>}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {!loading && !error && (
        <>
          <section className="grid gap-3">
            <p className={crm.sectionTitle}>Översikt</p>
            {batches.length === 0 && <div className="text-sm text-slate-400">Ingen data.</div>}

            {group === 'batch' ? (
              batches.length > 0 && (
                <div className="grid gap-3">
                  <div className="text-center text-xs text-slate-400">Batch {Math.min(activeIndex + 1, batches.length)} av {batches.length}</div>
                  {(() => {
                    const bucket = batches[activeIndex];
                    if (!bucket) return null;
                    const translating = touchStartX !== null && Math.abs(touchDeltaX) > 0;
                    return (
                      <div
                        key={bucket.key + '-' + activeIndex}
                        className={cn(crm.cardInner, 'grid gap-3 [touch-action:pan-y]')}
                        style={{ transform: translating ? `translate3d(${touchDeltaX}px,0,0)` : 'translate3d(0,0,0)', willChange: 'transform', transition: translating ? 'none' : 'transform 160ms ease' }}
                        onTouchStart={(e) => { if (e.touches.length !== 1) return; setTouchStartX(e.touches[0].clientX); setTouchDeltaX(0); }}
                        onTouchMove={(e) => { if (touchStartX === null) return; setTouchDeltaX(e.touches[0].clientX - touchStartX); }}
                        onTouchEnd={() => {
                          if (touchStartX === null) return;
                          const delta = touchDeltaX; setTouchStartX(null); setTouchDeltaX(0);
                          if (delta > SWIPE_THRESHOLD && activeIndex > 0) setActiveIndex((i) => i - 1);
                          else if (delta < -SWIPE_THRESHOLD && activeIndex < batches.length - 1) setActiveIndex((i) => i + 1);
                        }}
                        onTouchCancel={() => { setTouchStartX(null); setTouchDeltaX(0); }}
                      >
                        <div className="flex flex-wrap items-baseline gap-2">
                          <strong className="text-sm font-bold text-slate-900">Batch: {bucket.key}</strong>
                          <span className="text-xs text-slate-400">({bucket.count} rader)</span>
                          <button type="button" className={cn(primaryBtn, 'ml-auto')} style={{ backgroundColor: 'var(--crm-primary)' }} disabled={exporting !== null} onClick={() => exportBatchRaw(bucket.key)}>
                            {exporting === `batch-${bucket.key}` ? 'Export…' : 'Exportera batch CSV'}
                          </button>
                        </div>
                        <MetricsRow bucket={bucket} />
                        <BarCharts bucket={bucket} />
                        <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                          {batches.map((b, i) => (
                            <button
                              key={b.key + i}
                              type="button"
                              aria-label={`Gå till batch ${i + 1}`}
                              onClick={() => setActiveIndex(i)}
                              className={cn('h-2.5 w-2.5 rounded-full border transition-colors', i === activeIndex ? 'border-emerald-600 bg-emerald-600' : 'border-slate-300 bg-white')}
                            />
                          ))}
                        </div>
                        <div className="mt-1 text-center text-[11px] text-slate-400">Svep vänster/höger eller tryck på punkterna för att byta batch.</div>
                      </div>
                    );
                  })()}
                </div>
              )
            ) : (
              <div className="grid gap-3">
                {batches.map((bucket) => (
                  <div key={bucket.key} className={cn(crm.cardInner, 'grid gap-3')}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <strong className="text-sm font-bold text-slate-900">Datum: {bucket.key}</strong>
                      <span className="text-xs text-slate-400">({bucket.count} rader)</span>
                    </div>
                    <MetricsRow bucket={bucket} />
                    <BarCharts bucket={bucket} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-2">
            <p className={crm.sectionTitle}>Detaljer (rådata)</p>
            <div className="overflow-x-auto rounded-2xl border border-[#e0e8dc]">
              <table className="w-full border-collapse text-[13px]">
                <thead className="bg-[#f6f9f3]">
                  <tr>
                    {['Skapad', 'Datum', 'Batch', 'Material', 'Order', 'Etapp', 'Källa', 'Densitet', 'Dammighet', 'Klumpighet', 'Fluffer'].map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(group === 'batch' && batches.length > 0 ? filtered.filter((r) => (r.batch_number || '—') === batches[activeIndex]?.key) : filtered).map((r) => (
                    <tr key={r.id} className="border-t border-[#eef2ec]">
                      <Td>{(r.created_at || '').slice(0, 10)}</Td>
                      <Td>{r.installation_date || '—'}</Td>
                      <Td>{r.batch_number || '—'}</Td>
                      <Td>{r.material_used || '—'}</Td>
                      <Td>{r.order_id || '—'}</Td>
                      <Td>{r.etapp_name || '—'}</Td>
                      <Td>{r.source_type || '—'}</Td>
                      <Td>{r.densitet ?? '—'}</Td>
                      <Td>{r.dammighet ?? '—'}</Td>
                      <Td>{r.klumpighet ?? '—'}</Td>
                      <Td>{r.fluffer_used === true ? 'Ja' : r.fluffer_used === false ? 'Nej' : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function MetricsRow({ bucket }: { bucket: AggBucket }) {
  return (
    <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
      <Metric label="Medeldensitet" value={bucket.avgDensitet !== null ? bucket.avgDensitet + ' kg/m²' : '—'} />
      <Metric label="Medel dammighet" value={bucket.avgDamm !== null ? bucket.avgDamm : '—'} />
      <Metric label="Medel klumpighet" value={bucket.avgKlump !== null ? bucket.avgKlump : '—'} />
      <Metric label="Fluffer använd (%)" value={bucket.count ? ((bucket.flufferTrue / bucket.count) * 100).toFixed(1) + '%' : '—'} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div className="grid gap-0.5 rounded-xl border border-[#e3e9df] bg-white px-3 py-2.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</span>
      <strong className="text-base text-slate-900 tabular-nums">{value}</strong>
    </div>
  );
}

function Td({ children }: { children: any }) {
  return <td className="px-2 py-1.5 text-slate-700">{children}</td>;
}

function BarCharts({ bucket }: { bucket: AggBucket }) {
  const bars: Array<{ label: string; value: number | null; max: number; color: string; unit?: string }> = [
    { label: 'Densitet', value: bucket.avgDensitet, max: 60, color: '#16a34a', unit: 'kg/m²' },
    { label: 'Dammighet', value: bucket.avgDamm, max: 10, color: '#f59e0b' },
    { label: 'Klumpighet', value: bucket.avgKlump, max: 10, color: '#0d9488' },
  ];
  return (
    <div className="grid gap-1.5">
      {bars.map((b) => (
        <div key={b.label} className="grid gap-0.5">
          <div className="flex justify-between text-xs text-slate-600">
            <span>{b.label}</span>
            <span className="tabular-nums">{b.value !== null ? b.value + (b.unit ? ` ${b.unit}` : '') : '—'}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded bg-[#eef2ec]">
            {b.value !== null && <div style={{ width: `${Math.min(100, (b.value / b.max) * 100)}%`, background: b.color, height: '100%' }} />}
          </div>
        </div>
      ))}
    </div>
  );
}

"use client";
import { useEffect, useMemo, useState } from 'react';

// Shape returned by API route
interface SampleRow {
  id: string;
  order_id: string | null;
  project_number: string | null;
  installation_date: string | null;
  material_used: string | null;
  batch_number: string | null;
  fluffer_used: boolean | null;
  dammighet: number | null;
  klumpighet: number | null;
  etapp_name: string | null;
  densitet: number | null;
  source_type: 'open' | 'closed' | null;
  created_at: string;
}

interface AggBucket {
  key: string; // batch or date
  count: number;
  avgDensitet: number | null;
  avgDamm: number | null;
  avgKlump: number | null;
  flufferTrue: number; // count of rows where fluffer_used = true
}

export default function MaterialKvalitetPage() {
  const [rows, setRows] = useState<SampleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<'batch' | 'date'>('batch');
  const [materialFilter, setMaterialFilter] = useState<string>('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0); // which batch card is visible (batch grouping only)
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchDeltaX, setTouchDeltaX] = useState(0);
  const SWIPE_THRESHOLD = 60; // px

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
    let r = rows;
    if (materialFilter.trim()) r = r.filter(x => (x.material_used || '').toLowerCase().includes(materialFilter.trim().toLowerCase()));
    return r;
  }, [rows, materialFilter]);

  const batches = useMemo(() => {
    const map = new Map<string, AggBucket>();
    for (const r of filtered) {
      const key = group === 'batch'
        ? (r.batch_number || '—')
        : (r.installation_date || '—');
      let b = map.get(key);
      if (!b) { b = { key, count: 0, avgDensitet: 0, avgDamm: 0, avgKlump: 0, flufferTrue: 0 }; map.set(key, b); }
      b.count++;
      b.avgDensitet = (b.avgDensitet || 0) + (r.densitet ?? 0);
      b.avgDamm = (b.avgDamm || 0) + (r.dammighet ?? 0);
      b.avgKlump = (b.avgKlump || 0) + (r.klumpighet ?? 0);
      if (r.fluffer_used) b.flufferTrue++;
    }
    return Array.from(map.values()).map(b => ({
      ...b,
      avgDensitet: b.count ? Number((b.avgDensitet! / b.count).toFixed(2)) : null,
      avgDamm: b.count ? Number((b.avgDamm! / b.count).toFixed(2)) : null,
      avgKlump: b.count ? Number((b.avgKlump! / b.count).toFixed(2)) : null,
    })).sort((a,b) => a.key.localeCompare(b.key));
  }, [filtered, group]);

  // Clamp / reset active index when dependencies change
  useEffect(() => { setActiveIndex(0); }, [group, materialFilter]);
  useEffect(() => {
    if (batches.length === 0) {
      if (activeIndex !== 0) setActiveIndex(0);
      return;
    }
    if (activeIndex < 0) setActiveIndex(0);
    else if (activeIndex >= batches.length) setActiveIndex(batches.length - 1);
  }, [batches, activeIndex]);

  const monthAgg = useMemo(() => {
    const map = new Map<string, AggBucket>();
    for (const r of filtered) {
      const iso = r.installation_date || '—';
      const key = iso && iso.length >= 7 ? iso.slice(0,7) : '—';
      let b = map.get(key);
      if (!b) { b = { key, count: 0, avgDensitet: 0, avgDamm: 0, avgKlump: 0, flufferTrue: 0 }; map.set(key, b); }
      b.count++;
      b.avgDensitet = (b.avgDensitet || 0) + (r.densitet ?? 0);
      b.avgDamm = (b.avgDamm || 0) + (r.dammighet ?? 0);
      b.avgKlump = (b.avgKlump || 0) + (r.klumpighet ?? 0);
      if (r.fluffer_used) b.flufferTrue++;
    }
    return Array.from(map.values()).map(b => ({
      ...b,
      avgDensitet: b.count ? Number((b.avgDensitet! / b.count).toFixed(2)) : null,
      avgDamm: b.count ? Number((b.avgDamm! / b.count).toFixed(2)) : null,
      avgKlump: b.count ? Number((b.avgKlump! / b.count).toFixed(2)) : null,
    })).sort((a,b) => a.key.localeCompare(b.key));
  }, [filtered]);

  function sanitize(name: string) {
    return name.replace(/[^A-Za-z0-9_\-\.]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  }

  function downloadCsv(filename: string, lines: string[]) {
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportBatchRaw(batchKey: string) {
    setExporting(`batch-${batchKey}`);
    try {
      const target = filtered.filter(r => (r.batch_number || '—') === batchKey);
      const lines = [
        // English headers (removed id & created_at)
        'installation_date;batch;material;order;stage;source;density;dust;clump;fluffer'
      ];
      for (const r of target) {
        lines.push([
          r.installation_date || '',
          r.batch_number || '',
          r.material_used || '',
          r.order_id || '',
          r.etapp_name || '', // stage
          r.source_type || '',
          r.densitet ?? '', // density
          r.dammighet ?? '', // dust
          r.klumpighet ?? '', // clump
          r.fluffer_used === true ? '1' : (r.fluffer_used === false ? '0' : '') // fluffer
        ].map(v => String(v).replace(/;/g, ',')).join(';'));
      }
      const fname = `material_batch_${sanitize(batchKey)}.csv`;
      downloadCsv(fname, lines);
    } finally { setExporting(null); }
  }

  async function exportMonthlyReport() {
    setExporting('month');
    try {
      // Aggregate per month + batch so batch numbers are explicitly present
      type RowAgg = { month: string; batch: string; count: number; densSum: number; dammSum: number; klumpSum: number; flufferTrue: number };
      const map = new Map<string, RowAgg>();
      for (const r of filtered) {
        const month = (r.installation_date || '—').slice(0,7) || '—';
        const batch = r.batch_number || '—';
        const key = month + '||' + batch;
        let a = map.get(key);
        if (!a) { a = { month, batch, count: 0, densSum: 0, dammSum: 0, klumpSum: 0, flufferTrue: 0 }; map.set(key, a); }
        a.count++;
        a.densSum += r.densitet ?? 0;
        a.dammSum += r.dammighet ?? 0;
        a.klumpSum += r.klumpighet ?? 0;
        if (r.fluffer_used) a.flufferTrue++;
      }
      const aggs = Array.from(map.values()).sort((a,b) => a.month.localeCompare(b.month) || a.batch.localeCompare(b.batch));
      const lines = [ 'month;batch;count;avg_density;avg_dust;avg_clump;fluffer_usage_percent' ];
      for (const a of aggs) {
        lines.push([
          a.month,
          a.batch,
          a.count,
          a.count ? (a.densSum / a.count).toFixed(2) : '',
          a.count ? (a.dammSum / a.count).toFixed(2) : '',
          a.count ? (a.klumpSum / a.count).toFixed(2) : '',
          a.count ? ((a.flufferTrue / a.count) * 100).toFixed(1) : ''
        ].join(';'));
      }
      const fname = `material_monthly_report.csv`;
      downloadCsv(fname, lines);
    } finally { setExporting(null); }
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 16 }}>
      <h1 style={{ margin: 0 }}>Materialkvalitet</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Filtrera material</span>
          <input value={materialFilter} onChange={e => setMaterialFilter(e.target.value)} placeholder="Materialnamn" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Gruppering</span>
          <select value={group} onChange={e => setGroup(e.target.value as any)}>
            <option value="batch">Per batch</option>
            <option value="date">Per installationsdatum</option>
          </select>
        </label>
        <button
          type="button"
          className="btn--primary btn--sm"
          disabled={loading || exporting !== null}
          onClick={exportMonthlyReport}
          title="Exportera medelvärden per månad (alla filtrerade rader)"
        >{exporting === 'month' ? 'Export...' : 'Exportera månadsrapport'}</button>
      </div>

      {loading && <div>Laddar…</div>}
      {error && <div style={{ color: '#b91c1c' }}>{error}</div>}

      {!loading && !error && (
        <>
          <section style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ fontSize: 18, margin: '8px 0 0' }}>Översikt</h2>
            {batches.length === 0 && <div style={{ color: '#6b7280' }}>Ingen data.</div>}
            {group === 'batch' ? (
              batches.length > 0 && (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ textAlign: 'center', fontSize: 12, color: '#6b7280' }}>
                    Batch {Math.min(activeIndex + 1, batches.length)} av {batches.length}
                  </div>
                  {(() => {
                    const bucket = batches[activeIndex];
                    if (!bucket) return null;
                    const translating = touchStartX !== null && Math.abs(touchDeltaX) > 0;
                    return (
                      <div
                        key={bucket.key + '-' + activeIndex}
                        style={{
                          border: '1px solid #e5e7eb',
                          borderRadius: 8,
                          padding: 12,
                          background: '#fff',
                          display: 'grid',
                          gap: 12,
                          touchAction: 'pan-y',
                          transform: translating ? `translateX(${touchDeltaX}px)` : 'translateX(0)',
                          transition: translating ? 'none' : 'transform 160ms ease'
                        }}
                        onTouchStart={(e) => {
                          if (e.touches.length !== 1) return;
                          setTouchStartX(e.touches[0].clientX);
                          setTouchDeltaX(0);
                        }}
                        onTouchMove={(e) => {
                          if (touchStartX === null) return;
                          const cur = e.touches[0].clientX;
                          setTouchDeltaX(cur - touchStartX);
                        }}
                        onTouchEnd={() => {
                          if (touchStartX === null) return;
                          const delta = touchDeltaX;
                          setTouchStartX(null);
                          setTouchDeltaX(0);
                          if (delta > SWIPE_THRESHOLD && activeIndex > 0) {
                            setActiveIndex(i => i - 1);
                          } else if (delta < -SWIPE_THRESHOLD && activeIndex < batches.length - 1) {
                            setActiveIndex(i => i + 1);
                          }
                        }}
                        onTouchCancel={() => { setTouchStartX(null); setTouchDeltaX(0); }}
                      >
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <strong>Batch: {bucket.key}</strong>
                          <span style={{ color: '#6b7280', fontSize: 12 }}>({bucket.count} rader)</span>
                          <button
                            type="button"
                            className="btn--primary btn--sm"
                            style={{ marginLeft: 'auto' }}
                            disabled={exporting !== null}
                            onClick={() => exportBatchRaw(bucket.key)}
                          >{exporting === `batch-${bucket.key}` ? 'Export...' : 'Exportera batch CSV'}</button>
                        </div>
                        <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                          <Metric label="Medeldensitet" value={bucket.avgDensitet !== null ? bucket.avgDensitet + ' kg/m²' : '—'} />
                          <Metric label="Medel dammighet" value={bucket.avgDamm !== null ? bucket.avgDamm : '—'} />
                          <Metric label="Medel klumpighet" value={bucket.avgKlump !== null ? bucket.avgKlump : '—'} />
                          <Metric label="Fluffer använd (%)" value={bucket.count ? ((bucket.flufferTrue / bucket.count) * 100).toFixed(1) + '%' : '—'} />
                        </div>
                        <BarCharts bucket={bucket} />
                        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                          {batches.map((b, i) => (
                            <button
                              key={b.key + i}
                              type="button"
                              aria-label={`Gå till batch ${i + 1}`}
                              onClick={() => setActiveIndex(i)}
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                border: '1px solid #6b7280',
                                background: i === activeIndex ? '#6b7280' : '#fff',
                                padding: 0,
                                cursor: 'pointer'
                              }}
                            />
                          ))}
                        </div>
                        <div style={{ textAlign: 'center', fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                          Svep vänster/höger eller tryck på punkterna för att byta batch.
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )
            ) : (
              <div style={{ display: 'grid', gap: 16 }}>
                {batches.map(bucket => (
                  <div key={bucket.key} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, background: '#fff', display: 'grid', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong>Datum: {bucket.key}</strong>
                      <span style={{ color: '#6b7280', fontSize: 12 }}>({bucket.count} rader)</span>
                    </div>
                    <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                      <Metric label="Medeldensitet" value={bucket.avgDensitet !== null ? bucket.avgDensitet + ' kg/m²' : '—'} />
                      <Metric label="Medel dammighet" value={bucket.avgDamm !== null ? bucket.avgDamm : '—'} />
                      <Metric label="Medel klumpighet" value={bucket.avgKlump !== null ? bucket.avgKlump : '—'} />
                      <Metric label="Fluffer använd (%)" value={bucket.count ? ((bucket.flufferTrue / bucket.count) * 100).toFixed(1) + '%' : '—'} />
                    </div>
                    <BarCharts bucket={bucket} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={{ display: 'grid', gap: 8 }}>
            <h2 style={{ fontSize: 18, margin: '12px 0 0' }}>Detaljer (rådata)</h2>
            <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ background: '#f3f4f6' }}>
                  <tr>
                    <Th>Skapad</Th>
                    <Th>Datum</Th>
                    <Th>Batch</Th>
                    <Th>Material</Th>
                    <Th>Order</Th>
                    <Th>Etapp</Th>
                    <Th>Källa</Th>
                    <Th>Densitet</Th>
                    <Th>Dammighet</Th>
                    <Th>Klumpighet</Th>
                    <Th>Fluffer</Th>
                  </tr>
                </thead>
                <tbody>
                  {(group === 'batch' && batches.length > 0 ? filtered.filter(r => (r.batch_number || '—') === batches[activeIndex]?.key) : filtered).map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid #e5e7eb' }}>
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
                      <Td>{r.fluffer_used === true ? 'Ja' : (r.fluffer_used === false ? 'Nej' : '—')}</Td>
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

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' }}>{label}</span>
      <strong style={{ fontSize: 16 }}>{value}</strong>
    </div>
  );
}

function Th({ children }: { children: any }) {
  return <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>{children}</th>;
}
function Td({ children }: { children: any }) {
  return <td style={{ padding: '6px 8px' }}>{children}</td>;
}

// Simple inlined bar chart components (no external lib) for quick visual
function BarCharts({ bucket }: { bucket: AggBucket }) {
  const bars: Array<{ label: string; value: number | null; max: number; color: string; unit?: string }> = [
    { label: 'Densitet', value: bucket.avgDensitet, max: 60, color: '#2563eb', unit: 'kg/m²' },
    { label: 'Dammighet', value: bucket.avgDamm, max: 10, color: '#f59e0b' },
    { label: 'Klumpighet', value: bucket.avgKlump, max: 10, color: '#10b981' },
  ];
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {bars.map(b => (
        <div key={b.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span>{b.label}</span>
            <span>{b.value !== null ? b.value + (b.unit ? ` ${b.unit}` : '') : '—'}</span>
          </div>
          <div style={{ height: 10, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
            {b.value !== null && (
              <div style={{ width: `${Math.min(100, (b.value / b.max) * 100)}%`, background: b.color, height: '100%' }} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

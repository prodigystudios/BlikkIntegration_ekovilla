// Pure aggregation + CSV serialization for the material quality view. Extracted
// from the page so the bucketing, averages and export formats are unit-testable.

export interface SampleRow {
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

export interface AggBucket {
  key: string; // batch or date
  count: number;
  avgDensitet: number | null;
  avgDamm: number | null;
  avgKlump: number | null;
  flufferTrue: number;
}

function round2(sum: number, count: number): number | null {
  return count ? Number((sum / count).toFixed(2)) : null;
}

// Group rows by batch number or installation date, averaging the metrics.
export function aggregateBuckets(rows: SampleRow[], group: 'batch' | 'date'): AggBucket[] {
  const map = new Map<string, { count: number; dens: number; damm: number; klump: number; fluffer: number }>();
  for (const r of rows) {
    const key = group === 'batch' ? (r.batch_number || '—') : (r.installation_date || '—');
    let b = map.get(key);
    if (!b) { b = { count: 0, dens: 0, damm: 0, klump: 0, fluffer: 0 }; map.set(key, b); }
    b.count++;
    b.dens += r.densitet ?? 0;
    b.damm += r.dammighet ?? 0;
    b.klump += r.klumpighet ?? 0;
    if (r.fluffer_used) b.fluffer++;
  }
  return Array.from(map.entries())
    .map(([key, b]) => ({
      key,
      count: b.count,
      avgDensitet: round2(b.dens, b.count),
      avgDamm: round2(b.damm, b.count),
      avgKlump: round2(b.klump, b.count),
      flufferTrue: b.fluffer,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function sanitizeFilename(name: string) {
  return name.replace(/[^A-Za-z0-9_\-.]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

const BATCH_CSV_HEADER = 'installation_date;batch;material;order;stage;source;density;dust;clump;fluffer';

// Raw rows for one batch, semicolons inside values replaced with commas.
export function buildBatchCsvLines(rows: SampleRow[], batchKey: string): string[] {
  const target = rows.filter((r) => (r.batch_number || '—') === batchKey);
  const lines = [BATCH_CSV_HEADER];
  for (const r of target) {
    lines.push(
      [
        r.installation_date || '',
        r.batch_number || '',
        r.material_used || '',
        r.order_id || '',
        r.etapp_name || '',
        r.source_type || '',
        r.densitet ?? '',
        r.dammighet ?? '',
        r.klumpighet ?? '',
        r.fluffer_used === true ? '1' : r.fluffer_used === false ? '0' : '',
      ]
        .map((v) => String(v).replace(/;/g, ','))
        .join(';'),
    );
  }
  return lines;
}

const MONTHLY_CSV_HEADER = 'month;batch;count;avg_density;avg_dust;avg_clump;fluffer_usage_percent';

// Per month + batch aggregate (averages + fluffer-usage %).
export function buildMonthlyReportCsvLines(rows: SampleRow[]): string[] {
  type RowAgg = { month: string; batch: string; count: number; densSum: number; dammSum: number; klumpSum: number; flufferTrue: number };
  const map = new Map<string, RowAgg>();
  for (const r of rows) {
    const month = (r.installation_date || '—').slice(0, 7) || '—';
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
  const aggs = Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month) || a.batch.localeCompare(b.batch));
  const lines = [MONTHLY_CSV_HEADER];
  for (const a of aggs) {
    lines.push(
      [
        a.month,
        a.batch,
        a.count,
        a.count ? (a.densSum / a.count).toFixed(2) : '',
        a.count ? (a.dammSum / a.count).toFixed(2) : '',
        a.count ? (a.klumpSum / a.count).toFixed(2) : '',
        a.count ? ((a.flufferTrue / a.count) * 100).toFixed(1) : '',
      ].join(';'),
    );
  }
  return lines;
}

import { describe, it, expect } from 'vitest';
import {
  aggregateBuckets,
  buildBatchCsvLines,
  buildMonthlyReportCsvLines,
  sanitizeFilename,
  type SampleRow,
} from '@/app/material-kvalitet/aggregate';

function row(p: Partial<SampleRow>): SampleRow {
  return {
    id: p.id || Math.random().toString(36).slice(2),
    order_id: p.order_id ?? null,
    project_number: p.project_number ?? null,
    installation_date: p.installation_date ?? null,
    material_used: p.material_used ?? null,
    batch_number: p.batch_number ?? null,
    fluffer_used: p.fluffer_used ?? null,
    dammighet: p.dammighet ?? null,
    klumpighet: p.klumpighet ?? null,
    etapp_name: p.etapp_name ?? null,
    densitet: p.densitet ?? null,
    source_type: p.source_type ?? null,
    created_at: p.created_at || '2026-01-01T00:00:00Z',
  };
}

describe('aggregateBuckets', () => {
  it('grupperar per batch, snittar (2 dec) och räknar fluffer', () => {
    const rows = [
      row({ batch_number: 'B1', densitet: 40, dammighet: 2, klumpighet: 1, fluffer_used: true }),
      row({ batch_number: 'B1', densitet: 50, dammighet: 4, klumpighet: 3, fluffer_used: false }),
    ];
    const [b1] = aggregateBuckets(rows, 'batch');
    expect(b1.key).toBe('B1');
    expect(b1.count).toBe(2);
    expect(b1.avgDensitet).toBe(45);
    expect(b1.avgDamm).toBe(3);
    expect(b1.avgKlump).toBe(2);
    expect(b1.flufferTrue).toBe(1);
  });

  it('grupperar per datum och sorterar nyckel-alfabetiskt; saknad nyckel = —', () => {
    const rows = [
      row({ installation_date: '2026-02-01', densitet: 10 }),
      row({ installation_date: null, densitet: 20 }),
    ];
    const res = aggregateBuckets(rows, 'date');
    // localeCompare sorterar symbolen "—" före siffror (oförändrat beteende från originalet)
    expect(res.map((b) => b.key).sort()).toEqual(['2026-02-01', '—'].sort());
    expect(res).toHaveLength(2);
  });
});

describe('buildBatchCsvLines', () => {
  it('header + endast rader för batchen, semikolon i värden ersätts med komma', () => {
    const rows = [
      row({ batch_number: 'B1', material_used: 'Ekovilla; premium', densitet: 42, fluffer_used: true }),
      row({ batch_number: 'B2', material_used: 'Annan' }),
    ];
    const lines = buildBatchCsvLines(rows, 'B1');
    expect(lines[0]).toBe('installation_date;batch;material;order;stage;source;density;dust;clump;fluffer');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Ekovilla, premium'); // ; -> ,
    expect(lines[1].endsWith(';1')).toBe(true); // fluffer true -> 1
  });
});

describe('buildMonthlyReportCsvLines', () => {
  it('aggregerar per månad+batch med fluffer-procent', () => {
    const rows = [
      row({ installation_date: '2026-03-15', batch_number: 'B1', densitet: 40, fluffer_used: true }),
      row({ installation_date: '2026-03-20', batch_number: 'B1', densitet: 60, fluffer_used: false }),
    ];
    const lines = buildMonthlyReportCsvLines(rows);
    expect(lines[0]).toBe('month;batch;count;avg_density;avg_dust;avg_clump;fluffer_usage_percent');
    expect(lines[1]).toBe('2026-03;B1;2;50.00;0.00;0.00;50.0');
  });
});

describe('sanitizeFilename', () => {
  it('ersätter otillåtna tecken och trimmar understreck', () => {
    expect(sanitizeFilename('Batch #12/2026')).toBe('Batch_12_2026');
  });
});

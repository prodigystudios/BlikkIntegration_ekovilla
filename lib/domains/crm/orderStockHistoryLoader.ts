import type { SupabaseClient } from '@supabase/supabase-js';
import { readEveryRow, type ReportRange } from './reports';
import type { StockStageKey } from './reportRevenue';
import type { ReconstructOrderRow, StockSnapshot } from './orderStockHistory';
import { addDaysISO, stockholmDayStartISO } from '@/lib/domains/planning/timezone';

// Läsningar och skrivning för orderstocken över tid (orderStockHistory.ts). Tabellen nås bara av servern
// (service-rollen; RLS utan policyer) — se migreringen 20261009171044_crm_order_stock_snapshots.

/** Skriver om dagens rad. Kastar vid fel — jobbet ska synas som misslyckat, inte tyst lämna gårdagens läge. */
export async function upsertStockSnapshot(admin: SupabaseClient, snapshot: StockSnapshot, takenAt: Date = new Date()): Promise<void> {
  const { error } = await admin.from('crm_order_stock_snapshots').upsert(
    {
      day: snapshot.day,
      stages: snapshot.stages,
      total_count: snapshot.totalCount,
      total_value: snapshot.totalValue,
      taken_at: takenAt.toISOString(),
    },
    { onConflict: 'day' },
  );
  if (error) throw new Error(`orderstockens ögonblicksbild: ${error.message}`);
}

type SnapshotRow = {
  day: string;
  stages: Array<{ key: StockStageKey; count: number | string; value: number | string }> | null;
  total_count: number | string;
  total_value: number | string;
};

/** Ögonblicksbilderna för dagarna i perioden. numeric kommer som sträng från PostgREST. */
export async function fetchStockSnapshots(admin: SupabaseClient, range: ReportRange): Promise<StockSnapshot[]> {
  const rows: SnapshotRow[] = await readEveryRow('crm_order_stock_snapshots', (from, to) =>
    admin.from('crm_order_stock_snapshots')
      .select('day, stages, total_count, total_value')
      .gte('day', range.from)
      .lte('day', range.to)
      .order('day', { ascending: true })
      .range(from, to),
  );
  return rows.map((row) => ({
    day: String(row.day).slice(0, 10),
    stages: (row.stages ?? []).map((stage) => ({ key: stage.key, count: Number(stage.count), value: Number(stage.value) })),
    totalCount: Number(row.total_count),
    totalValue: Number(row.total_value),
  }));
}

/** Den första ögonblicksbildens dag någonsin, eller null när jobbet aldrig skrivit något. */
export async function fetchFirstSnapshotDay(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin.from('crm_order_stock_snapshots').select('day').order('day', { ascending: true }).limit(1);
  if (error) throw new Error(`första ögonblicksbilden: ${error.message}`);
  return data?.[0]?.day ? String(data[0].day).slice(0, 10) : null;
}

/**
 * Orderna efterhandsräkningen behöver för dagarna i `window`: skapade senast sista dagen, inte avbrutna, och inte
 * slutfakturerade före första dagen — med rundornas datum. Gränserna är svensk midnatt (stockholmDayStartISO).
 */
export function fetchReconstructOrders(admin: SupabaseClient, window: ReportRange): Promise<ReconstructOrderRow[]> {
  const createdBefore = stockholmDayStartISO(addDaysISO(window.to, 1));
  const invoicedFrom = stockholmDayStartISO(window.from);
  return readEveryRow('orderstock bakåt', (from, to) =>
    admin.from('crm_work_orders')
      .select('id, status, amount, vat_percent, pricing_summary, created_at, fortnox_invoiced_at, invoice_rounds:crm_work_order_invoices(amount, created_at)')
      .neq('status', 'cancelled')
      .lt('created_at', createdBefore)
      .or(`fortnox_invoiced_at.is.null,fortnox_invoiced_at.gte.${invoicedFrom}`)
      .order('id', { ascending: true })
      .range(from, to),
  );
}

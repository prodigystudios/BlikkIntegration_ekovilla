import { invoicedAt, uninvoicedAmount } from './invoicedRevenue';
import { isDeadWorkOrder } from './work-orders';
import { buildStockByStage, type StockStage } from './reportRevenue';
import { buildOrderStock } from './reportKpis';
import type { OrderStockRow } from './overviewSummary';
import type { NetAmountRow } from './pricing';
import type { ReportRange } from './reports';
import { addDaysISO, stockholmDayOf } from '@/lib/domains/planning/timezone';

// Orderstocken över tid — ägarnas veckorapport visar den per vecka (William 2026-10-09).
//
// Orderstocken är ett LÄGE, inte en händelse: en order sparar bara sin nuvarande status. Därför två källor:
//   · Ögonblicksbilden (crm_order_stock_snapshots), skriven varje timme av ett schemalagt jobb. Exakt, per läge.
//   · Före den första ögonblicksbilden räknas TOTALEN fram i efterhand ur det som finns sparat: order skapade
//     till och med dagen, minus det som var slutfakturerat då, med delfakturarundorna dragna på sina datum.
//     Per läge går inte — när ordern blev planerad eller pågående sparas inte. Avbrutna order räknas inte alls,
//     eftersom vi inte vet när de avbröts; en vecka där en senare avbruten order fortfarande låg i stocken blir
//     därför något för låg. Tabellen märker de veckorna "beräknad i efterhand".

/**
 * Första dagen orderstocken räknas fram i efterhand. William 2026-10-09: "vi började använda systemet ca
 * 10 augusti" — veckorna innan har för lite i CRM:et för att säga något om stocken.
 */
export const RECONSTRUCT_FROM = '2026-08-10';

export type StockSnapshot = { day: string; stages: StockStage[]; totalCount: number; totalValue: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Dagens orderstock som en ögonblicksbild: samma lägen och belopp som rapportens "Orderstock efter läge"
 * (buildStockByStage) och samma total som Översiktens orderstock (buildOrderStock).
 */
export function buildStockSnapshot(rows: OrderStockRow[], day: string): StockSnapshot {
  const stages = buildStockByStage(rows).map((stage) => ({ ...stage, value: round2(stage.value) }));
  const stock = buildOrderStock(rows, null);
  return { day, stages, totalCount: stock.count, totalValue: round2(stock.value) };
}

/** En order som efterhandsräkningen läser den: med rundornas datum, inte bara beloppen. */
export type ReconstructOrderRow = NetAmountRow & {
  status: string | null;
  created_at: string;
  fortnox_invoiced_at: string | null;
  invoice_rounds: Array<{ amount: number | string | null; created_at: string }> | null;
};

/**
 * Orderstockens total vid slutet av den svenska dagen `day`, räknad i efterhand.
 *
 * En order låg i stocken om den var skapad senast den dagen och inte slutfakturerad då (status Fakturerad med
 * fakturadatum senast dagen). Värdet är det som återstod att fakturera: nettot minus rundorna som gått ut senast
 * dagen — samma uninvoicedAmount som dagens orderstock. Räknad för idag ger den alltså exakt dagens total.
 */
export function reconstructStock(orders: ReconstructOrderRow[], day: string): { count: number; value: number } {
  let count = 0;
  let value = 0;
  for (const order of orders) {
    if (isDeadWorkOrder(order.status)) continue;
    const created = stockholmDayOf(order.created_at);
    if (created == null || created > day) continue;
    if (order.status === 'invoiced') {
      const invoiced = stockholmDayOf(invoicedAt(order));
      if (invoiced != null && invoiced <= day) continue;
    }
    const rounds = (order.invoice_rounds ?? []).filter((round) => {
      const at = stockholmDayOf(round.created_at);
      return at != null && at <= day;
    });
    count += 1;
    value += uninvoicedAmount({ ...order, invoice_rounds: rounds });
  }
  return { count, value: round2(value) };
}

export type WeekStock =
  | { kind: 'now' | 'snapshot'; day: string; count: number; value: number; stages: StockStage[] }
  | { kind: 'reconstructed'; day: string; count: number; value: number; stages: null };

/**
 * Orderstocken vid varje veckas slut.
 *
 *   · Den pågående veckan: läget just nu (`now`).
 *   · En vecka med ögonblicksbilder: veckans SENASTE bild — normalt söndagens.
 *   · En vecka före den första bilden, från RECONSTRUCT_FROM: totalen räknad i efterhand vid veckans sista dag.
 *   · Annars null: före RECONSTRUCT_FROM, eller en vecka efter starten där jobbet inte skrev något alls. En lucka
 *     fylls inte med en efterhandsräkning — då hade en ungefärlig siffra stått mitt bland exakta utan att synas.
 */
export function stockByWeek(input: {
  weeks: ReportRange[];
  today: string;
  snapshots: StockSnapshot[];
  /** Den första bildens dag någonsin — kan ligga före perioden. Utelämnad = den första bland `snapshots`. */
  firstSnapshotDay?: string | null;
  now: StockSnapshot | null;
  /** null = inte läst (behövdes inte) eller kunde inte läsas. */
  reconstructOrders: ReconstructOrderRow[] | null;
  reconstructFrom?: string;
}): Array<WeekStock | null> {
  const from = input.reconstructFrom ?? RECONSTRUCT_FROM;
  const sorted = [...input.snapshots].sort((a, b) => a.day.localeCompare(b.day));
  const firstSnapshot = input.firstSnapshotDay !== undefined ? input.firstSnapshotDay : sorted[0]?.day ?? null;
  return input.weeks.map((week) => {
    if (week.to >= input.today) {
      return input.now ? { kind: 'now', day: input.today, count: input.now.totalCount, value: input.now.totalValue, stages: input.now.stages } : null;
    }
    const inWeek = sorted.filter((snapshot) => snapshot.day >= week.from && snapshot.day <= week.to).at(-1);
    if (inWeek) return { kind: 'snapshot', day: inWeek.day, count: inWeek.totalCount, value: inWeek.totalValue, stages: inWeek.stages };
    const beforeFirst = firstSnapshot == null || week.to < firstSnapshot;
    if (beforeFirst && week.to >= from && input.reconstructOrders) {
      const total = reconstructStock(input.reconstructOrders, week.to);
      return { kind: 'reconstructed', day: week.to, count: total.count, value: total.value, stages: null };
    }
    return null;
  });
}

/**
 * Dagarna efterhandsräkningen behöver läsa order för: från RECONSTRUCT_FROM (eller periodens start) till dagen
 * före den första ögonblicksbilden (eller igår). null = inget att räkna fram — då läses inga order alls.
 */
export function reconstructWindow(input: { range: ReportRange; today: string; firstSnapshot: string | null; reconstructFrom?: string }): ReportRange | null {
  const from = [input.range.from, input.reconstructFrom ?? RECONSTRUCT_FROM].sort().at(-1)!;
  // Dagen före den första bilden — eller igår, när jobbet ännu inte skrivit något (idag är "nu", inte efterhand).
  const beforeFirst = addDaysISO(input.firstSnapshot ?? input.today, -1);
  const to = [beforeFirst, input.range.to].sort()[0];
  return from <= to ? { from, to } : null;
}

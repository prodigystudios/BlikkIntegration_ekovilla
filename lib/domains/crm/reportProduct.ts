import { lineItemQuantity } from './lineItems';
import { lineItemRowTotal, type PricingLineItem } from './pricing';
import { inferMaterialFromArticle } from './materials';
import { CONSTRUCTION_SLUGS, isConstructionSlug, type ConstructionSlug } from './constructions';
import { uninvoicedAmount, type InvoicedRevenue, type OrderWithRounds } from './invoicedRevenue';
import { ORDER_STOCK_STATUSES } from './overviewSummary';
import { isDeadWorkOrder, type CrmWorkOrderStatus } from './work-orders';
import { monthsInRange, partitionOrders, type ReportOrderRow, type ReportRange } from './reports';
import { monthSpan, monthTouches } from './reportKpis';
import { workingDaysInRange } from '@/lib/domains/planning/production';

// Produkt & marknad (spec 2026-10-07, 4.5): "Vad säljer vi, och var?"
//
// Ren modul — inga anrop, ingen klocka. Rutten skickar in raderna den redan läst (periodens order och
// fakturor, trendens order, orderstocken) och det reportProductLoader.ts läst: orderraderna per order,
// orderns segment på schemat och depåerna.
//
// ⚠️ SÅLT, INTE BLÅST. m³ räknas på orderns rader — det kunden köpt — på order SKAPADE i perioden. Det
// som faktiskt blåstes står under Produktion (säckarna), och de två talen ska inte stämma: en order
// skapad i september blåses ofta i oktober.
//
// ⚠️ RADTOTALEN ÄR HELA RADENS PRIS, NETTO. lineItemRowTotal = antal × à-pris efter rabatt, och à-priset
// är alltid exklusive moms (computePricing lägger momsen ovanpå summan av radtotalerna). ROT ändrar den
// inte: "Varav arbetskostnad" är en UTBRYTNING ur radens pris (splitRowLabor), inget avdrag — och
// ROT-avdraget dras från kundens att betala, inte från radens pris. Kontrollerat 2026-10-07; testet i
// tests/crm/reportProduct.test.ts håller fast det.

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// ── Orderraderna: sålda m³ ───────────────────────────────────────────────────

/** En orderrad som rapporten läser den ur `line_items` (JSONB — fälten är strängar, i gamla rader ibland tal). */
export type ProductLineItem = PricingLineItem & {
  article_name?: string | null;
  construction?: string | null;
};

/** En såld m³-rad, reducerad till det fliken räknar på. */
export type VolumeLine = {
  m3: number;
  /** Radens pris, netto (lineItemRowTotal). */
  value: number;
  /** null = raden saknar konstruktion, eller bär ett värde som inte är någon av de fem. */
  construction: ConstructionSlug | null;
  /** Materialets kortnamn (EKOVILLA, KNAUF SUPAFIL …). null = artikeln känns inte igen. */
  material: string | null;
};

/**
 * Orderns m³-rader. En m³-rad är en rad vars pricing_mode inte är 'item' — SAMMA regel som
 * lineItemQuantity, så att raden och dess volym aldrig kan klassas olika. Rader utan volym (en tom rad
 * står som m³ från start) räknas inte: de har varken m³ eller pris, men hade blivit en order i antalet.
 */
export function volumeLines(lineItems: unknown): VolumeLine[] {
  if (!Array.isArray(lineItems)) return [];
  return lineItems.flatMap((raw): VolumeLine[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as ProductLineItem;
    if ((item.pricing_mode ?? 'm3') === 'item') return [];
    const m3 = lineItemQuantity(item);
    if (!(m3 > 0)) return [];
    // typeof först: JSONB kan bära vad som helst, och isConstructionSlug trimmar en sträng.
    const slug = typeof item.construction === 'string' && isConstructionSlug(item.construction)
      ? (item.construction.trim().toLowerCase() as ConstructionSlug)
      : null;
    return [{
      m3,
      value: lineItemRowTotal(item),
      construction: slug,
      material: inferMaterialFromArticle(typeof item.article_name === 'string' ? item.article_name : null)?.short ?? null,
    }];
  });
}

type OrderLine = { orderId: string; line: VolumeLine };

/**
 * m³-raderna för en lista order. Avbrutna order räknas inte — filtreras här också, inte bara i
 * partitionOrders, så att funktionen ger samma svar vilken lista som än matar den. En order utan id
 * eller utan rader i läsningen bidrar inte.
 */
function orderLines(orders: ReportOrderRow[], lineItems: Map<string, unknown>): OrderLine[] {
  return orders.flatMap((order) => {
    const id = order.id;
    if (!id || isDeadWorkOrder(order.status)) return [];
    return volumeLines(lineItems.get(id)).map((line) => ({ orderId: id, line }));
  });
}

export type VolumeStat = {
  m3: number;
  /** Netto. */
  value: number;
  /** value ÷ m3. null utan m³ — en kvot mot noll är inget pris. */
  pricePerM3: number | null;
  /** Order med minst en m³-rad i gruppen. */
  orders: number;
};

function volumeStat(lines: OrderLine[]): VolumeStat {
  const m3 = sum(lines.map(({ line }) => line.m3));
  const value = sum(lines.map(({ line }) => line.value));
  return {
    m3,
    value,
    // ⚠️ SUMMAN DELAD MED SUMMAN, aldrig ett snitt av radernas kr/m³: en rad på 2 m³ hade annars vägt
    // lika tungt som en på 200.
    pricePerM3: m3 > 0 ? value / m3 : null,
    orders: new Set(lines.map(({ orderId }) => orderId)).size,
  };
}

export type ConstructionVolume = VolumeStat & { construction: ConstructionSlug | null };

/**
 * Per konstruktion, störst volym först. Rader utan konstruktion ("Saknas") står alltid sist, och
 * konstruktioner utan volym står inte med. Vid lika volym gäller vokabulärens ordning (CONSTRUCTION_SLUGS).
 */
function byConstruction(lines: OrderLine[]): ConstructionVolume[] {
  const known = CONSTRUCTION_SLUGS
    .map((construction) => ({ construction, ...volumeStat(lines.filter(({ line }) => line.construction === construction)) }))
    .filter((row) => row.m3 > 0)
    .sort((a, b) => b.m3 - a.m3);
  const missing = { construction: null, ...volumeStat(lines.filter(({ line }) => line.construction == null)) };
  return missing.m3 > 0 ? [...known, missing] : known;
}

export type MaterialVolume = VolumeStat & {
  /** Kortnamnet. null = "Övrigt/okänt". */
  material: string | null;
  /** Andel av periodens m³, i procent. null utan m³. */
  share: number | null;
};

/** Per material, störst volym först. Okända material ("Övrigt/okänt") står alltid sist. */
function byMaterial(lines: OrderLine[], totalM3: number): MaterialVolume[] {
  const materials = [...new Set(lines.map(({ line }) => line.material).filter((m): m is string => m != null))];
  const row = (material: string | null): MaterialVolume => {
    const stat = volumeStat(lines.filter(({ line }) => line.material === material));
    return { material, ...stat, share: totalM3 > 0 ? (stat.m3 / totalM3) * 100 : null };
  };
  const known = materials.map(row).sort((a, b) => b.m3 - a.m3 || String(a.material).localeCompare(String(b.material), 'sv'));
  const unknown = row(null);
  return unknown.m3 > 0 ? [...known, unknown] : known;
}

export type ProductVolume = {
  total: VolumeStat;
  byConstruction: ConstructionVolume[];
  byMaterial: MaterialVolume[];
};

/** Sålda m³ och kr/m³ på order skapade i perioden (partitionOrders().created), totalt, per konstruktion och per material. */
export function buildProductVolume(ordersCreated: ReportOrderRow[], lineItems: Map<string, unknown>): ProductVolume {
  const lines = orderLines(ordersCreated, lineItems);
  const total = volumeStat(lines);
  return { total, byConstruction: byConstruction(lines), byMaterial: byMaterial(lines, total.m3) };
}

export type VolumeMonth = {
  /** 'YYYY-MM' — månaden ordern skapades. */
  period: string;
  m3: number;
  value: number;
  pricePerM3: number | null;
  /** Dagarna som räknas när månaden inte är hel. null = hel månad. */
  partial: ReportRange | null;
  inPeriod: boolean;
};

/**
 * Sålda m³ per månad, i trendens fönster.
 *
 * ⚠️ FÖLJER INTE PERIODEN, som de tre andra månadsdiagrammen (Williams beslut 2026-10-07 för trenden,
 * hit rate och fakturerat per månad — annars blir "Denna månad" en enda stapel). Den valda perioden
 * markeras. Order partitioneras som i trenden: skapade i fönstret, avbrutna bort.
 */
export function buildVolumeByMonth(input: {
  orders: ReportOrderRow[];
  lineItems: Map<string, unknown>;
  window: ReportRange;
  selected: ReportRange;
}): VolumeMonth[] {
  const created = partitionOrders(input.orders, input.window, []).created;
  return monthsInRange(input.window.from, input.window.to).map((period) => {
    const stat = volumeStat(orderLines(created.filter((order) => String(order.created_at).slice(0, 7) === period), input.lineItems));
    return {
      period,
      m3: stat.m3,
      value: stat.value,
      pricePerM3: stat.pricePerM3,
      partial: monthSpan(period, input.window).partial,
      inPeriod: monthTouches(period, input.selected),
    };
  });
}

/**
 * Orderna vars rader behövs: periodens skapade order och trendens. Samma partitionering som räkningen,
 * så att läsningen och räkningen aldrig kan tala om olika order.
 */
export function volumeOrderIds(input: { ordersCreated: ReportOrderRow[]; trend: { orders: ReportOrderRow[]; window: ReportRange } | null }): string[] {
  const trendCreated = input.trend ? partitionOrders(input.trend.orders, input.trend.window, []).created : [];
  return [...new Set([...input.ordersCreated, ...trendCreated].map((order) => order.id).filter((id): id is string => Boolean(id)))];
}

// ── Depåerna ─────────────────────────────────────────────────────────────────

/** Ett segment på schemat, med bilens depå inbäddad. */
export type ProductSegmentRow = {
  /** null = platshållare, som inte är någon order och ignoreras. */
  work_order_id: string | null;
  start_day: string;
  end_day: string;
  /** Som lista när klienten inte vet att relationen är många-till-en. null = bilen syns inte. */
  truck: { depot_id: string | null } | Array<{ depot_id: string | null }> | null;
};

export type ProductDepotRow = { id: string; name: string; active: boolean };

/** Orderns depå. `depotId` null = "Bil utan depå". En order som saknas i kartan är "Ej planerad". */
export type OrderDepot = { depotId: string | null };

/**
 * Varje planerad orders depå: order → segment → bil → depå.
 *
 * En order på flera depåer räknas till den med FLEST SEGMENTDAGAR — arbetsdagar, som planeringen räknar
 * bokade dagar (workingDaysInRange: helger och röda dagar räknas inte). Vid lika avgör, i tur och ordning:
 * den depå orderns första segment började på, sedan en riktig depå före "Bil utan depå", sedan depåns id
 * — en stabil ordning, så samma schema ger alltid samma svar.
 */
export function orderDepots(segments: ProductSegmentRow[]): Map<string, OrderDepot> {
  type Candidate = { depotId: string | null; days: number; firstStart: string };
  const byOrder = new Map<string, Map<string, Candidate>>();
  for (const segment of segments) {
    if (!segment.work_order_id) continue;
    const truck = Array.isArray(segment.truck) ? segment.truck[0] : segment.truck;
    const depotId = truck?.depot_id ?? null;
    const candidates = byOrder.get(segment.work_order_id) ?? new Map<string, Candidate>();
    byOrder.set(segment.work_order_id, candidates);
    const key = depotId ?? '';
    const candidate = candidates.get(key) ?? { depotId, days: 0, firstStart: segment.start_day };
    candidate.days += workingDaysInRange({ from: segment.start_day, to: segment.end_day }).length;
    if (segment.start_day < candidate.firstStart) candidate.firstStart = segment.start_day;
    candidates.set(key, candidate);
  }

  const result = new Map<string, OrderDepot>();
  for (const [orderId, candidates] of byOrder) {
    const [winner] = [...candidates.values()].sort((a, b) =>
      b.days - a.days
      || a.firstStart.localeCompare(b.firstStart)
      || Number(a.depotId == null) - Number(b.depotId == null)
      || String(a.depotId).localeCompare(String(b.depotId)));
    result.set(orderId, { depotId: winner.depotId });
  }
  return result;
}

export type DepotKind = 'depot' | 'no_depot' | 'unplanned';

export type DepotRow = {
  kind: DepotKind;
  /** Depåns id och namn när kind är 'depot'. Namnet null = depån finns inte bland de lästa (borttagen). */
  depotId: string | null;
  name: string | null;
  /** Fakturerat i perioden, netto — per faktura, som Fakturerat. */
  invoiced: number;
  /** Order bakom periodens fakturor. */
  invoicedOrders: number;
  /** Det som återstår att fakturera, just nu. ⚠️ null = KUNDE INTE RÄKNAS (orderstockens läsning felade). */
  stock: number | null;
  stockOrders: number | null;
};

/** En orderstocksrad med orderns id — utan id går ordern inte att slå upp på schemat och är "Ej planerad". */
export type ProductStockRow = OrderWithRounds & { id?: string | null; status: string };

/**
 * Fakturerat (period) och orderstock (nu) per depå.
 *
 * ⚠️ FAKTURERAT OCH ORDERSTOCK, INTE ORDERVÄRDE (spec 2026-10-07): nya order är oftast inte planerade
 * än — 49 order för 1,93 Mkr i orderstocken saknade planering — så ordervärdet hade hamnat under "Ej
 * planerad" i stället för i en depå.
 *
 * Summan av raderna är periodens Fakturerat respektive Översiktens orderstock. Alla aktiva depåer står
 * med, också utan något i perioden; en inaktiv depå, "Bil utan depå" och "Ej planerad" bara när de har
 * något. Depåerna står efter fakturerat, sedan orderstock, sedan namn — "Bil utan depå" och "Ej
 * planerad" sist.
 */
export function buildDepotSplit(input: {
  revenue: InvoicedRevenue[];
  /** null = orderstockens läsning felade; då blir varje rads orderstock null. */
  stockRows: ProductStockRow[] | null;
  segments: ProductSegmentRow[];
  depots: ProductDepotRow[];
}): DepotRow[] {
  const depotOf = orderDepots(input.segments);
  const names = new Map(input.depots.map((depot) => [depot.id, depot.name]));
  const stockAvailable = input.stockRows != null;
  const rows = new Map<string, DepotRow & { invoicedIds: Set<string>; stockIds: Set<string> }>();

  const rowFor = (orderId: string | null | undefined) => {
    const depot = orderId ? depotOf.get(orderId) : undefined;
    const kind: DepotKind = !depot ? 'unplanned' : depot.depotId ? 'depot' : 'no_depot';
    const key = kind === 'depot' ? `depot:${depot!.depotId}` : kind;
    let row = rows.get(key);
    if (!row) {
      const depotId = kind === 'depot' ? depot!.depotId : null;
      row = {
        kind,
        depotId,
        name: depotId ? names.get(depotId) ?? null : null,
        invoiced: 0,
        invoicedOrders: 0,
        stock: stockAvailable ? 0 : null,
        stockOrders: stockAvailable ? 0 : null,
        invoicedIds: new Set(),
        stockIds: new Set(),
      };
      rows.set(key, row);
    }
    return row;
  };

  // De aktiva depåerna står med också utan något i perioden.
  const activeIds = new Set(input.depots.filter((depot) => depot.active).map((depot) => depot.id));
  for (const depotId of activeIds) {
    rows.set(`depot:${depotId}`, {
      kind: 'depot', depotId, name: names.get(depotId) ?? null, invoiced: 0, invoicedOrders: 0,
      stock: stockAvailable ? 0 : null, stockOrders: stockAvailable ? 0 : null, invoicedIds: new Set(), stockIds: new Set(),
    });
  }

  input.revenue.forEach((invoice, index) => {
    const row = rowFor(invoice.work_order_id);
    row.invoiced += invoice.amount;
    // En faktura utan order-id är en egen order i antalet.
    row.invoicedIds.add(invoice.work_order_id ?? `faktura:${index}`);
  });

  for (const [index, stockRow] of (input.stockRows ?? []).entries()) {
    if (!ORDER_STOCK_STATUSES.includes(stockRow.status as CrmWorkOrderStatus)) continue;
    const row = rowFor(stockRow.id);
    row.stock = (row.stock ?? 0) + uninvoicedAmount(stockRow);
    row.stockIds.add(stockRow.id ?? `order:${index}`);
  }

  const kindRank: Record<DepotKind, number> = { depot: 0, no_depot: 1, unplanned: 2 };
  return [...rows.values()]
    .map(({ invoicedIds, stockIds, ...row }) => ({
      ...row,
      invoicedOrders: invoicedIds.size,
      stockOrders: stockAvailable ? stockIds.size : null,
    }))
    .filter((row) => (row.depotId != null && activeIds.has(row.depotId)) || row.invoicedOrders > 0 || (row.stockOrders ?? 0) > 0)
    .sort((a, b) =>
      kindRank[a.kind] - kindRank[b.kind]
      || b.invoiced - a.invoiced
      || (b.stock ?? 0) - (a.stock ?? 0)
      || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'sv'));
}

/**
 * Orderna vars schema behövs: de bakom periodens fakturor och de i orderstocken. Samma källor som
 * buildDepotSplit räknar på.
 */
export function scheduleOrderIds(input: { revenue: InvoicedRevenue[]; stockRows: ProductStockRow[] | null }): string[] {
  const ids = [
    ...input.revenue.map((invoice) => invoice.work_order_id),
    ...(input.stockRows ?? []).map((row) => row.id),
  ];
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

// ── Produkt & marknad-fliken ─────────────────────────────────────────────────

export type ReportProduct = {
  /** Periodens sålda m³. ⚠️ null = KUNDE INTE RÄKNAS (orderradernas läsning felade), aldrig "inget sålt". */
  volume: ProductVolume | null;
  /** Trendens fönster. ⚠️ null = kunde inte räknas (trendens eller orderradernas läsning felade). */
  volumeByMonth: VolumeMonth[] | null;
  /** ⚠️ null = kunde inte räknas (schemat eller depåerna gick inte att läsa). */
  depots: DepotRow[] | null;
};

export function buildReportProduct(input: {
  /** Periodens skapade order — partitionOrders(...).created. */
  ordersCreated: ReportOrderRow[];
  range: ReportRange;
  /** Orderraderna per order-id, för periodens och trendens order. null = läsningen felade. */
  lineItems: Map<string, unknown> | null;
  /** Trendens order och fönster. null = trendens läsning felade. */
  trend: { orders: ReportOrderRow[]; window: ReportRange } | null;
  /** Periodens fakturor — partitionOrders(...).revenue. */
  revenue: InvoicedRevenue[];
  /** Orderstockens rader. null = läsningen felade. */
  stockRows: ProductStockRow[] | null;
  /** Segmenten för orderna bakom fakturorna och orderstocken, och depåerna. null = läsningen felade. */
  schedule: { segments: ProductSegmentRow[]; depots: ProductDepotRow[] } | null;
}): ReportProduct {
  return {
    volume: input.lineItems ? buildProductVolume(input.ordersCreated, input.lineItems) : null,
    volumeByMonth: input.lineItems && input.trend
      ? buildVolumeByMonth({ orders: input.trend.orders, lineItems: input.lineItems, window: input.trend.window, selected: input.range })
      : null,
    depots: input.schedule
      ? buildDepotSplit({ revenue: input.revenue, stockRows: input.stockRows, segments: input.schedule.segments, depots: input.schedule.depots })
      : null,
  };
}

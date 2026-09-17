import { sacksPerPalletFor } from '@/lib/domains/crm/materials';
import { addDaysISO } from './timezone';
import { defaultSupplierForMaterial, type MaterialSupplier } from './materialSuppliers';
import type { DepotMaterialForecast } from './depotForecast';
import type { OpsDepot } from './types';
import { classifySendError, type OrderDeliveryState, type OrderLine, type OrderLineInput, type OtherLine, type OtherLineInput } from './materialOrders';

// Beställningspanelens regler (Administrera → Beställningar): vad som föreslås, vilket datum, hur säckfältet
// stegar, och i vilket läge en order står. Ren, utan React och utan databas — panelen ritar, reglerna testas här.
//
// ⚠️ SERVERN ÄR DOMAREN. Allt här är förslag och förhandsbesked: Granska bygger raderna på nytt ur registret
// (buildOrderLines), och Skicka prövar varningarna och utskickets fönster i databasen. Panelen får aldrig lova
// något servern inte håller — därför bara förslag, aldrig ett "det här går igenom".

export const RESOLVE_AFTER_MS = 23 * 3_600_000;
export const RETRY_WAIT_MS = 120_000;

/** Varför en rad står som den står. Förklaras i panelen när säckarna är 0. */
export type ComposerRowReason =
  /** Förifylld med prognosens förslag. */
  | 'suggested'
  /** Ett lass är redan inbokat för paret — 0, så att samma lass inte beställs två gånger av vana. */
  | 'on_order'
  /** Ett inbokat lass är försenat — ring fabriken hellre än att beställa igen. */
  | 'overdue'
  /** Flera aktiva leverantörer för materialet — systemet väljer inte fabrik åt någon. */
  | 'shared_material'
  /** Lagd till för hand, eller läst ur ett sparat utkast. */
  | 'manual';

export type ComposerForecast = Pick<
  DepotMaterialForecast,
  'opening' | 'run_out_day' | 'worst_deficit' | 'suggested_sacks' | 'on_order' | 'next_arrival' | 'overdue_inflow'
>;

export type ComposerRow = {
  material: string;
  /** Fältets text. Tomt och "0" betyder att raden inte beställs. */
  sacks: string;
  sacks_per_pallet: number | null;
  /** Prognosen för paret, eller null när den saknas (inget behov, eller prognosen kunde inte räknas). */
  forecast: ComposerForecast | null;
  reason: ComposerRowReason;
};

export type ComposerDepot = {
  depot_id: string;
  depot_name: string;
  /** Plats ur depåregistret. null/tom = beställningen vägras tills den är ifylld. */
  location: string | null;
  /** 'YYYY-MM-DD' — ett datum per depå (mailet har en rubrik per depå). */
  requested_on: string;
  rows: ComposerRow[];
};

function forecastOf(r: DepotMaterialForecast | undefined): ComposerForecast | null {
  if (!r) return null;
  return {
    opening: r.opening,
    run_out_day: r.run_out_day,
    worst_deficit: r.worst_deficit,
    suggested_sacks: r.suggested_sacks,
    on_order: r.on_order,
    next_arrival: r.next_arrival,
    overdue_inflow: r.overdue_inflow,
  };
}

function findForecast(rows: DepotMaterialForecast[], depotId: string, material: string) {
  return rows.find((r) => r.depot_id === depotId && r.material === material);
}

/**
 * Förslaget på leveransdatum för en depå: dagen före depåns tidigaste run-out, men aldrig tidigare än idag +
 * leverantörens ledtid (planens beslut). Utan run-out: så tidigt ledtiden medger.
 *
 * ⚠️ Kan landa EFTER run-out — när ledtiden inte hinner. Det är sant, och varningen "kommer efter att depån tar
 * slut" säger det vid granskningen; ett datum fabriken inte kan hålla hade bara flyttat problemet.
 */
export function suggestRequestedOn(runOutDays: (string | null)[], leadTimeDays: number, today: string): string {
  const earliest = addDaysISO(today, Math.max(0, leadTimeDays));
  const runOuts = runOutDays.filter((d): d is string => !!d).sort();
  if (runOuts.length === 0) return earliest;
  const dayBefore = addDaysISO(runOuts[0], -1);
  return dayBefore > earliest ? dayBefore : earliest;
}

/**
 * Förslaget för en leverantör: behoven i prognosen som fabriken levererar, i aktiva depåer, grupperade per depå
 * med den mest brådskande först.
 *
 * Förifyller BARA när paret saknar både inbokat och försenat inflöde OCH fabriken är ensam aktiv leverantör av
 * materialet. Annars 0 med skälet — ett förifyllt tal läses som ett svar, och de fallen kräver ett beslut.
 */
export function composerSuggestion(input: {
  supplier: MaterialSupplier;
  suppliers: MaterialSupplier[];
  forecastRows: DepotMaterialForecast[];
  depots: OpsDepot[];
  today: string;
}): ComposerDepot[] {
  const activeDepots = new Map(input.depots.filter((d) => d.active).map((d) => [d.id, d]));
  const needed = input.forecastRows
    .filter((r) => r.worst_deficit > 0 && input.supplier.materials.includes(r.material) && activeDepots.has(r.depot_id))
    .sort((a, b) => (a.run_out_day ?? '9999-12-31').localeCompare(b.run_out_day ?? '9999-12-31') || b.worst_deficit - a.worst_deficit);

  const groups: ComposerDepot[] = [];
  const byDepot = new Map<string, { group: ComposerDepot; runOuts: (string | null)[] }>();
  for (const r of needed) {
    let entry = byDepot.get(r.depot_id);
    if (!entry) {
      const depot = activeDepots.get(r.depot_id)!;
      entry = { group: { depot_id: depot.id, depot_name: depot.name, location: depot.location, requested_on: '', rows: [] }, runOuts: [] };
      byDepot.set(r.depot_id, entry);
      groups.push(entry.group);
    }
    const reason: ComposerRowReason =
      defaultSupplierForMaterial(input.suppliers, r.material)?.id !== input.supplier.id
        ? 'shared_material'
        : r.overdue_inflow > 0
          ? 'overdue'
          : r.on_order > 0
            ? 'on_order'
            : 'suggested';
    entry.group.rows.push({
      material: r.material,
      sacks: reason === 'suggested' ? String(r.suggested_sacks) : '0',
      sacks_per_pallet: r.sacks_per_pallet,
      forecast: forecastOf(r),
      reason,
    });
    entry.runOuts.push(r.run_out_day);
  }
  for (const { group, runOuts } of byDepot.values()) {
    group.requested_on = suggestRequestedOn(runOuts, input.supplier.lead_time_days, input.today);
  }
  return groups;
}

/**
 * Ett sparat utkast tillbaka som panelens rader. Depånamn och Plats ur det AKTUELLA registret när depån finns
 * kvar — det är det Granska kommer att använda — annars det lagrade.
 */
export function composerFromOrder(
  order: { lines: OrderLine[] },
  ctx: { forecastRows: DepotMaterialForecast[]; depots: OpsDepot[] },
): ComposerDepot[] {
  const registry = new Map(ctx.depots.map((d) => [d.id, d]));
  const groups: ComposerDepot[] = [];
  const byDepot = new Map<string, ComposerDepot>();
  for (const l of order.lines) {
    let group = byDepot.get(l.depot_id);
    if (!group) {
      const depot = registry.get(l.depot_id);
      group = {
        depot_id: l.depot_id,
        depot_name: depot?.name ?? l.depot_name,
        location: depot ? depot.location : l.depot_location,
        requested_on: l.requested_on,
        rows: [],
      };
      byDepot.set(l.depot_id, group);
      groups.push(group);
    }
    group.rows.push({
      material: l.material,
      sacks: String(l.sacks),
      sacks_per_pallet: sacksPerPalletFor(l.material),
      forecast: forecastOf(findForecast(ctx.forecastRows, l.depot_id, l.material)),
      reason: 'manual',
    });
  }
  return groups;
}

/**
 * "+ Lägg till depå/material". Ett par som redan står på beställningen läggs inte till en gång till (servern
 * vägrar dubbletter). En ny depå får ett eget datumförslag ur sin prognos.
 */
export function addComposerRow(
  depots: ComposerDepot[],
  add: { depot: OpsDepot; material: string },
  ctx: { forecastRows: DepotMaterialForecast[]; leadTimeDays: number; today: string },
): ComposerDepot[] {
  const f = findForecast(ctx.forecastRows, add.depot.id, add.material);
  const row: ComposerRow = {
    material: add.material,
    sacks: '0',
    sacks_per_pallet: sacksPerPalletFor(add.material),
    forecast: forecastOf(f),
    reason: 'manual',
  };
  const existing = depots.find((d) => d.depot_id === add.depot.id);
  if (existing) {
    if (existing.rows.some((r) => r.material === add.material)) return depots;
    return depots.map((d) => (d.depot_id === add.depot.id ? { ...d, rows: [...d.rows, row] } : d));
  }
  return [
    ...depots,
    {
      depot_id: add.depot.id,
      depot_name: add.depot.name,
      location: add.depot.location,
      requested_on: suggestRequestedOn([f?.run_out_day ?? null], ctx.leadTimeDays, ctx.today),
      rows: [row],
    },
  ];
}

/** Heltal ≥ 0 ur fältet, eller null när texten inte är ett. Tomt räknas som 0 (raden beställs inte). */
export function parseSacks(text: string): number | null {
  const t = text.trim();
  if (t === '') return 0;
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

/**
 * Säckfältets −/+ : en pall i taget. Från ett tal som inte är hela pallar går steget till närmaste hela pall åt
 * det hållet, inte en pall förbi den.
 */
export function stepByPallet(text: string, sacksPerPallet: number, direction: 1 | -1): string {
  const n = parseSacks(text) ?? 0;
  const p = sacksPerPallet;
  if (direction === 1) return String((Math.floor(n / p) + 1) * p);
  const down = n % p === 0 ? n - p : Math.floor(n / p) * p;
  return String(Math.max(0, down));
}

export type PalletNote =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'pallets'; pallets: number }
  | { kind: 'not_whole'; sacks_per_pallet: number }
  | { kind: 'unknown' };

/** Texten bredvid säckfältet: "= 4 pall", eller varför talet inte går att beställa. */
export function palletNote(text: string, sacksPerPallet: number | null): PalletNote {
  const n = parseSacks(text);
  if (n === null) return { kind: 'invalid' };
  if (n === 0) return { kind: 'none' };
  if (sacksPerPallet === null) return { kind: 'unknown' };
  return n % sacksPerPallet === 0 ? { kind: 'pallets', pallets: n / sacksPerPallet } : { kind: 'not_whole', sacks_per_pallet: sacksPerPallet };
}

/** Raderna som skickas till Granska: bara de med säckar. Ett ogiltigt tal skickas som det är — servern säger nej. */
export function composerLines(depots: ComposerDepot[]): OrderLineInput[] {
  const out: OrderLineInput[] = [];
  for (const d of depots) {
    for (const r of d.rows) {
      const n = parseSacks(r.sacks);
      if (n === 0) continue;
      out.push({ depot_id: d.depot_id, material: r.material, sacks: n ?? Number.NaN, requested_on: d.requested_on });
    }
  }
  return out;
}

/** Fält med text som inte är ett heltal. Granska stängs tills de är rättade — NaN går inte att skicka som JSON. */
export function composerInvalidRows(depots: ComposerDepot[]): { depot_name: string; material: string }[] {
  return depots.flatMap((d) => d.rows.filter((r) => parseSacks(r.sacks) === null).map((r) => ({ depot_name: d.depot_name, material: r.material })));
}

/**
 * "Totalt 12 pall · 648 säck". Bara information — INGEN lasskontroll (fullt lass modelleras inte). Pallarna är
 * null när en rad med säckar har okänd pallstorlek: en summa som tyst hoppar över den raden är fel.
 */
export function composerTotals(depots: ComposerDepot[]): { sacks: number; pallets: number | null; lines: number } {
  let sacks = 0;
  let pallets: number | null = 0;
  let lines = 0;
  for (const d of depots) {
    for (const r of d.rows) {
      const n = parseSacks(r.sacks);
      if (!n) continue;
      lines += 1;
      sacks += n;
      if (pallets !== null) pallets = r.sacks_per_pallet ? pallets + n / r.sacks_per_pallet : null;
    }
  }
  return { sacks, pallets: pallets === null ? null : Math.round(pallets * 100) / 100, lines };
}

/**
 * Jämförelsenyckeln för "osparade ändringar": det Granska skulle skicka. Samma nyckel för panelens rader och för
 * ett lagrat utkast, så att ett orört utkast aldrig ser ändrat ut.
 */
export function draftSnapshot(input: { lines: OrderLineInput[]; other_lines: OtherLineInput[]; message: string | null }): string {
  const lines = [...input.lines]
    .map((l) => [l.depot_id, l.material, l.sacks, l.requested_on] as const)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const other = input.other_lines.map((o) => [o.text.trim(), o.depot_id ?? null] as const).filter(([text]) => text !== '');
  return JSON.stringify({ lines, other, message: (input.message ?? '').trim() || null });
}

export function storedDraftSnapshot(order: { lines: OrderLine[]; other_lines: OtherLine[]; message: string | null }): string {
  return draftSnapshot({
    lines: order.lines.map((l) => ({ depot_id: l.depot_id, material: l.material, sacks: l.sacks, requested_on: l.requested_on })),
    other_lines: order.other_lines.map((o) => ({ text: o.text, depot_id: o.depot_id })),
    message: order.message,
  });
}

// ---------------------------------------------------------------------------
// Listan: leverantörer och ordrar
// ---------------------------------------------------------------------------

export type SupplierOverview = {
  supplier: MaterialSupplier;
  /** Par i aktiva depåer med underskott, av material fabriken levererar. */
  needs: number;
  /** Tidigaste "beställ senast" bland behoven där fabriken är ensam leverantör, eller null. */
  order_by: string | null;
  open_order: { id: string; order_no: number; status: 'draft' | 'sending' } | null;
};

/**
 * "Nästa beställning": varje AKTIV leverantör med sina behov, brådskande först. En inaktiv leverantör får aldrig
 * en ny beställning (buildOrderLines vägrar), så den visas inte här.
 */
export function supplierOverview(input: {
  suppliers: MaterialSupplier[];
  forecastRows: DepotMaterialForecast[];
  depots: OpsDepot[];
  orders: { id: string; order_no: number; supplier_id: string | null; status: string }[];
}): SupplierOverview[] {
  const activeDepots = new Set(input.depots.filter((d) => d.active).map((d) => d.id));
  const rows = input.forecastRows.filter((r) => r.worst_deficit > 0 && activeDepots.has(r.depot_id));
  return input.suppliers
    .filter((s) => s.active)
    .map((supplier) => {
      const mine = rows.filter((r) => supplier.materials.includes(r.material));
      const dates = mine
        .filter((r) => defaultSupplierForMaterial(input.suppliers, r.material)?.id === supplier.id && r.suggested_date)
        .map((r) => r.suggested_date as string)
        .sort();
      const open = input.orders.find((o) => o.supplier_id === supplier.id && (o.status === 'draft' || o.status === 'sending'));
      return {
        supplier,
        needs: mine.length,
        order_by: dates[0] ?? null,
        open_order: open ? { id: open.id, order_no: open.order_no, status: open.status as 'draft' | 'sending' } : null,
      };
    })
    .sort(
      (a, b) =>
        Number(b.needs > 0) - Number(a.needs > 0) ||
        (a.order_by ?? '9999-12-31').localeCompare(b.order_by ?? '9999-12-31') ||
        a.supplier.name.localeCompare(b.supplier.name, 'sv'),
    );
}

export type OrderSection = 'action' | 'on_the_way' | 'history';

/**
 * Var en order står i listan. Ett utkast och ett oklart utskick kräver åtgärd: båda spärrar nästa beställning
 * till fabriken ("en öppen order per leverantör") tills någon skickar, avgör eller slänger.
 */
export function orderSection(order: { status: string; delivery_state: OrderDeliveryState | null }): OrderSection {
  if (order.status !== 'sent') return 'action';
  return order.delivery_state === 'waiting' || order.delivery_state === 'partial' ? 'on_the_way' : 'history';
}

export type SendingPhase =
  /** Ett försök pågår eller gjordes nyss — databasen svarar "pågår" i ytterligare `seconds` sekunder. */
  | { kind: 'wait'; seconds: number }
  /** Försök igen: samma mail, samma nyckel. Resend skickar det inte en gång till. */
  | { kind: 'retry' }
  /** Fönstret på 23 h har gått — en människa avgör efter att ha tittat i kopian. */
  | { kind: 'resolve' };

/**
 * Läget för ett oklart utskick, ur klientens klocka. Bara ett förhandsbesked för knapparna: databasen räknar med
 * sin egen klocka och svarar "pågår" eller "fönstret har gått" om de inte stämmer överens.
 */
export function sendingPhase(order: { attempt_started_at: string | null; last_try_at: string | null }, nowMs: number): SendingPhase {
  const started = order.attempt_started_at ? Date.parse(order.attempt_started_at) : Number.NaN;
  if (Number.isNaN(started) || nowMs - started >= RESOLVE_AFTER_MS) return { kind: 'resolve' };
  const lastTry = order.last_try_at ? Date.parse(order.last_try_at) : started;
  const wait = RETRY_WAIT_MS - (nowMs - (Number.isNaN(lastTry) ? started : lastTry));
  return wait > 0 ? { kind: 'wait', seconds: Math.ceil(wait / 1000) } : { kind: 'retry' };
}

/**
 * Varför ett utkast har ett fel kvar. Resends avslag BEVISAR att inget skickades; allt annat bokfördes som oklart och
 * står kvar efter att en människa svarat "gick inte fram" (resolve rör inte send_error). Det är två olika besked —
 * "avvisades" om ett mail som kanske gick fram är fel åt det farliga hållet.
 */
export function draftErrorKind(order: { send_error: string | null; send_error_code: string | null }): 'rejected' | 'not_delivered' | null {
  if (!order.send_error) return null;
  return classifySendError(order.send_error_code) === 'rejected' ? 'rejected' : 'not_delivered';
}

/**
 * Ett svar på Skicka som inte säger vad som hände: ett serverfel, eller en kropp som inte gick att läsa (en dödad
 * funktion, en proxy). Mailet kan ha tagits emot av Resend innan det small — sidan får inte säga "misslyckades".
 *
 * ⚠️ 503 `material_order_send_blocked` är undantaget: spärren prövas före varje skrivning, så det svaret bevisar att
 * ingenting påbörjades.
 */
export function sendResponseUnclear(r: { status: number; ok: boolean; code: string | null }): boolean {
  if (r.code === 'material_order_send_blocked') return false;
  return r.status >= 500 || (!r.ok && r.code === null);
}

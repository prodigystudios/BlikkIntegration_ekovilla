import { lineItemQuantity } from './lineItems';

// Etapper på en arbetsorder - en order som säljs som helhet men utförs i omgångar.
//
// ⚠️ ORDVALET. "Etapp" betyder REDAN någonting annat i koden: i app/egenkontroll/page.tsx
// (`etapperOpen`, `etapperClosed`, `finalSackEntriesFromEtappRows`) och i
// lib/domains/planning/sackLedger.ts är en "etapprad" en KONSTRUKTIONSDEL - vind, vägg, snedtak.
// Det här är något annat: en TIDSETAPP, som kan innehålla flera konstruktionsdelar, och där samma
// konstruktionsdel kan delas mellan två etapper. Därför `stage` i kod och databas, "Etapp" bara i
// det användaren läser. Se även huvudet i supabase/sql/20260919_crm_work_order_stages.sql.
//
// ── MODELLEN ────────────────────────────────────────────────────────────────
// En etapp äger en delmängd av orderns rader MED ANTAL, i samma form som delfakturans rundor
// (crm_work_order_invoices.line_quantities). Formen är beprövad och löser samma sorts fråga, så
// computeStageState nedan speglar computeInvoiceState i lib/domains/fortnox/partialInvoices.ts
// avsiktligt tätt - inklusive `written_off` → 0 och golvet på noll.
//
// 🧨 BESKÄRNINGEN PROJICERAR RADEN, DEN RÄKNAR INTE OM NÅGOT. `scopeLineItems` skriver om raden till
// `pricing_mode: 'item'` med etappens antal, varefter ALL befintlig radmatte - totalSacks,
// lineItemRowTotal, materialDemandFromLineItems, materialLabelFromLineItems - körs OFÖRÄNDRAD på
// resultatet. Alternativet, en egen säckformel och en egen prisformel per etapp, hade varit två
// nya ställen som kan glida isär från de riktiga.
//
// 🧨 `whole` RETURNERAR ARRAYEN ORÖRD - samma element, inte omskrivna kopior. Det är gångjärnet som
// gör att de dryga hundra ordrar som saknar etapper beter sig exakt som förut, bit för bit. Rör man
// det måste man kunna svara på varför en order utan etapper plötsligt räknas genom en projektion.

/** Vad en etapp tagit av en rad. `line_id` är radens stabila UUID ur `line_items[].id`. */
export type StageLineQuantity = { line_id: string; quantity: number };

export type WorkOrderStage = {
  id: string;
  stage_number: number;
  title: string;
  line_quantities: StageLineQuantity[] | null;
};

/** Radfälten beskärningen behöver läsa eller skriva. Allt annat bärs vidare orört. */
export type StageLineItem = {
  id?: string | null;
  pricing_mode?: string | null;
  m2?: string | null;
  thickness_mm?: string | null;
  quantity?: string | null;
  written_off?: boolean | null;
};

/** Per rad: hela antalet, vad etapperna tagit, och vad som är kvar att etappindela. */
export type StageLineState = {
  lineId: string | null;
  index: number;
  total: number;
  allocated: number;
  unallocated: number;
};

// Samma kvantiseringssteg som delfakturan (roundQty). Radantal är m³ med decimaler, och utan ett
// gemensamt steg blir "resten" ett spöktal som 0.0000000001 i stället för noll.
const roundQty = (n: number) => Math.round(n * 1e6) / 1e6;

/** Ett valideringsfel i etappindelningen - överallokering eller en tom etapp. Rutten svarar 409. */
export class StageAllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StageAllocationError';
  }
}

/** Hur mycket en etapp tagit av EN rad. Dubbla poster för samma rad summeras. */
function allocatedOnLine(stages: WorkOrderStage[], lineId: string | null): number {
  if (!lineId) return 0;
  return roundQty(
    stages.reduce(
      (sum, stage) =>
        sum +
        (stage.line_quantities ?? [])
          .filter((q) => q.line_id === lineId)
          .reduce((s, q) => s + Math.max(0, q.quantity), 0),
      0,
    ),
  );
}

/**
 * Allokerat och oallokerat per rad, mot orderns AKTUELLA rader.
 *
 * `opts.excludeStageId` utelämnar en etapp ur summan - används när man REDIGERAR den, så att dess
 * egna antal inte räknas som upptagna av någon annan.
 *
 * ⚠️ `allocated` KAPAS mot radens antal. Sänks en rad efter att etapper skapats, eller hinner två
 * samtidiga skapanden förbi varandra, är alternativet ett negativt "kvar" eller en etapp som
 * beskärs till mer än raden innehåller - alltså uppblåst omsättning. Kapningen gör att värsta
 * utfallet blir "kvar = 0", vilket är fel åt det ofarliga hållet och dessutom SYNS.
 *
 * ⚠️ En rad utan `id` kan inte ingå i en etapp och får `allocated = 0`. quoteLineItemSchema har
 * krävt id på varje rad vid varje sparning sedan länge, så det gäller bara mycket gammal data.
 */
export function computeStageState(
  lineItems: StageLineItem[] | null,
  stages: WorkOrderStage[],
  opts?: { excludeStageId?: string },
): StageLineState[] {
  const counted = opts?.excludeStageId ? stages.filter((s) => s.id !== opts.excludeStageId) : stages;
  return (lineItems ?? []).map((item, index) => {
    const lineId = item.id ?? null;
    // En avskriven rad är såld men aldrig utförd. Den ska varken planeras eller bära omsättning,
    // exakt som den inte längre går att fakturera (computeInvoiceState).
    const total = item.written_off ? 0 : roundQty(lineItemQuantity(item));
    const allocated = Math.min(total, allocatedOnLine(counted, lineId));
    return { lineId, index, total, allocated, unallocated: roundQty(Math.max(0, total - allocated)) };
  });
}

/**
 * Pröva en etapps begärda antal mot vad som är kvar. Returnerar de dedupade, positiva antalen.
 *
 * Kastar StageAllocationError när en rad överallokeras eller när ingenting alls begärts - en tom
 * etapp är inte ett fel som går att upptäcka senare, den blir bara en post i backloggen som ingen
 * kan planera.
 */
export function validateStageAllocation(
  state: StageLineState[],
  request: StageLineQuantity[],
): Map<string, number> {
  const byLine = new Map<string, number>();
  for (const line of request) {
    const qty = roundQty(Math.max(0, line.quantity));
    if (!line.line_id || qty <= 0) continue;
    byLine.set(line.line_id, roundQty((byLine.get(line.line_id) ?? 0) + qty));
  }
  if (byLine.size === 0) throw new StageAllocationError('Etappen måste innehålla minst en rad med ett antal.');

  for (const [lineId, qty] of byLine) {
    const row = state.find((s) => s.lineId === lineId);
    if (!row) throw new StageAllocationError('En rad i etappen finns inte längre på ordern.');
    if (qty > row.unallocated) {
      throw new StageAllocationError(
        `Raden har bara ${row.unallocated} kvar att planera, men etappen begär ${qty}.`,
      );
    }
  }
  return byLine;
}

/** Vad en beskärning avser. `whole` = hela ordern (bakåtkompatibiliteten, se modulhuvudet). */
export type StageScope =
  | { kind: 'whole' }
  | { kind: 'stage'; stage: WorkOrderStage; siblings: WorkOrderStage[] }
  | { kind: 'rest'; stages: WorkOrderStage[] };

// Nyckeln ett scope adresseras med bor i lib/domains/planning/weekValue.ts (`scopeKey`). En kopia
// här hade varit två definitioner av samma strängformat - precis den sortens dubblett som gör att
// två ytor tyst slutar hitta varandras rader.

/**
 * Orderns rader projicerade på ett scope.
 *
 * Rader som scopet inte rör utelämnas helt - en etapp som bara innehåller väggen ska inte bära
 * snedtakets material i `materialLabelFromLineItems`, och inte dess säckar.
 *
 * ⚠️ `whole` returnerar arrayen ORÖRD. Se modulhuvudet.
 */
export function scopeLineItems<T extends StageLineItem>(items: T[] | null, scope: StageScope): T[] {
  if (scope.kind === 'whole') return items ?? [];
  const rows = items ?? [];
  if (rows.length === 0) return [];

  const state = computeStageState(
    rows,
    scope.kind === 'stage' ? [scope.stage, ...scope.siblings.filter((s) => s.id !== scope.stage.id)] : scope.stages,
  );

  const out: T[] = [];
  rows.forEach((item, index) => {
    const row = state[index];
    let qty: number;
    if (scope.kind === 'stage') {
      // Etappens EGET antal, kapat mot vad raden faktiskt innehåller. Kapningen behövs när raden
      // sänkts efter att etappen skapades - annars planeras mer än som är sålt.
      qty = Math.min(row.total, allocatedOnLine([scope.stage], row.lineId));
    } else {
      qty = row.unallocated;
    }
    if (!(qty > 0)) return;
    // Projektionen: 'item' + antalet gör att lineItemQuantity svarar exakt qty, varefter både
    // säckberäkningen (som läser density och article_name, orörda) och radsumman (som läser
    // unit_price och discount_percent, orörda) blir rätt utan att känna till etapper.
    out.push({ ...item, pricing_mode: 'item', quantity: String(roundQty(qty)) });
  });
  return out;
}

/** Finns det något kvar som ingen etapp tagit? Styr om backloggen visar en "Resten"-post. */
export function hasUnallocatedWork(items: StageLineItem[] | null, stages: WorkOrderStage[]): boolean {
  if (stages.length === 0) return (items ?? []).length > 0;
  return computeStageState(items, stages).some((s) => s.unallocated > 0);
}

/**
 * Som `scopeLineItems`, men för VISNING: radens eget prisläge behålls.
 *
 * 🧨 ANVÄND ALDRIG DEN HÄR TILL MATTE. `scopeLineItems` projicerar raden till `pricing_mode: 'item'`
 * just för att all befintlig radmatte ska kunna köras oförändrad — det är rätt för säckar, kronor
 * och materialbehov, men fel så fort raden RENDERAS: en m3-rad ritas då som "Antal 37.5" i stället
 * för "37,5 m³", och måttdetaljen (150 m² × 250 mm) försvinner. Upptäckt i granskningen 2026-09-18,
 * första gången projektionen visades för en människa.
 *
 * Här skrivs i stället radens EGEN mängd om: `m2` för m3-rader, `quantity` för antalsrader. Då
 * behåller enheten, tjockleken och formateringen sin mening i vyn.
 *
 * ⚠️ En m3-rad utan tjocklek kan inte räknas om (division med noll). En sådan rad har volymen noll
 * och kan därför aldrig ingå i en etapp, så fallet är omöjligt — men villkoret står kvar som spärr.
 */
export function scopeLineItemsForDisplay<T extends StageLineItem & { thickness_mm?: string | null }>(
  items: T[] | null,
  scope: StageScope,
): T[] {
  if (scope.kind === 'whole') return items ?? [];
  const scoped = scopeLineItems(items ?? [], scope);
  const byId = new Map(scoped.map((r) => [r.id ?? '', r]));

  const out: T[] = [];
  for (const item of items ?? []) {
    const hit = item.id ? byId.get(item.id) : undefined;
    if (!hit) continue;
    // `scopeLineItems` la etappens mängd i `quantity` och satte läget till 'item'.
    const qty = Number(hit.quantity ?? 0);
    if (!(qty > 0)) continue;

    const isM3 = (item.pricing_mode ?? 'm3') !== 'item';
    if (!isM3) {
      out.push({ ...item, quantity: String(qty) });
      continue;
    }
    const thickness = Number(String(item.thickness_mm ?? '').replace(',', '.'));
    if (!(thickness > 0)) continue;
    // Tillbaka från kubik till kvadratmeter, så raden ritas i sin egen enhet.
    out.push({ ...item, m2: String(Math.round((qty * 1000) / thickness * 1000) / 1000) });
  }
  return out;
}

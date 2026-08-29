import type { SupabaseClient } from '@supabase/supabase-js';
import { parseDecimal } from '@/lib/shared/number';
import { computePricing, lineItemRowTotal, type PricingLineItem } from '@/lib/domains/crm/pricing';
import { lineItemQuantity } from '@/lib/domains/crm/lineItems';
import { inferMaterialFromArticle } from '@/lib/domains/crm/materials';
import {
  calculateAfterCalculation,
  type AfterCalculation,
  type AfterCalculationSackRow,
  type AfterCalculationTimeRow,
  type OtherMaterialRow,
} from '@/lib/domains/crm/afterCalculation';
import {
  getCalcSettings,
  listCostArticlePrices,
  listMaterialCostArticles,
  mapLaborCostPerHour,
  mapMaterialCostArticles,
  type CalcSettingsRow,
  type MaterialCostArticleRow,
} from '@/lib/domains/crm/calcSettings';

// Underlaget till efterkalkylen — hämtat MÄNGDVIS, för en eller hundra arbetsordrar.
//
// Räkningen bor i afterCalculation.ts och är ren. Den här modulen gör två saker: samlar in det den
// behöver ur databasen, och översätter orderns rader till kalkylens indata. Båda rutterna
// (arbetsordern och listan) går genom den, så det finns EN plats som avgör vad som räknas som
// material — den regeln har redan varit fel en gång och ska inte finnas i två kopior.
//
// ⚠️ ALLA FRÅGOR ÄR SET-WISE. En loop över hundra ordrar hade blivit sexhundra frågor, och listan
// hämtar upp till CRM_WORK_ORDERS_PAGE_SIZE (100) rader i taget.

/** Vad en arbetsorder behöver bära för att kunna efterkalkyleras. */
export type AfterCalculationOrderRow = {
  id: string;
  line_items: unknown;
  vat_percent?: number | string | null;
};

/**
 * En rad som blåses och därmed räknas via säckrapporten.
 *
 * ⚠️ VARUMÄRKESNAMNET RÄCKER INTE. `inferMaterialFromArticle` matchar på varumärket, och halva
 * sortimentet heter EKOVILLA utan att vara lösull: EKOVILLA LEVY 30MM (styva skivor),
 * VINDSKYDDSDUK EKOVILLA, ÅNGBROMS EKOVILLA. Ett filter på enbart materialnamnet lät fyra paket
 * skivor à 499,89 kr falla ur kalkylen på order #13 — och TB2 stod på +1 655 kr där rätt svar var
 * −345 kr. Rätt fråga är om raden är ett känt material SÅLT PER VOLYM; samma m³-test som
 * `lineItemQuantity` gör.
 *
 * En lösullsrad utan ifylld densitet räknas alltså fortfarande som blåst och hoppas över här. Dess
 * säckar kan mycket väl vara rapporterade ändå, och dubbelräkning är värre än att missa.
 */
export function isBlownInsulationRow(item: Record<string, unknown>): boolean {
  // Såld per volym. Samma m³-test som lineItemQuantity gör, med samma default.
  if (((item.pricing_mode as string | null) ?? 'm3') === 'item') return false;
  // Varumärket i artikelnamnet är det vanliga kännetecknet …
  if (inferMaterialFromArticle(item.article_name as string | null)) return true;
  // … men det räcker inte ensamt. ⚠️ ARTIKELNAMNET GÅR ATT REDIGERA, och ett namn som tappar
  // varumärkesordet ("Ekovilla lösull vind" → "Lösull vind") härleder inget material längre — en
  // känd och tillåten redigering, se materialRenameEffect i materials.ts. En sådan rad hade
  // klassats som tjänst: ingen väntad säckrapport, ingen lucka, och raden prissatt mot sin egen
  // artikel i stället för mot de rapporterade säckarna. Resultatet blev en komplett-märkt TG på ett
  // jobb där lösullen aldrig mättes.
  //
  // Densiteten är det andra kännetecknet och det ärligare: den fylls i per rad, driver
  // säckberäkningen (lineItemSacks) och finns BARA på rader som faktiskt blåses. En saneringsrad
  // säljs också per m³ men bär ingen densitet, och ska fortsatt räknas som tjänst.
  return parseDecimal(item.density as string | number | null | undefined, 0) > 0;
}

/**
 * Orderns rader → kalkylens intäkt och dess material utanför säckrapporten. Ren, alltså testbar
 * utan databas.
 *
 * ⚠️ INTÄKTEN RÄKNAS UR RADERNA, INTE UR DEN SPARADE pricing_summary. Samma regel som
 * `MarginRow.revenue` bär i pricing.ts: det belopp som bedöms måste vara det som VISAS. Ekonomi-
 * kortets Delsumma är `computePricing(...)` över samma rader, så en lagrad sammanställning hade
 * kunnat stå en decimeter därifrån med ett annat tal — och den kan dessutom vara en
 * platshållarnolla på en order sparad utan summering (se netAmount).
 *
 * Avskrivna rader är ute ur BÅDA leden: de utförs aldrig, alltså faktureras de inte och det går
 * ingen lösull åt.
 */
export function buildOrderInput(
  order: AfterCalculationOrderRow,
  priceByArticle: Map<string, number | string | null | undefined>,
): { revenue: number; otherMaterialRows: OtherMaterialRow[] } {
  const lineItems = Array.isArray(order.line_items) ? (order.line_items as Array<Record<string, unknown>>) : [];
  const billableItems = lineItems.filter((item) => !item.written_off);
  const pricing = computePricing(billableItems as PricingLineItem[], order.vat_percent ?? null);

  const otherMaterialRows = billableItems
    .filter((item) => !isBlownInsulationRow(item))
    .map((item) => {
      const articleNumber = ((item.article_number as string | null) ?? '').trim() || null;
      const raw = articleNumber ? priceByArticle.get(articleNumber) : undefined;
      return {
        label: ((item.article_name as string | null) ?? '').trim() || articleNumber || 'Rad utan artikel',
        articleNumber,
        quantity: lineItemQuantity(item as PricingLineItem),
        // ⚠️ `undefined` (artikeln finns inte i cachen) och `null` (aldrig prissatt) blir båda
        // null = OKÄNT. En nolla ur Fortnox är däremot ett svar — se OtherMaterialRow.
        purchasePrice: raw == null ? null : parseDecimal(raw, 0),
        revenue: lineItemRowTotal(item as PricingLineItem),
      };
    })
    // En tom rad i utkastet är varken intäkt eller kostnad — den ska inte synas i uppställningen.
    .filter((row) => row.quantity > 0 || row.revenue > 0);

  // ⚠️ subtotal, ALDRIG total — `total` bär moms, och moms är inte vår intäkt.
  return { revenue: pricing.subtotal, otherMaterialRows };
}

/** Artikelnumren som behöver ett pris: kostnadsartiklarna plus ordrarnas egna rader. */
export function collectArticleNumbers(
  orders: AfterCalculationOrderRow[],
  mappings: MaterialCostArticleRow[],
): string[] {
  const numbers = new Set<string>(mappings.map((row) => row.article_number));
  for (const order of orders) {
    const lineItems = Array.isArray(order.line_items) ? (order.line_items as Array<Record<string, unknown>>) : [];
    for (const item of lineItems) {
      if (item.written_off || isBlownInsulationRow(item)) continue;
      const articleNumber = ((item.article_number as string | null) ?? '').trim();
      if (articleNumber) numbers.add(articleNumber);
    }
  }
  return [...numbers];
}

/**
 * Alla rader ur en tabell för en mängd arbetsordrar, sidvis.
 *
 * ⚠️ POSTGREST KAPAR VID db.max_rows (~1000) UTAN ATT SÄGA IFRÅN. Hundra ordrar kan mycket väl ha
 * tretusen tidrader mellan sig, och en kapning här hade inte gjort svaret ofullständigt utan FEL:
 * arbetskostnaden blir för låg på de ordrar vars rader ramlade av, alltså ser jobben lönsammare ut
 * än de var. Samma paginering som deriveConsumptionRows i depotStock.ts, och av samma skäl.
 *
 * `order('id')` är inte kosmetik: utan en stabil sortering kan samma rad dyka upp på två sidor
 * medan en annan aldrig kommer med.
 */
async function fetchAllForWorkOrders<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  workOrderIds: string[],
  refine?: (query: any) => any,
): Promise<T[]> {
  const rows: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from(table)
      .select(select)
      .in('work_order_id', workOrderIds)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (refine) query = refine(query);
    const { data, error } = await query;
    // ⚠️ KASTA, ALDRIG `break`. Ett avbrott här hade gett kalkylen en TOM eller HALV radmängd, som
    // den inte kan skilja från "ingenting rapporterat" — alltså blir ett läsfel till påståendet
    // "ingen tid är rapporterad på jobbet" och arbetskostnaden noll. Exakt den riktning
    // pagineringen finns för att förhindra. Anroparen ska svara med ett fel, inte med en
    // glädjekalkyl.
    if (error) throw new Error(`Kunde inte läsa ${table}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/**
 * Efterkalkylen för en mängd arbetsordrar.
 *
 * Ordrar utan rad i kartan har inte kunnat räknas alls (de fanns inte, eller kunde inte läsas) —
 * anropsstället måste skilja det från ett jobb vars TB är okänt, precis som `sumSacksByWorkOrder`
 * skiljer "ej rapporterat" från "noll".
 *
 * ⚠️ Anropas med en ELEVERAD klient. Skälet står i rutterna: RLS på crm_time_entries gör annars
 * svaret beroende av vem som frågar, och en säljare som inte äger ordern läser noll tidrader — ett
 * jobb som ser lönsamt ut i stället för utebliven behörighet. Auktorisationen ligger i rutternas
 * gate på crm.report.read, inte här.
 */
export async function computeAfterCalculations(
  supabase: SupabaseClient,
  orders: AfterCalculationOrderRow[],
): Promise<Map<string, AfterCalculation>> {
  const result = new Map<string, AfterCalculation>();
  if (orders.length === 0) return result;

  const workOrderIds = orders.map((order) => order.id);

  const [sackRows, timeRows, settingsResult, mappingResult] = await Promise.all([
    fetchAllForWorkOrders<AfterCalculationSackRow & { work_order_id: string }>(
      supabase,
      'ops_segment_reports',
      'id, work_order_id, sacks_blown, kind, material',
      workOrderIds,
    ),
    // Bara jobbtid. Frånvaro och interntid bär aldrig work_order_id (buildTimeEntryRow nollar
    // fälten som inte hör till raden), men villkoret står ändå kvar: en rad som kommer in någon
    // annan väg ska inte kunna debitera jobbet.
    fetchAllForWorkOrders<AfterCalculationTimeRow & { work_order_id: string }>(
      supabase,
      'crm_time_entries',
      'id, work_order_id, minutes_worked, hours',
      workOrderIds,
      (query) => query.eq('kind', 'work_order'),
    ),
    getCalcSettings(supabase),
    listMaterialCostArticles(supabase),
  ]);

  if (settingsResult.error || mappingResult.error) {
    throw new Error('Kalkylinställningarna kunde inte läsas. Är 20260828_crm_cost_settings.sql körd?');
  }

  const mappings = (mappingResult.data || []) as MaterialCostArticleRow[];
  const articleNumbers = collectArticleNumbers(orders, mappings);
  const priceResult = articleNumbers.length > 0
    ? await listCostArticlePrices(supabase, articleNumbers)
    : { data: [], error: null };
  if (priceResult.error) throw new Error(priceResult.error.message);

  const priceRows = (priceResult.data || []) as Array<{ article_number: string; purchase_price?: number | string | null }>;
  const priceByArticle = new Map(priceRows.map((row) => [row.article_number, row.purchase_price]));
  const costArticles = mapMaterialCostArticles(mappings, priceRows as any[]);
  const laborCostPerHour = mapLaborCostPerHour(settingsResult.data as CalcSettingsRow | null);

  // Raderna grupperas per order EN gång; ett filter per order hade blivit kvadratiskt på hundra.
  const sacksByOrder = new Map<string, AfterCalculationSackRow[]>();
  for (const row of sackRows) {
    const list = sacksByOrder.get(row.work_order_id);
    if (list) list.push(row);
    else sacksByOrder.set(row.work_order_id, [row]);
  }
  const timeByOrder = new Map<string, AfterCalculationTimeRow[]>();
  for (const row of timeRows) {
    const list = timeByOrder.get(row.work_order_id);
    if (list) list.push(row);
    else timeByOrder.set(row.work_order_id, [row]);
  }

  for (const order of orders) {
    const { revenue, otherMaterialRows } = buildOrderInput(order, priceByArticle);
    const lineItems = Array.isArray(order.line_items) ? (order.line_items as Array<Record<string, unknown>>) : [];
    result.set(
      order.id,
      calculateAfterCalculation({
        revenue,
        sackRows: sacksByOrder.get(order.id) ?? [],
        timeRows: timeByOrder.get(order.id) ?? [],
        costArticles,
        otherMaterialRows,
        // Säljer ordern lösull väntar vi oss en säckrapport, och avsaknaden är en lucka. En ren
        // tjänsteorder ska inte sakna en egenkontroll som aldrig kommer.
        hasBlownInsulationRows: lineItems.some((item) => !item.written_off && isBlownInsulationRow(item)),
        laborCostPerHour,
      }),
    );
  }

  return result;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseDecimal } from '@/lib/shared/number';
import { lineItemRowTotal, type PricingLineItem } from '@/lib/domains/crm/pricing';
import {
  calculatePreCalculation,
  type MaterialSackPrice,
  type PreCalculation,
  type PreCalculationLineItem,
} from '@/lib/domains/crm/preCalculation';
import {
  getCalcSettings,
  listCostArticlePrices,
  listMaterialCostArticles,
  listProductivityRates,
  mapLaborCostPerHour,
  mapMaterialCostArticles,
  mapProductivityRates,
  mapTeamSize,
  type CalcSettingsRow,
  type MaterialCostArticleRow,
  type ProductivityRateRow,
} from '@/lib/domains/crm/calcSettings';

// Underlaget till FÖRKALKYLEN — hämtat mängdvis, för en eller hundra arbetsordrar.
//
// Syskonmodul till afterCalculationLoader.ts och byggd på exakt samma mönster: räkningen bor i
// preCalculation.ts och är ren, den här modulen samlar in och översätter. Skillnaden mot
// efterkalkylens laddare är vad som matas in — planerade säckar ur radernas densitet i stället för
// rapporterade säckar ur egenkontrollen — inte hur.
//
// ⚠️ ALLA FRÅGOR ÄR SET-WISE. Planeringstavlan visar en vecka i taget men kan ha långt över hundra
// placeringar; en loop per kort hade blivit hundratals frågor per tavelladdning.
//
// ── ⚠️ INGEN EGEN MATTE HÄR ─────────────────────────────────────────────────
// Offertformuläret bygger sin indata i QuoteFormClient (`preCalcItems`). Den här modulen bygger
// SAMMA indata ur en sparad arbetsorder. Glider de två isär visar tavlan ett annat tal än offerten
// för samma jobb, och då är det ingen som litar på något av dem. Fälten nedan är därför en rak
// spegling: `revenue` = radens totalsumma efter rabatt, `purchasePrice` = artikelns inköpspris,
// `isLabor` = ROT-flaggad arbetsrad.

/** Vad en arbetsorder behöver bära för att kunna förkalkyleras. */
export type PreCalculationOrderRow = {
  id: string;
  line_items: unknown;
  /** Avgör tillsammans med rot_details om ROT är i spel — se isRotActive. */
  quote_type?: string | null;
  rot_details?: Record<string, unknown> | null;
};

/**
 * ROT är aktivt på ordern.
 *
 * ⚠️ SPEGLAR `rotActive` I QuoteFormClient: privatkund OCH påslagen ROT. `buildRotDetails` skriver
 * alltid ett objekt — även när ROT är av — så en `rot_details != null`-kontroll hade gjort VARJE
 * order ROT-aktiv. Flaggan sitter i `enabled`, inte i objektets existens.
 */
export function isRotActive(order: PreCalculationOrderRow): boolean {
  if (order.quote_type !== 'private') return false;
  return (order.rot_details ?? {}).enabled === true;
}

/**
 * Orderns rader → förkalkylens indata. Ren, alltså testbar utan databas.
 *
 * Avskrivna rader följer med orörda: `calculatePreCalculation` filtrerar dem själv, tillsammans med
 * tomma utkastrader. Att filtrera här också hade gett två regler för samma sak.
 */
export function buildPreCalculationItems(
  order: PreCalculationOrderRow,
  priceByArticle: Map<string, number | string | null | undefined>,
): PreCalculationLineItem[] {
  const lineItems = Array.isArray(order.line_items) ? (order.line_items as Array<Record<string, unknown>>) : [];
  const rotActive = isRotActive(order);

  return lineItems.map((item) => {
    const articleNumber = ((item.article_number as string | null) ?? '').trim() || null;
    const raw = articleNumber ? priceByArticle.get(articleNumber) : undefined;
    return {
      ...(item as unknown as PreCalculationLineItem),
      // ⚠️ Radens intäkt SKICKAS IN, den härleds inte i kalkylen — samma regel som
      // efterkalkylens laddare följer, och samma funktion: en andra implementation av
      // "vad kostar raden" är en andra chans att räkna fel på rabatten.
      revenue: lineItemRowTotal(item as PricingLineItem),
      // 🧨 EN NOLLA ÄR OKÄNT HÄR, INTE GRATIS — tvärtemot efterkalkylens regel, och med flit.
      //
      // Efterkalkylen får skilja 0 från tomt (afterCalculation.ts: "INKÖPSPRIS 0 ≠ TOMT") eftersom
      // dess lösull prissätts ur KOSTNADSARTIKELN; saknas den svarar den okänt. Förkalkylen har
      // ingen sådan reserv: faller den tillbaka på radens egen artikel blir ett nollpris till en
      // materialkostnad på noll kronor.
      //
      // Mätt i cachen 2026-09-21: av 292 artiklar har 54 inköpspris 0 och INGEN har tomt — ofyllt
      // lagras som noll. Bland nollorna ligger 1001–1006 ISOCELL cellulosa, alltså lösull som
      // faktiskt kostar pengar. Utan den här raden räknades den som gratis: 125 av 187 ordrar fick
      // för hög täckningsgrad, som mest 35 procentenheter, och en order visade 100,0 %. Exakt den
      // felklass efterkalkylen härdades mot i augusti (28 av 76 ordrar på TG1 100 %).
      //
      // Offertformuläret gör redan samma sak ett steg tidigare (`purchase_price > 0` i
      // QuoteFormClient), så det här är dessutom det som får tavlan och offerten att visa SAMMA tal.
      // ⛔ Vänd inte tillbaka utan att först fylla i de 54 artiklarnas inköpspris i Fortnox.
      purchasePrice: raw == null || parseDecimal(raw, 0) <= 0 ? null : parseDecimal(raw, 0),
      isLabor: rotActive && Boolean(item.is_rot_work),
    };
  });
}

/**
 * Artikelnumren som behöver ett pris.
 *
 * 🧨 TILL SKILLNAD FRÅN EFTERKALKYLENS `collectArticleNumbers` TAS ÄVEN BLÅSTA RADER MED. Där
 * prissätts lösullen uteslutande ur kostnadsartikeln, så radens egen artikel är ointressant. Här är
 * artikelpriset RESERVEN när materialet saknar kostnadsartikel — bara EKOVILLA, KNAUF SUPAFIL och
 * ROCKWOOL har en, medan Isocell, Hunton och PAROC inte har det. Hoppas de raderna över får
 * `marginCostBasis` inget pris att falla tillbaka på, och en PAROC-order tappar sin täckningsgrad
 * HELT i stället för att visa det densitetsblinda talet. Reserven är inte frivillig.
 */
export function collectPreCalculationArticleNumbers(
  orders: PreCalculationOrderRow[],
  mappings: MaterialCostArticleRow[],
): string[] {
  const numbers = new Set<string>(mappings.map((row) => row.article_number));
  for (const order of orders) {
    const lineItems = Array.isArray(order.line_items) ? (order.line_items as Array<Record<string, unknown>>) : [];
    for (const item of lineItems) {
      if (item.written_off) continue;
      const articleNumber = ((item.article_number as string | null) ?? '').trim();
      if (articleNumber) numbers.add(articleNumber);
    }
  }
  return [...numbers];
}

/**
 * Förkalkylen för en mängd arbetsordrar.
 *
 * Ordrar utan rad i kartan har inte kunnat räknas alls — anropsstället måste kunna skilja det från
 * ett jobb vars TB är okänt, precis som efterkalkylens laddare.
 *
 * ⚠️ Anropas med en ELEVERAD klient. Kalkylinställningarna och `fortnox_articles_cache` är
 * rollgrindade (sales/admin), så en konsult hade läst tomt och fått en order utan inköpspriser —
 * alltså ett jobb som ser obedömbart ut i stället för utebliven behörighet. Auktorisationen ligger
 * i ruttens gate på crm.report.read, inte här. Samma avvägning som efterkalkylen gör, av samma skäl.
 */
export async function computePreCalculations(
  supabase: SupabaseClient,
  orders: PreCalculationOrderRow[],
): Promise<Map<string, PreCalculation>> {
  const result = new Map<string, PreCalculation>();
  if (orders.length === 0) return result;

  const [settingsResult, ratesResult, mappingResult] = await Promise.all([
    getCalcSettings(supabase),
    listProductivityRates(supabase),
    listMaterialCostArticles(supabase),
  ]);

  if (settingsResult.error || mappingResult.error) {
    throw new Error('Kalkylinställningarna kunde inte läsas. Är 20260828_crm_cost_settings.sql körd?');
  }
  // ⚠️ PRODUKTIVITETSTABELLEN FÅR SAKNAS UTAN ATT FÄLLA HELA KALKYLEN. Migreringen
  // 20260829_crm_productivity_rates.sql är yngre än kostnadsinställningarna, och utan den är det
  // bara den uppskattade ARBETSTIDEN som uteblir — materialet, och därmed TG1, går fortfarande att
  // räkna. Att kasta här hade tagit bort ett tal som finns.
  const rates = mapProductivityRates((ratesResult.error ? [] : ratesResult.data) as ProductivityRateRow[] | null);

  const mappings = (mappingResult.data || []) as MaterialCostArticleRow[];
  const articleNumbers = collectPreCalculationArticleNumbers(orders, mappings);
  const priceResult = articleNumbers.length > 0
    ? await listCostArticlePrices(supabase, articleNumbers)
    : { data: [], error: null };
  if (priceResult.error) throw new Error(priceResult.error.message);

  const priceRows = (priceResult.data || []) as Array<{ article_number: string; purchase_price?: number | string | null }>;
  const priceByArticle = new Map(priceRows.map((row) => [row.article_number, row.purchase_price]));
  const sackPrices: MaterialSackPrice[] = mapMaterialCostArticles(mappings, priceRows as any[]).map((article) => ({
    material: article.material,
    purchasePrice: article.purchasePrice,
  }));

  const settingsRow = settingsResult.data as CalcSettingsRow | null;
  const laborCostPerHour = mapLaborCostPerHour(settingsRow);
  const teamSize = mapTeamSize(settingsRow);

  for (const order of orders) {
    result.set(
      order.id,
      calculatePreCalculation({
        items: buildPreCalculationItems(order, priceByArticle),
        laborCostPerHour,
        teamSize,
        rates,
        sackPrices,
      }),
    );
  }

  return result;
}

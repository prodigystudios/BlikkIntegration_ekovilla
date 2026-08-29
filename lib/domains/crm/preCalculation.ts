import { parseDecimal } from '@/lib/shared/number';
import { lineItemQuantity } from '@/lib/domains/crm/lineItems';
import { inferMaterialFromArticle, lineItemSacks, type SackLineItem } from '@/lib/domains/crm/materials';
import { constructionLabel, type ConstructionSlug } from '@/lib/domains/crm/constructions';

// Förkalkyl på offerten — uppskattat TB1/TB2 innan någon satt en fot på taket.
//
// ── SAMMA MATTE SOM EFTERKALKYLEN, ANNAT UNDERLAG ────────────────────────────
// Efterkalkylen (afterCalculation.ts) räknar på vad som RAPPORTERATS. Den här räknar på vad som
// PLANERATS, med exakt samma två termer:
//
//   material   planerade säckar × kostnadsartikelns pris per säck
//   arbete     uppskattade team-timmar × teamstorlek × timkostnad per person
//
// Säckarna är inte en ny uträkning: `lineItemSacks` är samma funktion som skriver antalet i
// arbetsbeskrivningen och i planeringen. Att räkna om dem här hade gett ett tredje tal för samma
// sak.
//
// ⚠️ DET LÖSER DENSITETSBLINDHETEN PÅ KÖPET. Offertens befintliga TG (quoteMargin) multiplicerar
// artikelns kr/m³ med volymen, och ett fast m³-pris kan bara stämma vid EN densitet — belagt på
// order #27, där 54 kg/m³ gjorde artikelns pris 14 % för lågt. Säckantalet tar hänsyn till
// densiteten, så vägen via säckar är rätt oavsett hur tätt det blåses.
//
// ── ⚠️ TEAM-TIMMAR OCH MAN-TIMMAR ÄR OLIKA SAKER ────────────────────────────
// Produktivitetstalen är per TEAM ("22 m³ i timmen" är vad ett lag hinner), timkostnaden är per
// PERSON. Man-timmar = team-timmar × teamstorlek. Faktorn ligger i en INSTÄLLNING och inte i en
// formel, just för att den annars är osynlig — och ett fel här ger dubbelt eller hälften utan att
// något ser trasigt ut.
//
// ── ⚠️ ETT SAKNAT TAL ÄR INTE NOLL ──────────────────────────────────────────
// Saknas produktiviteten för en kombination går tiden inte att uppskatta, och då är TB2 okänt —
// inte "noll timmar". Samma disciplin som efterkalkylen: okänt ritas som ett streck, och luckan
// säger vad som fattas.

/** Produktivitet för en kombination: m³ per timme och TEAM. */
export type ProductivityRate = {
  construction: string;
  material: string;
  m3PerHour: number;
};

/** Material → kostnadsartikelns pris per säck. Samma karta som efterkalkylen använder. */
export type MaterialSackPrice = {
  material: string;
  purchasePrice: number | null;
};

/** En offertrad, med det förkalkylen behöver. */
export type PreCalculationLineItem = SackLineItem & {
  article_number?: string | null;
  construction?: string | null;
  written_off?: boolean | null;
  /** Radens intäkt efter rabatt — skickas in, härleds inte. Se nedan. */
  revenue: number;
  /** Artikelns inköpspris per enhet, för rader som inte är lösull. null = okänt. */
  purchasePrice?: number | null;
};

export type PreCalculationInput = {
  items: PreCalculationLineItem[];
  /** Kronor per MAN-timme. */
  laborCostPerHour: number | null;
  /** Antal personer i laget. Produktivitetstalen är per team. */
  teamSize: number | null;
  rates: ProductivityRate[];
  sackPrices: MaterialSackPrice[];
};

export type PreCalculationGap =
  | { kind: 'missing_rate'; message: string; combinations: string[] }
  | { kind: 'missing_sack_price'; message: string; materials: string[] }
  | { kind: 'unpriced_rows'; message: string; revenue: number; labels: string[] }
  | { kind: 'no_labor_rate'; message: string };

export type PreCalculation = {
  revenue: number;
  /** null när någon del av materialet inte går att prissätta. */
  materialCost: number | null;
  /** Uppskattade team-timmar. null när något moment saknar produktivitet. */
  teamHours: number | null;
  laborCost: number | null;
  tb1: number | null;
  tb2: number | null;
  tg1: number | null;
  tg2: number | null;
  gaps: PreCalculationGap[];
};

/** Radens konstruktion, normaliserad. Tom sträng är "inte satt", inte ett värde. */
function constructionOf(item: PreCalculationLineItem): string | null {
  const value = (item.construction ?? '').trim().toLowerCase();
  return value ? value : null;
}

/**
 * Raden blåses och kostnadssätts därför via säckar.
 *
 * ⚠️ Samma tvådelade kännetecken som efterkalkylens `isBlownInsulationRow`, och av samma skäl:
 * varumärket i artikelnamnet räcker inte (halva sortimentet heter EKOVILLA utan att blåsas — LEVY,
 * vindduk, ångbroms), och densiteten fylls bara i på rader som faktiskt blåses. Glider de två
 * definitionerna isär kommer offerten och arbetsordern att räkna olika på samma rad.
 */
export function isBlownRow(item: PreCalculationLineItem): boolean {
  if (((item.pricing_mode as string | null) ?? 'm3') === 'item') return false;
  if (inferMaterialFromArticle(item.article_name)) return true;
  return parseDecimal(item.density, 0) > 0;
}

/** Etikett för en lucka: "Vägg × PAROC". */
function combinationLabel(construction: string | null, material: string | null): string {
  const left = construction
    ? constructionLabel(construction as ConstructionSlug) || construction
    : 'Ospecificerad placering';
  return `${left} × ${material ?? 'okänt material'}`;
}

export function calculatePreCalculation(input: PreCalculationInput): PreCalculation {
  const gaps: PreCalculationGap[] = [];

  const rateByKey = new Map(input.rates.map((r) => [`${r.construction}|${r.material}`, r.m3PerHour]));
  const priceByMaterial = new Map(input.sackPrices.map((p) => [p.material, p.purchasePrice]));

  // Avskrivna rader är ute ur båda leden — de utförs aldrig.
  const items = input.items.filter((item) => !item.written_off);
  const revenue = items.reduce((sum, item) => sum + (Number.isFinite(item.revenue) ? item.revenue : 0), 0);

  let materialCost = 0;
  let materialComplete = true;
  const missingSackPrice = new Set<string>();
  const unpricedLabels: string[] = [];
  let unpricedRevenue = 0;

  let teamHours = 0;
  let hoursComplete = true;
  const missingRates = new Set<string>();

  for (const item of items) {
    if (isBlownRow(item)) {
      // ── Lösull: kostnad via säckar, tid via produktivitet ────────────────
      const material = inferMaterialFromArticle(item.article_name)?.short ?? null;
      const sacks = lineItemSacks(item);
      const construction = constructionOf(item);

      if (material == null) {
        // Materialet går inte att härleda (omdöpt artikel), alltså vet vi varken pris eller takt.
        materialComplete = false;
        hoursComplete = false;
        missingRates.add(combinationLabel(construction, null));
      } else {
        const price = priceByMaterial.get(material);
        if (price == null || !(price > 0)) {
          materialComplete = false;
          missingSackPrice.add(material);
        } else {
          materialCost += sacks * price;
        }

        const rate = construction ? rateByKey.get(`${construction}|${material}`) : undefined;
        if (rate == null || !(rate > 0)) {
          hoursComplete = false;
          missingRates.add(combinationLabel(construction, material));
        } else {
          // Volymen, inte säckarna: produktivitetstalen är m³ per timme.
          teamHours += lineItemQuantity(item) / rate;
        }
      }
      continue;
    }

    // ── Övriga rader: skivor, duk, etablering ───────────────────────────────
    // Ingen tid uppskattas för dem — modellens produktivitet gäller blåsningen, och ett moment vi
    // inte kan tidsätta ska inte tyst tidsättas till noll. Det är en känd begränsning i
    // uppskattningen och står i luckelistan bara när raden har en okänd KOSTNAD.
    const price = item.purchasePrice;
    if (price == null || !Number.isFinite(price) || price < 0) {
      materialComplete = false;
      unpricedLabels.push((item.article_name ?? '').trim() || 'Rad utan artikel');
      unpricedRevenue += item.revenue;
      continue;
    }
    materialCost += price * lineItemQuantity(item);
  }

  if (missingSackPrice.size > 0) {
    gaps.push({
      kind: 'missing_sack_price',
      message: `Kostnadsartikel saknas för ${[...missingSackPrice].join(', ')} — sätt den under Inställningar → Kalkyl.`,
      materials: [...missingSackPrice],
    });
  }
  if (unpricedLabels.length > 0) {
    gaps.push({
      kind: 'unpriced_rows',
      message: `${unpricedLabels.join(', ')} saknar inköpspris i Fortnox — ${Math.round(unpricedRevenue).toLocaleString('sv-SE')} kr av offerten är inte bedömd.`,
      revenue: unpricedRevenue,
      labels: unpricedLabels,
    });
  }
  if (missingRates.size > 0) {
    gaps.push({
      kind: 'missing_rate',
      message: `Produktivitet saknas för ${[...missingRates].join(', ')} — arbetstiden går inte att uppskatta. Fyll i talen under Inställningar → Kalkyl.`,
      combinations: [...missingRates],
    });
  }

  const laborCostPerHour =
    input.laborCostPerHour != null && Number.isFinite(input.laborCostPerHour) && input.laborCostPerHour > 0
      ? input.laborCostPerHour
      : null;
  if (laborCostPerHour == null) {
    gaps.push({ kind: 'no_labor_rate', message: 'Timkostnaden är inte satt — sätt den under Inställningar → Kalkyl.' });
  }

  const teamSize = input.teamSize != null && Number.isFinite(input.teamSize) && input.teamSize > 0 ? input.teamSize : 1;

  // ⚠️ En ofullständig materialsumma är en UNDRE GRÄNS, inte ett svar. Samma regel som
  // efterkalkylen landade i efter att 28 av 76 ordrar visat TG1 100 %.
  const resolvedMaterialCost = materialComplete ? materialCost : null;
  const resolvedTeamHours = hoursComplete ? teamHours : null;
  // ⚠️ TEAM-TIMMAR × TEAMSTORLEK = MAN-TIMMAR. Faktorn är hela skillnaden mellan rätt och dubbelt.
  const laborCost =
    resolvedTeamHours != null && laborCostPerHour != null ? resolvedTeamHours * teamSize * laborCostPerHour : null;

  const tb1 = resolvedMaterialCost != null ? revenue - resolvedMaterialCost : null;
  const tb2 = tb1 != null && laborCost != null ? tb1 - laborCost : null;

  return {
    revenue,
    materialCost: resolvedMaterialCost,
    teamHours: resolvedTeamHours,
    laborCost,
    tb1,
    tb2,
    tg1: tb1 != null && revenue > 0 ? (tb1 / revenue) * 100 : null,
    tg2: tb2 != null && revenue > 0 ? (tb2 / revenue) * 100 : null,
    gaps,
  };
}

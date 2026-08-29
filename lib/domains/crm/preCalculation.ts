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
// ⚠️ DET LÖSER DENSITETSBLINDHETEN. Ett fast kr/m³-pris kan bara stämma vid EN densitet — belagt på
// order #27, där 54 kg/m³ gjorde artikelns pris 14 % för lågt. Säckantalet tar hänsyn till
// densiteten, så vägen via säckar är rätt oavsett hur tätt det blåses.
//
// Offertens TÄCKNINGSGRAD räknar sedan 2026-08-29 på samma underlag: `marginCostBasis` nedan är den
// delade regeln, och `quoteMargin` får säckar som `quantity` och kr/säck som `purchasePrice`. Två
// tal om samma sak i samma panel, räknade på olika sätt, lär läsaren att lita på fel siffra.
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
  /** Artikelns inköpspris per enhet. null = okänt. */
  purchasePrice?: number | null;
  /**
   * ROT-flaggad arbetsrad utan inköpspris — intäkt utan materialkostnad.
   *
   * ⚠️ MÅSTE SPEGLA `quoteMargin`s `isCostlessLabor`. Utan den räknades en sådan rad som obedömbar
   * här men med full marginal där, och de två talen i samma panel stod på intäktsunderlag tiotusen-
   * tals kronor isär utan att något förklarade varför.
   */
  isLabor?: boolean;
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
  | { kind: 'missing_density'; message: string; labels: string[] }
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

/**
 * Underlaget en rads KOSTNAD ska räknas på — det som `quoteMargin` multiplicerar ihop.
 *
 * ⚠️ FÖR LÖSULL ÄR DET SÄCKAR × KR/SÄCK, INTE M³ × ARTIKELPRIS. Ett fast kr/m³-pris kan bara stämma
 * vid EN densitet: artikel 2410509 står i 190 kr/m³, vilket motsvarar 28,8 kg/m³. På ett tätt
 * snedtak (54 kg/m³, order #27) är den verkliga kostnaden 14 % högre, och täckningsgraden alltså
 * för optimistisk — precis på de jobb där marginalen är tunnast.
 *
 * Funktionen finns för att offertens TG och dess uppskattade TB2 ska räkna radens kostnad på EXAKT
 * samma sätt. Två tal om samma sak, en decimeter isär i samma panel, lär läsaren att lita på fel
 * siffra — och det är den optimistiska som är lättast att tro på.
 *
 * `purchasePrice: null` betyder "går inte att kostnadsbedöma", och `quoteMargin` håller då raden
 * utanför både täljare och nämnare. Det gäller även en lösullsrad utan densitet: den ger noll
 * säckar, och noll säckar är inte noll kronor.
 */
export type MarginCostBasis = {
  quantity: number;
  purchasePrice: number | null;
  /**
   * Vad talet vilar på.
   *
   * `sacks`   säckar × kostnadsartikelns pris — det riktiga svaret, densitetskänsligt.
   * `article` artikelns eget kr/m³ — reserven, densitetsblind men bättre än ingenting.
   * `none`    går inte att kostnadsbedöma.
   */
  basis: 'sacks' | 'article' | 'none';
};

export function marginCostBasis(item: PreCalculationLineItem, sackPrices: MaterialSackPrice[]): MarginCostBasis {
  const articleBasis: MarginCostBasis = {
    quantity: lineItemQuantity(item),
    purchasePrice: item.purchasePrice ?? null,
    basis: item.purchasePrice == null ? 'none' : 'article',
  };
  if (!isBlownRow(item)) return articleBasis;

  const material = inferMaterialFromArticle(item.article_name)?.short ?? null;
  const sacks = lineItemSacks(item);
  const sackPrice = material ? sackPrices.find((p) => p.material === material)?.purchasePrice ?? null : null;

  // ⚠️ RESERVEN ÄR INTE FRIVILLIG. Bara tre material har kostnadsartikel i dag (EKOVILLA, KNAUF
  // SUPAFIL, ROCKWOOL) — Isocell, Hunton och PAROC saknar den. Utan reserven hade en offert på
  // PAROC tappat sin täckningsgrad HELT, och med den säljchefsspärren vid 25 %: en fungerande
  // kontroll som tyst slutar gälla för vissa material. Artikelns m³-pris är densitetsblint men är
  // exakt det talet ytan visade före den här ändringen, alltså aldrig en försämring.
  if (sacks <= 0 || sackPrice == null || !(sackPrice > 0)) return articleBasis;

  return { quantity: sacks, purchasePrice: sackPrice, basis: 'sacks' };
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
  //
  // ⚠️ TOMMA UTKASTRADER OCKSÅ. `createEmptyLineItem()` seedar en rad på varje ny offert och lägger
  // tillbaka en när den sista raderas. Utan filtret hamnade den bland "övriga rader", räknades som
  // oprissatt, och gjorde hela materialsumman okänd — alltså försvann panelen så fort någon tryckte
  // "+ rad". Samma filter som quoteMargin och efterkalkylens laddare redan använder.
  const items = input.items.filter(
    (item) => !item.written_off && (lineItemQuantity(item) > 0 || (Number.isFinite(item.revenue) && item.revenue > 0)),
  );

  let materialCost = 0;
  const missingSackPrice = new Set<string>();
  const unpricedLabels: string[] = [];
  let unpricedRevenue = 0;
  let assessedRevenue = 0;

  let teamHours = 0;
  let hoursComplete = true;
  const missingRates = new Set<string>();
  const missingDensity = new Set<string>();

  // ── En rad som inte går att kostnadsbedöma lämnar BÅDA leden ─────────────
  //
  // ⚠️ Samma disciplin som `quoteMargin`, och det är avsiktligt: de två talen står i SAMMA panel
  // och måste räkna på samma population. Skulle en oprissatt rad i stället göra hela TB okänt hade
  // TB2 stått på "–" på nästan varje riktig offert — 61 av 289 artiklar saknar inköpspris, och en
  // transport- eller etableringsrad utan pris är vardag. En funktion som aldrig visar något är inte
  // försiktig, den är oanvänd.
  //
  // Det motsäger inte efterkalkylens hårdare regel. Där finns ingen delmängd att dra sig tillbaka
  // till: en arbetsorders intäkt är hela orderns, och "vi bedömde 60 % av jobbet" är inget svar.
  // Här FINNS begreppet redan på skärmen, och hur mycket som lämnats utanför skrivs ut.
  const excludeRow = (label: string, revenue: number) => {
    unpricedLabels.push(label);
    unpricedRevenue += revenue;
  };

  for (const item of items) {
    const material = inferMaterialFromArticle(item.article_name)?.short ?? null;
    const construction = constructionOf(item);
    const label = (item.article_name ?? '').trim() || combinationLabel(construction, material) || 'Rad utan artikel';
    const blown = isBlownRow(item);

    // ⚠️ ARBETSRAD UTAN INKÖPSPRIS ÄR BEDÖMD, INTE OBEDÖMBAR — hela intäkten är kvar. Exakt samma
    // undantag som `isCostlessLabor` i quoteMargin gör, och det MÅSTE vara samma: talen står
    // bredvid varandra i panelen.
    if (item.isLabor && item.purchasePrice == null) {
      assessedRevenue += item.revenue;
      continue;
    }

    // EN kostnadsregel för både täckningsgraden och TB — se marginCostBasis.
    const basis = marginCostBasis(item, input.sackPrices);
    if (basis.basis === 'none' || basis.purchasePrice == null) {
      // ⚠️ NOLL SÄCKAR PÅ EN RAD SOM SKA BLÅSAS ÄR INTE NOLL KRONOR. `lineItemSacks` ger 0 när
      // densiteten saknas, och densiteten är fritext som aldrig valideras.
      if (blown && lineItemSacks(item) <= 0) missingDensity.add(label);
      excludeRow(label, item.revenue);
      // ⚠️ EN BORTLYFT LÖSULLSRAD GÖR OCKSÅ TIDEN OKÄND. Raden blåses ju — arbetet finns, vi kan
      // bara inte sätta siffror på det. Utan den här raden visade panelen "0,0 h" på en offert
      // vars enda isolerrad saknade densitet, alltså ett påstående om att jobbet inte tar tid.
      if (blown) hoursComplete = false;
      continue;
    }
    if (blown && basis.basis === 'article' && material) {
      // Räknad på artikelns m³-pris i brist på kostnadsartikel. Talet finns, men det är
      // densitetsblint — och det ska stå i luckelistan, inte tigas ihjäl.
      missingSackPrice.add(material);
    }

    assessedRevenue += item.revenue;
    materialCost += basis.purchasePrice * basis.quantity;

    // ── Tiden: en egen axel ─────────────────────────────────────────────────
    // Bara blåsning tidsätts — modellens produktivitet gäller den, och ett moment vi inte kan
    // tidsätta ska inte tyst tidsättas till noll. En rad kan vara fullt kostnadsbedömd och ändå
    // sakna takt: då är TIMMARNA okända medan materialet är känt, alltså står TB1 kvar och TB2
    // faller.
    if (!blown) continue;
    const rate = construction && material ? rateByKey.get(`${construction}|${material}`) : undefined;
    if (rate == null || !(rate > 0)) {
      hoursComplete = false;
      missingRates.add(combinationLabel(construction, material));
    } else {
      // Volymen, inte säckarna: produktivitetstalen är m³ per timme.
      teamHours += lineItemQuantity(item) / rate;
    }
  }

  if (missingDensity.size > 0) {
    gaps.push({
      kind: 'missing_density',
      message: `${[...missingDensity].join(', ')} saknar densitet — utan den går varken säckantal eller tid att räkna.`,
      labels: [...missingDensity],
    });
  }
  if (missingSackPrice.size > 0) {
    gaps.push({
      kind: 'missing_sack_price',
      message: `Kostnadsartikel saknas för ${[...missingSackPrice].join(', ')} — räknat på artikelns m³-pris, som inte tar hänsyn till densiteten. Sätt artikeln under Inställningar → Kalkyl.`,
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

  // Ingen bedömbar rad alls → ingenting att uttala sig om.
  const resolvedMaterialCost = assessedRevenue > 0 ? materialCost : null;
  const resolvedTeamHours = hoursComplete ? teamHours : null;
  // ⚠️ TEAM-TIMMAR × TEAMSTORLEK = MAN-TIMMAR. Faktorn är hela skillnaden mellan rätt och dubbelt.
  const laborCost =
    resolvedTeamHours != null && laborCostPerHour != null ? resolvedTeamHours * teamSize * laborCostPerHour : null;

  // ⚠️ MOT DEN BEDÖMDA INTÄKTEN, inte mot hela offerten. Rader som lyfts ut ur kostnaden måste
  // lyftas ut ur intäkten också — annars räknas deras pris som ren vinst, och TB blir för högt med
  // exakt deras belopp.
  const tb1 = resolvedMaterialCost != null ? assessedRevenue - resolvedMaterialCost : null;
  const tb2 = tb1 != null && laborCost != null ? tb1 - laborCost : null;

  return {
    revenue: assessedRevenue,
    materialCost: resolvedMaterialCost,
    teamHours: resolvedTeamHours,
    laborCost,
    tb1,
    tb2,
    tg1: tb1 != null && assessedRevenue > 0 ? (tb1 / assessedRevenue) * 100 : null,
    tg2: tb2 != null && assessedRevenue > 0 ? (tb2 / assessedRevenue) * 100 : null,
    gaps,
  };
}

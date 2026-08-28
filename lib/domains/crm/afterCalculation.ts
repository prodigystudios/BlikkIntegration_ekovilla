import { parseDecimal } from '@/lib/shared/number';
import { effectiveSackReports, type SackLedgerRow } from '@/lib/domains/planning/sackLedger';

// Efterkalkyl per arbetsorder — vad jobbet FAKTISKT gav, inte vad vi trodde att det skulle ge.
//
// ── FÖRKALKYL KONTRA EFTERKALKYL ─────────────────────────────────────────────
// quoteMargin() i pricing.ts är en FÖRKALKYL: den räknar TG på offertens rader ur artiklarnas
// inköpspris, innan någon satt en fot på taket. Den här modulen räknar på UTFALL:
//
//   material   ops_segment_reports  — vad som blåstes, i säckar, per material
//   arbete     crm_time_entries     — vad som arbetades, i minuter, per person
//   intäkt     pricing_summary.subtotal
//
//   TB1 = intäkt − materialkostnad
//   TB2 = TB1 − arbetskostnad
//
// Det gör tre av lönsamhetsmodellens svåraste frågor överflödiga: ingen produktivitetstabell (vi
// mäter tiden), ingen snedtaksdelning (vi mäter var det blåstes) och ingen omräkning m³ → säck (vi
// mäter i säckar och kostnadsartikeln är prissatt per säck).
//
// ── ⚠️ MAN-TIMMAR, INTE TEAM-TIMMAR ─────────────────────────────────────────
// Lönsamhetsmodellens 1 300 kr/h är 2 × 650 för ett team om två. `minutes_worked` räknar PER PERSON,
// så rätt multiplikator här är 650 per MAN-timme. Skillnaden är faktor 2 och den syns inte om man
// har fel — allt ser rimligt ut, bara dubbelt eller hälften. Satsen som skickas in ska alltså vara
// per person och timme, och det är också vad crm_calc_settings lagrar.
//
// ── ⚠️ KOSTNADSDATA LAGRAS ALDRIG PÅ RADEN ──────────────────────────────────
// redactWorkOrderForField() skalar bara bort `amount` + `pricing_summary` ur fältets nyttolast —
// `line_items` går ORÖRD ut till installatörens telefon. Därför räknas det här vid visning och
// persisteras aldrig någonstans, precis som pricing.ts aldrig lagrar inköpspriset på offertraden.
//
// ── ⚠️ "EJ RAPPORTERAT" ÄR INTE "0 KR" ──────────────────────────────────────
// Ett jobb utan säckrapport har inte materialkostnad noll — vi VET INTE vad materialet kostade.
// Därför är `materialCost` och `laborCost` nullbara, och TB-talen faller ut som null i stället för
// att visa en glädjekalkyl. Vad som saknas står i `gaps`, som kortet skriver ut ordagrant: det är
// skillnaden mellan "preliminär" och "preliminär för att ingen egenkontroll är inlämnad än".

// ── Indata ───────────────────────────────────────────────────────────────────

/** Rapportrad ur huvudboken. Supersede-regeln körs här inne — skicka in ALLA jobbets rader. */
export type AfterCalculationSackRow = SackLedgerRow & {
  material?: string | null;
};

/**
 * Tidrad ur crm_time_entries.
 *
 * ⚠️ `minutes_worked` ÄR NULL PÅ DE GAMLA KONTORSRADERNA. Kolumnen lades till nullbar utan backfill
 * (20260811_time_entries_reshape.sql) och triggern härleder `hours` UR minuterna, aldrig tvärtom.
 * Kontorets Tid-flik skrev länge bara datum + timmar, så de raderna har timmar men inga minuter.
 * Utan fallbacken blir arbetskostnaden 0 kr på ett jobb med rapporterade timmar — tyst. Samma
 * coalesce som `toSummarizableEntry` och som RPC:n time_approval_overview.
 */
export type AfterCalculationTimeRow = {
  minutes_worked?: number | null;
  hours?: number | string | null;
};

/** Material → kostnadsartikel och dess inköpspris PER SÄCK. */
export type MaterialCostArticle = {
  material: string;
  articleNumber: string;
  /** null när artikeln saknas i cachen eller står utan inköpspris. */
  purchasePrice: number | null;
};

export type AfterCalculationInput = {
  /** Intäkt ex moms. ⚠️ ALLTID `subtotal` — `amount` är brutto inkl. moms. */
  revenue: number | null;
  sackRows: AfterCalculationSackRow[];
  timeRows: AfterCalculationTimeRow[];
  costArticles: MaterialCostArticle[];
  /** Kronor per MAN-timme. null när inställningen saknas. */
  laborCostPerHour: number | null;
};

// ── Utdata ───────────────────────────────────────────────────────────────────

/** Vad som saknas för att kalkylen ska vara fullständig. Kortet skriver ut `message` ordagrant. */
export type AfterCalculationGap =
  | { kind: 'no_revenue'; message: string }
  | { kind: 'no_sack_reports'; message: string }
  | { kind: 'sacks_without_material'; message: string; sacks: number }
  | { kind: 'missing_cost_article'; message: string; materials: string[] }
  | { kind: 'missing_purchase_price'; message: string; materials: string[] }
  | { kind: 'no_time'; message: string }
  | { kind: 'no_labor_rate'; message: string };

/** En materialrad i uppställningen: hur många säckar, till vilket pris, och vad det blev. */
export type MaterialCostLine = {
  /** Kortkoden ur rapporten, eller null för rader vars material inte gick att lösa. */
  material: string | null;
  sacks: number;
  articleNumber: string | null;
  /** Kronor per säck. */
  purchasePrice: number | null;
  /** null när raden inte går att prissätta — då ingår den inte i materialCost. */
  cost: number | null;
};

export type AfterCalculation = {
  revenue: number | null;
  /** Summan av de materialrader som gick att prissätta. null när INGENTING går att prissätta. */
  materialCost: number | null;
  materialLines: MaterialCostLine[];
  /** Man-timmar, summerade över alla personer. null när ingen tid är rapporterad. */
  laborHours: number | null;
  laborCost: number | null;
  laborCostPerHour: number | null;
  tb1: number | null;
  tb2: number | null;
  /** TB1 respektive TB2 i procent av intäkten. */
  tg1: number | null;
  tg2: number | null;
  gaps: AfterCalculationGap[];
  /** true så fort något saknas. Kortet märker sig som preliminärt då. */
  isPreliminary: boolean;
};

// ── Räkningen ────────────────────────────────────────────────────────────────

/** Nyckeln en rapportrad prissätts på. Tom sträng räknas som "inget material", inte som ett namn. */
function materialKey(row: AfterCalculationSackRow): string | null {
  const value = (row.material ?? '').trim();
  return value ? value : null;
}

/**
 * Man-minuter på jobbet.
 *
 * Summerar RÅ MINUTER och delar med 60 först på slutet. Att avrunda per rad hade lagt en halv minut
 * fel per tidrad, och ett jobb med tjugo rader hade dragit i väg mätbart — samma skäl som modellens
 * eget exempel landar 5 kr fel när den avrundar per steg.
 */
function sumWorkedMinutes(rows: AfterCalculationTimeRow[]): number {
  let minutes = 0;
  for (const row of rows) {
    if (row.minutes_worked != null && Number.isFinite(Number(row.minutes_worked))) {
      minutes += Number(row.minutes_worked);
      continue;
    }
    // Fallbacken för de gamla kontorsraderna — se AfterCalculationTimeRow.
    const hours = parseDecimal(row.hours as string | number | null | undefined, 0);
    if (hours > 0) minutes += hours * 60;
  }
  return minutes;
}

export function calculateAfterCalculation(input: AfterCalculationInput): AfterCalculation {
  const gaps: AfterCalculationGap[] = [];

  // ── Intäkt ────────────────────────────────────────────────────────────────
  const revenue = input.revenue != null && Number.isFinite(input.revenue) && input.revenue > 0 ? input.revenue : null;
  if (revenue == null) {
    gaps.push({ kind: 'no_revenue', message: 'Ordern saknar summering — intäkten går inte att läsa.' });
  }

  // ── Material ──────────────────────────────────────────────────────────────
  // Supersede-regeln körs via effectiveSackReports och reimplementeras ALDRIG här: finns en final
  // är den jobbets sanning, annars summan av partial. Två kopior av regeln blir förr eller senare
  // två olika svar på samma fråga.
  const effective = effectiveSackReports(input.sackRows);

  const priceByMaterial = new Map<string, MaterialCostArticle>();
  for (const article of input.costArticles) priceByMaterial.set(article.material, article);

  // Säckarna slås ihop per material innan de prissätts. En egenkontroll skriver en final-rad PER
  // ETAPPRAD (en per placering), så samma material dyker normalt upp flera gånger — utan
  // hopslagningen hade uppställningen visat "EKOVILLA" tre gånger med samma pris.
  const sacksByMaterial = new Map<string | null, number>();
  for (const row of effective) {
    const sacks = Number(row.sacks_blown ?? 0);
    if (!Number.isFinite(sacks) || sacks === 0) continue;
    const key = materialKey(row);
    sacksByMaterial.set(key, (sacksByMaterial.get(key) ?? 0) + sacks);
  }

  const materialLines: MaterialCostLine[] = [];
  const missingArticle: string[] = [];
  const missingPrice: string[] = [];
  let pricedCost = 0;
  let pricedLines = 0;
  let sacksWithoutMaterial = 0;

  // Namngivna material först i katalogordning de kom in, materiallösa rader sist.
  const orderedKeys = [...sacksByMaterial.keys()].sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b, 'sv');
  });

  for (const key of orderedKeys) {
    const sacks = sacksByMaterial.get(key) ?? 0;
    if (key === null) {
      // Rapporten bär inga material — egenkontrollen kunde inte lösa etappradens artikelnamn.
      // Säckarna RÄKNAS i huvudboken (de blåstes ju) men går inte att prissätta.
      sacksWithoutMaterial += sacks;
      materialLines.push({ material: null, sacks, articleNumber: null, purchasePrice: null, cost: null });
      continue;
    }

    const article = priceByMaterial.get(key);
    if (!article) {
      missingArticle.push(key);
      materialLines.push({ material: key, sacks, articleNumber: null, purchasePrice: null, cost: null });
      continue;
    }
    if (article.purchasePrice == null || !Number.isFinite(article.purchasePrice) || article.purchasePrice <= 0) {
      missingPrice.push(key);
      materialLines.push({ material: key, sacks, articleNumber: article.articleNumber, purchasePrice: null, cost: null });
      continue;
    }

    // ⚠️ PRISET ÄR PER SÄCK. Rapporten är redan i säckar, så det här är hela omräkningen — ingen
    // densitet, ingen m³, ingen konkurrerande avrundning. Se kostnadsartiklarnas migrering.
    const cost = sacks * article.purchasePrice;
    pricedCost += cost;
    pricedLines += 1;
    materialLines.push({
      material: key,
      sacks,
      articleNumber: article.articleNumber,
      purchasePrice: article.purchasePrice,
      cost,
    });
  }

  if (effective.length === 0) {
    // ⚠️ Ingen rapport betyder INTE noll säckar. Ett tal här hade sett ut som ett fullt jobb utan
    // materialåtgång, vilket är den mest optimistiska siffra kalkylen kan visa.
    gaps.push({
      kind: 'no_sack_reports',
      message: 'Inga säckar är rapporterade på jobbet än — materialkostnaden är okänd, inte noll.',
    });
  }
  if (sacksWithoutMaterial > 0) {
    gaps.push({
      kind: 'sacks_without_material',
      message: `${sacksWithoutMaterial} rapporterade säckar saknar material och kan inte prissättas.`,
      sacks: sacksWithoutMaterial,
    });
  }
  if (missingArticle.length > 0) {
    gaps.push({
      kind: 'missing_cost_article',
      message: `Kostnadsartikel saknas för ${missingArticle.join(', ')} — sätt den under Inställningar → Kalkyl.`,
      materials: missingArticle,
    });
  }
  if (missingPrice.length > 0) {
    gaps.push({
      kind: 'missing_purchase_price',
      message: `Kostnadsartikeln för ${missingPrice.join(', ')} saknar inköpspris i Fortnox.`,
      materials: missingPrice,
    });
  }

  // Noll prissatta rader ger null, inte 0 kr — samma skäl som "ej rapporterat" ovan.
  const materialCost = pricedLines > 0 ? pricedCost : null;

  // ── Arbete ────────────────────────────────────────────────────────────────
  const workedMinutes = sumWorkedMinutes(input.timeRows);
  const laborHours = workedMinutes > 0 ? workedMinutes / 60 : null;
  const laborCostPerHour =
    input.laborCostPerHour != null && Number.isFinite(input.laborCostPerHour) && input.laborCostPerHour > 0
      ? input.laborCostPerHour
      : null;

  if (laborHours == null) {
    gaps.push({
      kind: 'no_time',
      message: 'Ingen tid är rapporterad på jobbet än — arbetskostnaden är okänd, inte noll.',
    });
  }
  if (laborCostPerHour == null) {
    gaps.push({
      kind: 'no_labor_rate',
      message: 'Timkostnaden är inte satt — sätt den under Inställningar → Kalkyl.',
    });
  }

  const laborCost = laborHours != null && laborCostPerHour != null ? laborHours * laborCostPerHour : null;

  // ── TB och TG ─────────────────────────────────────────────────────────────
  const tb1 = revenue != null && materialCost != null ? revenue - materialCost : null;
  const tb2 = tb1 != null && laborCost != null ? tb1 - laborCost : null;
  const tg1 = tb1 != null && revenue != null && revenue > 0 ? (tb1 / revenue) * 100 : null;
  const tg2 = tb2 != null && revenue != null && revenue > 0 ? (tb2 / revenue) * 100 : null;

  return {
    revenue,
    materialCost,
    materialLines,
    laborHours,
    laborCost,
    laborCostPerHour,
    tb1,
    tb2,
    tg1,
    tg2,
    gaps,
    isPreliminary: gaps.length > 0,
  };
}

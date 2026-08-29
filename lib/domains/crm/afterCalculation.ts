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

/**
 * En såld rad som INTE rapporteras i säckar — skivor, duk, brandmatta, etablering.
 *
 * ⚠️ UTAN DEN HÄR HALVAN ÄR TB SYSTEMATISKT FÖR HÖGT. Säckrapporten täcker bara lösullen; allt
 * annat vi säljer bidrar med intäkt och noll kostnad. Belagt på order #13 (2026-08-28): fyra paket
 * EKOVILLA LEVY 30MM såldes för 2 309 kr med ett inköpspris på 499,89 kr/pkt — 1 999 kr verklig
 * kostnad som föll utanför. TB2 gick från +1 655 kr till −345 kr när den räknades med, alltså från
 * vinst till förlust.
 *
 * För de här raderna finns ingen mätning att göra och behöver ingen: antalet vi sålde ÄR antalet
 * som gick åt. Priset kommer ur artikelns `purchase_price`, precis som offertens TG hämtar det.
 */
export type OtherMaterialRow = {
  /** Artikelnamnet, för uppställningen. */
  label: string;
  articleNumber: string | null;
  quantity: number;
  /**
   * Inköpspris per enhet.
   *
   * ⚠️ 0 OCH null BETYDER OLIKA SAKER HÄR, till skillnad från `hasPurchasePrice` i pricing.ts som
   * slår ihop dem. 0 är ett SVAR: Etableringskostnad (1010) har inköpspris 0 i Fortnox och kostar
   * oss faktiskt ingenting. null är okunskap: artikeln saknas i cachen eller har aldrig prissatts.
   *
   * Skillnaden är inte akademisk. Slogs de ihop hade varje order med en etableringsrad — alltså
   * praktiskt taget alla — flaggats som preliminär, och en flagga som alltid lyser slutar läsas.
   * Priset att betala är att en artikel någon glömt prissätta räknas som gratis; det är samma
   * risk offerten redan bär, och den syns i artikelregistret.
   */
  purchasePrice: number | null;
  /** Radens intäkt — bara för att kunna säga hur stor del av ordern som inte gick att bedöma. */
  revenue: number;
};

export type AfterCalculationInput = {
  /** Intäkt ex moms. ⚠️ ALLTID `subtotal` — `amount` är brutto inkl. moms. */
  revenue: number | null;
  sackRows: AfterCalculationSackRow[];
  timeRows: AfterCalculationTimeRow[];
  costArticles: MaterialCostArticle[];
  /** Sålda rader som inte täcks av säckrapporten. Se OtherMaterialRow. */
  otherMaterialRows: OtherMaterialRow[];
  /**
   * Ordern säljer lösull som ska blåsas, alltså VÄNTAR vi oss en säckrapport.
   *
   * ⚠️ Utan den här frågan blir "inga säckar rapporterade" en lucka även på en ren tjänsteorder —
   * en etableringsrad utan lösull ska inte kräva en egenkontroll som aldrig kommer.
   *
   * Standard är `true`, alltså den försiktiga sidan: en anropare som inte vet ska få luckan, inte
   * slippa den. Det är kostnaden som saknas när det är fel, och den riktningen får aldrig vara den
   * tysta.
   */
  hasBlownInsulationRows?: boolean;
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
  | { kind: 'unpriced_rows'; message: string; revenue: number; labels: string[] }
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

/** En såld rad utanför säckrapporten, prissatt. */
export type OtherMaterialCostLine = {
  label: string;
  articleNumber: string | null;
  quantity: number;
  purchasePrice: number | null;
  /** null när artikeln saknar inköpspris — då ingår raden inte i materialCost. */
  cost: number | null;
};

export type AfterCalculation = {
  revenue: number | null;
  /** Summan av allt som gick att prissätta: säckarna PLUS raderna utanför dem. */
  materialCost: number | null;
  materialLines: MaterialCostLine[];
  /** Raderna som inte rapporteras i säckar. Tom när ordern bara säljer lösull. */
  otherMaterialLines: OtherMaterialCostLine[];
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
  /**
   * Materialkostnaden är räknad, men något gick inte att prissätta — alltså är TB1 (och därmed TB2)
   * FÖR HÖGT med ett okänt belopp.
   *
   * ⚠️ Skild från `isPreliminary`, som också är sann när bara TIDEN saknas. Den skillnaden är hela
   * skälet till att flaggan finns: ett jobb utan rapporterad tid har ett EXAKT TB1 — det är bara
   * TB2 som inte går att räkna — och att märka TB1 som osäker där hade gjort märkningen till brus.
   * Ytor som visar TB1 utanför kortets luckelista (snabböversikten) behöver just den här frågan,
   * inte den bredare.
   */
  materialCostIsPartial: boolean;
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
    if (!Number.isFinite(sacks)) continue;
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
    const article = key === null ? undefined : priceByMaterial.get(key);

    // ⚠️ NOLL RAPPORTERADE SÄCKAR ÄR ETT SVAR, INTE EN AVSAKNAD. Delrapportens schema tillåter 0
    // med flit — "vi var här, inget gick åt" är ett påstående om jobbet, till skillnad från att
    // inte rapportera alls. Kostnaden är då 0 kr med SÄKERHET, oavsett material och prislapp, och
    // raden ska därför varken kräva en kostnadsartikel eller märka kalkylen som preliminär.
    // Utan den här grenen föll ett nollrapporterat jobb igenom: ingen materialrad, ingen lucka,
    // och ett kort som visade "–" utan att säga varför.
    if (sacks === 0) {
      pricedLines += 1;
      materialLines.push({
        material: key,
        sacks: 0,
        articleNumber: article?.articleNumber ?? null,
        purchasePrice: article?.purchasePrice ?? null,
        cost: 0,
      });
      continue;
    }

    if (key === null) {
      // Rapporten bär inga material — egenkontrollen kunde inte lösa etappradens artikelnamn.
      // Säckarna RÄKNAS i huvudboken (de blåstes ju) men går inte att prissätta.
      sacksWithoutMaterial += sacks;
      materialLines.push({ material: null, sacks, articleNumber: null, purchasePrice: null, cost: null });
      continue;
    }

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

  // Bara en order som faktiskt säljer lösull väntar sig en säckrapport. En ren tjänsteorder ska
  // inte stå och sakna en egenkontroll som aldrig kommer.
  const missingSackReports = effective.length === 0 && (input.hasBlownInsulationRows ?? true);
  if (missingSackReports) {
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

  // ── Sålda rader utanför säckrapporten ────────────────────────────────────
  // Skivor, duk, brandmatta, etablering. Antalet vi sålde är antalet som gick åt — det finns
  // ingen mätning att invänta. Se OtherMaterialRow för varför halvan är nödvändig.
  const otherMaterialLines: OtherMaterialCostLine[] = [];
  const unpricedLabels: string[] = [];
  let unpricedRevenue = 0;

  for (const row of input.otherMaterialRows) {
    const price = row.purchasePrice;
    if (price == null || !Number.isFinite(price) || price < 0) {
      // Okänt, inte gratis. Raden hålls utanför kostnaden och redovisas i stället — samma
      // disciplin som quoteMargin: att räkna en oprissatt rad som kostnadsfri hade blåst upp TB.
      unpricedLabels.push(row.label);
      unpricedRevenue += row.revenue;
      otherMaterialLines.push({ ...row, cost: null });
      continue;
    }
    const cost = price * row.quantity;
    pricedCost += cost;
    pricedLines += 1;
    otherMaterialLines.push({ ...row, cost });
  }

  if (unpricedLabels.length > 0) {
    gaps.push({
      kind: 'unpriced_rows',
      message: `${unpricedLabels.join(', ')} saknar inköpspris i Fortnox — ${Math.round(unpricedRevenue).toLocaleString('sv-SE')} kr av intäkten är inte bedömd.`,
      revenue: unpricedRevenue,
      labels: unpricedLabels,
    });
  }

  // Noll prissatta rader ger null, inte 0 kr — samma skäl som "ej rapporterat" ovan.
  const materialCost = pricedLines > 0 ? pricedCost : null;

  // Något gick inte att prissätta men något annat gjorde det: summan finns, men den är för låg och
  // TB alltså för högt. Se materialCostIsPartial.
  //
  // ⚠️ `missingSackReports` MÅSTE vara med. En etableringsrad med inköpspris 0 finns på i princip
  // varje order, och den ensam räcker för att materialCost ska bli 0 i stället för null. Ett
  // pågående jobb med rapporterad tid men utan inlämnad egenkontroll fick då ett omärkt "TG2 85 %"
  // i listan — med HELA lösullskostnaden oräknad — samtidigt som kortet på ordern skrev ut att
  // materialkostnaden är okänd. Två ytor, två olika svar på samma fråga.
  const materialCostIsPartial =
    materialCost != null
    && (missingSackReports
      || sacksWithoutMaterial > 0
      || missingArticle.length > 0
      || missingPrice.length > 0
      || unpricedLabels.length > 0);

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
    otherMaterialLines,
    laborHours,
    laborCost,
    laborCostPerHour,
    tb1,
    tb2,
    tg1,
    tg2,
    gaps,
    isPreliminary: gaps.length > 0,
    materialCostIsPartial,
  };
}

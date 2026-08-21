import { parseDecimal } from '@/lib/shared/number';
import { lineItemQuantity } from './lineItems';

// Shared CRM line-item pricing. Single source of truth so the quote form, the work
// order article editor, the server recompute, and the Fortnox row builder never
// diverge. Price source matches buildOrderRows/buildOfferRows: explicit `unit_price`
// when set, otherwise the chosen article's `article_price`.
//
// ⚠️ INGEN YTA FÅR RÄKNA FRAM ETT EGET PRIS. Offertformuläret gjorde det till 2026-08-20 med en
// stub (`computeUnitPrice`) som gav artikellösa rader 900 kr/m³ oavsett konstruktion och tjocklek,
// medan den här modulen gav samma rad 0. Följden: säljaren såg ett pris som aldrig nådde
// Fortnox-dokumentet, säljtavlan och rapporterna räknade 900 medan arbetsordern och planeringen
// räknade 0, och en ROT-offert tappade hela sitt avdragsunderlag (Price 0 → carve 0 → ingen
// "Arbetskostnad ROT"-rad). En rad utan prisförankring ska SYNAS, inte gissas —
// `isUnpricedLineItem` i lineItems.ts spärrar den vid sparning och vid push.

export type PricingLineItem = {
  pricing_mode?: string | null;
  m2?: string | null;
  thickness_mm?: string | null;
  quantity?: string | null;
  unit_price?: string | null;
  article_price?: number | null;
  discount_percent?: string | null;
  is_rot_work?: boolean | null;
  // Labour carved out of a material row for ROT, as kr PER UNIT ex VAT — an à-pris like
  // `unit_price`, multiplied by the quantity. Summed onto a single "Arbetskostnad ROT" row at
  // Fortnox-push time; here it only feeds the ROT deduction base. See splitRowLabor.
  labor_cost?: string | null;
};

export type RotPricingInput = {
  enabled?: boolean | null;
  rot_percent?: number | string | null;
  max_deduction?: number | string | null;
};

export type PricingSummary = {
  subtotal: number;
  vat: number;
  total: number;
  vatPercent: number;
  rotDeduction: number;
  toPay: number;
};

// Raw per-unit price: the explicit override when set, else the article's catalogue price.
export function lineItemUnitPrice(item: Pick<PricingLineItem, 'unit_price' | 'article_price'>): number {
  const explicit = item.unit_price != null && String(item.unit_price).trim() !== '';
  return explicit ? parseDecimal(item.unit_price) : (item.article_price ?? 0);
}

// Discount percentage, clamped to [0,100].
export function lineItemDiscountPercent(item: Pick<PricingLineItem, 'discount_percent'>): number {
  return Math.min(100, Math.max(0, parseDecimal(item.discount_percent)));
}

// Unit price after discount (never negative). The SINGLE source of truth for every per-row money
// calculation — line totals, recorded invoice-round amounts, the Fortnox row price basis, and the
// UI breakdowns all derive from this, so the figure can never drift between them.
export function lineItemEffectiveUnitPrice(
  item: Pick<PricingLineItem, 'unit_price' | 'article_price' | 'discount_percent'>,
): number {
  return Math.max(0, lineItemUnitPrice(item) * (1 - lineItemDiscountPercent(item) / 100));
}

// Row total = effective quantity (m³ volume or entered amount) × discounted unit price.
export function lineItemRowTotal(item: PricingLineItem): number {
  return Math.max(0, lineItemQuantity(item) * lineItemEffectiveUnitPrice(item));
}

export type RowLaborSplit = {
  /** Arbetskostnad per enhet efter kapning mot A-priset. */
  perUnit: number;
  /** Radens arbetskostnad i kronor: per enhet × antal, med radens rabatt. */
  labor: number;
  /** Det som blir kvar av radens pris som material. */
  material: number;
  /** Hela radens pris efter rabatt — arbete + material. */
  rowTotal: number;
  /**
   * Arbetskostnaden lämnar inget material kvar (den är minst lika stor som A-priset). Då bryts
   * INGEN arbetskostnad ut — se kommentaren på splitRowLabor om varför det är den säkra riktningen.
   */
  leavesNoMaterial: boolean;
};

/**
 * Hur "Varav arbetskostnad (ROT)" delar en rads pris.
 *
 * ⚠️ BELOPPET ÄR ETT À-PRIS, precis som A-priset: kr per m³ (eller per styck), och det räknas mot
 * antalet. Rättat 2026-08-19 efter en riktig bugg — fältet lästes förut som ett klumpbelopp för
 * hela raden, så 500 kr arbete gav 500 kr oavsett om raden var 10 m³ eller 30 m³. ROT-avdraget
 * frös alltså vid samma krontal hur stort jobbet än blev.
 *
 * ⚠️ Fältet är fortfarande en UTBRYTNING, inte ett tillägg. Det höjer aldrig radpriset — det säger
 * hur stor del av A-priset som är arbete. A-pris 500 kr/m³ med 200 kr/m³ arbete är en rad på
 * 500 kr/m³, varav 200 är arbete och 300 material.
 *
 * Rabatten träffar båda delarna lika. Rabatteras jobbet 10 % sjunker den fakturerade
 * arbetskostnaden lika mycket, och ROT får bara begäras på det som faktiskt debiteras.
 *
 * ⚠️ EN ARBETSKOSTNAD SOM ÄTER HELA A-PRISET BRYTER UT NOLL, inte allt. På en MATERIALrad är det
 * alltid ett fel att arbetet är hela priset — då skickas ett Fortnox-dokument som begär ROT på
 * material, vilket inte är tillåtet. Två verkliga vägar dit, båda tysta före den här spärren:
 *
 *   • en rad sparad under den gamla klumpbeloppstolkningen (8000 mot ett A-pris på 200), och
 *   • att A-priset satts till bara materialdelen och arbetet skrivits som ett PÅSLAG (250 + 250),
 *     vilket är en annan modell än den här funktionen räknar efter.
 *
 * Båda är datafel, inte instruktioner att bryta ut allt. Det säkra svaret är att inte bryta ut
 * något och låta felet synas: offertformuläret spärrar sparningen och pekar ut raden. Vill man
 * verkligen att hela raden ska vara arbete finns kryssrutan "ROT-arbete", som säger det uttryckligen.
 */
export function splitRowLabor(input: {
  laborCostPerUnit: string | number | null | undefined;
  /** A-pris per enhet FÖRE rabatt — samma tal som säljaren ser i A-prisfältet. */
  unitPrice: number;
  discountPercent: number;
  quantity: number;
}): RowLaborSplit {
  const unitPrice = Math.max(0, input.unitPrice);
  const entered = Math.max(0, parseDecimal(input.laborCostPerUnit));
  const leavesNoMaterial = entered > 0 && entered >= unitPrice;
  const perUnit = leavesNoMaterial ? 0 : entered;
  const quantity = Math.max(0, input.quantity);
  const keep = 1 - Math.min(100, Math.max(0, input.discountPercent)) / 100;
  const labor = perUnit * keep * quantity;
  const rowTotal = unitPrice * keep * quantity;
  return { perUnit, labor, material: Math.max(0, rowTotal - labor), rowTotal, leavesNoMaterial };
}

/**
 * Radens utbrutna ROT-arbetskostnad i kronor, härledd ur raden själv.
 *
 * Offertformuläret anropar `splitRowLabor` direkt med de tal det redan räknat fram i stället för
 * att gå via den här. Det är inte längre nödvändigt — sedan 900-stubben togs bort prissätter
 * formuläret via `lineItemUnitPrice` precis som alla andra ytor, så båda vägarna ger samma svar.
 * Skulle någon slå ihop dem: kontrollera att `unitPrice` fortfarande är à-priset FÖRE rabatt, som
 * `splitRowLabor` kräver.
 */
export function lineItemRotLabor(item: PricingLineItem): number {
  return splitRowLabor({
    laborCostPerUnit: item.labor_cost,
    unitPrice: lineItemUnitPrice(item),
    discountPercent: lineItemDiscountPercent(item),
    quantity: lineItemQuantity(item),
  }).labor;
}

export function computePricing(
  items: PricingLineItem[],
  vatPercentInput: number | string | null,
  opts?: { isPrivate?: boolean; rot?: RotPricingInput | null },
): PricingSummary {
  const subtotal = Math.max(0, items.reduce((sum, item) => sum + lineItemRowTotal(item), 0));
  const vatPercent = parseDecimal(vatPercentInput, 25);
  const vat = Math.max(0, subtotal * (vatPercent / 100));
  const total = subtotal + vat;

  // ROT (private only): tax-reduction % of the husarbete rows' amount INCL VAT, capped at
  // the max deduction, floored to whole krona (matches Fortnox/Skatteverket — see quotes).
  // The ROT base is labour: a row flagged fully as ROT work contributes its whole total, while an
  // unflagged material row contributes only its carved-out labour (labor_cost per unit × quantity).
  // Mirrors the Fortnox push, where the same split becomes the single "Arbetskostnad ROT" row plus
  // the fully-flagged rows' husarbete flags.
  const rotActive = Boolean(opts?.isPrivate && opts?.rot?.enabled);
  const rotBaseInclVat = rotActive
    ? items.reduce((sum, i) => {
        const rowTotal = lineItemRowTotal(i);
        const labourBase = i.is_rot_work ? rowTotal : Math.min(lineItemRotLabor(i), rowTotal);
        return sum + labourBase * (1 + vatPercent / 100);
      }, 0)
    : 0;
  const rotPercent = parseDecimal(opts?.rot?.rot_percent ?? 30, 30);
  const maxDeduction = parseDecimal(opts?.rot?.max_deduction ?? 50000, 50000);
  const rotDeduction = rotActive ? Math.min(maxDeduction, Math.floor(rotBaseInclVat * (rotPercent / 100))) : 0;

  return { subtotal, vat, total, vatPercent, rotDeduction, toPay: total - rotDeduction };
}

// ─── Momsbas: nettot ur ett lagrat bruttobelopp ────────────────────────────────
//
// `crm_quotes.amount` och `crm_work_orders.amount` är `computePricing(...).total`, alltså
// subtotal + moms. Att summera det fältet blandar TVÅ OLIKA SORTERS KRONOR: en byggmomsorder
// (omvänd skattskyldighet, vat_percent = 0) räknas ex moms medan en privatkundsorder räknas inkl
// 25 %. Rapporteringen gjorde det till 2026-08-21 och blåste upp offertvärdet med 924 432 kr av
// 6 130 106 kr (+17,8 %) och ordervärdet med 263 814 kr av 1 723 702 kr (+18,1 %) — och eftersom
// påslaget bara träffade de momspliktiga raderna fick en säljare som sålde till privatkunder 25 %
// gratis mot en som sålde till byggföretag. Topplistan rankade på kundmix, inte på prestation.
//
// Moms är inte försäljning, den är uppburen åt staten. Varje krontal som redovisas som
// försäljning ska vara netto. Funktionen bor här hos `computePricing`, som skapade bruttot —
// den som vänder talet tillbaka hör hemma bredvid den som räknade fram det.

/**
 * Den lagrade prissammanställningen. `total` läses inte för sitt eget värde utan för att avgöra om
 * sammanställningen alls hör ihop med radens `amount` — se netAmount.
 */
export type StoredPricingSummary = { subtotal?: number | string | null; total?: number | string | null } | null;

/** Det en rad behöver bära för att kunna redovisas ex moms. */
export type NetAmountRow = {
  amount: number | string | null;
  vat_percent?: number | string | null;
  pricing_summary?: StoredPricingSummary;
};

/** Momssatsen `computePricing` antar när fältet saknas — samma default som räknade fram `amount`. */
const DEFAULT_VAT_PERCENT = 25;

/** Ören: `total` och `amount` skrivs från samma objekt, så allt över detta är verklig oenighet. */
const AMOUNT_TOLERANCE = 0.5;

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/** Talet, eller null om fältet saknas eller inte är ett tal — till skillnad från toNumber, som gör 0 av skräp. */
function toFinite(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}

/**
 * Radens belopp EXKLUSIVE moms.
 *
 * `pricing_summary.subtotal` är nettot som faktiskt räknades fram när raden sparades och är därför
 * förstahandskällan — verifierat mot drift 2026-08-21: `subtotal + vat === amount` på var och en
 * av de 117 offert- och 52 orderraderna. Saknas den (en enda orderrad idag, med amount 0) räknas
 * nettot fram ur `amount` och `vat_percent`, vilket gav exakt samma svar på samtliga rader vid
 * samma mätning.
 *
 * Härledningen använder samma default som `computePricing` — det var den momssatsen som skapade
 * `amount` från början, så det är den som vänder talet rätt igen.
 */
export function netAmount(row: NetAmountRow): number {
  const gross = toNumber(row.amount);
  const ps = row.pricing_summary;

  // Sammanställningen godtas bara när den beskriver SAMMA belopp som `amount`. Ett blankt
  // `{ subtotal: 0, vat: 0, total: 0 }` bredvid ett riktigt `amount` är en platshållare, inte ett
  // netto på noll: quotes-schemat defaultar varje fält till 0 (`pricingSummarySchema`), så en
  // offert sparad utan pricing_summary får en nollsummering och ett belopp som inte är noll. Utan
  // det här villkoret hade den redovisats som 0 kr överallt — en tyst nolla, den värsta sorten.
  // Systerfunktionen resolveQuoteVatBreakdown vaktar samma sak genom att kräva subtotal OCH total.
  if (ps != null) {
    const subtotal = toFinite(ps.subtotal);
    const total = toFinite(ps.total);
    if (subtotal != null && total != null && Math.abs(total - gross) <= AMOUNT_TOLERANCE) return subtotal;
  }

  const vatPercent = row.vat_percent != null && String(row.vat_percent).trim() !== ''
    ? toNumber(row.vat_percent)
    : DEFAULT_VAT_PERCENT;
  // En negativ eller orimlig momssats får aldrig blåsa upp talet; då är bruttot det ärligaste svaret.
  if (!(vatPercent > 0)) return gross;
  return gross / (1 + vatPercent / 100);
}

// ─── Täckningsgrad (TG) ────────────────────────────────────────────────────────
//
// TG = (pris − inköpspris) ÷ PRIS. Det är måttet säljchefen bett om, och det som brukar menas med
// "procentuell vinst". Blanda ALDRIG ihop det med påslag ((pris − inköp) ÷ inköp): köp för 100 och
// sälj för 200 är 50 % TG men 100 % påslag, och tröskelvärdena nedan är satta för TG.
//
// ⚠️ INKÖPSPRISET LAGRAS INTE PÅ OFFERTRADEN. Det slås upp ur artikelcachen bara för att räkna i
// offertformuläret. Skälet: `line_items` följer med offert → arbetsorder → fältvyn, och
// `redactWorkOrderForField` plockar bara bort `amount`/`pricing_summary` — ett inköpspris på raden
// hade alltså hamnat i installatörernas payload. Genom att aldrig lägga det där finns ingen läckyta
// att komma ihåg att täta.

/** Hur en rads TG bedöms. `unknown` = artikeln saknar inköpspris, då går det inte att uttala sig. */
export type MarginTier = 'good' | 'watch' | 'bad' | 'unknown';

/**
 * SÄLJCHEFENS TRÖSKLAR, satta 2026-08-14: under 25 % rött, 25–40 % gult, över 40 % grönt.
 *
 * Ersätter de preliminära (50/35) som var gissade kring registrets median. De styr en färg säljare
 * litar på — ändra dem HÄR och ingen annanstans.
 */
export const MARGIN_THRESHOLDS = {
  /** TG ÖVER detta = grönt. Exakt värdet är gult — se marginTier. */
  good: 40,
  /** TG under detta = rött. Från och med detta upp till `good` = gult. */
  watch: 25,
} as const;

/**
 * En rad att räkna täckningsgrad på.
 *
 * ⚠️ `revenue` SKICKAS IN, den härleds inte här: anroparen skickar SAMMA belopp som visas för
 * raden på skärmen, så TG:n och Delsumman inte kan glida isär. Regeln kom ur en tyst bugg — när
 * offertformuläret prissatte med sin egen 900-stub bidrog en artikellös rad med 0 kr till TG:n men
 * syntes i Delsumman, och eftersom den då hade noll intäkt flaggades den inte ens som obedömd.
 * Säljaren såg en grön TG som ignorerade nästan hela offerten.
 *
 * Stubben är borta, men kravet står kvar: intäkten som bedöms måste vara den som visas.
 */
export type MarginRow = {
  /** Radens intäkt i kronor, rabatt inräknad — exakt det belopp som visas för raden. */
  revenue: number;
  /** Antalet raden fakturerar (m³-volym eller styck), för att multiplicera inköpspriset. */
  quantity: number;
  /** Inköpspris per enhet ur artikelregistret, eller null när det saknas. */
  purchasePrice: number | null | undefined;
  /**
   * Raden ÄR arbete (offertens "ROT-arbete"-kryss), inte material.
   *
   * ⚠️ AFFÄRSREGEL, beslutad av William 2026-08-19: arbete har ingen INKÖPSKOSTNAD. TG mäts här mot
   * inköpspris ur artikelregistret, och arbete köps inte in — dess kostnad är lön, som registret
   * inte bär. En arbetsrad utan inköpspris räknas därför som full TG i stället för att lyftas ut
   * som obedömd.
   *
   * Skälet till att det behövdes: en ROT-offert bryter ut arbetet, och en utesluten arbetsrad drog
   * ner den sammanvägda siffran hårt — 100 000 kr material mot 80 000 kr inköp plus 50 000 kr
   * arbete visades som 20 % när den sanna blandade TG:n är 46,7 %.
   *
   * ⚠️ Gäller BARA när inköpspriset saknas. Har artikeln ett inköpspris räknas det som vanligt —
   * annars hade en materialartikel som råkat kryssas som ROT-arbete tappat hela sin kostnad.
   * Materialrader utan inköpspris lyfts fortfarande ut; att räkna DEM som kostnadsfria är just den
   * farligt optimistiska siffran som quoteMargin finns för att undvika.
   *
   * ⚠️ Den utbrutna arbetskostnaden ("Varav arbetskostnad (ROT, kr)") behöver INGENTING här. Den
   * bryts ut ur radpriset utan att ändra radtotalen — intäkten innehåller den alltså redan, medan
   * kostnaden bara är materialets. Den delen får med andra ord full TG av sig själv. Se testet
   * "den utbrutna arbetskostnaden ändrar inte TG:n".
   */
  isLabor?: boolean;
};

function hasPurchasePrice(purchasePrice: number | null | undefined): purchasePrice is number {
  return purchasePrice != null && Number.isFinite(purchasePrice) && purchasePrice > 0;
}

// En arbetsrad utan inköpspris: intäkt utan kostnad. Se MarginRow.isLabor.
function isCostlessLabor(row: MarginRow): boolean {
  return Boolean(row.isLabor) && !hasPurchasePrice(row.purchasePrice);
}

/**
 * Radens täckningsgrad i procent, eller null när den inte går att räkna.
 *
 * Returnerar null när inköpspriset saknas (61 av 289 artiklar) eller när raden inte har någon
 * intäkt. Noll intäkt ger ingen meningsfull procent, och att visa "0 %" eller "−100 %" på en tom
 * rad hade fått nya rader att lysa rött innan säljaren ens skrivit något.
 */
export function rowMarginPercent(row: MarginRow): number | null {
  if (!(row.revenue > 0)) return null;
  // Arbete utan inköpspris är hela intäkten i behåll. Inget antal krävs: kostnaden är noll oavsett
  // hur raden råkar vara prissatt (timme, styck eller klumpsumma).
  if (isCostlessLabor(row)) return 100;
  if (!hasPurchasePrice(row.purchasePrice)) return null;
  if (!(row.quantity > 0)) return null;
  const cost = row.purchasePrice * row.quantity;
  return ((row.revenue - cost) / row.revenue) * 100;
}

/**
 * Färgnivån för en TG. `null` (okänt inköpspris) ger `unknown` — inte rött.
 *
 * ⚠️ GRÄNSERNA LÄSES SOM SÄLJCHEFEN SKREV DEM: under 25 rött, 25–40 gult, ÖVER 40 grönt. Exakt
 * 40,0 % är alltså GULT, inte grönt — `good` är exklusiv medan `watch` är inklusiv.
 *
 * Asymmetrin är inte slarv och skillnaden inte teoretisk: 1 000 kr intäkt mot 600 kr inköp ger
 * exakt 40,0 %, och runda priser är just vad säljare skriver. Tidigare var båda gränserna
 * inklusiva, vilket hade gjort den offerten grön mot beskedet.
 */
export function marginTier(
  marginPercent: number | null | undefined,
  thresholds: { good: number; watch: number } = MARGIN_THRESHOLDS,
): MarginTier {
  if (marginPercent == null || !Number.isFinite(marginPercent)) return 'unknown';
  if (marginPercent < thresholds.watch) return 'bad';
  if (marginPercent > thresholds.good) return 'good';
  return 'watch';
}

/**
 * Offertens samlade TG över de rader som går att räkna på.
 *
 * Summerar intäkt och kostnad var för sig i stället för att medelvärdesbilda radernas procent — ett
 * ovägt snitt låter en 5-kronorsrad väga lika tungt som en 50 000-kronorsrad och ger fel svar på
 * frågan "tjänar vi pengar på den här offerten".
 *
 * Rader utan inköpspris hålls UTANFÖR båda summorna. Att räkna dem som kostnadsfria hade blåst upp
 * TG:n och gjort siffran farligt optimistisk; `unpricedRevenue` säger i stället hur stor del av
 * offerten som inte kunde bedömas. Det gäller ÄVEN en rad med ett handskrivet A-pris och ingen vald
 * artikel — den har en intäkt på skärmen men inget inköpspris, och utan den här raden hade den
 * försvunnit spårlöst.
 */
export function quoteMargin(rows: MarginRow[]): {
  marginPercent: number | null;
  revenue: number;
  cost: number;
  unpricedRows: number;
  unpricedRevenue: number;
} {
  let revenue = 0;
  let cost = 0;
  let unpricedRows = 0;
  let unpricedRevenue = 0;

  for (const row of rows) {
    // Arbetsrader utan inköpspris räknas in med noll kostnad — de är bedömda, inte obedömbara.
    if (isCostlessLabor(row)) {
      if (row.revenue > 0) revenue += row.revenue;
      continue;
    }
    if (!hasPurchasePrice(row.purchasePrice) || !(row.quantity > 0)) {
      if (row.revenue > 0) { unpricedRows++; unpricedRevenue += row.revenue; }
      continue;
    }
    revenue += row.revenue;
    cost += row.purchasePrice * row.quantity;
  }

  return {
    marginPercent: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
    revenue,
    cost,
    unpricedRows,
    unpricedRevenue,
  };
}

// ─── VAT display convention (agreed with finance) ──────────────────────────────
// How a quote's amount is presented to the seller / customer differs by customer type:
//   • private customer  → lead with the price to pay INCL moms (what they actually pay)
//   • business customer → lead with the price EX moms, with the moms shown alongside
// The figures themselves come from the stored pricing_summary, which is always
// {subtotal: ex moms, vat, total: incl moms} in both the line-item and manual-amount
// save paths — so display is unambiguous even though the scalar `amount` is not.

export type QuoteVatBreakdown = { subtotal: number; vat: number; total: number; vatPercent: number };

// Resolve a quote's VAT breakdown for display. Prefers the stored pricing_summary;
// for legacy rows that predate it, derives from the scalar amount + vat%, treating
// `amount` as the incl-moms total (the line-item path's meaning, the common case).
export function resolveQuoteVatBreakdown(input: {
  pricing_summary?: { subtotal?: number; vat?: number; total?: number } | null;
  amount?: number | string | null;
  vat_percent?: number | string | null;
}): QuoteVatBreakdown {
  const vatPercent = parseDecimal(input.vat_percent, 25);
  const ps = input.pricing_summary;
  const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (ps && isNum(ps.subtotal) && isNum(ps.total)) {
    const vat = isNum(ps.vat) ? ps.vat : ps.total - ps.subtotal;
    return { subtotal: ps.subtotal, vat, total: ps.total, vatPercent };
  }
  // Legacy fallback: treat the scalar amount as the incl-moms total and split out moms.
  const total = parseDecimal(input.amount, 0);
  const subtotal = vatPercent > 0 ? total / (1 + vatPercent / 100) : total;
  return { subtotal, vat: total - subtotal, total, vatPercent };
}

export type QuoteAmountDisplay = {
  isPrivate: boolean;
  reverseCharge: boolean; // omvänd skattskyldighet (byggmoms): business customer billed at 0 % VAT
  primary: number;      // the headline figure for this customer type
  primaryLabel: string; // label for the headline ('Att betala inkl. moms' | 'Belopp ex moms')
  basisSuffix: string;  // compact basis tag for list rows ('inkl. moms' | 'ex moms')
} & QuoteVatBreakdown;

// Apply the display convention to a resolved breakdown. Pure — the caller formats the
// numbers (locale/currency) so this stays unit-testable and UI-agnostic.
//
// Reverse charge (omvänd skattskyldighet / byggmoms) = a business quote at 0 % VAT: the buyer
// accounts for the VAT, so we lead with the ex-moms amount and label it explicitly rather than
// showing a plain "0 % moms" that reads like a waiver.
export function quoteAmountDisplay(
  quoteType: 'private' | 'business',
  breakdown: QuoteVatBreakdown,
): QuoteAmountDisplay {
  const isPrivate = quoteType === 'private';
  const reverseCharge = !isPrivate && breakdown.vatPercent === 0;
  return {
    ...breakdown,
    isPrivate,
    reverseCharge,
    primary: isPrivate ? breakdown.total : breakdown.subtotal,
    primaryLabel: isPrivate ? 'Att betala inkl. moms' : reverseCharge ? 'Belopp (omvänd skattskyldighet)' : 'Belopp ex moms',
    basisSuffix: isPrivate ? 'inkl. moms' : reverseCharge ? 'omvänd skattskyldighet' : 'ex moms',
  };
}

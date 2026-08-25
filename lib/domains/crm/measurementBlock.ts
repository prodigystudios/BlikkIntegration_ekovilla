// Måttblocket i arbetsbeskrivningen — hur artikelradernas mått blir text för installatören.
//
// Bor i domänlagret, inte i en av featuremapparna, för att BÅDA ytorna som äger rader behöver
// det: offertformuläret (där blocket fylls i automatiskt medan raderna skrivs) och
// arbetsordern (där artiklar rättas i efterhand och beskrivningen måste kunna hämtas om).
// Rent och sidoeffektfritt, så det kan unit-testas och importeras från klientkomponenter.

import { parseDecimal } from '@/lib/shared/number';
import { constructionLabel, inferConstructionFromArticle } from './constructions';
import { inferMaterialFromArticle, lineItemSacks, MATERIAL_SHORTS } from './materials';

export type MeasurementLineItem = {
  construction?: string | null;
  article_name?: string | null;
  m2?: string | null;
  thickness_mm?: string | null;
  pricing_mode?: string | null;
  density?: string | null;
  // Antals- och meterrader (`pricing_mode: 'item'`) — brandmatta, sarg runt lucka. De har inga
  // mått och hamnar därför i en egen ÖVRIGT-grupp sist, inte bland måttraderna.
  quantity?: string | null;
  article_unit_name?: string | null;
  line_note?: string | null;
  /**
   * Ska raden stå i arbetsbeskrivningen? Gäller BARA antals-/meterrader; ytorna är själva jobbet
   * och följer alltid med.
   *
   * ⚠️ Saknat värde betyder NEJ, och får aldrig tolkas som "läs artikelns standard". Rader sparade
   * före flaggan fanns saknar den, och skulle de plockas in ändrades utdatan för varje befintlig
   * offert — vilket låser blocket, se `adoptExistingMeasurementBlock`. Standarden ur
   * artikelregistret läses därför bara när raden SKAPAS och persisteras på raden.
   */
  include_in_description?: boolean | null;
};

/**
 * Rubriken över antals-/meterraderna. Exporterad för att den är en del av det format `isBlockLine`
 * känner igen — den som ändrar strängen måste ändra båda.
 */
export const EXTRAS_HEADING = 'ÖVRIGT';

function isExtraRow(it: MeasurementLineItem): boolean {
  return it.include_in_description === true && (it.pricing_mode ?? 'm3') === 'item';
}

// "Brandmatta – 4 st". Samma anatomi som måttraden (namn – mängd) så blocket läses som en enhet.
//
// Raden måste kunna kännas igen av `isExtrasLine` igen efteråt, annars blir den en föräldralös
// rest vid nästa omgenerering. Därför: etiketten plattas till en rad, enheten skrivs bara ut när
// den är ett enkelt token, och rader utan namn eller utan positiv mängd hoppas över helt
// (en "0 st"-rad är inget arbetsmoment).
function buildExtraRow(it: MeasurementLineItem): string | null {
  const label = (it.article_name || it.line_note || '').replace(/\s+/g, ' ').trim();
  const quantity = (it.quantity ?? '').trim();
  if (!label || parseDecimal(quantity) <= 0) return null;
  const unit = (it.article_unit_name ?? '').trim();
  const row = EXTRAS_UNIT_RE.test(unit) ? `${label} – ${quantity} ${unit}` : `${label} – ${quantity}`;
  // Sista utvägen: skulle etiketten ändå ge en oigenkännlig rad (konstiga tecken, ett tankstreck
  // mitt i namnet som gör slutet tvetydigt) är det bättre att utelämna raden än att lämna skräp
  // som staplas. Byggare och igenkännare får aldrig glida isär.
  return isExtrasLine(row) ? row : null;
}

// Build "Vägg – 100 m² × 200 mm" lines for the m³-priced rows that have both an area
// and a thickness. When the seller has entered a density AND the material's bag weight
// can be resolved from the article, the sack count is appended:
// "Vägg – 100 m² × 200 mm @ 45 kg/m³ – 53 säck". Fills the work description automatically
// as soon as a row carries measurements (and via the "Hämta mått från rader" button).
//
// Antals- och meterrader som säljaren valt in (`include_in_description`) hamnar sist under
// rubriken ÖVRIGT: "Brandmatta – 4 st". De har inga mått och ingår inte i säckberäkningen.
/**
 * `inferConstruction` — härled placeringen ur artikelnamnet när raden saknar `construction`.
 *
 * ⚠️ OPT-IN, och offertformuläret får ALDRIG skicka den. `adoptExistingMeasurementBlock` där
 * jämför den sparade texten BYTE FÖR BYTE mot `buildMeasurementLines(...)`
 * (`handoffNotes.startsWith(block)`). Ändras etiketten matchar en redan sparad offert inte
 * längre sitt eget block: den öppnas med blocket LÅST och fryst på inaktuella mått, med
 * motiveringen att säljaren redigerat dem. Precis det låset finns för att förhindra.
 *
 * Arbetsordern har ingen sådan ägarskapskontroll — `regenerateMeasurementBlock` bygger alltid om
 * från grunden — och kan därför byta etikett riskfritt.
 */
export type MeasurementBlockOptions = { inferConstruction?: boolean };

export function buildMeasurementLines(items: MeasurementLineItem[], options: MeasurementBlockOptions = {}): string[] {
  const qualifying = items.filter(
    (it) => (it.pricing_mode ?? 'm3') !== 'item' && (it.m2 ?? '').trim() !== '' && (it.thickness_mm ?? '').trim() !== '',
  );
  // Antals-/meterrader som säljaren valt in. Byggs här uppe så tomma rader (utan namn eller
  // mängd) faller bort innan vi avgör om blocket blir tomt.
  const extraRows = items.filter(isExtraRow).map(buildExtraRow).filter((row): row is string => row !== null);
  if (qualifying.length === 0 && extraRows.length === 0) return [];

  // Group rows under their material's short headline (e.g. "EKOVILLA"); rows whose
  // material can't be resolved fall in an unlabelled group. Sum sacks for the total.
  const groups: Array<{ heading: string; rows: string[] }> = [];
  let totalSacks = 0;

  for (const it of qualifying) {
    // Etikettkedjan, i fallande tillförlitlighet:
    //   1. Radens lagrade konstruktion. Offertformuläret sätter den när en artikel väljs ur
    //      Fortnox (samma härledning som steg 2, körd en gång och sparad). Den vinner alltid —
    //      artikelnamnet kan ha ändrats sedan dess.
    //   2. Härledd ur artikelnamnet, NÄR ANROPAREN BER OM DET. Rader som lagts till direkt på
    //      arbetsordern saknar konstruktion, och blocket skrev då ut hela artikelnamnet:
    //      "EKOVILLA cellulosa 0,038W/mK vägg – 162 m² × 190 mm @ 52 kg/m³ – 115 säck".
    //      Installatören ska läsa VAR den ska blåsas, inte artikelregistret.
    //   3. Artikelnamnet rått. Sista utvägen när namnet inte avslöjar någon placering.
    const label =
      constructionLabel(it.construction)
      || (options.inferConstruction ? constructionLabel(inferConstructionFromArticle(it.article_name)) : '')
      || it.article_name
      || '';
    const dims = `${(it.m2 ?? '').trim()} m² × ${(it.thickness_mm ?? '').trim()} mm`;
    let row = label ? `${label} – ${dims}` : dims;

    const material = inferMaterialFromArticle(it.article_name);
    const sacks = lineItemSacks(it);
    if (sacks > 0) {
      row += ` @ ${(it.density ?? '').trim()} kg/m³ – ${sacks} säck`;
      totalSacks += sacks;
    }

    const heading = material?.short ?? '';
    const group = groups.find((g) => g.heading === heading);
    if (group) group.rows.push(row);
    else groups.push({ heading, rows: [row] });
  }

  const lines: string[] = [];
  groups.forEach((g, idx) => {
    if (idx > 0) lines.push('');
    if (g.heading) lines.push(g.heading);
    lines.push(...g.rows);
  });
  if (totalSacks > 0) lines.push('', `Totalt: ${totalSacks} säck`);

  // ÖVRIGT läggs SIST, efter säcksumman. Dels läser det bättre (ytorna är jobbet, tillbehören
  // kommer efter), dels låter det städningens tomrads-lookahead nå rubriken utan att `Totalt`
  // byter plats i redan sparad text.
  if (extraRows.length) {
    if (lines.length) lines.push('');
    lines.push(EXTRAS_HEADING, ...extraRows);
  }
  return lines;
}

// En måttrad är omisskännlig ("100 m² × 200 mm") — inget en säljare råkar skriva i löptext.
// Används för att avgöra om en LADDAD arbetsbeskrivning redan bär ett block vi inte känner
// igen (säljaren har redigerat det), så automatiken kan hålla sig undan i stället för att
// lägga en dubblett ovanpå.
// ⚠️ Tål en vilsen enhet mellan talet och m². Måttfälten var fritext, och en skarp rad hade
// "162m" i m²-fältet — den genererade raden blev då "… – 162m m² × 190 mm …". Utan `m?` matchade
// mönstret inte, raden räknades inte som en måttrad, och städningen lämnade den kvar: ett
// INAKTUELLT mått under det nyss omgenererade blocket. Skräpet i datan gjorde alltså städaren
// blind för precis den rad som mest behövde städas bort.
//
// Nya rader kan inte få formen (måttfälten normaliseras vid blur, se normalizeDecimalInput), men
// texten som redan skrivits ligger kvar i arbetsbeskrivningarna och fixar inte sig själv.
//
// ⚠️ Enheten måste följas av BLANKSTEG (`m\s+`), annars fångas `mm²` — kabelarea, en enhet som
// faktiskt förekommer i en byggtext: "Dra kabel 2,5 mm² × 3 till fläkten" hade räknats som en
// måttrad, låst offertformulärets automatik och blivit uppäten av städningen.
const MEASUREMENT_LINE_RE = /\d\s*(?:m\s+)?m²\s*×\s*\d/;
const TOTAL_LINE_RE = /^Totalt: \d+ säck$/;

/**
 * En ÖVRIGT-rad: "Brandmatta – 4 st" — namn, tankstreck, mängd, valfri enhet.
 *
 * ⚠️ Mönstret är MEDVETET inte tillräckligt för att ensamt döma ut en rad som genererad.
 * "Portkod – 1234" har exakt samma form, och en säljare skriver sådant. Därför räknas en rad som
 * ÖVRIGT-rad bara när scanningen står INUTI en ÖVRIGT-körning (se `stripOneMeasurementRun`).
 * Måttraden klarar sig utan den ankringen eftersom "100 m² × 200 mm" inte är något man råkar
 * skriva; det här är det inte.
 *
 * Tankstrecket är en-dash (U+2013), samma som måttraden använder — löptext bär bindestreck.
 */
const EXTRAS_LINE_RE = /^\S.* – (?:0[.,]\d+|[1-9]\d{0,5}(?:[.,]\d+)?)(?: \p{L}[\p{L}\d²³/.]{0,9})?$/u;

/**
 * Enheten i en ÖVRIGT-rad. BYGGAREN OCH IGENKÄNNAREN DELAR MÖNSTER MED FLIT.
 *
 * 🧨 `article_unit_name` kommer från Fortnox enhetsregister och kan vara vad som helst — "löpande
 * meter" med blanksteg i. Hade byggaren skrivit ut den men igenkännaren krävt ett ensamt token
 * hade raden blivit en föräldralös rest vid varje omgenerering: städningen ser den inte, det nya
 * blocket läggs ovanpå. Enheten skrivs därför bara ut när den matchar det HÄR mönstret.
 */
const EXTRAS_UNIT_RE = /^\p{L}[\p{L}\d²³/.]{0,9}$/u;

function isExtrasLine(line: string): boolean {
  const value = line.trim();
  // ⚠️ Måttraden vinner. "Vägg – 100 m² × 200 mm @ 45 kg/m³ – 65 säck" matchar EXTRAS_LINE_RE via
  // sitt ANDRA tankstreck ("… – 65 säck"), och utan den här företrädesregeln blev en säckrad
  // tvetydigt klassad. Ingen girighetsjustering i mönstret hjälper — ordningen måste avgöra.
  return !isMeasurementLine(value) && EXTRAS_LINE_RE.test(value);
}

// Rubriken räknas bara när den följs av en ÖVRIGT-rad — samma regel som materialrubrikerna, och
// av samma skäl: ordet "ÖVRIGT" ensamt i säljarens egen text får inte dra med sig raden under.
function isExtrasHeadingLine(lines: string[], i: number): boolean {
  return lines[i].trim() === EXTRAS_HEADING
    && i + 1 < lines.length && isExtrasLine(lines[i + 1]);
}

export function hasMeasurementBlock(notes: string): boolean {
  // ⚠️ Måste känna igen ÖVRIGT också. En offert med BARA antalsrader har inget "m² ×" alls, och
  // utan det här hade låset aldrig slagit till: automatiken hade skrivit över säljarens egen
  // redigering av beskrivningen vid varje radändring.
  if (MEASUREMENT_LINE_RE.test(notes)) return true;
  const lines = notes.split('\n');
  return lines.some((_, i) => isExtrasHeadingLine(lines, i));
}

/**
 * Bygg blocket från grunden: plocka bort ett befintligt block och lägg det nya överst, med
 * texten som skrivits omkring det kvar.
 *
 * För ytor UTAN automatik — arbetsordern, där artiklar rättas i efterhand och det inte finns
 * något "senast insatta block" att jämföra mot. Ett klick betyder alltid "hämta om måtten",
 * så det finns inget ägarskap att ta hänsyn till.
 */
export function regenerateMeasurementBlock(notes: string, nextBlock: string): string {
  return prependBlock(stripMeasurementBlock(notes), nextBlock);
}

function isMeasurementLine(line: string): boolean {
  return MEASUREMENT_LINE_RE.test(line);
}

// En materialrubrik måste vara ETT AV DE KÄNDA materialnamnen och stå direkt ovanför en
// måttrad. Regeln "vilken rad som helst som följs av en måttrad" såg rimlig ut men raderade
// säljarens egen text: "Porten är låst" på raden ovanför blocket åts upp som rubrik.
function isHeadingLine(lines: string[], i: number): boolean {
  return MATERIAL_SHORTS.includes(lines[i].trim())
    && i + 1 < lines.length && isMeasurementLine(lines[i + 1]);
}

function isBlockLine(lines: string[], i: number): boolean {
  const line = lines[i].trim();
  if (line === '') return false; // tomrader avgörs av vad som kommer efter dem
  return isMeasurementLine(line) || TOTAL_LINE_RE.test(line) || isHeadingLine(lines, i);
}

/**
 * Plocka bort måttblocket ur texten, även när det inte matchar exakt det vi la dit sist
 * (någon har redigerat i det).
 *
 * Blocket söks VAR SOM HELST i texten, inte bara först. På arbetsordern skriver kontoret ofta
 * en rad överst ("OBS! Ring Kalle") — letade vi bara i position 0 blev det gamla blocket
 * kvar under det nya, och installatören fick två uppsättningar mått med den inaktuella sist.
 *
 * Strukturen matchar exakt vad `buildMeasurementLines` producerar: måttrader,
 * "Totalt: N säck", materialrubriker, ÖVRIGT-rubriken med sina rader, samt tomrader som har fler
 * blockrader efter sig. Allt annat är någons egen text och lämnas orört.
 */
export function stripMeasurementBlock(notes: string): string {
  // ⚠️ EN KÖRNING RÄCKER INTE. Städningen nedan stannar vid första raden som inte hör till
  // blocket — med flit, så att säljarens egen text inte äts upp. Men ett block som är UPPDELAT
  // av egen text mellan måttraderna får då bara sin första del borttagen:
  //
  //     Huset:                         ← egen rad, stoppar städningen
  //     Vägg – 162 m² × 190 mm …       ← tas bort
  //     Vind – 100 m² × 500 mm …       ← tas bort
  //     Garage:                        ← egen rad, STOPP
  //     Vägg – 67,5 m² × 145 mm …      ← BLEV KVAR
  //     Totalt: 451 säck               ← BLEV KVAR
  //
  // Det nya blocket lades sedan ovanpå, och installatören fick två uppsättningar mått med den
  // INAKTUELLA sist — exakt felet den här funktionen finns för att förhindra. Verkligt fall:
  // arbetsorder #56, vars beskrivning grupperats i "Huset:" och "Garage:" för hand.
  //
  // ⚠️ EFTERFÖLJANDE VARV KRÄVER BEVIS. "Vi tar varje körning av måttrader" var för glupskt: en
  // säljare skriver mått i löptext — "OBS: garaget mättes till 30 m² × 100 mm på plats, ring
  // Kalle" — och andra varvet åt upp den raden. Första varvet gör det inte, för det stoppas av
  // prosan ovanför; det är alltså just omkörningen som är farlig.
  //
  // Beviset är något bara den GENERERADE texten har: en "Totalt: N säck"-rad eller en
  // materialrubrik. En lös mening om mått bär ingetdera och lämnas därför i fred.
  //
  // Loopen har ett tak; utan det hade en bugg i strykningen kunnat snurra.
  let out = stripOneMeasurementRun(notes);
  for (let pass = 0; pass < 20; pass += 1) {
    const next = stripOneMeasurementRun(out, { requireBlockEvidence: true });
    if (next === out) break;
    out = next;
  }
  return out;
}

function stripOneMeasurementRun(notes: string, opts: { requireBlockEvidence?: boolean } = {}): string {
  const lines = notes.split('\n');
  // ⚠️ Starten måste kunna vara ÖVRIGT-rubriken också. En offert med bara antalsrader har ingen
  // måttrad alls, och med enbart `findIndex(isMeasurementLine)` blev svaret -1: blocket städades
  // aldrig, och varje omgenerering la ett nytt ovanpå det gamla.
  const first = lines.findIndex((_, i) => isMeasurementLine(lines[i]) || isExtrasHeadingLine(lines, i));
  if (first === -1) return notes;

  // Bakåt: ta med materialrubriken direkt ovanför måttraden.
  const start = first > 0 && isHeadingLine(lines, first - 1) ? first - 1 : first;

  // Framåt: blockrader, och tomrader som följs av fler blockrader (blocket har egna tomrader
  // mellan materialgrupperna och före "Totalt"). Första raden som inte hör till blocket stoppar.
  let end = first;
  let i = first;
  // ÖVRIGT-rader känns igen bara INUTI sin egen körning — se EXTRAS_LINE_RE. En tomrad avslutar
  // körningen, och eftersom `prependBlock` alltid lägger en tomrad mellan blocket och säljarens
  // egen text kan prosa med samma form ("Portkod – 1234") inte råka hamna innanför.
  let inExtras = isExtrasHeadingLine(lines, first);
  while (i < lines.length) {
    if (isExtrasHeadingLine(lines, i)) { inExtras = true; i += 1; end = i; continue; }
    if (inExtras && isExtrasLine(lines[i])) { i += 1; end = i; continue; }
    if (isBlockLine(lines, i)) { i += 1; end = i; continue; }
    if (lines[i].trim() === '') {
      let j = i;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      if (j < lines.length && (isBlockLine(lines, j) || isExtrasHeadingLine(lines, j))) { inExtras = false; i = j; continue; }
    }
    break;
  }

  // Se loopens kommentar: en omkörning får bara ta bort text som bevisligen är genererad.
  // ÖVRIGT-rubriken duger som bevis av samma skäl som materialrubriken: den skrivs bara av oss.
  if (opts.requireBlockEvidence) {
    const removed = lines.slice(start, end);
    const looksGenerated = removed.some(
      (line, i) => TOTAL_LINE_RE.test(line.trim()) || isHeadingLine(removed, i) || isExtrasHeadingLine(removed, i),
    );
    if (!looksGenerated) return notes;
  }

  const before = lines.slice(0, start).join('\n').replace(/\s+$/, '');
  const after = lines.slice(end).join('\n').replace(/^\s+/, '');
  if (!before) return after;
  if (!after) return before;
  return `${before}\n\n${after}`;
}

function prependBlock(rest: string, nextBlock: string): string {
  if (!nextBlock) return rest.trim() ? rest : '';
  return rest.trim() ? `${nextBlock}\n\n${rest}` : nextBlock;
}

/**
 * Lägg måttblocket överst i arbetsbeskrivningen och behåll säljarens egen text under.
 *
 * Blocket är MASKINÄGT: det fylls i automatiskt så snart en artikelrad har mått, och byts ut
 * när måtten ändras. Därför måste exakt det block vi själva la dit sist (`prevBlock`) plockas
 * bort först — annars staplas en ny kopia varje gång ett mått justeras.
 *
 * Känner vi inte igen `prevBlock` i texten har säljaren redigerat den. Då returneras `null` =
 * "rör inget": automatiken backar och lämnar över ägarskapet. Knappen kör med `force`, plockar
 * bort det redigerade blocket strukturellt och skriver ett färskt — det är hela poängen med ett
 * uttryckligt klick, och enda vägen tillbaka när automatiken lämnat över.
 *
 * ⚠️ `force` måste städa ÄVEN när `prevBlock` är tomt. Just den kombinationen är läget efter att
 * automatiken lämnat över ägarskapet (ingen referens sparad, låset satt), alltså precis när
 * knappen är enda vägen tillbaka — och utan städningen la den ett nytt block ovanpå det gamla
 * och gjorde de inaktuella måtten permanenta.
 *
 * Tomt `nextBlock` (måtten har raderats från raderna) tar bort blocket i stället för att lämna
 * kvar en inaktuell uppgift som installatören annars bygger efter.
 */
export function replaceMeasurementBlock(
  notes: string,
  prevBlock: string,
  nextBlock: string,
  options: { force?: boolean } = {},
): string | null {
  // Blocket måste sluta där en rad slutar. Enbart `startsWith` räcker inte: har säljaren
  // skrivit till på blockets SISTA rad ("… × 200 mm (mätt på plats)") matchar prefixet
  // ändå, och tillägget hade blivit hängande kvar som lös text när blocket byttes ut.
  const ownsBlock = prevBlock !== '' && (notes === prevBlock || notes.startsWith(`${prevBlock}\n`));

  if (ownsBlock) {
    return prependBlock(notes.slice(prevBlock.length).replace(/^\n+/, ''), nextBlock);
  }
  if (options.force) {
    return prependBlock(stripMeasurementBlock(notes), nextBlock);
  }
  // Ingen referens sparad än → första insättningen, lägg blocket överst.
  if (!prevBlock) return prependBlock(notes, nextBlock);
  return null;
}

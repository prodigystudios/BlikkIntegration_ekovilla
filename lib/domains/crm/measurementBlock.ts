// Måttblocket i arbetsbeskrivningen — hur artikelradernas mått blir text för installatören.
//
// Bor i domänlagret, inte i en av featuremapparna, för att BÅDA ytorna som äger rader behöver
// det: offertformuläret (där blocket fylls i automatiskt medan raderna skrivs) och
// arbetsordern (där artiklar rättas i efterhand och beskrivningen måste kunna hämtas om).
// Rent och sidoeffektfritt, så det kan unit-testas och importeras från klientkomponenter.

import { inferMaterialFromArticle, lineItemSacks, MATERIAL_SHORTS } from './materials';

const CONSTRUCTION_LABELS: Record<string, string> = { vagg: 'Vägg', snedtak: 'Snedtak', vind: 'Vind' };

export type MeasurementLineItem = {
  construction?: string | null;
  article_name?: string | null;
  m2?: string | null;
  thickness_mm?: string | null;
  pricing_mode?: string | null;
  density?: string | null;
};

// Build "Vägg – 100 m² × 200 mm" lines for the m³-priced rows that have both an area
// and a thickness. When the seller has entered a density AND the material's bag weight
// can be resolved from the article, the sack count is appended:
// "Vägg – 100 m² × 200 mm @ 45 kg/m³ – 53 säck". Fills the work description automatically
// as soon as a row carries measurements (and via the "Hämta mått från rader" button).
export function buildMeasurementLines(items: MeasurementLineItem[]): string[] {
  const qualifying = items.filter(
    (it) => (it.pricing_mode ?? 'm3') !== 'item' && (it.m2 ?? '').trim() !== '' && (it.thickness_mm ?? '').trim() !== '',
  );
  if (qualifying.length === 0) return [];

  // Group rows under their material's short headline (e.g. "EKOVILLA"); rows whose
  // material can't be resolved fall in an unlabelled group. Sum sacks for the total.
  const groups: Array<{ heading: string; rows: string[] }> = [];
  let totalSacks = 0;

  for (const it of qualifying) {
    const label = CONSTRUCTION_LABELS[it.construction ?? ''] || it.article_name || '';
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
  return lines;
}

// En måttrad är omisskännlig ("100 m² × 200 mm") — inget en säljare råkar skriva i löptext.
// Används för att avgöra om en LADDAD arbetsbeskrivning redan bär ett block vi inte känner
// igen (säljaren har redigerat det), så automatiken kan hålla sig undan i stället för att
// lägga en dubblett ovanpå.
const MEASUREMENT_LINE_RE = /\d\s*m²\s*×\s*\d/;
const TOTAL_LINE_RE = /^Totalt: \d+ säck$/;

export function hasMeasurementBlock(notes: string): boolean {
  return MEASUREMENT_LINE_RE.test(notes);
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
 * "Totalt: N säck", materialrubriker, samt tomrader som har fler blockrader efter sig.
 * Allt annat är någons egen text och lämnas orört.
 */
export function stripMeasurementBlock(notes: string): string {
  const lines = notes.split('\n');
  const first = lines.findIndex(isMeasurementLine);
  if (first === -1) return notes;

  // Bakåt: ta med materialrubriken direkt ovanför måttraden.
  const start = first > 0 && isHeadingLine(lines, first - 1) ? first - 1 : first;

  // Framåt: blockrader, och tomrader som följs av fler blockrader (blocket har egna tomrader
  // mellan materialgrupperna och före "Totalt"). Första raden som inte hör till blocket stoppar.
  let end = first;
  let i = first;
  while (i < lines.length) {
    if (isBlockLine(lines, i)) { i += 1; end = i; continue; }
    if (lines[i].trim() === '') {
      let j = i;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      if (j < lines.length && isBlockLine(lines, j)) { i = j; continue; }
    }
    break;
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

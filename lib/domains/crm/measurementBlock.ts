// Måttblocket i arbetsbeskrivningen — hur artikelradernas mått blir text för installatören.
//
// Bor i domänlagret, inte i en av featuremapparna, för att BÅDA ytorna som äger rader behöver
// det: offertformuläret (där blocket fylls i automatiskt medan raderna skrivs) och
// arbetsordern (där artiklar rättas i efterhand och beskrivningen måste kunna hämtas om).
// Rent och sidoeffektfritt, så det kan unit-testas och importeras från klientkomponenter.

import { inferMaterialFromArticle, lineItemSacks } from './materials';

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
 * Plocka bort ett måttblock som ligger först i texten, även när det inte matchar exakt det vi
 * la dit sist (säljaren har redigerat i det).
 *
 * Behövs för knappen: den är enda vägen tillbaka när automatiken lämnat över ägarskapet, och
 * utan en strukturell borttagning staplade den ett nytt block ovanpå det redigerade — två
 * uppsättningar mått i samma arbetsbeskrivning, den inaktuella underst.
 *
 * Strukturen matchar exakt vad `buildMeasurementLines` producerar: tomma rader, måttrader,
 * "Totalt: N säck", och materialrubriker. En rubrik är i sig bara ett ord och går inte att
 * känna igen ensam — den godtas därför bara när NÄSTA rad är en måttrad, vilket är den enda
 * plats en rubrik kan stå.
 */
/**
 * Bygg blocket från grunden: plocka bort ett befintligt block strukturellt och lägg det nya
 * överst, med säljarens egen text kvar under.
 *
 * För ytor UTAN automatik — arbetsordern, där artiklar rättas i efterhand och det inte finns
 * något "senast insatta block" att jämföra mot. Ett klick betyder alltid "hämta om måtten",
 * så det finns inget ägarskap att ta hänsyn till.
 */
export function regenerateMeasurementBlock(notes: string, nextBlock: string): string {
  const rest = stripLeadingMeasurementBlock(notes);
  if (!nextBlock) return rest.trim() ? rest : '';
  return rest.trim() ? `${nextBlock}\n\n${rest}` : nextBlock;
}

export function stripLeadingMeasurementBlock(notes: string): string {
  const lines = notes.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const isBlank = line === '';
    const isMeasurement = MEASUREMENT_LINE_RE.test(line);
    const isTotal = TOTAL_LINE_RE.test(line);
    const isHeading = !isBlank && !isMeasurement && !isTotal
      && i + 1 < lines.length && MEASUREMENT_LINE_RE.test(lines[i + 1]);
    if (!isBlank && !isMeasurement && !isTotal && !isHeading) break;
    i += 1;
  }
  // Inget block hittat → lämna texten orörd (annars äts en inledande tomrad utan anledning).
  if (i === 0) return notes;
  return lines.slice(i).join('\n').replace(/^\n+/, '');
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
 * Tomt `nextBlock` (måtten har raderats från raderna) tar bort blocket i stället för att lämna
 * kvar en inaktuell uppgift som installatören annars bygger efter.
 */
export function replaceMeasurementBlock(
  notes: string,
  prevBlock: string,
  nextBlock: string,
  options: { force?: boolean } = {},
): string | null {
  let rest = notes;
  if (prevBlock) {
    // Blocket måste sluta där en rad slutar. Enbart `startsWith` räcker inte: har säljaren
    // skrivit till på blockets SISTA rad ("… × 200 mm (mätt på plats)") matchar prefixet
    // ändå, och tillägget hade blivit hängande kvar som lös text när blocket byttes ut.
    const ownsBlock = notes === prevBlock || notes.startsWith(`${prevBlock}\n`);
    if (ownsBlock) {
      rest = notes.slice(prevBlock.length).replace(/^\n+/, '');
    } else if (options.force) {
      // Blocket är redigerat — ta bort det strukturellt, annars hamnar det nya ovanpå det
      // gamla och arbetsbeskrivningen bär två uppsättningar mått.
      rest = stripLeadingMeasurementBlock(notes);
    } else {
      return null;
    }
  }
  if (!nextBlock) return rest.trim() ? rest : '';
  return rest.trim() ? `${nextBlock}\n\n${rest}` : nextBlock;
}

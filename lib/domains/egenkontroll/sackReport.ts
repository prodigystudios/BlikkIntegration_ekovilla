// Egenkontrollen → huvudboken. Dörr 1 i säckrapporteringen.
//
// Egenkontrollen är jobbets FULLA sanning: "projektet klart, detta gick totalt åt". Dess rader
// skrivs som `final` i ops_segment_reports, och supersede-regeln
// (lib/domains/planning/sackLedger.ts) låter dem släcka jobbets delrapporter i stället för att
// adderas ovanpå dem.
//
// ⛔ FORMULÄRET RÖRS INTE. Det här är en ren översättning av rader installatören redan fyllt i.
// Ingen förifyllning ändras, inget fält läggs till i UI:t, ingen validering skärps. Installatören
// ansvarar för att siffran stämmer — det är processens ansvar, medvetet.
//
// Bakgrund: före det här nådde en CRM-orders säckar ALDRIG fram. Den strukturerade skrivningen i
// app/egenkontroll/page.tsx är villkorad på `blikkProjectId`, så ett CRM-jobb fick bara
// fritextkommentaren "Antal säckar: N" — prosa ingen fråga kan läsa.

import { constructionFromLabel, isConstructionSlug, type ConstructionSlug } from '@/lib/domains/crm/constructions';
import { parseDecimal } from '@/lib/shared/number';
import { MATERIALS } from '@/lib/domains/crm/materials';
import type { EtappClosedRow, EtappOpenRow } from './calculations';

export type FinalSackEntry = {
  /** null = "Ospecificerad". Ett giltigt svar; egenkontrollen har ingen placeringsväljare. */
  construction: ConstructionSlug | null;
  sacks_blown: number;
  material: string | null;
};

/**
 * Egenkontrollens material → depåns materialidentitet.
 *
 * ⚠️ `materialUsed` ÄR EN NYCKEL I `MATERIALS` ("Ekovilla Cellulosa Lösull CE ETA-09/0081"), INTE
 * en `short`. Skrivs nyckeln rakt in i huvudboken hamnar den där som ett material depån aldrig sett
 * en leverans av: `computeDepotBalances` matchar på exakt sträng mot
 * `ops_depot_deliveries.material`, så leverans och förbrukning skulle aldrig mötas och saldot stå
 * kvar för högt utan att något felar.
 *
 * null när materialet inte går att slå upp — då faller depåavdraget tillbaka på det som härleds ur
 * orderns artikelrader, precis som före säckrapporteringen.
 */
export function materialShortFromEgenkontroll(materialUsed: string | null | undefined): string | null {
  const key = (materialUsed ?? '').trim();
  return key ? MATERIALS[key]?.short ?? null : null;
}

/**
 * Radens placering: slug:en som burits med från offertraden, annars en EXAKT etikettmatchning på
 * det installatören skrivit, annars null.
 *
 * Etikettreserven finns för rader installatören lagt till själv. Den är exakt och inte fuzzy —
 * se constructionFromLabel.
 */
export function constructionFromEtappRow(row: { construction?: string; etapp?: string }): ConstructionSlug | null {
  const slug = (row.construction ?? '').trim().toLowerCase();
  if (isConstructionSlug(slug)) return slug;
  return constructionFromLabel(row.etapp);
}

/**
 * Etappraderna → rader för huvudboken. En rad per etapp med ett ifyllt säckantal.
 *
 * ⚠️ `parseDecimal`, INTE `Number`. Fältet skrivs av en människa på en telefon och "1,5" är en
 * rimlig sak att skriva. Egenkontrollens EGEN densitetsberäkning läser samma fält med parseDecimal,
 * med en kommentar om att parseFloat annars "silently corrupt density on this quality document" —
 * så det här är dokumentets etablerade läsning av fältet, och dörr 2 gör likadant.
 *
 * ⚠️ Fritextkommentaren "Antal säckar: N" räknar med `Number(...)` och ser alltså 0 där boken ser
 * 1,5. Den avvikelsen är ETT FEL I KOMMENTAREN och ärvs medvetet inte hit: boken ska bära det
 * installatören skrev. Att rätta kommentaren ändrar egenkontrollens utdata och ligger utanför den
 * här planen — det är ett eget beslut.
 *
 * En tom säckruta hoppas över; en ifylld NOLLA behålls. "Vi var här, inget gick åt" är ett svar,
 * till skillnad från en rad som aldrig fylldes i.
 */
export function finalSackEntriesFromEtappRows(
  open: EtappOpenRow[],
  closed: EtappClosedRow[],
  materialUsed: string | null | undefined,
): FinalSackEntry[] {
  const material = materialShortFromEgenkontroll(materialUsed);

  const entries: FinalSackEntry[] = [];
  const push = (row: { construction?: string; etapp?: string }, raw: string | undefined) => {
    if (raw === undefined || String(raw).trim() === '') return;
    const sacks = parseDecimal(raw, Number.NaN);
    if (!Number.isFinite(sacks) || sacks < 0) return;
    entries.push({ construction: constructionFromEtappRow(row), sacks_blown: sacks, material });
  };

  for (const row of open) push(row, row.antalSack);
  for (const row of closed) push(row, row.antalSackKgPerSack);
  return entries;
}

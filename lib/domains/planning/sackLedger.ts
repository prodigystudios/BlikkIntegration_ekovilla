// Säckarnas huvudbok — reglerna som avgör VILKA rapportrader som räknas, och VILKET segment en
// rapporterad dag hör till. Rent och sidoeffektfritt; all I/O ligger hos anroparen.
//
// ── SUPERSEDE-REGELN ────────────────────────────────────────────────────────
// ops_segment_reports är append-only och har två sorters rader:
//
//   partial  en delrapport — vad som faktiskt blåstes den dagen. Skrivs bara när ett jobb går
//            över flera besök och nästa team behöver veta var föregående slutade.
//   final    egenkontrollen — den FULLA sanningen för hela jobbet. "Projektet klart, detta gick
//            totalt åt."
//
// Regeln är EN mening: **finns en final är den jobbets sanning; annars summan av partial.**
// Aldrig addition mellan dem, aldrig subtraktion någonstans.
//
//   Besök 1   partial  vind  30     boken:  30
//   Besök 2   partial  vind  25     boken:  55
//   Besök 3   blåser 36 till, egenkontroll skrivs på TOTALEN
//             final    vind  91     boken:  91
//
// 55 delrapporterat + 36 sista besöket = 91. Naiv summering hade gett 146 — det är den summan
// regeln finns för att omöjliggöra.
//
// ⚠️ DIFFERENSMODELLEN ÄR PRÖVAD OCH FÖRKASTAD, föreslå den inte igen. Att dra delrapporterna från
// egenkontrollen faller på tre punkter: hinkmissmatchning (offertens placering är en regexgissning,
// installatörens ett val), kapplöpning (differensen räknas i klienten ur ett värde hämtat när
// formuläret öppnades) och att nedåtkorrigering blir omöjlig — `check (sacks_blown >= 0)` i
// databasen golvar en negativ differens till 0 och boken står kvar för högt.
//
// ⚠️ PER ARBETSORDER, INTE PER PLACERING OCH INTE PER DOKUMENT. En final släcker jobbets ALLA
// partials, även de på andra konstruktioner, för egenkontrollen är totalen för hela jobbet.
// Nycklade per placering hade en final på vinden låtit väggens delrapporter leva kvar och adderas
// ovanpå — exakt dubbelräkningen regeln finns för att stoppa.
//
// ⚠️ FUNKTIONEN FILTRERAR RADER, DEN SUMMERAR INTE. Två ställen behöver regeln och de behöver den
// på olika sätt: reportedSacksByWorkOrder vill ha en summa per jobb, medan deriveConsumptionRows
// måste attribuera VARJE överlevande rad till en depå och ett material. Hade den delade funktionen
// returnerat ett tal hade depån fått bygga en egen kopia av regeln — och glöms depån drar den
// partial + final och dubbeldebiterar lagret.

import { CONSTRUCTION_SLUGS, constructionLabel, type ConstructionSlug } from '@/lib/domains/crm/constructions';

// ── Typer ────────────────────────────────────────────────────────────────────

export type SackReportKind = 'partial' | 'final';

// Bara det regeln behöver. Anroparna skickar in sina egna, bredare radtyper.
export type SackLedgerRow = {
  work_order_id: string;
  kind?: string | null;
  sacks_blown?: number | string | null;
};

/**
 * Radens sort, normaliserad. Allt som inte är exakt 'final' räknas som 'partial'.
 *
 * Den säkra sidan, med flit: kolumnen är `not null default 'partial'`, men rader som skrevs innan
 * kolumnen fanns (och allt som någon gång kommer in via en annan väg) ska RÄKNAS MED, inte tysta
 * ut alla andra rader på jobbet. En felaktig 'final' är den dyra riktningen — den släcker allt
 * annat — så den kräver ett exakt värde.
 */
export function sackReportKind(row: Pick<SackLedgerRow, 'kind'>): SackReportKind {
  return row.kind === 'final' ? 'final' : 'partial';
}

// ── Supersede ────────────────────────────────────────────────────────────────

/**
 * Märker varje rad med om den är ersatt. Bevarar inordningen.
 *
 * Spåret på arbetsordern behöver det här och inte bara filtret: efter en final ligger partials kvar
 * i boken, och listas de rakt av läser kontoret 30 + 25 + 91 = 146 och tror att talen inte går
 * ihop. De ersatta raderna MÅSTE synas som ersatta — samma felklass som "Ej rapporterat" kontra
 * "0 st".
 */
export function markSupersededReports<T extends SackLedgerRow>(rows: T[]): Array<T & { superseded: boolean }> {
  const hasFinal = new Set<string>();
  for (const row of rows) {
    if (sackReportKind(row) === 'final') hasFinal.add(row.work_order_id);
  }
  return rows.map((row) => ({
    ...row,
    superseded: sackReportKind(row) === 'partial' && hasFinal.has(row.work_order_id),
  }));
}

/** Raderna som räknas — finalerna om jobbet har några, annars dess partials. */
export function effectiveSackReports<T extends SackLedgerRow>(rows: T[]): T[] {
  const hasFinal = new Set<string>();
  for (const row of rows) {
    if (sackReportKind(row) === 'final') hasFinal.add(row.work_order_id);
  }
  return rows.filter((row) => (hasFinal.has(row.work_order_id) ? sackReportKind(row) === 'final' : true));
}

/**
 * Blåsta säckar per arbetsorder, efter supersede.
 *
 * Ett jobb utan rapportrader saknas i kartan — det är INTE samma sak som noll säckar, och
 * anropsstället måste skilja på dem. "Ej rapporterat" och "0 st" är olika svar på olika frågor.
 */
export function sumSacksByWorkOrder(rows: SackLedgerRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of effectiveSackReports(rows)) {
    const sacks = Number(row.sacks_blown ?? 0);
    if (!Number.isFinite(sacks)) continue;
    map.set(row.work_order_id, (map.get(row.work_order_id) ?? 0) + sacks);
  }
  return map;
}

/** Summan OCH varifrån den kommer, per arbetsorder. */
export type SackTotal = {
  sacks: number;
  /**
   * Jobbet har minst en final-rad, alltså är summan egenkontrollens och inte delrapporternas.
   *
   * ⚠️ `false` betyder "vi vet inte", INTE "egenkontroll saknas". En egenkontroll vars etapprader
   * saknar säckantal skriver inga final-rader alls, och skrivningen till huvudboken kan misslyckas
   * medan PDF:en ändå arkiveras och kommenteras på ordern. Rita därför bara ut det positiva
   * märket — ett "EK saknas" byggt på den här flaggan hade ibland ljugit.
   */
  hasFinal: boolean;
};

/**
 * Som sumSacksByWorkOrder, men bär också om summan är egenkontrollens.
 *
 * Finns för planeringstavlan, där flaggan avgör VILKEN FRÅGA kortets badge svarar på: utan
 * egenkontroll räknar den ned mot planen ("kvar 36 / 564" — vad som är kvar att blåsa), med
 * egenkontroll anger den utfallet ("528 av 564" — vad som faktiskt gick åt). Grenarna står i
 * sackProgressState.
 *
 * Delar rader med sumSacksByWorkOrder med flit — en andra fråga mot ops_segment_reports bara för
 * flaggan hade varit en extra rundtur, och två frågor kan dessutom se olika tillstånd.
 */
export function sackTotalsByWorkOrder(rows: SackLedgerRow[]): Map<string, SackTotal> {
  const sums = sumSacksByWorkOrder(rows);
  const finals = new Set<string>();
  for (const row of rows) {
    if (sackReportKind(row) === 'final') finals.add(row.work_order_id);
  }

  const map = new Map<string, SackTotal>();
  for (const [workOrderId, sacks] of sums) {
    map.set(workOrderId, { sacks, hasFinal: finals.has(workOrderId) });
  }
  return map;
}

// ── Segmentupplösning ────────────────────────────────────────────────────────

export type ResolvableSegment = {
  id: string;
  start_day: string;
  end_day: string;
};

export type SegmentResolution = {
  segmentId: string;
  /** 'covering' = dagen ligger i segmentets intervall. 'nearest' = defensiv reserv, SKA loggas. */
  match: 'covering' | 'nearest';
  /** Antal dagar mellan rapportdagen och segmentets intervall. Alltid 0 vid 'covering'. */
  daysOff: number;
};

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Dagnummer, UTC-förankrat. Datumen är rena kalenderdagar utan klockslag, så all aritmetik måste
// hålla sig borta från runtimens egen zon — annars blir en sommartidsövergång en dags fel i
// avståndet, och på servern (UTC) skulle svaret dessutom skilja sig från klientens.
function isoToDayNumber(iso: string | null | undefined): number | null {
  const m = ISO_DATE_RE.exec((iso ?? '').trim());
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/**
 * Vilket segment en rapporterad dag hör till.
 *
 * TÄCKNING FÖRST: dagen ligger i `start_day … end_day`. Det är normalfallet och det enda som
 * egentligen ska inträffa — get_my_crm_jobs bygger fältfeeden ur ops_segments med
 * generate_series(start_day, end_day), så EN DAG SOM INGET SEGMENT TÄCKER EXISTERAR INTE i
 * /mina-jobb. Att installatören står där och rapporterar bevisar att ett täckande segment finns.
 *
 * NÄRMASTE SEGMENT är en defensiv reserv för att en rapport aldrig ska gå förlorad om det
 * antagandet ändå brister (ett segment flyttas efter att fältvyn laddades, en dag korrigeras i
 * efterhand). ⚠️ ANROPAREN MÅSTE LOGGA när `match === 'nearest'` faller ut — annars är det enda
 * spåret av ett trasigt antagande att säckarna tyst hamnade på fel bil, och därmed på fel depå.
 *
 * ⚠️ TVÅ SEGMENT KAN TÄCKA SAMMA DAG. Ett jobb som splittas på två bilar ("Kopiera till bil" på
 * tavlan) är ett normalt drag, och då är det genuint tvetydigt vilken bils depå säckarna ska dras
 * från. Valet här är det TIDIGASTE segmentet (sedan id), samma deterministiska ordning som
 * derivePlannedDemandRows använder för planerad efterfrågan — så planerat och förbrukat attribueras
 * åtminstone likadant. Ett riktigt svar kräver att rapporten bär bilen, vilket den inte gör i dag.
 */
export function resolveSegmentForDay(
  segments: ResolvableSegment[],
  reportDay: string,
): SegmentResolution | null {
  const day = isoToDayNumber(reportDay);
  if (day === null) return null;

  const candidates = segments
    .map((s) => ({ s, start: isoToDayNumber(s.start_day), end: isoToDayNumber(s.end_day) }))
    .filter((c): c is { s: ResolvableSegment; start: number; end: number } => c.start !== null && c.end !== null)
    // Tidigast först, id som stabil tiebreak — se varningen om två täckande segment ovan.
    .sort((a, b) => a.start - b.start || a.s.id.localeCompare(b.s.id));
  if (candidates.length === 0) return null;

  const covering = candidates.find((c) => c.start <= day && day <= c.end);
  if (covering) return { segmentId: covering.s.id, match: 'covering', daysOff: 0 };

  let best = candidates[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const distance = day < c.start ? c.start - day : day - c.end;
    // Strikt <: vid lika avstånd vinner den som redan ligger först i den sorterade listan.
    if (distance < bestDistance) {
      best = c;
      bestDistance = distance;
    }
  }
  return { segmentId: best.s.id, match: 'nearest', daysOff: bestDistance };
}

// ── Gruppering per placering ─────────────────────────────────────────────────

export const UNSPECIFIED_CONSTRUCTION_LABEL = 'Ospecificerad';

export type SackReportGroup<T> = {
  construction: ConstructionSlug | null;
  label: string;
  /** Summan som RÄKNAS — ersatta rader är inte med. */
  total: number;
  /** Alla rader i gruppen, ersatta inkluderade. De ska synas, dämpade. */
  items: T[];
};

/**
 * Rapportraderna grupperade per placering, i vokabulärens ordning med "Ospecificerad" sist.
 *
 * Bara placeringar som faktiskt har rapporterats får en grupp — en tom "Golv"-rad på varje jobb
 * hade varit brus i en vy man läser stående i ett kryputrymme.
 *
 * ⚠️ `total` räknar bara rader som INTE är ersatta, medan `items` bär alla. Efter en egenkontroll
 * ligger delrapporterna kvar i boken, och en lista som visar dem utan att summan hoppar över dem
 * får läsaren att räkna 30 + 25 + 91 = 146 och tro att talen inte går ihop.
 */
export function groupSackReportsByConstruction<T extends { construction?: string | null; sacks_blown: number; superseded: boolean }>(
  rows: T[],
): Array<SackReportGroup<T>> {
  const byKey = new Map<string, SackReportGroup<T>>();

  for (const row of rows) {
    const slug = (row.construction ?? '').trim().toLowerCase();
    const known = (CONSTRUCTION_SLUGS as readonly string[]).includes(slug) ? (slug as ConstructionSlug) : null;
    const key = known ?? '';
    let group = byKey.get(key);
    if (!group) {
      group = { construction: known, label: known ? constructionLabel(known) : UNSPECIFIED_CONSTRUCTION_LABEL, total: 0, items: [] };
      byKey.set(key, group);
    }
    group.items.push(row);
    if (!row.superseded) group.total += row.sacks_blown;
  }

  const ordered: Array<SackReportGroup<T>> = [];
  for (const slug of CONSTRUCTION_SLUGS) {
    const group = byKey.get(slug);
    if (group) ordered.push(group);
  }
  const unspecified = byKey.get('');
  if (unspecified) ordered.push(unspecified);
  return ordered;
}

/** Jobbets rapporterade total efter supersede. */
export function totalReportedSacks(rows: Array<{ sacks_blown: number; superseded: boolean }>): number {
  return rows.reduce((sum, row) => (row.superseded ? sum : sum + row.sacks_blown), 0);
}

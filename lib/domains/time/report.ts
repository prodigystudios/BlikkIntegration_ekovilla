import { rowMinutes } from './hours';
import type { TimeEntryKind } from './summary';

// Rapporteringens tidsdel: rapporterade timmar per period, uppdelat på vad de lagts på.
//
// Rent och sidoeffektfritt; all I/O ligger i reportLoader.ts. Modulen svarar på "vart tog timmarna
// vägen" — inte på "vad ska betalas ut". Löneunderlaget har sina egna regler och sin egen yta
// (lib/domains/time/payrollPdf.ts); den här summerar bara vad som är rapporterat.

// ⛔ INGEN DEBITERBARHETSGRAD. `crm_time_codes.billable` finns i schemat men är NULL på samtliga
// åtta koder (mätt 2026-09-23), och 128 av 231 tidrader saknar tidkod helt. Ett tal byggt på den
// flaggan hade visat "0 h debiterbart" av 1 275 rapporterade timmar. Att i stället likställa
// `kind = 'work_order'` med "debiterbart" vore en uppfunnen affärsregel — interntidsprojektet
// "Arbetstid mot arbetsorder utanför BLIKK" bär 58 h som uppenbart hör till en order. Sektionen
// redovisar därför VAR tiden ligger, med kindens egna ord, och överlåter tolkningen.

export type TimeReportRange = { from: string; to: string };

/** Bara det aggregeringen behöver. Anroparen skickar sin egen, bredare radtyp. */
export type TimeReportEntryRow = {
  user_id: string | null;
  work_date: string;
  kind: string | null;
  minutes_worked?: number | null;
  hours?: number | string | null;
  /** Namnet på internprojektet, uppslaget av laddaren. */
  internal_project_name?: string | null;
  /** Namnet på frånvaroorsaken, uppslaget av laddaren. */
  absence_reason?: string | null;
};

export type TimePersonRow = { id: string; full_name: string | null };

export type TimeMonthPoint = {
  period: string;
  workOrderMinutes: number;
  internalMinutes: number;
  absenceMinutes: number;
};

export type TimePersonStat = {
  userId: string;
  userName: string;
  workOrderMinutes: number;
  internalMinutes: number;
  absenceMinutes: number;
  /** Arbetad tid = arbetsorder + internt. Frånvaro är INTE arbetad tid. */
  workedMinutes: number;
};

/** `label: null` = uppgiften saknas på raden. Gränssnittet skriver ut det; det är ett ifyllnadsfel. */
export type TimeLabelRow = { label: string | null; minutes: number };

export type TimeReport = {
  /** Arbetad tid: arbetsorder + internt. Frånvaro ingår INTE. */
  workedMinutes: number;
  workOrderMinutes: number;
  internalMinutes: number;
  absenceMinutes: number;
  /** Rader som räknas. */
  entries: number;
  /** Personer med minst en rad i perioden. */
  people: number;
  /**
   * Rader vars minuter inte gick att läsa — varken `minutes_worked` eller `hours`.
   *
   * ⚠️ MÅSTE REDOVISAS. Utan talet skiljer sig summan från antalet rader utan att något ser trasigt
   * ut, och en rad som tyst räknas som noll timmar ser ut som en rad som aldrig fanns.
   */
  unreadableEntries: number;
  byMonth: TimeMonthPoint[];
  byPerson: TimePersonStat[];
  byInternalProject: TimeLabelRow[];
  byAbsenceReason: TimeLabelRow[];
  /** Kunde inte räknas alls — skilt från "inget rapporterat". */
  unavailable: boolean;
};

/**
 * Radens sort, normaliserad. Allt okänt räknas som interntid — se kommentaren i buildTimeReport.
 *
 * ⚠️ DUBBELT SKYDD MED FLIT. Summeringen nedan har en `else`-gren som fångar allt som varken är
 * arbetsorder eller frånvaro, så den här normaliseringen och den grenen skyddar samma sak var för
 * sig. Att ta bort endera ensam ändrar ingenting (verifierat genom mutation), vilket gör det lätt
 * att tro att den ena är död kod. Båda står kvar: normaliseringen behövs för att en okänd sort ska
 * hamna i internprojektens hink, och `else`-grenen för att totalen aldrig ska tappa minuter.
 */
function entryKind(row: TimeReportEntryRow): TimeEntryKind {
  return row.kind === 'work_order' || row.kind === 'absence' ? row.kind : 'internal';
}

export function buildTimeReport(input: {
  entries: TimeReportEntryRow[];
  people: TimePersonRow[];
  range: TimeReportRange;
  /** Månadsaxeln, 'YYYY-MM'. Fixerad av anroparen så tomma månader ändå ritas. */
  months: string[];
}): TimeReport {
  const names = new Map(input.people.map((p) => [p.id, p.full_name]));
  const monthMap = new Map<string, TimeMonthPoint>(
    input.months.map((period) => [period, { period, workOrderMinutes: 0, internalMinutes: 0, absenceMinutes: 0 }]),
  );
  const personMap = new Map<string, TimePersonStat>();
  const projectMap = new Map<string | null, number>();
  const reasonMap = new Map<string | null, number>();

  let workOrderMinutes = 0;
  let internalMinutes = 0;
  let absenceMinutes = 0;
  let entries = 0;
  let unreadableEntries = 0;

  for (const row of input.entries) {
    if (row.work_date < input.range.from || row.work_date > input.range.to) continue;

    const minutes = rowMinutes(row);
    if (minutes == null) {
      // Raden finns men går inte att räkna. Den räknas som ett känt hål, aldrig som noll timmar.
      unreadableEntries++;
      continue;
    }
    entries++;

    // ⚠️ OKÄND `kind` RÄKNAS SOM INTERNT, inte som ingenting. CHECK-villkoret i databasen binder
    // kinden till vilket mål som är ifyllt, så en okänd sort ska inte kunna finnas — men hamnar en
    // där ska dess timmar ändå synas i totalen. Att tappa dem hade gjort summan lägre än de rader
    // någon faktiskt rapporterat, vilket är den tysta riktningen.
    const kind = entryKind(row);
    if (kind === 'work_order') workOrderMinutes += minutes;
    else if (kind === 'absence') absenceMinutes += minutes;
    else internalMinutes += minutes;

    const month = monthMap.get(row.work_date.slice(0, 7));
    if (month) {
      if (kind === 'work_order') month.workOrderMinutes += minutes;
      else if (kind === 'absence') month.absenceMinutes += minutes;
      else month.internalMinutes += minutes;
    }

    const userId = row.user_id ?? '(okänd)';
    let person = personMap.get(userId);
    if (!person) {
      person = {
        userId,
        userName: names.get(userId) || 'Okänd användare',
        workOrderMinutes: 0,
        internalMinutes: 0,
        absenceMinutes: 0,
        workedMinutes: 0,
      };
      personMap.set(userId, person);
    }
    if (kind === 'work_order') { person.workOrderMinutes += minutes; person.workedMinutes += minutes; }
    else if (kind === 'absence') person.absenceMinutes += minutes;
    else { person.internalMinutes += minutes; person.workedMinutes += minutes; }

    if (kind === 'internal') {
      const label = (row.internal_project_name ?? '').trim() || null;
      projectMap.set(label, (projectMap.get(label) ?? 0) + minutes);
    }
    if (kind === 'absence') {
      // Frånvaro utan vald orsak ska SYNAS, inte försvinna — den är ett ifyllnadsfel någon ska
      // rätta. Samma regel som summarizePerson redan följer i attestunderlaget.
      const label = (row.absence_reason ?? '').trim() || null;
      reasonMap.set(label, (reasonMap.get(label) ?? 0) + minutes);
    }
  }

  // Namnlösa hinkar sist, oavsett storlek: en lucka i underlaget konkurrerar inte om toppen.
  const labelRows = (map: Map<string | null, number>): TimeLabelRow[] =>
    [...map.entries()]
      .map(([label, minutes]) => ({ label, minutes }))
      .sort((a, b) => {
        if ((a.label === null) !== (b.label === null)) return a.label === null ? 1 : -1;
        return b.minutes - a.minutes;
      });

  return {
    workedMinutes: workOrderMinutes + internalMinutes,
    workOrderMinutes,
    internalMinutes,
    absenceMinutes,
    entries,
    people: personMap.size,
    unreadableEntries,
    byMonth: input.months.map((period) => monthMap.get(period) as TimeMonthPoint),
    byPerson: [...personMap.values()].sort(
      (a, b) => b.workedMinutes - a.workedMinutes || a.userName.localeCompare(b.userName, 'sv'),
    ),
    byInternalProject: labelRows(projectMap),
    byAbsenceReason: labelRows(reasonMap),
    unavailable: false,
  };
}

/** Tom tidsdel — när den inte gick att räkna. Skilt från "inget rapporterat". */
export function unavailableTimeReport(months: string[]): TimeReport {
  return {
    workedMinutes: 0,
    workOrderMinutes: 0,
    internalMinutes: 0,
    absenceMinutes: 0,
    entries: 0,
    people: 0,
    unreadableEntries: 0,
    byMonth: months.map((period) => ({ period, workOrderMinutes: 0, internalMinutes: 0, absenceMinutes: 0 })),
    byPerson: [],
    byInternalProject: [],
    byAbsenceReason: [],
    unavailable: true,
  };
}

import { addDaysISO, isoWeek, mondayOfISO } from '@/lib/domains/planning/timezone';

import { grossMinutes, workedMinutes, type ShiftInput } from './hours';

// Sammanställning av tidrader per person, dag och månad.
//
// Formen följer lönebyråns begärda underlag (2026-08-11), kolumn för kolumn:
//
//   Datum | Klockslag start/slut | Antal arbetade timmar | Frånvarotimmar/Frånvaroorsak | Anteckning
//
// plus "en summering totalt arbetad tid och frånvaro för månaden". Inget mer efterfrågades: byrån
// härleder övertid och OB själv ur klockslagen, så vi delar inte upp timmarna i kategorier och
// räknar ingen ordinarie-tröskel. Se lib/domains/time/hours.ts för vad som togs bort och varför.
//
// VECKOSUMMOR (ekonomi 2026-10-14): övertiden räknas per vecka, och byrån drog linjer mellan veckorna
// och summerade dem för hand. Varje vecka summeras därför också — fortfarande utan tröskel, bara
// timmarna. Se WeekSummary för veckorna som går över ett månadsskifte.

export type TimeEntryKind = 'work_order' | 'internal' | 'absence';

export type SummarizableEntry = ShiftInput & {
  kind: TimeEntryKind;
  userId: string;
  /** Tidradens id. Underlaget är en LÄSVY, men attesten måste kunna peka ut raden som ska rättas. */
  id?: string;
  /** Frånvaroorsakens namn (crm_absence_types.name) — hamnar i underlagets frånvarokolumn. */
  absenceReason?: string | null;
  /** Byråns lönesort, från referensraden. */
  payrollCode?: string | null;
  note?: string | null;
  /**
   * Vad tiden lades på — arbetsordern eller internprojektet, i klartext.
   *
   * Ingen av byråns kolumner. Den finns för attestens dagvy, där kontoret granskar rapporteringen
   * för hand: "9 timmar den 14:e" säger inget om raden är rimlig, "9 timmar på AO-20260729-42E7C4"
   * gör det. Frånvaro har ingen — där bär absenceReason samma roll.
   */
  label?: string | null;
};

export type DayRow = {
  date: string;
  startTime: string | null;
  endTime: string | null;
  /** Arbetad tid efter rastavdrag. Frånvaro ingår aldrig. */
  workMinutes: number;
  absenceMinutes: number;
  /** Flera frånvaroorsaker samma dag listas var för sig — de kan ha olika lönesort. */
  absenceReasons: string[];
  note: string | null;
  /** Arbetsordern eller internprojektet raden hör till. Null på frånvaro. */
  label: string | null;
  /** Tidraden bakom dagraden, när den är känd — annars går raden inte att rätta. */
  entryId: string | null;
  /**
   * Radens sort.
   *
   * ⚠️ Går inte att härleda ur siffrorna. En internrad har arbetade minuter precis som en
   * arbetsorderrad, så en rättelse som gissade sorten ur `absenceMinutes` öppnade internraden som
   * "Arbetsorder" — och ett valt jobb föll då tyst bort i sammanslagningen medan UI:t sa att raden
   * var rättad.
   */
  kind: TimeEntryKind;
  /**
   * Rastavdraget i minuter.
   *
   * ⚠️ Måste följa med. Den som RÄTTAR raden skickar tillbaka rasten tillsammans med klockslagen,
   * och servern räknar om minuterna ur alla tre. Saknas den här defaultar formuläret till noll och
   * en rättad 07:00–16:00 med halvtimmes rast går från 510 till 540 minuter — trettio minuter
   * tillagda på någons lön, tyst, vid varje rättelse.
   */
  breakMinutes: number;
};

// En rad per tidrad, inte per dag: byrån vill se klockslagen, och två pass samma dag har två par.
// Datumet kan alltså återkomma — det är avsiktligt och matchar hennes layout.
export function buildDayRows(entries: SummarizableEntry[]): DayRow[] {
  return [...entries]
    .sort((a, b) => a.workDate.localeCompare(b.workDate) || (a.startTime || '').localeCompare(b.startTime || ''))
    .map((entry) => {
      const minutes = workedMinutes(entry);
      const isAbsence = entry.kind === 'absence';
      return {
        date: entry.workDate,
        startTime: entry.startTime,
        endTime: entry.endTime,
        workMinutes: isAbsence ? 0 : minutes,
        absenceMinutes: isAbsence ? minutes : 0,
        absenceReasons: isAbsence && entry.absenceReason ? [entry.absenceReason] : [],
        note: entry.note ?? null,
        label: isAbsence ? null : entry.label ?? null,
        entryId: entry.id ?? null,
        kind: entry.kind,
        breakMinutes: isAbsence ? 0 : entry.breakMinutes ?? 0,
      };
    });
}

/**
 * Drogs rastavdraget faktiskt av från raden?
 *
 * ⚠️ Inte samma fråga som "har raden en rast". `workedMinutes` drar bara av rasten när det finns
 * två klockslag att räkna emellan — saknas de faller den tillbaka på minutesWorked, och den
 * lagrade rasten är då en siffra som aldrig påverkade någonting. De gamla kontorsraderna är precis
 * sådana. Att visa deras rast som ett avdrag hade fått en korrekt rad att se överrapporterad ut
 * med en timme, och den som "rättar" den skriver bort riktig tid.
 */
export function breakWasDeducted(row: Pick<DayRow, 'startTime' | 'endTime' | 'kind'>): boolean {
  return row.kind !== 'absence' && grossMinutes(row.startTime, row.endTime) !== null;
}

/**
 * Innehållet i dagvyns kolumn "Orsak / jobb".
 *
 * ⚠️ FINNS FÖR ATT ETT TANKSTRECK LJUGER PÅ EN ARBETSORDERRAD.
 *
 * Tidraderna hämtas med en embed av `crm_work_orders` (lib/domains/time/entries.ts), och SELECT-
 * policyn på den tabellen kräver crm.workorder.read, assigned_to eller besättning. Lönebyrån
 * (rollen `ekonomi`) har inget av det — hon ska inte se kundnamn per arbetad timme — så embedden
 * svarar null och `label` blir null på VARJE arbetsorderrad hon tittar på.
 *
 * Det är rätt gräns men fel besked. Den här ytans dyraste felklass är fel som ser ut som tomma
 * värden i stället för som gränser: ett "—" läses som "ingen uppgift finns", och den som granskar
 * hör av sig om trasig data i stället för att läsa vidare. `kind` vet att raden hör till ett jobb
 * även när namnet inte gick att hämta, så vi säger det i klartext.
 *
 * CHECK:en på crm_time_entries binder `kind` till vilket mål som är ifyllt, så en work_order-rad
 * HAR alltid en arbetsorder. En null-label på en sådan rad betyder därför exakt en sak: läsaren
 * saknar åtkomst till ordern. Signalen är entydig.
 */
export function reasonOrJobLabel(
  row: Pick<DayRow, 'absenceReasons' | 'label' | 'kind'>,
): string {
  if (row.absenceReasons.length > 0) return row.absenceReasons.join(', ');
  if (row.label) return row.label;
  if (row.kind === 'work_order') return 'Arbetsorder';
  if (row.kind === 'internal') return 'Internprojekt';
  return '—';
}

/** Arbetad tid, frånvaro och rastavdrag — samma tre summor som månadens totalrad. */
export type MinuteTotals = {
  workMinutes: number;
  absenceMinutes: number;
  /** Bara rast som faktiskt drogs av (breakWasDeducted). */
  breakMinutes: number;
};

/**
 * En vecka i underlaget, måndag till söndag.
 *
 * ⚠️ `total` ÄR HELA VECKAN, ÄVEN DAGARNA I GRANNMÅNADEN (Williams beslut 2026-10-14). Övertiden
 * räknas per vecka, och en vecka som går över ett månadsskifte (oktober 2026 börjar en torsdag) har
 * annars bara halva sin tid i varje månads underlag — byrån fick lägga ihop två utskrifter för hand.
 * `inPeriod` är månadens del. Dagraderna visar fortfarande bara månadens dagar.
 *
 * Grannmånadens dagar är vad som är RAPPORTERAT när underlaget tas fram: skrivs oktober ut den 2
 * november kan veckans sista dagar sakna rader som kommer senare.
 */
export type WeekSummary = {
  /** ISO-veckonumret, som svensk kalender räknar. */
  week: number;
  /** Veckans måndag och söndag. */
  from: string;
  to: string;
  total: MinuteTotals;
  inPeriod: MinuteTotals;
  /** Veckan sträcker sig utanför perioden. Då svarar `total` och `inPeriod` på olika frågor. */
  crossesPeriod: boolean;
};

export type PersonPeriodSummary = {
  userId: string;
  from: string;
  to: string;
  rows: DayRow[];
  workMinutes: number;
  absenceMinutes: number;
  /**
   * Månadens rastavdrag — bara det som faktiskt drogs av (se breakWasDeducted).
   *
   * Ingen av byråns kolumner. Den finns som kontrollsiffra för attesten: bruttotiden ur
   * klockslagen minus den här ska bli workMinutes, och stämmer det inte är någon rad fel.
   */
  breakMinutes: number;
  /** Frånvarotimmar per orsak — byrån behöver veta VILKEN ledighet, inte bara hur mycket. */
  absenceByReason: Array<{ reason: string; minutes: number }>;
  /** Veckorna som har minst en rad i perioden, i ordning. Se WeekSummary. */
  weeks: WeekSummary[];
};

function totalsOf(rows: DayRow[]): MinuteTotals {
  return {
    workMinutes: rows.reduce((sum, row) => sum + row.workMinutes, 0),
    absenceMinutes: rows.reduce((sum, row) => sum + row.absenceMinutes, 0),
    breakMinutes: rows.reduce((sum, row) => sum + (breakWasDeducted(row) ? row.breakMinutes : 0), 0),
  };
}

/**
 * Perioden utvidgad till hela veckor — det spann tidraderna måste hämtas för, för att
 * `summarizePerson` ska kunna summera kantveckorna hela. Oktober 2026 → 28 september–1 november.
 */
export function weekAlignedRange(range: { from: string; to: string }): { from: string; to: string } {
  const first = mondayOfISO(range.from);
  const last = mondayOfISO(range.to);
  return { from: first ?? range.from, to: last ? addDaysISO(last, 6) : range.to };
}

/**
 * Personens underlag för perioden.
 *
 * `entries` får innehålla rader UTANFÖR perioden — routerna hämtar weekAlignedRange — men de räknas
 * bara in i veckosummorna. Dagraderna, månadens summor och frånvaron per orsak är periodens.
 */
export function summarizePerson(
  entries: SummarizableEntry[],
  range: { from: string; to: string },
  userId: string,
): PersonPeriodSummary {
  const everyDay = entries.filter((entry) => entry.userId === userId);
  const mine = everyDay.filter((entry) => entry.workDate >= range.from && entry.workDate <= range.to);
  const rows = buildDayRows(mine);

  const { workMinutes, absenceMinutes, breakMinutes } = totalsOf(rows);

  // En vecka per måndag som periodens rader faller i — alltså aldrig en vecka utan en dagrad att
  // stå under, och varje dagrad har sin vecka.
  const mondays = [...new Set(rows.map((row) => mondayOfISO(row.date)).filter((day): day is string => !!day))].sort();
  const weeks = mondays.map((monday): WeekSummary => {
    const sunday = addDaysISO(monday, 6);
    const weekRows = buildDayRows(everyDay.filter((entry) => entry.workDate >= monday && entry.workDate <= sunday));
    return {
      week: isoWeek(monday),
      from: monday,
      to: sunday,
      total: totalsOf(weekRows),
      inPeriod: totalsOf(weekRows.filter((row) => row.date >= range.from && row.date <= range.to)),
      crossesPeriod: monday < range.from || sunday > range.to,
    };
  });

  const byReason = new Map<string, number>();
  for (const entry of mine) {
    if (entry.kind !== 'absence') continue;
    // Frånvaro utan vald orsak ska synas, inte försvinna: den är ett ifyllnadsfel någon ska rätta.
    const reason = entry.absenceReason || '(orsak saknas)';
    byReason.set(reason, (byReason.get(reason) ?? 0) + workedMinutes(entry));
  }

  return {
    userId,
    from: range.from,
    to: range.to,
    rows,
    workMinutes,
    absenceMinutes,
    breakMinutes,
    absenceByReason: [...byReason.entries()]
      .map(([reason, minutes]) => ({ reason, minutes }))
      .sort((a, b) => b.minutes - a.minutes || a.reason.localeCompare(b.reason, 'sv')),
    weeks,
  };
}

/**
 * Dagraderna grupperade per vecka, i ordning — så som attestvyn och löneunderlaget ritar dem, med
 * veckans summa efter dess sista dag.
 *
 * Varje rad hamnar i EXAKT en grupp. En rad som ingen vecka täcker (ett svar utan `weeks`, från en
 * server som ännu inte driftsatts) samlas i en sista grupp utan vecka i stället för att försvinna —
 * en dagrad som tyst faller bort ur ett löneunderlag är det dyraste felet den här ytan kan göra.
 */
export function rowsByWeek(
  summary: Pick<PersonPeriodSummary, 'rows'> & { weeks?: WeekSummary[] | null },
): Array<{ week: WeekSummary | null; rows: DayRow[] }> {
  const groups: Array<{ week: WeekSummary | null; rows: DayRow[] }> = (summary.weeks ?? []).map((week) => ({ week, rows: [] }));
  const orphans: DayRow[] = [];
  for (const row of summary.rows) {
    const group = groups.find((g) => g.week && row.date >= g.week.from && row.date <= g.week.to);
    if (group) group.rows.push(row);
    else orphans.push(row);
  }
  const placed = groups.filter((group) => group.rows.length > 0);
  return orphans.length > 0 ? [...placed, { week: null, rows: orphans }] : placed;
}

/** Månadernas förkortningar — tid-domänens enda tabell; löneunderlagets datum läser samma. */
export const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/**
 * '2026-09-28'..'2026-10-04' → '28 sep–4 okt'; inom en månad '5–11 okt'; en dag '31 aug'.
 *
 * Ur strängen och inte ur Intl — samma skäl som löneunderlagets datum (payrollPdf.formatEntryDate):
 * ICU-data skiljer mellan körmiljöer, och skärmen och utskriften ska skriva veckan likadant. Samma
 * form som ägarexportens shortSpan (crm/reportOwnerWorkbook.ts), som inte går att importera hit: den
 * modulen drar in exceljs, och attestvyn läser den här i webbläsaren.
 */
export function formatDaySpan(from: string, to: string): string {
  const parts = (iso: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return match ? { day: Number(match[3]), month: MONTHS_SHORT[Number(match[2]) - 1] ?? match[2] } : null;
  };
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return `${from}–${to}`;
  // En månad som slutar en måndag (augusti 2026) eller börjar en söndag (november 2026) har bara en
  // dag av kantveckan — "31–31 aug" läser som ett skrivfel.
  if (from === to) return `${a.day} ${a.month}`;
  return a.month === b.month ? `${a.day}–${b.day} ${b.month}` : `${a.day} ${a.month}–${b.day} ${b.month}`;
}

/** Månadens del av en vecka som går över ett månadsskifte: '1–4 okt'. */
export function inPeriodSpan(week: Pick<WeekSummary, 'from' | 'to'>, range: { from: string; to: string }): string {
  return formatDaySpan(week.from < range.from ? range.from : week.from, week.to > range.to ? range.to : week.to);
}

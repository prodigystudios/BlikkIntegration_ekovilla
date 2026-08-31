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
};

export function summarizePerson(
  entries: SummarizableEntry[],
  range: { from: string; to: string },
  userId: string,
): PersonPeriodSummary {
  const mine = entries.filter(
    (entry) => entry.userId === userId && entry.workDate >= range.from && entry.workDate <= range.to,
  );
  const rows = buildDayRows(mine);

  const workMinutes = rows.reduce((sum, row) => sum + row.workMinutes, 0);
  const absenceMinutes = rows.reduce((sum, row) => sum + row.absenceMinutes, 0);
  const breakMinutes = rows.reduce((sum, row) => sum + (breakWasDeducted(row) ? row.breakMinutes : 0), 0);

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
  };
}

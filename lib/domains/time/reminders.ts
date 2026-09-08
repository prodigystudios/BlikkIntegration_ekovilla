import { periodLabel } from './approvals';
import type { TimeApprovalOverviewRow } from './approvals';

// Påminnelser från attesten: "fyll i tiden som saknas".
//
// ⚠️ APPEN VET INTE VAD SOM SAKNAS, och meddelandet får aldrig låtsas att den gör det.
//
// Systemet känner varken tjänstgöringsgrad, schema eller semesterplan. "Du saknar tre dagar" vore
// därför en gissning maskerad som en uppgift — och en deltidare hade fått den varje månad tills
// ingen läste påminnelserna längre. Samma skäl som attestens staplar saknar trösklar (se
// TimeApprovals.tsx).
//
// Det appen VET är två saker, båda hämtade ur underlaget: att månaden inte är inlämnad, och om det
// finns någon rapporterad rad alls. Påminnelsen säger det, och inget mer. Vad som faktiskt fattas
// vet bara personen själv — texten skickar henne dit där hon kan se det.

/** Varför någon är värd att påminna. `null` = ingen anledning, alltså ingen påminnelse. */
export type ReminderReason = 'nothing_reported' | 'not_submitted';

export type RemindableRow = Pick<TimeApprovalOverviewRow, 'status' | 'entry_count'>;

/**
 * Anledningen att påminna någon, eller null när det inte finns någon.
 *
 * Bara en ÖPPEN månad går att påminna om. `submitted` betyder att personen gjort sitt och väntar på
 * oss — att peta på henne då är att be om något hon redan lämnat. `approved` är avslutad.
 *
 * ⚠️ Härleds SERVERSIDAN ur samma underlag som listan, aldrig ur något klienten skickar med. En
 * klient som fick bestämma anledningen kunde skicka "du har inte rapporterat något" till någon som
 * rapporterat hela månaden.
 */
export function reminderReasonFor(row: RemindableRow): ReminderReason | null {
  if (row.status !== 'open') return null;
  return row.entry_count === 0 ? 'nothing_reported' : 'not_submitted';
}

/** De i listan som faktiskt går att påminna, i listans ordning. */
export function remindableUsers<T extends RemindableRow & { user_id: string }>(rows: T[]): T[] {
  return rows.filter((row) => reminderReasonFor(row) !== null);
}

/**
 * Länken påminnelsen pekar på, och samtidigt periodens ANKARE i notistabellen.
 *
 * `notifications.entity_id` är uuid-typad och en periodstart är ingen uuid, så perioden kan inte
 * lagras där. Href:en bär den i stället — och därför läser historiken ("påmind 3 sep") tillbaka
 * raderna på exakt den här strängen.
 *
 * 🧨 Det gör formatet till ett kontrakt, inte en visningsdetalj: byter någon ut strängen på ena
 * stället tystnar historiken utan att något går sönder synligt. Producenten och historik-frågan
 * anropar därför BÅDA den här funktionen, och ett test håller ihop dem.
 */
export function timeReminderHref(periodStart: string): string {
  return `/tid?datum=${periodStart}`;
}

/** Notisens rubrik och brödtext. Rubriken är en uppmaning, inte en etikett. */
export function reminderNotificationText(
  reason: ReminderReason,
  periodStart: string,
  message?: string | null,
): { title: string; body: string } {
  const month = periodLabel(periodStart);
  const base =
    reason === 'nothing_reported'
      ? {
          title: `Rapportera din tid för ${month}`,
          body: `Det finns ingen rapporterad tid på dig för ${month}. Fyll i dina dagar och lämna in.`,
        }
      : {
          title: `Lämna in din tid för ${month}`,
          body: `${month} är påbörjad men inte inlämnad. Gå igenom dina dagar och lämna in.`,
        };
  const extra = message?.trim();
  return extra ? { ...base, body: `${base.body}\n\n${extra}` } : base;
}

/**
 * SMS-texten. Kortare än notisen och med avsändaren utskriven — det här landar i en telefon utan
 * appen omkring sig, och "Lämna in din tid" från ett okänt nummer säger ingenting.
 *
 * Länken är absolut av samma skäl. Origin skickas in i stället för att läsas här: modulen är ren,
 * och anroparen har `getPublicOrigin(req)` som svarar med den domän anropet faktiskt kom på.
 */
export function reminderSmsBody(input: {
  reason: ReminderReason;
  periodStart: string;
  origin: string;
  message?: string | null;
}): string {
  const month = periodLabel(input.periodStart);
  const lead =
    input.reason === 'nothing_reported'
      ? `Ekovilla: vi har ingen rapporterad tid på dig för ${month}.`
      : `Ekovilla: din tid för ${month} är inte inlämnad.`;
  const extra = input.message?.trim();
  return [lead, extra, `Fyll i här: ${input.origin}${timeReminderHref(input.periodStart)}`]
    .filter((line): line is string => Boolean(line))
    .join(' ');
}

/**
 * Raden under SMS-rutan: vem utskicket faktiskt når.
 *
 * Ligger här och inte i modalen för att den är ren text med fyra fall och en fälla — och en
 * 'use client'-fil går inte att pröva från vitest. Fällan var att ett `alla` stod utanför
 * singularvalet, så en ensam mottagare fick meningen "Går till alla mottagaren".
 *
 * `known: false` betyder att telefonuppgiften inte gick att läsa. Då säger raden ingenting om
 * antal — att skriva "ingen har nummer" när vi inte vet vore samma fel som `reminders_ok` finns
 * för att undvika.
 */
export function smsReachSentence(input: { known: boolean; total: number; reachable: number }): string {
  if (!input.known) return 'Notisen går alltid. SMS går till dem som har ett telefonnummer i profilen.';

  const missing = input.total - input.reachable;
  if (input.total === 1) {
    return input.reachable === 1
      ? 'Går till mottagaren.'
      : 'Mottagaren har inget telefonnummer i profilen — bara notisen går fram.';
  }
  if (missing === 0) return `Går till alla ${input.reachable} mottagarna.`;
  if (input.reachable === 0) return 'Ingen av mottagarna har ett telefonnummer i profilen — bara notisen går fram.';
  return `Går till ${input.reachable} av ${input.total}. ${missing} saknar telefonnummer i profilen.`;
}

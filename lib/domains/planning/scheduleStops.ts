import { compareScheduleRows, type ScheduleRow } from './myJobs';
import { workingDaysInRange } from './production';
import { isoDayNumber } from './timezone';

// Startsidans arbetsschema som en RUTT: dag → lastbil → stopp.
//
// Kortet i veckoschemat (components/dashboard/schedule/ScheduleStopCard.tsx) är ett stopp på bilens
// dag, och den här modulen avgör vilka stopp som finns och vilken siffra de bär. Ren: ingen I/O,
// ingen React — komponenten hämtar raderna och ritar dem, ordningen och numreringen bor här.

type DayFields = { job_day?: string | null; start_day?: string | null };
type LegacySortIndex = Parameters<typeof compareScheduleRows>[2];

export type ScheduleStop<T> = {
  row: T;
  /** Platsen på bilens rutt den dagen, från 1. null utan lastbil — då finns ingen rutt att stå på. */
  stop: number | null;
  /** Antalet jobb i gruppen. Med lastbil: montörens egna stopp på bilen den dagen. */
  of: number;
};

/** `truck: null` = "Utan lastbil". */
export type ScheduleTruckGroup<T> = { truck: string | null; stops: ScheduleStop<T>[] };

export type ScheduleDay<T> = { day: string; count: number; trucks: ScheduleTruckGroup<T>[] };

// Dagväljarens filter och dess räknare måste vara samma fråga, annars kan knappen säga "2 jobb" och
// dagen sedan visa ett. Bara den utbredda dagen: en rad utan `job_day` hör inte till en vald dag.
const onDay = (row: DayFields, day: string) => row.job_day === day;

/** Antalet jobb dagväljarens knapp för `day` visar. Samma urval som `groupScheduleStops(…, day)`. */
export function countScheduleRowsOnDay(rows: DayFields[], day: string): number {
  return rows.filter((row) => onDay(row, day)).length;
}

/**
 * Raderna som dagar, bilar och stopp.
 *
 * `onlyDay` satt: bara den dagen (dagväljarens knapp). null: hela veckan, en grupp per dag i
 * datumordning — en rad utan utbredd dag hamnar på sin startdag, och utan någon dag alls under
 * "okänd", så den aldrig försvinner tyst.
 *
 * Positionen räknas på MONTÖRENS EGNA jobb på bilen den dagen, inte på bilens alla — feeden ger bara
 * deras rader, och det är deras rutt kortet beskriver. Platshållare räknas som stopp: samma siffror
 * som planeringstavlan ("Jobb 1 av 2"), så planeraren och montören pratar om samma sak.
 *
 * ⚠️ ORDNINGEN INOM EN BIL ÄR compareScheduleRows, inte en egen jämförelse. Den är planeringstavlans
 * ordning (sort_index → startdag → id) med källan först; en andra jämförelse här hade glidit isär
 * från tavlan vid första ändringen.
 *
 * ⚠️ compareScheduleRows sorterar TOM BIL FÖRST (tomma strängen är minst). Grupperingen lägger
 * "Utan lastbil" SIST, med flit: jobben utan bil har ingen rutt och ingen siffra, och står de först
 * ser de ut som dagens första stopp.
 */
export function groupScheduleStops<T extends ScheduleRow & DayFields>(
  rows: T[],
  legacySortIndex: LegacySortIndex,
  onlyDay: string | null,
): ScheduleDay<T>[] {
  if (onlyDay != null) {
    const picked = rows.filter((row) => onDay(row, onlyDay));
    return picked.length ? [{ day: onlyDay, count: picked.length, trucks: groupTrucks(picked, legacySortIndex) }] : [];
  }
  const byDay = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.job_day || row.start_day || 'okänd';
    const list = byDay.get(key);
    if (list) list.push(row);
    else byDay.set(key, [row]);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'sv'))
    .map(([day, list]) => ({ day, count: list.length, trucks: groupTrucks(list, legacySortIndex) }));
}

function groupTrucks<T extends ScheduleRow>(rows: T[], legacySortIndex: LegacySortIndex): ScheduleTruckGroup<T>[] {
  const sorted = [...rows].sort((a, b) => compareScheduleRows(a, b, legacySortIndex));
  // Nyckeln är samma sträng som jämförelsen läser, så en bils stopp hamnar i en grupp i den ordning
  // jämförelsen satte dem. Map:en behåller insättningsordningen, alltså bilarnas ordning också.
  const byTruck = new Map<string, T[]>();
  const loose: T[] = [];
  for (const row of sorted) {
    // Trimmad: CRM-raden kommer trimmad ur crmJobToScheduleItem, den gamla raden som den står i
    // databasen. Samma bil med och utan ett blanksteg på slutet hade annars blivit två rubriker med
    // var sitt "Stopp 1".
    const truck = (row.truck || '').toString().trim();
    if (!truck) { loose.push(row); continue; }
    const list = byTruck.get(truck);
    if (list) list.push(row);
    else byTruck.set(truck, [row]);
  }
  const groups: ScheduleTruckGroup<T>[] = Array.from(byTruck.entries()).map(([truck, list]) => ({
    truck,
    stops: list.map((row, i) => ({ row, stop: i + 1, of: list.length })),
  }));
  if (loose.length) groups.push({ truck: null, stops: loose.map((row) => ({ row, stop: null, of: loose.length })) });
  return groups;
}

/**
 * En publicerad platshållare: en CRM-placering utan arbetsorder (service av maskiner, interna dagar).
 * Den har ingenting att öppna — ingen fältvy och ingen Blikk-detaljvy — och kortet fälls i stället ut.
 *
 * En regel, ett ställe: schemat avgör utfällningen och kortet sitt utseende på samma fråga.
 */
export function isSchedulePlaceholder(row: { source?: string; work_order_id?: string | null }): boolean {
  return row.source === 'crm' && !row.work_order_id;
}

/**
 * Referensen på kortets metarad: '#5418' / 'AO-…' för ett CRM-jobb, '#77' för en gammal Blikk-rad.
 *
 * CRM-raden bär redan sin färdiga referens (crmJobToScheduleItem → workOrderRef). Blikk-raden bär
 * det råa ordernumret, och det gamla kortet och /mina-jobb skrev det med '#' framför.
 */
export function scheduleRowRef(row: { source?: string; order_number?: string | number | null }): string | null {
  const raw = row.order_number == null ? '' : String(row.order_number).trim();
  if (!raw) return null;
  return row.source === 'crm' ? raw : `#${raw}`;
}

/**
 * Länken till fältvyn, eller null när kortet inte har någon arbetsorder att öppna.
 *
 * ⚠️ GRINDAD PÅ BÅDA: källan OCH order-id:t. En äldre Blikk-rad leder aldrig hit (den har sin
 * detaljmodal), och en CRM-platshållare har ingen order — `/arbetsorder/null` hade varit en knapp
 * som inte gör något.
 *
 * ⚠️ PLACERINGEN MÅSTE MED. Fältvyn är per arbetsorder och kan inte veta vilken etapp man kom ifrån
 * utan den — utan ?segment= får en besättning som bara ska göra etapp 1 hela ordern i handen.
 * Saknas segmentet visas helheten, precis som förut.
 */
export function workOrderHref(row: { source?: string; work_order_id?: string | null; segment_id?: string | number | null }): string | null {
  if (row.source !== 'crm' || !row.work_order_id) return null;
  const seg = row.segment_id ? `?segment=${encodeURIComponent(String(row.segment_id))}` : '';
  return `/arbetsorder/${row.work_order_id}${seg}`;
}

/**
 * Sant när projektnamnet bara upprepar adressen — många projekt heter efter gatan ("Strandgatan 9,
 * Skutskär"), och med adressen som rubrik hade samma gata stått två gånger på kortet.
 *
 * Jämför projektets första led (före första kommat) mot adressens början, ord för ord: "Strandgatan
 * 9" upprepar "Strandgatan 9, 814 30, Skutskär", men inte "Strandgatan 91, …", och "Strandgatan 9 –
 * vind" säger något adressen inte säger och står kvar.
 */
export function projectRepeatsAddress(projectName: string, address: string): boolean {
  const norm = (s: string) => s.toLocaleLowerCase('sv').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const street = norm(projectName.split(',')[0]);
  if (!street) return false;
  const full = norm(address);
  return full === street || full.startsWith(`${street} `);
}

/**
 * Metaradens delar: ['Stopp 1 av 2', '#5418'], ['Heldag', 'Intern'] …
 *
 * "Stopp X av Y" bara när bilen har fler än ett jobb den dagen, som planeringstavlans "Jobb 1 av 2"
 * (sharedDayOrders lämnar ensamma dagar). Ensam är platshållaren en heldag.
 *
 * "Intern" bara när platshållaren saknar kund. Den kan bära en (placeholder_customer — service hos en
 * kund), och då hade etiketten motsagt kundnamnet på raden under. En platshållare har ingen referens.
 */
export function scheduleStopMeta(
  row: { source?: string; work_order_id?: string | null; order_number?: string | number | null; customer?: string | null },
  stop: number | null,
  of: number,
): string[] {
  const placeholder = isSchedulePlaceholder(row);
  const parts: string[] = [];
  if (stop != null && of >= 2) parts.push(`Stopp ${stop} av ${of}`);
  else if (placeholder) parts.push('Heldag');
  if (placeholder) {
    if (!(row.customer || '').trim()) parts.push('Intern');
  } else {
    const ref = scheduleRowRef(row);
    if (ref) parts.push(ref);
  }
  return parts;
}

export type StopCallContact = {
  contactName: string | null;
  phone: string;
  isOnSiteContact: boolean;
  phoneFromCustomer: boolean;
};

/**
 * Kortets "Ring"-rad för orderns kontakt (getWorkOrderCallContacts — samma person som fältvyn visar).
 *
 * ⚠️ VEM SOM NÅS MÅSTE STÅ PÅ RADEN. Kontakten på plats är en ANNAN person än kundens kontakt — en
 * byggare beställer, fastighetsägaren står på plats — och fältvyn byter därför rubrik mellan
 * "Kontakt på plats" och "Kundkontakt". Här bär etiketten samma skillnad.
 *
 * Kundnamnet fyller bara i för kundens EGEN kontakt (där är kunden den personen när ingen kontakt
 * fångats). För en namnlös kontakt på plats hade det varit en påhittad identitet — byggarens
 * bolagsnamn över fastighetsägarens nummer. Ett lånat nummer säger vems det är, som i fältvyn.
 */
export function stopCallLine(contact: StopCallContact, customer: string | null | undefined): { label: string; note: string | null } {
  const name = contact.contactName?.trim() || null;
  if (contact.isOnSiteContact) {
    return {
      label: name ? `Ring ${name} (på plats)` : 'Ring kontakten på plats',
      note: contact.phoneFromCustomer ? 'Numret går till kundens kontakt – kontakten på plats har inget eget.' : null,
    };
  }
  const fallback = (customer || '').trim() || null;
  return { label: name || fallback ? `Ring ${name || fallback}` : 'Ring kunden', note: null };
}

/** Vägbeskrivningen. Samma URL-mönster som den äldre detaljmodalens "Öppna i Kartor". */
export function mapsSearchHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * "Dag 2 av 3" på ett flerdagarsjobb: vilken av jobbets ARBETSDAGAR `day` är.
 *
 * Arbetsdagar, inte kalenderdagar (Williams beslut 2026-10-22): ett jobb fre–mån är två dagars
 * arbete, inte fyra. Räknaren är produktionsrapportens (workingDaysInRange — mån–fre minus röda
 * dagar), så "dag" betyder samma sak på startsidan som i beläggningsgraden.
 *
 * null när det inte finns något att säga: ett jobb med en enda arbetsdag, eller en `day` som själv
 * inte är en arbetsdag. Feeden ger en rad per KALENDERdag, så ett jobb som spänner över en helg har
 * lördagsrader — "Dag 2 av 2" på en lördag hade varit fel siffra på fel dag.
 */
export function workdayPosition(day: string | null | undefined, startDay: string | null | undefined, endDay: string | null | undefined): { day: number; of: number } | null {
  if (!day || !startDay || !endDay || startDay === endDay) return null;
  const days = workingDaysInRange({ from: startDay, to: endDay });
  if (days.length < 2) return null;
  const index = days.indexOf(day);
  return index < 0 ? null : { day: index + 1, of: days.length };
}

const WEEKDAYS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];
const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

/**
 * '2026-10-22' → 'Torsdag 22 oktober' (`long`) eller 'Tor 22 okt' (`short`).
 *
 * Fälten plockas ur strängen och veckodagen ur dygnsnumret — ingen `Date` i lokal zon, så ingen
 * telefon i fel zon kan flytta dagen. Allt som inte är ett ISO-datum (feedens 'okänd') blir
 * 'Okänt datum'. Kortformen är de tre första bokstäverna i de långa namnen.
 */
export function scheduleDayLabel(iso: string, form: 'long' | 'short' = 'long'): string {
  const dayNumber = isoDayNumber(iso);
  if (dayNumber === null) return 'Okänt datum';
  const [, month, date] = iso.split('-').map(Number);
  // Dygn 0 (1970-01-01) var en torsdag: +3 ger dagar sedan måndag. Se mondayDayNumber.
  const weekday = WEEKDAYS[(((dayNumber + 3) % 7) + 7) % 7];
  const monthName = MONTHS[month - 1];
  return form === 'long' ? `${weekday} ${date} ${monthName}` : `${weekday.slice(0, 3)} ${date} ${monthName.slice(0, 3)}`;
}

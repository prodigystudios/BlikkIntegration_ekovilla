// Vilken dag och vilken månad /tid visar, ur veckan som står i remsan.
//
// Egen modul av samma skäl som dateParam.ts: ren logik med ett tydligt kontrakt, och just den här
// har redan kostat en gång. Veckan 28 sep–4 okt 2026 visade september så länge man stod i den —
// även på fredag 2 oktober. Månaden togs ur veckans MÅNDAG, så när september var inlämnad stod
// sidan på "september · Inlämnad" med september i periodkortet och i utläggen, och installatörerna
// trodde sig utelåsta ur oktober. Att bläddra en vecka fram och tillbaka var enda vägen ut.
//
// ⇒ MÅNADEN FÖLJER DEN VALDA DAGEN. Det är dagen man rapporterar på, och dess månad är perioden
// lönen räknar den på. Vid ett månadsskifte mitt i veckan byter sidan alltså period när man klickar
// över gränsen, och det är rätt: varje dag visas med sin egen månads låsläge.

import { periodRange, periodStartOf } from '@/lib/domains/time/approvals';

/**
 * Dagen som är vald i veckan. Den man klickat på om den står i remsan, annars idag om veckan är
 * denna, annars måndagen — man bläddrar bakåt för att titta på en vecka, och då är dess början rätt
 * startpunkt.
 */
export function selectDayInWeek(weekIsos: readonly string[], pickedIso: string, todayIso: string): string {
  if (weekIsos.includes(pickedIso)) return pickedIso;
  if (weekIsos.includes(todayIso)) return todayIso;
  return weekIsos[0];
}

export type PeriodWindow = {
  /** Hämtningens intervall: veckan OCH månaden, så varken dagrutorna eller månadssumman tappar rader. */
  from: string;
  to: string;
  monthStart: string;
  monthEnd: string;
  /** Attestperioden, 'YYYY-MM'. Alltid en kalendermånad — samma månad som summorna. */
  period: string;
};

/** Månaden som `dayIso` ligger i, plus det intervall som behöver hämtas för att rita veckan. */
export function periodWindow(weekIsos: readonly string[], dayIso: string): PeriodWindow {
  const monthStart = periodStartOf(dayIso);
  const { to: monthEnd } = periodRange(monthStart);
  const weekStart = weekIsos[0];
  const weekEnd = weekIsos[weekIsos.length - 1];
  return {
    from: weekStart < monthStart ? weekStart : monthStart,
    to: weekEnd > monthEnd ? weekEnd : monthEnd,
    monthStart,
    monthEnd,
    period: monthStart.slice(0, 7),
  };
}

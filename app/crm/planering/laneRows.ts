// Radplacering för korten i en bilrad på veckotavlan.
//
// Griden får INTE placera korten själv. Varje kort har ett explicit `gridColumn` (sitt dagsspann),
// men CSS-gridens autoplacering flyttar bara sin markör framåt och backar aldrig — så ett kort på
// tisdag hamnade på raden där måndagens sista kort slutade, och tavlan blev en trappa nedåt.
//
// Här får varje kort i stället den översta rad där hela dagsspannet är ledigt, så varje dag staplas
// uppifrån. Korten kommer in sorterade (dag, sedan ordningen badgen visar) och två kort som delar en
// dagkolumn blockeras av exakt samma rader — därför behåller packningen dagens ordning uppifrån och
// ner. Ett flerdagarskort kan alltså trycka ner en senare dags första kort, vilket är meningen.
export type LaneSpan = { s: number; e: number };

// `null` = kortet ligger helt på dolda dagar och renderas inte; det får en rad ändå så indexen
// följer segmentlistan ett-till-ett.
export function packRows(spans: Array<LaneSpan | null>, dayCount: number): number[] {
  const taken: boolean[][] = [];
  return spans.map((span) => {
    if (!span) return 1;
    let r = 0;
    for (;; r++) {
      if (!taken[r]) taken[r] = new Array(dayCount).fill(false);
      let free = true;
      for (let c = span.s; c <= span.e; c++) if (taken[r][c]) { free = false; break; }
      if (free) break;
    }
    for (let c = span.s; c <= span.e; c++) taken[r][c] = true;
    return r + 1; // grid-row är 1-indexerad
  });
}

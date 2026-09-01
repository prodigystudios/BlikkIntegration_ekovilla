// `?datum=` på /tid — vilken dag tidrapporten ska öppna på.
//
// Genvägarna från startsidans schema och Mina jobb skickar med jobbets dag, så att den som trycker
// "Rapportera tid" på gårdagens jobb inte landar på idag och för in passet på fel dygn.
//
// Egen modul och inte en hjälpare i page.tsx: den är ren logik med ett tydligt kontrakt och hör
// därför hemma i ett test, inte i en sidkomponent.

/**
 * Läser dagen ur adressen. Ogiltigt värde ger `null`, och sidan öppnar på idag.
 *
 * ⚠️ Regexen ensam räcker inte. `2026-02-31` matchar `\d{4}-\d{2}-\d{2}` utmärkt, och
 * `new Date(2026, 1, 31)` glider tyst vidare till 3 mars — ett datum ur adressfältet får aldrig bli
 * ett `Date` någon räknar veckor med utan att först ha bevisat att dagen finns. Round-trip-provet
 * nedan är det beviset: formaterar datumet tillbaka till exakt samma sträng, eller så gör det inte
 * det och vi kastar värdet.
 *
 * UTC i provet med flit — det handlar bara om huruvida dagen existerar i kalendern. Veckoräkningen i
 * TidClient sker i lokal tid, som den ska.
 */
export function parseDateParam(value: string | string[] | undefined | null): string | null {
  // Next ger en array när parametern står två gånger i adressen. Första värdet vinner; att svara
  // null där hade gjort en dubblerad parameter till en tyst hoppning tillbaka till idag.
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : raw;
}

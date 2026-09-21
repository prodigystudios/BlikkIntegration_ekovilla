/**
 * Står förkalkylen på bara en DEL av orderns intäkt?
 *
 * 🧨 SLUT DIG ALDRIG TILL JÄMFÖRBARHETEN, MÄT DEN. Förkalkylen lyfter ut rader som inte går att
 * kostnadsbedöma ur både täljare och nämnare; efterkalkylen räknar på hela orderns intäkt och
 * svarar okänt så fort en rad saknar pris. Det förleder till slutsatsen "finns ett utfallstal, då
 * lyfte planen inte ut något" — och den är FALSK. En blåst rad utan densitet ger noll planerade
 * säckar och lyfts ut ur planen, men efterkalkylen ser den aldrig bland `otherMaterialRows` (den är
 * blåst) och den når därför aldrig `unpricedLabels`. Uppmätt: plan 100,0 % på 3 000 kr bredvid
 * utfall 50,3 % på 93 000 kr, utan en enda lucka som sa ifrån.
 *
 * Att jämföra intäkterna direkt kostar ingenting och kan inte glida isär från verkligheten på det
 * sätt en härledning kan.
 *
 * Halvkronan är mot flyttalsbrus. En utlyft rad är aldrig ett avrundningsfel — vidga den inte.
 */
export function planIsPartial(planRevenue: number, orderRevenue: number | null): boolean {
  if (orderRevenue == null || !Number.isFinite(orderRevenue)) return false;
  return Math.abs(planRevenue - orderRevenue) > 0.5;
}

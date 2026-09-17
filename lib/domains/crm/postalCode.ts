/**
 * Postnummerfältet som bär orten — "79192 Falun" i stället för "79192" + "Falun".
 *
 * 🧨 VARFÖR: Fortnox avvisar det, men först flera steg senare och med ett 400 som inte pekar på
 * fältet. Uppmätt i drift 2026-09-17: en kund kunde inte skapas i Fortnox, orderpushen föll på
 * "Ingen Fortnox-kundkoppling", och den verkliga orsaken satt i ett postnummerfält som ingen hade
 * anledning att misstänka. Noll av 100 kunder i Fortnox har bokstäver i `ZipCode`.
 *
 * ⚠️ REGELN ÄR BOKSTÄVER, INTE MELLANSLAG. Svenska postnummer skrivs ofta "791 92", och en spärr på
 * mellanslag hade flaggat varje korrekt inskrivet nummer i landet.
 */

/**
 * Delar "79192 Falun" i postnummer och ort. Returnerar null när fältet ser rätt ut.
 *
 * Kräver att det FINNS en ort efter siffrorna — "791 92" ensamt är ett giltigt postnummer och ska
 * inte röras. Fem siffror, med eller utan mellanslag i mitten, sedan resten som ort.
 */
export function splitPostalCodeAndCity(raw: string | null | undefined): { postalCode: string; city: string } | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  const match = value.match(/^(\d{3})\s?(\d{2})\s+(.+)$/);
  if (!match) return null;

  const city = match[3].trim();
  if (!city) return null;

  return { postalCode: `${match[1]}${match[2]}`, city };
}

/**
 * Varningen som visas vid postnummerfältet, eller null när allt ser rimligt ut.
 *
 * ⚠️ VARNAR, SPÄRRAR INTE. Fältet är fritext och bär utländska kunder också — en hård spärr hade
 * blockerat en adress som är riktig men ovanlig, och den sortens spärr lärs man sig att kringgå.
 * Den som ändå sparar får sitt värde, men har sett vad Fortnox kommer att säga.
 *
 * `city` skickas med för att skilja tre lägen åt:
 *   • Ort TOM        → orten är på väg att tappas. Nämn den, så säljaren ser vad som ska flyttas.
 *   • Ort = samma    → ren dubblering. Säg bara att siffrorna ska stå ensamma.
 *   • Ort = NÅGOT ANNAT → 🧨 KONFLIKT, och den är värst av de tre: två orter, och Fortnox får den
 *     som råkar stå i rätt fält. Båda måste nämnas, annars ser säljaren aldrig motsägelsen.
 */
export function postalCodeWarning(
  postalCode: string | null | undefined,
  city?: string | null,
): string | null {
  const value = (postalCode ?? '').trim();
  if (!value) return null;
  if (!/[a-zA-ZåäöÅÄÖ]/.test(value)) return null;

  const split = splitPostalCodeAndCity(value);
  if (split) {
    const ort = (city ?? '').trim();
    const same = ort.toLocaleLowerCase('sv-SE') === split.city.toLocaleLowerCase('sv-SE');
    if (ort && !same) {
      return `Postnumret säger "${split.city}" men Ort säger "${ort}". Skriv ${split.postalCode} här `
        + 'och låt Ort bära orten — Fortnox tar bara siffror i postnummerfältet.';
    }
    const target = ort ? 'Ort-fältet' : `Ort-fältet (${split.city})`;
    return `Orten ligger i postnummerfältet. Fortnox tar bara siffror här — skriv ${split.postalCode} `
      + `och flytta orten till ${target}.`;
  }

  return 'Postnumret innehåller bokstäver. Fortnox tar bara siffror här.';
}

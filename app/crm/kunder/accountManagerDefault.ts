// Förvalet för kundansvarig i formuläret "Ny kund".
//
// Säljarna bad om det (2026-10-05): en ny kund blev ofta utan ansvarig för att ingen kom ihåg
// väljaren. Den som skapar kunden förväljs därför, men bara med rollen `sales`.
//
// ⚠️ INTE admin, fast admin står i säljarkatalogen. En admin skapar kunder åt andra: från en offert
// som tillhör en annan säljare (då hade admin blivit kundansvarig, och den vunna offertens säljare
// kunnat ta över bara ett TOMT fält, se setAccountManagerIfUnset), eller en butik till
// Partnerportalen (där kundansvarig går före länets säljare när portaljobben fördelas).
//
// Bara formuläret. Servern sätter inget förval, så prospekt ur samtalsloggen och importerna blir
// utan ansvarig som förut. Förvalet räknas ut på servern så att fältet är ifyllt från första
// renderingen: en sparning hinner aldrig gå iväg innan säljarkatalogen laddats.
export type AccountManagerOption = { id: string; name: string };

export function defaultAccountManager(
  profile: { id: string; role: string; full_name: string | null } | null,
): AccountManagerOption | null {
  if (!profile || profile.role !== 'sales') return null;
  // Samma namnregel som rullistans alternativ (`full_name || id`), så att raden inte byter text
  // när katalogen kommer.
  return { id: profile.id, name: profile.full_name || profile.id };
}

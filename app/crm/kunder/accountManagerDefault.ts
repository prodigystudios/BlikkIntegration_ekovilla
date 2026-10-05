// Förvalet för kundansvarig i formuläret "Ny kund".
//
// Säljarna bad om det (2026-10-05): en ny kund blev ofta utan ansvarig för att ingen kom ihåg
// väljaren. Den som skapar kunden förväljs därför, men bara om hen står i säljarkatalogen
// (/api/crm/sellers, profiles med rollen sales eller admin). Alla andra får tomt som förut,
// eftersom en kundansvarig utanför katalogen inte går att välja bort i rullistan.
//
// Ett värde som redan står i fältet lämnas orört. Förvalet är ett förslag, inte en regel.
//
// ⚠️ Bara formuläret. Servern sätter inget förval: prospekt ur samtalsloggen och importerna
// blir utan ansvarig som förut. Det är också därför den vunna offertens säljare fortfarande
// kan fylla i en tom kundansvarig (setAccountManagerIfUnset).
export function defaultAccountManagerId(
  current: string,
  sellers: ReadonlyArray<{ id: string }>,
  currentUserId: string | null | undefined,
): string {
  if (current) return current;
  if (!currentUserId) return '';
  return sellers.some((s) => s.id === currentUserId) ? currentUserId : '';
}

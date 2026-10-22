/**
 * Det kundkortets editor skickar när den sparar: bara fälten användaren ändrade sedan editorn öppnades. `body` och
 * `base` är samma serialisering av utkastet nu och utkastet som editorn öppnades med.
 *
 * 🧨 Editorn skickade tidigare hela kortet. Hade någon annan fyllt i ett fält medan editorn stod öppen — kortpasset i
 * kundsynken, en kollega — skrevs det över med editorns gamla värde. En gammal tomhet räknas dessutom som en tömning,
 * och PATCH-routen tömmer numera fältet i Fortnox också (fortnoxCustomerClears). Då hade värdet raderats även där.
 *
 * Momsnumret följer alltid med org.numret. deriveVatNumberForWrite härleder SE…01 när org.numret ändras utan att
 * momsnumret skickas, men i editorn har det redan härletts medan användaren skrev — eller tömts med flit.
 */
export function changedCustomerEditFields(
  body: Record<string, unknown>,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (JSON.stringify(value) !== JSON.stringify(base[key])) changed[key] = value;
  }
  if ('organization_number' in changed && 'vat_number' in body) changed.vat_number = body.vat_number;
  return changed;
}

// Parse a user-entered decimal that may use a Swedish comma separator ("1,5")
// and/or spaces as thousands separators ("1 200,50"). Returns `fallback` when the
// value is empty or not a finite number.
//
// Use this everywhere a free-text numeric string is turned into a number — plain
// parseFloat("1,5") returns 1, silently dropping the decimal part for sv-SE input.
export function parseDecimal(value: string | number | null | undefined, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (value == null) return fallback;
  const normalized = String(value).replace(/\s+/g, '').replace(',', '.');
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Städar ett sifferfält när användaren lämnar det: "162m" → "162", " 52 " → "52", "67.5" → "67,5".
//
// ⚠️ Fälten är fritext och `parseDecimal` räddar matten, så skräp överlever tyst i databasen och
// dyker upp i läsläget som "162m m² × 190 mm" — vilket är precis vad en riktig order hade.
// Normaliseringen sker vid blur i editorn, alltså där smutsen uppstod. Läsläget lämnas orört med
// flit: en rad som fortfarande skriver "162m" är signalen att just den behöver röras.
//
// ⚠️ Skriver om ENDAST det som otvetydigt är ett tal med en enhet efter. Allt annat lämnas orört.
//
// En svagare vakt ("innehåller minst en siffra" + parseDecimal) räcker inte, för `parseDecimal`
// bygger på parseFloat och läser glatt prefixet av vad som helst. Den hade tyst gjort
//   "6x8" → "6",  "3/4" → "3",  "24 32" → "2432",  "1,200" → "1,2"
// och sparat det felaktiga talet. Matten är visserligen redan fel i de fallen — parseDecimal
// räknar likadant — men strängen är det enda som fortfarande VISAR att raden behöver rättas, och
// den här funktionen finns just för att bevara den signalen, inte för att sudda den.
//
// Decimaldelen tillåts vara högst två siffror med flit: "1,200" är tvetydigt (tusental eller
// decimal?) och lämnas hellre som det står än gissas till 1,2.
const CLEAN_DECIMAL = /^(-?\d+(?:[.,]\d{1,2})?)\s*[^\d]*$/;

export function normalizeDecimalInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const match = CLEAN_DECIMAL.exec(trimmed);
  if (!match) return raw;
  const parsed = parseDecimal(match[1], NaN);
  if (!Number.isFinite(parsed)) return raw;
  // Tillbaka till husets svenska decimalkomma, så "67.5" och "67,5" blir samma sträng.
  return String(parsed).replace('.', ',');
}

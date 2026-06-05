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

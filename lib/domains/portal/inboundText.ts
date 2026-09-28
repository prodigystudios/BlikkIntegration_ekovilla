/**
 * Text i en kropp från portalen som Postgres inte kan spara: ett nolltecken (`\u0000`) eller ett ensamt surrogat
 * (`\ud800` utan sin andra halva). Båda går igenom JSON.parse, men jsonb och text nekar dem. Utan kontrollen hade
 * insert:en fallit som 500, portalen gjort om anropet i två dygn och jobbet aldrig kommit fram eller fått ett begripligt
 * nej. (Samma två tecken som client.ts städar bort ur utgående felmeddelanden.)
 *
 * Prövar både nycklar och värden, eftersom hela kroppen sparas som den kom.
 */
const UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Sökvägen till den första texten som inte kan sparas (`workplace.notes`), eller null. */
export function findUnstorableText(value: unknown, path: string[] = []): string | null {
  if (typeof value === 'string') return UNSTORABLE.test(value) ? path.join('.') || '(kroppen)' : null;
  // Också arrayer: Object.entries ger deras index som nycklar (`lines.1.name`).
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (UNSTORABLE.test(key)) return [...path, '(nyckel)'].join('.');
      const found = findUnstorableText(child, [...path, key]);
      if (found !== null) return found;
    }
  }
  return null;
}

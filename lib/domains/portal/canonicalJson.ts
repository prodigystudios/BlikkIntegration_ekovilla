/**
 * JSON med sorterade nycklar, rekursivt. Två lika objekt ger samma text oavsett i vilken ordning nycklarna skrevs,
 * och oavsett jsonb:s egen nyckelordning. Används där texten jämförs eller hashas: kön (samma händelse köad två
 * gånger) och prislistans hash (samma innehåll = samma Idempotency-Key).
 *
 * Arrayer behåller sin ordning: den bär betydelse (prislistans artiklar står i sin ordning).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

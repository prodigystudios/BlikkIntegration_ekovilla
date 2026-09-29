/** Ett fels text: meddelandet för ett Error, annars värdet som text. */
export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * En fråga som aldrig kastar: ett avvisat löfte (nätet, en tidsgräns) blir ett fel i Supabase-form, som ett fel från
 * databasen. Används där ett fel ska loggas eller läsas som ett utfall, inte avbryta (claimarna, svepets plan).
 */
export function settle<T extends { error: { message: string } | null }>(
  query: PromiseLike<T>,
): Promise<T | { data: null; error: { message: string } }> {
  return Promise.resolve(query).then(
    (r) => r,
    (err: unknown) => ({ data: null, error: { message: errorText(err) } }),
  );
}

// Pure, client-safe article search helpers (NO server/db imports) so the server-side cache query
// and the client-side article-register filter tokenise identically. Both split the query into
// terms and require each term to appear (in the number OR the description), regardless of word
// order — so "lösull 15" finds "Cellulosa lösull 15kg" even though a single contains-match wouldn't.

// Split a free-text search into individual terms. Tokens are sanitised of characters that are
// structural in a PostgREST `.or()` filter string (`, ( )`) or are LIKE wildcards (`% _`) so the
// same tokens are safe on the server; a raw comma in the query (e.g. "15,5") would otherwise
// corrupt the server filter.
export function articleSearchTokens(search: string | undefined | null): string[] {
  return (search ?? '')
    .split(/\s+/)
    .map((t) => t.replace(/[%_,()\\*"]/g, '').trim())
    .filter((t) => t.length > 0);
}

// Stable partition that floats global favorites to the top, preserving each group's existing
// order. Shared by the server query and the client-side re-sort after a star toggle.
export function sortArticlesFavoritesFirst<T extends { is_favorite?: boolean | null }>(rows: T[]): T[] {
  const favorites = rows.filter((r) => r.is_favorite);
  const rest = rows.filter((r) => !r.is_favorite);
  return [...favorites, ...rest];
}

// Client-side AND-across-tokens match over an article's number + description. Mirrors the server
// predicate `(number ILIKE %t% OR description ILIKE %t%) AND …` for every token.
export function matchesArticleSearch(
  article: { article_number?: string | null; description?: string | null },
  search: string | undefined | null,
): boolean {
  const tokens = articleSearchTokens(search);
  if (tokens.length === 0) return true;
  const number = (article.article_number ?? '').toLowerCase();
  const description = (article.description ?? '').toLowerCase();
  return tokens.every((t) => {
    const term = t.toLowerCase();
    return number.includes(term) || description.includes(term);
  });
}

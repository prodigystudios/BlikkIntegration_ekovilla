// Vart en detaljvy ska tillbaka när man kom dit från en annan yta.
//
// En detaljvy vet inte var man kom ifrån — arbetsordern öppnas både från sin egen lista och från
// planeringskalendern, offertformuläret både från offertlistan och från säljtavlan. Utan ett
// `?returnTo=` landar man alltid i listan, alltså inte där man var.
//
// ⚠️ Värdet kommer från URL:en och är därmed användarstyrt. Bara app-interna CRM-sökvägar godtas:
// utan spärren blir `?returnTo=https://…` en öppen vidarebefordran som tar användaren ut ur appen
// från en sida de litar på. `/crm/`-prefixet räcker som spärr — protokollrelativa adresser
// (`//värd`, `/\värd`), som webbläsaren behandlar som externa, klarar inte prefixet.
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.startsWith('/crm/') ? raw : null;
}

/** Lägg på `?returnTo=` (eller `&`) på en app-intern länk. */
export function withReturnTo(href: string, returnTo: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(returnTo)}`;
}

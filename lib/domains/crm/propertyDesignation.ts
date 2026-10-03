// Fastighetsbeteckning (ROT). Rena funktioner, ingen sidoeffekt — anropas både från formulären
// medan man skriver och från API-schemana och Fortnox-pushen, och testas fristående i tests/crm/.
//
// 🧨 SEMIKOLON SPARAS INTE I FORTNOX. En beteckning skrivs Block:Enhet ("Haggården 6:3"). Fortnox
// API tar emot "6;3" utan att protestera — på dokumentets referensfält, i textraden och på
// skattereduktionsposten — men husarbetesfliken i Fortnox går sedan inte att spara förrän någon
// rättat beteckningen för hand (William, 2026-10-03). Felet syns alltså inte hos oss och inte vid
// pushen, utan först när ekonomi ska skicka begäran till Skatteverket.
//
// `;` och `:` sitter på grannstangenter på ett svenskt tangentbord, så ett semikolon i en
// beteckning är ett slag fel och rättas, i stället för att nekas.

/** Medan man skriver: bara semikolonet. Mellanslag rörs inte — det hade slagits mot tangentbordet. */
export function fixPropertyDesignationTyping(value: string): string {
  return value.replace(/;/g, ':');
}

/**
 * Det som sparas och skickas: semikolon → kolon, blanktecken ihopslagna, trimmat. Tomt blir null —
 * samma tomhet som de övriga ROT-fälten.
 */
export function normalizePropertyDesignation(value: string | null | undefined): string | null {
  const normalized = fixPropertyDesignationTyping(String(value ?? '')).replace(/\s+/g, ' ').trim();
  return normalized || null;
}

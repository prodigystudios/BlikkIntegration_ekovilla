import { normalizeKmaName } from '@/lib/domains/crm/kmaPlans/directory';

import { FOLLOW_UP_FIELDS } from './schemas';

// Serverns regler för skyddsronden — rena funktioner som rutterna anropar, så att de går att testa
// utan en rutt runt sig.

/**
 * Personen bakom rondledarens NAMN. Rondledaren är ett namn (ur Kontaktlistan eller skrivet), inte en
 * profil, och kopplingen till en profil följer bara med så länge namnet är den inloggades eget.
 * Skrivs ett annat namn in släpps den — annars hade en senare påminnelse (PR 3) gått till fel person.
 */
export function leaderIdForName(
  leaderName: string | null,
  currentUser: { id: string; name?: string | null },
): string | null {
  if (leaderName == null || currentUser.name == null) return null;
  return normalizeKmaName(leaderName) === normalizeKmaName(currentUser.name) ? currentUser.id : null;
}

/**
 * Rör ändringen BARA uppföljningen (status, uppföljt datum, effekt, notering)? Det är det enda som
 * får ändras på en åtgärd när ronden är slutförd; triggern i databasen spärrar resten, och rutten
 * svarar på det i förväg med ett begripligt meddelande.
 */
export function isFollowUpOnlyPatch(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).every((key) => (FOLLOW_UP_FIELDS as readonly string[]).includes(key));
}

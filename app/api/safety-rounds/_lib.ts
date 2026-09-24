import { can, getEffectivePermissions } from '@/lib/auth/permissions';
import { requireSignedInUser } from '@/lib/auth/guards';
import { routeError } from '@/lib/api/responses';

// Delat för skyddsrondernas rutter.
//
// LÄSNING kräver safety.round.read ELLER safety.round.write — samma som select-policyerna i
// 20260924_safety_rounds.sql. Den som fått bara skrivnyckeln personligt måste kunna läsa ronden hen
// fyller i, och requirePermission kan bara pröva en nyckel. `canWrite` följer med svaret så att
// klienten aldrig ritar en knapp vars enda utfall är 403.
export async function requireSafetyRoundReader() {
  const guard = await requireSignedInUser();
  if (guard.response || !guard.currentUser) return { currentUser: null, canWrite: false, response: guard.response };

  const perms = await getEffectivePermissions();
  const canWrite = can(perms, 'safety.round.write');
  if (!canWrite && !can(perms, 'safety.round.read')) {
    return { currentUser: null, canWrite: false, response: routeError(403, 'forbidden', 'Forbidden') };
  }
  return { currentUser: guard.currentUser, canWrite, response: null };
}

type DbError = { code?: string; message?: string } | null | undefined;

/**
 * Svaret på en skrivning. PostgREST ger INGET fel när RLS stoppar en UPDATE/DELETE — bara noll
 * rader — så `data === null` utan fel är "ronden är slutförd, eller raden finns inte" och får ett
 * eget svar i stället för ett falskt "sparat".
 */
export function writeFailure(error: DbError, what: string) {
  if (error?.code === '42501') {
    return routeError(403, 'safety_round_forbidden', error.message?.includes('slutförd')
      ? 'Ronden är slutförd. Bara uppföljningen av åtgärderna kan ändras.'
      : 'Du har inte behörighet att ändra skyddsronden.');
  }
  if (error?.code === '23514' || error?.code === '22P02') {
    return routeError(400, 'safety_round_invalid', `Ogiltigt värde (${what}).`);
  }
  if (error) return routeError(500, 'safety_round_write_failed', error.message || `Kunde inte spara ${what}.`);
  return routeError(409, 'safety_round_locked', 'Ronden är slutförd eller raden finns inte längre. Ladda om sidan.');
}

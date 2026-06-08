import { routeError } from '../crm/_shared';
import { FortnoxApiError, FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';

export { ok, routeError, validationError, requireCrmAdmin, requireCrmUser, requireCrmWriter } from '../crm/_shared';

// Translate a thrown error from a Fortnox write into a deliberate route response.
// FortnoxNotConnectedError → 400 (admin must connect first); FortnoxApiError keeps
// Fortnox's own status (e.g. 4xx when a record is in use and cannot be deleted).
// The user-facing `error` message is the friendly translation; the raw technical
// detail stays in the server logs.
export function fortnoxWriteError(e: unknown, code: string, fallback: string) {
  if (e instanceof FortnoxApiError || e instanceof FortnoxNotConnectedError) {
    console.error('[Fortnox]', (e as Error).message);
  }
  if (e instanceof FortnoxNotConnectedError) {
    return routeError(400, 'fortnox_not_connected', friendlyFortnoxMessage(e));
  }
  if (e instanceof FortnoxApiError) {
    const status = e.status >= 400 && e.status < 600 ? e.status : 502;
    return routeError(status, 'fortnox_api_error', friendlyFortnoxMessage(e));
  }
  return routeError(500, code, (e as any)?.message || fallback);
}

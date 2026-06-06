import { routeError } from '../crm/_shared';
import { FortnoxApiError, FortnoxNotConnectedError } from '@/lib/domains/fortnox/client';

export { ok, routeError, validationError, requireCrmAdmin, requireCrmUser } from '../crm/_shared';

// Translate a thrown error from a Fortnox write into a deliberate route response.
// FortnoxNotConnectedError → 400 (admin must connect first); FortnoxApiError keeps
// Fortnox's own status (e.g. 4xx when a record is in use and cannot be deleted).
export function fortnoxWriteError(e: unknown, code: string, fallback: string) {
  if (e instanceof FortnoxNotConnectedError) {
    return routeError(400, 'fortnox_not_connected', e.message);
  }
  if (e instanceof FortnoxApiError) {
    const status = e.status >= 400 && e.status < 600 ? e.status : 502;
    return routeError(status, 'fortnox_api_error', e.message);
  }
  return routeError(500, code, (e as any)?.message || fallback);
}

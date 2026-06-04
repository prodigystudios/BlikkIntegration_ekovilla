import { requireCrmAdmin, ok, routeError } from '../../_shared';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';

export async function GET() {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    const status = await getFortnoxConnectionStatus();
    return ok(status);
  } catch (e: any) {
    return routeError(500, 'fortnox_status_failed', e?.message || 'Kunde inte hämta Fortnox-status');
  }
}

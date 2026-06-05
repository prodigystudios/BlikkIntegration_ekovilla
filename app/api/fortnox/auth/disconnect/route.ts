import { requireCrmAdmin, ok, routeError } from '../../_shared';
import { disconnectFortnoxIntegration } from '@/lib/domains/fortnox/auth';

export async function POST() {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    await disconnectFortnoxIntegration();
    return ok({ disconnected: true });
  } catch (e: any) {
    return routeError(500, 'fortnox_disconnect_failed', e?.message || 'Kunde inte koppla från Fortnox');
  }
}

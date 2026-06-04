import { requireCrmAdmin, ok, routeError } from '../../_shared';
import { syncFortnoxCustomers } from '@/lib/domains/fortnox/customers';

export async function POST() {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    const result = await syncFortnoxCustomers(admin.currentUser!.id);
    return ok({ created: result.created, updated: result.updated, pages: result.pages });
  } catch (e: any) {
    return routeError(500, 'fortnox_customers_sync_failed', e?.message || 'Kundsynk misslyckades');
  }
}

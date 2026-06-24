import { requireCrmAdmin, ok, routeError } from '../../_shared';
import { verifyCustomerTypesBatch } from '@/lib/domains/fortnox/customers';

// Processes one throttled batch of heuristic-imported customers and confirms their
// Type against Fortnox. Resumable – the client loops until remaining === 0.
export const maxDuration = 60;

export async function POST() {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    const result = await verifyCustomerTypesBatch();
    return ok(result);
  } catch (e: any) {
    return routeError(500, 'fortnox_verify_types_failed', e?.message || 'Verifiering av kundtyper misslyckades');
  }
}

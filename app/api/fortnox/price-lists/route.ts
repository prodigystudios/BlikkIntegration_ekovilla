import { requireCrmUser, ok, routeError } from '../_shared';
import { listFortnoxPriceLists } from '@/lib/domains/fortnox/customers';

// List the account's price-list register from Fortnox so the customer form can
// offer valid codes instead of free text.
export async function GET() {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    try {
      const items = await listFortnoxPriceLists();
      return ok({ items });
    } catch (fortnoxErr: any) {
      // Don't break the form if Fortnox can't serve the register (e.g. missing
      // scope, not connected). Degrade to free text and surface the real reason.
      console.error('[Fortnox] Kunde inte hämta prislistor:', fortnoxErr?.message || fortnoxErr);
      return ok({ items: [], fortnox_error: fortnoxErr?.message || 'Kunde inte hämta prislistor från Fortnox' });
    }
  } catch (e: any) {
    return routeError(500, 'fortnox_price_lists_failed', e?.message || 'Kunde inte hämta prislistor');
  }
}

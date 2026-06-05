import { requireCrmUser, ok, routeError } from '../_shared';
import { listFortnoxTermsOfPayment } from '@/lib/domains/fortnox/customers';

// List the account's terms-of-payment register from Fortnox so the customer
// form can offer valid codes instead of free text.
export async function GET() {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    try {
      const items = await listFortnoxTermsOfPayment();
      return ok({ items });
    } catch (fortnoxErr: any) {
      // Don't break the form if Fortnox can't serve the register (e.g. missing
      // scope, not connected). Degrade to free text and surface the real reason.
      console.error('[Fortnox] Kunde inte hämta betalningsvillkor:', fortnoxErr?.message || fortnoxErr);
      return ok({ items: [], fortnox_error: fortnoxErr?.message || 'Kunde inte hämta betalningsvillkor från Fortnox' });
    }
  } catch (e: any) {
    return routeError(500, 'fortnox_terms_of_payment_failed', e?.message || 'Kunde inte hämta betalningsvillkor');
  }
}

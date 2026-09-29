import { requirePagePermission } from '@/lib/auth/pageGuards';
import { createSessionClient } from '@/lib/supabase/session';
import { listStoreOrderViews } from '@/lib/domains/portal/storeOrdersView';
import StoreOrdersClient from './StoreOrdersClient';

export const dynamic = 'force-dynamic';

// Butiksbeställningarna från återförsäljarportalen (RESELLER_PORTAL_CRM_PLAN.md fas 8): butikerna köper material ur
// prislistan. Alla med crm.access ser dem (William 2026-09-29). Grinden står här också: layoutens grind stoppar inte
// sidans egen kod, som körs parallellt med den.
//
// Ingen rad i CRM-menyn än: menyn delas av hela appen, och posten läggs till när integrationen slås på. Sidan nås
// från notisen och från adressen.
export default async function StoreOrdersPage() {
  await requirePagePermission('crm.access');
  const result = await listStoreOrderViews(createSessionClient()).then(
    (list) => ({ ok: true as const, ...list }),
    (e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : 'Beställningarna gick inte att läsa.' }),
  );
  return result.ok ? (
    <StoreOrdersClient orders={result.orders} capped={result.capped} />
  ) : (
    <StoreOrdersClient orders={[]} capped={false} error={result.message} />
  );
}

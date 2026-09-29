import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePagePermission } from '@/lib/auth/pageGuards';
import { isUuid } from '@/lib/api/responses';
import { createSessionClient } from '@/lib/supabase/session';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import ErrorState from '@/components/ui/ErrorState';
import { getStoreOrderView } from '@/lib/domains/portal/storeOrdersView';
import StoreOrderDetail from './StoreOrderDetail';

export const dynamic = 'force-dynamic';

// En butiksbeställning (RESELLER_PORTAL_CRM_PLAN.md fas 8). Alla med crm.access läser (RLS). Grinden står här också:
// layoutens grind stoppar inte sidans egen kod, som körs parallellt med den.
export default async function StoreOrderPage({ params }: { params: { id: string } }) {
  await requirePagePermission('crm.access');
  if (!isUuid(params.id)) notFound();
  const read = await getStoreOrderView(createSessionClient(), params.id).then(
    (order) => ({ ok: true as const, order }),
    (e: unknown) => {
      // Databasens text stannar i loggen, som på listan.
      console.error('[butiksbestallningar] beställningen gick inte att läsa', { id: params.id, error: e instanceof Error ? e.message : String(e) });
      return { ok: false as const };
    },
  );
  if (!read.ok) {
    return (
      <div className="grid grid-cols-1 gap-4">
        <Link href="/crm/butiksbestallningar" className={cn(crm.link, 'w-fit text-sm')}>
          Alla butiksbeställningar
        </Link>
        <ErrorState title="Beställningen gick inte att läsa." message="Ladda om sidan för att försöka igen." />
      </div>
    );
  }
  if (!read.order) notFound();
  return <StoreOrderDetail order={read.order} />;
}

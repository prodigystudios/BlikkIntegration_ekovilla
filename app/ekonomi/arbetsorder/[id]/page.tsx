import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import PageShell from '@/components/ui/PageShell';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import WorkOrderDetailClient from '@/app/crm/arbetsorder/WorkOrderDetailClient';
import { readEkonomiAccess, canReadWorkOrders } from '../../_lib/access';

export const dynamic = 'force-dynamic';

// En arbetsorder, hela vägen igenom men utan en enda skrivingång.
//
// SAMMA komponent som /crm/arbetsorder/[id], med readOnly. Byrån ska se det säljarna ser — rader,
// priser, efterkalkyl, TB1/TB2 och marginaler — för det är det som ÄR fakturaunderlaget. Det som
// stängs av är att ändra något av det.
//
// ⚠️ readOnly är en UI-spärr, inte en säkerhetsgräns. Det som faktiskt nekar är rutternas nycklar
// och RLS: byrån har crm.access + crm.workorder.read och INGEN skrivnyckel, så varje mutation
// svarar 403 oavsett vad som ritas. Flaggan finns för att inte visa dörrar som är låsta — samma
// felklass som attestvyns "Rätta"-knappar gick i, där lönebyrån fick knappar vars enda utfall var
// ett 403 efter att formuläret fyllts i.
export default async function EkonomiWorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Behörigheten först: ingen anledning att fråga Fortnox om något för den som ändå studsar ut.
  const { userId, held } = await readEkonomiAccess();
  if (!userId) redirect('/auth/sign-in');
  if (!canReadWorkOrders(held)) redirect('/ekonomi');

  const fortnoxStatus = await getFortnoxConnectionStatus().catch(() => ({ connected: false }));

  return (
    <PageShell className="max-w-[1460px]">
      <Suspense>
        <WorkOrderDetailClient
          workOrderId={id}
          fortnoxConnected={fortnoxStatus.connected}
          currentUserId={userId}
          readOnly
          // Bakåtknappen ska till ekonomiytans egen lista. Utan det pekar den på /crm/arbetsorder,
          // där rollgrinden kastar ut en ekonomianvändare till startsidan.
          homePath="/ekonomi/arbetsorder"
          homeLabel="Arbetsordrar"
        />
      </Suspense>
    </PageShell>
  );
}

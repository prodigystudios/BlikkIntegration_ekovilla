import { Suspense } from 'react';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import WorkOrderDetailClient from '../WorkOrderDetailClient';

export const dynamic = 'force-dynamic';

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fortnoxStatus = await getFortnoxConnectionStatus().catch(() => ({ connected: false }));
  return (
    <Suspense>
      <WorkOrderDetailClient workOrderId={id} fortnoxConnected={fortnoxStatus.connected} />
    </Suspense>
  );
}

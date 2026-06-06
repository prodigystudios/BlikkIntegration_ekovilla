import { Suspense } from 'react';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import { getCurrentUser } from '@/lib/auth/route';
import WorkOrderDetailClient from '../WorkOrderDetailClient';

export const dynamic = 'force-dynamic';

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [fortnoxStatus, currentUser] = await Promise.all([
    getFortnoxConnectionStatus().catch(() => ({ connected: false })),
    getCurrentUser().catch(() => null),
  ]);
  return (
    <Suspense>
      <WorkOrderDetailClient workOrderId={id} fortnoxConnected={fortnoxStatus.connected} currentUserId={currentUser?.id ?? null} />
    </Suspense>
  );
}

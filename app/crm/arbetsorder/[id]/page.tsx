import { Suspense } from 'react';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import { getCurrentUser } from '@/lib/auth/route';
import { hasCrmPermissions } from '@/app/crm/lib/pagePermissions';
import WorkOrderDetailClient from '../WorkOrderDetailClient';

export const dynamic = 'force-dynamic';

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [fortnoxStatus, currentUser, safetyKeys] = await Promise.all([
    getFortnoxConnectionStatus().catch(() => ({ connected: false })),
    getCurrentUser().catch(() => null),
    hasCrmPermissions(['safety.round.read', 'safety.round.write']),
  ]);
  return (
    <Suspense>
      <WorkOrderDetailClient
        workOrderId={id}
        fortnoxConnected={fortnoxStatus.connected}
        currentUserId={currentUser?.id ?? null}
        showSafetyRounds={safetyKeys['safety.round.read'] || safetyKeys['safety.round.write']}
      />
    </Suspense>
  );
}

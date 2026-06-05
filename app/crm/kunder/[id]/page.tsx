import { Suspense } from 'react';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import CustomerDetailClient from '../CustomerDetailClient';

export const dynamic = 'force-dynamic';

export default async function KundProfilPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fortnoxStatus = await getFortnoxConnectionStatus().catch(() => ({ connected: false }));
  return (
    <Suspense>
      <CustomerDetailClient customerId={id} fortnoxConnected={fortnoxStatus.connected} />
    </Suspense>
  );
}

import { Suspense } from 'react';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import CustomerFormClient from '../CustomerFormClient';

export const dynamic = 'force-dynamic';

export default async function NyKundPage() {
  const fortnoxStatus = await getFortnoxConnectionStatus().catch(() => ({ connected: false }));
  return (
    <Suspense>
      <CustomerFormClient fortnoxConnected={fortnoxStatus.connected} />
    </Suspense>
  );
}

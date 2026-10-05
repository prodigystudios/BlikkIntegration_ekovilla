import { Suspense } from 'react';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import { getUserProfile } from '@/lib/getUserProfile';
import CustomerFormClient from '../CustomerFormClient';
import { defaultAccountManager } from '../accountManagerDefault';

export const dynamic = 'force-dynamic';

export default async function NyKundPage() {
  const [fortnoxStatus, profile] = await Promise.all([
    getFortnoxConnectionStatus().catch(() => ({ connected: false })),
    // Request-cachad (layouten har redan läst den). Bara för förvalet av kundansvarig.
    getUserProfile(),
  ]);
  return (
    <Suspense>
      <CustomerFormClient
        fortnoxConnected={fortnoxStatus.connected}
        defaultAccountManager={defaultAccountManager(profile)}
      />
    </Suspense>
  );
}

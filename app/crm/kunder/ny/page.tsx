import { Suspense } from 'react';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import { getCurrentUser } from '@/lib/auth/route';
import CustomerFormClient from '../CustomerFormClient';

export const dynamic = 'force-dynamic';

export default async function NyKundPage() {
  const [fortnoxStatus, currentUser] = await Promise.all([
    getFortnoxConnectionStatus().catch(() => ({ connected: false })),
    // Bara för förvalet av kundansvarig. Ett fel här ska inte fälla sidan, bara lämna fältet tomt.
    getCurrentUser().catch(() => null),
  ]);
  return (
    <Suspense>
      <CustomerFormClient fortnoxConnected={fortnoxStatus.connected} currentUserId={currentUser?.id ?? null} />
    </Suspense>
  );
}

import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/getUserProfile';
import { listFortnoxUnits } from '@/lib/domains/fortnox/units';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import UnitsClient from './UnitsClient';

export const dynamic = 'force-dynamic';

export default async function EnheterPage() {
  const profile = await getUserProfile();
  if (profile?.role !== 'admin') redirect('/crm');

  const fortnoxStatus = await getFortnoxConnectionStatus().catch(() => ({ connected: false }));
  const units = fortnoxStatus.connected ? await listFortnoxUnits().catch(() => []) : [];

  return <UnitsClient initialUnits={units} fortnoxConnected={fortnoxStatus.connected} />;
}

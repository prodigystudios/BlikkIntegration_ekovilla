import { listFortnoxUnits } from '@/lib/domains/fortnox/units';
import { requirePagePermission } from '@/lib/auth/pageGuards';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import UnitsClient from './UnitsClient';

export const dynamic = 'force-dynamic';

export default async function EnheterPage() {
  await requirePagePermission('crm.unit.manage', '/crm');

  const fortnoxStatus = await getFortnoxConnectionStatus().catch(() => ({ connected: false }));
  const units = fortnoxStatus.connected ? await listFortnoxUnits().catch(() => []) : [];

  return <UnitsClient initialUnits={units} fortnoxConnected={fortnoxStatus.connected} />;
}

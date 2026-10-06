import { getCurrentUser } from '@/lib/auth/route';
import { hasCrmPermissions } from '@/app/crm/lib/pagePermissions';
import WorkOrdersClient from './WorkOrdersClient';

export const dynamic = 'force-dynamic';

export default async function CrmWorkOrdersPage() {
  // crm.report.read styr listans TG-kolumn — samma nyckel som kostnadsrutten kräver. Läses här och
  // inte i klienten, så att kolumnen inte syns tom och försvinner när 403-svaret kommer.
  const [user, permissions] = await Promise.all([
    getCurrentUser().catch(() => null),
    hasCrmPermissions(['crm.report.read']),
  ]);
  return <WorkOrdersClient currentUserId={user?.id ?? null} canSeeMargins={permissions['crm.report.read']} />;
}

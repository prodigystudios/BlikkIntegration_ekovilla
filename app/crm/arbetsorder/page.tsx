import { getCurrentUser } from '@/lib/auth/route';
import WorkOrdersClient from './WorkOrdersClient';

export const dynamic = 'force-dynamic';

export default async function CrmWorkOrdersPage() {
  const user = await getCurrentUser().catch(() => null);
  return <WorkOrdersClient currentUserId={user?.id ?? null} />;
}

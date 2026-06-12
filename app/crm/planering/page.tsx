import { getCurrentUser } from '@/lib/auth/route';
import PlanningClient from './PlanningClient';

export const dynamic = 'force-dynamic';

// NEW CRM-first planning (Wave 7), as a CRM surface under the CRM layout (sidebar + auth gate).
// The CRM layout already restricts access to sales/admin (konsult passes as read-only). The API
// enforces the real planning.* permissions; konsult cannot write.
export default async function CrmPlaneringPage() {
  const user = await getCurrentUser().catch(() => null);
  const canWrite = user?.role === 'admin' || user?.role === 'sales';
  // Fleet + depot management are seeded to admins (planning.truck.manage / planning.depot.manage).
  // The API enforces the real permissions; these are just the UI affordances.
  const canManageTrucks = user?.role === 'admin';
  const canManageDepots = user?.role === 'admin';
  return <PlanningClient canWrite={canWrite} canManageTrucks={canManageTrucks} canManageDepots={canManageDepots} />;
}

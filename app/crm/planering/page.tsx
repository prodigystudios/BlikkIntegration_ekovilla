import { getEffectivePermissions } from '@/lib/auth/permissions';
import PlanningClient from './PlanningClient';

export const dynamic = 'force-dynamic';

// NEW CRM-first planning (Wave 7), as a CRM surface under the CRM layout (sidebar + auth gate).
// The CRM layout gates on crm.access (konsult passes as read-only). The API enforces the real
// planning.* permissions; these flags are only the UI affordances.
export default async function CrmPlaneringPage() {
  // Alla tre ur NYCKLARNA, inte rollen — samma effektiva behörigheter som API:t, request-cachade
  // (rotlayouten har redan läst dem). Failar stängt: ett fel ger en tom mängd och läsläge.
  // Seeden: planning.schedule.write = sales + admin (konsult kan inte skriva), planning.truck.manage
  // och planning.depot.manage = admin. Depåhanteringen bär inköpsbeslutet (boka in leveranser,
  // stämma av, beställa material).
  const permissions = await getEffectivePermissions();
  return (
    <PlanningClient
      canWrite={permissions.has('planning.schedule.write')}
      canManageTrucks={permissions.has('planning.truck.manage')}
      canManageDepots={permissions.has('planning.depot.manage')}
    />
  );
}

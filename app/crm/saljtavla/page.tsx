import { getCurrentUser } from '@/lib/auth/route';
import { hasCrmPermission } from '@/app/crm/lib/pagePermissions';
import SaljtavlaClient from './SaljtavlaClient';

export const dynamic = 'force-dynamic';

export default async function CrmSaljtavlaPage() {
  // Tavlan öppnar SAMMA QuoteDetailPanel som offertlistan. Utelämnas canWrite här får panelen ett
  // annat beteende beroende på vilken väg man kom in, vilket är exakt den sortens skillnad ingen
  // upptäcker förrän en säljare undrar varför knappen "försvinner ibland".
  const [user, canWrite] = await Promise.all([
    getCurrentUser().catch(() => null),
    hasCrmPermission('crm.write'),
  ]);
  return <SaljtavlaClient currentUserId={user?.id ?? null} canWrite={canWrite} />;
}

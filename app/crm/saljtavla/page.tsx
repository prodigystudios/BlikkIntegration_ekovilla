import { getCurrentUser } from '@/lib/auth/route';
import { hasCrmPermissions } from '@/app/crm/lib/pagePermissions';
import SaljtavlaClient from './SaljtavlaClient';

export const dynamic = 'force-dynamic';

export default async function CrmSaljtavlaPage() {
  // Tavlan öppnar SAMMA QuoteDetailPanel som offertlistan. Utelämnas flaggorna här får panelen
  // ett annat beteende beroende på vilken väg man kom in, vilket är exakt den sortens skillnad
  // ingen upptäcker förrän en säljare undrar varför knappen "försvinner ibland".
  const [user, permissions] = await Promise.all([
    getCurrentUser().catch(() => null),
    hasCrmPermissions(['crm.write', 'crm.admin', 'crm.customer.write']),
  ]);
  return (
    <SaljtavlaClient
      currentUserId={user?.id ?? null}
      canWrite={permissions['crm.write']}
      canDelegate={permissions['crm.admin']}
      canEditContacts={permissions['crm.customer.write']}
    />
  );
}

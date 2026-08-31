import { getCurrentUser } from '@/lib/auth/route';
import { hasCrmPermissions } from '@/app/crm/lib/pagePermissions';
import QuotesClient from './QuotesClient';

export const dynamic = 'force-dynamic';

export default async function CrmQuotesPage() {
  // canWrite styr om uppgiftsformuläret alls går att öppna, canDelegate om det får läggas på
  // någon annan (vilket är vägen som skickar notis). Läses server-side av samma skäl som
  // alltid: en klient som frågar själv hade blinkat till med fel knappar.
  const [user, permissions] = await Promise.all([
    getCurrentUser().catch(() => null),
    hasCrmPermissions(['crm.write', 'crm.admin']),
  ]);
  return (
    <QuotesClient
      currentUserId={user?.id ?? null}
      canWrite={permissions['crm.write']}
      canDelegate={permissions['crm.admin']}
    />
  );
}

import { hasCrmPermission } from '@/app/crm/lib/pagePermissions';
import TasksClient from './TasksClient';

export const dynamic = 'force-dynamic';

// Behörigheten läses här och inte i klienten: sidan är rätt ställe för åtkomstbeslut, och en
// klient som frågar själv hade blinkat till med fel formulär medan svaret var på väg.
//
// Läsningen bor i app/crm/lib/pagePermissions.ts — se den för varför den bygger en
// server-komponentklient och inte går via getEffectivePermissions().
export default async function CrmTasksPage() {
  const canDelegate = await hasCrmPermission('crm.admin');

  return <TasksClient canDelegate={canDelegate} />;
}

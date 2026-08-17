import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import TasksClient from './TasksClient';

export const dynamic = 'force-dynamic';

// Behörigheten läses här och inte i klienten: sidan är rätt ställe för åtkomstbeslut, och en
// klient som frågar själv hade blinkat till med fel formulär medan svaret var på väg.
//
// `createServerComponentClient` och inte getEffectivePermissions(): den senare bygger en
// route-handler-klient, som försöker skriva cookies vid tokenförnyelse och därför inte hör hemma
// i en server-komponent. Samma mönster som app/arbetsorder/[id]/page.tsx.
export default async function CrmTasksPage() {
  const supabase = createServerComponentClient({ cookies });
  const { data: permissions } = await supabase.rpc('effective_permissions');
  const canDelegate = Array.isArray(permissions)
    && permissions.some((row) => (typeof row === 'string' ? row : String(row)) === 'crm.admin');

  return <TasksClient canDelegate={canDelegate} />;
}

import { getCurrentUser } from '@/lib/auth/route';
import { hasCrmPermission } from '@/app/crm/lib/pagePermissions';
import QuotesClient from './QuotesClient';

export const dynamic = 'force-dynamic';

export default async function CrmQuotesPage() {
  // canWrite styr offertpanelens snabbformulär för uppgifter. konsult har crm.access och ser
  // varenda offert, men är läsroll — ett formulär som alltid 403:ar är sämre än inget formulär.
  const [user, canWrite] = await Promise.all([
    getCurrentUser().catch(() => null),
    hasCrmPermission('crm.write'),
  ]);
  return <QuotesClient currentUserId={user?.id ?? null} canWrite={canWrite} />;
}

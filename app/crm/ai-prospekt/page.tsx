import { getUserProfile } from '@/lib/getUserProfile';
import { requirePagePermission } from '@/lib/auth/pageGuards';
import AiProspectsClient from './AiProspectsClient';

export const dynamic = 'force-dynamic';

export default async function CrmAiProspectsPage() {
  const profile = await getUserProfile();
  await requirePagePermission('crm.aiprospect.manage', '/crm');

  return <AiProspectsClient userName={profile?.full_name || null} />;
}
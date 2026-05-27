import { getUserProfile } from '@/lib/getUserProfile';
import AiProspectsClient from './AiProspectsClient';

export const dynamic = 'force-dynamic';

export default async function CrmAiProspectsPage() {
  const profile = await getUserProfile();

  return <AiProspectsClient userName={profile?.full_name || null} />;
}
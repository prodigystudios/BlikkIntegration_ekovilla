import { getUserProfile } from '@/lib/getUserProfile';
import CrmOverview from './components/CrmOverview';

export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  const profile = await getUserProfile();

  return <CrmOverview userId={profile?.id ?? null} />;
}
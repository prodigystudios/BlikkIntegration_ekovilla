import { getUserProfile } from '@/lib/getUserProfile';
import { toEffectiveRole } from '@/lib/roles';
import CrmOverview from './components/CrmOverview';

export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  const profile = await getUserProfile();
  const role = toEffectiveRole(profile?.role);

  return <CrmOverview role={role} />;
}
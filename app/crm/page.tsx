import { getUserProfile } from '@/lib/getUserProfile';
import CrmOverview from './components/CrmOverview';

export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  const profile = await getUserProfile();
  const role = profile?.role === 'konsult' ? 'sales' : profile?.role || null;

  return <CrmOverview role={role} />;
}
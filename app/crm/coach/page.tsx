import { getUserProfile } from '@/lib/getUserProfile';
import CoachClient from './CoachClient';

export const dynamic = 'force-dynamic';

export default async function CrmCoachPage() {
  const profile = await getUserProfile();

  return <CoachClient userName={profile?.full_name || null} />;
}
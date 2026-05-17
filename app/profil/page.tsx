import { redirect } from 'next/navigation';
import { getUserProfile } from '../../lib/getUserProfile';
import ProfilePageClient from './ProfilePageClient';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const profile = await getUserProfile();
  if (!profile) {
    redirect('/auth/sign-in');
  }

  return <ProfilePageClient />;
}
import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/getUserProfile';
import RingListsClient from './RingListsClient';

export const dynamic = 'force-dynamic';

export default async function CrmCallListsPage() {
  const profile = await getUserProfile();
  if (profile?.role !== 'admin') redirect('/crm');

  return <RingListsClient adminName={profile.full_name} />;
}
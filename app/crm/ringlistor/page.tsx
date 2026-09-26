import { getUserProfile } from '@/lib/getUserProfile';
import { requirePagePermission } from '@/lib/auth/pageGuards';
import RingListsClient from './RingListsClient';

export const dynamic = 'force-dynamic';

export default async function CrmCallListsPage() {
  // crm.admin — samma nyckel som ringlistornas API (requireCrmAdmin). ⚠️ INTE crm.ringlist.manage:
  // den är seedad även till sälj, men sidan och dess API har alltid varit admin.
  await requirePagePermission('crm.admin', '/crm');
  const profile = await getUserProfile();

  return <RingListsClient adminName={profile?.full_name ?? null} />;
}
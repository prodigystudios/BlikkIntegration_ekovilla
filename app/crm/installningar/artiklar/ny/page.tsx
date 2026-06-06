import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/getUserProfile';
import { listFortnoxArticlePriceLists } from '@/lib/domains/fortnox/articles';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import ArticleFormClient from '../ArticleFormClient';

export const dynamic = 'force-dynamic';

export default async function NyArtikelPage() {
  const profile = await getUserProfile();
  if (profile?.role !== 'admin') redirect('/crm');

  const fortnoxStatus = await getFortnoxConnectionStatus().catch(() => ({ connected: false }));
  const priceLists = fortnoxStatus.connected
    ? await listFortnoxArticlePriceLists().catch(() => [])
    : [];

  return <ArticleFormClient mode="create" fortnoxConnected={fortnoxStatus.connected} priceLists={priceLists} />;
}

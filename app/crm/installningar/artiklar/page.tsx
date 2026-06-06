import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/getUserProfile';
import { listCachedFortnoxArticles } from '@/lib/domains/fortnox/articles';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import ArticlesClient from './ArticlesClient';

export const dynamic = 'force-dynamic';

export default async function CrmArticlesPage() {
  const profile = await getUserProfile();
  if (profile?.role !== 'admin') redirect('/crm');

  const [articles, fortnoxStatus] = await Promise.all([
    listCachedFortnoxArticles({ activeOnly: false }),
    getFortnoxConnectionStatus(),
  ]);

  return <ArticlesClient initialArticles={articles} fortnoxConnected={fortnoxStatus.connected} />;
}

import { listCachedFortnoxArticles } from '@/lib/domains/fortnox/articles';
import { requirePagePermission } from '@/lib/auth/pageGuards';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import ArticlesClient from './ArticlesClient';

export const dynamic = 'force-dynamic';

export default async function CrmArticlesPage() {
  await requirePagePermission('crm.article.manage', '/crm');

  const [articles, fortnoxStatus] = await Promise.all([
    listCachedFortnoxArticles({ activeOnly: false }),
    getFortnoxConnectionStatus(),
  ]);

  return <ArticlesClient initialArticles={articles} fortnoxConnected={fortnoxStatus.connected} />;
}

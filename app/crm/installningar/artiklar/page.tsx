import { listCachedFortnoxArticles } from '@/lib/domains/fortnox/articles';
import { requirePagePermission } from '@/lib/auth/pageGuards';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import { listPortalArticleFields } from '@/lib/domains/portal/articleFieldsStore';
import { createSessionClient } from '@/lib/supabase/session';
import ArticlesClient, { type ArticlePortalSummary } from './ArticlesClient';

export const dynamic = 'force-dynamic';

export default async function CrmArticlesPage() {
  await requirePagePermission('crm.article.manage', '/crm');

  const [articles, fortnoxStatus, portalFields] = await Promise.all([
    listCachedFortnoxArticles({ activeOnly: false }),
    getFortnoxConnectionStatus(),
    // Återförsäljarportalens fält (RLS: crm.article.manage). Ett läsfel döljer bara kolumnen, inte listan.
    listPortalArticleFields(createSessionClient()).catch((e: unknown) => {
      console.error('[portal] artikelfälten', e instanceof Error ? e.message : e);
      return null;
    }),
  ]);

  const portal: Record<string, ArticlePortalSummary> | null = portalFields
    ? Object.fromEntries(portalFields.map((f) => [f.article_number, { publish: f.publish, customer_name: f.customer_name }]))
    : null;

  return <ArticlesClient initialArticles={articles} fortnoxConnected={fortnoxStatus.connected} portal={portal} />;
}

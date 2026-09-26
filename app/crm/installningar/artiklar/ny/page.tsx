import { listFortnoxArticlePriceLists } from '@/lib/domains/fortnox/articles';
import { requirePagePermission } from '@/lib/auth/pageGuards';
import { listFortnoxUnits } from '@/lib/domains/fortnox/units';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import ArticleFormClient from '../ArticleFormClient';

export const dynamic = 'force-dynamic';

export default async function NyArtikelPage() {
  await requirePagePermission('crm.article.manage', '/crm');

  const fortnoxStatus = await getFortnoxConnectionStatus().catch(() => ({ connected: false }));
  const [priceLists, units] = fortnoxStatus.connected
    ? await Promise.all([
        listFortnoxArticlePriceLists().catch(() => []),
        listFortnoxUnits().catch(() => []),
      ])
    : [[], []];

  return (
    <ArticleFormClient
      mode="create"
      fortnoxConnected={fortnoxStatus.connected}
      priceLists={priceLists}
      units={units}
    />
  );
}

import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/getUserProfile';
import { listFortnoxArticlePriceLists } from '@/lib/domains/fortnox/articles';
import { listFortnoxUnits } from '@/lib/domains/fortnox/customers';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import ArticleFormClient from '../ArticleFormClient';

export const dynamic = 'force-dynamic';

export default async function NyArtikelPage() {
  const profile = await getUserProfile();
  if (profile?.role !== 'admin') redirect('/crm');

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

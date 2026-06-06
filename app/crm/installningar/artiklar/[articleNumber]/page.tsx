import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/getUserProfile';
import { getFortnoxArticleForEdit } from '@/lib/domains/fortnox/articles';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import ArticleFormClient, { type ArticleFormInitial } from '../ArticleFormClient';
import type { FortnoxArticlePriceRow } from '@/lib/domains/fortnox/types';

export const dynamic = 'force-dynamic';

export default async function RedigeraArtikelPage({ params }: { params: Promise<{ articleNumber: string }> }) {
  const profile = await getUserProfile();
  if (profile?.role !== 'admin') redirect('/crm');

  const { articleNumber: raw } = await params;
  const articleNumber = decodeURIComponent(raw);

  const fortnoxStatus = await getFortnoxConnectionStatus().catch(() => ({ connected: false }));

  let initial: ArticleFormInitial | undefined;
  let priceLists: FortnoxArticlePriceRow[] = [];
  let loadError: string | null = null;

  if (fortnoxStatus.connected) {
    try {
      const { article, priceLists: lists } = await getFortnoxArticleForEdit(articleNumber);
      priceLists = lists;
      initial = {
        article_number: article.ArticleNumber,
        description: article.Description ?? '',
        purchase_price: article.PurchasePrice ?? null,
        unit: article.Unit ?? null,
        type: article.Type === 'SERVICE' ? 'SERVICE' : 'STOCK',
        active: article.Active ?? true,
        vat: article.VAT ?? null,
        ean: article.EAN ?? null,
        manufacturer: article.Manufacturer ?? null,
        manufacturer_article_number: article.ManufacturerArticleNumber ?? null,
        note: article.Note ?? null,
      };
    } catch (e: any) {
      loadError = e?.message || 'Kunde inte hämta artikeln från Fortnox';
    }
  }

  if (fortnoxStatus.connected && !initial) {
    return (
      <div className="grid grid-cols-1 gap-6">
        <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Artikel {articleNumber}</h1>
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError ?? 'Artikeln hittades inte.'}
        </div>
      </div>
    );
  }

  return (
    <ArticleFormClient
      mode="edit"
      fortnoxConnected={fortnoxStatus.connected}
      articleNumber={articleNumber}
      initial={initial}
      priceLists={priceLists}
    />
  );
}

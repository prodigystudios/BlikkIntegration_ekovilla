import { getFortnoxArticleForEdit } from '@/lib/domains/fortnox/articles';
import { requirePagePermission } from '@/lib/auth/pageGuards';
import { listFortnoxUnits } from '@/lib/domains/fortnox/units';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import { RESELLER_PRICE_LIST_CODE } from '@/lib/domains/fortnox/priceLists';
import { getPortalArticleFields } from '@/lib/domains/portal/articleFieldsStore';
import { createSessionClient } from '@/lib/supabase/session';
import ArticleFormClient, { type ArticleFormInitial } from '../ArticleFormClient';
import type { PortalArticleFacts } from '../PortalArticleFieldsCard';
import type { FortnoxArticlePriceRow } from '@/lib/domains/fortnox/types';

export const dynamic = 'force-dynamic';

export default async function RedigeraArtikelPage({ params }: { params: Promise<{ articleNumber: string }> }) {
  await requirePagePermission('crm.article.manage', '/crm');

  const { articleNumber: raw } = await params;
  const articleNumber = decodeURIComponent(raw);

  // Portalfälten bor i CRM:et och läses med sessionen (RLS: crm.article.manage), oberoende av Fortnox. Ett läsfel
  // får inte ta artikelsidan med sig, och kortet visas då inte alls: tomma fält hade kunnat sparas över de riktiga.
  const [fortnoxStatus, portalFields] = await Promise.all([
    getFortnoxConnectionStatus().catch(() => ({ connected: false })),
    getPortalArticleFields(createSessionClient(), articleNumber).catch((e: unknown) => {
      console.error('[portal] artikelfälten', e instanceof Error ? e.message : e);
      return 'error' as const;
    }),
  ]);

  let initial: ArticleFormInitial | undefined;
  let priceLists: FortnoxArticlePriceRow[] = [];
  let units: { code: string; description: string }[] = [];
  let loadError: string | null = null;

  if (fortnoxStatus.connected) {
    try {
      const [{ article, priceLists: lists }, unitList] = await Promise.all([
        getFortnoxArticleForEdit(articleNumber),
        listFortnoxUnits().catch(() => []),
      ]);
      priceLists = lists;
      units = unitList;
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

  // Det publiceringen prövar, som Fortnox har det nu. Okänt utan Fortnox.
  const portalFacts: PortalArticleFacts | null = initial
    ? {
        active: initial.active,
        unit: initial.unit,
        resellerPrice: priceLists.find((p) => p.code === RESELLER_PRICE_LIST_CODE)?.price ?? null,
      }
    : null;

  return (
    <ArticleFormClient
      mode="edit"
      fortnoxConnected={fortnoxStatus.connected}
      articleNumber={articleNumber}
      initial={initial}
      priceLists={priceLists}
      units={units}
      portal={portalFields === 'error' ? { error: true } : { fields: portalFields, facts: portalFacts }}
    />
  );
}

import { requirePagePermission } from '@/lib/auth/pageGuards';
import { createSessionClient } from '@/lib/supabase/session';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { resolvePortalTarget } from '@/lib/domains/portal/config';
import { PORTAL_ARTICLE_CATEGORY_LABELS } from '@/lib/domains/portal/articleFields';
import { PRICELIST_SKIP_REASON_LABELS } from '@/lib/domains/portal/pricelist';
import { RESELLER_PRICE_LIST_CODE } from '@/lib/domains/fortnox/priceLists';
import { loadPricelistBatch, pricelistBatchSources } from '@/lib/domains/portal/pricelistBatchSources';
import { pricelistBatchKey } from '@/lib/domains/portal/pricelistBatch';
import { getPortalSettings, listPortalResellers } from '@/lib/domains/portal/resellers';
import { describeSourceError, listPricelistPublications, type PricelistDelivery } from '@/lib/domains/portal/pricelistPublish';
import { listPortalOutboxAttention, type PortalOutboxEventKind } from '@/lib/domains/portal/outboxView';
import ResellerPortalClient, {
  type PartnerPricelistsView,
  type PortalIntegrationView,
  type PricelistPreviewView,
  type PublicationView,
} from './ResellerPortalClient';
import type { ResellerView } from './ResellersPanel';
import type { OutboxItemView } from './OutboxPanel';

export const dynamic = 'force-dynamic';

// Det butiken ser, med portalens ord (kontraktet: Bekräftad, Planerad, Utförd, Fakturerad; för en beställning Levererad
// och Makulerad).
const OUTBOX_KIND_LABELS: Record<PortalOutboxEventKind, string> = {
  pricelist: 'Prislistan',
  'job.confirmed': 'Bekräftad',
  'job.scheduled': 'Planerad',
  'job.completed': 'Utförd',
  'job.invoiced': 'Fakturerad',
  'job.cancelled': 'Avbruten',
  'job.message': 'Meddelande',
  'job.document': 'Dokument',
  'store_order.confirmed': 'Bekräftad',
  'store_order.delivered': 'Levererad',
  'store_order.invoiced': 'Fakturerad',
  'store_order.cancelled': 'Makulerad',
  'reseller.invite': 'Inbjudan',
  other: 'Annan händelse',
};

// Tidpunkter formateras här, i svensk tid, och skickas som text: samma sträng på servern och i webbläsaren.
function formatStockholm(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' });
}

export default async function AterforsaljarportalenPage() {
  await requirePagePermission('crm.portal.manage', '/crm');

  const session = createSessionClient();
  const target = resolvePortalTarget(process.env);
  // Hemligheten lämnar aldrig servern: sidan får bara värden eller skälet till att integrationen är av.
  const integration: PortalIntegrationView = target.ok
    ? { enabled: true, host: new URL(target.baseUrl).host }
    : { enabled: false, message: target.message };

  const failure = (fallback: string) => (e: unknown) => ({ error: e instanceof Error ? e.message : fallback });
  const [batchResult, publicationsResult, resellersResult, settingsResult, outboxResult] = await Promise.all([
    // Lista 160, butikernas egna listor och historiken (10b2): samma läsning som publiceringen, så att förhandsvisningens
    // hash betyder samma sak.
    loadPricelistBatch(pricelistBatchSources(session)).then(
      (load) => ({ ok: true as const, load }),
      (e: unknown) => {
        // Beskedet till sidan är den vänliga texten; orsaken syns bara här.
        console.error('[portal-pricelist] förhandsvisningen gick inte att läsa', e instanceof Error ? e.message : e);
        return { ok: false as const, message: describeSourceError(e) };
      },
    ),
    listPricelistPublications(session).then(
      (publications) => ({ ok: true as const, publications }),
      (e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : 'Publiceringarna gick inte att läsa.' }),
    ),
    listPortalResellers(session).catch(failure('Butikerna gick inte att läsa.')),
    getPortalSettings(session).catch(failure('Portalens inställningar gick inte att läsa.')),
    listPortalOutboxAttention(session).catch(failure('Utskicken gick inte att läsa.')),
  ]);

  const outbox: OutboxItemView[] | { error: string } = Array.isArray(outboxResult)
    ? outboxResult.map((item) => ({
        id: item.id,
        kindLabel: OUTBOX_KIND_LABELS[item.kind],
        detail: item.detail,
        status: item.status,
        attempts: item.attempts,
        lastError: item.lastError,
        queuedAtLabel: formatStockholm(item.createdAt),
        nextAttemptLabel: item.nextAttemptAt ? formatStockholm(item.nextAttemptAt) : null,
        subject: item.job
          ? {
              kind: 'job' as const,
              label: [item.job.storeName, item.job.quoteNumber ? `offert ${item.job.quoteNumber}` : `jobb ${item.job.quoteId}`]
                .filter(Boolean)
                .join(', '),
              href: item.job.workOrderId ? `/crm/arbetsorder/${item.job.workOrderId}` : null,
            }
          : item.storeOrder
            ? {
                kind: 'store_order' as const,
                label: [
                  item.storeOrder.storeName,
                  `beställning ${item.storeOrder.orderNumber ?? item.storeOrder.orderId}`,
                ]
                  .filter(Boolean)
                  .join(', '),
                href: item.storeOrder.id ? `/crm/butiksbestallningar/${item.storeOrder.id}` : null,
              }
            : null,
        canRetry: item.canRetry,
      }))
    : outboxResult;

  const resellers: ResellerView[] | { error: string } = Array.isArray(resellersResult)
    ? resellersResult.map((r) => ({ ...r, lastSeenLabel: formatStockholm(r.lastSeenAt) }))
    : resellersResult;
  const fallbackUserId = 'error' in settingsResult ? settingsResult : settingsResult.fallbackUserId;

  const storeNames = new Map(Array.isArray(resellersResult) ? resellersResult.map((r) => [r.resellerId, r.name]) : []);
  const nameOf = (resellerId: string) => storeNames.get(resellerId) ?? resellerId;
  const withLabels = (delivery: PricelistDelivery) => ({
    ...delivery,
    sentAtLabel: delivery.sentAt ? formatStockholm(delivery.sentAt) : null,
    nextAttemptLabel: delivery.nextAttemptAt ? formatStockholm(delivery.nextAttemptAt) : null,
  });

  // Samma listor till samma butiker som en tidigare publicering: värt att veta innan man publicerar igen.
  const sameAs =
    batchResult.ok && publicationsResult.ok
      ? publicationsResult.publications.find(
          (p) =>
            pricelistBatchKey(p.lists.map((l) => ({ resellerId: l.resellerId, hash: l.contentHash }))) ===
            pricelistBatchKey(batchResult.load.batch.items),
        )
      : undefined;

  const preview: PricelistPreviewView = batchResult.ok
    ? {
        ok: true,
        hash: batchResult.load.batch.hash,
        listCount: batchResult.load.batch.items.length,
        blocked: batchResult.load.batch.problems.length > 0,
        sameAs: sameAs ? { validFrom: sameAs.validFrom, createdAtLabel: formatStockholm(sameAs.createdAt) } : null,
        articles: batchResult.load.shared.articles.map((a) => ({ ...a, categoryLabel: PORTAL_ARTICLE_CATEGORY_LABELS[a.category] })),
        skipped: batchResult.load.shared.skipped.map((s) => ({
          articleNumber: s.articleNumber,
          customerName: s.customerName,
          reasons: s.reasons.map((r) => PRICELIST_SKIP_REASON_LABELS[r]),
        })),
        unmarked: batchResult.load.shared.unmarked,
      }
    : { ok: false, message: batchResult.message };

  // Butikernas egna listor (10b). Utan någon butik med kundkort eller tidigare egen lista visas inget, som i prod före
  // påslaget.
  let partnerLists: PartnerPricelistsView = null;
  if (batchResult.ok) {
    const { partner, batch } = batchResult.load;
    const names = (stores: { storeName: string }[]) => stores.map((st) => st.storeName);
    // En butik som väntar på sin inbjudan står bara under "väntar", inte under sin lista: den får ingen lista nu.
    const waitingIds = new Set(batch.waiting.map((st) => st.resellerId));
    // Butiker som haft en egen lista och nu får 160 som egen (pricelistBatch.ts).
    const copies = batch.items.flatMap((i) => (i.resellerId !== null && i.code === RESELLER_PRICE_LIST_CODE ? [i.resellerId] : []));
    if (partner.sharedStores.length + partner.lists.length + partner.problems.length + copies.length > 0) {
      partnerLists = {
        ok: true,
        sharedStores: names(partner.sharedStores.filter((st) => !copies.includes(st.resellerId))),
        lists: partner.lists.flatMap((l) => {
          const stores = l.stores.filter((st) => !waitingIds.has(st.resellerId));
          if (stores.length === 0) return [];
          return [
            {
              code: l.code,
              stores: stores.map((st) => ({ name: st.storeName, customerName: st.customerName })),
              articleCount: l.articles.length,
              differences: l.differences,
            },
          ];
        }),
        copies: copies.map(nameOf),
        waiting: names(batch.waiting),
        // Publiceringens problem, inte förhandsvisningens: en väntande butiks kort stoppar inget (pricelistBatch.ts).
        problems: batch.problems.map((pr) => ({ key: pr.key, what: pr.what, stores: names(pr.stores), message: pr.message })),
      };
    }
  }

  const publications: PublicationView[] | { error: string } = publicationsResult.ok
    ? publicationsResult.publications.map((p) => ({
        id: p.id,
        validFrom: p.validFrom,
        contentHash: p.contentHash,
        articleCount: p.articleCount,
        publishedByName: p.publishedByName,
        createdAtLabel: formatStockholm(p.createdAt),
        delivery: withLabels(p.delivery),
        lists: p.lists.map((l) => ({
          key: l.idempotencyKey,
          label: l.resellerId === null ? 'Alla butiker' : (l.storeName ?? l.resellerId),
          code: l.code,
          articleCount: l.articleCount,
          delivery: withLabels(l.delivery),
        })),
      }))
    : { error: publicationsResult.message };

  return (
    <ResellerPortalClient
      today={stockholmTodayISO()}
      integration={integration}
      preview={preview}
      partnerLists={partnerLists}
      publications={publications}
      resellers={resellers}
      fallbackUserId={fallbackUserId}
      outbox={outbox}
    />
  );
}

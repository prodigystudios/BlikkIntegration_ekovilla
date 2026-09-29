import { requirePagePermission } from '@/lib/auth/pageGuards';
import { createSessionClient } from '@/lib/supabase/session';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { resolvePortalTarget } from '@/lib/domains/portal/config';
import { PORTAL_ARTICLE_CATEGORY_LABELS } from '@/lib/domains/portal/articleFields';
import { PRICELIST_SKIP_REASON_LABELS } from '@/lib/domains/portal/pricelist';
import { getPortalSettings, listPortalResellers } from '@/lib/domains/portal/resellers';
import {
  describeSourceError,
  listPricelistPublications,
  loadPricelistDraft,
  pricelistSources,
} from '@/lib/domains/portal/pricelistPublish';
import { listPortalOutboxAttention, type PortalOutboxEventKind } from '@/lib/domains/portal/outboxView';
import ResellerPortalClient, { type PortalIntegrationView, type PricelistPreviewView, type PublicationView } from './ResellerPortalClient';
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
  const [draftResult, publicationsResult, resellersResult, settingsResult, outboxResult] = await Promise.all([
    loadPricelistDraft(pricelistSources(session)).then(
      (draft) => ({ ok: true as const, draft }),
      (e: unknown) => ({ ok: false as const, message: describeSourceError(e) }),
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

  const preview: PricelistPreviewView = draftResult.ok
    ? {
        ok: true,
        hash: draftResult.draft.hash,
        articles: draftResult.draft.articles.map((a) => ({ ...a, categoryLabel: PORTAL_ARTICLE_CATEGORY_LABELS[a.category] })),
        skipped: draftResult.draft.skipped.map((s) => ({
          articleNumber: s.articleNumber,
          customerName: s.customerName,
          reasons: s.reasons.map((r) => PRICELIST_SKIP_REASON_LABELS[r]),
        })),
        unmarked: draftResult.draft.unmarked,
      }
    : { ok: false, message: draftResult.message };

  const publications: PublicationView[] | { error: string } = publicationsResult.ok
    ? publicationsResult.publications.map((p) => ({
        id: p.id,
        validFrom: p.validFrom,
        contentHash: p.contentHash,
        articleCount: p.articleCount,
        publishedByName: p.publishedByName,
        createdAtLabel: formatStockholm(p.createdAt),
        delivery: {
          ...p.delivery,
          sentAtLabel: p.delivery.sentAt ? formatStockholm(p.delivery.sentAt) : null,
          nextAttemptLabel: p.delivery.nextAttemptAt ? formatStockholm(p.delivery.nextAttemptAt) : null,
        },
      }))
    : { error: publicationsResult.message };

  return (
    <ResellerPortalClient
      today={stockholmTodayISO()}
      integration={integration}
      preview={preview}
      publications={publications}
      resellers={resellers}
      fallbackUserId={fallbackUserId}
      outbox={outbox}
    />
  );
}

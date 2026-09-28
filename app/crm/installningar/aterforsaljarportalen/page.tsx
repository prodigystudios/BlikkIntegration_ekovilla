import { requirePagePermission } from '@/lib/auth/pageGuards';
import { createSessionClient } from '@/lib/supabase/session';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { resolvePortalTarget } from '@/lib/domains/portal/config';
import { PORTAL_ARTICLE_CATEGORY_LABELS } from '@/lib/domains/portal/articleFields';
import { PRICELIST_SKIP_REASON_LABELS } from '@/lib/domains/portal/pricelist';
import {
  describeSourceError,
  listPricelistPublications,
  loadPricelistDraft,
  pricelistSources,
} from '@/lib/domains/portal/pricelistPublish';
import ResellerPortalClient, { type PortalIntegrationView, type PricelistPreviewView, type PublicationView } from './ResellerPortalClient';

export const dynamic = 'force-dynamic';

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

  const [draftResult, publicationsResult] = await Promise.all([
    loadPricelistDraft(pricelistSources(session)).then(
      (draft) => ({ ok: true as const, draft }),
      (e: unknown) => ({ ok: false as const, message: describeSourceError(e) }),
    ),
    listPricelistPublications(session).then(
      (publications) => ({ ok: true as const, publications }),
      (e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : 'Publiceringarna gick inte att läsa.' }),
    ),
  ]);

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
        delivery: { ...p.delivery, sentAtLabel: p.delivery.sentAt ? formatStockholm(p.delivery.sentAt) : null },
      }))
    : { error: publicationsResult.message };

  return (
    <ResellerPortalClient
      today={stockholmTodayISO()}
      integration={integration}
      preview={preview}
      publications={publications}
    />
  );
}

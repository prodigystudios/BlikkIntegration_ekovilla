"use client";

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import DatePicker from '@/components/ui/DatePicker';
import DialogShell from '@/components/ui/DialogShell';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import ResellersPanel, { type ResellerView } from './ResellersPanel';
import OutboxPanel, { type OutboxItemView } from './OutboxPanel';
import type { PricelistArticle, UnmarkedArticle } from '@/lib/domains/portal/pricelist';
import type { PricelistDelivery } from '@/lib/domains/portal/pricelistPublish';
import type { PartnerPriceDifference } from '@/lib/domains/portal/partnerPricelists';

// Bara typer ur domänen: modulerna läser node:crypto och Fortnox, och får aldrig följa med till webbläsaren.
// Etiketterna och tidpunkterna kommer färdiga från servern (page.tsx).

export type PortalIntegrationView = { enabled: true; host: string } | { enabled: false; message: string };

export type PricelistPreviewView =
  | {
      ok: true;
      hash: string;
      articles: (PricelistArticle & { categoryLabel: string })[];
      skipped: { articleNumber: string; customerName: string; reasons: string[] }[];
      unmarked: UnmarkedArticle[];
    }
  | { ok: false; message: string };

/**
 * Butikernas egna prislistor (10b): vilka butiker som får vilken lista, och priserna som skiljer sig från 160. null = ingen
 * butik har ett kundkort, och då visas inget.
 */
export type PartnerPricelistsView =
  | {
      ok: true;
      sharedStores: string[];
      lists: { code: string; stores: { name: string; customerName: string }[]; articleCount: number; differences: PartnerPriceDifference[] }[];
      problems: { key: string; what: string; stores: string[]; message: string }[];
    }
  | { ok: false; message: string }
  | null;

export type PublicationView = {
  id: string;
  validFrom: string;
  contentHash: string;
  articleCount: number;
  publishedByName: string | null;
  createdAtLabel: string;
  delivery: PricelistDelivery & { sentAtLabel: string | null; nextAttemptLabel: string | null };
};

type ResellerPortalClientProps = {
  today: string;
  integration: PortalIntegrationView;
  preview: PricelistPreviewView;
  partnerLists: PartnerPricelistsView;
  publications: PublicationView[] | { error: string };
  resellers: ResellerView[] | { error: string };
  fallbackUserId: string | null | { error: string };
  outbox: OutboxItemView[] | { error: string };
};

type Tab = 'pricelist' | 'resellers' | 'outbox';

const CARD =
  'rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]';
const ARTICLE_BASE = '/crm/installningar/artiklar';

function formatKr(value: number): string {
  return `${value.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

function articlesLabel(count: number): string {
  return count === 1 ? 'en artikel' : `${count} artiklar`;
}

function formatPercent(share: number): string {
  if (share === 0) return '–';
  return `${(Math.round(share * 1000) / 10).toLocaleString('sv-SE')} %`;
}

function articleHref(articleNumber: string): string {
  return `${ARTICLE_BASE}/${encodeURIComponent(articleNumber)}`;
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function post<T>(url: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Ett nätfel får inte lämna knappen och dialogen låsta.
    return { ok: false, error: 'Servern svarade inte. Ladda om sidan och se i historiken om publiceringen gick igenom.' };
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) return { ok: false, error: json?.error || `Begäran misslyckades (${res.status})` };
  return { ok: true, data: json.data as T };
}

function DeliveryBadge({ delivery }: { delivery: PublicationView['delivery'] }) {
  switch (delivery.status) {
    case 'sent':
      return <Badge variant="accent">Mottagen</Badge>;
    case 'pending':
    case 'sending':
      return <Badge variant="neutral">{delivery.attempts > 0 ? 'Väntar, försöker igen' : 'Väntar'}</Badge>;
    case 'dead':
      return <Badge variant="danger">Nekad</Badge>;
    case 'superseded':
      return <Badge variant="neutral">Ersatt</Badge>;
    case 'not_queued':
      return <Badge variant="danger">Inte köad</Badge>;
  }
}

export default function ResellerPortalClient({
  today,
  integration,
  preview,
  partnerLists,
  publications,
  resellers,
  fallbackUserId,
  outbox,
}: ResellerPortalClientProps) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('pricelist');
  const [validFrom, setValidFrom] = useState(today);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<null | 'publish' | 'dispatch'>(null);

  const history = Array.isArray(publications) ? publications : [];
  // Syns på fliken: det som gett upp kräver en människa.
  const deadCount = Array.isArray(outbox) ? outbox.filter((i) => i.status === 'dead').length : 0;
  const articles = preview.ok ? preview.articles : [];
  const validFromOk = /^\d{4}-\d{2}-\d{2}$/.test(validFrom) && validFrom >= today;
  // Samma innehåll som en tidigare publicering: värt att veta innan man publicerar igen.
  const sameContent = preview.ok ? history.find((p) => p.contentHash === preview.hash) : undefined;
  const canPublish = integration.enabled && preview.ok && articles.length > 0 && validFromOk && busy === null;

  // Kategorierna i listans ordning, som portalen grupperar dem.
  const rowsWithHeadings = useMemo(
    () => articles.map((a, i) => ({ article: a, heading: i === 0 || articles[i - 1].category !== a.category ? a.categoryLabel : null })),
    [articles],
  );

  async function handlePublish() {
    if (!preview.ok) return;
    setBusy('publish');
    const result = await post<{ created: boolean; article_count: number; delivery: PricelistDelivery | null }>(
      '/api/crm/portal/pricelist/publish',
      { valid_from: validFrom, expected_hash: preview.hash },
    );
    setBusy(null);
    setConfirming(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const { created, delivery } = result.data;
    const what = created ? 'Prislistan är publicerad' : 'Samma prislista var redan publicerad';
    if (delivery?.status === 'sent') toast.success(`${what} och mottagen av portalen.`);
    else if (delivery?.status === 'dead') toast.error(`${what}, men portalen nekade den: ${delivery.lastError ?? 'okänt fel'}`);
    else if (delivery?.status === 'not_queued') toast.error(`${what}, men kunde inte köas. Publicera igen.`);
    else toast.info(`${what} och väntar i kön.${delivery?.lastError ? ` Senaste försöket: ${delivery.lastError}` : ''}`);
    router.refresh();
  }

  async function handleDispatch() {
    setBusy('dispatch');
    const result = await post<{ claimed: number; sent: number; retried: number; dead: number }>('/api/crm/portal/dispatch');
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const { claimed, sent, retried, dead } = result.data;
    if (claimed === 0) toast.info('Inget var dags att skicka. En händelse som misslyckats görs om vid sin tid, se historiken.');
    else if (dead > 0) toast.error(`${sent} skickade, ${retried} väntar, ${dead} nekade av portalen.`);
    else if (retried > 0) toast.info(`${sent} skickade, ${retried} väntar på ett nytt försök.`);
    else toast.success(`${sent} skickade.`);
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <div>
        <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Återförsäljarportalen</h1>
        <p className="m-0 mt-1 max-w-3xl text-sm text-slate-500">
          Prislistan butikerna räknar sina offerter på, och vem på Ekovilla som får deras jobb.
        </p>
      </div>

      {!integration.enabled && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
          <p className="m-0 font-semibold">Integrationen med portalen är inte påslagen här.</p>
          <p className="m-0 mt-0.5">
            {integration.message} Förhandsvisningen fungerar, men inget kan publiceras eller skickas.
          </p>
        </div>
      )}

      <Tabs>
        <TabsList aria-label="Återförsäljarportalen">
          <TabsTrigger id="portal-tab-pricelist" aria-controls="portal-panel-pricelist" active={tab === 'pricelist'} onClick={() => setTab('pricelist')}>
            Prislistan
          </TabsTrigger>
          <TabsTrigger id="portal-tab-resellers" aria-controls="portal-panel-resellers" active={tab === 'resellers'} onClick={() => setTab('resellers')}>
            Butiker och säljare
          </TabsTrigger>
          <TabsTrigger id="portal-tab-outbox" aria-controls="portal-panel-outbox" active={tab === 'outbox'} onClick={() => setTab('outbox')}>
            Utskick
            {deadCount > 0 && (
              <Badge variant="danger" className="ml-1.5 px-1.5 py-0">
                {deadCount}
                <span className="sr-only"> gav upp</span>
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Båda panelerna står kvar monterade och döljs: en panel som monterades om vid flikbytet tog sina värden från
            serverns första svar, och en nyss sparad reserv såg då borttagen ut. Klassen `hidden` bredvid attributet:
            preflight är av, och en display-klass som `grid` slår annars webbläsarens [hidden]. */}
        <div
          role="tabpanel"
          id="portal-panel-resellers"
          aria-labelledby="portal-tab-resellers"
          hidden={tab !== 'resellers'}
          className={cn(tab !== 'resellers' && 'hidden')}
        >
          <ResellersPanel resellers={resellers} fallbackUserId={fallbackUserId} />
        </div>

        <div
          role="tabpanel"
          id="portal-panel-outbox"
          aria-labelledby="portal-tab-outbox"
          hidden={tab !== 'outbox'}
          className={cn(tab !== 'outbox' && 'hidden')}
        >
          <OutboxPanel
            items={outbox}
            integrationEnabled={integration.enabled}
            dispatching={busy === 'dispatch'}
            onDispatch={handleDispatch}
          />
        </div>

        {/* grid-cols-1 = minmax(0, 1fr): utan den blir kolumnen lika bred som tabellen och trycker ut korten i mobil. */}
          <div
            role="tabpanel"
            id="portal-panel-pricelist"
            aria-labelledby="portal-tab-pricelist"
            hidden={tab !== 'pricelist'}
            className={cn('grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.9fr)]', tab !== 'pricelist' && 'hidden')}
          >
            <div className="order-2 grid min-w-0 grid-cols-1 content-start gap-6 xl:order-1">
            {/* Förhandsvisningen: det som skickas */}
            <section className={`${CARD} min-w-0`} aria-labelledby="pricelist-preview-heading">
              <h2 id="pricelist-preview-heading" className="m-0 mb-1 text-base font-bold text-slate-900">
                Förhandsvisning
              </h2>
              <p className="m-0 mb-4 text-sm text-slate-500">
                Priserna på lista 160 och portalfälten under{' '}
                <Link href={ARTICLE_BASE} className="font-semibold text-slate-700 underline">
                  Artiklar
                </Link>
                . Priserna läses från Fortnox när sidan laddas. Namn, enhet och aktiv kommer från artikelregistret; synka det
                under Artiklar om något ändrats i Fortnox.
              </p>

              {!preview.ok ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">
                  {preview.message}
                </div>
              ) : (
                <>
                  {preview.skipped.length > 0 && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
                      <p className="m-0 font-semibold">
                        {preview.skipped.length === 1
                          ? 'En markerad artikel kommer inte med'
                          : `${preview.skipped.length} markerade artiklar kommer inte med`}
                      </p>
                      <ul className="m-0 mt-1.5 grid gap-1 pl-0">
                        {preview.skipped.map((s) => (
                          <li key={s.articleNumber} className="list-none">
                            <Link href={articleHref(s.articleNumber)} className="font-semibold text-amber-900 underline">
                              {s.articleNumber}
                            </Link>
                            {s.customerName ? ` ${s.customerName}` : ''}: {s.reasons.join(', ').toLowerCase()}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {articles.length === 0 ? (
                    <p className="m-0 rounded-xl border border-[#e0e8dc] bg-white px-3.5 py-3 text-sm text-slate-600">
                      Ingen artikel kommer med. Markera artiklar för portalen på deras sidor under{' '}
                      <Link href={ARTICLE_BASE} className="font-semibold underline">
                        Artiklar
                      </Link>
                      .
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                            <th className="py-2 pr-3">Artikel</th>
                            <th className="py-2 pr-3">Kundnamn</th>
                            <th className="py-2 pr-3">Enhet</th>
                            <th className="py-2 pr-3 text-right">Inpris</th>
                            <th className="py-2 pr-3 text-right" title="Andelen av priset som är arbete och ger ROT">
                              Arbete
                            </th>
                            <th className="py-2 text-right">Ordning</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rowsWithHeadings.map(({ article: a, heading }) => (
                            <Fragment key={a.articleNumber}>
                              {heading && (
                                <tr>
                                  <th colSpan={6} scope="colgroup" className="pb-1.5 pt-4 text-left text-sm font-bold text-slate-900">
                                    {heading}
                                  </th>
                                </tr>
                              )}
                              <tr className="border-b border-slate-100 align-top last:border-0">
                                <td className="py-2 pr-3">
                                  <Link href={articleHref(a.articleNumber)} className="font-semibold text-slate-900 no-underline hover:underline">
                                    {a.articleNumber}
                                  </Link>
                                </td>
                                <td className="py-2 pr-3">
                                  <div className="text-slate-900">{a.customerName}</div>
                                  <div className="text-xs text-slate-400">{a.name}</div>
                                  {a.note && <div className="mt-0.5 text-xs text-slate-500">{a.note}</div>}
                                </td>
                                <td className="py-2 pr-3 text-slate-600">{a.unit}</td>
                                <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-slate-900">{formatKr(a.unitCost)}</td>
                                <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-slate-600">{formatPercent(a.laborShare)}</td>
                                <td className="py-2 text-right tabular-nums text-slate-400">{a.sortOrder}</td>
                              </tr>
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {preview.unmarked.length > 0 && (
                    <details className="mt-4 rounded-xl border border-[#e0e8dc] bg-white px-3.5 py-2.5 text-sm">
                      <summary className="cursor-pointer font-semibold text-slate-700">
                        {preview.unmarked.length === 1
                          ? 'En aktiv artikel har pris på lista 160 men är inte med'
                          : `${preview.unmarked.length} aktiva artiklar har pris på lista 160 men är inte med`}
                      </summary>
                      <ul className="m-0 mt-2 grid gap-1 pl-0">
                        {preview.unmarked.map((u) => (
                          <li key={u.articleNumber} className="list-none text-slate-600">
                            <Link href={articleHref(u.articleNumber)} className="font-semibold text-slate-800 underline">
                              {u.articleNumber}
                            </Link>{' '}
                            {u.name}, {formatKr(u.unitCost)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </section>

            {partnerLists && <PartnerListsSection partnerLists={partnerLists} />}
            </div>

            <div className="order-1 grid min-w-0 grid-cols-1 content-start gap-6 xl:order-2">
              {/* Publicera */}
              <section className={CARD} aria-labelledby="pricelist-publish-heading">
                <h2 id="pricelist-publish-heading" className="m-0 mb-1 text-base font-bold text-slate-900">
                  Publicera prislistan
                </h2>
                <p className="m-0 mb-4 text-sm text-slate-600">
                  {!preview.ok
                    ? 'Prislistan gick inte att läsa.'
                    : articles.length === 1
                      ? 'En artikel skickas.'
                      : `${articles.length} artiklar skickas.`}
                  {integration.enabled && <span className="text-slate-400"> Till {integration.host}.</span>}
                </p>

                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-slate-700">Giltig från</span>
                  <DatePicker value={validFrom} onChange={setValidFrom} clearable={false} disabled={busy !== null} />
                  {validFromOk ? (
                    <span className="text-xs text-slate-400">Nya offerter i portalen använder listan från och med det här datumet.</span>
                  ) : (
                    <span className="text-xs font-medium text-red-700">Välj i dag eller ett senare datum.</span>
                  )}
                </label>

                {sameContent && (
                  <p className="m-0 mt-3 text-xs text-slate-500">
                    Samma innehåll publicerades {sameContent.createdAtLabel}, giltig från {sameContent.validFrom}.
                  </p>
                )}

                <div className="mt-4 flex justify-end">
                  <Button variant="primary" onClick={() => setConfirming(true)} disabled={!canPublish}>
                    Publicera
                  </Button>
                </div>
              </section>

              {/* Historiken */}
              <section className={CARD} aria-labelledby="pricelist-history-heading">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <h2 id="pricelist-history-heading" className="m-0 text-base font-bold text-slate-900">
                    Publiceringar
                  </h2>
                  <Button variant="secondary" onClick={handleDispatch} disabled={!integration.enabled || busy !== null}>
                    {busy === 'dispatch' ? 'Skickar…' : 'Skicka väntande nu'}
                  </Button>
                </div>

                {!Array.isArray(publications) ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">{publications.error}</div>
                ) : history.length === 0 ? (
                  <p className="m-0 text-sm text-slate-500">Ingen prislista är publicerad än.</p>
                ) : (
                  <ul className="m-0 grid gap-2.5 pl-0">
                    {history.map((p) => (
                      <li key={p.id} className="list-none rounded-xl border border-[#e0e8dc] bg-white px-3.5 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900">Giltig från {p.validFrom}</span>
                          <DeliveryBadge delivery={p.delivery} />
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {p.articleCount === 1 ? 'En artikel' : `${p.articleCount} artiklar`}, publicerad {p.createdAtLabel}
                          {p.publishedByName ? ` av ${p.publishedByName}` : ''}
                        </div>
                        {p.delivery.status === 'sent' && p.delivery.sentAtLabel && (
                          <div className="mt-0.5 text-xs text-slate-400">Mottagen {p.delivery.sentAtLabel}</div>
                        )}
                        {p.delivery.status !== 'sent' && p.delivery.lastError && (
                          <div className="mt-1 break-words text-xs text-red-700">{p.delivery.lastError}</div>
                        )}
                        {p.delivery.nextAttemptLabel && (
                          <div className="mt-0.5 text-xs text-slate-500">Nästa försök {p.delivery.nextAttemptLabel}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
      </Tabs>

      {confirming && preview.ok && (
        <DialogShell
          eyebrow="Publicera prislistan"
          title={`Publicera ${articlesLabel(articles.length)}?`}
          description={`Prislistan blir en ny lista för alla butiker och gäller nya offerter från ${validFrom}. Offerter som redan finns behåller sina priser.`}
          onClose={() => (busy === null ? setConfirming(false) : undefined)}
          panelClassName="max-w-md"
        >
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy !== null}>
              Avbryt
            </Button>
            <Button variant="primary" onClick={handlePublish} disabled={busy !== null}>
              {busy === 'publish' ? 'Publicerar…' : 'Publicera'}
            </Button>
          </div>
        </DialogShell>
      )}
    </div>
  );
}

function storeList(names: string[]): string {
  return names.join(', ');
}

/** Butikernas egna prislistor (10b): förhandsvisning, publiceras inte än. */
function PartnerListsSection({ partnerLists }: { partnerLists: NonNullable<PartnerPricelistsView> }) {
  return (
    <section className={`${CARD} min-w-0`} aria-labelledby="partner-lists-heading">
      <h2 id="partner-lists-heading" className="m-0 mb-1 text-base font-bold text-slate-900">
        Butikernas egna prislistor
      </h2>
      <p className="m-0 mb-3 text-sm text-slate-500">
        En butik vars kundkort i Fortnox har en annan prislista än A eller 160 får en egen lista: lista 160, med kortets pris
        där det skiljer sig. Kortens listor läses från Fortnox när sidan laddas.
      </p>
      <p className="m-0 mb-4 rounded-xl border border-[#e0e8dc] bg-white px-3.5 py-2.5 text-sm text-slate-600">
        Förhandsvisning. I dag publiceras bara lista 160, och den gäller alla butiker.
      </p>

      {!partnerLists.ok ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">{partnerLists.message}</div>
      ) : (
        // grid-cols-1 = minmax(0, 1fr): utan den blir kolumnen lika bred som tabellen och trycker ut kortet i mobil.
        <div className="grid grid-cols-1 gap-3">
          {partnerLists.problems.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">
              <p className="m-0 font-semibold">
                {partnerLists.problems.length === 1 ? 'En lista gick inte att läsa' : `${partnerLists.problems.length} listor gick inte att läsa`}
              </p>
              <ul className="m-0 mt-1.5 grid gap-1 pl-0">
                {partnerLists.problems.map((p) => (
                  <li key={p.key} className="list-none">
                    <span className="font-semibold">{p.what}</span> ({storeList(p.stores)}): {p.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {partnerLists.lists.map((list) => (
            <div key={list.code} className="min-w-0 rounded-xl border border-[#e0e8dc] bg-white px-3.5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="m-0 text-sm font-bold text-slate-900">Lista {list.code}</h3>
                <span className="text-xs text-slate-500">{articlesLabel(list.articleCount)}</span>
              </div>
              <p className="m-0 mt-0.5 text-xs text-slate-500">
                {list.stores.map((s) => `${s.name} (${s.customerName})`).join(', ')}
              </p>
              {list.differences.length === 0 ? (
                <p className="m-0 mt-2 text-sm text-slate-600">Inga priser skiljer sig från lista 160.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                        <th className="py-1.5 pr-3">Artikel</th>
                        <th className="py-1.5 pr-3">Kundnamn</th>
                        <th className="py-1.5 pr-3 text-right">Lista 160</th>
                        <th className="py-1.5 text-right">Lista {list.code}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.differences.map((d) => (
                        <tr key={d.articleNumber} className="border-b border-slate-100 last:border-0">
                          <td className="py-1.5 pr-3">
                            <Link href={articleHref(d.articleNumber)} className="font-semibold text-slate-900 no-underline hover:underline">
                              {d.articleNumber}
                            </Link>
                          </td>
                          <td className="py-1.5 pr-3 text-slate-700">{d.customerName}</td>
                          <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums text-slate-500">
                            {d.sharedUnitCost === null ? 'Inte med' : formatKr(d.sharedUnitCost)}
                          </td>
                          <td className="whitespace-nowrap py-1.5 text-right tabular-nums font-semibold text-slate-900">
                            {d.partnerUnitCost === null ? 'Inte med' : formatKr(d.partnerUnitCost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {partnerLists.sharedStores.length > 0 && (
            <p className="m-0 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">Lista 160:</span> {storeList(partnerLists.sharedStores)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { documentRef } from '@/app/crm/lib/format';
import { quoteStatusMeta } from '@/app/crm/lib/crmTokens';
import { openFortnoxPdf } from '@/app/crm/lib/fortnoxDoc';
import { withReturnTo } from '@/app/crm/lib/returnTo';
import { resolveQuoteVatBreakdown, quoteAmountDisplay } from '@/lib/domains/crm/pricing';
import { quoteCustomerName, isQuoteOverdue } from '@/app/crm/lib/quoteDisplay';
import type { EmailableDocument } from '@/app/crm/components/useDocumentEmail';
import type { WorkOrderReadinessIssue } from '@/lib/domains/crm/workOrderReadiness';
import WorkOrderReadinessNotice from '@/app/crm/components/WorkOrderReadinessNotice';
import CrmConfirmDialog from '@/app/crm/components/CrmConfirmDialog';

// The quote detail modal, shared by the offer list and the Säljtavla board.
//
// It lived inline in QuotesClient, which is why clicking a card on the board used to bounce you to
// the list (?quote_id=…) just to open it — a detour that made the board unusable as a primary
// workspace. The panel owns its own actions and their in-flight state; a consumer only supplies the
// quote, tells it how to close, and receives the updated row back so its own list stays in sync.

export type QuoteDetailItem = {
  id: string;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
  quote_number: string | null;
  fortnox_offer_number: string | null;
  fortnox_sync_status: 'not_synced' | 'pending' | 'synced' | 'failed' | null;
  project_name: string;
  description: string | null;
  notes: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_snapshot: { customer_name?: string | null; company_name?: string | null; email?: string | null } | null;
  // Passed straight back on the status PATCH; the panel never reads into it.
  customer_source: { kind?: string | null } | null;
  prospect_id: string | null;
  prospect: { company_name: string } | Array<{ company_name: string }> | null;
  quote_type: 'private' | 'business';
  pricing_summary: { subtotal?: number; vat?: number; total?: number } | null;
  amount: number | string;
  currency_code: string;
  vat_percent: number | string | null;
  quote_date: string;
  follow_up_date: string | null;
  valid_until: string | null;
  work_order_id: string | null;
  work_order_number: string | null;
};

function formatCurrency(value: number | string, currencyCode: string) {
  const numeric = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(numeric)) return '–';
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currencyCode || 'SEK', maximumFractionDigits: 0 }).format(numeric);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}

/**
 * What an action changed, for the consumer to apply to its own row.
 *
 * ⚠️ A PATCH, deliberately — not a finished row. Merging onto the `quote` prop here would use the
 * value captured when the button was clicked: start a slow Fortnox push, flip the status while it
 * spins, and the push's late response would carry the OLD status back and revert the change on
 * screen while the database holds the new one. Consumers apply this functionally against their
 * current state instead, which is what the code this replaced did.
 *
 * Only scalar fields, so it spreads cleanly onto either surface's row type — the offer list and the
 * board declare the same API rows differently (full prospect record vs. just its company_name).
 */
export type QuoteDetailPatch = {
  id: string;
  status?: QuoteDetailItem['status'];
  work_order_id?: string | null;
  work_order_number?: string | null;
  converted_to_work_order_at?: string | null;
  fortnox_offer_number?: string | null;
  fortnox_sync_status?: QuoteDetailItem['fortnox_sync_status'];
  fortnox_synced_at?: string | null;
  updated_at?: string;
};

/** Narrow a full server row down to the fields a consumer needs to apply. */
function patchFromItem(id: string, item: QuoteDetailItem | undefined, fallback: Partial<QuoteDetailPatch>): QuoteDetailPatch {
  if (!item) return { id, ...fallback };
  return {
    id,
    status: item.status,
    work_order_id: item.work_order_id,
    work_order_number: item.work_order_number,
    fortnox_offer_number: item.fortnox_offer_number,
    fortnox_sync_status: item.fortnox_sync_status,
  };
}

export default function QuoteDetailPanel({
  quote,
  workOrderFortnoxNumber,
  returnTo,
  onClose,
  onQuoteChanged,
  documentEmail,
}: {
  quote: QuoteDetailItem;
  /** Fortnox order number for this quote's work order, if the consumer has indexed it. */
  workOrderFortnoxNumber: string | null;
  /**
   * Where the customer-card link should return to. Supplied per surface: hardcoding the offer list
   * would have dumped a board user onto the list — reintroducing the very detour this panel removes.
   */
  returnTo: string;
  onClose: () => void;
  /** What changed, for the consumer to apply against its own current state. */
  onQuoteChanged: (patch: QuoteDetailPatch) => void;
  /**
   * Owned by the CONSUMER, not by this panel. The e-mail flow has its own dismissable progress
   * overlay and outlives the modal it was started from — a hook living here would be torn down with
   * the panel, silently dropping a half-finished send.
   */
  documentEmail: { sendingId: string | null; start: (doc: EmailableDocument) => void };
}) {
  const router = useRouter();
  const toast = useToast();

  const [moving, setMoving] = useState(false);
  const [creatingWorkOrder, setCreatingWorkOrder] = useState(false);
  const [pushingFortnox, setPushingFortnox] = useState(false);
  const [loadingOfferPdf, setLoadingOfferPdf] = useState(false);
  const [loadingOrderPdf, setLoadingOrderPdf] = useState(false);
  // Vad som saknas innan offerten kan bli en arbetsorder. Servern räknar ut det (samma funktion
  // som skapandet använder) — panelens rad bär bara en beskuren snapshot och kan inte avgöra det.
  const [readiness, setReadiness] = useState<{ blockers: WorkOrderReadinessIssue[]; warnings: WorkOrderReadinessIssue[] } | null>(null);

  // Bekräftelsen före "Vunnen" väntar här i stället för i ett window.confirm. Statusen läggs undan
  // och plockas upp när dialogen svarar — annars hade anropet behövt blockera tråden.
  const [pendingWonStatus, setPendingWonStatus] = useState<QuoteDetailItem['status'] | null>(null);
  const [readinessNonce, setReadinessNonce] = useState(0);
  const [rechecking, setRechecking] = useState(false);

  // Hämtas bara i det läge knappen är tänkt att gå att trycka på, alltså vunnen offert utan order.
  const readinessQuoteId = quote.status === 'won' && !quote.work_order_id ? quote.id : null;

  useEffect(() => {
    if (!readinessQuoteId) { setReadiness(null); return; }
    let cancelled = false;
    fetch(`/api/crm/quotes/${readinessQuoteId}/work-order`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (cancelled || !json?.ok) return;
        setReadiness({ blockers: json.data?.blockers ?? [], warnings: json.data?.warnings ?? [] });
      })
      .catch(() => { /* tyst — servern nekar ändå om något saknas */ })
      .finally(() => { if (!cancelled) setRechecking(false); });
    return () => { cancelled = true; };
  }, [readinessQuoteId, readinessNonce]);

  // Avstängd bara när vi VET att något saknas. Misslyckades hämtningen lämnas knappen aktiv —
  // servern spärrar ändå, och en död knapp utan förklaring är värre än ett fel efter klicket.
  const workOrderBlocked = (readiness?.blockers.length ?? 0) > 0;


  // A work order locks the offer in Fortnox — unless the last sync failed, in which case the
  // re-sync button stays available so the user can recover.
  const offerLocked = Boolean(quote.work_order_id) && quote.fortnox_sync_status !== 'failed';
  const display = quoteAmountDisplay(quote.quote_type, resolveQuoteVatBreakdown(quote));
  const customerName = quoteCustomerName(quote);

  // Won is a meaningful transition — confirm it, exactly as the board's drag-and-drop does. A
  // linked prospect is converted to a customer server-side and that cannot be undone from here,
  // so the same board offering two different safety levels for one transition would be worse than
  // offering none.
  function requestMoveToStatus(nextStatus: QuoteDetailItem['status']) {
    if (quote.status === nextStatus) return;
    if (nextStatus === 'won') { setPendingWonStatus(nextStatus); return; }
    void moveQuoteToStatus(nextStatus);
  }

  async function moveQuoteToStatus(nextStatus: QuoteDetailItem['status']) {
    if (quote.status === nextStatus) return;
    setPendingWonStatus(null);
    setMoving(true);
    try {
      const res = await fetch(`/api/crm/quotes/${quote.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: quote.prospect_id,
          customer_name: quote.customer_name,
          quote_type: quote.quote_type,
          customer_source: quote.customer_source,
          customer_snapshot: quote.customer_snapshot,
          pricing_summary: quote.pricing_summary,
          project_name: quote.project_name,
          description: quote.description,
          amount: quote.amount,
          currency_code: quote.currency_code,
          vat_percent: quote.vat_percent,
          valid_until: quote.valid_until,
          status: nextStatus,
          quote_date: quote.quote_date,
          follow_up_date: quote.follow_up_date,
          notes: quote.notes,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte byta status'); return; }
      const updated = json?.data?.item as QuoteDetailItem | undefined;
      onQuoteChanged(patchFromItem(quote.id, updated, { status: nextStatus }));
    } catch {
      toast.error('Kunde inte byta status');
    } finally {
      setMoving(false);
    }
  }

  async function createWorkOrder() {
    if (quote.status !== 'won') { toast.error('Arbetsorder kan bara skapas från vunnen offert'); return; }
    if (quote.work_order_id) { toast.info('Arbetsorder finns redan'); return; }

    setCreatingWorkOrder(true);
    try {
      const res = await fetch(`/api/crm/quotes/${quote.id}/work-order`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        // Saknade uppgifter kommer tillbaka som en lista. Panelen har ingen prompt att rätta dem i
        // (offertformuläret har det), så den visar listan och pekar vidare dit den rättas.
        const details = json?.errorDetails?.details as { blockers?: WorkOrderReadinessIssue[]; warnings?: WorkOrderReadinessIssue[] } | undefined;
        if (details?.blockers?.length) {
          setReadiness({ blockers: details.blockers, warnings: details.warnings ?? [] });
        }
        toast.error(json?.error || 'Kunde inte skapa arbetsorder');
        return;
      }
      const updated = json?.data?.item as QuoteDetailItem | undefined;
      onQuoteChanged(patchFromItem(quote.id, updated, {}));
      const workOrder = json?.data?.workOrder as { id?: string; order_number?: string } | undefined;
      if (json?.data?.fortnox_error) {
        toast.error(`Arbetsorder skapad men Fortnox-synk misslyckades: ${json.data.fortnox_error}`);
      } else {
        toast.success(workOrder?.order_number ? `Arbetsorder skapad: ${workOrder.order_number}` : 'Arbetsorder skapad');
      }
      // Don't auto-navigate — the button flips to "Gå till arbetsorder" so the user
      // can choose to go there when ready.
    } catch { toast.error('Kunde inte skapa arbetsorder'); } finally { setCreatingWorkOrder(false); }
  }

  async function pushToFortnox() {
    setPushingFortnox(true);
    try {
      const res = await fetch('/api/fortnox/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote_id: quote.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte skicka till Fortnox'); return; }
      const offerNumber = json?.data?.fortnox_offer_number as string | undefined;
      const wasUpdated = json?.data?.updated as boolean | undefined;
      toast.success(
        offerNumber
          ? `Fortnox-offert #${offerNumber} ${wasUpdated ? 'uppdaterad' : 'skapad'}`
          : 'Skickad till Fortnox',
      );
      onQuoteChanged({
        id: quote.id,
        fortnox_offer_number: offerNumber ?? quote.fortnox_offer_number,
        fortnox_sync_status: 'synced',
        fortnox_synced_at: new Date().toISOString(),
      });
    } catch {
      toast.error('Kunde inte skicka till Fortnox');
    } finally {
      setPushingFortnox(false);
    }
  }

  // Offer PDF + email, and order-confirmation PDF + email (for the work order created
  // from this quote). Shared fetch/popup/email logic lives in lib/fortnoxDoc.
  async function openOfferPdf() {
    setLoadingOfferPdf(true);
    await openFortnoxPdf(`/api/fortnox/offers/${quote.id}/pdf`, toast.error);
    setLoadingOfferPdf(false);
  }

  async function openOrderPdf(workOrderId: string) {
    setLoadingOrderPdf(true);
    await openFortnoxPdf(`/api/crm/work-orders/${workOrderId}/fortnox/pdf`, toast.error);
    setLoadingOrderPdf(false);
  }

  return (
    <div
      className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/50 [backdrop-filter:blur(4px)] sm:items-center sm:p-4"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Offert ${quote.project_name}`}
          onClick={(e) => e.stopPropagation()}
          className="flex h-[100dvh] max-h-[100dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-none bg-white shadow-[0_-12px_50px_rgba(15,23,42,0.30)] sm:h-auto sm:max-h-[88vh] sm:rounded-2xl sm:shadow-[0_30px_80px_rgba(15,23,42,0.28)]"
        >
          {/* Sticky header */}
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 pb-4 [padding-top:calc(1rem+env(safe-area-inset-top))] sm:pt-4">
            <div className="grid min-w-0 gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', quoteStatusMeta[quote.status].className)}>
                  {quoteStatusMeta[quote.status].label}
                </span>
                {quote.quote_number ? (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{documentRef(quote.fortnox_offer_number, quote.quote_number)}</span>
                ) : null}
              </div>
              <strong className="truncate text-lg font-bold tracking-tight text-slate-950">{quote.project_name}</strong>
              {/* Link to the customer card when the quote is tied to a saved CRM customer; a
                  prospect/snapshot-only quote (no customer_id) keeps a plain name. returnTo points
                  back at the list WITH ?quote_id so the detail modal re-opens on return (same
                  open-then-return workflow as the offer form). */}
              {quote.customer_id ? (
                <Link
                  href={`/crm/kunder/${quote.customer_id}?returnTo=${encodeURIComponent(returnTo)}`}
                  className="m-0 inline-flex max-w-full items-center gap-1 text-sm text-slate-500 transition-colors hover:text-emerald-700"
                >
                  <span className="truncate underline-offset-2 hover:underline">{customerName}</span>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden className="shrink-0">
                    <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              ) : (
                <p className="m-0 truncate text-sm text-slate-500">{customerName}</p>
              )}
            </div>
            <button
              type="button"
              aria-label="Stäng"
              onClick={onClose}
              className="h-9 w-9 shrink-0 rounded-full border border-slate-200 bg-white p-0 text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
            >
              <svg className="mx-auto" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable body */}
          <div className="grid flex-1 gap-5 overflow-y-auto px-5 py-5">
            {/* Hero: amount + key dates */}
            <div className="rounded-xl border border-[#e3e9df] bg-[#f6f9f3] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{display?.primaryLabel ?? 'Belopp'}</div>
              <div className="mt-0.5 text-[1.75rem] font-bold leading-none tracking-tight text-slate-900 tabular-nums">
                {formatCurrency(display?.primary ?? quote.amount, quote.currency_code)}
              </div>
              {display ? (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                  <span>Ex moms <span className="font-medium text-slate-600 tabular-nums">{formatCurrency(display.subtotal, quote.currency_code)}</span></span>
                  <span>Moms ({display.vatPercent} %) <span className="font-medium text-slate-600 tabular-nums">{formatCurrency(display.vat, quote.currency_code)}</span></span>
                  <span>Inkl. moms <span className="font-medium text-slate-600 tabular-nums">{formatCurrency(display.total, quote.currency_code)}</span></span>
                </div>
              ) : null}
              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-[#dce6d6] pt-3">
                {([
                  ['Offertdatum', formatDate(quote.quote_date), false],
                  ['Följ upp', formatDate(quote.follow_up_date), isQuoteOverdue(quote)],
                  ['Giltig till', formatDate(quote.valid_until), false],
                ] as Array<[string, string, boolean]>).map(([lbl, val, warn]) => (
                  <div key={lbl} className="grid gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{lbl}</span>
                    <span className={cn('text-sm font-medium', warn ? 'text-amber-700' : 'text-slate-700')}>{warn ? '⚠ ' : ''}{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Description */}
            {quote.description ? (
              <div className="grid gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Beskrivning</span>
                <p className="m-0 text-sm leading-6 text-slate-700">{quote.description}</p>
              </div>
            ) : null}

            {/* Status changer */}
            <div className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Byt status</span>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(quoteStatusMeta) as Array<[QuoteDetailItem['status'], typeof quoteStatusMeta[QuoteDetailItem['status']]]>).map(([s, meta]) => {
                  const isCurrent = quote.status === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={moving || isCurrent}
                      onClick={() => requestMoveToStatus(s)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                        isCurrent
                          ? cn(meta.className, 'cursor-default')
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50',
                      )}
                    >
                      {isCurrent ? <span className={cn('h-1.5 w-1.5 rounded-full', meta.accent)} /> : null}
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            {quote.notes ? (
              <div className="grid gap-1.5 rounded-xl border border-amber-100 bg-amber-50/60 p-3.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700/80">Anteckningar</span>
                <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-slate-700">{quote.notes}</p>
              </div>
            ) : null}

            {/* Action cards */}
            <div className="grid gap-3">
              {/* Work order */}
              <div className="rounded-xl border border-[#e3e9df] bg-[#f9fbf7] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2.5h6V4M9 11h6M9 15h4" />
                      </svg>
                    </span>
                    <div className="grid min-w-0 gap-0.5">
                      <span className="text-sm font-semibold text-slate-800">Arbetsorder</span>
                      <span className="text-xs leading-5 text-slate-500">
                        {quote.work_order_id
                          ? `${documentRef(workOrderFortnoxNumber, quote.work_order_number)} är skapad.`
                          : quote.status === 'won'
                            ? 'Klar att bli en intern arbetsorder.'
                            : 'Sätt offerten till vunnen för att skapa.'}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {quote.work_order_id ? (
                      <button
                        type="button"
                        onClick={() => router.push(`/crm/arbetsorder/${quote.work_order_id}`)}
                        className="rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
                      >
                        Gå till arbetsorder
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void createWorkOrder()}
                        disabled={quote.status !== 'won' || creatingWorkOrder || workOrderBlocked}
                        className="rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
                      >
                        {creatingWorkOrder ? 'Skapar…' : 'Skapa arbetsorder'}
                      </button>
                    )}
                  </div>
                </div>

                {!quote.work_order_id && quote.status === 'won' && readiness ? (
                  <WorkOrderReadinessNotice
                    className="mt-3"
                    blockers={readiness.blockers}
                    warnings={readiness.warnings}
                    customerHref={quote.customer_id ? `/crm/kunder/${quote.customer_id}?returnTo=${encodeURIComponent(returnTo)}` : null}
                    quoteHref={`/crm/offerter/${quote.id}/redigera?returnTo=${encodeURIComponent(returnTo)}`}
                    onRecheck={readiness.blockers.length > 0 ? () => { setRechecking(true); setReadinessNonce((n) => n + 1); } : null}
                    rechecking={rechecking}
                  />
                ) : null}

                {/* Order confirmation — once a work order (Fortnox order) exists */}
                {quote.work_order_id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#e3e9df] pt-3">
                    <span className="mr-auto text-xs font-medium text-slate-500">Orderbekräftelse</span>
                    <button
                      type="button"
                      onClick={() => void openOrderPdf(quote.work_order_id!)}
                      disabled={loadingOrderPdf}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loadingOrderPdf ? 'Hämtar…' : 'Hämta PDF'}
                    </button>
                    <button
                      type="button"
                      onClick={() => documentEmail.start({
                        id: quote.work_order_id!,
                        kind: 'order',
                        ref: documentRef(workOrderFortnoxNumber, quote.work_order_number),
                        projectName: quote.project_name,
                        customerName,
                        snapshotEmail: quote.customer_snapshot?.email,
                        customerId: quote.customer_id,
                        pdfUrl: `/api/crm/work-orders/${quote.work_order_id}/fortnox/pdf`,
                      })}
                      disabled={documentEmail.sendingId === quote.work_order_id}
                      className="rounded-lg border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {documentEmail.sendingId === quote.work_order_id ? 'Mejlar…' : 'Mejla order'}
                    </button>
                  </div>
                ) : null}
              </div>

              {/* Fortnox */}
              <div className="rounded-xl border border-[#e3e9df] bg-[#f9fbf7] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 16V4M8 8l4-4 4 4M5 20h14" />
                      </svg>
                    </span>
                    <div className="grid min-w-0 gap-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-slate-800">Fortnox</span>
                        {offerLocked ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" />
                            </svg>
                            Låst
                          </span>
                        ) : null}
                      </div>
                      <span className="text-xs leading-5 text-slate-500">
                        {quote.fortnox_offer_number
                          ? `Offert #${quote.fortnox_offer_number} skapad.`
                          : 'Skicka offerten till Fortnox.'}
                      </span>
                      {quote.fortnox_sync_status === 'failed' ? (
                        <span className="text-xs font-semibold text-rose-600">Senaste synk misslyckades.</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {quote.fortnox_offer_number ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void openOfferPdf()}
                          disabled={loadingOfferPdf}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {loadingOfferPdf ? 'Hämtar…' : 'Hämta PDF'}
                        </button>
                        {/* Ett enda mejlsätt: eget mejlprogram. Fortnox egen offertutskick är
                            borttaget — mottagaren gick inte att styra därifrån och används inte. */}
                        <button
                          type="button"
                          onClick={() => documentEmail.start({
                            id: quote.id,
                            kind: 'offer',
                            ref: documentRef(quote.fortnox_offer_number, quote.quote_number),
                            projectName: quote.project_name,
                            customerName,
                            snapshotEmail: quote.customer_snapshot?.email,
                            customerId: quote.customer_id,
                            pdfUrl: `/api/fortnox/offers/${quote.id}/pdf`,
                          })}
                          disabled={documentEmail.sendingId === quote.id}
                          title="Öppnar ditt mejlprogram – PDF:en laddas ner att bifoga."
                          className="inline-flex items-center rounded-lg border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {documentEmail.sendingId === quote.id ? 'Mejlar…' : 'Mejla offert'}
                        </button>
                      </>
                    ) : null}
                    {/* Sync/re-sync hidden once a work order locks the offer in Fortnox
                        (but still shown if the sync failed, so the user can recover) */}
                    {!offerLocked ? (
                      <button
                        type="button"
                        onClick={() => void pushToFortnox()}
                        disabled={pushingFortnox || quote.fortnox_sync_status === 'pending'}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
                          quote.fortnox_offer_number
                            ? 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                            : 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700',
                        )}
                      >
                        {pushingFortnox ? 'Skickar…' : quote.fortnox_offer_number ? 'Skicka igen' : 'Skicka'}
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Locked explanation — offer can no longer be edited/re-synced */}
                {offerLocked ? (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs leading-5 text-amber-900">
                    <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" />
                    </svg>
                    <span>
                      Offerten är <strong>låst</strong>{quote.work_order_number ? ` – arbetsorder ${quote.work_order_number} är skapad` : ' – en arbetsorder har skapats'}, så den kan inte längre ändras eller synkas om i Fortnox. Du kan fortfarande hämta PDF:en och mejla den till kunden.
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Sticky footer — a locked offer (work order created) can't be edited or
              re-synced, so the edit action is hidden and "Stäng" fills the row. */}
          <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))] sm:[padding-bottom:0.75rem]">
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300',
                !offerLocked && 'sm:flex-none sm:px-5',
              )}
            >
              Stäng
            </button>
            {!offerLocked ? (
              <button
                type="button"
                onClick={() => { onClose(); router.push(withReturnTo(`/crm/offerter/${quote.id}/redigera`, returnTo)); }}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 sm:ml-auto sm:flex-none sm:px-5"
                style={{ backgroundColor: 'var(--crm-primary)' }}
              >
                Redigera offert
              </button>
            ) : null}
          </div>
        </div>

      {pendingWonStatus ? (
        <CrmConfirmDialog
          title="Markera offerten som vunnen?"
          message={
            quote.prospect_id
              ? 'Ett kopplat prospekt konverteras då till kund. Det går inte att ångra härifrån.'
              : undefined
          }
          confirmLabel="Markera som vunnen"
          busy={moving}
          onConfirm={() => void moveQuoteToStatus(pendingWonStatus)}
          onCancel={() => setPendingWonStatus(null)}
        />
      ) : null}
    </div>
  );
}

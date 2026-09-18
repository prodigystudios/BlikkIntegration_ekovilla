"use client";
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/shared/cn';
import { crm, quoteStatusMeta } from '@/app/crm/lib/crmTokens';
import type { QuoteDetailItem } from '@/app/crm/components/QuoteDetailPanel';
import { documentRef } from '@/app/crm/lib/format';
import { sortCustomerQuotes } from '@/app/crm/lib/quoteDisplay';
import { resolveQuoteVatBreakdown, quoteAmountDisplay } from '@/lib/domains/crm/pricing';
import { useTopmostEscape } from '@/app/crm/components/useTopmostEscape';

// Kundens övriga offerter, i en låda vid sidan av offertpanelen.
//
// ── Varför en portal och inte ett barn i panelen ──
//
// Escape avgörs på DOKUMENTORDNING (useTopmostEscape): den som ligger sist stänger först. En portal
// till <body> hamnar efter panelen, precis som uppgifts- och kontaktformulären redan gör — så
// Escape stänger lådan och lämnar offerten öppen. Nästlat i panelen hade lådan dessutom ärvt
// modalens `backdrop-filter`, som gör ett `position: fixed`-barn relativt overlägget.
//
// ── Varför ingen egen route ──
//
// /api/crm/quotes?customer_id= finns redan, körs med sessionsklienten och lämnar tillbaka hela
// offertraden. RLS på crm_quotes är "egen offert eller crm.offer.read", alltså exakt de som redan
// ser varje offert i listan — ingen ny krets ser något nytt, och ingen elevering behövs.
// Att raden kommer komplett är också varför klicket kan skicka HELA offerten till panelen i
// stället för ett id som panelens ägare måste hämta en gång till.

/**
 * En rad i lådan.
 *
 * Byggd PÅ panelens egen `QuoteDetailItem` med flit: raden ska kunna skickas rakt in i panelen när
 * man klickar, så den måste per definition vara allt panelen kräver. Ett eget fältgäng här hade
 * blivit husets fjärde beskrivning av samma API-rad (offertlistan och säljtavlan har var sin), och
 * den som driver isär märks först när panelen öppnas på en tom ruta.
 *
 * `created_at` är det enda som tillkommer — sorteringens andra nyckel.
 */
export type CustomerQuoteItem = QuoteDetailItem & { created_at: string };


function formatDate(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '–' : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}

/**
 * Beloppet som offertlistan visar det: rubriktalet plus vilken bas det är.
 *
 * ⚠️ `primary` och INTE `total` — för en privatkund är rubriktalet inkl. moms, för ett företag ex
 * moms, och vid omvänd skattskyldighet ex moms med egen etikett. Att plocka ett fast fält här hade
 * gett två olika belopp för samma offert beroende på var man läser den.
 */
function formatAmount(quote: CustomerQuoteItem) {
  const display = quoteAmountDisplay(quote.quote_type, resolveQuoteVatBreakdown(quote));
  const amount = new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: quote.currency_code || 'SEK',
    maximumFractionDigits: 0,
  }).format(display.primary);
  return `${amount} ${display.basisSuffix}`;
}

export default function CustomerQuotesDrawer({
  customerId,
  prospectId,
  currentQuoteId,
  customerLabel,
  onSelect,
  onClose,
}: {
  customerId: string | null;
  /** Reserven för en offert som ännu bara hänger på ett prospekt. */
  prospectId: string | null;
  /** Den offert panelen visar just nu — markeras i listan i stället för att döljas. */
  currentQuoteId: string;
  customerLabel: string;
  /** Hela offertraden, så panelens ägare kan öppna den utan en ny hämtning. */
  onSelect: (quote: CustomerQuoteItem) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useTopmostEscape(ref, onClose);

  const [quotes, setQuotes] = useState<CustomerQuoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Kund först, prospekt som reserv: en offert skriven innan kunden lades upp hänger bara på
    // prospektet, och då är det den kopplingen som samlar syskonen.
    const scope = customerId
      ? `customer_id=${encodeURIComponent(customerId)}`
      : prospectId
        ? `prospect_id=${encodeURIComponent(prospectId)}`
        : null;
    if (!scope) { setLoading(false); return; }

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    fetch(`/api/crm/quotes?${scope}&limit=100`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (cancelled) return;
        if (!json?.ok) { setFailed(true); setQuotes([]); return; }
        setQuotes(sortCustomerQuotes((json.data?.items ?? []) as CustomerQuoteItem[]));
      })
      .catch(() => { if (!cancelled) { setFailed(true); setQuotes([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [customerId, prospectId]);

  const others = quotes.filter((quote) => quote.id !== currentQuoteId);

  return createPortal(
    <div ref={ref} className="fixed inset-0 z-[2900] flex justify-end" role="dialog" aria-label="Kundens offerter">
      {/* Klick utanför stänger. Ingen mörkläggning: offerten bakom ska gå att läsa medan man
          jämför, det är hela skälet att lådan ligger vid sidan och inte ovanpå. */}
      <button
        type="button"
        aria-label="Stäng listan"
        onClick={onClose}
        className="flex-1 cursor-default border-0 bg-slate-950/20 p-0"
      />
      <div className="crm-overlay-in flex h-full w-[400px] max-w-[92vw] flex-col border-l border-solid border-[#dce4d8] bg-white shadow-[0_18px_36px_-12px_rgba(20,44,27,0.28)]">
        <div className="flex items-start justify-between gap-3 border-b border-solid border-[#e3e9df] px-4 py-3">
          <div className="grid min-w-0 gap-0.5">
            <span className="text-sm font-semibold text-slate-900">Kundens offerter</span>
            <span className="truncate text-xs text-slate-500">{customerLabel}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng"
            className="px-2 py-1 rounded-lg border border-solid border-[#dce4d8] bg-white text-sm font-semibold text-slate-600 transition hover:border-[#c8d4c3]"
          >
            ✕
          </button>
        </div>

        <div className="grid content-start gap-1.5 overflow-y-auto p-3">
          {loading ? <span className="px-1 text-sm text-slate-500">Hämtar…</span> : null}
          {!loading && failed ? <span className="px-1 text-sm text-rose-600">Kunde inte hämta kundens offerter.</span> : null}
          {!loading && !failed && others.length === 0 ? (
            <span className="px-1 text-sm text-slate-500">Kunden har inga andra offerter.</span>
          ) : null}

          {others.map((quote) => (
            <button
              key={quote.id}
              type="button"
              onClick={() => onSelect(quote)}
              className="grid gap-1 rounded-xl border border-solid border-[#e3e9df] bg-white px-3 py-2.5 text-left transition hover:border-[#c8d4c3]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {documentRef(quote.fortnox_offer_number, quote.quote_number)}
                </span>
                <span className={cn(crm.badge, quoteStatusMeta[quote.status].className)}>
                  {quoteStatusMeta[quote.status].label}
                </span>
                {/* En offert som blivit arbetsorder är inte längre bara en offert — säg det, annars
                    ser raden ut som ett öppet ärende. */}
                {quote.work_order_number ? (
                  <span className="text-[11px] font-semibold text-emerald-700">Order</span>
                ) : null}
              </div>
              <span className="truncate text-sm font-semibold text-slate-800">{quote.project_name}</span>
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                <span>{formatDate(quote.quote_date)}</span>
                <span>·</span>
                <span className="tabular-nums">{formatAmount(quote)}</span>
              </div>
            </button>
          ))}

          {!loading && !failed && quotes.length > others.length ? (
            <span className="px-1 pt-1 text-xs text-slate-400">
              Den öppna offerten ({documentRef(
                quotes.find((q) => q.id === currentQuoteId)?.fortnox_offer_number ?? null,
                quotes.find((q) => q.id === currentQuoteId)?.quote_number ?? null,
              )}) visas inte i listan.
            </span>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

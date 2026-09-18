"use client";
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/shared/cn';
import { crm, quoteStatusMeta } from '@/app/crm/lib/crmTokens';
import type { QuoteDetailItem } from '@/app/crm/components/QuoteDetailPanel';
import { documentRef, formatCurrency, formatDate } from '@/app/crm/lib/format';
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


/** Taket för hur många rader lådan hämtar. Fler än så och vi säger att listan är kapad. */
const ROW_LIMIT = 100;

/**
 * Beloppet som offertlistan visar det: rubriktalet plus vilken bas det är.
 *
 * ⚠️ `primary` och INTE `total` — för en privatkund är rubriktalet inkl. moms, för ett företag ex
 * moms, och vid omvänd skattskyldighet ex moms med egen etikett. Att plocka ett fast fält här hade
 * gett två olika belopp för samma offert beroende på var man läser den.
 */
function formatAmount(quote: CustomerQuoteItem) {
  const display = quoteAmountDisplay(quote.quote_type, resolveQuoteVatBreakdown(quote));
  return `${formatCurrency(display.primary, quote.currency_code)} ${display.basisSuffix}`;
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
  /** Den offert panelen visar just nu. Filtreras BORT ur listan; en fotnot säger att den är det. */
  currentQuoteId: string;
  customerLabel: string;
  /** Hela offertraden, så panelens ägare kan öppna den utan en ny hämtning. */
  onSelect: (quote: CustomerQuoteItem) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useTopmostEscape(ref, onClose);

  // Utan det här låg fokus kvar på knappen i panelen BAKOM: Tab vandrade vidare bland kontroller
  // under överlägget medan lådan var oåtkomlig, och en skärmläsare sa ingenting när den öppnades.
  useEffect(() => { closeRef.current?.focus(); }, []);

  const [quotes, setQuotes] = useState<CustomerQuoteItem[]>([]);
  /** Hur många kunden har totalt, för att kunna säga när listan är kapad. */
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Kund först, prospekt som reserv: en offert skriven innan kunden lades upp hänger bara på
  // prospektet, och då är det den kopplingen som samlar syskonen.
  const scope = customerId
    ? `customer_id=${encodeURIComponent(customerId)}`
    : prospectId
      ? `prospect_id=${encodeURIComponent(prospectId)}`
      : null;

  useEffect(() => {
    // ⚠️ `currentQuoteId` i beroendena: raderna ska hämtas OM om panelen byter offert under lådan.
    // I dag startas panelen om vid byte (`key` hos anroparen) så lådan stängs ändå — men beroendet
    // står kvar som spärr, för utan det låg raderna kvar som de såg ut när lådan öppnades, och en
    // syskonoffert vars status ändrats hade skickats tillbaka in i panelen i sitt GAMLA skick.
    //
    // Beroendet är `scope`-STRÄNGEN, inte dess två delar: två offerter på samma kund kan ha olika
    // prospect_id utan att urvalet ändras, och då ska ingen ny hämtning gå ut.
    if (!scope) {
      // Varken kund eller prospekt att fråga om. Städa — annars stod förra kundens rader kvar under
      // den nya offertens rubrik — och SÄG att vi inte vet, i stället för att påstå att det inte
      // finns några.
      setQuotes([]);
      setFailed(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    // 🧨 `sort=created_desc` MÅSTE med. Rutten ordnar annars efter status, och `limit` kapar då de
    // hundra med lägst statusordning — en offert vunnen förra veckan kunde falla bort helt ur en
    // lista som utger sig för att vara kundens historik.
    fetch(`/api/crm/quotes?${scope}&sort=created_desc&limit=${ROW_LIMIT}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (cancelled) return;
        if (!json?.ok) { setFailed(true); setQuotes([]); setTotal(0); return; }
        setQuotes(sortCustomerQuotes((json.data?.items ?? []) as CustomerQuoteItem[]));
        setTotal(Number(json.data?.total ?? 0));
      })
      .catch(() => { if (!cancelled) { setFailed(true); setQuotes([]); setTotal(0); } })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [scope, currentQuoteId]);

  const others = quotes.filter((quote) => quote.id !== currentQuoteId);
  const hasScope = Boolean(scope);
  const current = quotes.find((quote) => quote.id === currentQuoteId) ?? null;

  return createPortal(
    <div ref={ref} className="fixed inset-0 z-[2900] flex justify-end">
      {/* Klick utanför stänger. Ingen mörkläggning: offerten bakom ska gå att läsa medan man
          jämför, det är hela skälet att lådan ligger vid sidan och inte ovanpå.
          ⚠️ UTANFÖR dialognoden — som barn lästes "Stäng listan, knapp" upp som dialogens första
          innehåll. Samma uppdelning som CrmModal gör. */}
      <button
        type="button"
        aria-label="Stäng listan"
        onClick={onClose}
        className="flex-1 cursor-default border-0 bg-slate-950/20 p-0"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Kundens offerter"
        className="crm-overlay-in flex h-full w-[400px] max-w-[92vw] flex-col border-l border-solid border-[#dce4d8] bg-white shadow-[0_18px_36px_-12px_rgba(20,44,27,0.28)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-solid border-[#e3e9df] px-4 py-3">
          <div className="grid min-w-0 gap-0.5">
            <span className="text-sm font-semibold text-slate-900">Kundens offerter</span>
            <span className="truncate text-xs text-slate-500">{customerLabel}</span>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Stäng"
            className="px-2 py-1 rounded-lg border border-solid border-[#dce4d8] bg-white text-sm font-semibold text-slate-600 transition hover:border-[#c8d4c3]"
          >
            ✕
          </button>
        </div>

        {/* Raderna går kant i kant med lådan och skiljs av linjer, inte av kort: en låda är redan en
            yta, och kort inuti den blev en ram i en ram. Endast över- och underkant — William,
            2026-09-18. Sidopadding bor därför på RADEN, inte på listan. */}
        <div className="grid content-start overflow-y-auto border-t border-x-0 border-b-0 border-solid border-[#e3e9df]">
          {loading ? <span className="px-4 py-3 text-sm text-slate-500">Hämtar…</span> : null}
          {!loading && failed ? <span className="px-4 py-3 text-sm text-rose-600">Kunde inte hämta kundens offerter.</span> : null}
          {!loading && !failed && others.length === 0 ? (
            <span className="px-4 py-3 text-sm text-slate-500">
              {hasScope
                ? 'Kunden har inga andra offerter.'
                // Varken kund eller prospekt på offerten — då VET vi inte, och ska inte påstå.
                : 'Offerten är inte kopplad till någon kund, så det går inte att visa fler.'}
            </span>
          ) : null}

          {others.map((quote) => (
            <button
              key={quote.id}
              type="button"
              onClick={() => onSelect(quote)}
              // 🧨 `justify-start`: husets globala button-regel sätter `justify-content: center`, och
              // på ett rutnät centrerar den hela kolumnen — raderna såg ut att flyta omkring på
              // olika nivåer trots `text-left`. Samma skäl som uppgiftskortets listknappar.
              //
              // Linje bara nedtill (listans egen ger den översta): knappar bär redan
              // `border: 1px solid transparent` från samma globala regel, så ingen fantomkant
              // uppstår av att bara en sida får färg.
              className="grid w-full justify-start gap-1 border-x-0 border-t-0 border-b border-solid border-[#e3e9df] bg-white px-4 py-3 text-left transition hover:bg-[#f7f9f5]"
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

          {/* Fotnoten säger något bara när det FINNS andra rader — annars stod den under texten
              "Kunden har inga andra offerter" och motsade den. */}
          {!loading && !failed && others.length > 0 && current ? (
            <span className="px-4 py-3 text-xs text-slate-400">
              Den öppna offerten ({documentRef(current.fortnox_offer_number, current.quote_number)}) visas inte i listan.
            </span>
          ) : null}

          {/* Kapad lista: säg det hellre än att tiga. Annars ser en gammal offert ut som obefintlig. */}
          {!loading && !failed && total > quotes.length ? (
            <span className="px-4 pb-3 text-xs text-amber-700">
              Visar de {quotes.length} senaste av {total}. Äldre offerter finns på kundkortet.
            </span>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

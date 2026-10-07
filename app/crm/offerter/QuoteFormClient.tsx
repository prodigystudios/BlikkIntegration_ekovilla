"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import DatePicker from '../../../components/ui/DatePicker';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { parseDecimal } from '@/lib/shared/number';
import { lineItemQuantity, isBlankLineItem, isUnpricedLineItem, isConfiguredLineItem, pricingModeFromUnit } from '@/lib/domains/crm/lineItems';
import { constructionLabel, inferConstructionFromArticle, type ConstructionSlug } from '@/lib/domains/crm/constructions';
import {
  rowMarginPercent, marginTier, marginPercentForDisplay, quoteMargin, splitRowLabor, lineItemUnitPrice, MARGIN_THRESHOLDS,
  type MarginRow,
} from '@/lib/domains/crm/pricing';
import { calculatePreCalculation, marginCostBasis } from '@/lib/domains/crm/preCalculation';
import { getArticleUnitName } from '@/app/crm/components/ArticlePicker';
import LineItemRow, { MarginBadge } from '@/app/crm/components/LineItemRow';
import { LineItemTotalsBar, GeneratedRotLaborRow } from '@/app/crm/components/LineItemSummary';
import { useCalcSettings } from './useCalcSettings';
import { crm } from '@/app/crm/lib/crmTokens';
import AddressAutocompleteInput from '@/app/crm/components/AddressAutocompleteInput';
import CrmModal from '@/app/crm/components/CrmModal';
import CrmConfirmDialog from '@/app/crm/components/CrmConfirmDialog';
import ContactFormModal from '@/app/crm/components/ContactFormModal';
import type { CrmContactItem } from '@/app/crm/lib/contactForm';
import { formatPersonalNumber, isValidPersonalNumber, PERSONAL_NUMBER_ERROR } from '@/lib/domains/crm/personalNumber';
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getEffectiveCustomerName,
  buildCustomerSnapshot,
  buildRotDetails,
  buildInternalHandoff,
  addDaysIso,
  matchedValidityPreset,
  mergeUntouchedCustomerFields,
  pickCustomerDerived,
  buildFollowUpTaskPayload,
  createEmptyLineItem,
  createInitialDraft,
  draftFromQuote,
  copyDraftFromQuote,
  getDefaultDraftCustomerSource,
  OFFER_VALIDITY_DAYS,
  OFFER_VALIDITY_PRESETS,
  type CustomerDerivedValues,
  type QuoteDraft,
  type QuoteItem,
  type QuoteLineItem,
} from './quoteSerializers';
import { quoteLabel } from '@/app/crm/lib/quoteDisplay';
import { safeReturnTo, withReturnTo } from '@/app/crm/lib/returnTo';
import type { WorkOrderReadinessIssue } from '@/lib/domains/crm/workOrderReadiness';
import WorkOrderReadinessNotice from '@/app/crm/components/WorkOrderReadinessNotice';
import { resolveCrmContact } from '@/lib/domains/crm/contacts';
import { fixPropertyDesignationTyping } from '@/lib/domains/crm/propertyDesignation';
import {
  buildMeasurementLines,
  hasMeasurementBlock,
  replaceMeasurementBlock,
} from '@/lib/domains/crm/measurementBlock';

// ─── Types ───────────────────────────────────────────────────────────────────

type EffectiveRow = QuoteLineItem & {
  amount: number;
  unit: number;
  effectiveUnit: number;
  label: string;
  mode: 'm3' | 'item';
  rowTotal: number;
  // Radens utbrutna ROT-arbetskostnad i kronor (labor_cost per enhet × antal, rabatt inräknad).
  // Räknas här av samma skäl som rowTotal: formuläret prissätter auto-rader med sin egen stub, och
  // pricing.ts lineItemRotLabor hade gett dem 0. Se splitRowLabor.
  rotLabor: number;
  // Arbetskostnaden är högre än A-priset → ingen utbrytning sker. Spärrar sparningen; se
  // getValidationIssues och splitRowLabor.
  rotLaborLeavesNoMaterial: boolean;
  isConfigured: boolean;
};

type CrmCustomerLite = {
  id: string;
  customer_type: 'business' | 'private';
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  organization_number: string | null;
  personal_number: string | null;
  fortnox_customer_id: string | null;
  // The customer card's own contact details. Most customers have NO contact rows (neither the
  // customer form nor the Fortnox import creates any), so these are the only e-mail/phone that
  // exist for them — see resolveQuoteContactFields.
  email: string | null;
  phone: string | null;
  mobile: string | null;
  // Omvänd skattskyldighet (reverse charge). Business-only; drives the offer's moms to 0 %.
  reverse_vat: boolean | null;
  visit_address: { street: string | null; postal_code: string | null; city: string | null } | null;
  delivery_address: { street: string | null; postal_code: string | null; city: string | null } | null;
  contacts: Array<{ id: string; name: string; role: string | null; phone: string | null; email: string | null; is_primary: boolean }>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const quoteStatusMeta: Record<QuoteItem['status'], { label: string; className: string }> = {
  draft: { label: 'Utkast', className: 'border-slate-200 bg-slate-50 text-slate-700' },
  sent: { label: 'Skickad', className: 'border-sky-200 bg-sky-50 text-sky-800' },
  follow_up: { label: 'Följ upp', className: 'border-amber-200 bg-amber-50 text-amber-900' },
  won: { label: 'Vunnen', className: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  lost: { label: 'Förlorad', className: 'border-rose-200 bg-rose-50 text-rose-800' },
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

// Giltighetstiden (standard 30 dagar, rullgardinens val och datumräkningen) bor i
// quoteSerializers — ren logik i en icke-klientmodul, så den är enhetstestad.

/**
 * Fetch the live customer row for the picker, WITHOUT touching the draft.
 *
 * The distinction matters: applySelectedCustomer prefills the draft from the card, which is right
 * when you pick a customer and wrong when you merely need the customer object back. `selectedCustomer`
 * drives the picker chip, the contact dropdown and the reverse-VAT hint — restore a draft without it
 * and those three silently disappear even though the draft still holds the data.
 *
 * Returns null on any failure; every caller treats a missing customer as "just don't show the chip".
 */
async function fetchCustomerLite(id: string): Promise<CrmCustomerLite | null> {
  try {
    const res = await fetch(`/api/crm/customers/${id}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    const c = json?.data?.item;
    if (!c) return null;
    return {
      id: c.id,
      customer_type: c.customer_type,
      company_name: c.company_name ?? null,
      first_name: c.first_name ?? null,
      last_name: c.last_name ?? null,
      organization_number: c.organization_number ?? null,
      personal_number: c.personal_number ?? null,
      fortnox_customer_id: c.fortnox_customer_id ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      mobile: c.mobile ?? null,
      reverse_vat: c.reverse_vat ?? null,
      visit_address: c.visit_address ?? null,
      delivery_address: c.delivery_address ?? null,
      contacts: c.contacts ?? [],
    };
  } catch {
    return null;
  }
}

function buildCustomerSource(customer: CrmCustomerLite | null): QuoteDraft['customer_source'] {
  if (!customer) return { kind: 'local', sync_intent: 'local_only', fortnox_customer_id: '', fortnox_customer_name: '' };
  if (customer.fortnox_customer_id) {
    const displayName =
      customer.company_name ||
      [customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
      'Kund';
    return { kind: 'fortnox', sync_intent: 'linked', fortnox_customer_id: customer.fortnox_customer_id, fortnox_customer_name: displayName };
  }
  return { kind: 'local', sync_intent: 'on_work_order', fortnox_customer_id: '', fortnox_customer_name: '' };
}

function getValidationIssues(draft: QuoteDraft, effectiveRows: EffectiveRow[]) {
  const issues: string[] = [];
  const effectiveCustomerName = getEffectiveCustomerName(draft);
  // SAMMA definition som radkontrollerna (isConfigured). Stod den här på egen hand kunde en rad
  // räknas som "en rad finns" men falla ur varje per-rad-kontroll — en rad med bara blanksteg
  // passerade då hela valideringen utan att någon kontroll tittade på den.
  const hasAnyLineItemInput = draft.items.some((item) => isConfiguredLineItem(item));

  if (!draft.project_name.trim()) issues.push('Offertnamn saknas');
  if (!draft.prospect_id && !draft.customer_id && !effectiveCustomerName) issues.push('Kund måste anges');
  if (draft.customer_source.kind === 'prospect' && !draft.prospect_id) issues.push('Prospektkälla kräver valt prospekt');
  if (draft.customer_source.kind === 'fortnox' && !draft.customer_source.fortnox_customer_name.trim()) issues.push('Fortnox-kund behöver kundreferens');
  // Personnummer krävs inte på offerten ens med ROT — kunden lämnar det ofta först när hen tackar
  // ja. Kravet ligger på arbetsordern (se app/api/crm/quotes/_lib.ts).
  if (draft.quote_type === 'business' && !draft.company_name.trim() && !draft.customer_name.trim()) issues.push('Företagsnamn krävs');
  // Er referens (kontaktperson) is required: it becomes YourReference on the Fortnox
  // offer and carries through offer → order → invoice. Enforced here so no quote leaves
  // without it.
  if (!draft.contact_name.trim()) issues.push('Er referens krävs');
  if (draft.quote_type === 'business' && draft.rot_enabled) issues.push('ROT är bara tillåtet för privatkund');
  // Fastighetsbeteckning is NOT required on the quote — it's only mandatory once the offer becomes a
  // work order (customer-approved), so it's enforced at order creation, not here (the gate lives in
  // createCrmWorkOrderFromQuote and answers `missing_rot_property`; a BRF org.nr identifies a
  // bostadsrätt just as well). The field stays available so it can be filled early when known.
  // Every offer is built from article rows (there is no manual lump-sum amount field), so at least
  // one configured row is required.
  if (!hasAnyLineItemInput) issues.push('Lägg till minst en rad');
  if (hasAnyLineItemInput) {
    const hasInvalidRow = effectiveRows.some((item) => item.isConfigured && (!(item.amount > 0) || !(item.effectiveUnit >= 0)));
    if (hasInvalidRow) issues.push('Ofullständiga rader — mängd och pris krävs');
    // Spärr, inte en varning. En rad utan prisförankring räknas som 0 kr överallt utanför det här
    // formuläret — Fortnox-dokumentet, arbetsordern, planeringens ordervärde. Förr dolde
    // 900-stubben det genom att visa ett pris här som ingen annan yta kände till. Nu syns
    // avsaknaden i stället för att offerten går iväg billigare än säljaren tror.
    // Namnge raderna, som ROT-spärren nedan. En hopfälld rad visar bara "0 kr", och 0 ser likadant
    // ut oavsett om priset saknas eller är satt till noll — utan radnummer blir spärren omöjlig att
    // åtgärda på en offert med många rader.
    const unpriced = effectiveRows.filter((item) => item.isConfigured && isUnpricedLineItem(item));
    if (unpriced.length) {
      const rader = unpriced.map((r) => effectiveRows.indexOf(r) + 1).join(', ');
      // "Skriv 0 om raden ingår" står med FÖR ATT det är ett riktigt fall, inte ett kryphål: en
      // fraktrad som ingår i priset är en medveten nolla. Utan den meningen läser säljaren spärren
      // som att gratisrader inte går att göra längre, och bygger en omväg (fullpris + 100 % rabatt)
      // som ingen bett om. En skriven nolla passerar — se isUnpricedLineItem.
      issues.push(
        `${unpriced.length === 1 ? 'Rad' : 'Rader'} ${rader}: pris saknas — välj artikel, ange A-pris, eller skriv 0 om raden ingår`,
      );
    }
  }
  // Spärr, inte en varning. En arbetskostnad över A-priset bryter inte ut något (se splitRowLabor),
  // så offerten skulle gå till Fortnox utan det ROT-underlag säljaren tror att den har. Det gäller
  // varenda rad som sparats under den gamla tolkningen, där beloppet var ett klumpbelopp för hela
  // raden — de dyker upp här i samma stund någon öppnar offerten, i stället för att märkas när
  // kunden undrar var avdraget tog vägen.
  if (draft.quote_type === 'private' && draft.rot_enabled) {
    const over = effectiveRows.filter((r) => r.isConfigured && !r.is_rot_work && r.rotLaborLeavesNoMaterial);
    if (over.length) {
      const rader = over.map((r) => effectiveRows.indexOf(r) + 1).join(', ');
      issues.push(
        `${over.length === 1 ? 'Rad' : 'Rader'} ${rader}: arbetskostnaden äter hela A-priset — inget material blir kvar`,
      );
    }
  }
  return issues;
}

// ─── CustomerSearchPicker ─────────────────────────────────────────────────────

function CustomerSearchPicker({
  selectedCustomer,
  onSelect,
  onClear,
  onCreateNew,
}: {
  selectedCustomer: CrmCustomerLite | null;
  onSelect: (customer: CrmCustomerLite) => void;
  onClear: () => void;
  onCreateNew: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CrmCustomerLite[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Only fetch while the dropdown is open. Empty query → default list (recent
    // customers, no `q`); typed query → debounced search.
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    const run = async () => {
      setLoading(true);
      try {
        const url = q.length >= 1 ? `/api/crm/customers?q=${encodeURIComponent(q)}` : '/api/crm/customers';
        const res = await fetch(url, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        setResults(Array.isArray(json?.data?.items) ? json.data.items : []);
      } catch { setResults([]); } finally { setLoading(false); }
    };
    if (q.length === 0) { run(); return; }
    debounceRef.current = setTimeout(run, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, open]);

  if (selectedCustomer) {
    const displayName = selectedCustomer.customer_type === 'business'
      ? (selectedCustomer.company_name || 'Kund')
      : `${selectedCustomer.first_name || ''} ${selectedCustomer.last_name || ''}`.trim();
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="grid gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-600">Vald kund</span>
          <span className="text-sm font-semibold text-slate-900">{displayName}</span>
          {selectedCustomer.visit_address?.city ? <span className="text-xs text-slate-500">{selectedCustomer.visit_address.city}</span> : null}
          {selectedCustomer.fortnox_customer_id ? <span className="text-[11px] font-medium text-sky-700">Synkad med Fortnox</span> : null}
        </div>
        <button type="button" onClick={onClear} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 transition-colors">
          Byt kund
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Sök eller välj kund (namn, org.nr)…"
      />
      {loading ? <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Söker…</span> : null}
      {open ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_16px_32px_rgba(15,23,42,0.10)]">
          <div className="max-h-72 overflow-y-auto">
            {results.length > 0 ? results.map((customer) => {
              const name = customer.customer_type === 'business'
                ? (customer.company_name || 'Okänt företag')
                : `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Okänd kund';
              // Shared rule — the row showed no phone at all for card-only customers.
              const contact = resolveCrmContact(customer);
              return (
                <button
                  key={customer.id}
                  type="button"
                  onMouseDown={() => { onSelect(customer); setQuery(''); setOpen(false); }}
                  className="flex w-full flex-col items-start gap-0.5 border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{name}</span>
                    {customer.fortnox_customer_id ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">Fortnox</span> : null}
                  </div>
                  <span className="text-xs text-slate-400">
                    {[customer.organization_number, customer.visit_address?.city, contact.phone].filter(Boolean).join(' · ')}
                  </span>
                </button>
              );
            }) : (
              <p className="px-4 py-3 text-sm text-slate-500">
                {loading ? 'Söker…' : query.trim()
                  ? <>Ingen kund hittades för <strong>{query}</strong></>
                  : 'Inga kunder i registret ännu'}
              </p>
            )}
          </div>
          {/* Always reachable – two customers can share a name, so "create new" must
              never hide behind a match. */}
          <button
            type="button"
            onMouseDown={onCreateNew}
            className="flex w-full items-center justify-start gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-left text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
          >
            <span className="text-base leading-none">+</span> Skapa ny kund
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ─── Field label wrapper ──────────────────────────────────────────────────────

function Field({
  label,
  children,
  className,
  error,
  fieldId,
  plain,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  error?: string | null;
  fieldId?: string;
  // `plain` wraps the label + control in a <div> instead of a <label>. Use it for composite widgets
  // (e.g. DatePicker: a button + popover) where a wrapping <label> would forward clicks to the
  // button and mis-associate. Such controls carry their own aria-label instead.
  plain?: boolean;
}) {
  const Wrapper = plain ? 'div' : 'label';
  return (
    <div className={cn('grid gap-1.5', className)} id={fieldId}>
      <Wrapper className="grid gap-1.5">
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        {children}
      </Wrapper>
      {error ? (
        <p className="text-xs font-medium text-rose-600">{error}</p>
      ) : null}
    </div>
  );
}

// Förklaringen under ett fält. slate-500, inte 400: 400 ger 2,46:1 mot kortet (se crm.sectionTitle).
const fieldHint = 'm-0 text-xs leading-snug text-slate-500';

// ─── Section card (rubrik + en rad förklaring + hårlinje) ─────────────────────

// Ett kort per sektion. Rubriken och en rad om vad sektionen är till för skiljer dem åt — inte
// numrerade cirklar (sektionerna är ingen ordningsföljd man måste gå igenom) och inte lådor i lådor.
// `internal` är det nedtonade kortet för det som aldrig når kunden: ingen skugga, en ton mörkare än
// sidans kort, och ett lås framför rubriken.
function FormSection({
  id,
  title,
  description,
  action,
  internal,
  className,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  internal?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        'min-w-0 scroll-mt-6',
        internal ? 'rounded-2xl border border-[#d8e2d4] bg-[#edf2ea]' : crm.card,
        className,
      )}
    >
      <div
        className={cn(
          'flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4 sm:px-6',
          internal ? 'border-[#dae3d6]' : 'border-[#e6ede3]',
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          {internal ? (
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-px shrink-0 text-slate-500">
              <rect x="4" y="8.5" width="12" height="8.5" rx="1.75" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6.75 8.5V6.25a3.25 3.25 0 0 1 6.5 0V8.5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          ) : null}
          <div className="min-w-0">
            <h2 id={`${id}-title`} className={cn('m-0', crm.cardTitle)}>{title}</h2>
            {description ? <p className="m-0 mt-0.5 text-[13px] text-slate-600">{description}</p> : null}
          </div>
        </div>
        {action ?? null}
      </div>
      <div className="grid gap-5 px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

// ─── Reglage (switch) ─────────────────────────────────────────────────────────

// En äkta kryssruta med role="switch" under en ritad bana: tangentbordet, klick på den omslutande
// <label> och skärmläsaren följer med gratis. Ska ligga INUTI en <label> som bär texten.
function SwitchTrack({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <span className="relative inline-flex shrink-0">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          'relative h-5 w-9 rounded-full bg-slate-300 transition-colors motion-reduce:transition-none',
          'peer-checked:bg-[color:var(--ek-accent)]',
          'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--ek-accent)]',
          "after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-[0_1px_2px_rgba(15,23,42,0.25)] after:transition-transform after:content-[''] motion-reduce:after:transition-none",
          'peer-checked:after:translate-x-4',
        )}
      />
    </span>
  );
}

// ─── Täckningsgraden som mätare ───────────────────────────────────────────────

// Skalan slutar på 60 %: där ligger offerterna, och 25/40 hamnar så att båda gränserna syns med
// luft omkring sig. TG över skalan nålas mot högerkanten, en förlust mot vänsterkanten.
const MARGIN_GAUGE_MAX = 60;

function MarginGauge({ marginPercent }: { marginPercent: number }) {
  const tier = marginTier(marginPercent);
  const at = (value: number) => `${(Math.min(Math.max(value, 0), MARGIN_GAUGE_MAX) / MARGIN_GAUGE_MAX) * 100}%`;
  const valueClass = tier === 'good' ? 'text-emerald-700' : tier === 'watch' ? 'text-amber-700' : 'text-rose-700';
  const needleClass = tier === 'good' ? 'bg-emerald-800' : tier === 'watch' ? 'bg-amber-800' : 'bg-rose-800';
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-slate-700">Täckningsgrad</span>
        <span className={cn('text-[15px] font-bold tabular-nums', valueClass)}>
          {marginPercentForDisplay(marginPercent).toFixed(1).replace('.', ',')} %
        </span>
      </div>
      {/* Siffran ovanför bär värdet för skärmläsaren — mätaren är en bild av samma sak. */}
      <div className="relative pt-1" aria-hidden="true">
        {/* Bredderna och nålens läge är uträknad geometri, därav style. */}
        <div className="flex h-2 overflow-hidden rounded-full">
          <span className="bg-rose-200" style={{ width: at(MARGIN_THRESHOLDS.watch) }} />
          <span className="bg-amber-200" style={{ width: `calc(${at(MARGIN_THRESHOLDS.good)} - ${at(MARGIN_THRESHOLDS.watch)})` }} />
          <span className="flex-1 bg-emerald-200" />
        </div>
        <span
          className={cn('absolute top-0 h-4 w-[3px] -translate-x-1/2 rounded-full ring-2 ring-[#f9fbf7]', needleClass)}
          style={{ left: at(marginPercent) }}
        />
        <div className="relative mt-1.5 h-4 text-[11px] tabular-nums text-slate-500">
          <span className="absolute -translate-x-1/2" style={{ left: at(MARGIN_THRESHOLDS.watch) }}>{MARGIN_THRESHOLDS.watch} %</span>
          <span className="absolute -translate-x-1/2" style={{ left: at(MARGIN_THRESHOLDS.good) }}>{MARGIN_THRESHOLDS.good} %</span>
        </div>
      </div>
    </div>
  );
}

// ─── SortableLineItem (drag-and-drop wrapper for the shared LineItemRow) ───────

// Sortable wrapper for a line item (drag-and-drop reordering). Owns the sortable node ref +
// transform; hands a drag-handle button (wired to the sensor listeners) to LineItemRow so the
// row only reorders when the grip is dragged, not when a field is touched.
function SortableLineItem({ id, children }: { id: string; children: (dragHandle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Dra för att ändra ordning"
      className="shrink-0 cursor-grab touch-none rounded-md p-1 text-slate-300 transition-colors hover:text-slate-500 active:cursor-grabbing"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
        <circle cx="3.5" cy="2.5" r="1" /><circle cx="8.5" cy="2.5" r="1" />
        <circle cx="3.5" cy="6" r="1" /><circle cx="8.5" cy="6" r="1" />
        <circle cx="3.5" cy="9.5" r="1" /><circle cx="8.5" cy="9.5" r="1" />
      </svg>
    </button>
  );
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 20 : undefined }} className="relative">
      {children(handle)}
    </div>
  );
}

// ─── QuoteFormClient ──────────────────────────────────────────────────────────

// How long a stashed draft survives the "create customer" round-trip before it's
// considered stale and ignored.
// How long an auto-saved draft stays recoverable — both for the customer round-trip restore and the
// "resume unsaved draft" banner. A full day so a long detour (or coming back the next morning after
// closing the tab) still restores the work rather than silently discarding it.
const DRAFT_RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
// Debounce before an edited draft is written to localStorage (a keystroke shouldn't hit storage).
const DRAFT_AUTOSAVE_DEBOUNCE_MS = 800;

export default function QuoteFormClient({ quoteId, canReassign = false }: { quoteId?: string; canReassign?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Offertformuläret nås både från offertlistan och från säljtavlan. Utan det här landade
  // säljaren i listan efter att ha sparat, alltså inte på tavlan hen kom ifrån.
  const returnToParam = safeReturnTo(searchParams.get('returnTo'));
  const backTo = returnToParam ?? '/crm/offerter';
  const toast = useToast();
  const isEditing = Boolean(quoteId);
  // Kopiera en offert: samma jobb en gång till, t.ex. räknat på ett annat material. Formuläret är
  // i SKAPA-läge (`?fran=` är ingen redigering) och fylls i från källoffertern — sparningen blir
  // därför en POST och en helt ny rad, med ett eget genererat offertnummer.
  //
  // ⚠️ Läses bara i skapa-läget. Skulle `?fran=` hänga med in i en redigeringsadress är det
  // redigeringen som gäller — annars hade en kvarglömd parameter kunnat skriva om en sparad offert
  // med en annans innehåll.
  const copyFromId = !isEditing ? (searchParams.get('fran') || '') : '';
  const isCopy = Boolean(copyFromId);
  // Vilken offert formuläret hämtar sitt innehåll ur, oavsett vad som sedan görs med det.
  const sourceQuoteId = quoteId || copyFromId;

  const [loading, setLoading] = useState(Boolean(sourceQuoteId));
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [creatingWorkOrder, setCreatingWorkOrder] = useState(false);
  // Private customer without personnummer (optional at create) → the work-order route rejects
  // with 409; we prompt for it, save it on the customer, then retry the conversion.
  const [pnPromptOpen, setPnPromptOpen] = useState(false);
  // Same shape for the ROT property: optional while quoting, required once the customer approves
  // and the offer becomes an order (the route rejects with 409). Prompt → re-save the quote →
  // retry the conversion.
  const [rotPropertyPromptOpen, setRotPropertyPromptOpen] = useState(false);
  // Custom "leave with unsaved changes?" confirm for in-app navigation (the browser's own
  // beforeunload text can't be customised, so we show our own dialog where we can). Holds the
  // intended destination so the same dialog serves the back button AND intercepted link clicks.
  const [pendingLeaveHref, setPendingLeaveHref] = useState<string | null>(null);
  // Vad som saknas innan offerten kan bli en arbetsorder. Hämtas från servern i stället för att
  // räknas ut här: adress, telefon och org.nr bor på kundkortet och finns inte i formulärets draft,
  // och en andra uppsättning regler i klienten hade förr eller senare sagt emot spärren.
  const [readiness, setReadiness] = useState<{ blockers: WorkOrderReadinessIssue[]; warnings: WorkOrderReadinessIssue[] } | null>(null);
  // Bumpas av "Kontrollera igen" och hämtar om kontrollen. En räknare i stället för en utbruten
  // funktion: effekten nedan äger hämtningen, och två vägar in i samma fetch hade kunnat lämna
  // kvar ett svar från den ena efter att den andra sagt något nytt.
  const [readinessNonce, setReadinessNonce] = useState(0);
  const [rechecking, setRechecking] = useState(false);
  const [pnValue, setPnValue] = useState('');
  // Ett värde för hela mountet: draften och den "rena" baslinjen jämförs med JSON.stringify, så
  // två olika datum hade fått ett orört formulär att se ut som osparat arbete.
  //
  // 🧨 Lazy useState och INTE useMemo. React lovar inte att behålla ett memo — kastas det körs
  // createInitialDraft igen och ger en ny rad-id, medan baslinjen och expandedRowId bär den gamla.
  // Då är formuläret "smutsigt" för alltid: spökautospar, lämna-varning vid varje navigering och en
  // återuppta-banner på ett orört formulär. useState-initialiseraren körs exakt en gång.
  const [initialDraft] = useState(createInitialDraft);
  const [draft, setDraft] = useState<QuoteDraft>(initialDraft);
  // Accordion: id of the single open article row. Starts on the empty starter row; adding
  // or manually opening a row makes it the only open one (others collapse). A stale id
  // (e.g. after loading a saved quote with different rows) simply leaves every row collapsed.
  const [expandedRowId, setExpandedRowId] = useState<string | null>(
    () => (initialDraft.items[0] && !initialDraft.items[0].article_name ? initialDraft.items[0].id : null),
  );
  // Vilken artikelrad som väntar på bekräftelse innan den tas bort. Krysset på en hopfälld rad
  // sitter tätt intill raden man klickar på för att fälla ut den, och borttagningen går inte att
  // ångra — artikeln, priset, rabatten och radnoteringen är borta ur draften direkt. Tomma rader
  // hoppar över frågan (se isBlankLineItem); där finns inget att förlora.
  const [pendingRemoveRowId, setPendingRemoveRowId] = useState<string | null>(null);
  // Kontaktpersonsformuläret. Öppnas vid "Er referens" när personen saknas på kundkortet — en ny
  // platschef eller inköpare ska inte tvinga fram en resa till kundkortet mitt i offertskrivandet.
  const [contactFormOpen, setContactFormOpen] = useState(false);

  // Sista raden tas aldrig bort helt — den ersätts med en tom, så formuläret alltid har en rad att
  // fylla i. Samma regel gällde före bekräftelsedialogen och ligger här så att båda vägarna in
  // (direkt för tomma rader, bekräftad för ifyllda) delar den.
  function removeLineItem(id: string) {
    setDraft((d) => ({
      ...d,
      items: d.items.length > 1 ? d.items.filter((item) => item.id !== id) : [createEmptyLineItem()],
    }));
    setPendingRemoveRowId(null);
  }
  const [loadedQuote, setLoadedQuote] = useState<QuoteItem | null>(null);
  // Källoffertens namn, bara för rubriken i kopieringsläget. Ett färdigfyllt formulär ser ut som en
  // redigering, och säljaren måste kunna se att det INTE är originalet hen håller på att skriva om.
  // Skilt från `loadedQuote` med flit: den betyder "offerten som redigeras" och styr
  // arbetsordersektionen, statusfältet och Fortnox-knappen — allt sådant en kopia inte har ännu.
  const [copySourceName, setCopySourceName] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CrmCustomerLite | null>(null);
  // What the customer card gave when the customer was picked. The reference the refresh-on-return
  // merge compares against to tell an untouched field from one the seller changed. Persisted with
  // the draft, because the comparison has to survive the trip to the customer card and back.
  // A ref, not state: nothing renders from it, and every reader is an async callback that must see
  // the latest value rather than the one captured when its request left.
  const appliedCustomerRef = useRef<CustomerDerivedValues | null>(null);
  // Mirror of the draft for async callbacks. A customer lookup resolves a few hundred milliseconds
  // after it starts, and the form is editable throughout — a merge that compared against the draft
  // as it was when the request left would quietly undo anything typed meanwhile.
  const draftRef = useRef<QuoteDraft>(initialDraft);
  // Whether the job is performed at a different address than the customer's. Off → the
  // order inherits the customer address; on → the work-address fields are shown and must
  // be filled. A deliberate toggle (vs silent prefill) so a wrong company address can't
  // slip through unnoticed.
  const [customWorkAddress, setCustomWorkAddress] = useState(false);
  // Separate on-site contact (slutkund) outside the customer card, mirrors the work-address toggle.
  const [customEndContact, setCustomEndContact] = useState(false);
  // Säljarkatalogen bakom ansvarig-väljaren. Hämtas även utan bytesrätt: läsvyn visar namnet,
  // och utan listan hade en vanlig säljare bara sett ett uuid.
  //
  // sellersLoaded skiljer "listan är hämtad och tom" från "svaret är på väg". Utan den läser en
  // tom lista som att offertens ansvariga inte finns i katalogen — och då blinkar "inte längre
  // säljare" förbi vid varje öppning, och blir permanent om hämtningen fallerar.
  const [sellers, setSellers] = useState<{ id: string; full_name: string | null }[]>([]);
  const [sellersLoaded, setSellersLoaded] = useState(false);

  // Drag-and-drop reordering of the article rows. Pointer for mouse (small distance so a click
  // still selects), Touch with a short press-delay so scrolling the form on mobile isn't hijacked.
  const itemSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
  );
  function handleItemsDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraft((d) => {
      const oldIndex = d.items.findIndex((i) => i.id === active.id);
      const newIndex = d.items.findIndex((i) => i.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return d;
      return { ...d, items: arrayMove(d.items, oldIndex, newIndex) };
    });
  }
  const restoredRef = useRef(false);
  // Generation counter for customer lookups. Several paths can have one in flight at once (the
  // edit-mode load, a restored draft, the returning-customer branch), and without this the LAST
  // response wins — so a stale lookup could leave the picker describing a different customer than
  // the draft holds, or resurrect a customer the seller just cleared. Every deliberate change of
  // the selected customer bumps it, which invalidates whatever is still in the air.
  const customerLookupRef = useRef(0);
  // Local draft recovery: the "clean" draft JSON captured after the form's starting state settles
  // (initial draft for a new quote, loaded quote for an edit). Anything that differs from it is
  // unsaved work → auto-saved to localStorage and guarded on unload.
  const baselineRef = useRef<string | null>(null);
  const recoveryCheckedRef = useRef(false);
  // A fresh auto-saved draft found on mount, offered via the "resume?" banner (not auto-applied,
  // so a returning user is never surprised by content they don't expect).
  const [recoverableDraft, setRecoverableDraft] = useState<QuoteDraft | null>(null);
  // JSON snapshot of the current draft — the single comparison key for dirty detection + autosave.
  const draftJson = useMemo(() => JSON.stringify(draft), [draft]);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  useEffect(() => {
    let active = true;
    fetch('/api/crm/sellers', { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (!active) return;
        setSellers(json?.ok ? json.data?.sellers || [] : []);
        setSellersLoaded(Boolean(json?.ok));
      })
      .catch(() => { if (active) setSellers([]); });
    return () => { active = false; };
  }, []);
  // Unsaved work: the draft differs from the captured clean baseline (null until it's captured).
  const isDirty = baselineRef.current !== null && draftJson !== baselineRef.current;

  const presetProspectId = searchParams.get('prospect_id') || '';

  // Per-form storage key so a new-quote draft never collides with an edit draft.
  //
  // 🧨 Kopian har en EGEN nyckel per källoffert, den delar inte `:new`. Gjorde den det kunde ett
  // orelaterat, osparat nytt utkast ligga kvar i lådan och erbjudas av återuppta-bannern ovanpå en
  // nyss öppnad kopia — alltså fel kunds offert över den man just bad om.
  const draftStorageKey = quoteId
    ? `crm:quote-draft:edit:${quoteId}`
    : (copyFromId ? `crm:quote-draft:copy:${copyFromId}` : 'crm:quote-draft:new');
  // This offer's own URL — used as returnTo when leaving to create/edit a customer.
  // Kundkortsresan kommer tillbaka hit, så returnTo måste följa med i adressen — annars är det
  // borta när säljaren väl sparar, och tavlan tappas efter en sväng förbi kunden.
  //
  // ⚠️ `?fran=` MÅSTE följa med för en kopia. Utan den kommer resan tillbaka till ett tomt
  // `/crm/offerter/ny`, där både källan och — eftersom nyckeln hänger på `fran` — stashen med
  // säljarens ändringar är oåtkomliga.
  const offerSelfPath = isEditing
    ? `/crm/offerter/${quoteId}/redigera`
    : (copyFromId ? `/crm/offerter/ny?fran=${encodeURIComponent(copyFromId)}` : '/crm/offerter/ny');
  const offerSelfUrl = returnToParam ? withReturnTo(offerSelfPath, returnToParam) : offerSelfPath;

  // Stash the draft and leave to a customer page; we return via returnTo.
  function goToCustomerPage(path: string) {
    persistDraft();
    router.push(`${path}?returnTo=${encodeURIComponent(offerSelfUrl)}`);
  }

  function persistDraft() {
    try {
      // appliedCustomer rides along so a return from the customer card can tell which fields the
      // seller has changed since. Absent in stashes written before this existed — readers treat a
      // missing snapshot as "don't merge" rather than guessing.
      localStorage.setItem(draftStorageKey, JSON.stringify({
        version: 1, savedAt: Date.now(), quoteId: quoteId ?? null, draft, appliedCustomer: appliedCustomerRef.current,
      }));
    } catch { /* localStorage unavailable — ignore */ }
  }

  function clearPersistedDraft() {
    try { localStorage.removeItem(draftStorageKey); } catch { /* ignore */ }
  }

  // Load a stashed draft back into the form, re-deriving the two UI toggles that aren't part of the
  // draft object. Shared by the customer round-trip restore and the "resume draft?" banner.
  //
  // The customer object is NOT part of the draft (only its id is), so it has to be re-fetched — see
  // fetchCustomerLite. Without it a resumed draft looks like no customer was ever picked: no chip,
  // no contact dropdown, no reverse-VAT hint. Deliberately fire-and-forget: the draft is already
  // applied synchronously above, and a failed lookup only costs the chip.
  function applyRestoredDraft(restored: QuoteDraft, opts?: { skipCustomerLookup?: boolean }) {
    // Backfill any fields absent from an older-shaped stash (e.g. saved before `labor_cost` existed)
    // from the initial draft / an empty line item, so every field/Input stays controlled.
    const items = (restored.items ?? []).map((line) => ({ ...createEmptyLineItem(), ...line }));
    setDraft({
      ...initialDraft,
      ...restored,
      items: items.length ? items : [createEmptyLineItem()],
      // En stash sparad före ansvarig-fältet saknar det, och initialDraft bidrar med tom
      // sträng — i redigeringsläget finns inget tomt alternativ, så rullgardinen hade fallit
      // till det första namnet i listan och visat fel ansvarig på en offert man inte rört.
      assigned_to: restored.assigned_to || loadedQuote?.assigned_to || '',
    });
    // Måttblocket i den återställda texten är redan insatt — annars lägger automatiken en dubblett.
    adoptExistingMeasurementBlock(items, restored.handoff_notes ?? '');
    setCustomWorkAddress(Boolean(restored.delivery_address));
    setCustomEndContact(Boolean(
      restored.end_contact_name || restored.end_contact_phone || restored.end_contact_email,
    ));
    // The round-trip caller fetches the same customer a moment later to run the merge; skip the
    // duplicate request rather than firing two lookups for one id on every trip.
    if (restored.customer_id && !opts?.skipCustomerLookup) hydrateSelectedCustomer(restored.customer_id);
  }

  /**
   * Look up a customer for the picker only — never touches the draft. Guarded so a slow response
   * can't overwrite a newer selection; see customerLookupRef.
   *
   * `seedApplied` records the card's values as the merge reference. Used when the draft did NOT come
   * from an in-session pick (edit mode), where there is no record of what the card once gave. Taking
   * the card's CURRENT values as the reference means: a field that still matches the card counts as
   * untouched and will refresh, a field that differs is treated as the seller's and is preserved.
   * That errs toward keeping what is on the quote, which is the safe direction.
   */
  function hydrateSelectedCustomer(customerId: string, opts?: { seedApplied?: boolean }) {
    const generation = ++customerLookupRef.current;
    void fetchCustomerLite(customerId).then((customer) => {
      if (!customer || customerLookupRef.current !== generation) return;
      setSelectedCustomer(customer);
      // Only when nothing better exists: a reference restored from the stash records what the
      // card gave when the customer was PICKED, which is the accurate baseline. This one is a
      // present-day approximation and must never overwrite it.
      if (opts?.seedApplied && !appliedCustomerRef.current) appliedCustomerRef.current = customerDraftFields(customer);
    });
  }

  // What the customer card yields for the draft's customer-derived fields. Extracted so the initial
  // pick and the refresh-on-return compute IDENTICAL values — the merge compares against these, so
  // any drift between the two would read as "the seller edited this" and quietly stop refreshing.
  function customerDraftFields(customer: CrmCustomerLite): CustomerDerivedValues {
    // Primary contact first, then the customer card's own e-mail/phone — a customer with no
    // contact rows (the common case) would otherwise leave both fields empty.
    const contact = resolveCrmContact(customer);
    // Smart default: if the card already carries a delivery address that differs from the
    // visit address, turn the toggle on and prefill it. Otherwise off (= same as customer).
    const del = customer.delivery_address;
    const vis = customer.visit_address;
    const deliveryDiffers = Boolean(
      del && (
        (del.street || '') !== (vis?.street || '') ||
        (del.postal_code || '') !== (vis?.postal_code || '') ||
        (del.city || '') !== (vis?.city || '')
      ),
    );
    return {
      quote_type: customer.customer_type,
      // Reverse charge (omvänd skattskyldighet) → 0 % moms; otherwise the standard 25 %.
      // Follows the customer's setting (kept in sync with Fortnox VATType); still editable.
      vat_percent: customer.reverse_vat ? '0' : '25',
      company_name: customer.company_name || '',
      customer_name: customer.company_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
      organization_number: customer.organization_number || '',
      personal_number: customer.personal_number || '',
      contact_name: contact.name,
      phone: contact.phone,
      email: contact.email,
      street_address: customer.visit_address?.street || '',
      postal_code: customer.visit_address?.postal_code || '',
      city: customer.visit_address?.city || '',
      // Only carry a work address when the card has a distinct one; otherwise leave the
      // fields empty so an enabled toggle visibly demands input (never a silent default).
      delivery_address: deliveryDiffers ? del?.street || '' : '',
      delivery_postal_code: deliveryDiffers ? del?.postal_code || '' : '',
      delivery_city: deliveryDiffers ? del?.city || '' : '',
    };
  }

  function applySelectedCustomer(customer: CrmCustomerLite) {
    customerLookupRef.current += 1; // a deliberate pick outranks any lookup still in flight
    setSelectedCustomer(customer);
    const fields = customerDraftFields(customer);
    // Remember what the card gave, so a later return can tell "still the card's value" from
    // "the seller changed this". Persisted with the draft — see persistDraft.
    appliedCustomerRef.current = fields;
    // All three fields, not just the street — see refreshFromCustomerCard for why.
    setCustomWorkAddress(Boolean(fields.delivery_address || fields.delivery_postal_code || fields.delivery_city));
    setDraft((current) => ({
      ...current,
      ...fields,
      // The merge machinery compares plain strings; re-narrow the one field that is a union.
      // Written as a check rather than a cast so an unexpected value can't slip through as a type.
      quote_type: fields.quote_type === 'private' ? 'private' : 'business',
      customer_id: customer.id,
      customer_source: buildCustomerSource(customer),
    }));
  }

  /**
   * Returning from the customer card with the SAME customer: pull in what was changed there without
   * touching what the seller has typed here.
   *
   * ⚠️ Merged against the LIVE draft (draftRef), not against a snapshot taken before the lookup. The
   * form is interactive the whole time the request is in flight — comparing against a stale copy
   * would silently revert anything typed in those few hundred milliseconds.
   */
  function refreshFromCustomerCard(customer: CrmCustomerLite) {
    customerLookupRef.current += 1;
    setSelectedCustomer(customer);
    // No reference for what the card originally gave (a stash written before this existed) — leave
    // the draft alone. Overwriting on a guess is the failure mode that destroys the seller's work.
    const applied = appliedCustomerRef.current;
    if (!applied) return;
    const fromCard = customerDraftFields(customer);
    const merged = mergeUntouchedCustomerFields(pickCustomerDerived(draftRef.current), applied, fromCard);
    appliedCustomerRef.current = fromCard;
    // Keyed on ALL three work-address fields, not just the street: a card whose delivery address
    // differs only in postal code/city would otherwise leave the toggle off, hiding fields that do
    // hold values — and buildCustomerSnapshot, which anchors on the street, would then drop them.
    setCustomWorkAddress(Boolean(merged.delivery_address || merged.delivery_postal_code || merged.delivery_city));
    setDraft((current) => ({
      ...current,
      ...merged,
      quote_type: merged.quote_type === 'private' ? 'private' : 'business',
      // Identity metadata always follows the card — the seller never edits these.
      customer_id: customer.id,
      customer_source: buildCustomerSource(customer),
    }));
  }

  /**
   * En nyss tillagd kontaktperson blir offertens "Er referens".
   *
   * ⚠️ Till skillnad från offertpanelen, som aldrig rör offerten: HÄR är det enda skälet man lägger
   * till personen — man står i fältet och saknar hen. Draften är dessutom osparad och sparas
   * medvetet av säljaren efteråt, så ingenting skrivs om på ett dokument kunden redan fått.
   *
   * ⚠️ Fält för fält genom `resolveCrmContact`, aldrig råa `contact.phone`/`contact.email`: en
   * kontaktrad utan telefon ska ärva kortets, inte tömma fältet. Privatkundens automatiska rad bär
   * bara namnet, och råa värden hade raderat numret. Samma regel som kontaktväljarens onChange.
   */
  function applyNewContact(contact: CrmContactItem) {
    const resolved = selectedCustomer
      ? resolveCrmContact(selectedCustomer, contact)
      : { name: contact.name, phone: contact.phone || '', email: contact.email || '' };
    setDraft((d) => ({ ...d, contact_name: resolved.name, phone: resolved.phone, email: resolved.email }));
    // Hämta om kunden så rullgardinen får den nya raden — och så en primär-degradering syns.
    //
    // 🧨 `hydrateSelectedCustomer` och INTE `applySelectedCustomer`: den senare förifyller HELA
    // kundblocket ur kortet (namn, org.nr, adress, moms) och hade ätit det säljaren skrivit.
    if (selectedCustomer) hydrateSelectedCustomer(selectedCustomer.id);
  }

  // Ladda källoffertern: den som redigeras, eller den som kopieras.
  //
  // EN effekt för båda, för de gör samma sak ända fram till mappningen — hämta raden, fylla
  // formuläret, sätta baslinjen, väcka kundchippet. Skillnaden ligger i draftFromQuote vs
  // copyDraftFromQuote, och i att en kopia aldrig blir `loadedQuote` (det är REDIGERINGENS offert,
  // och den styr arbetsordersektionen, Fortnox-knappen och statusfältet).
  useEffect(() => {
    if (!sourceQuoteId) return;
    let active = true;
    setLoading(true);

    fetch(`/api/crm/quotes/${sourceQuoteId}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (!active) return;
        const item = json?.data?.item as QuoteItem | undefined;
        if (!item) {
          toast.error(isCopy ? 'Kunde inte ladda offerten som skulle kopieras' : 'Kunde inte ladda offert');
          router.push(backTo);
          return;
        }
        // Locked: once a work order exists the offer is converted (and locked in Fortnox);
        // editing it would diverge the CRM quote from the created order. Bounce back — this
        // closes the direct-URL hole the detail card's hidden "Redigera" button left open.
        //
        // ⚠️ Spärren gäller REDIGERING, inte kopiering. En låst offert är ofta just den man vill
        // räkna om på ett annat material, och kopian rör inte originalet med en byte — den blir en
        // ny rad med eget offertnummer, utan Fortnox-koppling och utan arbetsorder.
        if (!isCopy && (item.work_order_id || item.work_order_number)) {
          toast.info('Offerten är låst – en arbetsorder har skapats, så den kan inte längre redigeras.');
          // Tillbaka till YTAN, utan `?quote_id=` — alltså inte in i panelen igen.
          //
          // Panelens låsning är lösare än formulärets: den släpper fram "Redigera" när sista
          // Fortnox-synken misslyckats (så återsynken går att nå), medan formuläret nekar så
          // fort det finns en arbetsorder. För en sådan offert hade återgången till panelen
          // blivit en klickrunda utan utgång — den gamla listomdirigeringen bröt den av misstag.
          router.replace(backTo.split('?')[0]);
          return;
        }
        if (isCopy) setCopySourceName(item.project_name);
        else setLoadedQuote(item);
        const loadedDraft = isCopy ? copyDraftFromQuote(item) : draftFromQuote(item);
        // Måttblocket sätts in HÄR, före baslinjen — inte av automatik-effekten efteråt.
        //
        // Gör man tvärtom blir en nyss laddad offert omedelbart "ändrad", och det river sönder
        // utkastskyddet: återuppta-bannern stängs av dirty-vakten (den tolkar ändringen som att
        // säljaren börjat skriva) innan man hunnit klicka, och autosparet skriver sedan över
        // stashen. Osparat arbete på just den offerten går förlorat. Att bara flytta in blocket
        // i baslinjen gör öppnandet neutralt igen.
        const seededDraft = seedMeasurementBlock(loadedDraft);
        setDraft(seededDraft);
        adoptExistingMeasurementBlock(seededDraft.items, seededDraft.handoff_notes);
        // The loaded quote IS the clean baseline for an edit — unsaved-change detection compares
        // against it, so editing an untouched loaded offer isn't flagged dirty. Detsamma för en
        // kopia: den är "orörd" tills säljaren ändrar något i den.
        baselineRef.current = JSON.stringify(seededDraft);
        setCustomWorkAddress(Boolean(item.customer_snapshot?.delivery_address));
        setCustomEndContact(Boolean(
          item.customer_snapshot?.end_contact_name || item.customer_snapshot?.end_contact_phone || item.customer_snapshot?.end_contact_email,
        ));

        // Show the linked customer in the picker so editing doesn't look like no
        // customer is selected. Fetch the live row (silently ignored if it 404s).
        // seedApplied: an existing quote's draft came from the database, not from an in-session
        // pick, so there is no record of what the card once gave. Without a reference the merge
        // refuses to run — and editing an existing quote is the flow where "pop into the customer,
        // turn on omvänd skattskyldighet, come back" happens most.
        //
        // ⚠️ Rör ALDRIG draften (hydrate, inte apply): kopian ska bära kundens uppgifter som
        // ORIGINALET hade dem, inte kortets nuvarande. Se copyDraftFromQuote.
        if (item.customer_id) hydrateSelectedCustomer(item.customer_id, { seedApplied: true });
      })
      .catch(() => { if (active) { toast.error('Kunde inte ladda offert'); router.push(backTo); } })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceQuoteId]);

  // Apply URL presets (create mode only). En kopia hämtar hela sitt innehåll ur källoffertern,
  // prospektkopplingen inräknad — ett preset här hade bara hunnit skrivas över.
  useEffect(() => {
    if (isEditing || isCopy || !presetProspectId) return;
    const presetDraft: QuoteDraft = {
      ...initialDraft,
      prospect_id: presetProspectId,
      customer_source: getDefaultDraftCustomerSource(presetProspectId),
    };
    setDraft(presetDraft);
    // Fold the preset into the clean baseline so a prospect-sourced form isn't mis-flagged as
    // unsaved work (which would trigger phantom autosave / leave-modal / resume-banner).
    baselineRef.current = JSON.stringify(presetDraft);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Returning from "create new customer": restore the stashed draft and auto-select
  // the newly created customer. Runs once, after any edit-mode load has finished.
  useEffect(() => {
    if (loading || restoredRef.current) return;
    restoredRef.current = true;

    const createdCustomerId = searchParams.get('created_customer_id');
    const restoreQuote = searchParams.get('restore_quote');
    if (!createdCustomerId && !restoreQuote) return;

    // Restore the draft we stashed before navigating away.
    //
    // ⚠️ Edit mode restores too. It used to be skipped ("the loaded quote stays"), but the stash is
    // keyed per quote (crm:quote-draft:edit:<id>) and holds the seller's UNSAVED edits to exactly
    // this quote — dropping it meant a trip to the customer card silently threw away everything
    // typed since the last save. The stash is cleared below either way, so skipping the restore
    // only ever lost work.
    let restoredDraft: QuoteDraft | null = null;
    let restoredApplied: CustomerDerivedValues | null = null;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (raw) {
        const envelope = JSON.parse(raw);
        const fresh = envelope && typeof envelope.savedAt === 'number'
          && Date.now() - envelope.savedAt < DRAFT_RECOVERY_TTL_MS && envelope.draft;
        if (fresh) {
          // Route through applyRestoredDraft so an older-shaped stash gets the same per-item/field
          // backfill as the resume banner (keeps every Input controlled).
          restoredDraft = envelope.draft as QuoteDraft;
          restoredApplied = (envelope.appliedCustomer as CustomerDerivedValues | null) ?? null;
          // The branch below fetches this same customer to run the merge — don't fetch it twice.
          applyRestoredDraft(restoredDraft, { skipCustomerLookup: Boolean(createdCustomerId) });
          if (restoredApplied) appliedCustomerRef.current = restoredApplied;
        }
      }
    } catch { /* ignore malformed draft */ }
    clearPersistedDraft();

    // Coming back from a customer card, `created_customer_id` is appended even when nothing was
    // created — CustomerDetailClient reuses the param for plain returns. Two different situations
    // hide behind the same parameter:
    //
    //   • a DIFFERENT customer (the create-new-customer flow) → prefill everything, as before
    //   • the SAME customer (the seller went to fix something) → merge: take what changed on the
    //     card, keep what the seller has typed here
    //
    // The merge is what makes "pop into the customer and turn on omvänd skattskyldighet" work. It
    // used to prefill unconditionally, which wiped the seller's Er referens; then it stopped
    // prefilling entirely, which left vat_percent at 25 % while the card said reverse charge — and
    // the yellow notice reads the card, so the screen claimed 0 % while the quote saved 25 %.
    if (createdCustomerId) {
      // Generation-guarded like every other lookup: the seller can clear the picker or choose someone
      // else while this is in flight, and a late response must not resurrect what they just replaced.
      const generation = ++customerLookupRef.current;
      fetchCustomerLite(createdCustomerId).then((customer) => {
        if (!customer) { toast.error('Kunde inte hämta vald kund'); return; }
        if (customerLookupRef.current !== generation) return; // superseded by a deliberate change
        // Decided against the LIVE draft, so it holds in edit mode too — there the customer comes
        // from the loaded quote rather than from a restored stash.
        if (draftRef.current.customer_id === customer.id) refreshFromCustomerCard(customer);
        else applySelectedCustomer(customer);
      });
    }

    // Strip the param so a refresh doesn't re-run this.
    router.replace(offerSelfUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Fallback baseline for a plain new quote (no URL preset, no round-trip). The preset effect and
  // edit-load capture their own baselines first (guarded by the null check); this runs before the
  // round-trip restore applies, so a restored draft is correctly seen as unsaved work to protect.
  useEffect(() => {
    // `sourceQuoteId`, inte bara `isEditing`: en kopia får sin baslinje av laddningen nedan, och
    // en baslinje satt på det tomma startformuläret hade gjort den färdigfyllda kopian "ändrad"
    // i samma ögonblick den visades — alltså autospar och lämna-varning på ett orört formulär.
    if (baselineRef.current !== null || sourceQuoteId) return;
    baselineRef.current = JSON.stringify(initialDraft);
  }, [sourceQuoteId]);

  // On mount, detect a fresh auto-saved draft and offer to resume it (unless we're in the customer
  // round-trip, which owns the stash). Never auto-applies — the banner lets the user choose.
  useEffect(() => {
    if (recoveryCheckedRef.current || loading || baselineRef.current === null) return;
    if (searchParams.get('created_customer_id') || searchParams.get('restore_quote')) return;
    recoveryCheckedRef.current = true;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const envelope = JSON.parse(raw);
      const fresh = envelope && typeof envelope.savedAt === 'number'
        && Date.now() - envelope.savedAt < DRAFT_RECOVERY_TTL_MS && envelope.draft;
      // Only offer it when it actually differs from the clean baseline — otherwise there's nothing
      // to recover and a stale/no-op stash is just cleared.
      if (!fresh || JSON.stringify(envelope.draft) === baselineRef.current) { clearPersistedDraft(); return; }
      // Carry the merge reference over with the draft. Resuming without it left the customer-card
      // refresh with nothing to compare against, so a later trip to the card couldn't tell an
      // untouched field from an edited one and refused to update either.
      appliedCustomerRef.current = (envelope.appliedCustomer as CustomerDerivedValues | null) ?? null;
      setRecoverableDraft(envelope.draft as QuoteDraft);
    } catch { clearPersistedDraft(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Starting to type while the resume banner is open means "start fresh" → dismiss it so the guards
  // (autosave / leave-guard / interceptor, all paused while it's open) re-engage and protect the new
  // work instead of silently discarding it.
  useEffect(() => {
    if (recoverableDraft && isDirty) setRecoverableDraft(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJson, recoverableDraft]);

  // Auto-save the draft to localStorage while it differs from the clean baseline (debounced). Paused
  // while the resume banner is open so we never overwrite the very stash the user is deciding on.
  useEffect(() => {
    if (loading || submitting || recoverableDraft || !isDirty) return;
    const timer = setTimeout(persistDraft, DRAFT_AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJson, loading, submitting, recoverableDraft]);

  // Browser "leave site?" guard on unsaved work. Also flushes the latest draft to storage first, so
  // closing the tab mid-debounce still preserves everything (the resume banner catches it next time).
  useEffect(() => {
    if (!isDirty || submitting || recoverableDraft) return;
    const handler = (e: BeforeUnloadEvent) => {
      persistDraft();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJson, submitting, recoverableDraft]);

  // Intercept in-app link navigation (sidebar/header/any <Link>) while there are unsaved changes.
  // The App Router has no built-in navigation guard, so we catch the anchor click in the capture
  // phase — before Next's Link handler runs — cancel it, and route the intent through our confirm
  // dialog instead. Programmatic navigations (e.g. the customer round-trip) aren't anchor clicks and
  // are intentional, so they pass through untouched. The browser back/forward buttons (popstate)
  // can't be intercepted cleanly here; autosave + the resume banner cover that case.
  useEffect(() => {
    if (!isDirty || submitting || recoverableDraft || pendingLeaveHref) return;
    function onClick(e: MouseEvent) {
      // Let modified / non-primary clicks (new tab, middle-click) and already-handled events be.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.('a');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const rawHref = anchor.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#')) return;
      let url: URL;
      try { url = new URL(anchor.href, window.location.href); } catch { return; }
      // Cross-origin leaves the app entirely → beforeunload handles it. Same-path (or hash-only) is
      // not really leaving the form → ignore.
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingLeaveHref(url.pathname + url.search);
    }
    document.addEventListener('click', onClick, true); // capture phase → runs before Next's Link
    return () => document.removeEventListener('click', onClick, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJson, submitting, recoverableDraft, pendingLeaveHref]);

  const effectiveRows = useMemo<EffectiveRow[]>(() => {
    return draft.items.map((item) => {
      // ⚠️ SAMMA priskälla som varje annan yta: skrivet A-pris, annars artikelpriset, annars 0.
      // Formuläret hade tidigare en egen `computeUnitPrice()` som gav artikellösa rader 900 kr/m³
      // medan Fortnox, arbetsordern och planeringen räknade dem som 0 — priset säljaren såg nådde
      // aldrig kundens dokument. Räkna ALDRIG fram ett pris här igen; en rad utan prisförankring
      // spärras i stället vid sparning (isUnpricedLineItem).
      const baseUnit = lineItemUnitPrice(item);
      const mode = item.pricing_mode === 'item' ? 'item' : 'm3';
      const amount = lineItemQuantity(item);
      const discount = Math.min(100, Math.max(0, parseDecimal(item.discount_percent)));
      const effectiveUnit = Math.max(0, baseUnit * (1 - discount / 100));
      const baseLabel = item.article_name ? `${item.article_name}${item.article_number ? ` (${item.article_number})` : ''}` : `${constructionLabel(item.construction) || 'Okänd'}${item.thickness_mm ? ` ${item.thickness_mm} mm` : ''}`;
      const unitSuffix = mode === 'm3' ? ' (m³)' : item.article_unit_name ? ` (${item.article_unit_name})` : '';
      const laborSplit = splitRowLabor({
        laborCostPerUnit: item.labor_cost, unitPrice: baseUnit, discountPercent: discount, quantity: amount,
      });
      return {
        ...item, amount, unit: baseUnit, effectiveUnit,
        label: `${baseLabel}${unitSuffix}`,
        mode, rowTotal: amount * effectiveUnit,
        rotLabor: laborSplit.labor,
        rotLaborLeavesNoMaterial: laborSplit.leavesNoMaterial,
        // Delad definition med Fortnox-pushens spärr (assertLineItemsArePriced). Skulle de två
        // säga olika om vad som är en debiterbar rad kan formuläret godkänna en offert som pushen
        // sedan avvisar med 409 — utan att peka ut vilken rad det gäller.
        isConfigured: isConfiguredLineItem(item),
      };
    });
  }, [draft.items]);

  const totals = useMemo(() => {
    const subtotal = Math.max(0, effectiveRows.reduce((sum, item) => sum + item.rowTotal, 0));
    const vatPercent = parseDecimal(draft.vat_percent);
    const vat = Math.max(0, subtotal * (vatPercent / 100));
    const total = subtotal + vat;

    // ROT deduction (private only): the tax-reduction % of the husarbete rows' amount
    // INCL VAT, capped at the max deduction. Floored to whole krona to match Fortnox /
    // Skatteverket (ROT reductions drop the öre), e.g. 393,75 → 393. Flooring is also
    // the safe direction for the business: the deduction is never overstated.
    // The ROT base is labour: a row flagged fully as ROT work contributes its whole total, an
    // unflagged material row only its carved-out labour (labor_cost per enhet × antal). Mirrors
    // lib/domains/crm/pricing.ts and the Fortnox push (flagged rows + the "Arbetskostnad ROT" row).
    const rotActive = draft.quote_type === 'private' && draft.rot_enabled;
    const rotLaborBase = rotActive
      ? effectiveRows.reduce((sum, r) => {
          const base = r.is_rot_work ? r.rowTotal : Math.min(r.rotLabor, r.rowTotal);
          return sum + base;
        }, 0)
      : 0;
    const rotBaseInclVat = rotLaborBase * (1 + vatPercent / 100);
    const rotPercent = parseDecimal(draft.rot_percent, 30);
    const maxDeduction = parseDecimal(draft.rot_max_deduction, 50000);
    const rotDeduction = rotActive
      ? Math.min(maxDeduction, Math.floor(rotBaseInclVat * (rotPercent / 100)))
      : 0;

    // Carved-out labour only (excludes fully-flagged ROT rows) — surfaced in the ROT section so the
    // seller sees what becomes the separate "Arbetskostnad ROT" row.
    const carvedLabor = rotActive
      ? effectiveRows.reduce((sum, r) => (r.is_rot_work ? sum : sum + Math.min(r.rotLabor, r.rowTotal)), 0)
      : 0;

    return { subtotal, vat, total, rotDeduction, toPay: total - rotDeduction, carvedLabor };
  }, [draft.vat_percent, draft.quote_type, draft.rot_enabled, draft.rot_percent, draft.rot_max_deduction, effectiveRows]);

  // ── Måttblocket i arbetsbeskrivningen ──────────────────────────────────────────────────
  //
  // Blocket (materialrubrik → rader → totalt antal säckar) fylls i AUTOMATISKT så snart en
  // artikelrad har både yta och tjocklek, och hålls i takt när måtten ändras. Tidigare satt
  // det bakom knappen "Hämta mått från rader" — och den missades. Missen upptäcks först i
  // fält, för när offerten väl konverterats till arbetsorder är den låst för redigering
  // (se laddningen ovan) och arbetsordern har ingen motsvarande knapp: enda vägen tillbaka
  // var att skriva måtten för hand.
  //
  // Blocket ligger överst, säljarens egen text står kvar under det.
  const lastMeasurementBlockRef = useRef('');
  // Sant när säljaren har redigerat blocket själv. Då slutar automatiken röra texten — att
  // skriva över en handgjord rättelse vore värre än att missa en uppdatering. STATE, inte ref:
  // läget måste synas i UI:t, annars fryser blocket tyst på gamla mått och den felaktiga
  // uppgiften följer med till arbetsordern — precis det den här funktionen finns för att stoppa.
  const [measurementBlockLocked, setMeasurementBlockLocked] = useState(false);

  // Sätt in blocket i en färdig draft (utan att gå via state). Används vid laddning, så blocket
  // ingår i baslinjen och offerten inte ser ändrad ut direkt när den öppnas.
  function seedMeasurementBlock(d: QuoteDraft): QuoteDraft {
    const block = buildMeasurementLines(d.items).join('\n');
    if (!block || hasMeasurementBlock(d.handoff_notes)) return d;
    const next = replaceMeasurementBlock(d.handoff_notes, '', block);
    return next === null || next === d.handoff_notes ? d : { ...d, handoff_notes: next };
  }

  // En laddad eller återställd arbetsbeskrivning bär redan ett block. Utan den här
  // synkroniseringen ser automatiken den som "inget block insatt" och lägger en dubblett
  // ovanpå. Tre vägar in hit: redigeringsläget, utkast-återställningen och kundkortsresan.
  function adoptExistingMeasurementBlock(items: QuoteLineItem[], handoffNotes: string) {
    const block = buildMeasurementLines(items).join('\n');
    if (block && handoffNotes.startsWith(block)) {
      lastMeasurementBlockRef.current = block;
      setMeasurementBlockLocked(false);
      return;
    }
    lastMeasurementBlockRef.current = '';
    // Texten bär måttrader vi inte känner igen → säljaren har redigerat dem. Håll händerna borta.
    setMeasurementBlockLocked(hasMeasurementBlock(handoffNotes));
  }

  // Håll blocket i takt med raderna. Kör på varje ändring i artikelraderna; `block === prev`
  // kortsluter de allra flesta anropen, och blocket beräknas ur en ren funktion.
  //
  // Pausad medan offerten laddas och medan återuppta-bannern är öppen: en skrivning där skulle
  // göra draften "ändrad", vilket stänger bannern åt säljaren och låter autosparet skriva över
  // stashen den handlar om. Samma paus som autosparet och lämna-vakten redan har.
  useEffect(() => {
    if (loading || recoverableDraft || measurementBlockLocked) return;
    const block = buildMeasurementLines(draft.items).join('\n');
    const prev = lastMeasurementBlockRef.current;
    if (block === prev) return;

    // Första insättningen på en text som redan bär mått: säljaren har skrivit dem för hand
    // (eller klistrat in dem). Lägg inte ett block ovanpå — då står måtten två gånger och
    // notisen påstår dessutom att blocket hålls uppdaterat. Lämna över på samma sätt som
    // adoptExistingMeasurementBlock gör vid laddning.
    if (!prev && hasMeasurementBlock(draft.handoff_notes)) {
      setMeasurementBlockLocked(true);
      return;
    }

    const next = replaceMeasurementBlock(draft.handoff_notes, prev, block);
    if (next === null) {
      // Säljaren har redigerat blocket sedan vi la dit det — lämna över ägarskapet.
      setMeasurementBlockLocked(true);
      return;
    }
    lastMeasurementBlockRef.current = block;
    if (next !== draft.handoff_notes) setDraft((d) => ({ ...d, handoff_notes: next }));
  }, [draft.items, draft.handoff_notes, loading, recoverableDraft, measurementBlockLocked]);

  // Uttryckligt klick: skriver även när säljaren tagit över texten, och tar tillbaka
  // ägarskapet så automatiken följer med igen.
  function addMeasurementsToHandoff() {
    const block = buildMeasurementLines(draft.items).join('\n');
    if (!block) { toast.error('Inget att hämta — fyll i mått på en m³-rad, eller kryssa i ”I arbetsbeskrivningen” på en antalsrad'); return; }
    const next = replaceMeasurementBlock(draft.handoff_notes, lastMeasurementBlockRef.current, block, { force: true });
    if (next === null) return;
    lastMeasurementBlockRef.current = block;
    setMeasurementBlockLocked(false);
    setDraft((d) => ({ ...d, handoff_notes: next }));
  }

  const issues = useMemo(() => getValidationIssues(draft, effectiveRows), [draft, effectiveRows]);
  const isReady = issues.length === 0;

  const fieldErrors = useMemo(() => {
    if (!submitAttempted) return {} as Record<string, string>;
    const effectiveCustomerName = getEffectiveCustomerName(draft);
    const errs: Record<string, string> = {};
    if (!draft.project_name.trim()) errs.project_name = 'Offertnamn saknas';
    if (!draft.prospect_id && !draft.customer_id && !effectiveCustomerName) {
      errs.company_name = 'Kund måste anges';
      errs.customer_name = 'Kund måste anges';
    }
    if (draft.quote_type === 'business' && !draft.company_name.trim() && !draft.customer_name.trim()) {
      errs.company_name = 'Företagsnamn krävs';
    }
    if (!draft.contact_name.trim()) errs.contact_name = 'Er referens krävs';
    // Personnummer och fastighetsbeteckning krävs båda vid orderskapandet, inte på offerten —
    // inga fältfel här.
    return errs;
  }, [submitAttempted, draft, effectiveRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Map validation issues to field IDs for scroll-to
  const issueFieldIds: Record<string, string> = {
    'Kund måste anges': 'section-kund',
    'Företagsnamn krävs': 'section-kund',
    'Personnummer krävs för ROT': 'section-kund',
    'Er referens krävs': 'field-contact-name',
    'Offertnamn saknas': 'field-project-name',
    'Lägg till minst en rad': 'section-rader',
    'Ofullständiga rader — mängd och pris krävs': 'section-rader',
    'Prospektkälla kräver valt prospekt': 'section-kund',
    'Fortnox-kund behöver kundreferens': 'section-kund',
    // ROT-reglaget visas bara för privatkund, så det är kundtypen man ska till.
    'ROT är bara tillåtet för privatkund': 'section-kund',
  };

  // Pris- och ROT-spärren namnger raderna i texten ("Rad 2: …", "Rader 1, 3: …") och kan inte nycklas
  // ovan — texten är olika varje gång. De går till radkortet, så varje punkt i checklistan leder någonstans.
  function issueTargetId(issue: string): string | null {
    return issueFieldIds[issue] ?? (/^Rad(er)? \d/.test(issue) ? 'section-rader' : null);
  }

  function scrollToField(fieldId: string) {
    document.getElementById(fieldId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function handleBack() {
    // Going back is a possible accident too. With unsaved work, show our own informative confirm
    // (the native beforeunload text isn't customisable); with nothing to keep, just leave.
    if (isDirty) { setPendingLeaveHref(backTo); return; }
    clearPersistedDraft();
    router.push(backTo);
  }

  // Confirmed leaving with unsaved changes: flush the draft so it's recoverable, then navigate to
  // whatever destination triggered the dialog (back button or an intercepted link).
  function confirmLeave() {
    const href = pendingLeaveHref ?? backTo;
    persistDraft();
    setPendingLeaveHref(null);
    router.push(href);
  }

  async function createFollowUpTask(quote: QuoteItem) {
    if (!draft.follow_up_date || !draft.create_follow_up_task) return true;
    const res = await fetch('/api/crm/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildFollowUpTaskPayload(quote, draft.follow_up_date, quoteLabel(quote))),
    });
    const json = await res.json().catch(() => ({}));
    return res.ok && json.ok;
  }

  // The quote save payload, built from the current draft. Extracted so the ROT-property prompt can
  // re-save the quote through the exact same shape the ordinary save uses — a partial PATCH won't
  // do: the update schema requires the core fields, and only a body carrying `line_items` triggers
  // the Fortnox auto-sync, which is what gets the fastighetsbeteckning onto the offer before it is
  // converted to an order.
  function buildQuotePayload() {
    const effectiveCustomerName = getEffectiveCustomerName(draft);

    // The offer's amount/summary always derive from the article rows — there is no manual amount
    // field, and validation requires at least one row.
    const amountNumber = totals.total;
    const vatPercentNumber = parseDecimal(draft.vat_percent);

    return {
      prospect_id: draft.prospect_id || null,
      customer_id: draft.customer_id || null,
      customer_name: effectiveCustomerName,
      quote_type: draft.quote_type,
      customer_source: {
        kind: draft.customer_source.kind,
        sync_intent: draft.customer_source.kind === 'fortnox' ? 'linked' : draft.customer_source.sync_intent,
        fortnox_customer_id: draft.customer_source.fortnox_customer_id || null,
        fortnox_customer_name: draft.customer_source.fortnox_customer_name || null,
      },
      // Business quote at 0 % VAT = omvänd skattskyldighet (byggmoms) — the app's canonical
      // signal (see quoteAmountDisplay). Captured point-in-time so the Fortnox push resolves
      // the VAT regime even for snapshot-only quotes with no linked customer.
      customer_snapshot: buildCustomerSnapshot(draft, {
        reverseVat: draft.quote_type === 'business' && parseDecimal(draft.vat_percent) === 0,
      }),
      pricing_summary: {
        subtotal: totals.subtotal,
        vat: totals.vat,
        total: totals.total,
      },
      line_items: draft.items,
      rot_details: buildRotDetails(draft),
      internal_handoff: buildInternalHandoff(draft),
      project_name: draft.project_name,
      description: draft.description,
      amount: amountNumber,
      vat_percent: vatPercentNumber,
      valid_until: draft.valid_until || null,
      status: draft.status,
      quote_date: draft.quote_date,
      follow_up_date: draft.follow_up_date || null,
      notes: draft.notes,
      // Skickas BARA av den som får ändra fältet. En vanlig säljare som ekade tillbaka värdet
      // hade fått rutten att läsa upp offertens nuvarande ansvariga för att jämföra — en extra
      // rundtur i varje sparning för ett fält som ändå inte fick ändras.
      ...(canReassign && draft.assigned_to ? { assigned_to: draft.assigned_to } : {}),
    };
  }

  async function saveQuote() {
    setSubmitAttempted(true);
    if (submitting) return;

    // Enforce the client-side validation instead of only displaying it: don't submit
    // an incomplete quote — surface the first issue and scroll to its field.
    if (issues.length > 0) {
      toast.error(issues[0]);
      const firstFieldId = issueTargetId(issues[0]);
      if (firstFieldId) scrollToField(firstFieldId);
      return;
    }

    setSubmitting(true);

    try {
      const payload = buildQuotePayload();

      const res = await fetch(isEditing ? `/api/crm/quotes/${quoteId}` : '/api/crm/quotes', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte spara offert'); return; }

      const item = json?.data?.item as QuoteItem | undefined;
      if (item && !isEditing && draft.follow_up_date && draft.create_follow_up_task) {
        const taskCreated = await createFollowUpTask(item);
        if (!taskCreated) toast.info('Offerten sparades, men uppföljningsuppgiften kunde inte skapas automatiskt.');
      }

      clearPersistedDraft();
      // Saved → the current draft is now the clean baseline. Prevents the autosave effect from
      // re-creating the stash (and thus a phantom "resume?" banner) in the brief window between
      // `submitting` flipping back to false and the navigation unmounting the form.
      baselineRef.current = draftJson;
      const fortnoxError = json?.data?.fortnox_error as string | undefined;
      if (fortnoxError) {
        toast.error(`Offerten sparades, men kunde inte synkas till Fortnox: ${fortnoxError}`);
      } else {
        toast.success(isEditing ? 'Offert uppdaterad' : 'Offert skapad');
      }
      router.push(backTo);
    } catch {
      toast.error('Fel vid sparande av offert');
    } finally {
      setSubmitting(false);
    }
  }

  async function createWorkOrderFromQuote() {
    if (!quoteId || !loadedQuote) return;
    if (loadedQuote.status !== 'won') { toast.error('Arbetsorder kan bara skapas från vunnen offert'); return; }
    if (loadedQuote.work_order_id || loadedQuote.work_order_number) {
      toast.info(`Arbetsorder finns redan${loadedQuote.work_order_number ? `: ${loadedQuote.work_order_number}` : ''}`);
      return;
    }
    setCreatingWorkOrder(true);
    try {
      const res = await fetch(`/api/crm/quotes/${quoteId}/work-order`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        if (json?.errorDetails?.code === 'crm_work_order_missing_personal_number') {
          if (!loadedQuote.customer_id) {
            toast.error('Privatkunden saknar personnummer. Lägg till det på kundkortet först.');
            return;
          }
          setPnValue(draft.personal_number || '');
          setPnPromptOpen(true);
          return;
        }
        if (json?.errorDetails?.code === 'crm_work_order_missing_rot_property') {
          setRotPropertyPromptOpen(true);
          return;
        }
        // Fler än ett fynd: visa hela listan i stället för en prompt som bara lagar en sak. Listan
        // kommer med i svaret, så den som redan stod på sidan ser den uppdaterad direkt.
        if (json?.errorDetails?.code === 'crm_work_order_incomplete') {
          const details = json?.errorDetails?.details as { blockers?: WorkOrderReadinessIssue[]; warnings?: WorkOrderReadinessIssue[] } | undefined;
          const blockers = details?.blockers ?? [];
          // Bara när listan faktiskt bär något. Ett nekat anrop med tom lista betyder inte att
          // allt är ifyllt — att skriva över checklistan med den hade sagt motsatsen till felet.
          if (blockers.length > 0) setReadiness({ blockers, warnings: details?.warnings ?? [] });
          toast.error(blockers.length > 1 ? `${blockers.length} uppgifter saknas innan arbetsordern kan skapas` : (json?.error || 'Uppgifter saknas'));
          return;
        }
        toast.error(json?.error || 'Kunde inte skapa arbetsorder');
        return;
      }
      const workOrder = json?.data?.workOrder as { id?: string; order_number?: string } | undefined;
      toast.success(workOrder?.order_number ? `Arbetsorder skapad: ${workOrder.order_number}` : 'Arbetsorder skapad');
      if (workOrder?.id) router.push(`/crm/arbetsorder?work_order_id=${workOrder.id}`);
    } catch { toast.error('Kunde inte skapa arbetsorder'); } finally { setCreatingWorkOrder(false); }
  }

  // Save the personnummer on the linked customer, then retry the quote→order conversion.
  async function savePersonalNumberAndCreateOrder() {
    if (!loadedQuote?.customer_id) return;
    if (!pnValue.trim()) { toast.error('Fyll i personnummer'); return; }
    setCreatingWorkOrder(true);
    try {
      const patch = await fetch(`/api/crm/customers/${loadedQuote.customer_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personal_number: pnValue.trim() }),
      });
      const pj = await patch.json().catch(() => ({}));
      if (!patch.ok || !pj.ok) { toast.error(pj?.error || 'Kunde inte spara personnummer'); return; }
      setDraft((d) => ({ ...d, personal_number: pnValue.trim() }));
      setPnPromptOpen(false);
    } finally {
      setCreatingWorkOrder(false);
    }
    // Retry the conversion now that the customer has a personnummer.
    await createWorkOrderFromQuote();
  }

  // Save the ROT property identification on the quote, then retry the quote→order conversion.
  // The quote is re-saved in full (not a partial PATCH): that is what re-syncs the Fortnox offer,
  // and the offer is what `createorder` copies the order from — writing the designation only to our
  // own row would leave Fortnox without it, which is the whole point of collecting it here.
  async function saveRotPropertyAndCreateOrder() {
    if (!quoteId) return;
    const property = draft.rot_property_designation.trim();
    const brf = draft.rot_brf_org_number.trim();
    if (!property && !brf) { toast.error('Fyll i fastighetsbeteckning eller BRF org.nr'); return; }
    // Re-saving means the whole quote is validated again, and an older quote can be missing
    // something today's schema requires (Er referens, t.ex.). Say which field it is here instead of
    // letting the PATCH answer with a generic valideringsfel the seller can't act on.
    if (issues.length > 0) { toast.error(`Offerten måste kompletteras först: ${issues[0]}`); return; }
    setCreatingWorkOrder(true);
    try {
      const res = await fetch(`/api/crm/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildQuotePayload()),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte spara fastighetsbeteckning'); return; }
      if (json?.data?.fortnox_error) {
        // The offer didn't re-sync, so converting it now would produce a Fortnox order without the
        // designation — exactly what this gate exists to prevent. Stop and let them retry.
        toast.error(`Sparat, men offerten kunde inte synkas till Fortnox: ${json.data.fortnox_error}`);
        return;
      }
      // Saved → same bookkeeping as the ordinary save, so no phantom "resume draft?" banner.
      clearPersistedDraft();
      baselineRef.current = draftJson;
      setRotPropertyPromptOpen(false);
    } catch {
      toast.error('Kunde inte spara fastighetsbeteckning');
      return;
    } finally {
      setCreatingWorkOrder(false);
    }
    await createWorkOrderFromQuote();
  }

  // ── Täckningsgrad (TG) ──
  //
  // ⚠️ HOOKARNA MÅSTE LIGGA HÄR, ÖVER `if (loading) return`. Ligger de under körs de inte på
  // första rendern av en redigerad offert (loading startar true) men väl på den andra, och React
  // kastar "Rendered more hooks than during the previous render" → vit sida vid varje redigering.
  // Repot saknar ESLint, så react-hooks/rules-of-hooks fångar det inte; type-check och tester
  // gjorde det inte heller.
  //
  // ⚠️ Inköpspriserna hålls i komponent-state — aldrig i `draft`. Utkastet sparas som `line_items`,
  // och de följer med offert → arbetsorder → fältvyn (redactWorkOrderForField plockar bara bort
  // amount/pricing_summary). Ett inköpspris på raden hade alltså hamnat i installatörernas payload.
  const [purchasePrices, setPurchasePrices] = useState<Record<string, number | null>>({});
  // Kalkylinställningarna för förkalkylen — timkostnad, teamstorlek, produktivitet, säckpriser.
  const calcSettings = useCalcSettings();

  // Vid redigering bär raderna artikelnummer men inget inköpspris (det är ju aldrig sparat). Slå
  // upp priserna för just de artiklar offerten använder — inte hela registret.
  const articleNumbersOnRows = draft.items.map((i) => i.article_number).filter(Boolean).join(',');
  useEffect(() => {
    const numbers = [...new Set(articleNumbersOnRows.split(',').filter(Boolean))]
      .filter((nr) => !(nr in purchasePrices));
    if (numbers.length === 0) return;
    let cancelled = false;
    fetch(`/api/fortnox/articles?numbers=${encodeURIComponent(numbers.join(','))}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (cancelled) return;
        const items: Array<{ article_number: string; purchase_price?: number | null }> =
          Array.isArray(json?.data?.items) ? json.data.items : [];
        // Varje efterfrågat nummer får ett svar, ÄVEN när priset saknas (null). Utan den negativa
        // noteringen skulle de 61 artiklarna utan inköpspris slås upp på nytt vid varje
        // radändring, eftersom `!(nr in purchasePrices)` aldrig blev falskt för dem.
        const next: Record<string, number | null> = Object.fromEntries(numbers.map((nr) => [nr, null]));
        for (const a of items) {
          if (typeof a.purchase_price === 'number' && a.purchase_price > 0) next[a.article_number] = a.purchase_price;
        }
        setPurchasePrices((prev) => ({ ...prev, ...next }));
      })
      .catch(() => { /* tyst — TG är hjälpinformation, inte något offerten hänger på */ });
    return () => { cancelled = true; };
  }, [articleNumbersOnRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Checklistan hämtas när offerten är vunnen och ännu inte blivit en order — alltså precis när
  // knappen är tänkt att gå att trycka på. Tyst vid fel: listan är hjälp på vägen, spärren sitter
  // ändå på servern.
  //
  // ⚠️ Hooken måste ligga ovanför `if (loading)`-returnen nedan. En hook under en tidig return
  // kraschar sidan med "Rendered more hooks than during the previous render" — se .eslintrc.json.
  const readinessQuoteId =
    isEditing && quoteId && loadedQuote?.status === 'won' && !loadedQuote?.work_order_id && !loadedQuote?.work_order_number
      ? quoteId
      : null;

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

  // TG räknas på SAMMA belopp som visas på skärmen (effectiveRows.rowTotal), inte ur raden på nytt.
  // Formuläret prissätter auto-prissatta rader med sin egen stub medan pricing.ts ger dem 0 — räknade
  // vi om här skulle en auto-rad bidra med 0 kr till TG:n men synas i Delsumman, och inte ens
  // flaggas som obedömd. Se MarginRow i pricing.ts.
  //
  // Samma villkor som ROT-underlaget i `totals` OCH som pushen (`rot_details.enabled && !reverseVat`
  // — omvänd skattskyldighet är en företagsgrej och ROT är privat, så de kan aldrig kollidera).
  // Styr två saker: att `isLabor` bara sätts när ROT faktiskt är aktivt — en kvarglömd kryssruta på
  // en offert där ROT stängts av ska inte tyst ge raden full TG — och att den genererade
  // arbetskostnadsraden visas exakt när pushen faktiskt skickar den.
  const rotActive = draft.quote_type === 'private' && draft.rot_enabled;
  // ⚠️ LÖSULLENS KOSTNAD RÄKNAS PÅ SÄCKAR, INTE PÅ M³ × ARTIKELPRIS. `marginCostBasis` är samma
  // regel som den uppskattade TB2:an använder, så de två talen i panelen inte kan säga olika om
  // samma rad. Skälet står där: ett fast kr/m³-pris stämmer bara vid en enda densitet, och på ett
  // tätt jobb blir täckningsgraden för optimistisk — precis där marginalen är tunnast.
  //
  // Utan lästa kalkylinställningar faller vi tillbaka på artikelpriset. Det är exakt det beteende
  // som gällde före den här ändringen, och en täckningsgrad som försvinner hade varit värre: den
  // gatar säljchefens godkännande.
  // Radens artikelpris — visningen i radkortet använder det här, INTE marginalunderlaget nedan.
  const articlePriceFor = (articleNumber: string | null | undefined) =>
    articleNumber ? purchasePrices[articleNumber] ?? null : null;

  const preCalcItems = effectiveRows.map((r) => ({
    ...r,
    revenue: r.rowTotal,
    purchasePrice: articlePriceFor(r.article_number),
    isLabor: rotActive && Boolean(r.is_rot_work),
  }));

  const marginRows: MarginRow[] = preCalcItems.map((item) => {
    // Utan lästa kalkylinställningar finns ingen säckprislista — `marginCostBasis` faller då
    // tillbaka på artikelpriset av sig själv, alltså precis det underlag ytan använde före den här
    // ändringen.
    const basis = marginCostBasis(item, calcSettings?.sackPrices ?? []);
    return {
      revenue: item.revenue,
      quantity: basis.quantity,
      purchasePrice: basis.purchasePrice,
      isLabor: item.isLabor,
    };
  });
  const quoteMarginResult = quoteMargin(marginRows);
  const quoteMarginTier = marginTier(quoteMarginResult.marginPercent);

  // ── Förkalkyl: uppskattat TB1/TB2 ────────────────────────────────────────
  // Samma matte som arbetsorderns efterkalkyl, men på PLANERAT underlag: säckantalet raden räknar
  // fram (lineItemSacks — samma tal som arbetsbeskrivningen skriver) och en uppskattad arbetstid ur
  // produktivitetstabellen.
  //
  // ⚠️ Det här är INTE samma siffra som Täckningsgrad ovan, och de ska inte förväxlas. TG räknar
  // artikelns kr/m³ mot volymen; TB1 går via säckar och tar därmed hänsyn till densiteten. På ett
  // tätt snedtak skiljer de sig mätbart, och det är TB-vägen som är rätt.
  const preCalc = useMemo(() => {
    if (!calcSettings) return null;
    return calculatePreCalculation({
      items: preCalcItems,
      laborCostPerHour: calcSettings.laborCostPerHour,
      teamSize: calcSettings.teamSize,
      rates: calcSettings.rates,
      sackPrices: calcSettings.sackPrices,
    });
  }, [calcSettings, preCalcItems]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-slate-400">Laddar offert…</span>
      </div>
    );
  }

  const hasWorkOrder = Boolean(loadedQuote?.work_order_id || loadedQuote?.work_order_number);
  // Avstängd bara när vi VET att något saknas. Gick kontrollen inte att hämta lämnas knappen
  // aktiv — servern spärrar ändå, och en knapp som är död för att ett bakgrundsanrop failade är
  // värre än ett tydligt fel efter klicket.
  const workOrderBlocked = (readiness?.blockers.length ?? 0) > 0;
  const configuredRows = effectiveRows.filter((r) => r.isConfigured);
  // SAMMA definition som radkontrollerna (isConfigured). Stod den här på egen hand kunde en rad
  // räknas som "en rad finns" men falla ur varje per-rad-kontroll — en rad med bara blanksteg
  // passerade då hela valideringen utan att någon kontroll tittade på den.
  const hasAnyLineItemInput = draft.items.some((item) => isConfiguredLineItem(item));

  // Unified amount breakdown for the summary UI — mirrors the save payload's pricing_summary
  // exactly. The offer is always built from article rows (no manual amount field), so the figures
  // come from `totals`; before any row is configured they're null and the summary shows "—".
  const vatPct = parseDecimal(draft.vat_percent, 25);
  const isPrivateQuote = draft.quote_type === 'private';
  const summarySubtotal = hasAnyLineItemInput ? totals.subtotal : null;
  const summaryVat = summarySubtotal == null ? null : totals.vat;
  const summaryTotal = summarySubtotal == null ? null : totals.total;
  // VAT display convention (agreed with finance): private leads with the price INCL moms;
  // business leads with the EX-moms figure, the moms shown in the breakdown.
  //
  // The headline is ALWAYS the gross offer value — the figure Fortnox shows as the offer
  // total and the value we book the quote at (pricing_summary.total). A ROT deduction is NOT
  // subtracted from the headline: ROT is settled between the customer and Skatteverket, so the
  // company's value is still the gross. The customer's net-after-ROT (`toPay`) is shown as a
  // clearly-labelled secondary line, never as the headline, so the displayed price matches
  // Fortnox.
  const headlineLabel = isPrivateQuote ? 'Total inkl. moms' : 'Belopp ex moms';
  const headlineAmount = isPrivateQuote ? summaryTotal : summarySubtotal;

  // Vilket val i giltighetstids-rullgardinen datumen motsvarar (null = eget datum). Härlett, inte
  // lagrat — se matchedValidityPreset i quoteSerializers.
  const validityPreset = matchedValidityPreset(draft.quote_date, draft.valid_until);

  // Slås upp mot draften i stället för att lägga undan hela raden i state: raden kan redigeras
  // medan dialogen står öppen (den täcker inte formuläret på desktop), och en kopia hade då kunnat
  // visa ett artikelnamn som inte längre stämmer.
  const pendingRemoveRow = pendingRemoveRowId
    ? draft.items.find((item) => item.id === pendingRemoveRowId) ?? null
    : null;

  return (
    // Bredden tas om hand här: på en bred skärm drogs fälten förr ut över hela ytan. 1680 px ger två
    // kort sida vid sida plus högerspalten, och resten av ytan står tom i stället för i fälten.
    <div className="mx-auto grid w-full max-w-[1680px] gap-6 pb-20 lg:pb-0">

      {/* ── Sidhuvud ── */}
      <header className="grid gap-2">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex w-fit items-center gap-1.5 px-0 py-1 text-sm text-slate-600 transition hover:text-slate-900"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {backTo.startsWith('/crm/saljtavla') ? 'Säljtavlan' : 'Offerter'}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(crm.badge, quoteStatusMeta[draft.status].className)}>{quoteStatusMeta[draft.status].label}</span>
          {/* Offertnumret står här i stället för i ett avstängt fält — det går inte att ändra, och
              ett grått fält mitt i formuläret såg ut som något man borde fylla i. */}
          {isEditing && loadedQuote?.quote_number ? (
            <span className="text-xs font-medium tabular-nums text-slate-600">Offertnr {loadedQuote.quote_number}</span>
          ) : null}
        </div>
        <div>
          <h1 className={cn('m-0', crm.pageTitle)}>
            {isEditing ? (draft.project_name || 'Redigera offert') : (isCopy ? 'Kopiera offert' : 'Ny offert')}
          </h1>
          <p className={cn('m-0 mt-0.5', crm.pageSubtitle)}>
            {isEditing
              ? 'Uppdatera offertens uppgifter och status.'
              : isCopy
                // Säger uttryckligen att originalet står kvar. Ett färdigfyllt formulär läser annars
                // som en redigering, och då vågar man inte ändra något.
                ? `Uppgifterna är hämtade från ${copySourceName ? `”${copySourceName}”` : 'den valda offerten'}. Ändra det som skiljer och spara – originalet rörs inte, och kopian får ett eget offertnummer.`
                : 'Välj kund, fyll i offertuppgifterna och lägg till rader.'}
          </p>
        </div>
      </header>

      {/* ── Resume unsaved draft ── */}
      {recoverableDraft ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0 text-amber-600">
              <path d="M10 6.5v4M10 13.5h.01M10 2.5 2.5 16h15L10 2.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900">Osparat utkast hittades</p>
              <p className="text-xs text-amber-700">Du har en påbörjad offert som inte hann sparas. Vill du återuppta den?</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => { applyRestoredDraft(recoverableDraft); setRecoverableDraft(null); }}
              className="rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
            >
              Återuppta
            </button>
            <button
              type="button"
              onClick={() => { clearPersistedDraft(); setRecoverableDraft(null); }}
              className="rounded-lg border border-amber-300 bg-white px-3.5 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:border-amber-400"
            >
              Börja om
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Formuläret + högerspalten ── */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_304px] xl:grid-cols-[minmax(0,1fr)_340px]">

        {/* ── Vänster: ett kort per sektion ── */}
        <div className="grid min-w-0 gap-5">

          {/* Kund och Offertuppgifter sida vid sida när BÅDA får minst 36rem, annars staplade. Det är
              spaltens bredd som avgör och inte fönstrets: sidomenyn är 224 eller 68 px beroende på om
              den är utfälld, så en brytpunkt på fönstret hade slagit fel i det ena läget.
              min(36rem,100%) så kolumnen aldrig blir bredare än en smal skärm. */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(36rem,100%),1fr))] gap-5">

          {/* ── Kund ── */}
          <FormSection
            id="section-kund"
            title="Kund"
            description="Uppgifterna hämtas från kundkortet."
            action={
              <div className="inline-flex rounded-lg border border-[#dce4d8] bg-[#eef3ec] p-0.5" role="group" aria-label="Kundtyp">
                {(['business', 'private'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={draft.quote_type === type}
                    onClick={() => setDraft((d) => ({ ...d, quote_type: type }))}
                    className={cn(
                      'rounded-md px-3.5 py-1.5 text-sm font-medium transition-all',
                      draft.quote_type === type
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900',
                    )}
                  >
                    {type === 'business' ? 'Företag' : 'Privat'}
                  </button>
                ))}
              </div>
            }
          >
            <div className="grid gap-4">
            <CustomerSearchPicker
              selectedCustomer={selectedCustomer}
              onSelect={applySelectedCustomer}
              onClear={() => {
                customerLookupRef.current += 1; // clearing outranks any lookup still in flight
                setSelectedCustomer(null);
                setCustomWorkAddress(false);
                setDraft((current) => ({
                  ...current, customer_id: null,
                  customer_source: buildCustomerSource(null),
                  company_name: '', customer_name: '', organization_number: '',
                  personal_number: '', contact_name: '', phone: '', email: '',
                  street_address: '', postal_code: '', city: '',
                  delivery_address: '', delivery_postal_code: '', delivery_city: '',
                }));
              }}
              onCreateNew={() => goToCustomerPage('/crm/kunder/ny')}
            />

            {selectedCustomer ? (
              <button
                type="button"
                onClick={() => goToCustomerPage(`/crm/kunder/${selectedCustomer.id}`)}
                className="w-fit text-xs font-medium text-slate-400 transition-colors hover:text-slate-700"
              >
                Öppna kundkort →
              </button>
            ) : (
              <p className="text-xs text-slate-400">Sök fram en befintlig kund eller skapa en ny. Kunduppgifterna hämtas från kundkortet.</p>
            )}

            {/* Arbetsadress — explicit toggle istället för tyst autoifyllning, så en
                avvikande jobbplats (t.ex. företagskund vars kortadress är kontoret) inte
                glöms bort. Av = arbetsorder/Fortnox använder kundadressen. */}
            <div className="grid gap-3">
              <label className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-medium text-slate-700">Annan arbetsadress än kundens</span>
                  <span className="text-[11px] text-slate-400">Jobbet utförs på en annan plats än kundadressen</span>
                </span>
                <input
                  type="checkbox"
                  checked={customWorkAddress}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setCustomWorkAddress(on);
                    // Turning off → clear (snapshot uses the customer address). Turning on →
                    // leave the fields empty so the seller must enter the actual job site.
                    if (!on) setDraft((d) => ({ ...d, delivery_address: '', delivery_postal_code: '', delivery_city: '' }));
                  }}
                  className="h-4 w-4 shrink-0 rounded border-slate-300 accent-[color:var(--ek-accent)]"
                />
              </label>

              {customWorkAddress ? (
                <div className="grid gap-3 rounded-xl border border-[#e0e8dc] bg-white/60 p-3">
                  <p className={crm.sectionTitle}>Arbetsadress (där jobbet utförs)</p>
                  <Field label="Gatuadress">
                    <AddressAutocompleteInput
                      value={draft.delivery_address}
                      onChange={(street) => setDraft((d) => ({ ...d, delivery_address: street }))}
                      onSelect={(s) => setDraft((d) => ({
                        ...d,
                        delivery_address: s.street || d.delivery_address,
                        delivery_postal_code: s.postal_code || d.delivery_postal_code,
                        delivery_city: s.city || d.delivery_city,
                      }))}
                      placeholder="Sök adress, t.ex. Industrivägen 4 Södertälje"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Postnummer">
                      <Input
                        value={draft.delivery_postal_code}
                        onChange={(e) => setDraft((d) => ({ ...d, delivery_postal_code: e.target.value }))}
                        placeholder="152 42"
                      />
                    </Field>
                    <Field label="Ort">
                      <Input
                        value={draft.delivery_city}
                        onChange={(e) => setDraft((d) => ({ ...d, delivery_city: e.target.value }))}
                        placeholder="Södertälje"
                      />
                    </Field>
                  </div>
                  <p className="text-[11px] leading-snug text-slate-400">
                    Blir arbetsorderns adress och Fortnox leveransadress. Kundadressen ligger kvar som fakturaadress.
                  </p>
                </div>
              ) : null}
            </div>

            {/* Separat kontaktperson på arbetsplatsen (slutkund) — t.ex. en byggare beställer
                jobbet men arbetet utförs åt en annan person som inte ligger på kundkortet.
                Speglar arbetsadress-toggeln. Ordergivaren stannar som "Er referens". */}
            <div className="grid gap-3">
              <label className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-medium text-slate-700">Annan kontaktperson på arbetsplatsen</span>
                  <span className="text-[11px] text-slate-400">Slutkund utanför kundkortet (jobbet utförs åt någon annan än ordergivaren)</span>
                </span>
                <input
                  type="checkbox"
                  checked={customEndContact}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setCustomEndContact(on);
                    if (!on) setDraft((d) => ({ ...d, end_contact_name: '', end_contact_phone: '', end_contact_email: '' }));
                  }}
                  className="h-4 w-4 shrink-0 rounded border-slate-300 accent-[color:var(--ek-accent)]"
                />
              </label>

              {customEndContact ? (
                <div className="grid gap-3 rounded-xl border border-[#e0e8dc] bg-white/60 p-3">
                  <p className={crm.sectionTitle}>Kontaktperson på arbetsplatsen</p>
                  <Field label="Namn">
                    <Input
                      value={draft.end_contact_name}
                      onChange={(e) => setDraft((d) => ({ ...d, end_contact_name: e.target.value }))}
                      placeholder="T.ex. fastighetsägaren"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Telefon">
                      <Input
                        value={draft.end_contact_phone}
                        onChange={(e) => setDraft((d) => ({ ...d, end_contact_phone: e.target.value }))}
                        placeholder="070-123 45 67"
                        inputMode="tel"
                      />
                    </Field>
                    <Field label="E-post">
                      <Input
                        value={draft.end_contact_email}
                        onChange={(e) => setDraft((d) => ({ ...d, end_contact_email: e.target.value }))}
                        placeholder="namn@exempel.se"
                        type="email"
                      />
                    </Field>
                  </div>
                  {/* ⚠️ Texten lovade en gång "notering på Fortnox-dokumenten". Det stämmer inte
                      längre: buildEndContactNote är borttagen och Remarks skickas inte alls, så
                      slutkunden är helt CRM-intern. Ett löfte om vad kunden ser på sitt dokument får
                      inte stå kvar när det inte gäller. */}
                  <p className="text-[11px] leading-snug text-slate-400">
                    Visas för installatören på arbetsordern och blir förifylld mottagare av orderbekräftelsen. Går att ändra på arbetsordern. Skickas inte till Fortnox — ordergivaren står kvar som Er referens.
                  </p>
                </div>
              ) : null}
            </div>
            </div>
          </FormSection>

          {/* ── Offertuppgifter ── */}
          <FormSection
            id="section-offert"
            title="Offertuppgifter"
            description="Namn, referenser och villkor."
          >
            <Field fieldId="field-project-name" label="Offertnamn *" error={fieldErrors.project_name}>
              <Input
                value={draft.project_name}
                onChange={(e) => setDraft((d) => ({ ...d, project_name: e.target.value }))}
                placeholder="T.ex. Takisolering villa Norrköping"
                className="text-[15px] font-medium"
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              {/* Er referens bär en KNAPP ("Ny kontaktperson") i etikettraden, så den byggs utan
                  Field: en omslutande <label> vidarebefordrar klick till sin kontroll. */}
              <div id="field-contact-name" className="grid content-start gap-1.5">
                <div className="flex min-h-6 items-center justify-between gap-2">
                  <label htmlFor="quote-contact-name" className="w-auto text-xs font-semibold text-slate-600">Er referens *</label>
                  {/* Saknas personen på kundkortet — en ny platschef, en ny inköpare — ska man kunna
                      lägga till hen här. Vägen förut var en resa till kundkortet mitt i skrivandet:
                      utkastet stashas visserligen, men det är en omväg ingen ska behöva ta. */}
                  {selectedCustomer ? (
                    <button
                      type="button"
                      onClick={() => setContactFormOpen(true)}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-[color:var(--ek-accent)] transition hover:bg-[#e9f1eb]"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Ny kontaktperson
                    </button>
                  ) : null}
                </div>
                {/* Contact picker — for a customer with several contacts, choose which one is
                    responsible for this offer/order. Fills name/phone/email from the chosen
                    contact; the free-text field below still allows a manual override. */}
                {selectedCustomer && selectedCustomer.contacts.length > 0 ? (
                  <Select
                    aria-label="Välj kontaktperson"
                    value={selectedCustomer.contacts.find((c) => c.name === draft.contact_name)?.id ?? ''}
                    onChange={(e) => {
                      const c = selectedCustomer.contacts.find((x) => x.id === e.target.value);
                      if (!c) return;
                      // Fält för fält mot kundkortet (delad regel) — en kontaktrad utan telefon
                      // eller e-post ska ärva kortets, inte tömma fälten. Privatkundens
                      // automatiska rad bär bara namnet, så råa c.phone/c.email raderade numret.
                      const resolved = resolveCrmContact(selectedCustomer, c);
                      setDraft((d) => ({ ...d, contact_name: resolved.name, phone: resolved.phone, email: resolved.email }));
                    }}
                  >
                    <option value="">Skriv manuellt…</option>
                    {selectedCustomer.contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.role ? ` (${c.role})` : ''}{c.is_primary ? ' – primär' : ''}
                      </option>
                    ))}
                  </Select>
                ) : null}
                <Input
                  id="quote-contact-name"
                  value={draft.contact_name}
                  onChange={(e) => setDraft((d) => ({ ...d, contact_name: e.target.value }))}
                  placeholder="T.ex. Birgitta Ling"
                />
                {fieldErrors.contact_name ? (
                  <p className="m-0 text-xs font-medium text-rose-600">{fieldErrors.contact_name}</p>
                ) : null}
                <p className={fieldHint}>
                  Personen hos kunden som offerten gäller. Står som Er referens i Fortnox och följer med till order och faktura.
                </p>
              </div>

              {/* Etikettraden är lika hög som Er referens, där knappen gör den högre — annars
                  hamnar fälten bredvid varandra på olika höjd. */}
              {draft.quote_type === 'business' ? (
                <div className="grid content-start gap-1.5">
                  <div className="flex min-h-6 items-center">
                    <label htmlFor="quote-label" className="w-auto text-xs font-semibold text-slate-600">Märkning</label>
                  </div>
                  <Input
                    id="quote-label"
                    value={draft.label}
                    onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                    placeholder="Kundens projekt- eller beställningsnr"
                  />
                  <p className={fieldHint}>
                    Valfri. Står som Ert referensnummer i Fortnox och följer med till order och faktura.
                  </p>
                </div>
              ) : (
                // ROT-reglaget står på Märkningens plats för privatkund. Påslaget visar det
                // ROT-kortet och fältet "Varav arbetskostnad" på raderna.
                <div className="grid content-start gap-1.5">
                  <div className="flex min-h-6 items-center">
                    <span className="text-xs font-semibold text-slate-600">ROT-avdrag</span>
                  </div>
                  <label className={cn('flex min-h-11 cursor-pointer select-none items-center justify-between gap-3 rounded-lg px-3', crm.sunken)}>
                    <span className="text-sm text-slate-700">Offerten gäller ROT-arbete</span>
                    <SwitchTrack checked={draft.rot_enabled} onChange={(on) => setDraft((d) => ({ ...d, rot_enabled: on }))} />
                  </label>
                  <p className={fieldHint}>Visar ROT-uppgifterna och låter dig bryta ut arbetskostnad på raderna.</p>
                </div>
              )}
            </div>

            {/* Datumen och momsen på EN rad när kortet är brett nog: momsen rymmer "25" och behöver
                ingen tredjedel, medan "Giltig till" bär två kontroller. flex-wrap och inte ett rutnät
                med brytpunkter: kortets bredd beror på sidomenyn och på om korten står bredvid
                varandra, och raden ska bryta efter sin EGEN bredd. Blir det trångt faller momsen
                ned först, och behåller sin smala bredd. */}
            <div className="flex flex-wrap gap-5">
              <Field label="Offertdatum" plain className="min-w-0 flex-[1_1_10rem]">
                {/* Ändras offertdatumet flyttas "Giltig till" med och BEHÅLLER giltighetstiden —
                    väljer man 15 dagar ska det förbli 15 dagar, inte ett datum som blir fel så fort
                    offertdatumet justeras. Ett datum som inte motsvarar något val i rullgardinen
                    ("Eget datum") lämnas däremot orört: då är det just det datumet som gäller. */}
                <DatePicker
                  value={draft.quote_date}
                  clearable={false}
                  aria-label="Offertdatum"
                  onChange={(next) => setDraft((d) => {
                    const preset = matchedValidityPreset(d.quote_date, d.valid_until);
                    const keepDays = d.valid_until ? preset : OFFER_VALIDITY_DAYS;
                    return {
                      ...d,
                      quote_date: next,
                      valid_until: next && keepDays !== null ? addDaysIso(next, keepDays) : d.valid_until,
                    };
                  })}
                />
              </Field>
              <Field label="Giltig till" plain className="min-w-0 flex-[1.5_1_19rem]">
                {/* Rullgardinen är den snabba vägen: giltighetstiden är nästan alltid ett jämnt
                    antal dagar, och då ska ingen behöva räkna fram ett datum i kalendern. Valet
                    HÄRLEDS ur datumen (matchedValidityPreset) i stället för att lagras — ett eget
                    fält hade blivit en andra sanning vid sidan av valid_until, som är det som går
                    till Fortnox. Kalendern står bredvid för de gånger ett specifikt datum gäller.

                    minmax(0,1fr) på datumkolumnen med flit: ett <input> har min-width auto och
                    spränger annars ut rutnätet i stället för att krympa (se FRONTEND_SYSTEM.md om
                    grid blowout). */}
                <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
                  <Select
                    aria-label="Giltighetstid"
                    value={validityPreset ?? 'custom'}
                    onChange={(e) => setDraft((d) => ({ ...d, valid_until: addDaysIso(d.quote_date, Number(e.target.value)) }))}
                  >
                    {OFFER_VALIDITY_PRESETS.map((days) => (
                      <option key={days} value={days}>{days} dagar</option>
                    ))}
                    {/* "Eget datum" är ett TILLSTÅND, inte ett val: man hamnar där genom att plocka
                        ett datum i kalendern, och det finns inget vettigt för ett klick här att
                        göra. Alternativet visas därför bara när det faktiskt gäller, och är
                        avstängt — annars står det i listan och ser trasigt ut när ingenting händer. */}
                    {validityPreset === null ? <option value="custom" disabled>Eget datum</option> : null}
                  </Select>
                  <DatePicker value={draft.valid_until} onChange={(v) => setDraft((d) => ({ ...d, valid_until: v }))} aria-label="Giltig till" />
                </div>
              </Field>
              <Field label="Moms %" className="min-w-0 flex-[0_0_6.5rem]">
                <Input value={draft.vat_percent} onChange={(e) => setDraft((d) => ({ ...d, vat_percent: e.target.value }))} inputMode="decimal" placeholder="25" />
              </Field>
              {/* Byggmoms-notisen står på egen rad under fälten, inte inuti momsfältet — där hade
                  texten radbrutits till en smal remsa som drog upp höjden på hela raden. */}
              {/* ⚠️ The notice must reflect the OFFER, not just the customer card. It used to state
                  "moms sätts till 0 %" purely from the card, so an offer sitting at 25 % — a quote
                  written before the customer got reverse charge, or one where the refresh could not
                  tell an untouched field from an edited one — displayed a promise the saved document
                  did not keep. buildQuotePayload derives reverse_vat from vat_percent, so the draft
                  is what actually reaches Fortnox. */}
              {selectedCustomer?.reverse_vat ? (
                parseDecimal(draft.vat_percent) === 0 ? (
                  <p className="m-0 basis-full text-xs leading-snug text-amber-700">
                    Kunden har <strong>omvänd skattskyldighet</strong> – moms sätts till 0 %. Köparen redovisar momsen själv.
                  </p>
                ) : (
                  <p className="m-0 basis-full text-xs leading-snug text-rose-700">
                    Kunden har <strong>omvänd skattskyldighet</strong>, men den här offerten står på{' '}
                    {draft.vat_percent} % moms.{' '}
                    <button
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, vat_percent: '0' }))}
                      className="p-0 font-semibold text-rose-800 underline underline-offset-2 hover:text-rose-900"
                    >
                      Sätt 0 %
                    </button>
                  </p>
                )
              ) : null}
            </div>

            {/* Beskrivningen skickas inte till Fortnox (Remarks skickas inte alls, se offers.ts), och
                det ska synas här — annars skriver säljaren den till kunden. */}
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <label htmlFor="quote-description" className="w-auto text-xs font-semibold text-slate-600">Beskrivning</label>
                <span className="text-xs text-slate-500">Intern, kommer inte med till Fortnox</span>
              </div>
              <Textarea
                id="quote-description"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                rows={2}
                placeholder="Kort om omfattningen eller vad som offereras"
              />
            </div>
          </FormSection>
          </div>

          {/* ── Produkter och priser ── */}
          <FormSection
            id="section-rader"
            title="Produkter och priser"
            description="Offerten byggs av artikelrader. Dra i handtaget för att ändra ordningen."
          >
          {/* Ett omslag, så kortets avstånd mellan barnen inte läggs ovanpå radlistans egna. */}
          <div>
          {/* Totals bar */}
          {hasAnyLineItemInput ? (
            <LineItemTotalsBar
              subtotal={totals.subtotal}
              vat={totals.vat}
              vatPercent={vatPct}
              total={totals.total}
              toPay={totals.toPay}
              rowCount={configuredRows.length}
              carvedLabor={totals.carvedLabor}
              rotDeduction={totals.rotDeduction}
              isPrivate={isPrivateQuote}
            />
          ) : (
            <p className="m-0 mb-4 text-sm text-slate-600">
              Inga rader än. Lägg till en rad och välj artikel.
            </p>
          )}

          <DndContext sensors={itemSensors} collisionDetection={closestCenter} onDragEnd={handleItemsDragEnd}>
          <SortableContext items={draft.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="grid gap-2">
            {draft.items.map((row, index) => (
              <SortableLineItem key={row.id} id={row.id}>
                {(dragHandle) => (
              <LineItemRow
                row={row}
                index={index}
                dragHandle={dragHandle}
                metrics={effectiveRows.find((r) => r.id === row.id)}
                rotEnabled={draft.rot_enabled}
                marginPercent={rowMarginPercent(marginRows[index])}
                // ⚠️ ARTIKELNS pris, inte marginalunderlagets. Sedan lösull kostnadssätts per SÄCK
                // hade "Inköp 92,40 kr" stått bredvid ett m³-pris på 700 och lästs som 87 %
                // marginal, där den verkliga kostnaden är ~297 kr/m³.
                purchasePrice={articlePriceFor(row.article_number)}
                expanded={expandedRowId === row.id}
                onToggle={(next) => setExpandedRowId(next ? row.id : null)}
                onChange={(patch) => setDraft((d) => ({ ...d, items: d.items.map((item) => item.id === row.id ? { ...item, ...patch } : item) }))}
                onSelectArticle={(article) => {
                  const construction = inferConstructionFromArticle(article.name);
                  const unitName = getArticleUnitName(article.unit);
                  const pricingMode = pricingModeFromUnit(unitName);
                  if (article.articleNumber && typeof article.purchasePrice === 'number' && article.purchasePrice > 0) {
                    // Inköpspriset stannar i komponent-state, aldrig i draft — se purchasePrices.
                    setPurchasePrices((prev) => ({ ...prev, [article.articleNumber!]: article.purchasePrice! }));
                  }
                  setDraft((current) => ({
                    ...current,
                    items: current.items.map((item) => item.id === row.id ? {
                      ...item,
                      article_id: article.id || null,
                      article_name: article.name || null,
                      article_number: article.articleNumber || null,
                      article_price: typeof article.price === 'number' ? article.price : null,
                      article_unit_name: unitName || null,
                      article_note: article.note ?? null,
                      construction: construction || item.construction,
                      pricing_mode: pricingMode,
                      // Artikelregistrets standard skriver ovillkorligt, precis som pricing_mode och
                      // auto_price: artikeln ÄR radens identitet, och byter man artikel ska den nya
                      // artikelns egenskaper gälla. Följden är att ett manuellt kryss nollställs om
                      // säljaren byter artikel på raden — medvetet, samma regel som för prisläget.
                      include_in_description: article.includeInWorkDescription ?? false,
                      auto_price: false,
                      unit_price: article.price != null ? String(article.price) : item.unit_price,
                      quantity: pricingMode === 'item' && (!item.quantity || Number(item.quantity) <= 0) ? '1' : item.quantity,
                    } : item),
                  }));
                }}
                onClearArticle={() => setDraft((current) => ({
                  ...current,
                  items: current.items.map((item) => item.id === row.id ? {
                    ...item, article_id: null, article_name: null, article_number: null, article_price: null, article_unit_name: null, article_note: null,
                  } : item),
                }))}
                onRemove={() => { if (isBlankLineItem(row)) removeLineItem(row.id); else setPendingRemoveRowId(row.id); }}
              />
                )}
              </SortableLineItem>
            ))}
          </div>
          </SortableContext>
          </DndContext>

          {/* ── Den genererade arbetskostnadsraden ────────────────────────────────────────────
              Ligger ALLTID sist, som på Fortnox-offerten: pushen lägger den efter artikelraderna.
              Den är läsvy och finns inte i `draft.items` — den syntetiseras först vid pushen
              (buildOfferRows → rotLaborRow) och får aldrig lagras som en riktig rad. Gjorde vi det
              skulle pushen bryta ut arbetet EN GÅNG TILL ovanpå den och dubbelräkna det.

              ⚠️ Beloppet är INTE ett tillägg. Det är redan utbrutet ur raderna ovan, som visas till
              sitt fulla pris här medan Fortnox-dokumentet visar dem sänkta med samma belopp — summan
              är densamma på båda hållen. Därför "Varav" och ingen egen summering: en säljare som
              adderar radbeloppen i huvudet ska inte landa på en annan siffra än Delsumman.

              Visas bara när något faktiskt bryts ut. Rader med "ROT-arbete" ikryssad går INTE hit —
              de blir egna husarbete-rader med sin egen artikel, precis som i pushen. */}
          {rotActive && totals.carvedLabor > 0 ? (
            <GeneratedRotLaborRow position={draft.items.length + 1} amount={totals.carvedLabor} />
          ) : null}

          <button
            type="button"
            onClick={() => {
              // Accordion: open the new row as the only expanded one (collapses the rest).
              const newItem = createEmptyLineItem();
              setDraft((d) => ({ ...d, items: [...d.items, newItem] }));
              setExpandedRowId(newItem.id);
            }}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            + Lägg till rad
          </button>
          </div>
          </FormSection>

          {/* ── ROT-avdrag (slås på med reglaget i Offertuppgifter) ── */}
          {draft.quote_type === 'private' && draft.rot_enabled ? (
            // Procenten och maxavdraget ger beloppet som begärs i Fortnox skattereduktionspost
            // (taxReductions.ts) — aldrig mer än Fortnox egen uträkning på en ny offert. Det är
            // Skatteverket som till slut beslutar, därav "preliminärt".
            <FormSection
              id="section-rot"
              title="ROT-avdrag"
              description="Preliminärt. Fortnox och Skatteverket räknar ut det slutliga avdraget vid fakturering."
            >
              {/* The ROT applicant is the selected customer – shown read-only, not entered. */}
              <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg px-3.5 py-2.5',
                draft.personal_number.trim() ? crm.sunken : 'border border-amber-200 bg-amber-50')}>
                <p className="m-0 min-w-0 text-sm text-slate-800">
                  {draft.customer_name.trim()
                    ? <><span className="font-semibold">{draft.customer_name.trim()}</span> söker avdraget</>
                    : <span className="text-slate-500">Ingen kund vald</span>}
                  {draft.personal_number.trim() ? <span className="tabular-nums text-slate-600"> ({draft.personal_number})</span> : null}
                </p>
                {/* Upplysning, inte spärr. Offerten går att skicka utan numret — kunden vill
                    sällan lämna ut det innan hen tackat ja — och Fortnox räknar ut och visar
                    skattereduktionen på offerten ändå (uppmätt: 4 875 kr på en offert vars
                    husarbetespost saknade personnummer). Det numret avgör är om avdraget kan
                    knytas till en person, vilket krävs först vid fakturering. Därför efterfrågas
                    det när arbetsordern skapas. */}
                {!draft.personal_number.trim() ? (
                  <span className="text-[13px] text-amber-800">Personnummer saknas. Behövs inte för offerten, men efterfrågas när arbetsordern skapas.</span>
                ) : null}
              </div>
              <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-4">
                <Field fieldId="field-rot-property" label="Fastighetsbeteckning" error={fieldErrors.rot_property_designation}>
                  <Input value={draft.rot_property_designation} onChange={(e) => setDraft((d) => ({ ...d, rot_property_designation: fixPropertyDesignationTyping(e.target.value) }))} placeholder="T.ex. Haggården 6:3" />
                </Field>
                <Field label="BRF org.nr">
                  <Input value={draft.rot_brf_org_number} onChange={(e) => setDraft((d) => ({ ...d, rot_brf_org_number: e.target.value }))} placeholder="Om bostadsrätt" />
                </Field>
                <Field label="Skattereduktion %">
                  <Input value={draft.rot_percent} onChange={(e) => setDraft((d) => ({ ...d, rot_percent: e.target.value }))} inputMode="decimal" placeholder="30" />
                </Field>
                <Field label="Max. avdrag">
                  <Input value={draft.rot_max_deduction} onChange={(e) => setDraft((d) => ({ ...d, rot_max_deduction: e.target.value }))} inputMode="decimal" placeholder="50000" />
                </Field>
              </div>
            </FormSection>
          ) : null}

          {/* ── Internt ── */}
          {/* Allt här blir arbetsorderns (buildInternalHandoff + notes), inget går till kunden. */}
          <FormSection
            id="section-handoff"
            internal
            title="Internt"
            description="Syns inte för kunden. Följer med till arbetsordern när offerten vinns."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Önskat installationsdatum" plain>
                <DatePicker value={draft.desired_installation_date} onChange={(v) => setDraft((d) => ({ ...d, desired_installation_date: v }))} placeholder="Inget datum satt" aria-label="Önskat installationsdatum" />
              </Field>
              <Field label="Arbetets omfattning">
                <Input value={draft.work_scope} onChange={(e) => setDraft((d) => ({ ...d, work_scope: e.target.value }))} placeholder="Kort beskrivning av jobbet" />
              </Field>
            </div>
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="quote-handoff-notes" className="w-auto text-xs font-semibold text-slate-600">Arbetsbeskrivning</label>
                <button
                  type="button"
                  onClick={addMeasurementsToHandoff}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#d3ddcf] bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.6h-2.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Hämta mått från raderna
                </button>
              </div>
              <Textarea id="quote-handoff-notes" value={draft.handoff_notes} onChange={(e) => setDraft((d) => ({ ...d, handoff_notes: e.target.value }))} rows={7} placeholder="Det montören behöver veta" />
              {/* Utan den här raden fryser blocket tyst: säljaren ändrar en tjocklek, ser
                  beskrivningen stå kvar på gamla mått, och den siffran följer med till
                  arbetsordern där knappen inte finns. Låsningen måste synas. */}
              {measurementBlockLocked ? (
                <p className="m-0 text-xs leading-snug text-amber-700">
                  Måtten uppdateras inte längre automatiskt — du har ändrat i måttblocket. Klicka ”Hämta mått från raderna” för att hämta om dem.
                </p>
              ) : (
                <p className={fieldHint}>
                  Måtten från artikelraderna fylls i automatiskt och hålls uppdaterade. Antals- och meterrader du kryssat i hamnar under ÖVRIGT. Text du skriver själv står kvar under dem.
                </p>
              )}
            </div>
            <Field label="Anteckningar">
              <Textarea value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} rows={3} placeholder="Det här ska vi komma ihåg inför uppföljningen" />
            </Field>
          </FormSection>

          {/* ── Arbetsorder (vid redigering) ── */}
          {isEditing && loadedQuote ? (
            <FormSection id="section-arbetsorder" title="Arbetsorder" description="Skapas när offerten är vunnen.">
              <div className={cn('flex flex-wrap items-center justify-between gap-4 rounded-xl px-4 py-3.5', crm.sunken)}>
                <span className="text-sm text-slate-700">
                  {loadedQuote.work_order_number
                    ? `Arbetsorder ${loadedQuote.work_order_number} är skapad.`
                    : draft.status === 'won'
                      ? 'Offerten är vunnen och kan bli en intern arbetsorder.'
                      : 'Sätt offerten till vunnen för att skapa arbetsorder.'}
                </span>
                <div className="flex gap-2">
                  {loadedQuote.work_order_id ? (
                    <button type="button" onClick={() => router.push(`/crm/arbetsorder?work_order_id=${loadedQuote.work_order_id}`)} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300">
                      Öppna
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={createWorkOrderFromQuote}
                    disabled={draft.status !== 'won' || hasWorkOrder || creatingWorkOrder || workOrderBlocked}
                    className="rounded-lg border border-slate-900 bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
                  >
                    {creatingWorkOrder ? 'Skapar…' : hasWorkOrder ? 'Skapad' : 'Skapa arbetsorder'}
                  </button>
                </div>
              </div>
              {!hasWorkOrder && draft.status === 'won' && readiness ? (
                <WorkOrderReadinessNotice
                  blockers={readiness.blockers}
                  warnings={readiness.warnings}
                  onOpenCustomerCard={
                    loadedQuote.customer_id ? () => goToCustomerPage(`/crm/kunder/${loadedQuote.customer_id}`) : null
                  }
                  onRecheck={readiness.blockers.length > 0 ? () => { setRechecking(true); setReadinessNonce((n) => n + 1); } : null}
                  rechecking={rechecking}
                />
              ) : null}
            </FormSection>
          ) : null}

        </div>{/* end left column */}

        {/* ── Högerspalten: summa → checklista + spara → status ──
            Spara står högt, så den inte hamnar under skärmkanten på en laptop. Sektionslistan som
            stod här förut är borta: checklistan säger vad som saknas och hoppar dit (William
            2026-10-07). */}
        <aside className="grid min-w-0 gap-4 self-start lg:sticky lg:top-6">

          {/* Summa */}
          <section aria-label="Summering" className={cn(crm.card, 'px-5 py-5')}>
            <p className="m-0 text-[13px] font-medium text-slate-600">{headlineLabel}</p>
            <p className="m-0 mt-1 text-2xl font-bold leading-tight tracking-tight tabular-nums text-slate-900">
              {headlineAmount != null && Number.isFinite(headlineAmount)
                ? formatCurrency(headlineAmount, 'SEK')
                : <span className="text-slate-300">{formatCurrency(0, 'SEK')}</span>}
            </p>
            {headlineAmount != null && Number.isFinite(headlineAmount) && summaryVat != null && summaryTotal != null ? (
              <p className="m-0 mt-0.5 text-[13px] tabular-nums text-slate-600">
                {isPrivateQuote
                  ? `Varav moms (${vatPct} %) ${formatCurrency(summaryVat, 'SEK')}`
                  : `Inkl. moms ${formatCurrency(summaryTotal, 'SEK')} (moms ${vatPct} %)`}
              </p>
            ) : null}
            {/* ROT dras aldrig av från huvudsiffran (se headlineLabel) — kundens nettopris står
                under, tydligt märkt. */}
            {hasAnyLineItemInput && totals.rotDeduction > 0 ? (
              <dl className="m-0 mt-2 grid gap-0.5 text-[13px] tabular-nums">
                <div className="flex justify-between gap-3 font-medium text-emerald-700">
                  <dt>Avgår ROT-avdrag</dt>
                  <dd className="m-0">−{formatCurrency(totals.rotDeduction, 'SEK')}</dd>
                </div>
                <div className="flex justify-between gap-3 text-slate-600">
                  <dt>Kunden betalar efter ROT</dt>
                  <dd className="m-0">{formatCurrency(totals.toPay, 'SEK')}</dd>
                </div>
              </dl>
            ) : null}

            {hasAnyLineItemInput && totals.subtotal > 0
              && (quoteMarginResult.marginPercent != null || (preCalc != null && preCalc.revenue > 0)) ? (
              <div className="mt-5 grid gap-2 border-t border-[#e6ede3] pt-4">
                {/* Offertens samlade täckningsgrad. Viktad på belopp — se quoteMargin; ett
                    ovägt snitt av radernas procent hade låtit en småpostrad väga lika tungt
                    som huvudposten. Visas bara när minst en rad går att bedöma. */}
                {quoteMarginResult.marginPercent != null ? (
                  <>
                    <MarginGauge marginPercent={quoteMarginResult.marginPercent} />
                    {quoteMarginResult.unpricedRows > 0 ? (
                      // Utan den här upplysningen ser TG:n ut att gälla hela offerten, och en
                      // grön siffra kan dölja att halva beloppet aldrig bedömdes.
                      <p className={fieldHint}>
                        {/* "går inte att kostnadsbedöma" och inte "saknar inköpspris": sedan
                            lösullen räknas via säckar kan orsaken också vara att densiteten
                            saknas, och då är det den man ska fylla i — inte ett pris. */}
                        {quoteMarginResult.unpricedRows} {quoteMarginResult.unpricedRows === 1 ? 'rad' : 'rader'} går
                        inte att kostnadsbedöma ({formatCurrency(quoteMarginResult.unpricedRevenue, 'SEK')}) och ingår
                        inte i siffran.
                      </p>
                    ) : null}
                    {quoteMarginTier === 'bad' ? (
                      <p className="m-0 rounded-md border border-solid border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-medium leading-snug text-rose-700">
                        Täckningsgraden är under {MARGIN_THRESHOLDS.watch} %. Offerten behöver godkännas av säljchef innan den skickas.
                      </p>
                    ) : quoteMarginTier === 'watch' ? (
                      <p className="m-0 text-xs leading-snug text-amber-700">
                        Grönt kräver över {MARGIN_THRESHOLDS.good} % — se över priset innan du skickar.
                      </p>
                    ) : null}
                  </>
                ) : null}

                {/* ─── Uppskattad lönsamhet ─────────────────────────────
                    TB1 och TB2 räknade som på arbetsordern, fast på planerat underlag: säckarna
                    raden själv räknar fram och en arbetstid ur produktivitetstabellen.

                    ⚠️ Visas bara när det finns något att visa. Ett block som alltid står där
                    med två streck lär säljaren att hoppa över det, och då syns det inte heller
                    den dagen talen finns.

                    ⚠️ Inga trösklar och ingen färg utom på förlust — samma hållning som på
                    arbetsordern. Offertens 25/40 gäller TG ovanför och inte de här talen. */}
                {preCalc && preCalc.revenue > 0 ? (
                  <div className="mt-1 grid gap-1">
                    {/* ⚠️ Raden bär BARA namnet och talen, och varje tal är en egen odelbar enhet:
                        bryts kolumnen faller procenten ned som helhet i stället för att kapas mitt
                        i enheten ("5 762 kr · 43,7" / "%"). Timmarna står på egen rad under. */}
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="text-slate-700">Uppskattat TB2</span>
                      {/* ⚠️ Procenten prövas för sig. TB kan finnas medan TG är null — en
                          offert utan intäkt har inget att räkna procenten mot — och ett `!`
                          här hade blivit en krasch mitt i formuläret. */}
                      <span className="flex flex-wrap items-baseline justify-end gap-x-1.5 text-right">
                        <span className={cn('whitespace-nowrap font-semibold tabular-nums', preCalc.tb2 != null && preCalc.tb2 < 0 ? 'text-rose-700' : 'text-slate-900')}>
                          {preCalc.tb2 == null ? '–' : formatCurrency(preCalc.tb2, 'SEK')}
                        </span>
                        {preCalc.tb2 != null && preCalc.tg2 != null ? (
                          <span className="whitespace-nowrap tabular-nums text-slate-500">
                            {preCalc.tg2.toFixed(1).replace('.', ',')} %
                          </span>
                        ) : null}
                      </span>
                    </div>
                    {preCalc.teamHours != null ? (
                      <p className={fieldHint}>
                        Uppskattad arbetstid {preCalc.teamHours.toFixed(1).replace('.', ',')} h
                      </p>
                    ) : null}
                    {/* Luckorna säger VAD som fattas — "produktivitet saknas för Vind ×
                        EKOVILLA" är åtgärdbart, "kan inte räknas" är det inte.

                        ⚠️ Men be aldrig någon fylla i en tabell som inte finns. Saknas
                        migreringen byts radernas uppmaning mot orsaken. */}
                    {calcSettings?.productivityAvailable === false ? (
                      <p className={fieldHint}>
                        Produktivitetstabellen är inte uppsatt än, så arbetstiden går inte att uppskatta.
                      </p>
                    ) : null}
                    {preCalc.gaps
                      .filter((gap) => gap.kind !== 'missing_rate' || calcSettings?.productivityAvailable !== false)
                      // `unpriced_rows` säger samma sak som raden under täckningsgraden — men
                      // BARA när den raden faktiskt ritas. Utan villkoret försvann beskedet
                      // helt på en offert där täckningsgraden inte gick att räkna alls, och en
                      // omdöpt lösullsrad kunde falla ur uppskattningen utan ett ord.
                      .filter((gap) => gap.kind !== 'unpriced_rows'
                        || !(quoteMarginResult.marginPercent != null && quoteMarginResult.unpricedRows > 0))
                      .map((gap) => (
                        <p key={gap.kind} className={fieldHint}>
                          {gap.message}
                        </p>
                      ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* Checklista + spara. EN lista i stället för förra sektionslistan och "N att åtgärda":
              den säger vad som fattas och varje punkt hoppar dit. */}
          <section aria-label="Spara offerten" className={cn(crm.card, 'px-5 py-5')}>
            {isReady ? (
              <p className="m-0 mb-4 flex items-center gap-2 text-sm font-semibold text-emerald-800">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                Allt som krävs är ifyllt
              </p>
            ) : (
              <div className="mb-4">
                <p className="m-0 mb-1.5 text-[13px] font-semibold text-slate-800">Kvar innan du kan spara</p>
                <ul className="m-0 grid list-none gap-0.5 p-0">
                  {issues.map((issue) => {
                    const targetId = issueTargetId(issue);
                    const content = (
                      <>
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                        <span className="min-w-0 flex-1">{issue}</span>
                      </>
                    );
                    return (
                      <li key={issue}>
                        {targetId ? (
                          <button
                            type="button"
                            onClick={() => scrollToField(targetId)}
                            className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-slate-700 transition hover:bg-amber-50 hover:text-slate-900"
                          >
                            {content}
                          </button>
                        ) : (
                          <span className="flex items-start gap-2.5 px-2 py-1.5 text-[13px] text-slate-700">{content}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={saveQuote}
              disabled={submitting || !isReady}
              className={cn(crm.saveButton, 'h-10')}
            >
              {submitting ? 'Sparar…' : isEditing ? 'Spara offert' : 'Skapa offert'}
            </button>
            <button
              type="button"
              onClick={handleBack}
              className="mt-2 w-full rounded-lg px-0 py-1.5 text-center text-sm text-slate-600 transition-colors hover:text-slate-900"
            >
              Avbryt
            </button>
          </section>

          {/* Status och uppföljning */}
          <section aria-label="Status och uppföljning" className={cn(crm.card, 'grid gap-4 px-5 py-5')}>
            <Field label="Status">
              <Select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as QuoteItem['status'] }))}>
                {Object.entries(quoteStatusMeta).map(([value, meta]) => (
                  <option key={value} value={value}>{meta.label}</option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-2">
              <Field label="Följ upp senast" plain>
                <DatePicker value={draft.follow_up_date} onChange={(v) => setDraft((d) => ({ ...d, follow_up_date: v }))} placeholder="Inget datum" aria-label="Följ upp senast" />
              </Field>
              {/* Står vid datumet den gäller. Uppgiften skapas bara när offerten skapas, och den
                  hamnar hos den som sparar — ingen user_id skickas, se buildFollowUpTaskPayload. */}
              {!isEditing ? (
                <label className="flex w-auto cursor-pointer items-start gap-2 text-[13px] text-slate-700">
                  <input
                    type="checkbox"
                    checked={draft.create_follow_up_task}
                    onChange={(e) => setDraft((d) => ({ ...d, create_follow_up_task: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-[color:var(--ek-accent)]"
                  />
                  Skapa en uppgift till mig på datumet
                </label>
              ) : null}
            </div>

            {/* Ansvarig säljare. Läsvy för alla, väljare bara för administratörer — se
                authorizeQuoteAssignee för varför spärren också måste sitta i rutten.
                Fältet visas ÄVEN utan bytesrätt: vem som äger offerten avgör vem som får
                redigera den, och den som just fått "du kan bara redigera offerter du är
                ansvarig för" ska kunna se vem hen ska fråga. */}
            {canReassign ? (
              <Field label="Ansvarig säljare">
                <Select
                  value={draft.assigned_to}
                  onChange={(e) => setDraft((d) => ({ ...d, assigned_to: e.target.value }))}
                >
                  {!isEditing ? <option value="">Jag själv</option> : null}
                  {/* Offertens nuvarande ansvariga kan saknas i katalogen — hen har slutat
                      eller bytt roll (listan är sales/admin). Utan den här raden har
                      rullgardinen inget alternativ som matchar värdet, och webbläsaren
                      visar då det FÖRSTA i listan: fel namn, utan att något ändrats. */}
                  {draft.assigned_to && sellersLoaded && !sellers.some((seller) => seller.id === draft.assigned_to) ? (
                    <option value={draft.assigned_to}>Nuvarande ansvarig (inte längre säljare)</option>
                  ) : null}
                  {/* Medan katalogen är på väg finns inga alternativ alls. Ett värdebärande
                      alternativ håller rullgardinen på rätt rad i stället för att låta
                      webbläsaren falla till det första namnet som dyker upp. */}
                  {draft.assigned_to && !sellersLoaded ? (
                    <option value={draft.assigned_to}>Laddar…</option>
                  ) : null}
                  {sellers.map((seller) => (
                    <option key={seller.id} value={seller.id}>{seller.full_name || seller.id}</option>
                  ))}
                </Select>
                <p className={fieldHint}>
                  Står som Vår referens i Fortnox och blir kundansvarig när offerten vinns.
                </p>
              </Field>
            ) : draft.assigned_to && sellersLoaded ? (
              <Field label="Ansvarig säljare" plain>
                <p className="m-0 text-sm text-slate-700">
                  {sellers.find((seller) => seller.id === draft.assigned_to)?.full_name || 'Okänd säljare'}
                </p>
              </Field>
            ) : null}
          </section>

        </aside>

        </div>{/* end two-column grid */}

      {/* ── Mobile sticky action bar (sidebar handles this on lg+) ── */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-[#dce4d8] bg-white/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur lg:hidden">
        <div className="min-w-0">
          <p className="m-0 text-xs text-slate-600">{headlineLabel}</p>
          <p className="m-0 truncate text-base font-bold tabular-nums text-slate-950">
            {headlineAmount != null && Number.isFinite(headlineAmount) ? formatCurrency(headlineAmount, 'SEK') : '—'}
          </p>
        </div>
        <button
          type="button"
          onClick={saveQuote}
          disabled={submitting || !isReady}
          className={cn(crm.saveButton, 'ml-auto w-auto px-6')}
        >
          {submitting ? 'Sparar…' : isEditing ? 'Spara' : 'Skapa'}
        </button>
      </div>

      {/* Personnummer-prompt vid order från privatkund utan personnr */}
      {pendingLeaveHref ? (
        <CrmModal
          onClose={() => setPendingLeaveHref(null)}
          ariaLabel="Osparad offert"
          maxWidth="sm:max-w-[460px]"
          header={
            <>
              <h2 className="text-lg font-bold text-slate-900">Du har en osparad offert</h2>
              <p className="m-0 mt-0.5 text-sm text-slate-500">Vill du verkligen lämna sidan?</p>
            </>
          }
          footer={
            <>
              <button
                type="button"
                onClick={() => setPendingLeaveHref(null)}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5"
              >
                Stanna kvar
              </button>
              <button
                type="button"
                onClick={confirmLeave}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-rose-300 hover:text-rose-600 sm:ml-auto sm:flex-none sm:px-5"
              >
                Lämna sidan
              </button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-slate-600">
            Din påbörjade offert har inte sparats som en färdig offert. Ändringarna sparas automatiskt som ett
            utkast, så du kan återuppta dem nästa gång du öppnar offertsidan.
          </p>
        </CrmModal>
      ) : null}

      {pnPromptOpen ? (
        <CrmModal
          onClose={() => setPnPromptOpen(false)}
          ariaLabel="Personnummer krävs"
          maxWidth="sm:max-w-[460px]"
          header={
            <>
              <h2 className="text-lg font-bold text-slate-900">Personnummer krävs</h2>
              <p className="m-0 mt-0.5 text-sm text-slate-500">Fortnox behöver privatkundens personnummer för att fakturera ordern. Det sparas på kundkortet.</p>
            </>
          }
          footer={
            <>
              <button
                type="button"
                onClick={() => setPnPromptOpen(false)}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => void savePersonalNumberAndCreateOrder()}
                disabled={creatingWorkOrder || !pnValue.trim()}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5"
                style={{ backgroundColor: 'var(--crm-primary)' }}
              >
                {creatingWorkOrder ? 'Sparar…' : 'Spara och skapa order'}
              </button>
            </>
          }
        >
          <Field label="Personnummer">
            <Input value={pnValue} onChange={(e) => setPnValue(formatPersonalNumber(e.target.value))} placeholder="ÅÅÅÅMMDD-XXXX" inputMode="numeric" autoFocus />
          </Field>
        </CrmModal>
      ) : null}

      {rotPropertyPromptOpen ? (
        <CrmModal
          onClose={() => setRotPropertyPromptOpen(false)}
          ariaLabel="Fastighetsbeteckning krävs"
          maxWidth="sm:max-w-[460px]"
          header={
            <>
              <h2 className="text-lg font-bold text-slate-900">Fastighetsbeteckning krävs</h2>
              <p className="m-0 mt-0.5 text-sm text-slate-500">
                ROT-avdraget kan inte begäras utan att fastigheten är identifierad. Fyll i fastighetsbeteckningen — eller
                BRF:ens org.nr om kunden bor i bostadsrätt. Uppgiften sparas på offerten och följer med till Fortnox.
              </p>
            </>
          }
          footer={
            <>
              <button
                type="button"
                onClick={() => setRotPropertyPromptOpen(false)}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => void saveRotPropertyAndCreateOrder()}
                disabled={creatingWorkOrder || (!draft.rot_property_designation.trim() && !draft.rot_brf_org_number.trim())}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5"
                style={{ backgroundColor: 'var(--crm-primary)' }}
              >
                {creatingWorkOrder ? 'Sparar…' : 'Spara och skapa order'}
              </button>
            </>
          }
        >
          <div className="grid gap-3">
            <Field label="Fastighetsbeteckning">
              <Input
                value={draft.rot_property_designation}
                onChange={(e) => setDraft((d) => ({ ...d, rot_property_designation: fixPropertyDesignationTyping(e.target.value) }))}
                placeholder="T.ex. Gläntan 1:14"
                autoFocus
              />
            </Field>
            <Field label="BRF org.nr">
              <Input
                value={draft.rot_brf_org_number}
                onChange={(e) => setDraft((d) => ({ ...d, rot_brf_org_number: e.target.value }))}
                placeholder="Om bostadsrätt"
              />
            </Field>
          </div>
        </CrmModal>
      ) : null}

      {/* Ny kontaktperson på kunden, utan att lämna offerten. Samma modal som kundkortet och
          offertpanelen öppnar — ett formulär, tre ingångar. */}
      {contactFormOpen && selectedCustomer ? (
        <ContactFormModal
          customerId={selectedCustomer.id}
          contact={null}
          onClose={() => setContactFormOpen(false)}
          onSaved={(contact) => applyNewContact(contact)}
        />
      ) : null}

      {pendingRemoveRow ? (
        <CrmConfirmDialog
          title="Ta bort raden?"
          message={
            pendingRemoveRow.article_name
              ? `${pendingRemoveRow.article_name} tas bort från offerten. Det går inte att ångra.`
              : 'Raden tas bort från offerten. Det går inte att ångra.'
          }
          confirmLabel="Ta bort rad"
          tone="danger"
          onConfirm={() => removeLineItem(pendingRemoveRow.id)}
          onCancel={() => setPendingRemoveRowId(null)}
        />
      ) : null}
    </div>
  );
}

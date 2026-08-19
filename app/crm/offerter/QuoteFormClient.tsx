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
import { lineItemQuantity, isBlankLineItem } from '@/lib/domains/crm/lineItems';
import {
  rowMarginPercent, marginTier, quoteMargin, MARGIN_THRESHOLDS,
  type MarginRow, type MarginTier,
} from '@/lib/domains/crm/pricing';
import { crm } from '@/app/crm/lib/crmTokens';
import AddressAutocompleteInput from '@/app/crm/components/AddressAutocompleteInput';
import CrmModal from '@/app/crm/components/CrmModal';
import CrmConfirmDialog from '@/app/crm/components/CrmConfirmDialog';
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
  OFFER_VALIDITY_DAYS,
  OFFER_VALIDITY_PRESETS,
  type CustomerDerivedValues,
} from './quoteSerializers';
import { safeReturnTo, withReturnTo } from '@/app/crm/lib/returnTo';
import type { WorkOrderReadinessIssue } from '@/lib/domains/crm/workOrderReadiness';
import WorkOrderReadinessNotice from '@/app/crm/components/WorkOrderReadinessNotice';
import { resolveCrmContact } from '@/lib/domains/crm/contacts';
import {
  buildMeasurementLines,
  hasMeasurementBlock,
  replaceMeasurementBlock,
} from '@/lib/domains/crm/measurementBlock';
import { ROT_HOUSE_WORK_TYPES } from '@/lib/domains/fortnox/types';

// Swedish labels for the Fortnox ROT HouseWorkType codes shown in the ROT section.
const ROT_HOUSE_WORK_LABELS: Record<(typeof ROT_HOUSE_WORK_TYPES)[number], string> = {
  CONSTRUCTION: 'Bygg',
  ELECTRICITY: 'El',
  GLASSMETALWORK: 'Glas/plåt',
  GROUNDDRAINAGEWORK: 'Mark/dränering',
  HVAC: 'VVS',
  MASONRY: 'Murning',
  PAINTINGWALLPAPERING: 'Måleri/tapetsering',
  OTHERCOSTS: 'Övrigt',
};

// ─── Types ───────────────────────────────────────────────────────────────────

type QuoteCustomerSourceKind = 'prospect' | 'local' | 'fortnox';
type QuoteCustomerSyncIntent = 'local_only' | 'on_work_order' | 'linked';

type QuoteCustomerSource = {
  kind?: QuoteCustomerSourceKind | null;
  sync_intent?: QuoteCustomerSyncIntent | null;
  fortnox_customer_id?: string | null;
  fortnox_customer_name?: string | null;
};

type QuoteLineItem = {
  id: string;
  construction: 'vagg' | 'snedtak' | 'vind' | '';
  m2: string;
  thickness_mm: string;
  auto_price: boolean;
  unit_price: string;
  pricing_mode: 'm3' | 'item';
  quantity: string;
  article_id: string | null;
  article_name: string | null;
  article_number: string | null;
  // Artikelns beskrivning från registret, kopierad till raden när artikeln väljs — samma
  // denormalisering som article_price/article_unit_name. INTERN: visas som grå hjälptext under
  // vald artikel och läses aldrig av Fortnox-pushen (buildOfferRows rör den inte).
  article_note: string | null;
  article_price: number | null;
  article_unit_name: string | null;
  discount_percent: string;
  line_note: string;
  is_rot_work: boolean;
  house_work_type: string;
  // Labour carved out of a material row for ROT (kr, ex VAT). Summed onto a single "Arbetskostnad
  // ROT" row on the Fortnox document; the material row is reduced by it so the total is unchanged.
  labor_cost: string;
  density: string;
};

type QuoteItem = {
  id: string;
  quote_number: string | null;
  prospect_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  quote_type: 'private' | 'business';
  customer_source: QuoteCustomerSource | null;
  customer_snapshot: {
    customer_name?: string | null;
    company_name?: string | null;
    organization_number?: string | null;
    personal_number?: string | null;
    contact_name?: string | null;
    email?: string | null;
    phone?: string | null;
    street_address?: string | null;
    postal_code?: string | null;
    city?: string | null;
    visit_address?: string | null;
    delivery_address?: string | null;
    delivery_postal_code?: string | null;
    delivery_city?: string | null;
    invoice_address?: string | null;
    end_contact_name?: string | null;
    end_contact_phone?: string | null;
    end_contact_email?: string | null;
    label?: string | null;
  } | null;
  pricing_summary: { subtotal?: number; vat?: number; total?: number } | null;
  line_items: QuoteLineItem[] | null;
  rot_details: {
    enabled?: boolean;
    applicant_name?: string | null;
    personal_number?: string | null;
    property_designation?: string | null;
    rot_percent?: number;
    max_deduction?: number | null;
    brf_org_number?: string | null;
  } | null;
  internal_handoff: {
    desired_installation_date?: string | null;
    handoff_notes?: string | null;
    work_scope?: string | null;
  } | null;
  project_name: string;
  description: string | null;
  amount: number | string;
  currency_code: string;
  vat_percent: number | string | null;
  valid_until: string | null;
  work_order_id: string | null;
  work_order_number: string | null;
  converted_to_work_order_at: string | null;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
  quote_date: string;
  follow_up_date: string | null;
  notes: string | null;
  assigned_to: string | null;
};

type QuoteDraft = {
  customer_id: string | null;
  prospect_id: string;
  quote_type: 'private' | 'business';
  customer_source: {
    kind: QuoteCustomerSourceKind;
    sync_intent: QuoteCustomerSyncIntent;
    fortnox_customer_id: string;
    fortnox_customer_name: string;
  };
  customer_name: string;
  company_name: string;
  organization_number: string;
  personal_number: string;
  contact_name: string;
  email: string;
  phone: string;
  street_address: string;
  postal_code: string;
  city: string;
  visit_address: string;
  delivery_address: string;
  delivery_postal_code: string;
  delivery_city: string;
  invoice_address: string;
  // Separate on-site contact (slutkund) outside the customer card — see buildCustomerSnapshot.
  end_contact_name: string;
  end_contact_phone: string;
  end_contact_email: string;
  // Free-text märkning (företag) → Fortnox "Ert referensnummer".
  label: string;
  items: QuoteLineItem[];
  project_name: string;
  description: string;
  vat_percent: string;
  valid_until: string;
  rot_enabled: boolean;
  rot_property_designation: string;
  rot_percent: string;
  rot_max_deduction: string;
  rot_brf_org_number: string;
  desired_installation_date: string;
  handoff_notes: string;
  work_scope: string;
  status: QuoteItem['status'];
  quote_date: string;
  follow_up_date: string;
  notes: string;
  create_follow_up_task: boolean;
  // Ansvarig säljare. Tom sträng = "den som skapar offerten" (servern fyller i vid POST).
  // Bara en administratör kan ändra fältet; för alla andra visas det som text.
  assigned_to: string;
};

type EffectiveRow = QuoteLineItem & {
  amount: number;
  unit: number;
  effectiveUnit: number;
  label: string;
  mode: 'm3' | 'item';
  rowTotal: number;
  isConfigured: boolean;
};

type ArticleLite = {
  id?: string;
  name?: string;
  articleNumber?: string;
  price?: number | null;
  unit?: string | { name?: string | null; objectiveName?: string | null } | null;
  isFavorite?: boolean;
  // Artikelns beskrivning ur registret. INTERN hjälptext för säljaren — se article_note på raden.
  note?: string | null;
  // Inköpspris ur artikelcachen, för täckningsgraden. Lagras ALDRIG på offertraden (se pricing.ts):
  // line_items följer med till fältvyn, och där har installatörerna inget med inköpspriser att göra.
  purchasePrice?: number | null;
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

function createEmptyLineItem(): QuoteLineItem {
  return {
    id: crypto.randomUUID(),
    construction: '',
    m2: '',
    thickness_mm: '',
    auto_price: true,
    unit_price: '',
    pricing_mode: 'm3',
    quantity: '',
    article_id: null,
    article_name: null,
    article_number: null,
    article_note: null,
    article_price: null,
    article_unit_name: null,
    discount_percent: '',
    line_note: '',
    is_rot_work: false,
    house_work_type: 'CONSTRUCTION',
    labor_cost: '',
    density: '',
  };
}

function inferConstructionFromArticle(name?: string | null) {
  const value = (name || '').toLowerCase();
  if (/sned\s*tak|snedtak|taklut|lutande/.test(value)) return 'snedtak' as const;
  if (/\bvind\b|vinds?bjälklag|vinden/.test(value)) return 'vind' as const;
  if (/vägg|vagg|regel|stomme|väggreg/.test(value)) return 'vagg' as const;
  return '' as const;
}

function computeUnitPrice(_construction: QuoteLineItem['construction'], _thicknessMm: number) {
  return 900;
}

function getArticleUnitName(unit: ArticleLite['unit']) {
  if (!unit) return '';
  if (typeof unit === 'string') return unit;
  return String(unit.name || unit.objectiveName || '');
}

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

function getDefaultDraftCustomerSource(prospectId?: string | null): QuoteDraft['customer_source'] {
  return {
    kind: prospectId ? 'prospect' : 'local',
    sync_intent: 'local_only',
    fortnox_customer_id: '',
    fortnox_customer_name: '',
  };
}

function getDraftCustomerSource(source: QuoteCustomerSource | null | undefined, prospectId?: string | null): QuoteDraft['customer_source'] {
  const kind = source?.kind === 'prospect' || source?.kind === 'local' || source?.kind === 'fortnox'
    ? source.kind
    : (prospectId ? 'prospect' : 'local');
  const syncIntent = source?.sync_intent === 'on_work_order' || source?.sync_intent === 'linked'
    ? source.sync_intent
    : 'local_only';
  return {
    kind,
    sync_intent: kind === 'fortnox' ? 'linked' : syncIntent,
    fortnox_customer_id: source?.fortnox_customer_id || '',
    fortnox_customer_name: source?.fortnox_customer_name || '',
  };
}

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
  const hasAnyLineItemInput = draft.items.some((item) => item.article_name || item.m2 || item.quantity || item.unit_price);

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
  }
  return issues;
}

const initialQuoteDate = new Date().toISOString().slice(0, 10);

const initialDraft: QuoteDraft = {
  customer_id: null,
  prospect_id: '',
  quote_type: 'business',
  customer_source: { kind: 'local', sync_intent: 'local_only', fortnox_customer_id: '', fortnox_customer_name: '' },
  customer_name: '',
  company_name: '',
  organization_number: '',
  personal_number: '',
  contact_name: '',
  email: '',
  phone: '',
  street_address: '',
  postal_code: '',
  city: '',
  visit_address: '',
  delivery_address: '',
  delivery_postal_code: '',
  delivery_city: '',
  invoice_address: '',
  end_contact_name: '',
  end_contact_phone: '',
  end_contact_email: '',
  label: '',
  items: [createEmptyLineItem()],
  project_name: '',
  description: '',
  vat_percent: '25',
  valid_until: addDaysIso(initialQuoteDate, OFFER_VALIDITY_DAYS),
  rot_enabled: false,
  rot_property_designation: '',
  rot_percent: '30',
  rot_max_deduction: '50000',
  rot_brf_org_number: '',
  desired_installation_date: '',
  handoff_notes: '',
  work_scope: '',
  status: 'draft',
  quote_date: initialQuoteDate,
  follow_up_date: '',
  notes: '',
  create_follow_up_task: true,
  assigned_to: '',
};

// ─── ArticlePicker ────────────────────────────────────────────────────────────

function ArticlePicker({ value, articleNumber, price, unit, note, purchasePrice, onSelect, onClear }: {
  value: string;
  articleNumber?: string | null;
  price?: number | null;
  unit?: string | null;
  /** Artikelns beskrivning ur registret — INTERN hjälptext, når aldrig Fortnox. */
  note?: string | null;
  /** Inköpspris per enhet ur artikelregistret. Visas som underlag till täckningsgraden — utan
   *  kronorna är procenten svår att förhandla mot. Lagras aldrig på raden (se pricing.ts). */
  purchasePrice?: number | null;
  onSelect: (article: ArticleLite) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ArticleLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  // When an article is picked we show a solid "selected" card instead of the search box.
  // "Byt" flips into search mode; selecting or cancelling returns to the card.
  const [searching, setSearching] = useState(false);

  // Toggle a global favorite (shared across sellers). Optimistic; floats favorites to the top.
  // onMouseDown + preventDefault so the star click doesn't blur the search input (which would
  // close the dropdown before the toggle registers), and doesn't select the article.
  async function toggleFavorite(item: ArticleLite, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const articleNumber = item.articleNumber;
    if (!articleNumber) return;
    const next = !item.isFavorite;
    setItems((prev) => {
      const updated = prev.map((a) => (a.articleNumber === articleNumber ? { ...a, isFavorite: next } : a));
      return [...updated.filter((a) => a.isFavorite), ...updated.filter((a) => !a.isFavorite)];
    });
    try {
      await fetch(`/api/fortnox/articles/${encodeURIComponent(articleNumber)}/favorite`, { method: next ? 'POST' : 'DELETE' });
    } catch { /* best-effort — keep the optimistic state */ }
  }

  useEffect(() => {
    // Open with no query → default list (recent articles); typed query → search.
    if (!open) { setItems([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const q = query.trim();
    // Debounce typed queries so a fast typist doesn't fire a cache query per keystroke;
    // the initial open (empty query) loads immediately.
    const timer = setTimeout(() => {
      const url = q.length >= 1
        ? `/api/fortnox/articles?q=${encodeURIComponent(q)}&limit=20`
        : `/api/fortnox/articles?limit=20`;
      fetch(url, { cache: 'no-store' })
        .then((r) => r.json().catch(() => ({})))
        .then((json) => {
          if (!cancelled) {
            const raw: Array<{ article_number: string; description: string | null; note?: string | null; sales_price: number | null; purchase_price?: number | null; unit: string | null; is_favorite?: boolean }> =
              Array.isArray(json?.data?.items) ? json.data.items : [];
            setItems(raw.map((a) => ({
              id: a.article_number,
              name: a.description ?? undefined,
              articleNumber: a.article_number,
              price: a.sales_price,
              unit: a.unit ?? undefined,
              isFavorite: a.is_favorite ?? false,
              note: a.note ?? null,
              purchasePrice: a.purchase_price ?? null,
            })));
          }
        })
        .catch(() => { if (!cancelled) { setError('Kunde inte hämta artiklar'); setItems([]); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, q.length >= 1 ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query]);

  // Solid "selected article" card — makes a chosen article unmistakable (vs the old
  // faded-placeholder look). "Byt" reopens the search; "Rensa" empties the row's article.
  if (value && !searching) {
    const meta = [
      articleNumber || 'Utan artikelnummer',
      typeof price === 'number' ? `${price.toFixed(2)} kr` : null,
      getArticleUnitName(unit) || null,
      // Inköpspriset som underlag till TG-märket på raden: procenten säger att marginalen är tunn,
      // kronorna säger hur mycket utrymme som faktiskt finns kvar att förhandla med.
      typeof purchasePrice === 'number' ? `Inköp ${purchasePrice.toFixed(2)} kr` : null,
    ].filter(Boolean).join(' · ');
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5">
        <div className="grid min-w-0 gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-600">Vald artikel</span>
          <span className="truncate text-sm font-semibold text-slate-900">{value}</span>
          {meta ? <span className="truncate text-xs text-slate-500">{meta}</span> : null}
          {/* Artikelns beskrivning ur registret — INTERN. Ett stöd för säljaren att se vad artikeln
              faktiskt innehåller; den skickas aldrig med till Fortnox och syns inte på offerten.
              Inte truncate: hela poängen är att kunna läsa texten. Tre rader räcker för de
              beskrivningar som finns och hindrar en lång text från att svälla ut raden. */}
          {/* text-xs/slate-500 är repots hjälptext-token, inte 11px/slate-400 som stod här först:
              slate-400 på vitt ligger kring 3:1 i kontrast, under gränsen för läsbar brödtext.
              Beskrivningen är dessutom den längsta texten i kortet och den enda man faktiskt läser
              — meta-raden ovanför är siffror man skummar. Att göra den minst och ljusast var
              bakvänt. */}
          {note?.trim() ? (
            <span className="line-clamp-3 text-xs leading-relaxed text-slate-500">{note.trim()}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => { setSearching(true); setQuery(''); setOpen(true); }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300"
          >
            Byt
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:border-rose-300 hover:text-rose-600"
          >
            Rensa
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => { setOpen(false); setSearching(false); }, 150)}
          placeholder="Sök eller välj artikel…"
          autoFocus={searching}
        />
        {value ? (
          <button type="button" onClick={() => setSearching(false)} className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 transition-colors hover:border-slate-300">
            Avbryt
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-[0_16px_32px_rgba(15,23,42,0.10)]">
          {loading ? <div className="px-4 py-3 text-sm text-slate-400">Söker…</div> : null}
          {error ? <div className="px-4 py-3 text-sm text-rose-600">{error}</div> : null}
          {!loading && !error && items.length === 0 ? <div className="px-4 py-3 text-sm text-slate-400">Inga artiklar hittades.</div> : null}
          {!loading && !error && query.trim().length === 0 && items.length > 0 ? (
            <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Senaste artiklar</p>
          ) : null}
          {!loading && !error ? items.map((item) => (
            <div
              key={item.id || item.articleNumber || item.name}
              className="flex items-center gap-1 border-b border-slate-100 pr-2 transition last:border-b-0 hover:bg-slate-50"
            >
              <button
                type="button"
                aria-label={item.isFavorite ? 'Ta bort favorit' : 'Markera som favorit'}
                aria-pressed={item.isFavorite}
                title={item.isFavorite ? 'Favorit — visas överst' : 'Markera som favorit'}
                onMouseDown={(e) => toggleFavorite(item, e)}
                className="shrink-0 rounded-md px-2 py-2 text-lg leading-none transition-colors hover:bg-amber-50"
              >
                <span className={item.isFavorite ? 'text-amber-400' : 'text-slate-300'}>{item.isFavorite ? '★' : '☆'}</span>
              </button>
              <button
                type="button"
                // onMouseDown (not onClick) so the selection commits on press — before the
                // input's blur-timeout closes the list and before a pending debounce refetch
                // swaps the row out from under the click. Mirrors CustomerSearchPicker and the
                // favorite star above. preventDefault keeps input focus so no blur fires.
                onMouseDown={(e) => { e.preventDefault(); onSelect(item); setOpen(false); setQuery(''); setSearching(false); }}
                className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-2.5 pr-2 text-left"
              >
                <span className="truncate text-sm font-medium text-slate-900">{item.name || 'Artikel'}</span>
                <span className="text-xs text-slate-400">
                  {item.articleNumber || 'Utan artikelnummer'}
                  {typeof item.price === 'number' ? ` · ${item.price.toFixed(2)} kr` : ''}
                  {getArticleUnitName(item.unit) ? ` · ${getArticleUnitName(item.unit)}` : ''}
                </span>
              </button>
            </div>
          )) : null}
        </div>
      ) : null}
    </div>
  );
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

// ─── Section header (numbered circle + title + optional action) ────────────────

function SectionHeader({
  step,
  title,
  action,
  muted,
  className,
}: {
  step: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  muted?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('mb-6 flex items-center gap-3', action ? 'justify-between' : '', className)}>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
            muted ? 'bg-slate-200 text-slate-600' : 'text-white',
          )}
          style={muted ? undefined : { backgroundColor: 'var(--crm-primary)' }}
        >
          {step}
        </span>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </div>
      {action ?? null}
    </div>
  );
}

// ─── LineItemRow (one product/price row) ──────────────────────────────────────

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

// ─── MarginBadge ──────────────────────────────────────────────────────────────
//
// Täckningsgrad per rad, färgad efter MARGIN_THRESHOLDS. Ett stöd för säljaren att se när en
// rabatt äter marginalen — inte en spärr: rött hindrar ingen från att spara eller skicka, det
// säger att offerten behöver godkännas.
//
// Saknas inköpspris visas INGET märke alls (61 av 289 artiklar har inget). Ett grått "?" på var
// femte rad hade blivit brus, och en avsaknad av pris är inte en dålig affär.
function MarginBadge({ marginPercent, className }: { marginPercent: number | null; className?: string }) {
  const tier = marginTier(marginPercent);
  if (tier === 'unknown' || marginPercent == null) return null;

  // Egna klasser i stället för Badge-primitiven: den här ska vara liten och sifferorienterad
  // (tabular-nums så procenten inte hoppar i sidled när säljaren skriver i prisfältet).
  const styles: Record<Exclude<MarginTier, 'unknown'>, string> = {
    good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    watch: 'border-amber-200 bg-amber-50 text-amber-700',
    bad: 'border-rose-200 bg-rose-50 text-rose-700',
  };
  const titles: Record<Exclude<MarginTier, 'unknown'>, string> = {
    good: `Täckningsgrad ${marginPercent.toFixed(1)} % – över ${MARGIN_THRESHOLDS.good} %`,
    watch: `Täckningsgrad ${marginPercent.toFixed(1)} % – grönt kräver över ${MARGIN_THRESHOLDS.good} %, se över priset`,
    bad: `Täckningsgrad ${marginPercent.toFixed(1)} % – under ${MARGIN_THRESHOLDS.watch} %, offerten kräver godkännande`,
  };

  return (
    <span
      title={titles[tier]}
      className={cn(
        // En decimal, inte toFixed(0): 34,6 % är rött men avrundades till "TG 35 %" — märket
        // påstod exakt den tröskel det låg under. Siffran måste hamna på samma sida som färgen.
        'inline-flex items-center gap-1 rounded-md border border-solid px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
        styles[tier],
        className,
      )}
    >
      TG {marginPercent.toFixed(1)} %
    </span>
  );
}

function LineItemRow({
  row,
  index,
  metrics,
  rotEnabled,
  marginPercent,
  purchasePrice,
  expanded,
  onToggle,
  onChange,
  onSelectArticle,
  onClearArticle,
  onRemove,
  dragHandle,
}: {
  row: QuoteLineItem;
  index: number;
  metrics: EffectiveRow | undefined;
  rotEnabled: boolean;
  /** Radens täckningsgrad i procent, eller null när artikeln saknar inköpspris. */
  marginPercent: number | null;
  /** Artikelns inköpspris per enhet, visat som underlag till täckningsgraden. */
  purchasePrice: number | null;
  // Accordion: which row is open is owned by the parent so opening one collapses the rest.
  expanded: boolean;
  onToggle: (next: boolean) => void;
  onChange: (patch: Partial<QuoteLineItem>) => void;
  onSelectArticle: (article: ArticleLite) => void;
  onClearArticle: () => void;
  onRemove: () => void;
  dragHandle?: React.ReactNode;
}) {
  const isM3 = (row.pricing_mode ?? 'm3') === 'm3';
  // The ROT labour carve-out field sits on the economy row next to A-pris/Rabatt, but only when ROT
  // is on and the row isn't already flagged as full ROT work (its whole price is then the labour).
  const showLaborField = rotEnabled && !row.is_rot_work;

  // ── Collapsed: single overview line ──────────────────────────────────────────
  if (!expanded) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-100 px-3.5 py-2.5 transition-colors hover:border-slate-200">
        {dragHandle}
        <button type="button" onClick={() => onToggle(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-300">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
            {row.article_name || <span className="text-slate-400">Välj artikel…</span>}
          </span>
          {metrics?.isConfigured ? (
            <span className="hidden shrink-0 text-xs tabular-nums text-slate-400 sm:inline">
              {metrics.amount.toLocaleString('sv-SE', { maximumFractionDigits: 2 })} × {formatCurrency(metrics.effectiveUnit, 'SEK')}
            </span>
          ) : null}
          {row.is_rot_work ? (
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">ROT</span>
          ) : null}
          <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">
            {formatCurrency(metrics?.rowTotal ?? 0, 'SEK')}
          </span>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 text-slate-300">
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" onClick={onRemove} aria-label="Ta bort rad" className="shrink-0 px-1 text-slate-300 transition-colors hover:text-rose-600">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    );
  }

  // ── Expanded: full editor ────────────────────────────────────────────────────
  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-semibold text-slate-400">{dragHandle}Rad {index + 1}</span>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => onToggle(false)} className="text-xs font-medium text-slate-500 transition-colors hover:text-slate-800">
            Fäll ihop ▴
          </button>
          <button type="button" onClick={onRemove} className="text-xs text-slate-400 transition-colors hover:text-rose-600">
            Ta bort
          </button>
        </div>
      </div>

      <ArticlePicker
        value={row.article_name || ''}
        articleNumber={row.article_number}
        price={row.article_price}
        unit={row.article_unit_name}
        note={row.article_note}
        purchasePrice={purchasePrice}
        onSelect={onSelectArticle}
        onClear={onClearArticle}
      />

      {/* Editable display name (Description) for the picked article — e.g. rename a generic
          "Övrigt" article to something descriptive. Only the row's Description changes; the
          article number/price/unit stay intact, and this text is what buildOfferRows sends to
          Fortnox as the row Description. Shown once an article is selected. */}
      {row.article_name ? (
        <Field label="Benämning på offerten">
          <Input
            value={row.article_name}
            onChange={(e) => onChange({ article_name: e.target.value })}
            placeholder="Namn som visas på offerten"
          />
        </Field>
      ) : null}

      {/* Mätning: area/thickness/density (m³) or quantity (styckepris). */}
      <div className="grid gap-3 sm:grid-cols-3">
        {isM3 ? (
          <>
            <Field label="m²"><Input value={row.m2} onChange={(e) => onChange({ m2: e.target.value })} inputMode="decimal" placeholder="0" /></Field>
            <Field label="Tjocklek mm"><Input value={row.thickness_mm} onChange={(e) => onChange({ thickness_mm: e.target.value })} inputMode="decimal" placeholder="200" /></Field>
            <Field label="Densitet (kg/m³)"><Input value={row.density} onChange={(e) => onChange({ density: e.target.value })} inputMode="decimal" placeholder="t.ex. 45" /></Field>
          </>
        ) : (
          <Field label="Antal"><Input value={row.quantity} onChange={(e) => onChange({ quantity: e.target.value })} inputMode="decimal" placeholder="1" /></Field>
        )}
      </div>

      {/* Ekonomi: A-pris, (ROT-arbetskostnad), rabatt on one straight row. */}
      <div className={cn('grid gap-3', showLaborField ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        <Field label="A-pris">
          <Input
            value={row.auto_price ? String(metrics?.unit ?? row.article_price ?? '') : row.unit_price}
            onChange={(e) => onChange({ unit_price: e.target.value })}
            inputMode="decimal"
            placeholder="0"
            disabled={row.auto_price}
          />
        </Field>
        {/* Carve out the labour portion of a material row for ROT: the amount here is moved onto the
            separate "Arbetskostnad ROT" row and deducted from this row (total unchanged). */}
        {showLaborField ? (
          <Field label="Varav arbetskostnad (ROT, kr)">
            <Input value={row.labor_cost} onChange={(e) => onChange({ labor_cost: e.target.value })} inputMode="decimal" placeholder="0" />
          </Field>
        ) : null}
        <Field label="Rabatt %"><Input value={row.discount_percent} onChange={(e) => onChange({ discount_percent: e.target.value })} inputMode="decimal" placeholder="0" /></Field>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="inline-flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={!row.auto_price} onChange={(e) => onChange({ auto_price: !e.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300" />
          Manuellt pris
        </label>
        {rotEnabled ? (
          <label className="inline-flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={row.is_rot_work} onChange={(e) => onChange({ is_rot_work: e.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300" />
            ROT-arbete
          </label>
        ) : null}
        {rotEnabled && row.is_rot_work ? (
          <label className="inline-flex items-center gap-2 text-xs text-slate-500">
            Typ
            <Select value={row.house_work_type} onChange={(e) => onChange({ house_work_type: e.target.value })} className="h-8 py-0 text-xs">
              {ROT_HOUSE_WORK_TYPES.map((type) => (<option key={type} value={type}>{ROT_HOUSE_WORK_LABELS[type]}</option>))}
            </Select>
          </label>
        ) : null}
        {/* ml-auto MÅSTE sitta på summan, inte på märket: MarginBadge renderar null när
            inköpspriset saknas (61 av 289 artiklar, plus varje rad utan vald artikel), och då
            tappade beloppet sin högerställning och hoppade i sidled mellan raderna. */}
        <span className="ml-auto flex items-center gap-2 text-sm font-semibold tabular-nums text-slate-900">
          <MarginBadge marginPercent={marginPercent} />{formatCurrency(metrics?.rowTotal ?? 0, 'SEK')}
        </span>
      </div>

      <Field label="Radtext"><Input value={row.line_note} onChange={(e) => onChange({ line_note: e.target.value })} placeholder="Fritext för raden" /></Field>
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

  const [loading, setLoading] = useState(isEditing);
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
  const draftStorageKey = quoteId ? `crm:quote-draft:edit:${quoteId}` : 'crm:quote-draft:new';
  // This offer's own URL — used as returnTo when leaving to create/edit a customer.
  // Kundkortsresan kommer tillbaka hit, så returnTo måste följa med i adressen — annars är det
  // borta när säljaren väl sparar, och tavlan tappas efter en sväng förbi kunden.
  const offerSelfPath = isEditing ? `/crm/offerter/${quoteId}/redigera` : '/crm/offerter/ny';
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

  // Load quote for edit mode
  useEffect(() => {
    if (!quoteId) return;
    let active = true;
    setLoading(true);

    fetch(`/api/crm/quotes/${quoteId}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (!active) return;
        const item = json?.data?.item as QuoteItem | undefined;
        if (!item) { toast.error('Kunde inte ladda offert'); router.push(backTo); return; }
        // Locked: once a work order exists the offer is converted (and locked in Fortnox);
        // editing it would diverge the CRM quote from the created order. Bounce back — this
        // closes the direct-URL hole the detail card's hidden "Redigera" button left open.
        if (item.work_order_id || item.work_order_number) {
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
        setLoadedQuote(item);
        const loadedDraft: QuoteDraft = {
          customer_id: item.customer_id || null,
          prospect_id: item.prospect_id || '',
          quote_type: item.quote_type || 'business',
          customer_source: getDraftCustomerSource(item.customer_source, item.prospect_id),
          customer_name: item.customer_name || '',
          company_name: item.customer_snapshot?.company_name || '',
          organization_number: item.customer_snapshot?.organization_number || '',
          personal_number: item.customer_snapshot?.personal_number || '',
          contact_name: item.customer_snapshot?.contact_name || '',
          email: item.customer_snapshot?.email || '',
          phone: item.customer_snapshot?.phone || '',
          street_address: item.customer_snapshot?.street_address || '',
          postal_code: item.customer_snapshot?.postal_code || '',
          city: item.customer_snapshot?.city || '',
          visit_address: item.customer_snapshot?.visit_address || '',
          // A separate work address is stored only when it differs from the customer address,
          // so its presence directly drives the toggle (set just below).
          delivery_address: item.customer_snapshot?.delivery_address || '',
          delivery_postal_code: item.customer_snapshot?.delivery_postal_code || '',
          delivery_city: item.customer_snapshot?.delivery_city || '',
          invoice_address: item.customer_snapshot?.invoice_address || '',
          end_contact_name: item.customer_snapshot?.end_contact_name || '',
          end_contact_phone: item.customer_snapshot?.end_contact_phone || '',
          end_contact_email: item.customer_snapshot?.end_contact_email || '',
          label: item.customer_snapshot?.label || '',
          items: item.line_items?.length
            ? item.line_items.map((line) => ({ ...line, line_note: line.line_note || '', is_rot_work: line.is_rot_work ?? false, house_work_type: line.house_work_type || 'CONSTRUCTION', labor_cost: line.labor_cost || '', density: line.density || '', article_note: line.article_note ?? null }))
            : [createEmptyLineItem()],
          project_name: item.project_name,
          description: item.description || '',
          vat_percent: String(item.vat_percent ?? 25),
          valid_until: item.valid_until || '',
          rot_enabled: Boolean(item.rot_details?.enabled),
          rot_property_designation: item.rot_details?.property_designation || '',
          rot_percent: String(item.rot_details?.rot_percent ?? 30),
          rot_max_deduction: String(item.rot_details?.max_deduction ?? 50000),
          rot_brf_org_number: item.rot_details?.brf_org_number || '',
          desired_installation_date: item.internal_handoff?.desired_installation_date || '',
          handoff_notes: item.internal_handoff?.handoff_notes || '',
          work_scope: item.internal_handoff?.work_scope || '',
          status: item.status,
          quote_date: item.quote_date,
          follow_up_date: item.follow_up_date || '',
          notes: item.notes || '',
          create_follow_up_task: false,
          // Ligger med i loadedDraft och därmed i baslinjen nedan. Sätts den i stället av en
          // effekt efteråt blir en nyss öppnad offert omedelbart "ändrad", och det river
          // sönder utkastskyddet — samma fälla som måttblocket gick i (se kommentaren nedan).
          assigned_to: item.assigned_to || '',
        };
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
        // against it, so editing an untouched loaded offer isn't flagged dirty.
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
        if (item.customer_id) hydrateSelectedCustomer(item.customer_id, { seedApplied: true });
      })
      .catch(() => { if (active) { toast.error('Kunde inte ladda offert'); router.push(backTo); } })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId]);

  // Apply URL presets (create mode only)
  useEffect(() => {
    if (isEditing || !presetProspectId) return;
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
    if (baselineRef.current !== null || isEditing) return;
    baselineRef.current = JSON.stringify(initialDraft);
  }, [isEditing]);

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
      const baseUnit = item.auto_price
        ? computeUnitPrice(item.construction, parseDecimal(item.thickness_mm))
        : parseDecimal(item.unit_price);
      const mode = item.pricing_mode === 'item' ? 'item' : 'm3';
      const amount = lineItemQuantity(item);
      const discount = Math.min(100, Math.max(0, parseDecimal(item.discount_percent)));
      const effectiveUnit = Math.max(0, baseUnit * (1 - discount / 100));
      const constructionLabel = item.construction === 'vagg' ? 'Vägg' : item.construction === 'snedtak' ? 'Snedtak' : item.construction === 'vind' ? 'Vind' : '';
      const baseLabel = item.article_name ? `${item.article_name}${item.article_number ? ` (${item.article_number})` : ''}` : `${constructionLabel || 'Okänd'}${item.thickness_mm ? ` ${item.thickness_mm} mm` : ''}`;
      const unitSuffix = mode === 'm3' ? ' (m³)' : item.article_unit_name ? ` (${item.article_unit_name})` : '';
      return {
        ...item, amount, unit: baseUnit, effectiveUnit,
        label: `${baseLabel}${unitSuffix}`,
        mode, rowTotal: amount * effectiveUnit,
        isConfigured: Boolean(item.article_name || item.m2 || item.quantity || item.unit_price),
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
    // unflagged material row only its carved-out `labor_cost` (clamped to the row total). Mirrors
    // lib/domains/crm/pricing.ts and the Fortnox push (flagged rows + the "Arbetskostnad ROT" row).
    const rotActive = draft.quote_type === 'private' && draft.rot_enabled;
    const rotLaborBase = rotActive
      ? effectiveRows.reduce((sum, r) => {
          const base = r.is_rot_work ? r.rowTotal : Math.min(Math.max(0, parseDecimal(r.labor_cost)), r.rowTotal);
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
      ? effectiveRows.reduce((sum, r) => (r.is_rot_work ? sum : sum + Math.min(Math.max(0, parseDecimal(r.labor_cost)), r.rowTotal)), 0)
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
    if (!block) { toast.error('Inga m³-rader med ifyllda mått att hämta'); return; }
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
  };

  function scrollToField(fieldId: string) {
    document.getElementById(fieldId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      body: JSON.stringify({
        prospect_id: quote.prospect_id,
        title: `Följ upp offert: ${quote.project_name}`,
        details: quote.notes || quote.description || `Uppföljning för offert ${quote.project_name}`,
        priority: 'high',
        due_date: draft.follow_up_date,
        source: 'crm_quote',
        status: 'open',
      }),
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
      const firstFieldId = issueFieldIds[issues[0]];
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
  const marginRows: MarginRow[] = effectiveRows.map((r) => ({
    revenue: r.rowTotal,
    quantity: r.amount,
    purchasePrice: r.article_number ? purchasePrices[r.article_number] ?? null : null,
  }));
  const quoteMarginResult = quoteMargin(marginRows);
  const quoteMarginTier = marginTier(quoteMarginResult.marginPercent);

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
  const hasAnyLineItemInput = draft.items.some((item) => item.article_name || item.m2 || item.quantity || item.unit_price);

  const sidebarDisplayName = draft.quote_type === 'business'
    ? (draft.company_name || draft.customer_name)
    : draft.customer_name;
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

  // Single source of truth for the visible sections (in order). Drives both the
  // section header numbers and the sidebar nav so they can never drift apart.
  // `done: undefined` marks an internal section with no completion requirement.
  // Vilket val i giltighetstids-rullgardinen datumen motsvarar (null = eget datum). Härlett, inte
  // lagrat — se matchedValidityPreset i quoteSerializers.
  const validityPreset = matchedValidityPreset(draft.quote_date, draft.valid_until);


  const sections: { id: string; label: string; done?: boolean }[] = [
    { id: 'section-kund', label: 'Kund', done: Boolean(draft.quote_type === 'business' ? (draft.company_name || draft.customer_name) : draft.customer_name) },
    { id: 'section-offert', label: 'Offert', done: Boolean(draft.project_name.trim()) },
    { id: 'section-rader', label: 'Produkter & priser', done: hasAnyLineItemInput },
    // ROT-sektionen har inget eget krav för att offerten ska gå att spara: varken personnummer
    // eller fastighetsbeteckning efterfrågas förrän arbetsordern skapas. `done: undefined` håller
    // den utanför förloppsräknaren i stället för att visa den som evigt ofullständig.
    ...(draft.quote_type === 'private' && draft.rot_enabled
      ? [{ id: 'section-rot', label: 'ROT-avdrag' }]
      : []),
    { id: 'section-handoff', label: 'Intern handoff' },
    ...(isEditing && loadedQuote ? [{ id: 'section-arbetsorder', label: 'Arbetsorder' }] : []),
  ];
  const requiredSections = sections.filter((s) => s.done !== undefined);
  const doneSteps = requiredSections.filter((s) => s.done).length;
  const stepOf = (id: string) => sections.findIndex((s) => s.id === id) + 1;

  // Slås upp mot draften i stället för att lägga undan hela raden i state: raden kan redigeras
  // medan dialogen står öppen (den täcker inte formuläret på desktop), och en kopia hade då kunnat
  // visa ett artikelnamn som inte längre stämmer.
  const pendingRemoveRow = pendingRemoveRowId
    ? draft.items.find((item) => item.id === pendingRemoveRowId) ?? null
    : null;

  return (
    <div className="grid gap-6 pb-20 lg:pb-0">

      {/* ── Header (matches the customer page) ── */}
      <div>
        <button
          type="button"
          onClick={handleBack}
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {backTo.startsWith('/crm/saljtavla') ? 'Säljtavlan' : 'Offerter'}
        </button>
        <h1 className={crm.pageTitle}>
          {isEditing ? (draft.project_name || 'Redigera offert') : 'Ny offert'}
        </h1>
        <p className={cn('mt-0.5', crm.pageSubtitle)}>
          {isEditing ? 'Uppdatera offertens uppgifter och status.' : 'Fyll i uppgifterna nedan för att skapa en ny offert.'}
        </p>
      </div>

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

      {/* ── Two-column layout ── */}
      <div className="grid gap-5 lg:grid-cols-[1fr_304px] lg:items-start">

        {/* ── Left: form sections (each its own card) ── */}
        <div className="grid gap-5">

          {/* ── Section 1: Kund ── */}
          <div id="section-kund" className={cn('scroll-mt-6', crm.cardInner)}>
            <SectionHeader
              step={stepOf('section-kund')}
              title="Kund"
              action={
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                  {(['business', 'private'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, quote_type: type }))}
                      className={cn(
                        'rounded-md px-3.5 py-1.5 text-sm font-medium transition-all',
                        draft.quote_type === type
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700',
                      )}
                    >
                      {type === 'business' ? 'Företag' : 'Privat'}
                    </button>
                  ))}
                </div>
              }
            />

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
                  className="h-4 w-4 shrink-0 rounded border-slate-300 accent-emerald-600"
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
                  className="h-4 w-4 shrink-0 rounded border-slate-300 accent-emerald-600"
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
                  <p className="text-[11px] leading-snug text-slate-400">
                    Visas för installatören på arbetsordern och som notering på Fortnox-dokumenten. Ordergivaren står kvar som Er referens.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
          </div>

          {/* ── Section 2: Offert ── */}
          <div id="section-offert" className={cn('scroll-mt-6', crm.cardInner)}>
            <SectionHeader step={stepOf('section-offert')} title="Offert" />

          {isEditing && loadedQuote?.quote_number ? (
            <div className="mb-4">
              <Field label="Offertnummer">
                <Input value={loadedQuote.quote_number} disabled className="text-slate-400" />
              </Field>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <Field fieldId="field-project-name" label="Offertnamn / projekt" className="md:col-span-2" error={fieldErrors.project_name}>
              <Input value={draft.project_name} onChange={(e) => setDraft((d) => ({ ...d, project_name: e.target.value }))} placeholder="Ex. Takisolering villa Norrköping" />
            </Field>
            <Field fieldId="field-contact-name" label="Er referens (kontaktperson) *" className="md:col-span-2" error={fieldErrors.contact_name}>
              {/* Contact picker — for a customer with several contacts, choose which one is
                  responsible for this offer/order. Fills name/phone/email from the chosen
                  contact; the free-text field below still allows a manual override. */}
              {selectedCustomer && selectedCustomer.contacts.length > 0 ? (
                <Select
                  className="mb-2"
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
                value={draft.contact_name}
                onChange={(e) => setDraft((d) => ({ ...d, contact_name: e.target.value }))}
                placeholder="Ex. Birgitta Ling"
              />
              <p className="mt-1 text-[11px] leading-snug text-slate-400">
                Obligatoriskt. Personen hos kunden som offerten gäller. Förifylls från kundkortet men kan ändras per offert – visas som ”Er referens” på Fortnox-offerten och följer med till order och faktura.
              </p>
            </Field>
            {draft.quote_type === 'business' ? (
              <Field label="Märkning" className="md:col-span-2">
                <Input
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  placeholder="Ex. projekt-/beställningsnr hos kunden"
                />
                <p className="mt-1 text-[11px] leading-snug text-slate-400">
                  Valfri. Visas som ”Ert referensnummer” på Fortnox-offerten och följer med till order och faktura. (Motsvarar fastighetsbeteckningen för privat ROT-kund – samma fält.)
                </p>
              </Field>
            ) : null}
            {/* ROT toggle — only relevant for private customers. Lives here with the offer settings
                (private counterpart to the business-only "Märkning" above); enabling it reveals the
                ROT-avdrag section and the per-row "Varav arbetskostnad" field. */}
            {draft.quote_type === 'private' ? (
              <label className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 md:col-span-2">
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium text-slate-700">ROT-avdrag</span>
                  <span className="text-[11px] leading-snug text-slate-400">Slå på för ROT-uppgifter och för att bryta ut arbetskostnad på raderna.</span>
                </span>
                <input
                  type="checkbox"
                  checked={draft.rot_enabled}
                  onChange={(e) => setDraft((d) => ({ ...d, rot_enabled: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                />
              </label>
            ) : null}
            <Field label="Beskrivning" className="md:col-span-2">
              <Textarea value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} rows={3} placeholder="Kort om omfattning eller vad som offereras" />
            </Field>
            {/* Moms + de två datumen på EN rad. Sex kolumner i stället för tre jämna: momsfältet
                rymmer "25" och behöver inte en tredjedel av bredden, medan "Giltig till" bär två
                kontroller (giltighetstid + datum) och behöver halva. */}
            <div className="grid gap-4 sm:grid-cols-6 md:col-span-2">
              <Field label="Moms %" className="sm:col-span-1">
                <Input value={draft.vat_percent} onChange={(e) => setDraft((d) => ({ ...d, vat_percent: e.target.value }))} inputMode="decimal" placeholder="25" />
              </Field>
              <Field label="Offertdatum" plain className="sm:col-span-2">
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
              <Field label="Giltig till" plain className="sm:col-span-3">
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
              {/* Byggmoms-notisen står på egen rad under fälten, inte inuti momsfältet. Momskolumnen
                  är en sjättedel bred nu, och där hade texten radbrutits till en smal remsa som
                  drog upp höjden på hela raden. */}
              {/* ⚠️ The notice must reflect the OFFER, not just the customer card. It used to state
                  "moms sätts till 0 %" purely from the card, so an offer sitting at 25 % — a quote
                  written before the customer got reverse charge, or one where the refresh could not
                  tell an untouched field from an edited one — displayed a promise the saved document
                  did not keep. buildQuotePayload derives reverse_vat from vat_percent, so the draft
                  is what actually reaches Fortnox. */}
              {selectedCustomer?.reverse_vat ? (
                parseDecimal(draft.vat_percent) === 0 ? (
                  <p className="text-[11px] leading-snug text-amber-700 sm:col-span-6">
                    Kunden har <strong>omvänd skattskyldighet</strong> – moms sätts till 0 %. Köparen redovisar momsen själv.
                  </p>
                ) : (
                  <p className="text-[11px] leading-snug text-rose-700 sm:col-span-6">
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
          </div>

          {!isEditing ? (
            <label className="mt-4 flex items-start gap-3">
              <input
                type="checkbox"
                checked={draft.create_follow_up_task}
                onChange={(e) => setDraft((d) => ({ ...d, create_follow_up_task: e.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-500">Skapa uppföljningsuppgift automatiskt om ett uppföljningsdatum anges</span>
            </label>
          ) : null}
          </div>

          {/* ── Section 3: Rader ── */}
          <div id="section-rader" className={cn('scroll-mt-6', crm.cardInner)}>
            <SectionHeader step={stepOf('section-rader')} title="Produkter & priser" />

          {/* Totals bar */}
          {hasAnyLineItemInput ? (
            <div className="mb-6 flex items-center gap-8 rounded-xl bg-slate-50 px-5 py-4">
              <div className="grid gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Delsumma</span>
                <span className="text-sm font-semibold text-slate-900">{formatCurrency(totals.subtotal, 'SEK')}</span>
              </div>
              <div className="grid gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Moms ({vatPct} %)</span>
                <span className="text-sm font-semibold text-slate-900">{formatCurrency(totals.vat, 'SEK')}</span>
              </div>
              <div className="grid gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Rader</span>
                <span className="text-sm font-semibold text-slate-900">{configuredRows.length} st</span>
              </div>
              {/* Labour carved out of the material rows (each row's "Varav arbetskostnad"), which is
                  summed into one "Arbetskostnad ROT" row (art. 10058) on the Fortnox offer. Shown here
                  with the other line totals so all prices sit in one place. */}
              {totals.carvedLabor > 0 ? (
                <div className="grid gap-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Arbetskostnad ROT</span>
                  <span className="text-sm font-semibold text-emerald-700">{formatCurrency(totals.carvedLabor, 'SEK')}</span>
                </div>
              ) : null}
              {totals.rotDeduction > 0 ? (
                <div className="grid gap-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Avgår ROT</span>
                  <span className="text-sm font-semibold text-emerald-700">−{formatCurrency(totals.rotDeduction, 'SEK')}</span>
                </div>
              ) : null}
              <div className="ml-auto grid gap-0.5 text-right">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  {headlineLabel}
                </span>
                <span className="text-base font-bold text-slate-950">
                  {formatCurrency(headlineAmount ?? totals.total, 'SEK')}
                </span>
                {isPrivateQuote && totals.rotDeduction > 0 ? (
                  <span className="text-[11px] text-slate-400">Kund betalar efter ROT {formatCurrency(totals.toPay, 'SEK')}</span>
                ) : !isPrivateQuote ? (
                  <span className="text-[11px] text-slate-400">Inkl. moms {formatCurrency(totals.total, 'SEK')}</span>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mb-6 text-sm text-slate-400">
              Grundbelopp används om inga rader läggs till. Lägg till rader för att bygga offertens summering.
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
                purchasePrice={marginRows[index].purchasePrice ?? null}
                expanded={expandedRowId === row.id}
                onToggle={(next) => setExpandedRowId(next ? row.id : null)}
                onChange={(patch) => setDraft((d) => ({ ...d, items: d.items.map((item) => item.id === row.id ? { ...item, ...patch } : item) }))}
                onSelectArticle={(article) => {
                  const construction = inferConstructionFromArticle(article.name);
                  const unitName = getArticleUnitName(article.unit);
                  const normalizedUnit = unitName.trim().toLowerCase();
                  const pricingMode: 'm3' | 'item' = normalizedUnit === 'm3' || normalizedUnit === 'm³' || /m\s*³/i.test(normalizedUnit) ? 'm3' : 'item';
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

          {/* ── Section 4: ROT (toggled on via the sidebar) ── */}
          {draft.quote_type === 'private' && draft.rot_enabled ? (
            <div id="section-rot" className={cn('scroll-mt-6', crm.cardInner)}>
              <SectionHeader step={stepOf('section-rot')} title="ROT-avdrag" />
              {/* The ROT applicant is the selected customer – shown read-only, not entered. */}
              <div className={cn('mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3',
                draft.personal_number.trim() ? 'border-slate-200 bg-slate-50/60' : 'border-amber-200 bg-amber-50')}>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">ROT-sökande (kund)</p>
                  <p className="truncate text-sm font-medium text-slate-800">
                    {draft.customer_name.trim() || <span className="text-slate-400">Ingen kund vald</span>}
                    {draft.personal_number.trim() ? <span className="font-normal text-slate-500"> · {draft.personal_number}</span> : null}
                  </p>
                </div>
                {/* Upplysning, inte spärr. Offerten går att skicka utan numret — kunden vill
                    sällan lämna ut det innan hen tackat ja — och Fortnox räknar ut och visar
                    skattereduktionen på offerten ändå (uppmätt: 4 875 kr på en offert vars
                    husarbetespost saknade personnummer). Det numret avgör är om avdraget kan
                    knytas till en person, vilket krävs först vid fakturering. Därför efterfrågas
                    det när arbetsordern skapas. */}
                {!draft.personal_number.trim() ? (
                  <span className="text-xs font-medium text-amber-700">Personnummer saknas – behövs inte för offerten, men efterfrågas när arbetsordern skapas.</span>
                ) : null}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field fieldId="field-rot-property" label="Fastighetsbeteckning" className="md:col-span-2" error={fieldErrors.rot_property_designation}>
                  <Input value={draft.rot_property_designation} onChange={(e) => setDraft((d) => ({ ...d, rot_property_designation: e.target.value }))} placeholder="Fastighetsbeteckning" />
                </Field>
                <Field label="Skattereduktion %">
                  <Input value={draft.rot_percent} onChange={(e) => setDraft((d) => ({ ...d, rot_percent: e.target.value }))} inputMode="decimal" placeholder="30" />
                </Field>
                <Field label="Max. avdrag">
                  <Input value={draft.rot_max_deduction} onChange={(e) => setDraft((d) => ({ ...d, rot_max_deduction: e.target.value }))} inputMode="decimal" placeholder="50000" />
                </Field>
                <Field label="BRF org.nr" className="md:col-span-2">
                  <Input value={draft.rot_brf_org_number} onChange={(e) => setDraft((d) => ({ ...d, rot_brf_org_number: e.target.value }))} placeholder="Om bostadsrätt" />
                </Field>
              </div>
              {/* The percent above only drives the offer's preliminary "Att betala". Fortnox
                  computes the actual ROT reduction with its own configured rate when the
                  invoice is created (we send the per-row ROT flag, not an amount), so a value
                  other than Fortnox's rate would make the quoted figure differ from the bill. */}
              <p className="text-xs text-slate-500">
                Skattereduktionen ovan är preliminär. Det slutliga ROT-avdraget beräknas av Fortnox/Skatteverket vid fakturering.
              </p>
            </div>
          ) : null}

          {/* ── Section 5: Intern handoff ── */}
          <div id="section-handoff" className={cn('scroll-mt-6', crm.cardInner)}>
            <SectionHeader step={stepOf('section-handoff')} title="Intern handoff" muted />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Önskat installationsdatum" plain>
                <DatePicker value={draft.desired_installation_date} onChange={(v) => setDraft((d) => ({ ...d, desired_installation_date: v }))} placeholder="Inget datum satt" aria-label="Önskat installationsdatum" />
              </Field>
              <Field label="Arbetets scope">
                <Input value={draft.work_scope} onChange={(e) => setDraft((d) => ({ ...d, work_scope: e.target.value }))} placeholder="Kort operativt scope" />
              </Field>
              <div className="grid gap-1.5 md:col-span-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-600">Arbetsbeskrivning</span>
                  <button
                    type="button"
                    onClick={addMeasurementsToHandoff}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                  >
                    Hämta mått från rader
                  </button>
                </div>
                <Textarea value={draft.handoff_notes} onChange={(e) => setDraft((d) => ({ ...d, handoff_notes: e.target.value }))} rows={3} placeholder="Arbetsbeskrivning för installatör / arbetsorder" />
                {/* Utan den här raden fryser blocket tyst: säljaren ändrar en tjocklek, ser
                    beskrivningen stå kvar på gamla mått, och den siffran följer med till
                    arbetsordern där knappen inte finns. Låsningen måste synas. */}
                {measurementBlockLocked ? (
                  <p className="text-[11px] leading-snug text-amber-700">
                    Måtten uppdateras inte längre automatiskt — du har ändrat i måttblocket. Klicka ”Hämta mått från rader” för att hämta om dem från raderna.
                  </p>
                ) : (
                  <p className="text-[11px] leading-snug text-slate-400">
                    Måtten från artikelraderna fylls i automatiskt och hålls uppdaterade. Text du skriver själv står kvar under dem.
                  </p>
                )}
              </div>
              <Field label="Interna anteckningar" className="md:col-span-2">
                <Textarea value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} rows={4} placeholder="Det här ska vi komma ihåg inför uppföljningen" />
              </Field>
            </div>
          </div>

          {/* ── Section 6: Arbetsorder (edit mode) ── */}
          {isEditing && loadedQuote ? (
            <div id="section-arbetsorder" className={cn('scroll-mt-6', crm.cardInner)}>
              <SectionHeader step={stepOf('section-arbetsorder')} title="Arbetsorder" muted className="mb-4" />
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 px-5 py-4">
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
                  className="mt-3"
                  blockers={readiness.blockers}
                  warnings={readiness.warnings}
                  onOpenCustomerCard={
                    loadedQuote.customer_id ? () => goToCustomerPage(`/crm/kunder/${loadedQuote.customer_id}`) : null
                  }
                  onRecheck={readiness.blockers.length > 0 ? () => { setRechecking(true); setReadinessNonce((n) => n + 1); } : null}
                  rechecking={rechecking}
                />
              ) : null}
            </div>
          ) : null}

        </div>{/* end left column */}

        {/* ── Right: sticky sidebar ── */}
        <aside className="self-start lg:sticky lg:top-6">

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

            {/* Section nav — desktop only. A jump list is redundant on mobile (you
                just scroll) and, kept always-open, it ate most of the small viewport. */}
            <nav className="hidden lg:block">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Sektioner</span>
                <span className="text-[11px] font-medium text-slate-400">{doneSteps}/{requiredSections.length} klara</span>
              </div>
              <div className="grid gap-1">
                {sections.map((section, i) => (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => scrollToSection(section.id)}
                    className="group flex w-full items-center gap-2.5 rounded-lg border border-slate-100 bg-white px-2.5 py-2 text-left text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                        section.done === true
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                          : section.done === false
                            ? 'border-slate-200 text-slate-400'
                            : 'border-transparent bg-slate-100 text-slate-400',
                      )}
                    >
                      {section.done === true ? '✓' : i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{section.label}</span>
                    <svg
                      className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500"
                      width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
                    >
                      <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                ))}
              </div>
            </nav>

            {/* Divider — hidden on mobile together with the section nav above */}
            <div className="my-5 hidden border-t border-slate-100 lg:block" />

            {/* Summary: projekt + kund + total */}
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Projekt</span>
                  <p className="truncate text-sm font-semibold leading-5 text-slate-900">
                    {draft.project_name || <span className="text-slate-300">—</span>}
                  </p>
                </div>
                <div className="grid gap-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Kund</span>
                  <p className="truncate text-sm text-slate-700">
                    {sidebarDisplayName || <span className="text-slate-300">—</span>}
                  </p>
                </div>
              </div>

              {/* Summering — full breakdown (delsumma → moms → total → ROT → att betala) */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3.5">
                {hasAnyLineItemInput && totals.subtotal > 0 ? (
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Delsumma</span>
                      <span className="tabular-nums">{formatCurrency(totals.subtotal, 'SEK')}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Moms ({vatPct} %)</span>
                      <span className="tabular-nums">{formatCurrency(totals.vat, 'SEK')}</span>
                    </div>
                    <div className="mt-1 flex items-end justify-between border-t border-slate-200/70 pt-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                        {headlineLabel}
                      </span>
                      <span className="text-2xl font-bold tracking-tight text-slate-950 tabular-nums">
                        {formatCurrency(headlineAmount ?? totals.total, 'SEK')}
                      </span>
                    </div>
                    {totals.rotDeduction > 0 ? (
                      <>
                        <div className="flex items-center justify-between text-xs font-medium text-emerald-700">
                          <span>Avgår ROT</span>
                          <span className="tabular-nums">−{formatCurrency(totals.rotDeduction, 'SEK')}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>Kund betalar efter ROT-avdrag</span>
                          <span className="tabular-nums">{formatCurrency(totals.toPay, 'SEK')}</span>
                        </div>
                      </>
                    ) : null}

                    {/* Offertens samlade täckningsgrad. Viktad på belopp — se quoteMargin; ett
                        ovägt snitt av radernas procent hade låtit en småpostrad väga lika tungt
                        som huvudposten. Visas bara när minst en rad går att bedöma.

                        Ingen ram — raderna ovanför separeras med luft, så den här gör likadant. */}
                    {quoteMarginResult.marginPercent != null ? (
                      <div className="mt-2.5 grid gap-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">Täckningsgrad</span>
                          <MarginBadge marginPercent={quoteMarginResult.marginPercent} />
                        </div>
                        {quoteMarginResult.unpricedRows > 0 ? (
                          // Utan den här upplysningen ser TG:n ut att gälla hela offerten, och en
                          // grön siffra kan dölja att halva beloppet aldrig bedömdes.
                          <p className="m-0 text-[11px] leading-snug text-slate-400">
                            {quoteMarginResult.unpricedRows} {quoteMarginResult.unpricedRows === 1 ? 'rad' : 'rader'} saknar
                            inköpspris ({formatCurrency(quoteMarginResult.unpricedRevenue, 'SEK')}) och ingår inte i siffran.
                          </p>
                        ) : null}
                        {quoteMarginTier === 'bad' ? (
                          <p className="m-0 rounded-md border border-solid border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] font-medium leading-snug text-rose-700">
                            Täckningsgraden är under {MARGIN_THRESHOLDS.watch} %. Offerten behöver godkännas av säljchef innan den skickas.
                          </p>
                        ) : quoteMarginTier === 'watch' ? (
                          <p className="m-0 text-[11px] leading-snug text-amber-700">
                            Grönt kräver över {MARGIN_THRESHOLDS.good} % — se över priset innan du skickar.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{headlineLabel}</span>
                    <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
                      {headlineAmount != null && Number.isFinite(headlineAmount)
                        ? formatCurrency(headlineAmount, 'SEK')
                        : <span className="text-xl text-slate-300">—</span>}
                    </p>
                    {headlineAmount != null && Number.isFinite(headlineAmount) && summaryVat != null && summaryTotal != null ? (
                      <p className="mt-1 text-[11px] text-slate-400">
                        {isPrivateQuote
                          ? `Varav moms (${vatPct} %) ${formatCurrency(summaryVat, 'SEK')}`
                          : `Inkl. moms ${formatCurrency(summaryTotal, 'SEK')} (moms ${vatPct} %)`}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="my-5 border-t border-slate-100" />

            {/* Settings: status + follow-up + ROT */}
            <div className="grid gap-4">
              <Field label="Status">
                <Select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as QuoteItem['status'] }))}>
                  {Object.entries(quoteStatusMeta).map(([value, meta]) => (
                    <option key={value} value={value}>{meta.label}</option>
                  ))}
                </Select>
              </Field>

              <Field label="Följ upp senast" plain>
                <DatePicker value={draft.follow_up_date} onChange={(v) => setDraft((d) => ({ ...d, follow_up_date: v }))} placeholder="Inget datum" aria-label="Följ upp senast" />
              </Field>

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
                  <p className="mt-1.5 text-xs text-slate-500">
                    Säljaren offerten tillhör. Blir kundansvarig när offerten vinns, och står som
                    Vår referens på offerten i Fortnox.
                  </p>
                </Field>
              ) : draft.assigned_to && sellersLoaded ? (
                <Field label="Ansvarig säljare" plain>
                  <p className="text-sm text-slate-700">
                    {sellers.find((seller) => seller.id === draft.assigned_to)?.full_name || 'Okänd säljare'}
                  </p>
                </Field>
              ) : null}
            </div>

            {/* Divider */}
            <div className="my-5 border-t border-slate-100" />

            {/* Validation status */}
            {isReady ? (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm font-semibold text-emerald-800">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Redo att spara
              </div>
            ) : (
              <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
                <div className="mb-2 flex items-center gap-2 text-amber-900">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
                    <path d="M8 1.8 15 14H1L8 1.8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                    <path d="M8 6.2v3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="8" cy="11.8" r="0.85" fill="currentColor" />
                  </svg>
                  <span className="text-xs font-bold uppercase tracking-[0.08em]">{issues.length} att åtgärda</span>
                </div>
                <div className="grid gap-0.5">
                  {issues.map((issue) => {
                    const targetId = issueFieldIds[issue];
                    return (
                      <button
                        key={issue}
                        type="button"
                        onClick={() => targetId && scrollToField(targetId)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-amber-900 transition',
                          targetId ? 'cursor-pointer hover:bg-amber-100' : 'cursor-default',
                        )}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                        <span className="min-w-0 flex-1">{issue}</span>
                        {targetId ? <span className="shrink-0 text-[11px] text-amber-500">↑</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={saveQuote}
              disabled={submitting || !isReady}
              className={crm.saveButton}
            >
              {submitting ? 'Sparar…' : isEditing ? 'Spara offert' : 'Skapa offert'}
            </button>
            <button
              type="button"
              onClick={handleBack}
              className="mt-2.5 w-full text-center text-sm text-slate-400 transition-colors hover:text-slate-700"
            >
              Avbryt
            </button>

          </div>

        </aside>

        </div>{/* end two-column grid */}

      {/* ── Mobile sticky action bar (sidebar handles this on lg+) ── */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{headlineLabel}</p>
          <p className="truncate text-base font-bold text-slate-950">
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
                onChange={(e) => setDraft((d) => ({ ...d, rot_property_designation: e.target.value }))}
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

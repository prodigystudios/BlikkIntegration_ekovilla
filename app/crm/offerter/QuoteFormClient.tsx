"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { parseDecimal } from '@/lib/shared/number';
import { crm } from '@/app/crm/lib/crmTokens';
import {
  getEffectiveCustomerName,
  buildCustomerSnapshot,
  buildRotDetails,
  buildInternalHandoff,
} from './quoteSerializers';

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
  article_price: number | null;
  article_unit_name: string | null;
  discount_percent: string;
  line_note: string;
  is_rot_work: boolean;
};

type QuoteItem = {
  id: string;
  quote_number: string | null;
  prospect_id: string | null;
  opportunity_id: string | null;
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
    invoice_address?: string | null;
  } | null;
  pricing_summary: { subtotal?: number; vat?: number; total?: number } | null;
  line_items: QuoteLineItem[] | null;
  rot_details: {
    enabled?: boolean;
    applicant_name?: string | null;
    personal_number?: string | null;
    property_designation?: string | null;
    rot_percent?: number;
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
};

type QuoteDraft = {
  customer_id: string | null;
  prospect_id: string;
  opportunity_id: string;
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
  invoice_address: string;
  items: QuoteLineItem[];
  project_name: string;
  description: string;
  amount: string;
  vat_percent: string;
  valid_until: string;
  rot_enabled: boolean;
  rot_applicant_name: string;
  rot_personal_number: string;
  rot_property_designation: string;
  rot_percent: string;
  desired_installation_date: string;
  handoff_notes: string;
  work_scope: string;
  status: QuoteItem['status'];
  quote_date: string;
  follow_up_date: string;
  notes: string;
  create_follow_up_task: boolean;
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
  visit_address: { street: string | null; postal_code: string | null; city: string | null } | null;
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
    article_price: null,
    article_unit_name: null,
    discount_percent: '',
    line_note: '',
    is_rot_work: false,
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
  if (!draft.prospect_id && !draft.opportunity_id && !effectiveCustomerName) issues.push('Kund måste anges');
  if (draft.customer_source.kind === 'prospect' && !draft.prospect_id) issues.push('Prospektkälla kräver valt prospekt');
  if (draft.customer_source.kind === 'fortnox' && !draft.customer_source.fortnox_customer_name.trim()) issues.push('Fortnox-kund behöver kundreferens');
  if (draft.quote_type === 'private' && !draft.personal_number.trim()) issues.push('Personnummer krävs');
  if (draft.quote_type === 'business' && !draft.company_name.trim() && !draft.customer_name.trim()) issues.push('Företagsnamn krävs');
  if (draft.quote_type === 'business' && draft.rot_enabled) issues.push('ROT är bara tillåtet för privatkund');
  if (draft.quote_type === 'private' && draft.rot_enabled) {
    if (!draft.rot_personal_number.trim()) issues.push('ROT kräver personnummer för sökande');
    if (!draft.rot_property_designation.trim()) issues.push('ROT kräver fastighetsbeteckning');
  }
  if (!draft.amount.trim() || parseDecimal(draft.amount) < 0) {
    if (!hasAnyLineItemInput) issues.push('Ange belopp eller lägg till rader');
  }
  if (hasAnyLineItemInput) {
    const hasInvalidRow = effectiveRows.some((item) => item.isConfigured && (!(item.amount > 0) || !(item.effectiveUnit >= 0)));
    if (hasInvalidRow) issues.push('Ofullständiga rader — mängd och pris krävs');
  }
  return issues;
}

const initialDraft: QuoteDraft = {
  customer_id: null,
  prospect_id: '',
  opportunity_id: '',
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
  invoice_address: '',
  items: [createEmptyLineItem()],
  project_name: '',
  description: '',
  amount: '',
  vat_percent: '25',
  valid_until: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
  rot_enabled: false,
  rot_applicant_name: '',
  rot_personal_number: '',
  rot_property_designation: '',
  rot_percent: '30',
  desired_installation_date: '',
  handoff_notes: '',
  work_scope: '',
  status: 'draft',
  quote_date: new Date().toISOString().slice(0, 10),
  follow_up_date: '',
  notes: '',
  create_follow_up_task: true,
};

// ─── ArticlePicker ────────────────────────────────────────────────────────────

function ArticlePicker({ value, onSelect, onClear }: { value: string; onSelect: (article: ArticleLite) => void; onClear: () => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ArticleLite[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || query.trim().length < 2) { setItems([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/fortnox/articles?q=${encodeURIComponent(query)}&limit=10`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (!cancelled) {
          const raw: Array<{ article_number: string; description: string | null; sales_price: number | null; unit: string | null }> =
            Array.isArray(json?.data?.items) ? json.data.items : [];
          setItems(raw.map((a) => ({
            id: a.article_number,
            name: a.description ?? undefined,
            articleNumber: a.article_number,
            price: a.sales_price,
            unit: a.unit ?? undefined,
          })));
        }
      })
      .catch(() => { if (!cancelled) { setError('Kunde inte hämta artiklar'); setItems([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, query]);

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={value || 'Sök artikel…'}
        />
        {value ? (
          <button type="button" onClick={onClear} className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 hover:border-slate-300 transition-colors">
            Rensa
          </button>
        ) : null}
      </div>
      {open && query.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_16px_32px_rgba(15,23,42,0.10)]">
          {loading ? <div className="px-4 py-3 text-sm text-slate-400">Söker…</div> : null}
          {error ? <div className="px-4 py-3 text-sm text-rose-600">{error}</div> : null}
          {!loading && !error && items.length === 0 ? <div className="px-4 py-3 text-sm text-slate-400">Inga artiklar hittades.</div> : null}
          {!loading && !error ? items.map((item) => (
            <button
              key={item.id || item.articleNumber || item.name}
              type="button"
              onClick={() => { onSelect(item); setOpen(false); setQuery(''); }}
              className="grid w-full gap-0.5 border-b border-slate-100 px-4 py-2.5 text-left transition last:border-b-0 hover:bg-slate-50"
            >
              <span className="text-sm font-medium text-slate-900">{item.name || 'Artikel'}</span>
              <span className="text-xs text-slate-400">
                {item.articleNumber || 'Utan artikelnummer'}
                {typeof item.price === 'number' ? ` · ${item.price.toFixed(2)} kr` : ''}
                {getArticleUnitName(item.unit) ? ` · ${getArticleUnitName(item.unit)}` : ''}
              </span>
            </button>
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
    if (query.trim().length < 2) { setResults([]); setOpen(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/crm/customers?q=${encodeURIComponent(query.trim())}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        setResults(Array.isArray(json?.data?.items) ? json.data.items : []);
        setOpen(true);
      } catch { setResults([]); } finally { setLoading(false); }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

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
        onFocus={() => query.trim().length >= 2 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Sök kund i register (namn, org.nr)…"
      />
      {loading ? <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Söker…</span> : null}
      {open && query.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_16px_32px_rgba(15,23,42,0.10)]">
          {results.length > 0 ? results.map((customer) => {
            const name = customer.customer_type === 'business'
              ? (customer.company_name || 'Okänt företag')
              : `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Okänd kund';
            const primary = customer.contacts.find((c) => c.is_primary) || customer.contacts[0] || null;
            return (
              <button
                key={customer.id}
                type="button"
                onMouseDown={() => { onSelect(customer); setQuery(''); setOpen(false); }}
                className="grid w-full gap-0.5 border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-slate-50"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{name}</span>
                  {customer.fortnox_customer_id ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">Fortnox</span> : null}
                </div>
                <span className="text-xs text-slate-400">
                  {[customer.organization_number, customer.visit_address?.city, primary?.phone].filter(Boolean).join(' · ')}
                </span>
              </button>
            );
          }) : (
            <div className="grid gap-2 px-4 py-3">
              <p className="text-sm text-slate-500">Ingen kund hittades för <strong>{query}</strong></p>
              <button
                type="button"
                onMouseDown={onCreateNew}
                className="w-fit rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
              >
                + Skapa ny kund
              </button>
            </div>
          )}
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
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  error?: string | null;
  fieldId?: string;
}) {
  return (
    <div className={cn('grid gap-1.5', className)} id={fieldId}>
      <label className="grid gap-1.5">
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        {children}
      </label>
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

function LineItemRow({
  row,
  index,
  metrics,
  rotEnabled,
  onChange,
  onSelectArticle,
  onClearArticle,
  onRemove,
}: {
  row: QuoteLineItem;
  index: number;
  metrics: EffectiveRow | undefined;
  rotEnabled: boolean;
  onChange: (patch: Partial<QuoteLineItem>) => void;
  onSelectArticle: (article: ArticleLite) => void;
  onClearArticle: () => void;
  onRemove: () => void;
}) {
  const isM3 = (row.pricing_mode ?? 'm3') === 'm3';

  return (
    <div className="grid gap-4 rounded-xl border border-slate-100 p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400">Rad {index + 1}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-slate-400 transition-colors hover:text-rose-600"
        >
          Ta bort
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Artikel" className="md:col-span-2">
          <ArticlePicker value={row.article_name || ''} onSelect={onSelectArticle} onClear={onClearArticle} />
        </Field>
        {row.article_name ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 md:col-span-2">
            {row.article_name}{row.article_number ? ` · ${row.article_number}` : ''}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        {isM3 ? (
          <>
            <Field label="m²">
              <Input value={row.m2} onChange={(e) => onChange({ m2: e.target.value })} inputMode="decimal" placeholder="0" />
            </Field>
            <Field label="Tjocklek mm">
              <Input value={row.thickness_mm} onChange={(e) => onChange({ thickness_mm: e.target.value })} inputMode="decimal" placeholder="200" />
            </Field>
          </>
        ) : (
          <Field label="Antal">
            <Input value={row.quantity} onChange={(e) => onChange({ quantity: e.target.value })} inputMode="decimal" placeholder="1" />
          </Field>
        )}
        <Field label="A-pris">
          <Input
            value={row.auto_price ? String(metrics?.unit ?? row.article_price ?? '') : row.unit_price}
            onChange={(e) => onChange({ unit_price: e.target.value })}
            inputMode="decimal"
            placeholder="0"
            disabled={row.auto_price}
          />
        </Field>
        <Field label="Rabatt %">
          <Input value={row.discount_percent} onChange={(e) => onChange({ discount_percent: e.target.value })} inputMode="decimal" placeholder="0" />
        </Field>
      </div>

      <div className="flex items-center gap-4">
        <label className="inline-flex items-center gap-2 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={!row.auto_price}
            onChange={(e) => onChange({ auto_price: !e.target.checked })}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Manuellt pris
        </label>
        {rotEnabled ? (
          <label className="inline-flex items-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={row.is_rot_work}
              onChange={(e) => onChange({ is_rot_work: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-slate-300"
            />
            ROT-arbete
          </label>
        ) : null}
      </div>

      <Field label="Radtext">
        <Input value={row.line_note} onChange={(e) => onChange({ line_note: e.target.value })} placeholder="Fritext för raden" />
      </Field>

      {metrics?.isConfigured ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span>{metrics.label}</span>
          <span>Mängd {metrics.amount.toFixed(2)}</span>
          <span>A-pris {formatCurrency(metrics.effectiveUnit, 'SEK')}</span>
          <span className="ml-auto font-semibold text-slate-900">Radsumma {formatCurrency(metrics.rowTotal, 'SEK')}</span>
        </div>
      ) : null}
    </div>
  );
}

// ─── QuoteFormClient ──────────────────────────────────────────────────────────

// How long a stashed draft survives the "create customer" round-trip before it's
// considered stale and ignored.
const DRAFT_TTL_MS = 30 * 60 * 1000;

export default function QuoteFormClient({ quoteId }: { quoteId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const isEditing = Boolean(quoteId);

  const [loading, setLoading] = useState(isEditing);
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [creatingWorkOrder, setCreatingWorkOrder] = useState(false);
  const [draft, setDraft] = useState<QuoteDraft>(initialDraft);
  const [loadedQuote, setLoadedQuote] = useState<QuoteItem | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CrmCustomerLite | null>(null);
  const restoredRef = useRef(false);

  const presetProspectId = searchParams.get('prospect_id') || '';
  const presetOpportunityId = searchParams.get('opportunity_id') || '';

  // Per-form storage key so a new-quote draft never collides with an edit draft.
  const draftStorageKey = quoteId ? `crm:quote-draft:edit:${quoteId}` : 'crm:quote-draft:new';
  // This offer's own URL — used as returnTo when leaving to create/edit a customer.
  const offerSelfUrl = isEditing ? `/crm/offerter/${quoteId}/redigera` : '/crm/offerter/ny';

  // Stash the draft and leave to a customer page; we return via returnTo.
  function goToCustomerPage(path: string) {
    persistDraft();
    router.push(`${path}?returnTo=${encodeURIComponent(offerSelfUrl)}`);
  }

  function persistDraft() {
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify({ version: 1, savedAt: Date.now(), quoteId: quoteId ?? null, draft }));
    } catch { /* localStorage unavailable — ignore */ }
  }

  function clearPersistedDraft() {
    try { localStorage.removeItem(draftStorageKey); } catch { /* ignore */ }
  }

  // Populate the draft from a chosen customer. Shared by the search picker and the
  // post-create round-trip so both paths fill identical fields.
  function applySelectedCustomer(customer: CrmCustomerLite) {
    setSelectedCustomer(customer);
    const primary = customer.contacts.find((c) => c.is_primary) || customer.contacts[0] || null;
    setDraft((current) => ({
      ...current,
      customer_id: customer.id,
      quote_type: customer.customer_type,
      customer_source: buildCustomerSource(customer),
      company_name: customer.company_name || '',
      customer_name: customer.company_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
      organization_number: customer.organization_number || '',
      personal_number: customer.personal_number || '',
      contact_name: primary?.name || '',
      phone: primary?.phone || '',
      email: primary?.email || '',
      street_address: customer.visit_address?.street || '',
      postal_code: customer.visit_address?.postal_code || '',
      city: customer.visit_address?.city || '',
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
        if (!item) { toast.error('Kunde inte ladda offert'); router.push('/crm/offerter'); return; }
        setLoadedQuote(item);
        setDraft({
          customer_id: item.customer_id || null,
          prospect_id: item.prospect_id || '',
          opportunity_id: item.opportunity_id || '',
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
          delivery_address: item.customer_snapshot?.delivery_address || '',
          invoice_address: item.customer_snapshot?.invoice_address || '',
          items: item.line_items?.length
            ? item.line_items.map((line) => ({ ...line, line_note: line.line_note || '', is_rot_work: line.is_rot_work ?? false }))
            : [createEmptyLineItem()],
          project_name: item.project_name,
          description: item.description || '',
          amount: String(item.amount ?? ''),
          vat_percent: String(item.vat_percent ?? 25),
          valid_until: item.valid_until || '',
          rot_enabled: Boolean(item.rot_details?.enabled),
          rot_applicant_name: item.rot_details?.applicant_name || '',
          rot_personal_number: item.rot_details?.personal_number || '',
          rot_property_designation: item.rot_details?.property_designation || '',
          rot_percent: String(item.rot_details?.rot_percent ?? 30),
          desired_installation_date: item.internal_handoff?.desired_installation_date || '',
          handoff_notes: item.internal_handoff?.handoff_notes || '',
          work_scope: item.internal_handoff?.work_scope || '',
          status: item.status,
          quote_date: item.quote_date,
          follow_up_date: item.follow_up_date || '',
          notes: item.notes || '',
          create_follow_up_task: false,
        });
      })
      .catch(() => { if (active) { toast.error('Kunde inte ladda offert'); router.push('/crm/offerter'); } })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId]);

  // Apply URL presets (create mode only)
  useEffect(() => {
    if (isEditing || (!presetProspectId && !presetOpportunityId)) return;

    if (presetOpportunityId) {
      fetch(`/api/crm/opportunities/${presetOpportunityId}`, { cache: 'no-store' })
        .then((r) => r.json().catch(() => ({})))
        .then((json) => {
          const opportunity = json?.data?.item;
          const prospect = opportunity?.prospect || null;
          setDraft((current) => ({
            ...current,
            opportunity_id: presetOpportunityId,
            prospect_id: prospect?.id || '',
            customer_source: getDefaultDraftCustomerSource(prospect?.id || null),
            customer_name: prospect?.company_name || opportunity?.title || '',
            company_name: prospect?.company_name || '',
            contact_name: prospect?.contact_name || '',
            city: prospect?.city || '',
            project_name: opportunity?.title || current.project_name,
          }));
        })
        .catch(() => {
          setDraft((current) => ({ ...current, opportunity_id: presetOpportunityId }));
        });
      return;
    }

    if (presetProspectId) {
      setDraft((current) => ({
        ...current,
        prospect_id: presetProspectId,
        customer_source: getDefaultDraftCustomerSource(presetProspectId),
      }));
    }
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

    // Restore the draft we stashed before navigating away (new quotes only — in edit
    // mode the loaded quote stays and only the customer is swapped in below).
    if (!isEditing) {
      try {
        const raw = localStorage.getItem(draftStorageKey);
        if (raw) {
          const envelope = JSON.parse(raw);
          const fresh = envelope && typeof envelope.savedAt === 'number'
            && Date.now() - envelope.savedAt < DRAFT_TTL_MS && envelope.draft;
          if (fresh) {
            setDraft(envelope.draft);
          }
        }
      } catch { /* ignore malformed draft */ }
    }
    clearPersistedDraft();

    // Only auto-select when a customer was actually created (save path, not cancel).
    if (createdCustomerId) {
      fetch(`/api/crm/customers/${createdCustomerId}`, { cache: 'no-store' })
        .then((r) => r.json().catch(() => ({})))
        .then((json) => {
          if (json?.ok && json?.data?.item) applySelectedCustomer(json.data.item as CrmCustomerLite);
          else toast.error('Kunde inte hämta vald kund');
        })
        .catch(() => toast.error('Kunde inte hämta vald kund'));
    }

    // Strip the param so a refresh doesn't re-run this.
    router.replace(offerSelfUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const effectiveRows = useMemo<EffectiveRow[]>(() => {
    return draft.items.map((item) => {
      const baseUnit = item.auto_price
        ? computeUnitPrice(item.construction, parseDecimal(item.thickness_mm))
        : parseDecimal(item.unit_price);
      const mode = item.pricing_mode === 'item' ? 'item' : 'm3';
      const m2 = parseDecimal(item.m2);
      const thicknessM = parseDecimal(item.thickness_mm) / 1000;
      const volume = Math.max(0, m2 * thicknessM);
      const quantity = parseDecimal(item.quantity);
      const amount = mode === 'm3' ? volume : quantity;
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
    return { subtotal, vat, total: subtotal + vat };
  }, [draft.vat_percent, effectiveRows]);

  const issues = useMemo(() => getValidationIssues(draft, effectiveRows), [draft, effectiveRows]);
  const isReady = issues.length === 0;

  const fieldErrors = useMemo(() => {
    if (!submitAttempted) return {} as Record<string, string>;
    const hasAnyRows = draft.items.some((item) => item.article_name || item.m2 || item.quantity || item.unit_price);
    const effectiveCustomerName = getEffectiveCustomerName(draft);
    const errs: Record<string, string> = {};
    if (!draft.project_name.trim()) errs.project_name = 'Offertnamn saknas';
    if (!draft.prospect_id && !draft.opportunity_id && !effectiveCustomerName) {
      errs.company_name = 'Kund måste anges';
      errs.customer_name = 'Kund måste anges';
    }
    if (draft.quote_type === 'business' && !draft.company_name.trim() && !draft.customer_name.trim()) {
      errs.company_name = 'Företagsnamn krävs';
    }
    if (draft.quote_type === 'private' && !draft.personal_number.trim()) {
      errs.personal_number = 'Personnummer krävs';
    }
    if (!draft.amount.trim() && !hasAnyRows) errs.amount = 'Ange belopp eller lägg till rader';
    if (draft.quote_type === 'private' && draft.rot_enabled && !draft.rot_personal_number.trim()) {
      errs.rot_personal_number = 'ROT kräver personnummer för sökande';
    }
    if (draft.quote_type === 'private' && draft.rot_enabled && !draft.rot_property_designation.trim()) {
      errs.rot_property_designation = 'ROT kräver fastighetsbeteckning';
    }
    return errs;
  }, [submitAttempted, draft, effectiveRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Map validation issues to field IDs for scroll-to
  const issueFieldIds: Record<string, string> = {
    'Kund måste anges': 'section-kund',
    'Företagsnamn krävs': 'section-kund',
    'Personnummer krävs': 'section-kund',
    'Offertnamn saknas': 'field-project-name',
    'Ange belopp eller lägg till rader': 'field-amount',
    'ROT kräver personnummer för sökande': 'field-rot-personal-number',
    'ROT kräver fastighetsbeteckning': 'field-rot-property',
  };

  function scrollToField(fieldId: string) {
    document.getElementById(fieldId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleBack() {
    clearPersistedDraft();
    router.push('/crm/offerter');
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
      const hasAnyLineItemInput = draft.items.some((item) => item.article_name || item.m2 || item.quantity || item.unit_price);
      const effectiveCustomerName = getEffectiveCustomerName(draft);

      const amountNumber = hasAnyLineItemInput ? totals.total : parseDecimal(draft.amount);
      const vatPercentNumber = parseDecimal(draft.vat_percent);
      const vatAmount = hasAnyLineItemInput ? totals.vat : (Number.isFinite(vatPercentNumber) ? amountNumber * (vatPercentNumber / 100) : 0);

      const payload = {
        prospect_id: draft.prospect_id || null,
        opportunity_id: draft.opportunity_id || null,
        customer_id: draft.customer_id || null,
        customer_name: effectiveCustomerName,
        quote_type: draft.quote_type,
        customer_source: {
          kind: draft.customer_source.kind,
          sync_intent: draft.customer_source.kind === 'fortnox' ? 'linked' : draft.customer_source.sync_intent,
          fortnox_customer_id: draft.customer_source.fortnox_customer_id || null,
          fortnox_customer_name: draft.customer_source.fortnox_customer_name || null,
        },
        customer_snapshot: buildCustomerSnapshot(draft),
        pricing_summary: {
          subtotal: hasAnyLineItemInput ? totals.subtotal : amountNumber,
          vat: vatAmount,
          total: hasAnyLineItemInput ? totals.total : amountNumber + vatAmount,
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
      };

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
      toast.success(isEditing ? 'Offert uppdaterad' : 'Offert skapad');
      router.push('/crm/offerter');
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
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte skapa arbetsorder'); return; }
      const workOrder = json?.data?.workOrder as { id?: string; order_number?: string } | undefined;
      toast.success(workOrder?.order_number ? `Arbetsorder skapad: ${workOrder.order_number}` : 'Arbetsorder skapad');
      if (workOrder?.id) router.push(`/crm/arbetsorder?work_order_id=${workOrder.id}`);
    } catch { toast.error('Kunde inte skapa arbetsorder'); } finally { setCreatingWorkOrder(false); }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-slate-400">Laddar offert…</span>
      </div>
    );
  }

  const hasWorkOrder = Boolean(loadedQuote?.work_order_id || loadedQuote?.work_order_number);
  const configuredRows = effectiveRows.filter((r) => r.isConfigured);
  const hasAnyLineItemInput = draft.items.some((item) => item.article_name || item.m2 || item.quantity || item.unit_price);

  const sidebarDisplayName = draft.quote_type === 'business'
    ? (draft.company_name || draft.customer_name)
    : draft.customer_name;
  const sidebarTotal = hasAnyLineItemInput
    ? totals.total
    : (draft.amount ? parseDecimal(draft.amount) : null);

  // Single source of truth for the visible sections (in order). Drives both the
  // section header numbers and the sidebar nav so they can never drift apart.
  // `done: undefined` marks an internal section with no completion requirement.
  const sections: { id: string; label: string; done?: boolean }[] = [
    { id: 'section-kund', label: 'Kund', done: Boolean(draft.quote_type === 'business' ? (draft.company_name || draft.customer_name) : draft.customer_name) },
    { id: 'section-offert', label: 'Offert', done: Boolean(draft.project_name.trim()) },
    { id: 'section-rader', label: 'Produkter & priser', done: hasAnyLineItemInput || Boolean(draft.amount.trim()) },
    ...(draft.quote_type === 'private' && draft.rot_enabled
      ? [{ id: 'section-rot', label: 'ROT-avdrag', done: Boolean(draft.rot_personal_number.trim() && draft.rot_property_designation.trim()) }]
      : []),
    { id: 'section-handoff', label: 'Intern handoff' },
    ...(isEditing && loadedQuote ? [{ id: 'section-arbetsorder', label: 'Arbetsorder' }] : []),
  ];
  const requiredSections = sections.filter((s) => s.done !== undefined);
  const doneSteps = requiredSections.filter((s) => s.done).length;
  const stepOf = (id: string) => sections.findIndex((s) => s.id === id) + 1;

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
          Offerter
        </button>
        <h1 className={crm.pageTitle}>
          {isEditing ? (draft.project_name || 'Redigera offert') : 'Ny offert'}
        </h1>
        <p className={cn('mt-0.5', crm.pageSubtitle)}>
          {isEditing ? 'Uppdatera offertens uppgifter och status.' : 'Fyll i uppgifterna nedan för att skapa en ny offert.'}
        </p>
      </div>

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
                setSelectedCustomer(null);
                setDraft((current) => ({
                  ...current, customer_id: null,
                  customer_source: buildCustomerSource(null),
                  company_name: '', customer_name: '', organization_number: '',
                  personal_number: '', contact_name: '', phone: '', email: '',
                  street_address: '', postal_code: '', city: '',
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
            <Field label="Beskrivning" className="md:col-span-2">
              <Textarea value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} rows={3} placeholder="Kort om omfattning eller vad som offereras" />
            </Field>
            <Field fieldId="field-amount" label="Belopp" error={fieldErrors.amount}>
              <Input value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} inputMode="decimal" placeholder="0" />
            </Field>
            <Field label="Moms %">
              <Input value={draft.vat_percent} onChange={(e) => setDraft((d) => ({ ...d, vat_percent: e.target.value }))} inputMode="decimal" placeholder="25" />
            </Field>
            <Field label="Offertdatum">
              <Input value={draft.quote_date} onChange={(e) => setDraft((d) => ({ ...d, quote_date: e.target.value }))} type="date" lang="sv-SE" />
            </Field>
            <Field label="Giltig till">
              <Input value={draft.valid_until} onChange={(e) => setDraft((d) => ({ ...d, valid_until: e.target.value }))} type="date" lang="sv-SE" />
            </Field>
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
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Moms</span>
                <span className="text-sm font-semibold text-slate-900">{formatCurrency(totals.vat, 'SEK')}</span>
              </div>
              <div className="grid gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Rader</span>
                <span className="text-sm font-semibold text-slate-900">{configuredRows.length} st</span>
              </div>
              <div className="ml-auto grid gap-0.5 text-right">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Total</span>
                <span className="text-base font-bold text-slate-950">{formatCurrency(totals.total, 'SEK')}</span>
              </div>
            </div>
          ) : (
            <p className="mb-6 text-sm text-slate-400">
              Grundbelopp används om inga rader läggs till. Lägg till rader för att bygga offertens summering.
            </p>
          )}

          <div className="grid gap-3">
            {draft.items.map((row, index) => (
              <LineItemRow
                key={row.id}
                row={row}
                index={index}
                metrics={effectiveRows.find((r) => r.id === row.id)}
                rotEnabled={draft.rot_enabled}
                onChange={(patch) => setDraft((d) => ({ ...d, items: d.items.map((item) => item.id === row.id ? { ...item, ...patch } : item) }))}
                onSelectArticle={(article) => {
                  const construction = inferConstructionFromArticle(article.name);
                  const unitName = getArticleUnitName(article.unit);
                  const normalizedUnit = unitName.trim().toLowerCase();
                  const pricingMode: 'm3' | 'item' = normalizedUnit === 'm3' || normalizedUnit === 'm³' || /m\s*³/i.test(normalizedUnit) ? 'm3' : 'item';
                  setDraft((current) => ({
                    ...current,
                    items: current.items.map((item) => item.id === row.id ? {
                      ...item,
                      article_id: article.id || null,
                      article_name: article.name || null,
                      article_number: article.articleNumber || null,
                      article_price: typeof article.price === 'number' ? article.price : null,
                      article_unit_name: unitName || null,
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
                    ...item, article_id: null, article_name: null, article_number: null, article_price: null, article_unit_name: null,
                  } : item),
                }))}
                onRemove={() => setDraft((d) => ({ ...d, items: d.items.length > 1 ? d.items.filter((item) => item.id !== row.id) : [createEmptyLineItem()] }))}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => setDraft((d) => ({ ...d, items: [...d.items, createEmptyLineItem()] }))}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            + Lägg till rad
          </button>
          </div>

          {/* ── Section 4: ROT (toggled on via the sidebar) ── */}
          {draft.quote_type === 'private' && draft.rot_enabled ? (
            <div id="section-rot" className={cn('scroll-mt-6', crm.cardInner)}>
              <SectionHeader step={stepOf('section-rot')} title="ROT-avdrag" />
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="ROT-sökande">
                  <Input value={draft.rot_applicant_name} onChange={(e) => setDraft((d) => ({ ...d, rot_applicant_name: e.target.value }))} placeholder="Namn på sökande" />
                </Field>
                <Field fieldId="field-rot-personal-number" label="ROT personnummer" error={fieldErrors.rot_personal_number}>
                  <Input value={draft.rot_personal_number} onChange={(e) => setDraft((d) => ({ ...d, rot_personal_number: e.target.value }))} placeholder="ÅÅÅÅMMDD-XXXX" />
                </Field>
                <Field fieldId="field-rot-property" label="Fastighetsbeteckning" className="md:col-span-2" error={fieldErrors.rot_property_designation}>
                  <Input value={draft.rot_property_designation} onChange={(e) => setDraft((d) => ({ ...d, rot_property_designation: e.target.value }))} placeholder="Fastighetsbeteckning" />
                </Field>
                <Field label="ROT %">
                  <Input value={draft.rot_percent} onChange={(e) => setDraft((d) => ({ ...d, rot_percent: e.target.value }))} inputMode="decimal" placeholder="30" />
                </Field>
              </div>
            </div>
          ) : null}

          {/* ── Section 5: Intern handoff ── */}
          <div id="section-handoff" className={cn('scroll-mt-6', crm.cardInner)}>
            <SectionHeader step={stepOf('section-handoff')} title="Intern handoff" muted />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Önskat installationsdatum">
                <Input value={draft.desired_installation_date} onChange={(e) => setDraft((d) => ({ ...d, desired_installation_date: e.target.value }))} type="date" />
              </Field>
              <Field label="Arbetets scope">
                <Input value={draft.work_scope} onChange={(e) => setDraft((d) => ({ ...d, work_scope: e.target.value }))} placeholder="Kort operativt scope" />
              </Field>
              <Field label="Överlämningsnotering" className="md:col-span-2">
                <Textarea value={draft.handoff_notes} onChange={(e) => setDraft((d) => ({ ...d, handoff_notes: e.target.value }))} rows={3} placeholder="Intern information för projekt eller arbetsorder" />
              </Field>
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
                    disabled={draft.status !== 'won' || hasWorkOrder || creatingWorkOrder}
                    className="rounded-lg border border-slate-900 bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
                  >
                    {creatingWorkOrder ? 'Skapar…' : hasWorkOrder ? 'Skapad' : 'Skapa arbetsorder'}
                  </button>
                </div>
              </div>
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

              {/* Total — prominent */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Totalt inkl. moms</span>
                <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
                  {sidebarTotal != null && Number.isFinite(sidebarTotal)
                    ? formatCurrency(sidebarTotal, 'SEK')
                    : <span className="text-xl text-slate-300">—</span>}
                </p>
                {hasAnyLineItemInput && totals.subtotal > 0 ? (
                  <p className="mt-0.5 text-xs text-slate-400">
                    {formatCurrency(totals.subtotal, 'SEK')} + {formatCurrency(totals.vat, 'SEK')} moms
                  </p>
                ) : null}
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

              <Field label="Följ upp senast">
                <Input value={draft.follow_up_date} onChange={(e) => setDraft((d) => ({ ...d, follow_up_date: e.target.value }))} type="date" lang="sv-SE" />
              </Field>

              {/* ROT toggle — only relevant for private customers */}
              {draft.quote_type === 'private' ? (
                <label className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
                  <span className="text-sm font-medium text-slate-700">ROT-avdrag</span>
                  <input
                    type="checkbox"
                    checked={draft.rot_enabled}
                    onChange={(e) => setDraft((d) => ({ ...d, rot_enabled: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                  />
                </label>
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
              disabled={submitting}
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Totalt inkl. moms</p>
          <p className="truncate text-base font-bold text-slate-950">
            {sidebarTotal != null && Number.isFinite(sidebarTotal) ? formatCurrency(sidebarTotal, 'SEK') : '—'}
          </p>
        </div>
        <button
          type="button"
          onClick={saveQuote}
          disabled={submitting}
          className={cn(crm.saveButton, 'ml-auto w-auto px-6')}
        >
          {submitting ? 'Sparar…' : isEditing ? 'Spara' : 'Skapa'}
        </button>
      </div>
    </div>
  );
}

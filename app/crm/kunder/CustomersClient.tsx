"use client";

import { useEffect, useMemo, useState } from 'react';
import Input from '../../../components/ui/Input';
import Textarea from '../../../components/ui/Textarea';
import MetricCard from '../components/MetricCard';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';

type CustomerType = 'business' | 'private';
type CustomerStatus = 'active' | 'inactive' | 'churned';
type CustomerStage = 'prospect' | 'customer' | 'fortnox_customer';

type CustomerContact = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
};

type CustomerAddress = {
  street: string | null;
  postal_code: string | null;
  city: string | null;
};

type CustomerItem = {
  id: string;
  customer_type: CustomerType;
  customer_stage: CustomerStage;
  company_name: string | null;
  organization_number: string | null;
  first_name: string | null;
  last_name: string | null;
  personal_number: string | null;
  visit_address: CustomerAddress | null;
  invoice_address: CustomerAddress | null;
  source_prospect_id: string | null;
  fortnox_customer_id: string | null;
  sync_status: 'not_synced' | 'pending' | 'synced' | 'failed';
  status: CustomerStatus;
  assigned_to: string;
  created_at: string;
  updated_at: string;
  contacts: CustomerContact[];
};

const statusLabel: Record<CustomerStatus, string> = {
  active: 'Aktiv',
  inactive: 'Inaktiv',
  churned: 'Churnad',
};

const statusClass: Record<CustomerStatus, string> = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  inactive: 'border-slate-200 bg-slate-50 text-slate-600',
  churned: 'border-rose-200 bg-rose-50 text-rose-700',
};

const syncLabel: Record<string, string> = {
  not_synced: 'Ej synkad',
  pending: 'Väntar',
  synced: 'Synkad',
  failed: 'Misslyckad',
};

const syncClass: Record<string, string> = {
  not_synced: 'border-slate-200 bg-slate-50 text-slate-500',
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  synced: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
};

const stageLabel: Record<CustomerStage, string> = {
  prospect: 'Prospekt',
  customer: 'Kund',
  fortnox_customer: 'Fortnox-kund',
};

const stageClass: Record<CustomerStage, string> = {
  prospect: 'border-sky-200 bg-sky-50 text-sky-700',
  customer: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  fortnox_customer: 'border-violet-200 bg-violet-50 text-violet-700',
};

type StageFilter = 'alla' | CustomerStage;

const filterMeta: Record<StageFilter, { label: string }> = {
  alla: { label: 'Alla' },
  prospect: { label: 'Prospekt' },
  customer: { label: 'Kunder' },
  fortnox_customer: { label: 'Fortnox-kunder' },
};

type CreateDraft = {
  customer_type: CustomerType;
  company_name: string;
  organization_number: string;
  first_name: string;
  last_name: string;
  personal_number: string;
  visit_street: string;
  visit_postal_code: string;
  visit_city: string;
  invoice_street: string;
  invoice_postal_code: string;
  invoice_city: string;
};

const initialDraft: CreateDraft = {
  customer_type: 'business',
  company_name: '',
  organization_number: '',
  first_name: '',
  last_name: '',
  personal_number: '',
  visit_street: '',
  visit_postal_code: '',
  visit_city: '',
  invoice_street: '',
  invoice_postal_code: '',
  invoice_city: '',
};

type ContactDraft = {
  name: string;
  role: string;
  phone: string;
  email: string;
  is_primary: boolean;
};

const initialContactDraft: ContactDraft = {
  name: '',
  role: '',
  phone: '',
  email: '',
  is_primary: false,
};

type RelatedOpportunity = { id: string; title: string; status: string; updated_at: string };
type RelatedQuote = { id: string; project_name: string; amount: number; currency_code: string; status: string; quote_date: string };
type RelatedWorkOrder = { id: string; order_number: string; project_name: string; status: string; desired_installation_date: string | null };

const opportunityStatusLabel: Record<string, string> = { qualified: 'Kvalificerad', quoted: 'Offert', won: 'Vunnen', lost: 'Förlorad' };
const quoteStatusLabel: Record<string, string> = { draft: 'Utkast', sent: 'Skickad', follow_up: 'Följ upp', won: 'Vunnen', lost: 'Förlorad' };
const workOrderStatusLabel: Record<string, string> = { draft: 'Utkast', scheduled: 'Planerad', ready: 'Redo', in_progress: 'Pågående', completed: 'Klar', cancelled: 'Avbruten' };

function formatCurrency(value: number, code: string) {
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: code || 'SEK', maximumFractionDigits: 0 }).format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '–';
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '–' : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(d);
}

function getDisplayName(item: CustomerItem): string {
  if (item.customer_type === 'business') return item.company_name || 'Okänt företag';
  const parts = [item.first_name, item.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Okänd kund';
}

function formatAddress(addr: CustomerAddress | null): string {
  if (!addr) return '–';
  const parts = [addr.street, addr.postal_code, addr.city].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '–';
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function CustomersClient() {
  const toast = useToast();
  const [items, setItems] = useState<CustomerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StageFilter>('alla');
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<CreateDraft>(initialDraft);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailEditing, setDetailEditing] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [detailDraft, setDetailDraft] = useState<Partial<CreateDraft>>({});
  const [contactDraft, setContactDraft] = useState<ContactDraft>(initialContactDraft);
  const [addingContact, setAddingContact] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [relatedOpportunities, setRelatedOpportunities] = useState<RelatedOpportunity[]>([]);
  const [relatedQuotes, setRelatedQuotes] = useState<RelatedQuote[]>([]);
  const [relatedWorkOrders, setRelatedWorkOrders] = useState<RelatedWorkOrder[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set('q', search.trim());
        const res = await fetch(`/api/crm/customers${query.size > 0 ? `?${query.toString()}` : ''}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !json.ok) {
          setError(json?.error || 'Kunde inte ladda kunder. Har SQL-migrationen körts?');
          setItems([]);
          return;
        }
        setItems(Array.isArray(json?.data?.items) ? json.data.items : []);
      } catch {
        if (!active) return;
        setError('Kunde inte ladda kunder.');
        setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [search]);

  useEffect(() => {
    if (!(createPanelOpen || detailOpen)) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [createPanelOpen, detailOpen]);

  useEffect(() => {
    if (!detailOpen || !selectedId) {
      setRelatedOpportunities([]);
      setRelatedQuotes([]);
      setRelatedWorkOrders([]);
      return;
    }
    let active = true;
    async function loadRelated() {
      setRelatedLoading(true);
      try {
        const [oppRes, quoteRes, woRes] = await Promise.all([
          fetch(`/api/crm/opportunities?customer_id=${selectedId}`, { cache: 'no-store' }),
          fetch(`/api/crm/quotes?customer_id=${selectedId}`, { cache: 'no-store' }),
          fetch(`/api/crm/work-orders?customer_id=${selectedId}`, { cache: 'no-store' }),
        ]);
        const [oppJson, quoteJson, woJson] = await Promise.all([
          oppRes.json().catch(() => ({})),
          quoteRes.json().catch(() => ({})),
          woRes.json().catch(() => ({})),
        ]);
        if (!active) return;
        setRelatedOpportunities(oppRes.ok && oppJson.ok ? oppJson.data?.items || [] : []);
        setRelatedQuotes(quoteRes.ok && quoteJson.ok ? quoteJson.data?.items || [] : []);
        setRelatedWorkOrders(woRes.ok && woJson.ok ? woJson.data?.items || [] : []);
      } catch {
        if (active) { setRelatedOpportunities([]); setRelatedQuotes([]); setRelatedWorkOrders([]); }
      } finally {
        if (active) setRelatedLoading(false);
      }
    }
    loadRelated();
    return () => { active = false; };
  }, [detailOpen, selectedId]);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setDetailDraft({
      customer_type: selected.customer_type,
      company_name: selected.company_name || '',
      organization_number: selected.organization_number || '',
      first_name: selected.first_name || '',
      last_name: selected.last_name || '',
      personal_number: selected.personal_number || '',
      visit_street: selected.visit_address?.street || '',
      visit_postal_code: selected.visit_address?.postal_code || '',
      visit_city: selected.visit_address?.city || '',
      invoice_street: selected.invoice_address?.street || '',
      invoice_postal_code: selected.invoice_address?.postal_code || '',
      invoice_city: selected.invoice_address?.city || '',
    });
  }, [selected]);

  const visibleItems = useMemo(() => {
    const filtered = filter === 'alla' ? items : items.filter((i) => i.customer_stage === filter);
    return filtered.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [filter, items]);

  const filterCounts = useMemo<Record<StageFilter, number>>(() => ({
    alla: items.length,
    prospect: items.filter((i) => i.customer_stage === 'prospect').length,
    customer: items.filter((i) => i.customer_stage === 'customer').length,
    fortnox_customer: items.filter((i) => i.customer_stage === 'fortnox_customer').length,
  }), [items]);

  const stats = useMemo(() => ({
    total: items.length,
    prospects: items.filter((i) => i.customer_stage === 'prospect').length,
    customers: items.filter((i) => i.customer_stage === 'customer').length,
    fortnox: items.filter((i) => i.customer_stage === 'fortnox_customer').length,
  }), [items]);

  async function createCustomer() {
    const isB2B = draft.customer_type === 'business';
    if (isB2B && !draft.company_name.trim()) { toast.error('Företagsnamn krävs'); return; }
    if (!isB2B && (!draft.first_name.trim() || !draft.last_name.trim())) { toast.error('För- och efternamn krävs'); return; }

    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        customer_type: draft.customer_type,
      };
      if (isB2B) {
        body.company_name = draft.company_name.trim() || null;
        body.organization_number = draft.organization_number.trim() || null;
      } else {
        body.first_name = draft.first_name.trim() || null;
        body.last_name = draft.last_name.trim() || null;
        body.personal_number = draft.personal_number.trim() || null;
      }
      if (draft.visit_city || draft.visit_street || draft.visit_postal_code) {
        body.visit_address = { street: draft.visit_street || null, postal_code: draft.visit_postal_code || null, city: draft.visit_city || null };
      }
      if (draft.invoice_city || draft.invoice_street || draft.invoice_postal_code) {
        body.invoice_address = { street: draft.invoice_street || null, postal_code: draft.invoice_postal_code || null, city: draft.invoice_city || null };
      }

      const res = await fetch('/api/crm/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte skapa kund'); return; }
      const item = json?.data?.item as CustomerItem | undefined;
      if (item) {
        setItems((c) => [item, ...c]);
        setSelectedId(item.id);
      }
      setDraft(initialDraft);
      setCreatePanelOpen(false);
      toast.success('Kund skapad');
    } catch {
      toast.error('Fel vid skapande av kund');
    } finally {
      setCreating(false);
    }
  }

  async function saveDetail() {
    if (!selected) return;
    setSavingDetail(true);
    try {
      const d = detailDraft;
      const body: Record<string, unknown> = {
        customer_type: d.customer_type,
        company_name: d.company_name?.trim() || null,
        organization_number: d.organization_number?.trim() || null,
        first_name: d.first_name?.trim() || null,
        last_name: d.last_name?.trim() || null,
        personal_number: d.personal_number?.trim() || null,
        visit_address: { street: d.visit_street || null, postal_code: d.visit_postal_code || null, city: d.visit_city || null },
        invoice_address: { street: d.invoice_street || null, postal_code: d.invoice_postal_code || null, city: d.invoice_city || null },
      };
      const res = await fetch(`/api/crm/customers/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte uppdatera kund'); return; }
      const item = json?.data?.item as CustomerItem | undefined;
      if (item) setItems((c) => c.map((e) => e.id === item.id ? item : e));
      setDetailEditing(false);
      toast.success('Kund uppdaterad');
    } catch {
      toast.error('Fel vid uppdatering');
    } finally {
      setSavingDetail(false);
    }
  }

  async function saveContact() {
    if (!selected || !contactDraft.name.trim()) { toast.error('Namn krävs'); return; }
    setSavingContact(true);
    try {
      const res = await fetch(`/api/crm/customers/${selected.id}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: contactDraft.name.trim(),
          role: contactDraft.role.trim() || null,
          phone: contactDraft.phone.trim() || null,
          email: contactDraft.email.trim() || null,
          is_primary: contactDraft.is_primary,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte lägga till kontakt'); return; }
      const contact = json?.data?.item as CustomerContact | undefined;
      if (contact) {
        setItems((c) => c.map((e) => e.id === selected.id ? { ...e, contacts: [...e.contacts, contact] } : e));
      }
      setContactDraft(initialContactDraft);
      setAddingContact(false);
      toast.success('Kontakt tillagd');
    } catch {
      toast.error('Fel vid tillägg av kontakt');
    } finally {
      setSavingContact(false);
    }
  }

  async function deleteContact(contactId: string) {
    if (!selected) return;
    try {
      const res = await fetch(`/api/crm/customers/${selected.id}/contacts/${contactId}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte ta bort kontakt'); return; }
      setItems((c) => c.map((e) => e.id === selected.id ? { ...e, contacts: e.contacts.filter((ct) => ct.id !== contactId) } : e));
      toast.success('Kontakt borttagen');
    } catch {
      toast.error('Fel vid borttagning');
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Kundregister</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">Prospekt, kunder och Fortnox-kopplade konton</p>
        </div>
        <button
          type="button"
          onClick={() => setCreatePanelOpen(true)}
          className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold text-white transition"
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          + Ny kund
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Totalt" value={stats.total} helper="Alla i registret" />
        <MetricCard label="Prospekt" value={stats.prospects} helper="Potentiella kunder" />
        <MetricCard label="Kunder" value={stats.customers} helper="Aktiva kundrelationer" />
        <MetricCard label="Fortnox-kunder" value={stats.fortnox} helper="Fortnox-koppling aktiv" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök på namn, org-nr eller stad"
            className="max-w-xs"
          />
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(filterMeta) as StageFilter[]).map((value) => {
              const active = filter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold transition',
                    active ? 'border-transparent text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                  style={active ? { backgroundColor: 'var(--crm-primary)' } : undefined}
                >
                  {filterMeta[value].label}
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600')}>
                    {filterCounts[value]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        {loading ? (
          <div className="grid gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="h-3 w-40 rounded-full bg-slate-200" />
                <div className="h-3 w-24 rounded-full bg-slate-200" />
              </div>
            ))}
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="grid gap-2 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
            <strong className="text-base font-bold text-slate-900">Inga poster i det här filtret</strong>
            <p className="m-0 text-sm leading-6 text-slate-600">
              {filter === 'prospect'
                ? 'Lägg till ett prospekt med knappen ovan, eller logga ett samtal för att skapa ett.'
                : filter === 'fortnox_customer'
                ? 'Fortnox-kunder visas här när Fortnox-integrationen är aktiv.'
                : 'Prospekt konverteras till kunder när en offert vinns.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            {visibleItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setSelectedId(item.id); setDetailOpen(true); }}
                className={cn(
                  'grid grid-cols-[1fr_auto] items-center gap-3 rounded-[18px] border bg-white px-4 py-3 text-left shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.08)]',
                  item.status === 'churned' ? 'border-rose-200/70' : 'border-slate-200',
                )}
              >
                <div className="grid gap-0.5">
                  <strong className="text-sm font-bold text-slate-900">{getDisplayName(item)}</strong>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    {item.organization_number ? <span>{item.organization_number}</span> : null}
                    {item.visit_address?.city ? <span>{item.visit_address.city}</span> : null}
                    {item.contacts.length > 0 ? (
                      <span>{item.contacts.length} kontakt{item.contacts.length !== 1 ? 'er' : ''}</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', stageClass[item.customer_stage])}>
                    {stageLabel[item.customer_stage]}
                  </span>
                  {item.customer_stage === 'fortnox_customer' ? (
                    <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', syncClass[item.sync_status])}>
                      {syncLabel[item.sync_status]}
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Skapa-panel */}
      {createPanelOpen ? (
        <div className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/45 p-3 [backdrop-filter:blur(4px)] sm:items-center sm:p-4" onClick={() => setCreatePanelOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Skapa kund"
            onClick={(e) => e.stopPropagation()}
            className="grid w-full max-w-[660px] gap-4 rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f5faf8_100%)] p-4 shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:max-h-[88vh] sm:overflow-y-auto sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Ny kund</span>
                <strong className="text-[1.5rem] font-bold tracking-[-0.05em] text-slate-950">Registrera kund</strong>
              </div>
              <button type="button" onClick={() => setCreatePanelOpen(false)} className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300">
                Stäng
              </button>
            </div>

            <div className="grid gap-3 rounded-[24px] border border-white/80 bg-white/92 p-4 shadow-[0_20px_44px_rgba(15,23,42,0.06)]">
              <label className="grid gap-1 text-sm text-slate-600">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Kundtyp</span>
                <select
                  value={draft.customer_type}
                  onChange={(e) => setDraft((c) => ({ ...c, customer_type: e.target.value as CustomerType }))}
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20"
                >
                  <option value="business">Företag</option>
                  <option value="private">Privat</option>
                </select>
              </label>

              {draft.customer_type === 'business' ? (
                <>
                  <Input value={draft.company_name} onChange={(e) => setDraft((c) => ({ ...c, company_name: e.target.value }))} placeholder="Företagsnamn" />
                  <Input value={draft.organization_number} onChange={(e) => setDraft((c) => ({ ...c, organization_number: e.target.value }))} placeholder="Org-nummer" />
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={draft.first_name} onChange={(e) => setDraft((c) => ({ ...c, first_name: e.target.value }))} placeholder="Förnamn" />
                    <Input value={draft.last_name} onChange={(e) => setDraft((c) => ({ ...c, last_name: e.target.value }))} placeholder="Efternamn" />
                  </div>
                  <Input value={draft.personal_number} onChange={(e) => setDraft((c) => ({ ...c, personal_number: e.target.value }))} placeholder="Personnummer" />
                </>
              )}

              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Besöksadress</span>
              <div className="grid gap-2">
                <Input value={draft.visit_street} onChange={(e) => setDraft((c) => ({ ...c, visit_street: e.target.value }))} placeholder="Gatuadress" />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={draft.visit_postal_code} onChange={(e) => setDraft((c) => ({ ...c, visit_postal_code: e.target.value }))} placeholder="Postnummer" />
                  <Input value={draft.visit_city} onChange={(e) => setDraft((c) => ({ ...c, visit_city: e.target.value }))} placeholder="Stad" />
                </div>
              </div>

              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Fakturaadress</span>
              <div className="grid gap-2">
                <Input value={draft.invoice_street} onChange={(e) => setDraft((c) => ({ ...c, invoice_street: e.target.value }))} placeholder="Gatuadress" />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={draft.invoice_postal_code} onChange={(e) => setDraft((c) => ({ ...c, invoice_postal_code: e.target.value }))} placeholder="Postnummer" />
                  <Input value={draft.invoice_city} onChange={(e) => setDraft((c) => ({ ...c, invoice_city: e.target.value }))} placeholder="Stad" />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button type="button" onClick={() => setCreatePanelOpen(false)} className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-300">
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={createCustomer}
                  disabled={creating}
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-emerald-600 bg-[linear-gradient(180deg,#14b87a_0%,#0f9f6c_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_20px_34px_rgba(16,185,129,0.22)] transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creating ? 'Sparar…' : 'Skapa kund'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Detaljpanel */}
      {detailOpen && selected ? (
        <div className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/45 p-3 [backdrop-filter:blur(4px)] sm:items-center sm:p-4" onClick={() => setDetailOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Kund ${getDisplayName(selected)}`}
            onClick={(e) => e.stopPropagation()}
            className="grid w-full max-w-[760px] gap-4 rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f6faf8_100%)] p-4 shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:max-h-[88vh] sm:overflow-y-auto sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {stageLabel[selected.customer_stage]} · {selected.customer_type === 'business' ? 'Företag' : 'Privat'}
                </span>
                <strong className="text-[1.4rem] font-bold tracking-[-0.05em] text-slate-950">{getDisplayName(selected)}</strong>
                {selected.organization_number ? <p className="m-0 text-sm text-slate-500">Org-nr: {selected.organization_number}</p> : null}
                {selected.personal_number ? <p className="m-0 text-sm text-slate-500">Personnr: {selected.personal_number}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', stageClass[selected.customer_stage])}>
                  {stageLabel[selected.customer_stage]}
                </span>
                {selected.customer_stage === 'fortnox_customer' ? (
                  <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', syncClass[selected.sync_status])}>
                    {syncLabel[selected.sync_status]}
                  </span>
                ) : null}
                <button type="button" onClick={() => setDetailEditing((c) => !c)} className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300">
                  {detailEditing ? 'Avsluta redigering' : 'Redigera'}
                </button>
                <button type="button" onClick={() => setDetailOpen(false)} className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300">
                  Stäng
                </button>
              </div>
            </div>

            {detailEditing ? (
              <div className="grid gap-3 rounded-[20px] border border-white/80 bg-white/90 p-3 shadow-[0_12px_24px_rgba(15,23,42,0.04)]">
                {detailDraft.customer_type === 'business' ? (
                  <>
                    <Input value={detailDraft.company_name || ''} onChange={(e) => setDetailDraft((c) => ({ ...c, company_name: e.target.value }))} placeholder="Företagsnamn" />
                    <Input value={detailDraft.organization_number || ''} onChange={(e) => setDetailDraft((c) => ({ ...c, organization_number: e.target.value }))} placeholder="Org-nummer" />
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={detailDraft.first_name || ''} onChange={(e) => setDetailDraft((c) => ({ ...c, first_name: e.target.value }))} placeholder="Förnamn" />
                      <Input value={detailDraft.last_name || ''} onChange={(e) => setDetailDraft((c) => ({ ...c, last_name: e.target.value }))} placeholder="Efternamn" />
                    </div>
                    <Input value={detailDraft.personal_number || ''} onChange={(e) => setDetailDraft((c) => ({ ...c, personal_number: e.target.value }))} placeholder="Personnummer" />
                  </>
                )}
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Besöksadress</span>
                <Input value={detailDraft.visit_street || ''} onChange={(e) => setDetailDraft((c) => ({ ...c, visit_street: e.target.value }))} placeholder="Gatuadress" />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={detailDraft.visit_postal_code || ''} onChange={(e) => setDetailDraft((c) => ({ ...c, visit_postal_code: e.target.value }))} placeholder="Postnummer" />
                  <Input value={detailDraft.visit_city || ''} onChange={(e) => setDetailDraft((c) => ({ ...c, visit_city: e.target.value }))} placeholder="Stad" />
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Fakturaadress</span>
                <Input value={detailDraft.invoice_street || ''} onChange={(e) => setDetailDraft((c) => ({ ...c, invoice_street: e.target.value }))} placeholder="Gatuadress" />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={detailDraft.invoice_postal_code || ''} onChange={(e) => setDetailDraft((c) => ({ ...c, invoice_postal_code: e.target.value }))} placeholder="Postnummer" />
                  <Input value={detailDraft.invoice_city || ''} onChange={(e) => setDetailDraft((c) => ({ ...c, invoice_city: e.target.value }))} placeholder="Stad" />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => setDetailEditing(false)} className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-300">
                    Avbryt
                  </button>
                  <button type="button" onClick={saveDetail} disabled={savingDetail} className="inline-flex min-h-11 items-center justify-center rounded-full border border-emerald-600 bg-[linear-gradient(180deg,#14b87a_0%,#0f9f6c_100%)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_20px_34px_rgba(16,185,129,0.22)] transition hover:brightness-[0.97] disabled:opacity-60">
                    {savingDetail ? 'Sparar…' : 'Spara ändringar'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 rounded-[20px] border border-slate-200/80 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Besöksadress</span>
                    <p className="m-0 text-sm text-slate-700">{formatAddress(selected.visit_address)}</p>
                  </div>
                  <div className="grid gap-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Fakturaadress</span>
                    <p className="m-0 text-sm text-slate-700">{formatAddress(selected.invoice_address)}</p>
                  </div>
                </div>
                {selected.fortnox_customer_id ? (
                  <div className="grid gap-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Fortnox kund-ID</span>
                    <span className="text-sm font-semibold text-slate-900">{selected.fortnox_customer_id}</span>
                  </div>
                ) : null}
                <div className="grid gap-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Skapad</span>
                  <span className="text-sm text-slate-700">{formatDateTime(selected.created_at)}</span>
                </div>
              </div>
            )}

            {/* Kontakter */}
            <div className="grid gap-3 rounded-[20px] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Kontaktpersoner</span>
                <button type="button" onClick={() => setAddingContact((c) => !c)} className="inline-flex min-h-8 items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300">
                  {addingContact ? 'Avbryt' : '+ Lägg till'}
                </button>
              </div>

              {addingContact ? (
                <div className="grid gap-2 rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                  <Input value={contactDraft.name} onChange={(e) => setContactDraft((c) => ({ ...c, name: e.target.value }))} placeholder="Namn" />
                  <Input value={contactDraft.role} onChange={(e) => setContactDraft((c) => ({ ...c, role: e.target.value }))} placeholder="Roll (t.ex. Inköpschef)" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={contactDraft.phone} onChange={(e) => setContactDraft((c) => ({ ...c, phone: e.target.value }))} placeholder="Telefon" />
                    <Input value={contactDraft.email} onChange={(e) => setContactDraft((c) => ({ ...c, email: e.target.value }))} placeholder="E-post" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={contactDraft.is_primary}
                      onChange={(e) => setContactDraft((c) => ({ ...c, is_primary: e.target.checked }))}
                      className="rounded border-slate-300"
                    />
                    Primär kontakt
                  </label>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={saveContact} disabled={savingContact} className="inline-flex min-h-9 items-center justify-center rounded-full border border-emerald-600 bg-[linear-gradient(180deg,#14b87a_0%,#0f9f6c_100%)] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_12px_20px_rgba(16,185,129,0.18)] transition hover:brightness-[0.97] disabled:opacity-60">
                      {savingContact ? 'Sparar…' : 'Spara kontakt'}
                    </button>
                  </div>
                </div>
              ) : null}

              {selected.contacts.length === 0 && !addingContact ? (
                <p className="text-sm text-slate-500">Inga kontakter registrerade ännu.</p>
              ) : (
                <div className="grid gap-2">
                  {selected.contacts.map((contact) => (
                    <div key={contact.id} className="flex items-start justify-between gap-3 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
                      <div className="grid gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">{contact.name}</span>
                          {contact.is_primary ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Primär</span> : null}
                        </div>
                        {contact.role ? <span className="text-xs text-slate-500">{contact.role}</span> : null}
                        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                          {contact.phone ? <span>{contact.phone}</span> : null}
                          {contact.email ? <span>{contact.email}</span> : null}
                        </div>
                      </div>
                      <button type="button" onClick={() => deleteContact(contact.id)} className="mt-0.5 text-xs text-slate-400 hover:text-rose-500">
                        Ta bort
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Historik */}
            <div className="grid gap-3">
              {/* Affärsmöjligheter */}
              <div className="grid gap-3 rounded-[20px] border border-violet-200/70 bg-[linear-gradient(180deg,#ffffff_0%,#faf8ff_100%)] px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700/70">Affärsmöjligheter</span>
                  <a href={`/crm/affarsmojligheter`} className="text-xs font-semibold text-slate-500 hover:text-slate-700">Gå till pipeline →</a>
                </div>
                {relatedLoading ? (
                  <div className="h-8 w-full animate-pulse rounded-xl bg-slate-100" />
                ) : relatedOpportunities.length === 0 ? (
                  <p className="text-sm text-slate-500">Inga affärsmöjligheter kopplade till den här kunden.</p>
                ) : (
                  <div className="grid gap-2">
                    {relatedOpportunities.map((opp) => (
                      <div key={opp.id} className="flex items-center justify-between gap-2 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
                        <span className="text-sm font-semibold text-slate-900">{opp.title}</span>
                        <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                          {opportunityStatusLabel[opp.status] || opp.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Offerter */}
              <div className="grid gap-3 rounded-[20px] border border-amber-200/70 bg-[linear-gradient(180deg,#ffffff_0%,#fffaf2_100%)] px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700/70">Offerter</span>
                  <a href={`/crm/offerter`} className="text-xs font-semibold text-slate-500 hover:text-slate-700">Gå till offerter →</a>
                </div>
                {relatedLoading ? (
                  <div className="h-8 w-full animate-pulse rounded-xl bg-slate-100" />
                ) : relatedQuotes.length === 0 ? (
                  <p className="text-sm text-slate-500">Inga offerter kopplade till den här kunden.</p>
                ) : (
                  <div className="grid gap-2">
                    {relatedQuotes.map((quote) => (
                      <div key={quote.id} className="flex items-center justify-between gap-3 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
                        <div>
                          <p className="m-0 text-sm font-semibold text-slate-900">{quote.project_name}</p>
                          <p className="m-0 text-xs text-slate-500">{formatCurrency(quote.amount, quote.currency_code)} · {formatDate(quote.quote_date)}</p>
                        </div>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          {quoteStatusLabel[quote.status] || quote.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Arbetsorder */}
              <div className="grid gap-3 rounded-[20px] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Arbetsorder</span>
                  <a href={`/crm/arbetsorder`} className="text-xs font-semibold text-slate-500 hover:text-slate-700">Gå till arbetsorder →</a>
                </div>
                {relatedLoading ? (
                  <div className="h-8 w-full animate-pulse rounded-xl bg-slate-100" />
                ) : relatedWorkOrders.length === 0 ? (
                  <p className="text-sm text-slate-500">Inga arbetsorder kopplade till den här kunden.</p>
                ) : (
                  <div className="grid gap-2">
                    {relatedWorkOrders.map((wo) => (
                      <div key={wo.id} className="flex items-center justify-between gap-3 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
                        <div>
                          <p className="m-0 text-sm font-semibold text-slate-900">{wo.project_name}</p>
                          <p className="m-0 text-xs text-slate-500">#{wo.order_number}{wo.desired_installation_date ? ` · ${formatDate(wo.desired_installation_date)}` : ''}</p>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          {workOrderStatusLabel[wo.status] || wo.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      ) : null}
    </div>
  );
}

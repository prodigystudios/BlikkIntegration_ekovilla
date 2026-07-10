"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import FortnoxCodeSelect from './FortnoxCodeSelect';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm, customerStageLabel, customerStageClass, syncStatusLabel, syncStatusClass, workOrderStatusLabel } from '@/app/crm/lib/crmTokens';
import { formatSwedishIdNumber, isValidSwedishOrgNumber, vatFromOrgNumber } from './customerNumbers';
import { riskTypeLabel } from '@/lib/domains/tic/mappers';
import type { TicCreditReport } from '@/lib/domains/tic/types';
import { PhoneLink, EmailLink, AddressLink } from '@/app/crm/components/ContactLinks';
import { CreditReportSummary } from '@/app/crm/components/CreditReport';

// ─── Types ────────────────────────────────────────────────────────────────────

type CustomerType = 'business' | 'private';
type CustomerStage = 'prospect' | 'customer' | 'fortnox_customer';
type CustomerStatus = 'active' | 'inactive' | 'churned';
type CustomerAddress = { street: string | null; postal_code: string | null; city: string | null } | null;

type CustomerContact = {
  id: string; name: string; role: string | null; phone: string | null; email: string | null; is_primary: boolean;
};

type RiskIndicator = { type: string; subtype?: string; notes?: string; score?: number | null };

type Customer = {
  id: string;
  customer_type: CustomerType;
  customer_stage: CustomerStage;
  status: CustomerStatus;
  company_name: string | null;
  organization_number: string | null;
  first_name: string | null;
  last_name: string | null;
  personal_number: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  visit_address: CustomerAddress;
  delivery_address: CustomerAddress;
  invoice_address: CustomerAddress;
  invoice_email: string | null;
  payment_terms: string | null;
  price_list: string | null;
  discount: number | null;
  vat_number: string | null;
  reverse_vat: boolean;
  annual_revenue: number | null;
  number_of_employees: number | null;
  legal_entity_type: string | null;
  sni_code: string | null;
  sni_name: string | null;
  operating_profit: number | null;
  profit_after_financial_items: number | null;
  total_assets: number | null;
  operating_margin: number | null;
  equity_ratio: number | null;
  financial_year: number | null;
  risk_indicators: RiskIndicator[] | null;
  tic_company_id: number | null;
  credit_report: TicCreditReport | null;
  credit_report_fetched_at: string | null;
  fortnox_customer_id: string | null;
  sync_status: 'not_synced' | 'pending' | 'synced' | 'failed';
  account_manager_id: string | null;
  created_at: string;
  updated_at: string;
  contacts: CustomerContact[];
};

type Seller = { id: string; full_name: string | null; role: string };

type RelatedQuote = { id: string; project_name: string; amount: number; currency_code: string; status: string; quote_date: string };
type RelatedWorkOrder = { id: string; order_number: string; project_name: string; status: string; desired_installation_date: string | null };
type RelatedCall = { id: string; outcome: 'no_answer' | 'follow_up' | 'positive' | 'negative'; summary: string; call_at: string; contact_name: string | null };
type RelatedTask = { id: string; title: string; status: 'open' | 'done' | 'cancelled'; due_date: string | null; priority: 'low' | 'normal' | 'high' };

type EditDraft = {
  customer_type: CustomerType;
  company_name: string; organization_number: string;
  first_name: string; last_name: string; personal_number: string;
  email: string; phone: string; mobile: string;
  visit_street: string; visit_postal_code: string; visit_city: string;
  delivery_street: string; delivery_postal_code: string; delivery_city: string;
  invoice_street: string; invoice_postal_code: string; invoice_city: string;
  invoice_email: string; payment_terms: string; price_list: string;
  discount: string; vat_number: string; reverse_vat: boolean;
  annual_revenue: string; number_of_employees: string;
  legal_entity_type: string; sni_code: string; sni_name: string;
  operating_profit: string; profit_after_financial_items: string; total_assets: string;
  operating_margin: string; equity_ratio: string; financial_year: string;
};

type ContactDraft = { name: string; role: string; phone: string; email: string; is_primary: boolean };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const quoteStatusLabel: Record<string, string> = {
  draft: 'Utkast', sent: 'Skickad', follow_up: 'Följ upp', won: 'Vunnen', lost: 'Förlorad',
};

const callOutcomeLabel: Record<string, string> = {
  no_answer: 'Inget svar', follow_up: 'Följ upp', positive: 'Positiv', negative: 'Negativ',
};

const taskStatusLabel: Record<string, string> = {
  open: 'Öppen', done: 'Klar', cancelled: 'Avbruten',
};

function getDisplayName(c: Customer): string {
  if (c.customer_type === 'business') return c.company_name || 'Okänt företag';
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Okänd kund';
}

function formatAddress(addr: CustomerAddress): string {
  if (!addr) return '–';
  const parts = [addr.street, addr.postal_code, addr.city].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '–';
}

function formatDate(v: string | null | undefined) {
  if (!v) return '–';
  const d = new Date(`${v}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '–' : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(d);
}

function formatDateTime(v: string | null | undefined) {
  if (!v) return '–';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '–' : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

function formatCurrency(value: number, code: string) {
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: code || 'SEK', maximumFractionDigits: 0 }).format(value);
}

function formatSek(value: number | null | undefined): string | null {
  if (value == null) return null;
  return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(value)} kr`;
}

function formatPercent(value: number | null | undefined): string | null {
  if (value == null) return null;
  return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 }).format(value)} %`;
}

function buildAddress(street: string, postalCode: string, city: string) {
  if (!street && !postalCode && !city) return null;
  return { street: street || null, postal_code: postalCode || null, city: city || null };
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function BackArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className={cn('mb-4', crm.sectionTitle)}>{children}</p>;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className={crm.label}>{children}</p>;
}

function InfoField({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-700">{value || '–'}</p>
    </div>
  );
}

// Address value with the customer card's empty-state: falls back to a plain dash when
// no address parts are set, otherwise renders the shared tap-to-navigate AddressLink.
function AddressValue({ addr }: { addr: CustomerAddress }) {
  const text = formatAddress(addr);
  if (!addr || text === '–') {
    return <p className="text-sm leading-relaxed text-slate-700">–</p>;
  }
  return <AddressLink value={text} className="text-sm" />;
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(crm.cardInner, className)}>
      {children}
    </div>
  );
}

function AddressEditColumn({
  label, street, postalCode, city, email,
  onStreet, onPostal, onCity, onEmail,
}: {
  label: string; street: string; postalCode: string; city: string; email?: string;
  onStreet: (v: string) => void; onPostal: (v: string) => void; onCity: (v: string) => void;
  onEmail?: (v: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <Input value={street} onChange={(e) => onStreet(e.target.value)} placeholder="Gatuadress" />
      <div className="grid grid-cols-2 gap-2">
        <Input value={postalCode} onChange={(e) => onPostal(e.target.value)} placeholder="Postnr" />
        <Input value={city} onChange={(e) => onCity(e.target.value)} placeholder="Stad" />
      </div>
      {onEmail !== undefined && email !== undefined ? (
        <Input value={email} onChange={(e) => onEmail(e.target.value)} placeholder="Faktura-epost" type="email" />
      ) : null}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CustomerDetailClient({ customerId, fortnoxConnected }: { customerId: string; fortnoxConnected: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // When opened from the offer or a work order, go back there. Only same-origin CRM paths are
  // accepted (no open-redirect). The offer also re-selects this customer via created_customer_id
  // so edited details flow into the quote; a work order just returns to where we were.
  const returnTo = (() => {
    const rt = searchParams.get('returnTo');
    if (!rt) return null;
    const isOfferPath = rt === '/crm/offerter' || rt.startsWith('/crm/offerter/') || rt.startsWith('/crm/offerter?');
    return isOfferPath || rt.startsWith('/crm/arbetsorder/') ? rt : null;
  })();
  // The offer FORM (/crm/offerter/ny · /[id]/redigera) re-selects this customer via
  // created_customer_id so edited details flow into the draft. The offer LIST (/crm/offerter?quote_id=,
  // opened from a quote's detail modal) just returns to reopen the modal — no customer injection.
  const isOfferFormReturn = returnTo?.startsWith('/crm/offerter/') ?? false;
  const isOfferReturn = returnTo === '/crm/offerter' || returnTo?.startsWith('/crm/offerter/') || returnTo?.startsWith('/crm/offerter?') || false;
  const sep = returnTo?.includes('?') ? '&' : '?';
  const backTo = returnTo
    ? (isOfferFormReturn ? `${returnTo}${sep}created_customer_id=${customerId}` : returnTo)
    : '/crm/kunder';
  const backLabel = returnTo ? (isOfferReturn ? 'Tillbaka till offert' : 'Tillbaka till order') : 'Kundregister';
  const toast = useToast();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [pushingFortnox, setPushingFortnox] = useState(false);
  const [fetchingCredit, setFetchingCredit] = useState(false);
  const [enriching, setEnriching] = useState(false);

  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [addingContact, setAddingContact] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState<ContactDraft>({ name: '', role: '', phone: '', email: '', is_primary: false });

  const [sellers, setSellers] = useState<Seller[]>([]);
  const [savingManager, setSavingManager] = useState(false);

  const [quotes, setQuotes] = useState<RelatedQuote[]>([]);
  const [workOrders, setWorkOrders] = useState<RelatedWorkOrder[]>([]);
  const [calls, setCalls] = useState<RelatedCall[]>([]);
  const [tasks, setTasks] = useState<RelatedTask[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/crm/customers/${customerId}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !json.ok) { setError(json?.error || 'Kunde inte ladda kund'); return; }
        const c: Customer = json.data?.item;
        setCustomer(c); setContacts(c.contacts || []);
      } catch { if (active) setError('Kunde inte ladda kund'); }
      finally { if (active) setLoading(false); }
    }
    load();
    return () => { active = false; };
  }, [customerId]);

  // Säljare för kundansvarig-väljaren (profiles sales/admin, läs-katalog).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/crm/sellers', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (active && res.ok && json.ok) setSellers(json.data?.sellers || []);
      } catch { /* icke-kritiskt: väljaren visar bara id-fallback */ }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!customer) return;
    let active = true;
    async function load() {
      setRelatedLoading(true);
      try {
        const [quoteRes, woRes, callRes, taskRes] = await Promise.all([
          fetch(`/api/crm/quotes?customer_id=${customerId}`, { cache: 'no-store' }),
          fetch(`/api/crm/work-orders?customer_id=${customerId}`, { cache: 'no-store' }),
          fetch(`/api/crm/calls?customer_id=${customerId}`, { cache: 'no-store' }),
          fetch(`/api/crm/tasks?customer_id=${customerId}`, { cache: 'no-store' }),
        ]);
        const [quoteJson, woJson, callJson, taskJson] = await Promise.all([
          quoteRes.json().catch(() => ({})), woRes.json().catch(() => ({})),
          callRes.json().catch(() => ({})), taskRes.json().catch(() => ({})),
        ]);
        if (!active) return;
        setQuotes(quoteRes.ok && quoteJson.ok ? quoteJson.data?.items || [] : []);
        setWorkOrders(woRes.ok && woJson.ok ? woJson.data?.items || [] : []);
        setCalls(callRes.ok && callJson.ok ? callJson.data?.items || [] : []);
        setTasks(taskRes.ok && taskJson.ok ? taskJson.data?.items || [] : []);
      } catch { if (active) { setQuotes([]); setWorkOrders([]); setCalls([]); setTasks([]); } }
      finally { if (active) setRelatedLoading(false); }
    }
    load();
    return () => { active = false; };
  }, [customer, customerId]);

  function startEditing() {
    if (!customer) return;
    setEditDraft({
      customer_type: customer.customer_type,
      company_name: customer.company_name || '',
      organization_number: customer.organization_number || '',
      first_name: customer.first_name || '',
      last_name: customer.last_name || '',
      personal_number: customer.personal_number || '',
      email: customer.email || '',
      phone: customer.phone || '',
      mobile: customer.mobile || '',
      visit_street: customer.visit_address?.street || '',
      visit_postal_code: customer.visit_address?.postal_code || '',
      visit_city: customer.visit_address?.city || '',
      delivery_street: customer.delivery_address?.street || '',
      delivery_postal_code: customer.delivery_address?.postal_code || '',
      delivery_city: customer.delivery_address?.city || '',
      invoice_street: customer.invoice_address?.street || '',
      invoice_postal_code: customer.invoice_address?.postal_code || '',
      invoice_city: customer.invoice_address?.city || '',
      invoice_email: customer.invoice_email || '',
      payment_terms: customer.payment_terms || '',
      price_list: customer.price_list || '',
      discount: customer.discount != null ? String(customer.discount) : '',
      vat_number: customer.vat_number || '',
      reverse_vat: customer.reverse_vat ?? false,
      annual_revenue: customer.annual_revenue != null ? String(customer.annual_revenue) : '',
      number_of_employees: customer.number_of_employees != null ? String(customer.number_of_employees) : '',
      legal_entity_type: customer.legal_entity_type || '',
      sni_code: customer.sni_code || '',
      sni_name: customer.sni_name || '',
      operating_profit: customer.operating_profit != null ? String(customer.operating_profit) : '',
      profit_after_financial_items: customer.profit_after_financial_items != null ? String(customer.profit_after_financial_items) : '',
      total_assets: customer.total_assets != null ? String(customer.total_assets) : '',
      operating_margin: customer.operating_margin != null ? String(customer.operating_margin) : '',
      equity_ratio: customer.equity_ratio != null ? String(customer.equity_ratio) : '',
      financial_year: customer.financial_year != null ? String(customer.financial_year) : '',
    });
    setEditing(true);
  }

  function setField<K extends keyof EditDraft>(key: K, value: EditDraft[K]) {
    setEditDraft((c) => c ? { ...c, [key]: value } : c);
  }

  // Mask the org number and auto-derive the VAT number from it, but only while the
  // VAT field is still empty so a manually entered/edited VAT is preserved.
  function setOrgNumber(value: string) {
    const formatted = formatSwedishIdNumber(value);
    setEditDraft((c) => {
      if (!c) return c;
      const next = { ...c, organization_number: formatted };
      if (!c.vat_number.trim()) {
        const derived = vatFromOrgNumber(formatted);
        if (derived) next.vat_number = derived;
      }
      return next;
    });
  }

  async function saveEdits() {
    if (!customer || !editDraft) return;
    if (customer.customer_type === 'private' && !editDraft.personal_number.trim()) {
      toast.error('Personnummer krävs för privatkund'); return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        customer_type: editDraft.customer_type,
        company_name: editDraft.company_name.trim() || null,
        organization_number: editDraft.organization_number.trim() || null,
        first_name: editDraft.first_name.trim() || null,
        last_name: editDraft.last_name.trim() || null,
        personal_number: editDraft.personal_number.trim() || null,
        email: editDraft.email.trim() || null,
        phone: editDraft.phone.trim() || null,
        mobile: editDraft.mobile.trim() || null,
        visit_address: buildAddress(editDraft.visit_street, editDraft.visit_postal_code, editDraft.visit_city),
        delivery_address: buildAddress(editDraft.delivery_street, editDraft.delivery_postal_code, editDraft.delivery_city),
        invoice_address: buildAddress(editDraft.invoice_street, editDraft.invoice_postal_code, editDraft.invoice_city),
        invoice_email: editDraft.invoice_email.trim() || null,
        payment_terms: editDraft.payment_terms.trim() || null,
        price_list: editDraft.price_list.trim() || null,
        discount: editDraft.discount.trim() ? Number(editDraft.discount) : null,
        vat_number: editDraft.vat_number.trim() || null,
        reverse_vat: editDraft.reverse_vat,
        annual_revenue: editDraft.annual_revenue.trim() ? Number(editDraft.annual_revenue) : null,
        number_of_employees: editDraft.number_of_employees.trim() ? Number(editDraft.number_of_employees) : null,
        legal_entity_type: editDraft.legal_entity_type.trim() || null,
        sni_code: editDraft.sni_code.trim() || null,
        sni_name: editDraft.sni_name.trim() || null,
        operating_profit: editDraft.operating_profit.trim() ? Number(editDraft.operating_profit) : null,
        profit_after_financial_items: editDraft.profit_after_financial_items.trim() ? Number(editDraft.profit_after_financial_items) : null,
        total_assets: editDraft.total_assets.trim() ? Number(editDraft.total_assets) : null,
        operating_margin: editDraft.operating_margin.trim() ? Number(editDraft.operating_margin) : null,
        equity_ratio: editDraft.equity_ratio.trim() ? Number(editDraft.equity_ratio) : null,
        financial_year: editDraft.financial_year.trim() ? Number(editDraft.financial_year) : null,
      };
      const res = await fetch(`/api/crm/customers/${customer.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte uppdatera kund'); return; }
      const updated: Customer = json.data?.item;
      if (updated) { setCustomer(updated); setContacts(updated.contacts || []); }
      setEditing(false);
      if (json.data?.fortnox_error) {
        toast.error(`Kund uppdaterad men Fortnox-synk misslyckades: ${json.data.fortnox_error}`);
      } else {
        toast.success('Kund uppdaterad');
      }
    } catch { toast.error('Fel vid uppdatering'); }
    finally { setSaving(false); }
  }

  // Inline-byte av kundansvarig utan att gå in i redigeringsläget (vanligt när en säljare
  // slutar och kunden ska tilldelas en ny). Partiell PATCH — routen skriver bara detta fält.
  async function saveAccountManager(accountManagerId: string) {
    if (!customer) return;
    const value = accountManagerId || null;
    setSavingManager(true);
    try {
      const res = await fetch(`/api/crm/customers/${customer.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_manager_id: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte ändra kundansvarig'); return; }
      setCustomer((c) => c ? { ...c, account_manager_id: value } : c);
      toast.success('Kundansvarig uppdaterad');
    } catch { toast.error('Fel vid ändring av kundansvarig'); }
    finally { setSavingManager(false); }
  }

  async function pushToFortnox() {
    if (!customer) return;
    setPushingFortnox(true);
    try {
      const res = await fetch(`/api/crm/customers/${customer.id}/fortnox`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte skapa kund i Fortnox'); return; }
      const updated: Customer = json.data?.item;
      if (updated) { setCustomer(updated); setContacts(updated.contacts || []); }
      if (json.data?.fortnox_error) {
        toast.error(`Fortnox-push misslyckades: ${json.data.fortnox_error}`);
      } else {
        toast.success(updated?.fortnox_customer_id ? `Kund skapad i Fortnox (#${updated.fortnox_customer_id})` : 'Kund synkad med Fortnox');
      }
    } catch { toast.error('Fel vid Fortnox-push'); }
    finally { setPushingFortnox(false); }
  }

  // Enrich the customer's company data from tic.io (fills only empty fields). Mainly for
  // Fortnox-imported customers that never went through the create-form lookup.
  async function fetchCompanyData() {
    if (!customer) return;
    setEnriching(true);
    try {
      const res = await fetch(`/api/crm/customers/${customer.id}/enrich`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte hämta företagsdata'); return; }
      const updated: Customer = json.data?.item;
      if (updated) { setCustomer(updated); setContacts(updated.contacts || []); }
      const filled = json.data?.filled ?? 0;
      toast.success(filled > 0 ? `Företagsdata hämtad (${filled} fält ifyllda)` : 'Inga nya fält att fylla – datan är redan komplett');
    } catch { toast.error('Fel vid hämtning av företagsdata'); }
    finally { setEnriching(false); }
  }

  // Manually pull a tic.io credit report and persist the snapshot (writer-gated server-side).
  async function fetchCreditReport() {
    if (!customer) return;
    setFetchingCredit(true);
    try {
      const res = await fetch(`/api/crm/customers/${customer.id}/credit`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte hämta kreditupplysning'); return; }
      const updated: Customer = json.data?.item;
      if (updated) { setCustomer(updated); setContacts(updated.contacts || []); }
      toast.success('Kreditupplysning hämtad');
    } catch { toast.error('Fel vid hämtning av kreditupplysning'); }
    finally { setFetchingCredit(false); }
  }

  async function saveContact() {
    if (!customer || !contactDraft.name.trim()) { toast.error('Namn krävs'); return; }
    setSavingContact(true);
    try {
      const res = await fetch(`/api/crm/customers/${customer.id}/contacts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: contactDraft.name.trim(), role: contactDraft.role.trim() || null,
          phone: contactDraft.phone.trim() || null, email: contactDraft.email.trim() || null,
          is_primary: contactDraft.is_primary,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte lägga till kontakt'); return; }
      const contact: CustomerContact = json.data?.item;
      if (contact) setContacts((c) => [...c, contact]);
      setContactDraft({ name: '', role: '', phone: '', email: '', is_primary: false });
      setAddingContact(false);
      toast.success('Kontakt tillagd');
    } catch { toast.error('Fel vid tillägg'); }
    finally { setSavingContact(false); }
  }

  async function deleteContact(contactId: string) {
    if (!customer) return;
    try {
      const res = await fetch(`/api/crm/customers/${customer.id}/contacts/${contactId}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte ta bort kontakt'); return; }
      setContacts((c) => c.filter((ct) => ct.id !== contactId));
      toast.success('Kontakt borttagen');
    } catch { toast.error('Fel vid borttagning'); }
  }

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-6">
        <div className="h-7 w-32 animate-pulse rounded-lg bg-[#dfe6da]" />
        <div className="h-10 w-72 animate-pulse rounded-xl bg-[#dfe6da]" />
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="grid gap-5">
            <div className="h-40 animate-pulse rounded-2xl bg-[#dfe6da]" />
            <div className="h-24 animate-pulse rounded-2xl bg-[#dfe6da]" />
            <div className="h-32 animate-pulse rounded-2xl bg-[#dfe6da]" />
          </div>
          <div className="grid gap-4">
            <div className="h-28 animate-pulse rounded-2xl bg-[#dfe6da]" />
            <div className="h-24 animate-pulse rounded-2xl bg-[#dfe6da]" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="grid gap-4">
        <button type="button" onClick={() => router.push(backTo)} className="inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition">
          <BackArrow /> {backLabel}
        </button>
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">{error || 'Kunden hittades inte.'}</div>
      </div>
    );
  }

  const displayName = getDisplayName(customer);
  const isB2B = customer.customer_type === 'business';
  const hasCompanyInfo = Boolean(
    customer.legal_entity_type || customer.sni_code || customer.sni_name ||
    customer.annual_revenue != null || customer.number_of_employees != null ||
    customer.operating_profit != null || customer.profit_after_financial_items != null ||
    customer.total_assets != null || customer.operating_margin != null ||
    customer.equity_ratio != null || customer.financial_year != null ||
    (customer.risk_indicators && customer.risk_indicators.length > 0)
  );

  // ─── Sidebar (shared between read + edit views) ────────────────────────────

  const historySidebar = (
    <div className="grid gap-4">

      {/* Metadata */}
      <Card>
        <SectionTitle>Metadata</SectionTitle>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Kundansvarig</p>
            <Select
              value={customer.account_manager_id || ''}
              onChange={(e) => saveAccountManager(e.target.value)}
              disabled={savingManager}
            >
              <option value="">— Ingen —</option>
              {/* Behåll nuvarande värde valbart även om säljaren fallit ur listan (t.ex. slutat). */}
              {customer.account_manager_id && !sellers.some((s) => s.id === customer.account_manager_id) ? (
                <option value={customer.account_manager_id}>Okänd säljare</option>
              ) : null}
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>{s.full_name || s.id}</option>
              ))}
            </Select>
          </div>
          <InfoField label="Skapad" value={formatDateTime(customer.created_at)} />
          <InfoField label="Senast ändrad" value={formatDateTime(customer.updated_at)} />
          {customer.fortnox_customer_id ? (
            <InfoField label="Fortnox kund-ID" value={`#${customer.fortnox_customer_id}`} />
          ) : null}
        </div>
      </Card>

      {/* Offerter */}
      <div className="rounded-2xl border border-amber-100 bg-gradient-to-b from-[#f9fbf7] to-amber-50/40 p-5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-600">Offerter</p>
          <a href="/crm/offerter" className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition">Offerter →</a>
        </div>
        {relatedLoading ? (
          <div className="h-8 animate-pulse rounded-lg bg-[#dfe6da]" />
        ) : quotes.length === 0 ? (
          <p className="text-xs text-slate-400">Inga kopplade.</p>
        ) : (
          <div className="grid gap-1.5">
            {quotes.map((quote) => (
              <a key={quote.id} href={`/crm/offerter?quote_id=${quote.id}`} className="block rounded-xl border border-slate-100 bg-white px-3 py-2 transition hover:border-amber-200 hover:bg-amber-50/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-slate-800">{quote.project_name}</span>
                  <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                    {quoteStatusLabel[quote.status] || quote.status}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">{formatCurrency(quote.amount, quote.currency_code)} · {formatDate(quote.quote_date)}</p>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Arbetsorder */}
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Arbetsorder</p>
          <a href="/crm/arbetsorder" className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition">Arbetsorder →</a>
        </div>
        {relatedLoading ? (
          <div className="h-8 animate-pulse rounded-lg bg-[#dfe6da]" />
        ) : workOrders.length === 0 ? (
          <p className="text-xs text-slate-400">Inga kopplade.</p>
        ) : (
          <div className="grid gap-1.5">
            {workOrders.map((wo) => (
              <a key={wo.id} href={`/crm/arbetsorder/${wo.id}`} className="block rounded-xl border border-slate-100 bg-white px-3 py-2 transition hover:border-slate-300 hover:bg-slate-50">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-slate-800">{wo.project_name}</span>
                  <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {(workOrderStatusLabel as Record<string, string>)[wo.status] || wo.status}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">#{wo.order_number}{wo.desired_installation_date ? ` · ${formatDate(wo.desired_installation_date)}` : ''}</p>
              </a>
            ))}
          </div>
        )}
      </Card>

      {/* Samtal */}
      <div className="rounded-2xl border border-sky-100 bg-gradient-to-b from-[#f9fbf7] to-sky-50/40 p-5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-600">Samtal</p>
          <a href="/crm/samtal" className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition">Samtal →</a>
        </div>
        {relatedLoading ? (
          <div className="h-8 animate-pulse rounded-lg bg-[#dfe6da]" />
        ) : calls.length === 0 ? (
          <p className="text-xs text-slate-400">Inga kopplade.</p>
        ) : (
          <div className="grid gap-1.5">
            {calls.map((call) => (
              <a key={call.id} href={`/crm/samtal?call_id=${call.id}`} className="block rounded-xl border border-slate-100 bg-white px-3 py-2 transition hover:border-sky-200 hover:bg-sky-50/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-slate-800">{call.summary || call.contact_name || 'Samtal'}</span>
                  <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                    {callOutcomeLabel[call.outcome] || call.outcome}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(call.call_at)}</p>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Uppgifter */}
      <div className="rounded-2xl border border-rose-100 bg-gradient-to-b from-[#f9fbf7] to-rose-50/40 p-5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-500">Uppgifter</p>
          <a href="/crm/uppgifter" className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition">Uppgifter →</a>
        </div>
        {relatedLoading ? (
          <div className="h-8 animate-pulse rounded-lg bg-[#dfe6da]" />
        ) : tasks.length === 0 ? (
          <p className="text-xs text-slate-400">Inga kopplade.</p>
        ) : (
          <div className="grid gap-1.5">
            {tasks.map((task) => (
              <a key={task.id} href={`/crm/uppgifter?task_id=${task.id}`} className="block rounded-xl border border-slate-100 bg-white px-3 py-2 transition hover:border-rose-200 hover:bg-rose-50/50">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('min-w-0 truncate text-sm', task.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800')}>{task.title}</span>
                  <span className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                    {taskStatusLabel[task.status] || task.status}
                  </span>
                </div>
                {task.due_date ? <p className="mt-0.5 text-xs text-slate-400">Förfaller {formatDate(task.due_date)}</p> : null}
              </a>
            ))}
          </div>
        )}
      </div>

    </div>
  );

  // ─── Edit mode ─────────────────────────────────────────────────────────────

  if (editing && editDraft) {
    return (
      <div className="grid gap-6 pb-10">
        <div>
          <button type="button" onClick={() => setEditing(false)} className="mb-2 inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition">
            <BackArrow /> Avbryt redigering
          </button>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Redigera kund</h1>
          <p className="m-0 mt-0.5 text-sm text-slate-500">{displayName}</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-start">
          <div className="grid gap-5">

            {/* Grundinfo + Kontakt */}
            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <SectionTitle>Grundinfo</SectionTitle>
                <div className="grid gap-3">
                  {isB2B ? (
                    <>
                      <div>
                        <FieldLabel>Företagsnamn</FieldLabel>
                        <Input value={editDraft.company_name} onChange={(e) => setField('company_name', e.target.value)} placeholder="AB Exempelbolaget" />
                      </div>
                      <div>
                        <FieldLabel>Organisationsnummer</FieldLabel>
                        <Input value={editDraft.organization_number} onChange={(e) => setOrgNumber(e.target.value)} placeholder="556000-0000" />
                        {editDraft.organization_number.replace(/\D/g, '').length === 10 && !isValidSwedishOrgNumber(editDraft.organization_number) ? (
                          <p className="mt-1 text-xs text-amber-600">Ogiltigt organisationsnummer – kontrollsiffran stämmer inte.</p>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <FieldLabel>Förnamn</FieldLabel>
                          <Input value={editDraft.first_name} onChange={(e) => setField('first_name', e.target.value)} placeholder="Anna" />
                        </div>
                        <div>
                          <FieldLabel>Efternamn</FieldLabel>
                          <Input value={editDraft.last_name} onChange={(e) => setField('last_name', e.target.value)} placeholder="Svensson" />
                        </div>
                      </div>
                      <div>
                        <FieldLabel>Personnummer *</FieldLabel>
                        <Input value={editDraft.personal_number} onChange={(e) => setField('personal_number', formatSwedishIdNumber(e.target.value))} placeholder="ÅÅMMDD-XXXX" />
                      </div>
                    </>
                  )}
                </div>
              </Card>

              <Card>
                <SectionTitle>Kontakt</SectionTitle>
                <div className="grid gap-3">
                  <div>
                    <FieldLabel>E-post</FieldLabel>
                    <Input value={editDraft.email} onChange={(e) => setField('email', e.target.value)} placeholder="info@foretaget.se" type="email" />
                  </div>
                  <div>
                    <FieldLabel>Telefon</FieldLabel>
                    <Input value={editDraft.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="08-123 456 78" />
                  </div>
                  <div>
                    <FieldLabel>Mobil</FieldLabel>
                    <Input value={editDraft.mobile} onChange={(e) => setField('mobile', e.target.value)} placeholder="070-123 456 78" />
                  </div>
                  {/* Kundansvarig redigeras via inline-väljaren i Metadata (sparas direkt, gäller
                      i både läs- och redigeringsläget) — inte här, för att inte "Spara ändringar"
                      ska skriva över ett direktsatt värde med ett inaktuellt utkast. */}
                </div>
              </Card>
            </div>

            {/* Adresser */}
            <Card>
              <SectionTitle>Adresser</SectionTitle>
              <div className="grid gap-5 lg:grid-cols-3">
                <AddressEditColumn label="Besöksadress"
                  street={editDraft.visit_street} postalCode={editDraft.visit_postal_code} city={editDraft.visit_city}
                  onStreet={(v) => setField('visit_street', v)} onPostal={(v) => setField('visit_postal_code', v)} onCity={(v) => setField('visit_city', v)}
                />
                <AddressEditColumn label="Leveransadress"
                  street={editDraft.delivery_street} postalCode={editDraft.delivery_postal_code} city={editDraft.delivery_city}
                  onStreet={(v) => setField('delivery_street', v)} onPostal={(v) => setField('delivery_postal_code', v)} onCity={(v) => setField('delivery_city', v)}
                />
                <AddressEditColumn label="Fakturaadress"
                  street={editDraft.invoice_street} postalCode={editDraft.invoice_postal_code} city={editDraft.invoice_city}
                  email={editDraft.invoice_email}
                  onStreet={(v) => setField('invoice_street', v)} onPostal={(v) => setField('invoice_postal_code', v)} onCity={(v) => setField('invoice_city', v)}
                  onEmail={(v) => setField('invoice_email', v)}
                />
              </div>
            </Card>

            {/* Fakturainst */}
            <Card>
              <SectionTitle>Fakturainställningar</SectionTitle>
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div><FieldLabel>Betalningsvillkor</FieldLabel><FortnoxCodeSelect value={editDraft.payment_terms} onChange={(v) => setField('payment_terms', v)} endpoint="/api/fortnox/terms-of-payment" emptyLabel="Standard (Fortnox)" placeholder="30 dagar" /></div>
                  <div><FieldLabel>Prislista</FieldLabel><FortnoxCodeSelect value={editDraft.price_list} onChange={(v) => setField('price_list', v)} endpoint="/api/fortnox/price-lists" emptyLabel="Standard (Fortnox)" placeholder="A" /></div>
                  <div><FieldLabel>Rabatt (%)</FieldLabel><Input value={editDraft.discount} onChange={(e) => setField('discount', e.target.value)} placeholder="0" type="number" min="0" max="100" step="0.01" /></div>
                  {isB2B ? (
                    <div><FieldLabel>Momsreg-nummer</FieldLabel><Input value={editDraft.vat_number} onChange={(e) => setField('vat_number', e.target.value)} placeholder="SE556…" /></div>
                  ) : null}
                </div>
                {isB2B ? (
                  <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
                    <input type="checkbox" checked={editDraft.reverse_vat} onChange={(e) => setField('reverse_vat', e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-emerald-600" />
                    Omvänd skattskyldighet
                  </label>
                ) : null}
              </div>
            </Card>

            {/* Företagsinformation (företag) */}
            {isB2B ? (
              <Card>
                <SectionTitle>Företagsinformation</SectionTitle>
                <div className="grid gap-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div><FieldLabel>Bolagsform</FieldLabel><Input value={editDraft.legal_entity_type} onChange={(e) => setField('legal_entity_type', e.target.value)} placeholder="Aktiebolag" /></div>
                    <div><FieldLabel>SNI-kod</FieldLabel><Input value={editDraft.sni_code} onChange={(e) => setField('sni_code', e.target.value)} placeholder="43990" /></div>
                    <div><FieldLabel>Bransch</FieldLabel><Input value={editDraft.sni_name} onChange={(e) => setField('sni_name', e.target.value)} placeholder="Bygg- och anläggning" /></div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div><FieldLabel>Omsättning (SEK)</FieldLabel><Input value={editDraft.annual_revenue} onChange={(e) => setField('annual_revenue', e.target.value)} placeholder="0" type="number" step="1" /></div>
                    <div><FieldLabel>Antal anställda</FieldLabel><Input value={editDraft.number_of_employees} onChange={(e) => setField('number_of_employees', e.target.value)} placeholder="0" type="number" step="1" /></div>
                    <div><FieldLabel>Rörelseresultat (SEK)</FieldLabel><Input value={editDraft.operating_profit} onChange={(e) => setField('operating_profit', e.target.value)} placeholder="0" type="number" step="1" /></div>
                    <div><FieldLabel>Resultat e. fin. poster (SEK)</FieldLabel><Input value={editDraft.profit_after_financial_items} onChange={(e) => setField('profit_after_financial_items', e.target.value)} placeholder="0" type="number" step="1" /></div>
                    <div><FieldLabel>Totala tillgångar (SEK)</FieldLabel><Input value={editDraft.total_assets} onChange={(e) => setField('total_assets', e.target.value)} placeholder="0" type="number" step="1" /></div>
                    <div><FieldLabel>Rörelsemarginal (%)</FieldLabel><Input value={editDraft.operating_margin} onChange={(e) => setField('operating_margin', e.target.value)} placeholder="0" type="number" step="0.1" /></div>
                    <div><FieldLabel>Soliditet (%)</FieldLabel><Input value={editDraft.equity_ratio} onChange={(e) => setField('equity_ratio', e.target.value)} placeholder="0" type="number" step="0.1" /></div>
                    <div><FieldLabel>Räkenskapsår</FieldLabel><Input value={editDraft.financial_year} onChange={(e) => setField('financial_year', e.target.value)} placeholder="2024" type="number" step="1" /></div>
                  </div>
                </div>
              </Card>
            ) : null}

          </div>

          {/* Right sidebar: save + history */}
          <div className="grid gap-4 lg:sticky lg:top-6">
            <Card>
              <div className="grid gap-2">
                <button type="button" onClick={saveEdits} disabled={saving} className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-emerald-600 bg-gradient-to-b from-emerald-500 to-emerald-600 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(16,185,129,0.28)] transition hover:brightness-[0.97] disabled:opacity-60">
                  {saving ? 'Sparar…' : 'Spara ändringar'}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 transition hover:border-slate-300">
                  Avbryt
                </button>
              </div>
            </Card>
            {historySidebar}
          </div>
        </div>
      </div>
    );
  }

  // ─── Read view ─────────────────────────────────────────────────────────────

  return (
    <div className="grid gap-6 pb-10">

      {/* Header */}
      <div>
        <button type="button" onClick={() => router.push(backTo)} className="mb-2 inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition">
          <BackArrow /> {backLabel}
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', customerStageClass[customer.customer_stage])}>
                {customerStageLabel[customer.customer_stage]}
              </span>
              {customer.customer_stage === 'fortnox_customer' ? (
                <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', syncStatusClass[customer.sync_status])}>
                  {syncStatusLabel[customer.sync_status]}
                </span>
              ) : null}
              <span className="text-xs text-slate-400">{isB2B ? 'Företag' : 'Privat'}</span>
            </div>
            <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">{displayName}</h1>
            {customer.organization_number ? <p className="m-0 text-sm text-slate-500">Org-nr: {customer.organization_number}</p> : null}
            {customer.personal_number ? <p className="m-0 text-sm text-slate-500">Personnr: {customer.personal_number}</p> : null}
          </div>
          <button type="button" onClick={startEditing} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M10 2l2 2-7 7H3v-2l7-7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Redigera
          </button>
        </div>
      </div>

      {/* Body: main + sidebar */}
      <div className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-start">

        {/* Left: customer info */}
        <div className="grid gap-5">

          {/* Kontakt + Adresser */}
          <Card>
            <SectionTitle>Kontakt &amp; Adresser</SectionTitle>
            <div className="grid gap-5">

              {/* Kontakt row */}
              {(customer.email || customer.phone || customer.mobile) ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {customer.email ? <InfoField label="E-post" value={<EmailLink value={customer.email} />} /> : null}
                  {customer.phone ? <InfoField label="Telefon" value={<PhoneLink value={customer.phone} />} /> : null}
                  {customer.mobile ? <InfoField label="Mobil" value={<PhoneLink value={customer.mobile} />} /> : null}
                </div>
              ) : (
                <p className="text-sm text-slate-400">Ingen kontaktinformation registrerad.</p>
              )}

              {/* Divider */}
              <div className="h-px bg-slate-100" />

              {/* 3-col addresses */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Besöksadress</p>
                  <AddressValue addr={customer.visit_address} />
                </div>
                <div className="grid gap-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Leveransadress</p>
                  <AddressValue addr={customer.delivery_address} />
                </div>
                <div className="grid gap-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Fakturaadress</p>
                  <AddressValue addr={customer.invoice_address} />
                  {customer.invoice_email ? <EmailLink value={customer.invoice_email} className="mt-1 text-xs" /> : null}
                </div>
              </div>
            </div>
          </Card>

          {/* Fakturainst (conditional) */}
          {(customer.payment_terms || customer.price_list || customer.discount != null || customer.vat_number || customer.reverse_vat) ? (
            <Card>
              <SectionTitle>Fakturainställningar</SectionTitle>
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {customer.payment_terms ? <InfoField label="Betalningsvillkor" value={customer.payment_terms} /> : null}
                  {customer.price_list ? <InfoField label="Prislista" value={customer.price_list} /> : null}
                  {customer.discount != null ? <InfoField label="Rabatt" value={`${customer.discount}%`} /> : null}
                  {customer.vat_number ? <InfoField label="Momsreg-nr" value={customer.vat_number} /> : null}
                </div>
                {customer.reverse_vat ? (
                  <span className="inline-flex w-fit rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                    Omvänd skattskyldighet
                  </span>
                ) : null}
              </div>
            </Card>
          ) : null}

          {/* Företagsinformation (företag, från tic.io-uppslaget) */}
          {isB2B ? (
            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <SectionTitle>
                  Företagsinformation
                  {customer.financial_year != null ? (
                    <span className="ml-2 text-xs font-normal normal-case tracking-normal text-slate-400">räkenskapsår {customer.financial_year}</span>
                  ) : null}
                </SectionTitle>
                <button
                  type="button"
                  onClick={fetchCompanyData}
                  disabled={enriching || !customer.organization_number}
                  className={cn(crm.ghostButton, 'shrink-0 disabled:opacity-50')}
                  title={!customer.organization_number ? 'Kräver organisationsnummer' : undefined}
                >
                  {enriching ? 'Hämtar…' : hasCompanyInfo ? 'Uppdatera' : 'Hämta företagsdata'}
                </button>
              </div>
              {!hasCompanyInfo ? (
                <p className="text-sm text-slate-500">
                  {customer.organization_number
                    ? 'Hämta bransch, bolagsform, ekonomi och risk från tic.io.'
                    : 'Lägg till ett organisationsnummer för att kunna hämta företagsdata.'}
                </p>
              ) : (
              <div className="grid gap-5">

                {/* Bransch & bolagsform */}
                {(customer.legal_entity_type || customer.sni_code || customer.sni_name) ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {customer.legal_entity_type ? <InfoField label="Bolagsform" value={customer.legal_entity_type} /> : null}
                    {customer.sni_code ? <InfoField label="SNI-kod" value={customer.sni_code} /> : null}
                    {customer.sni_name ? <InfoField label="Bransch" value={customer.sni_name} /> : null}
                  </div>
                ) : null}

                {/* Ekonomi & nyckeltal */}
                {(customer.annual_revenue != null || customer.number_of_employees != null ||
                  customer.operating_profit != null || customer.profit_after_financial_items != null ||
                  customer.total_assets != null || customer.operating_margin != null ||
                  customer.equity_ratio != null) ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {customer.annual_revenue != null ? <InfoField label="Omsättning" value={formatSek(customer.annual_revenue)} /> : null}
                    {customer.number_of_employees != null ? <InfoField label="Antal anställda" value={String(customer.number_of_employees)} /> : null}
                    {customer.operating_profit != null ? <InfoField label="Rörelseresultat" value={formatSek(customer.operating_profit)} /> : null}
                    {customer.profit_after_financial_items != null ? <InfoField label="Resultat e. fin. poster" value={formatSek(customer.profit_after_financial_items)} /> : null}
                    {customer.total_assets != null ? <InfoField label="Totala tillgångar" value={formatSek(customer.total_assets)} /> : null}
                    {customer.operating_margin != null ? <InfoField label="Rörelsemarginal" value={formatPercent(customer.operating_margin)} /> : null}
                    {customer.equity_ratio != null ? <InfoField label="Soliditet" value={formatPercent(customer.equity_ratio)} /> : null}
                  </div>
                ) : null}

                {/* Riskindikatorer */}
                {customer.risk_indicators && customer.risk_indicators.length > 0 ? (
                  <div className="grid gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Riskindikatorer</p>
                    <ul className="grid gap-1.5">
                      {customer.risk_indicators.map((r, i) => (
                        <li key={`${r.type}-${i}`} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          <span className="mt-0.5 shrink-0">⚠</span>
                          <span>
                            <span className="font-semibold">{riskTypeLabel(r.type)}</span>
                            {r.notes ? <span className="text-amber-700"> – {r.notes}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

              </div>
              )}
            </Card>
          ) : null}

          {/* Kreditupplysning (företag, tic.io /risks — manuellt hämtad) */}
          {isB2B ? (
            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <SectionTitle>
                  Kreditupplysning
                  {customer.credit_report_fetched_at ? (
                    <span className="ml-2 text-xs font-normal normal-case tracking-normal text-slate-400">
                      hämtad {formatDateTime(customer.credit_report_fetched_at)}
                    </span>
                  ) : null}
                </SectionTitle>
                {customer.credit_report ? (
                  <button
                    type="button"
                    onClick={fetchCreditReport}
                    disabled={fetchingCredit}
                    className={cn(crm.ghostButton, 'shrink-0')}
                  >
                    {fetchingCredit ? 'Hämtar…' : 'Uppdatera'}
                  </button>
                ) : null}
              </div>

              {customer.credit_report ? (
                <CreditReportSummary report={customer.credit_report} />
              ) : (
                <div className="grid gap-3 py-2">
                  <p className="text-sm text-slate-500">
                    {customer.organization_number
                      ? 'Hämta kreditbetyg, riskklass och eventuella betalningsanmärkningar från tic.io.'
                      : 'Lägg till ett organisationsnummer för att kunna hämta en kreditupplysning.'}
                  </p>
                  <button
                    type="button"
                    onClick={fetchCreditReport}
                    disabled={fetchingCredit || !customer.organization_number}
                    className={cn(crm.primaryButton, 'w-fit disabled:opacity-50')}
                    style={{ backgroundColor: 'var(--crm-primary)' }}
                  >
                    {fetchingCredit ? 'Hämtar…' : 'Hämta kreditupplysning'}
                  </button>
                </div>
              )}
            </Card>
          ) : null}

          {/* Kontaktpersoner */}
          <Card>
            <div className="flex items-center justify-between gap-3 mb-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Kontaktpersoner</p>
              <button
                type="button"
                onClick={() => setAddingContact((c) => !c)}
                className="inline-flex h-7 items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-300"
              >
                {addingContact ? 'Avbryt' : '+ Lägg till'}
              </button>
            </div>

            {addingContact ? (
              <div className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <Input value={contactDraft.name} onChange={(e) => setContactDraft((c) => ({ ...c, name: e.target.value }))} placeholder="Namn *" />
                <Input value={contactDraft.role} onChange={(e) => setContactDraft((c) => ({ ...c, role: e.target.value }))} placeholder="Roll (t.ex. Inköpschef)" />
                <div className="grid sm:grid-cols-2 gap-2">
                  <Input value={contactDraft.phone} onChange={(e) => setContactDraft((c) => ({ ...c, phone: e.target.value }))} placeholder="Telefon" />
                  <Input value={contactDraft.email} onChange={(e) => setContactDraft((c) => ({ ...c, email: e.target.value }))} placeholder="E-post" />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                    <input type="checkbox" checked={contactDraft.is_primary} onChange={(e) => setContactDraft((c) => ({ ...c, is_primary: e.target.checked }))} className="h-4 w-4 rounded border-slate-300 accent-emerald-600" />
                    Primär kontakt
                  </label>
                  <button type="button" onClick={saveContact} disabled={savingContact} className="inline-flex h-8 items-center justify-center rounded-xl border border-emerald-600 bg-gradient-to-b from-emerald-500 to-emerald-600 px-3 text-xs font-semibold text-white transition hover:brightness-[0.97] disabled:opacity-60">
                    {savingContact ? 'Sparar…' : 'Spara'}
                  </button>
                </div>
              </div>
            ) : null}

            {contacts.length === 0 && !addingContact ? (
              <p className="text-sm text-slate-400">Inga kontaktpersoner registrerade.</p>
            ) : (
              <div className="grid gap-2">
                {contacts.map((contact) => (
                  <div key={contact.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5">
                    <div className="grid gap-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{contact.name}</span>
                        {contact.is_primary ? (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Primär</span>
                        ) : null}
                        {contact.role ? <span className="text-xs text-slate-500">{contact.role}</span> : null}
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                        {contact.phone ? <PhoneLink value={contact.phone} /> : null}
                        {contact.email ? <EmailLink value={contact.email} /> : null}
                      </div>
                    </div>
                    <button type="button" onClick={() => deleteContact(contact.id)} className="shrink-0 text-xs text-slate-400 transition hover:text-rose-500">
                      Ta bort
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

        </div>

        {/* Right sidebar */}
        <div className="grid gap-4 lg:sticky lg:top-6">
          {fortnoxConnected && !customer.fortnox_customer_id ? (
            <div className="rounded-2xl border border-violet-200 bg-gradient-to-b from-violet-50 to-white p-5">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-violet-500">Fortnox</p>
              <p className="mb-3 text-xs text-slate-500 leading-relaxed">Den här kunden finns inte i Fortnox ännu. Skapa den för att kunna fakturera.</p>
              <button
                type="button"
                onClick={pushToFortnox}
                disabled={pushingFortnox}
                className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-violet-600 bg-gradient-to-b from-violet-500 to-violet-600 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(139,92,246,0.28)] transition hover:brightness-[0.97] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pushingFortnox ? 'Skapar…' : 'Skapa i Fortnox'}
              </button>
            </div>
          ) : null}
          {historySidebar}
        </div>
      </div>
    </div>
  );
}

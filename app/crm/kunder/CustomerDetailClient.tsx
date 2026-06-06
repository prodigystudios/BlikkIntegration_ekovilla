"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import FortnoxCodeSelect from './FortnoxCodeSelect';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm, customerStageLabel, customerStageClass, syncStatusLabel, syncStatusClass, opportunityStatusLabel } from '@/app/crm/lib/crmTokens';
import { formatSwedishIdNumber, isValidSwedishOrgNumber, vatFromOrgNumber } from './customerNumbers';

// ─── Types ────────────────────────────────────────────────────────────────────

type CustomerType = 'business' | 'private';
type CustomerStage = 'prospect' | 'customer' | 'fortnox_customer';
type CustomerStatus = 'active' | 'inactive' | 'churned';
type CustomerAddress = { street: string | null; postal_code: string | null; city: string | null } | null;

type CustomerContact = {
  id: string; name: string; role: string | null; phone: string | null; email: string | null; is_primary: boolean;
};

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
  fortnox_customer_id: string | null;
  sync_status: 'not_synced' | 'pending' | 'synced' | 'failed';
  created_at: string;
  updated_at: string;
  contacts: CustomerContact[];
};

import type { OpportunityStatus } from '@/app/crm/lib/crmTokens';
type RelatedOpportunity = { id: string; title: string; status: OpportunityStatus };
type RelatedQuote = { id: string; project_name: string; amount: number; currency_code: string; status: string; quote_date: string };
type RelatedWorkOrder = { id: string; order_number: string; project_name: string; status: string; desired_installation_date: string | null };

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
};

type ContactDraft = { name: string; role: string; phone: string; email: string; is_primary: boolean };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const quoteStatusLabel: Record<string, string> = {
  draft: 'Utkast', sent: 'Skickad', follow_up: 'Följ upp', won: 'Vunnen', lost: 'Förlorad',
};
const workOrderStatusLabel: Record<string, string> = {
  draft: 'Utkast', scheduled: 'Planerad', ready: 'Redo', in_progress: 'Pågående', completed: 'Klar', cancelled: 'Avbruten',
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

// Strip everything but digits and a leading + so the dialer gets a clean number
// while the displayed value keeps its human formatting (spaces, dashes).
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function PhoneGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 opacity-80">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MailGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 opacity-80">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 6 12 13 2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Clickable contact value: tap-to-call / tap-to-mail. Inherits the surrounding
// font size; only sets the accent colour + icon so it reads as actionable.
function PhoneLink({ value, className }: { value: string; className?: string }) {
  return (
    <a href={telHref(value)} className={cn('inline-flex items-center gap-1.5 font-medium text-emerald-700 transition hover:text-emerald-800 hover:underline', className)}>
      <PhoneGlyph /> {value}
    </a>
  );
}

function EmailLink({ value, className }: { value: string; className?: string }) {
  return (
    <a href={`mailto:${value}`} className={cn('inline-flex items-center gap-1.5 font-medium text-emerald-700 transition hover:text-emerald-800 hover:underline', className)}>
      <MailGlyph /> <span className="break-all">{value}</span>
    </a>
  );
}

function PinGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className="mt-0.5 shrink-0 opacity-80">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

// Address as a tap-to-navigate link. Uses the universal Google Maps URL so it
// opens the OS map app (and offers navigation) on mobile, a maps tab on desktop.
// Falls back to a plain dash when no address parts are set.
function AddressValue({ addr }: { addr: CustomerAddress }) {
  const text = formatAddress(addr);
  if (!addr || text === '–') {
    return <p className="text-sm leading-relaxed text-slate-700">–</p>;
  }
  const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1.5 text-sm font-medium leading-relaxed text-emerald-700 transition hover:text-emerald-800 hover:underline">
      <PinGlyph /> <span>{text}</span>
    </a>
  );
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
  // When opened from the offer form, go back there (and re-select this customer so
  // edited details flow into the quote). Otherwise back to the customer register.
  const returnTo = (() => {
    const rt = searchParams.get('returnTo');
    return rt && rt.startsWith('/crm/offerter/') ? rt : null;
  })();
  const backTo = returnTo ? `${returnTo}?created_customer_id=${customerId}` : '/crm/kunder';
  const backLabel = returnTo ? 'Tillbaka till offert' : 'Kundregister';
  const toast = useToast();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [pushingFortnox, setPushingFortnox] = useState(false);

  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [addingContact, setAddingContact] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState<ContactDraft>({ name: '', role: '', phone: '', email: '', is_primary: false });

  const [opportunities, setOpportunities] = useState<RelatedOpportunity[]>([]);
  const [quotes, setQuotes] = useState<RelatedQuote[]>([]);
  const [workOrders, setWorkOrders] = useState<RelatedWorkOrder[]>([]);
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

  useEffect(() => {
    if (!customer) return;
    let active = true;
    async function load() {
      setRelatedLoading(true);
      try {
        const [oppRes, quoteRes, woRes] = await Promise.all([
          fetch(`/api/crm/opportunities?customer_id=${customerId}`, { cache: 'no-store' }),
          fetch(`/api/crm/quotes?customer_id=${customerId}`, { cache: 'no-store' }),
          fetch(`/api/crm/work-orders?customer_id=${customerId}`, { cache: 'no-store' }),
        ]);
        const [oppJson, quoteJson, woJson] = await Promise.all([
          oppRes.json().catch(() => ({})), quoteRes.json().catch(() => ({})), woRes.json().catch(() => ({})),
        ]);
        if (!active) return;
        setOpportunities(oppRes.ok && oppJson.ok ? oppJson.data?.items || [] : []);
        setQuotes(quoteRes.ok && quoteJson.ok ? quoteJson.data?.items || [] : []);
        setWorkOrders(woRes.ok && woJson.ok ? woJson.data?.items || [] : []);
      } catch { if (active) { setOpportunities([]); setQuotes([]); setWorkOrders([]); } }
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

  // ─── Sidebar (shared between read + edit views) ────────────────────────────

  const historySidebar = (
    <div className="grid gap-4">

      {/* Metadata */}
      <Card>
        <SectionTitle>Metadata</SectionTitle>
        <div className="grid gap-3">
          <InfoField label="Skapad" value={formatDateTime(customer.created_at)} />
          <InfoField label="Senast ändrad" value={formatDateTime(customer.updated_at)} />
          {customer.fortnox_customer_id ? (
            <InfoField label="Fortnox kund-ID" value={`#${customer.fortnox_customer_id}`} />
          ) : null}
        </div>
      </Card>

      {/* Affärsmöjligheter */}
      <div className="rounded-2xl border border-violet-100 bg-gradient-to-b from-[#f9fbf7] to-violet-50/40 p-5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-600">Affärsmöjligheter</p>
          <a href="/crm/affarsmojligheter" className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition">Pipeline →</a>
        </div>
        {relatedLoading ? (
          <div className="h-8 animate-pulse rounded-lg bg-[#dfe6da]" />
        ) : opportunities.length === 0 ? (
          <p className="text-xs text-slate-400">Inga kopplade.</p>
        ) : (
          <div className="grid gap-1.5">
            {opportunities.map((opp) => (
              <a key={opp.id} href={`/crm/affarsmojligheter?opportunity_id=${opp.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 transition hover:border-violet-200 hover:bg-violet-50/50">
                <span className="min-w-0 truncate text-sm text-slate-800">{opp.title}</span>
                <span className="shrink-0 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                  {opportunityStatusLabel[opp.status] || opp.status}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

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
                    {workOrderStatusLabel[wo.status] || wo.status}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">#{wo.order_number}{wo.desired_installation_date ? ` · ${formatDate(wo.desired_installation_date)}` : ''}</p>
              </a>
            ))}
          </div>
        )}
      </Card>

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

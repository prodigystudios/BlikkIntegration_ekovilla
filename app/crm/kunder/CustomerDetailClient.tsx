"use client";

import { useEffect, useRef, useState } from 'react';
import { postalCodeWarning } from '@/lib/domains/crm/postalCode';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { TabsList, TabsTrigger } from '../../../components/ui/Tabs';
import FortnoxCodeSelect from './FortnoxCodeSelect';
import CollapsibleCardSection from './CollapsibleCardSection';
import PortalPartnerCard from './PortalPartnerCard';
import CustomerOverview from './CustomerOverview';
import { CallsTab, ContactsTab, QuotesTab, TasksTab, WorkOrdersTab } from './CustomerRelatedTabs';
import { cardLinkButton, Chip, CountBadge, DefinitionList, Field, Muted, SideCard } from './CustomerCardUi';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm, customerStageLabel, syncStatusLabel } from '@/app/crm/lib/crmTokens';
import { formatDateTime } from '@/app/crm/lib/format';
import { formatSwedishIdNumber, isValidSwedishOrgNumber, vatFromOrgNumber } from './customerNumbers';
import {
  changedCustomerEditFields,
  customerEditBody,
  customerEditDiscountIssue,
  type CustomerEditDraft,
} from './customerEditPatch';
import { customerDisplayName, customerInitials } from '@/app/crm/lib/customerDisplay';
import {
  formatSek,
  resolveCustomerTab,
  tabCountLabel,
  type Customer,
  type CustomerContact,
  type CustomerEditSection,
  type CustomerTab,
  type RelatedCall,
  type RelatedQuote,
  type RelatedTask,
  type RelatedWorkOrder,
} from './customerCard';
import {
  formatPersonalNumber,
  isValidPersonalNumber,
  PERSONAL_NUMBER_ERROR,
  PERSONAL_NUMBER_OPTIONAL_HINT,
} from '@/lib/domains/crm/personalNumber';
import { creditForecastPercent, creditRemarkLines, creditRiskLabel, creditScoreMeta, riskClassMeta } from '@/app/crm/components/CreditReport';
import ContactFormModal from '@/app/crm/components/ContactFormModal';
import CrmConfirmDialog from '@/app/crm/components/CrmConfirmDialog';
import { applyContactToList } from '@/app/crm/lib/contactForm';

type Seller = { id: string; full_name: string | null; role: string };

// Taken för samtals- och uppgiftslistan. Routerna har ingen räkning, så fliken säger "200+" när
// taket nås (tabCountLabel) i stället för ett tal som ser exakt ut men inte är det.
const CALLS_LIMIT = 200;
const TASKS_LIMIT = 200;

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

function Card({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={cn(crm.cardInner, className)}>
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
  // 🧨 `content-start` är inte kosmetik. Kolumnerna är griditems i en `lg:grid-cols-3` och
  // sträcks till radens höjd; med `align-content: stretch` (default) fördelas den extra höjden
  // ut på de auto-höga raderna. Fakturakolumnen har EN rad mer än de andra (faktura-eposten),
  // så besöks- och leveransadressens fält växte ~50 % över sin `min-h-11` och ingen fältkant
  // låg i linje mellan kolumnerna. `content-start` låter raderna behålla sin naturliga höjd.
  // Ett anrop, två användningar — annars kan villkoret och texten glida isär vid en framtida ändring.
  const zipWarning = postalCodeWarning(postalCode, city);

  return (
    <div className="grid content-start gap-2">
      <p className={crm.groupTitle}>{label}</p>
      <Input value={street} onChange={(e) => onStreet(e.target.value)} placeholder="Gatuadress" />
      <div className="grid grid-cols-2 gap-2">
        <Input value={postalCode} onChange={(e) => onPostal(e.target.value)} placeholder="Postnr" />
        <Input value={city} onChange={(e) => onCity(e.target.value)} placeholder="Stad" />
      </div>
      {/* Samma varning som i nykundsformuläret — se ZipWarning där. Fortnox tar bara siffror i
          ZipCode, och felet syns annars först som ett 400 flera steg senare. */}
      {zipWarning ? (
        <p className="text-[11px] leading-snug text-amber-700">{zipWarning}</p>
      ) : null}
      {onEmail !== undefined && email !== undefined ? (
        <Input value={email} onChange={(e) => onEmail(e.target.value)} placeholder="Faktura-epost" type="email" />
      ) : null}
    </div>
  );
}

// Kundstatusen i rubriken. En Fortnox-kund bär synkstatusen i samma märke ("Fortnox-kund · synkad")
// — två märken för samma koppling lästes som två saker.
function stageChip(c: Customer): { text: string; dot: string } {
  if (c.customer_stage === 'fortnox_customer') {
    const dot = { synced: 'bg-emerald-600', pending: 'bg-amber-500', failed: 'bg-rose-600', not_synced: 'bg-slate-400' }[c.sync_status];
    return { text: `${customerStageLabel.fortnox_customer} · ${syncStatusLabel[c.sync_status].toLowerCase()}`, dot };
  }
  return { text: customerStageLabel[c.customer_stage], dot: c.customer_stage === 'prospect' ? 'bg-sky-500' : 'bg-emerald-600' };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CustomerDetailClient({
  customerId,
  fortnoxConnected,
  portalPartnerEnabled = false,
  canDeleteCustomer = false,
}: {
  customerId: string;
  fortnoxConnected: boolean;
  /** Partnerrutan: crm.portal.manage och påslagen integration, avgjort på servern (kunder/[id]/page.tsx). */
  portalPartnerEnabled?: boolean;
  /** "Ta bort kund": crm.admin, avgjort på servern. DELETE-routen prövar samma nyckel själv. */
  canDeleteCustomer?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // When opened from the offer or a work order, go back there. Only same-origin CRM paths are
  // accepted (no open-redirect). The offer also re-selects this customer via created_customer_id
  // so edited details flow into the quote; a work order just returns to where we were.
  const returnTo = (() => {
    const rt = searchParams.get('returnTo');
    if (!rt) return null;
    const isOfferPath = rt === '/crm/offerter' || rt.startsWith('/crm/offerter/') || rt.startsWith('/crm/offerter?');
    // The Säljtavla opens the same quote panel as the offer list, so its customer link needs the
    // same round trip. Without it the allow-list silently drops the returnTo and the seller is
    // dumped in the customer register instead of back on the board.
    const isBoardPath = rt === '/crm/saljtavla' || rt.startsWith('/crm/saljtavla?');
    return isOfferPath || isBoardPath || rt.startsWith('/crm/arbetsorder/') ? rt : null;
  })();
  // The offer FORM (/crm/offerter/ny · /[id]/redigera) gets created_customer_id appended so it knows
  // which customer the trip was about. ⚠️ The param is sent on EVERY return, not only after creating
  // one, and the form reads it two different ways:
  //   • a DIFFERENT customer than the draft holds → prefill the whole customer block (create flow)
  //   • the SAME customer → merge: fields still carrying the card's old value are refreshed (so
  //     switching on omvänd skattskyldighet here reaches the quote), fields the seller has since
  //     edited are left alone (so their Er referens isn't overwritten)
  // The offer LIST (/crm/offerter?quote_id=, opened from a quote's detail modal) just returns to
  // reopen the modal — no customer injection.
  const isOfferFormReturn = returnTo?.startsWith('/crm/offerter/') ?? false;
  const isOfferReturn = returnTo === '/crm/offerter' || returnTo?.startsWith('/crm/offerter/') || returnTo?.startsWith('/crm/offerter?')
    || returnTo === '/crm/saljtavla' || returnTo?.startsWith('/crm/saljtavla?') || false;
  const sep = returnTo?.includes('?') ? '&' : '?';
  const backTo = returnTo
    ? (isOfferFormReturn ? `${returnTo}${sep}created_customer_id=${customerId}` : returnTo)
    : '/crm/kunder';
  const backLabel = returnTo ? (isOfferReturn ? 'Tillbaka till offert' : 'Tillbaka till order') : 'Kundregister';
  const toast = useToast();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fliken bor i adressen (`?tab=`) så att den går att länka till och står kvar efter omladdning
  // och bakåt från en offert. Samma mönster som AdminTabsClient: replaceState, så att flikbyten
  // inte fyller historiken och övriga parametrar (returnTo) står kvar.
  const [tab, setTabState] = useState<CustomerTab>(() => resolveCustomerTab(searchParams.get('tab')));
  // "Kunden är skapad" — bara direkt efter registreringen (`?skapad=1`). Parametern tas bort ur
  // adressen direkt, så att en omladdning inte visar bannern igen.
  const [createdBanner, setCreatedBanner] = useState(() => searchParams.get('skapad') === '1');

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editDraft, setEditDraft] = useState<CustomerEditDraft | null>(null);
  // Utkastet som editorn öppnades med, serialiserat — sparningen skickar bara det som ändrats sedan dess.
  const editBaseRef = useRef<Record<string, unknown> | null>(null);
  // Sektionen "Ändra" bad om. Läses när redigeringsläget har renderats och sektionen finns i DOM:en.
  const pendingEditScrollRef = useRef<CustomerEditSection | null>(null);
  const [pushingFortnox, setPushingFortnox] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Serverns nej (offerter som spärrar, Fortnox skäl) står kvar i rutan: det kräver en åtgärd, och
  // en toast är borta efter fem sekunder.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [fetchingCredit, setFetchingCredit] = useState(false);
  const [enriching, setEnriching] = useState(false);

  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  // null = stängd. `{ contact: null }` = ny, `{ contact }` = redigera. Formuläret bor i
  // ContactFormModal och delas med offerten — kortet säger bara VAD som ska redigeras.
  const [contactFormTarget, setContactFormTarget] = useState<{ contact: CustomerContact | null } | null>(null);

  const [sellers, setSellers] = useState<Seller[]>([]);
  const [savingManager, setSavingManager] = useState(false);

  const [quotes, setQuotes] = useState<RelatedQuote[]>([]);
  const [quotesTotal, setQuotesTotal] = useState<number | null>(null);
  const [workOrders, setWorkOrders] = useState<RelatedWorkOrder[]>([]);
  const [workOrdersTotal, setWorkOrdersTotal] = useState<number | null>(null);
  const [calls, setCalls] = useState<RelatedCall[]>([]);
  const [tasks, setTasks] = useState<RelatedTask[]>([]);
  // Börjar som true: flikarnas antal och listor ska visa "laddar", inte "inga", innan första hämtningen.
  const [relatedLoading, setRelatedLoading] = useState(true);

  function setTab(next: CustomerTab) {
    setTabState(next);
    const url = new URL(window.location.href);
    if (next === 'oversikt') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState({}, '', url.toString());
  }

  // Fliken följer adressen även när sidan står kvar monterad (en länk till samma kort med annan
  // `?tab=`). setTab skriver adressen själv, så det här blir ett no-op för kortets egna flikbyten.
  useEffect(() => {
    setTabState(resolveCustomerTab(searchParams.get('tab')));
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get('skapad') !== '1') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('skapad');
    window.history.replaceState({}, '', url.toString());
  }, [searchParams]);

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
          // `created_desc`: routens standard sorterar på STATUS, och då var "Senaste offerter" de två
          // första utkasten i stället för de två nyaste.
          fetch(`/api/crm/quotes?customer_id=${customerId}&sort=created_desc`, { cache: 'no-store' }),
          fetch(`/api/crm/work-orders?customer_id=${customerId}`, { cache: 'no-store' }),
          fetch(`/api/crm/calls?customer_id=${customerId}&limit=${CALLS_LIMIT}`, { cache: 'no-store' }),
          fetch(`/api/crm/tasks?customer_id=${customerId}&limit=${TASKS_LIMIT}`, { cache: 'no-store' }),
        ]);
        const [quoteJson, woJson, callJson, taskJson] = await Promise.all([
          quoteRes.json().catch(() => ({})), woRes.json().catch(() => ({})),
          callRes.json().catch(() => ({})), taskRes.json().catch(() => ({})),
        ]);
        if (!active) return;
        const quotesOk = quoteRes.ok && quoteJson.ok;
        const workOrdersOk = woRes.ok && woJson.ok;
        setQuotes(quotesOk ? quoteJson.data?.items || [] : []);
        setQuotesTotal(quotesOk && typeof quoteJson.data?.total === 'number' ? quoteJson.data.total : null);
        setWorkOrders(workOrdersOk ? woJson.data?.items || [] : []);
        setWorkOrdersTotal(workOrdersOk && typeof woJson.data?.total === 'number' ? woJson.data.total : null);
        setCalls(callRes.ok && callJson.ok ? callJson.data?.items || [] : []);
        setTasks(taskRes.ok && taskJson.ok ? taskJson.data?.items || [] : []);
      } catch {
        if (active) { setQuotes([]); setQuotesTotal(null); setWorkOrders([]); setWorkOrdersTotal(null); setCalls([]); setTasks([]); }
      }
      finally { if (active) setRelatedLoading(false); }
    }
    load();
    return () => { active = false; };
  }, [customer, customerId]);

  // "Ändra" på ett kort: hoppa till samma sektion i redigeringsläget och sätt fokus i första fältet.
  useEffect(() => {
    if (!editing) return;
    const section = pendingEditScrollRef.current;
    pendingEditScrollRef.current = null;
    if (!section) return;
    const el = document.getElementById(`redigera-${section}`);
    if (!el) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    // Första fältet som går att skriva i: Fortnox-väljarna är spärrade medan registret laddas.
    el.querySelector<HTMLElement>('input:not(:disabled), button[role="combobox"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [editing]);

  function startEditing(section?: CustomerEditSection) {
    if (!customer) return;
    const draft: CustomerEditDraft = {
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
    };
    setEditDraft(draft);
    editBaseRef.current = customerEditBody(draft);
    pendingEditScrollRef.current = section ?? null;
    setEditing(true);
  }

  function setField<K extends keyof CustomerEditDraft>(key: K, value: CustomerEditDraft[K]) {
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
    if (!customer || !editDraft || !editBaseRef.current) return;
    // Tomt personnummer är tillåtet — samma regel som när kunden skapas: säljaren får det ofta
    // först när jobbet bokas, och kravet sitter i stället på ARBETSORDERN. Står det något ska det
    // däremot hålla: tio siffror räcker för att spara men gör att ROT- och husarbetesuppgifterna
    // faller tyst i Fortnox, och felet upptäcks först i bokföringen.
    if (editDraft.personal_number.trim() && !isValidPersonalNumber(editDraft.personal_number)) {
      toast.error(PERSONAL_NUMBER_ERROR); return;
    }
    const discountIssue = customerEditDiscountIssue(editDraft);
    if (discountIssue) { toast.error(discountIssue); return; }
    const body = changedCustomerEditFields(customerEditBody(editDraft), editBaseRef.current);
    if (Object.keys(body).length === 0) {
      setEditing(false);
      toast.success('Kund uppdaterad');
      return;
    }
    setSaving(true);
    try {
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

  // Tar bort kunden här och i Fortnox, eller ingenstans (lib/domains/fortnox/customerDelete.ts).
  // Alltid till kundregistret efteråt: en returnTo pekar på offerten eller ordern kunden kom ifrån.
  async function deleteCustomer() {
    if (!customer) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/crm/customers/${customer.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setDeleteError(json?.error || 'Kunden kunde inte tas bort.');
        setConfirmDelete(false);
        setDeleting(false);
        return;
      }
      // `deleting` står kvar tills sidan lämnas: ett andra klick under navigeringen hade fått 404 och visat ett fel
      // för en borttagning som lyckades.
      toast.success('Kunden är borttagen');
      router.push('/crm/kunder');
    } catch {
      setDeleteError('Kunden kunde inte tas bort. Kontrollera anslutningen och försök igen.');
      setConfirmDelete(false);
      setDeleting(false);
    }
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
      // Berikningen pushar numera vidare till Fortnox när kunden är länkad. Går pushen fel är
      // raden ändå sparad — men det måste synas, annars ser en misslyckad synk ut som en
      // lyckad hämtning och skillnaden upptäcks först i faktureringen.
      if (json.data?.fortnox_error) {
        toast.error(`Företagsdata hämtad men Fortnox-synk misslyckades: ${json.data.fortnox_error}`);
      } else {
        toast.success(filled > 0 ? `Företagsdata hämtad (${filled} fält ifyllda)` : 'Inga nya fält att fylla – datan är redan komplett');
      }
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

  // Den sparade raden in i listan. applyContactToList är delad med offertpanelen och bär
  // speglingen av serverns primär-degradering — utan den visar listan två primärbrickor.
  function applySavedContact(saved: CustomerContact) {
    setContacts((current) => applyContactToList(current, saved));
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
      <div className="grid grid-cols-1 gap-5">
        <div className="h-5 w-28 animate-pulse rounded-lg bg-[#dfe6da]" />
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 animate-pulse rounded-[14px] bg-[#dfe6da]" />
          <div className="grid gap-2">
            <div className="h-8 w-72 animate-pulse rounded-xl bg-[#dfe6da]" />
            <div className="h-6 w-56 animate-pulse rounded-full bg-[#dfe6da]" />
          </div>
        </div>
        <div className="h-11 animate-pulse rounded-lg bg-[#dfe6da]" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid gap-5">
            <div className="h-40 animate-pulse rounded-2xl bg-[#dfe6da]" />
            <div className="h-40 animate-pulse rounded-2xl bg-[#dfe6da]" />
          </div>
          <div className="grid content-start gap-4">
            <div className="h-36 animate-pulse rounded-2xl bg-[#dfe6da]" />
            <div className="h-28 animate-pulse rounded-2xl bg-[#dfe6da]" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="grid gap-4">
        <button type="button" onClick={() => router.push(backTo)} className="inline-flex w-fit items-center gap-1.5 px-0 py-1 text-sm text-slate-600 transition hover:text-slate-900">
          <BackArrow /> {backLabel}
        </button>
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">{error || 'Kunden hittades inte.'}</div>
      </div>
    );
  }

  const displayName = customerDisplayName(customer);
  const isB2B = customer.customer_type === 'business';
  const report = customer.credit_report;
  const stage = stageChip(customer);
  const deleteBlocked = Boolean(customer.fortnox_customer_id) && !fortnoxConnected;
  const creator = customer.created_by ? sellers.find((s) => s.id === customer.created_by) : null;
  const openTasks = tasks.filter((t) => t.status === 'open').length;

  // ─── Sidebar cards ─────────────────────────────────────────────────────────

  // Detaljer bär kundansvarig-väljaren, som sparar direkt (utanför Spara-knappen) och därför gäller i
  // BÅDA lägena. Egen variabel, så att redigeringsläget kan visa den utan resten av sidokolumnen.
  const detailsCard = (
    <SideCard title="Detaljer">
      <label htmlFor="kund-ansvarig" className="mb-1.5 block text-[13px] text-slate-600">Kundansvarig</label>
      <Select
        id="kund-ansvarig"
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
      <div className="mt-4">
        <DefinitionList compact>
          <Field label="Fortnox kund-ID">
            {customer.fortnox_customer_id ? `#${customer.fortnox_customer_id}` : <Muted>Inte i Fortnox</Muted>}
          </Field>
          <Field label="Skapad">
            {formatDateTime(customer.created_at)}
            {creator?.full_name ? <span className="font-normal text-slate-600"> av {creator.full_name}</span> : null}
          </Field>
          <Field label="Senast ändrad">{formatDateTime(customer.updated_at)}</Field>
        </DefinitionList>
      </div>
    </SideCard>
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
              <Card id="redigera-grundinfo">
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
                        <FieldLabel>Personnummer</FieldLabel>
                        <Input
                          value={editDraft.personal_number}
                          onChange={(e) => setField('personal_number', formatPersonalNumber(e.target.value))}
                          placeholder="ÅÅÅÅMMDD-XXXX"
                          inputMode="numeric"
                          aria-invalid={!!editDraft.personal_number.trim() && !isValidPersonalNumber(editDraft.personal_number)}
                        />
                        {editDraft.personal_number.trim() && !isValidPersonalNumber(editDraft.personal_number) ? (
                          <p className="mt-1 text-[11px] leading-snug text-rose-600">{PERSONAL_NUMBER_ERROR}</p>
                        ) : (
                          <p className="mt-1 text-[11px] leading-snug text-slate-400">
                            {PERSONAL_NUMBER_OPTIONAL_HINT}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </Card>

              <Card id="redigera-kontakt">
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
                  {/* Kundansvarig redigeras via inline-väljaren i Detaljer (sparas direkt, gäller
                      i både läs- och redigeringsläget) — inte här, för att inte "Spara ändringar"
                      ska skriva över ett direktsatt värde med ett inaktuellt utkast. */}
                </div>
              </Card>
            </div>

            {/* Adresser */}
            <Card id="redigera-adresser">
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
            <Card id="redigera-fakturering">
              <SectionTitle>Fakturainställningar</SectionTitle>
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div><FieldLabel>Betalningsvillkor</FieldLabel><FortnoxCodeSelect value={editDraft.payment_terms} onChange={(v) => setField('payment_terms', v)} endpoint="/api/fortnox/terms-of-payment" emptyLabel="Standard (Fortnox)" placeholder="30 dagar" /></div>
                  <div><FieldLabel>Prislista</FieldLabel><FortnoxCodeSelect value={editDraft.price_list} onChange={(v) => setField('price_list', v)} endpoint="/api/fortnox/price-lists" emptyLabel="Standard (Fortnox)" placeholder="A" /></div>
                  <div><FieldLabel>Rabatt (%)</FieldLabel><Input value={editDraft.discount} onChange={(e) => setField('discount', e.target.value)} placeholder="0" inputMode="decimal" /></div>
                  {isB2B ? (
                    <div><FieldLabel>Momsreg-nummer</FieldLabel><Input value={editDraft.vat_number} onChange={(e) => setField('vat_number', e.target.value)} placeholder="SE556…" /></div>
                  ) : null}
                </div>
                {isB2B ? (
                  <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
                    <input type="checkbox" checked={editDraft.reverse_vat} onChange={(e) => setField('reverse_vat', e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-[color:var(--ek-accent)]" />
                    Omvänd skattskyldighet
                  </label>
                ) : null}
              </div>
            </Card>

            {/* Företagsinformation (företag) — HOPFÄLLT med flit: fälten fylls av tic.io-uppslaget
                ("Hämta företagsdata" i läsvyn) och skrivs sällan för hand. Utfällda låg åtta
                nyckeltal — soliditet, rörelsemarginal, totala tillgångar, räkenskapsår … — som
                vanliga formulärfält på samma nivå som företagsnamnet, och utgjorde nästan halva
                editorn. Samma hopfällning som registreringsformuläret redan gör.

                Ledtexten säger vad som LIGGER i sektionen, inget annat — samma ord som
                registreringsformulärets. "hämtas från tic.io" stod här först och var fel jobb
                för etiketten: det här är den enda ytan där fälten går att skriva för hand, och
                en ledtext om datans ursprung fick dem att läsas som låsta. */}
            {isB2B ? (
              <CollapsibleCardSection title="Företagsinformation" hint="ekonomi, bransch & risk">
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
              </CollapsibleCardSection>
            ) : null}

          </div>

          {/* Höger kolumn: spara + detaljer.
              🧨 `lg:sticky` satt här redan förut men gjorde INGENTING: historikkorten låg i
              samma kolumn och gjorde den högre än fönstret, och en sticky box som är högre än
              sin viewport fastnar aldrig — den scrollar bort med sidan. Spara försvann alltså
              redan vid Fakturainställningar, mitt i formuläret. Med bara spara + detaljer kvar
              är kolumnen kortare än fönstret och knappen följer med hela vägen ner. */}
          <div className="grid gap-4 lg:sticky lg:top-6">
            <Card>
              <div className="grid gap-2">
                <button type="button" onClick={saveEdits} disabled={saving} className={cn(crm.saveButton, 'h-11')}>
                  {saving ? 'Sparar…' : 'Spara ändringar'}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 transition hover:border-slate-300">
                  Avbryt
                </button>
              </div>
            </Card>
            {detailsCard}
          </div>
        </div>
      </div>
    );
  }

  // ─── Read view ─────────────────────────────────────────────────────────────

  const tabDefs: { id: CustomerTab; label: string; count: React.ReactNode }[] = [
    { id: 'oversikt', label: 'Översikt', count: null },
    { id: 'offerter', label: 'Offerter', count: relatedLoading ? null : tabCountLabel(quotes.length, Infinity, quotesTotal) },
    { id: 'arbetsorder', label: 'Arbetsorder', count: relatedLoading ? null : tabCountLabel(workOrders.length, Infinity, workOrdersTotal) },
    { id: 'samtal', label: 'Samtal', count: relatedLoading ? null : tabCountLabel(calls.length, CALLS_LIMIT) },
    {
      id: 'uppgifter',
      label: 'Uppgifter',
      count: relatedLoading ? null : (
        <>{tasks.length >= TASKS_LIMIT ? `${openTasks}+` : openTasks}<span className="sr-only"> öppna</span></>
      ),
    },
    { id: 'kontakter', label: 'Kontaktpersoner', count: String(contacts.length) },
  ];

  const nextStepClass = 'flex min-h-[52px] w-full items-center justify-start gap-3 rounded-xl border border-[#e0e8dc] bg-white px-3.5 py-0 text-left text-sm font-medium text-slate-900 transition hover:border-[color:var(--ek-accent-soft-border)] hover:bg-[#f9fbf7]';

  return (
    <div className="grid grid-cols-1 gap-5 pb-10">

      {createdBanner ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl bg-[color:var(--ek-green)] px-4 py-3 text-sm text-white">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
            <path d="M5 12l5 5 9-10" />
          </svg>
          <span className="flex-[1_1_260px]">
            <strong className="font-semibold">Kunden är skapad</strong>
            {customer.fortnox_customer_id ? ` och synkad till Fortnox som kund-ID ${customer.fortnox_customer_id}.` : '.'}
          </span>
          <button
            type="button"
            aria-label="Stäng"
            onClick={() => setCreatedBanner(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg p-0 text-white transition hover:bg-white/10"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      ) : null}

      {/* Header */}
      <div className="grid gap-1.5">
        <button type="button" onClick={() => router.push(backTo)} className="inline-flex w-fit items-center gap-1.5 px-0 py-1 text-[13px] text-slate-600 transition hover:text-slate-900">
          <BackArrow /> {backLabel}
        </button>
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-center gap-4">
            <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-[color:var(--ek-green)] text-xl font-bold text-white" aria-hidden>
              {customerInitials(customer)}
            </span>
            <div className="min-w-0">
              <h1 className="m-0 text-[28px] font-bold leading-tight tracking-tight text-slate-900 [overflow-wrap:anywhere]">{displayName}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Chip>{isB2B ? 'Företag' : 'Privatperson'}</Chip>
                {isB2B && customer.organization_number ? <Chip>{customer.organization_number}</Chip> : null}
                {!isB2B && customer.personal_number ? <Chip>{customer.personal_number}</Chip> : null}
                <Chip>
                  <span className={cn('h-[7px] w-[7px] rounded-full', stage.dot)} aria-hidden />
                  {stage.text}
                </Chip>
                {report ? (
                  <Chip className="bg-[color:var(--ek-accent-soft)] text-[color:var(--ek-accent)]">
                    Kreditbetyg {report.credit_score != null ? `${report.credit_score}/100` : '–'} · {creditRiskLabel(report)}
                  </Chip>
                ) : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => startEditing()}
            className="inline-flex h-[42px] items-center gap-2 rounded-xl border border-[#dce4d8] bg-white px-4 py-0 text-sm font-semibold text-slate-700 transition hover:border-[#c8d4c3] hover:text-slate-900"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            Redigera
          </button>
        </header>
      </div>

      <TabsList aria-label="Kundflikar" className="gap-x-6 gap-y-1 border-b border-[#d0d8ce]">
        {tabDefs.map((t) => (
          <TabsTrigger
            key={t.id}
            id={`kund-tab-${t.id}`}
            // Bara aktiv flik har sin panel i DOM — aria-controls på inaktiva flikar vore dinglande referenser.
            aria-controls={tab === t.id ? `kund-tabpanel-${t.id}` : undefined}
            variant="underline"
            active={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count != null ? <CountBadge>{t.count}</CountBadge> : null}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* Body: main + sidebar. Sidokolumnen är INTE sticky: den är högre än fönstret, och en sticky
          kolumn som är det fastnar aldrig (se fällan vid redigeringslägets spara-kolumn ovan). */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">

        <div role="tabpanel" id={`kund-tabpanel-${tab}`} aria-labelledby={`kund-tab-${tab}`} className="min-w-0">
          {tab === 'oversikt' ? (
            <CustomerOverview
              customer={customer}
              quotes={quotes}
              quotesLoading={relatedLoading}
              onEdit={startEditing}
              onShowQuotes={() => setTab('offerter')}
              enriching={enriching}
              onFetchCompanyData={fetchCompanyData}
            />
          ) : null}
          {tab === 'offerter' ? <QuotesTab quotes={quotes} total={quotesTotal} loading={relatedLoading} /> : null}
          {tab === 'arbetsorder' ? <WorkOrdersTab workOrders={workOrders} total={workOrdersTotal} loading={relatedLoading} /> : null}
          {tab === 'samtal' ? <CallsTab calls={calls} loading={relatedLoading} /> : null}
          {tab === 'uppgifter' ? <TasksTab tasks={tasks} loading={relatedLoading} /> : null}
          {tab === 'kontakter' ? (
            <ContactsTab
              contacts={contacts}
              onAdd={() => setContactFormTarget({ contact: null })}
              onEdit={(contact) => setContactFormTarget({ contact })}
              onDelete={(contact) => deleteContact(contact.id)}
            />
          ) : null}
        </div>

        <aside className="grid content-start gap-4">
          {fortnoxConnected && !customer.fortnox_customer_id ? (
            <SideCard title="Fortnox">
              <p className="m-0 mb-3 text-[13px] leading-relaxed text-slate-600">Kunden finns inte i Fortnox ännu. Skapa den för att kunna fakturera.</p>
              <button
                type="button"
                onClick={pushToFortnox}
                disabled={pushingFortnox}
                className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-[#dce4d8] bg-white px-4 py-0 text-sm font-semibold text-slate-800 transition hover:border-[#c8d4c3]"
              >
                {pushingFortnox ? 'Skapar…' : 'Skapa i Fortnox'}
              </button>
            </SideCard>
          ) : null}

          <SideCard title="Nästa steg">
            <div className="grid gap-2">
              <button type="button" className={nextStepClass} onClick={() => setContactFormTarget({ contact: null })}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-[color:var(--ek-green)]">
                  <circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
                </svg>
                Lägg till kontaktperson
              </button>
              <button type="button" className={nextStepClass} onClick={() => setTab('uppgifter')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-[color:var(--ek-green)]">
                  <path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
                </svg>
                Skapa uppgift
              </button>
              <button type="button" className={nextStepClass} onClick={() => setTab('samtal')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-[color:var(--ek-green)]">
                  <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
                </svg>
                Logga samtal
              </button>
            </div>
          </SideCard>

          {/* Kreditupplysning (företag, tic.io /risks). Hämtas bara med knapp och sparas som snapshot —
              ingen tic.io-debitering per sidvisning, och kvoten är begränsad. */}
          {isB2B ? (
            <SideCard title="Kreditupplysning">
              {report ? (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className={cn('text-[28px] font-bold leading-none tabular-nums', creditScoreMeta(report.credit_score).text)}>
                      {report.credit_score ?? '–'}
                    </span>
                    {report.credit_score != null ? <span className="text-sm text-slate-500">/100</span> : null}
                    <span className={cn(crm.badge, riskClassMeta(report.risk_class).badge)}>{creditRiskLabel(report)}</span>
                  </div>
                  <div className="mt-3.5">
                    <DefinitionList compact>
                      <Field label="Anmärkningar">
                        {creditRemarkLines(report).length === 0 ? 'Inga registrerade' : (
                          <ul className="m-0 grid list-none gap-1 p-0 font-normal">
                            {creditRemarkLines(report).map((line) => (
                              <li key={line.label}><span className="font-semibold">{line.label}:</span> {line.value}</li>
                            ))}
                          </ul>
                        )}
                      </Field>
                      {creditForecastPercent(report) ? <Field label="Riskprognos">{creditForecastPercent(report)}</Field> : null}
                      <Field label="Omsättning">{formatSek(customer.annual_revenue) ?? <Muted>Ej angivet</Muted>}</Field>
                      <Field label="Anställda">{customer.number_of_employees ?? <Muted>Ej angivet</Muted>}</Field>
                      {customer.credit_report_fetched_at ? (
                        <Field label="Hämtad">{formatDateTime(customer.credit_report_fetched_at)} via tic.io</Field>
                      ) : null}
                    </DefinitionList>
                  </div>
                  <p className="m-0 mt-3 text-[11px] text-slate-500">Källa: tic.io · kan skilja från andra kreditbyråer</p>
                  <button type="button" onClick={fetchCreditReport} disabled={fetchingCredit} className={cn(cardLinkButton, 'mt-2.5')}>
                    {fetchingCredit ? 'Hämtar…' : 'Uppdatera'}
                  </button>
                </>
              ) : (
                <div className="grid gap-3">
                  <p className="m-0 text-[13px] leading-relaxed text-slate-600">
                    {customer.organization_number
                      ? 'Kreditbetyg, riskklass och betalningsanmärkningar från tic.io.'
                      : 'Lägg till ett organisationsnummer för att kunna hämta en kreditupplysning.'}
                  </p>
                  <button
                    type="button"
                    onClick={fetchCreditReport}
                    disabled={fetchingCredit || !customer.organization_number}
                    className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-[#dce4d8] bg-white px-4 py-0 text-sm font-semibold text-slate-800 transition hover:border-[#c8d4c3]"
                  >
                    {fetchingCredit ? 'Hämtar…' : 'Hämta kreditupplysning'}
                  </button>
                </div>
              )}
            </SideCard>
          ) : null}

          {portalPartnerEnabled && isB2B ? (
            <PortalPartnerCard
              customerId={customer.id}
              cardVersion={`${customer.updated_at}|${customer.fortnox_customer_id ?? ''}|${customer.customer_type}`}
            />
          ) : null}

          {detailsCard}

          {canDeleteCustomer ? (
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => { setDeleteError(null); setConfirmDelete(true); }}
                // Utan koppling vore ett klick genom en oåterkallelig bekräftelse dömt att få nej (409).
                disabled={deleting || deleteBlocked}
                className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg px-1 py-0 text-[13px] font-semibold text-[#a3212b] transition hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                </svg>
                Ta bort kund
              </button>
              {deleteBlocked ? (
                <p className="m-0 px-1 text-xs leading-relaxed text-slate-600">
                  Kunden finns i Fortnox, och Fortnox är inte kopplat. Den kan tas bort när kopplingen är tillbaka.
                </p>
              ) : null}
              {deleteError ? (
                <p role="alert" className="m-0 rounded-xl bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-800">
                  {deleteError}
                </p>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>

      {confirmDelete ? (
        <CrmConfirmDialog
          tone="danger"
          title={`Ta bort ${displayName}?`}
          message={customer.fortnox_customer_id
            ? `Kunden tas bort här och som kund ${customer.fortnox_customer_id} i Fortnox, tillsammans med sina kontaktpersoner. Det går inte att ångra.`
            : 'Kunden tas bort tillsammans med sina kontaktpersoner. Det går inte att ångra.'}
          confirmLabel={deleting ? 'Tar bort…' : 'Ta bort kund'}
          busy={deleting}
          onConfirm={deleteCustomer}
          // CrmModal stänger på Escape och klick utanför oavsett `busy`. Under borttagningen hade det sett ut som
          // ett avbrott fast anropet fortsätter.
          onCancel={() => { if (!deleting) setConfirmDelete(false); }}
        />
      ) : null}

      {/* Samma formulär som offertpanelen och offertformuläret öppnar — ett formulär, tre
          ingångar. Låg tidigare som ett inbyggt formulär här, utan möjlighet att RÄTTA en rad. */}
      {contactFormTarget ? (
        <ContactFormModal
          customerId={customer.id}
          contact={contactFormTarget.contact}
          onClose={() => setContactFormTarget(null)}
          onSaved={applySavedContact}
        />
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm, syncStatusLabel, syncStatusClass, workOrderStatusLabel, workOrderStatusClass, WORK_ORDER_STATUS_FLOW, WORK_ORDER_STATUS_OPTIONS } from '@/app/crm/lib/crmTokens';
import { PhoneLink, EmailLink, AddressLink } from '@/app/crm/components/ContactLinks';
import AddressAutocompleteInput from '@/app/crm/components/AddressAutocompleteInput';
import { safeReturnTo, withReturnTo } from '@/app/crm/lib/returnTo';
import { resolveCrmContact } from '@/lib/domains/crm/contacts';
import {
  buildMeasurementLines,
  regenerateMeasurementBlock,
  type MeasurementLineItem,
} from '@/lib/domains/crm/measurementBlock';
import { lineItemQuantity } from '@/lib/domains/crm/lineItems';
import { lineItemEffectiveUnitPrice } from '@/lib/domains/crm/pricing';
import { inferMaterialFromArticle, sacksFor } from '@/lib/domains/crm/materials';
import { parseDecimal } from '@/lib/shared/number';
import WorkOrderTimeTab from './WorkOrderTimeTab';
import WorkOrderCommentsTab from './WorkOrderCommentsTab';
import WorkOrderArticles, { type ArticleLineItem } from './WorkOrderArticles';
import WorkOrderFilesTab from './WorkOrderFilesTab';
import WorkOrderSackTrailCard from './WorkOrderSackTrailCard';
import WorkOrderPartialInvoiceModal, { type PartialInvoiceLine } from './WorkOrderPartialInvoiceModal';
import CrmConfirmDialog from '@/app/crm/components/CrmConfirmDialog';
import { useWorkOrderActivity } from './useWorkOrderActivity';
import { useWorkOrderFiles } from './useWorkOrderFiles';
import { useSackReports } from './useSackReports';
import { useCustomerContact } from './useCustomerContact';
import { formatDate, formatDateTime, formatCurrency, joinAddress, isWorkOrderOverdue, documentRef } from '@/app/crm/lib/format';
import { openFortnoxPdf } from '@/app/crm/lib/fortnoxDoc';
import useDocumentEmail from '@/app/crm/components/useDocumentEmail';

// ─── Types ──────────────────────────────────────────────────────────────────

type WorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'partially_invoiced' | 'invoiced' | 'cancelled';
type WorkOrderTab = 'overview' | 'files' | 'time';
type FortnoxSyncStatus = 'not_synced' | 'pending' | 'synced' | 'failed';

// One delfakturering round: the per-article quantities billed + the Fortnox invoice it produced.
type InvoiceRound = {
  id: string;
  round_number: number;
  fortnox_invoice_number: string | null;
  fortnox_sync_status: FortnoxSyncStatus;
  amount: number | string;
  line_quantities: Array<{ index: number; quantity: number }> | null;
  created_at: string;
};

type LineItem = {
  id: string;
  article_name?: string | null;
  article_number?: string | null;
  pricing_mode?: 'm3' | 'item';
  article_unit_name?: string | null;
  quantity?: string;
  m2?: string;
  thickness_mm?: string;
  density?: string;
  unit_price?: string;
  discount_percent?: string;
  // Såld men aldrig utförd. Raden ligger kvar (fakturarundorna nycklas på dess id) men räknas
  // varken i pengar eller i säckar.
  written_off?: boolean;
};

type WorkOrderItem = {
  id: string;
  quote_id: string | null;
  customer_id: string | null;
  order_number: string;
  project_name: string;
  client_name: string;
  quote_type: 'private' | 'business';
  customer_snapshot: Record<string, any> | null;
  work_address: {
    street_address?: string | null;
    postal_code?: string | null;
    city?: string | null;
    delivery_address?: string | null;
    invoice_address?: string | null;
  } | null;
  pricing_summary: { subtotal?: number; vat?: number; total?: number } | null;
  line_items: LineItem[] | null;
  rot_details: Record<string, any> | null;
  internal_handoff: { desired_installation_date?: string | null; handoff_notes?: string | null; work_scope?: string | null } | null;
  currency_code: string;
  amount: number | string;
  vat_percent: number | string;
  desired_installation_date: string | null;
  source_status: string;
  status: WorkOrderStatus;
  notes: string | null;
  assigned_to: string | null;
  assignee: { id: string; full_name: string | null } | null;
  fortnox_order_number: string | null;
  fortnox_order_sync_status: FortnoxSyncStatus;
  fortnox_order_synced_at: string | null;
  fortnox_invoice_number: string | null;
  fortnox_invoice_sync_status: FortnoxSyncStatus;
  fortnox_invoiced_at: string | null;
  partial_invoicing_started_at: string | null;
  created_at: string;
  updated_at: string;
};

type WorkOrderDraft = {
  status: WorkOrderStatus;
  assigned_to: string;
  desired_installation_date: string;
  street_address: string;
  postal_code: string;
  city: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  your_reference: string;
  work_scope: string;
  handoff_notes: string;
  notes: string;
};

type AssignableUser = { id: string; full_name: string | null; role?: string | null };

// ─── Meta / helpers ───────────────────────────────────────────────────────────
// Status labels/classes/flow are centralised in crmTokens; formatters in crm/lib/format.

// ─── Small UI ───────────────────────────────────────────────────────────────

function BackArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(crm.cardInner, className)}>{children}</div>;
}

// En läsrad: etikett vänster, värde höger. Medvetet UTAN ram och fyllning.
//
// ⚠️ Rutan såg tidigare ut som ett avstängt inmatningsfält — `rounded-xl` + `#f1f5ee` + hårfin
// kant är i praktiken samma recept som `Input`s disabled-läge (`bg-[#eef1ec]`, dämpad text).
// Snabböversikten och "Ordernummer" lästes därför som ett formulär man inte får röra, fast de
// är rena fakta. Separationen mellan rader ägs nu av behållaren (`divide-y`), inte av varje rad.
//
// Storleken sätts här och ärvs inte: raden användes både inne i en `text-sm`-behållare
// (Snabböversikt, ROT) och utan (Fortnox order), så samma komponent renderades i två grader.
function StatField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm text-slate-500">{label}</span>
      <strong className="text-sm font-semibold tabular-nums text-slate-900">{value}</strong>
    </div>
  );
}

// What an invoice round actually billed, per article: maps the round's stored line_quantities
// (index + quantity) back onto the work order's line_items for the article name/unit, and
// recomputes the row amount the same way the pricing/Fortnox row builders do.
function roundLineBreakdown(
  lineItems: Array<Record<string, any>>,
  lineQuantities: Array<{ line_id?: string | null; index?: number | null; quantity: number }> | null,
) {
  return (lineQuantities ?? []).map((lq, i) => {
    // Radens id är nyckeln; position bara för rundor skrivna före id-migreringen. Utan det här
    // renderades varje rad som "Artikel · 0 kr", eftersom nya rundor inte har något `index`.
    const item = ((lq.line_id
      ? lineItems.find((li) => li.id === lq.line_id)
      : (lq.index != null ? lineItems[lq.index] : null)) ?? {}) as Record<string, any>;
    return {
      key: lq.line_id ?? `#${lq.index ?? i}`,
      name: item.article_name || item.line_note || 'Artikel',
      unit: item.article_unit_name || '',
      quantity: lq.quantity,
      amount: lq.quantity * lineItemEffectiveUnitPrice(item),
    };
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function WorkOrderDetailClient({ workOrderId, fortnoxConnected, currentUserId }: { workOrderId: string; fortnoxConnected: boolean; currentUserId: string | null }) {
  const router = useRouter();
  // Arbetsordern öppnas både från sin egen lista och från planeringskalendern. Utan det här
  // landade planeraren i orderlistan i stället för på tavlan hen kom ifrån.
  const searchParams = useSearchParams();
  const backTo = safeReturnTo(searchParams.get('returnTo')) ?? '/crm/arbetsorder';
  const backLabel = backTo.startsWith('/crm/planering') ? 'Planering' : 'Arbetsorder';
  const toast = useToast();

  const [workOrder, setWorkOrder] = useState<WorkOrderItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState<WorkOrderStatus | null>(null);
  const [savingArticles, setSavingArticles] = useState(false);
  const [pushingFortnox, setPushingFortnox] = useState(false);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [invoiceRounds, setInvoiceRounds] = useState<InvoiceRound[]>([]);
  // Fakta som bara GET bär — PATCH-svaren returnerar enbart arbetsordern. De ligger därför i egen
  // state som applyWorkOrder aldrig rör; låg de i `workOrder` hade de tömts vid första sparning.
  //
  // `reportedSacks === null` betyder "ingen rapport", inte "noll säckar" — se
  // getWorkOrderReportedSacks. Skillnaden bärs hela vägen ut i rutan.
  const [reportedSacks, setReportedSacks] = useState<number | null>(null);
  // Ordningsräknare för omräkningen efter en borttagning — se removeSackReport.
  const reportedSacksSeq = useRef(0);
  // Spåret bakom snabböversiktens tal. Skriver inga rapporter — dörr 1 och 2 gör det — men kan ta
  // bort en felrapporterad delrapport, se removeSackReport.
  const sackReports = useSackReports(workOrderId);
  const [sourceQuote, setSourceQuote] = useState<{ quote_number: string | null; fortnox_offer_number: string | null } | null>(null);
  const [showPartialModal, setShowPartialModal] = useState(false);
  const [confirmInvoiceOpen, setConfirmInvoiceOpen] = useState(false);
  const [submittingPartial, setSubmittingPartial] = useState(false);
  const [expandedRounds, setExpandedRounds] = useState<Set<string>>(() => new Set());

  function toggleRound(id: string) {
    setExpandedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Tar bort en felrapporterad delrapport ur spåret — och hämtar om snabböversiktens tal.
  //
  // ⚠️ Den andra halvan är inte kosmetik. `reportedSacks` kommer från GET:ens `reported_sacks`
  // (getWorkOrderReportedSacks på servern), inte från spårets rader. Utan omhämtningen står
  // rubriktalet kvar på den dubbelrapporterade summan tills sidan laddas om — alltså precis det
  // fel borttagningen finns för att rätta, kvar på den mest lästa ytan.
  //
  // Bara talet plockas ur svaret. Hela arbetsordern skrivs medvetet INTE om: en pågående
  // redigering av adress eller kontakt hade fått sitt utkast överskrivet av en åtgärd som inte har
  // med de fälten att göra.
  async function removeSackReport(id: string) {
    const removed = await sackReports.remove(id);
    if (!removed) return;
    // ⚠️ Samma ordningsfälla som i hookens refresh: två borttagningar i rad ger två omräkningar,
    // och landar den första sist skriver den tillbaka summan FÖRE den andra raden togs bort. Talet
    // hade då stått kvar på den dubbelrapporterade siffran — alltså precis det borttagningen
    // gjordes för att rätta, på ordersidans mest lästa ruta.
    const seq = ++reportedSacksSeq.current;
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (seq !== reportedSacksSeq.current) return;
      if (json?.ok) setReportedSacks((json.data?.reported_sacks as number | null | undefined) ?? null);
    } catch {
      // Spåret är redan rätt; rubriktalet rättar sig vid nästa laddning. Ingen toast — raden ÄR
      // borttagen, och ett felmeddelande här hade lästs som att borttagningen misslyckades.
    }
  }
  // Order-confirmation e-mail (own mail client, with recipient resolution).
  const documentEmail = useDocumentEmail();
  const [editingOverview, setEditingOverview] = useState(false); // overview fields locked until unlocked
  const [activeTab, setActiveTab] = useState<WorkOrderTab>('overview');
  const [draft, setDraft] = useState<WorkOrderDraft | null>(null);

  const [assignees, setAssignees] = useState<AssignableUser[]>([]);
  const customerInfo = useCustomerContact(workOrderId);

  // The linked customer's contacts, for the "change responsible contact" picker (in case the
  // contact changed between offer→order). Empty for standalone orders with no linked customer.
  // The card's own channels come along too: a contact row without phone/e-mail (a private
  // customer's auto-created row carries only the name) must fall back to them on pick.
  const [customerContacts, setCustomerContacts] = useState<Array<{ id: string; name: string; role: string | null; phone: string | null; email: string | null; is_primary: boolean }>>([]);
  // customer_type följer med: det avgör om kortets e-post får lånas ut åt en kontaktrad utan egen
  // (`resolveCrmContact`). Utan fältet lånas den ut som förut — och väljaren nedan hade skrivit in
  // bolagets adress under den anställdes namn, vilket är precis det vi slutade göra.
  const [customerCard, setCustomerCard] = useState<{ customer_type: 'business' | 'private' | null; email: string | null; phone: string | null; mobile: string | null } | null>(null);
  useEffect(() => {
    const cid = workOrder?.customer_id;
    if (!cid) { setCustomerContacts([]); setCustomerCard(null); return; }
    let active = true;
    fetch(`/api/crm/customers/${cid}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (!active) return;
        const item = json?.ok ? json.data?.item : null;
        setCustomerContacts(Array.isArray(item?.contacts) ? item.contacts : []);
        setCustomerCard(item ? { customer_type: item.customer_type ?? null, email: item.email ?? null, phone: item.phone ?? null, mobile: item.mobile ?? null } : null);
      })
      .catch(() => { if (active) { setCustomerContacts([]); setCustomerCard(null); } });
    return () => { active = false; };
  }, [workOrder?.customer_id]);

  // Resolve the responsible user's name from the admin-sourced assignees list — the
  // joined `assignee` profile is null for colleagues' orders (session-client profiles RLS
  // only returns the current user's own profile). Same fix as the work-order list.
  const assigneeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignees) if (a.full_name) map.set(a.id, a.full_name);
    return map;
  }, [assignees]);

  // Time entries, comments and @-mention targets + their CRUD live in a shared hook
  // (also used by the installer field view) so the write logic isn't duplicated.
  const {
    timeEntries, comments, mentionUsers, timeEntriesLoading, commentsLoading,
    createTimeEntry, updateTimeEntry, deleteTimeEntry, createComment, updateComment, deleteComment,
  } = useWorkOrderActivity(workOrderId);

  // Ritningar och bilder på jobbet. Egen hook — fältvyn monterar samma flik med samma hook.
  // Hämtas först när fliken öppnats: listsvaret signerar en URL per bild på servern, och en order
  // öppnas ofta för Ekonomi eller Artiklar utan att Filer någonsin visas.
  const workOrderFiles = useWorkOrderFiles(workOrderId, { enabled: activeTab === 'files' });

  // Load work order
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/crm/work-orders/${workOrderId}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !json.ok) { setError(json?.error || 'Kunde inte ladda arbetsorder'); return; }
        applyWorkOrder(json.data?.item as WorkOrderItem);
        setInvoiceRounds((json.data?.rounds as InvoiceRound[] | undefined) ?? []);
        setReportedSacks((json.data?.reported_sacks as number | null | undefined) ?? null);
        setSourceQuote((json.data?.source_quote as typeof sourceQuote) ?? null);
      } catch { if (active) setError('Kunde inte ladda arbetsorder'); }
      finally { if (active) setLoading(false); }
    }
    load();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId]);

  // Load assignees (edit-only register) once the work order is loaded.
  useEffect(() => {
    if (!workOrder) return;
    let active = true;
    fetch('/api/crm/work-orders/assignees', { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => { if (active) setAssignees(json?.ok ? json.data?.items || [] : []); })
      .catch(() => { if (active) setAssignees([]); });
    return () => { active = false; };
  }, [workOrder?.id]);

  // Skriver om både arbetsordern och redigeringsutkastet ur serverns svar.
  //
  // `keepDraft` lämnar utkastet orört. Artikelsparning, Fortnox-push och fakturering svarar med
  // HELA arbetsordern, och sedan artiklarna och faktureringen flyttat in i samma kort som
  // översikten kan de köras mitt i en pågående redigering: utan vakten skrevs adressen eller
  // kontakten du just fyllt i över av serverns version, tyst och utan att låsa upp något.
  function applyWorkOrder(item: WorkOrderItem, opts?: { keepDraft?: boolean }) {
    setWorkOrder(item);
    if (opts?.keepDraft) {
      // ⚠️ STATUSEN är undantagen från skyddet. Den ägs av servern under just de här anropen —
      // faktureringen sätter 'partially_invoiced'/'invoiced' själv — och ett utkast som ligger kvar
      // på det gamla värdet skickar tillbaka det vid nästa Spara. Två riktiga fel, båda nåbara först
      // sedan fakturaknapparna flyttade in i den upplåsbara översikten:
      //
      //   • Efter en delfaktura PATCH:ar nästa Spara 'completed' över 'partially_invoiced', och
      //     routen SLÄPPER IGENOM det (en delfakturerad order får medvetet gå tillbaka till
      //     Pågående). En orörd adressredigering hade alltså tyst rullat tillbaka faktureringsläget.
      //   • Efter "Fakturera allt" är statusväljaren en läsbricka, så varje Spara svarar 409
      //     "Ordern är färdigfakturerad" — och det osparade arbetet gick bara att komma ur via
      //     Avbryt, som kastar det.
      //
      // Priset är att ett opsparat statusval i väljaren skrivs över. Det är rätt: servern har just
      // bestämt statusen, och väljaren står kvar för den som vill välja om.
      setDraft((d) => (d ? { ...d, status: item.status } : d));
      return;
    }
    setDraft({
      status: item.status,
      assigned_to: item.assigned_to || '',
      desired_installation_date: item.desired_installation_date || '',
      street_address: item.work_address?.street_address || '',
      postal_code: item.work_address?.postal_code || '',
      city: item.work_address?.city || '',
      contact_name: item.customer_snapshot?.contact_name || '',
      contact_phone: item.customer_snapshot?.phone || '',
      contact_email: item.customer_snapshot?.email || '',
      // Ordrar skapade innan Er referens blev ett eget fält har den kvar i contact_name — visa den
      // därifrån, annars ser fältet tomt ut fast Fortnox har ett värde.
      your_reference: item.customer_snapshot?.your_reference ?? item.customer_snapshot?.contact_name ?? '',
      work_scope: item.internal_handoff?.work_scope || '',
      handoff_notes: item.internal_handoff?.handoff_notes || '',
      notes: item.notes || '',
    });
  }

  const totalLoggedHours = useMemo(
    () => timeEntries.reduce((sum, item) => sum + Number(item.hours || 0), 0),
    [timeEntries],
  );

  // Sacks per inferable line + total — the installer's key figure.
  //
  // Avskrivna rader räknas inte: de utförs aldrig, alltså går det ingen lösull åt. Samma filter som
  // artikelflikens säckbadge redan har — och sedan Ekonomi-kortet flyttade in på översikten står de
  // två talen i samma vy, en halv skärm isär. Utan filtret visade de olika siffror för samma sak,
  // och den nya raden "Säckar (rapporterat)" jämfördes mot det ofiltrerade.
  const sackRows = useMemo(() => {
    if (!workOrder?.line_items) return [];
    return workOrder.line_items.filter((item) => !item.written_off).map((item) => {
      const material = inferMaterialFromArticle(item.article_name);
      const volume = lineItemQuantity(item);
      const density = parseDecimal(item.density);
      const sacks = material ? sacksFor(volume, density, material.bagWeight) : 0;
      return { id: item.id, material, volume, density, sacks };
    });
  }, [workOrder?.line_items]);
  const totalSacks = useMemo(() => sackRows.reduce((sum, r) => sum + r.sacks, 0), [sackRows]);

  function setField<K extends keyof WorkOrderDraft>(key: K, value: WorkOrderDraft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  async function saveWorkOrder() {
    if (!workOrder || !draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrder.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: draft.status,
          assigned_to: draft.assigned_to || null,
          desired_installation_date: draft.desired_installation_date || null,
          notes: draft.notes,
          internal_handoff: {
            desired_installation_date: draft.desired_installation_date || null,
            work_scope: draft.work_scope,
            handoff_notes: draft.handoff_notes,
          },
          // Only the work address (where the job is performed) is edited here. Billing/other
          // addresses live on the customer card, not on the order.
          work_address: {
            street_address: draft.street_address,
            postal_code: draft.postal_code,
            city: draft.city,
          },
          // Er referens — kundens formella referens, det ENDA kontaktvärdet som når Fortnox.
          your_reference: draft.your_reference || null,
          // Kundkontakten: vem vi och installatörerna ringer. Rör aldrig Fortnox.
          contact: {
            contact_name: draft.contact_name,
            phone: draft.contact_phone,
            email: draft.contact_email,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte spara arbetsorder'); return; }
      if (json.data?.item) applyWorkOrder(json.data.item as WorkOrderItem);
      setEditingOverview(false);
      // Kontaktperson/arbetsadress/ansvarig speglas på Fortnox-ordern. Synken är icke-fatal —
      // sparningen har redan lyckats — men den får inte misslyckas tyst: det var precis så en
      // ändrad kontakt kunde ligga rätt i CRM och fel i Fortnox utan att någon märkte det.
      if (json.data?.fortnox_error) {
        toast.error(`Arbetsorder sparad men Fortnox-synk misslyckades: ${json.data.fortnox_error}`);
      } else {
        toast.success('Arbetsorder sparad');
      }
    } catch { toast.error('Kunde inte spara arbetsorder'); }
    finally { setSaving(false); }
  }

  // Sätt statusen direkt från förloppsstegen — genvägen förbi Redigera → väljaren → Spara.
  //
  // Bara `status` skickas: routen speglar Er referens/arbetsadress/ansvarig till Fortnox-headern
  // och gatear på just de fälten, så en statusändring härifrån blir aldrig en Fortnox-skrivning.
  async function setStatusFromFlow(next: WorkOrderStatus) {
    if (!workOrder || statusSaving) return;
    setStatusSaving(next);
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrder.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte ändra status'); return; }
      if (json.data?.item) applyWorkOrder(json.data.item as WorkOrderItem);
      toast.success(`Status: ${workOrderStatusLabel[next]}`);
    } catch { toast.error('Kunde inte ändra status'); }
    finally { setStatusSaving(null); }
  }

  // Bygg om måttblocket ur orderns artikelrader och lägg det överst i överlämningsnoteringen.
  //
  // Till skillnad från offertformuläret finns här ingen automatik som äger texten, och därmed
  // inget "senast insatta block" att jämföra mot. Ett klick betyder alltid "hämta om måtten":
  // regenerateMeasurementBlock plockar bort ett befintligt block strukturellt så det inte
  // staplas, och behåller det som skrivits under. Ändringen sparas med resten via Spara.
  function addMeasurementsToHandoff() {
    if (!draft) return;
    // inferConstruction: rader som lagts till här saknar konstruktion, och utan härledningen
    // skrevs hela artikelnamnet ut. Flaggan är opt-in — offertformuläret får inte skicka den,
    // se buildMeasurementLines.
    const block = buildMeasurementLines((workOrder?.line_items || []) as MeasurementLineItem[], { inferConstruction: true }).join('\n');
    if (!block) { toast.error('Inget att hämta — fyll i mått på en m³-rad, eller kryssa i ”I arbetsbeskrivningen” på en antalsrad'); return; }
    const next = regenerateMeasurementBlock(draft.handoff_notes, block);
    setDraft((d) => (d ? { ...d, handoff_notes: next } : d));
  }

  // Discard unsaved overview edits and relock.
  function cancelOverview() {
    if (workOrder) applyWorkOrder(workOrder);
    setEditingOverview(false);
  }

  async function saveArticles(lineItems: ArticleLineItem[]): Promise<boolean> {
    if (!workOrder) return false;
    setSavingArticles(true);
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrder.id}/line-items`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_items: lineItems }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte spara artiklar'); return false; }
      if (json.data?.item) applyWorkOrder(json.data.item as WorkOrderItem, { keepDraft: editingOverview });
      if (json.data?.fortnox_error) {
        toast.error(`Artiklar sparade men Fortnox-synk misslyckades: ${json.data.fortnox_error}`);
      } else {
        toast.success('Artiklar sparade');
      }
      return true;
    } catch { toast.error('Kunde inte spara artiklar'); return false; }
    finally { setSavingArticles(false); }
  }

  async function pushToFortnox() {
    if (!workOrder) return;
    setPushingFortnox(true);
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrder.id}/fortnox`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte skicka till Fortnox'); return; }
      if (json.data?.item) applyWorkOrder(json.data.item as WorkOrderItem, { keepDraft: editingOverview });
      if (json.data?.fortnox_error) toast.error(`Fortnox-synk misslyckades: ${json.data.fortnox_error}`);
      else toast.success('Arbetsorder synkad med Fortnox');
    } catch { toast.error('Fel vid Fortnox-synk'); }
    finally { setPushingFortnox(false); }
  }

  // "Fakturera allt": create a draft invoice in Fortnox for the whole order (or, once
  // delfakturering has started, for the remaining quantities). Only the draft is created here —
  // bookkeeping/sending is done by finance inside Fortnox. On success the order is marked
  // "Avslutad" (status invoiced) and the returned work order reflects that.
  // Frågan ställs av CrmConfirmDialog, inte av window.confirm: dialogen låg tidigare ovanpå en
  // egen flik, men knappen sitter nu i Ekonomi-kortet mitt på översikten och ett systemvarnings-
  // fönster mitt i CRM:ets egen yta läser som att något gått fel. Dialogen stängs i finally —
  // både lyckat och misslyckat svar avslutar frågan, precis som förut.
  async function createInvoice() {
    if (!workOrder) return;
    setCreatingInvoice(true);
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrder.id}/invoice`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte skapa faktura i Fortnox'); return; }
      if (json.data?.item) applyWorkOrder(json.data.item as WorkOrderItem, { keepDraft: editingOverview });
      if (json.data?.rounds) setInvoiceRounds(json.data.rounds as InvoiceRound[]);
      const number = (json.data?.item as WorkOrderItem | undefined)?.fortnox_invoice_number;
      toast.success(number ? `Faktura skapad i Fortnox (#${number})` : 'Faktura skapad i Fortnox');
    } catch { toast.error('Fel vid skapande av faktura'); }
    finally { setCreatingInvoice(false); setConfirmInvoiceOpen(false); }
  }

  // Delfakturering: invoice the chosen per-article quantities now (one round). On success the
  // order becomes "Delfakturerad" — or "Avslutad" when this round bills the last of every line.
  async function submitPartialInvoice(lines: PartialInvoiceLine[]) {
    if (!workOrder) return;
    setSubmittingPartial(true);
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrder.id}/invoice/partial`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte skapa delfaktura'); return; }
      if (json.data?.item) applyWorkOrder(json.data.item as WorkOrderItem, { keepDraft: editingOverview });
      if (json.data?.rounds) setInvoiceRounds(json.data.rounds as InvoiceRound[]);
      setShowPartialModal(false);
      const invoiced = (json.data?.item as WorkOrderItem | undefined)?.status === 'invoiced';
      toast.success(invoiced ? 'Sista delfakturan skapad – ordern är avslutad' : 'Delfaktura skapad i Fortnox');
    } catch { toast.error('Fel vid skapande av delfaktura'); }
    finally { setSubmittingPartial(false); }
  }

  // ─── Loading / error ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-6">
        <div className="h-7 w-32 animate-pulse rounded-lg bg-[#dfe6da]" />
        <div className="h-10 w-80 animate-pulse rounded-xl bg-[#dfe6da]" />
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="h-72 animate-pulse rounded-2xl bg-[#dfe6da]" />
          <div className="h-52 animate-pulse rounded-2xl bg-[#dfe6da]" />
        </div>
      </div>
    );
  }

  if (error || !workOrder || !draft) {
    return (
      <div className="grid gap-4">
        <button type="button" onClick={() => router.push(backTo)} className="inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800">
          <BackArrow /> {backLabel}
        </button>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error || 'Arbetsordern hittades inte.'}</div>
      </div>
    );
  }

  const overdue = isWorkOrderOverdue(workOrder.desired_installation_date, workOrder.status);
  // Förloppsstegen sätter status direkt. Låst på en färdigfakturerad order (routen nekar ändå) och
  // medan översikten redigeras (då äger formulärets väljare statusen).
  const statusFlowEditable = workOrder.status !== 'invoiced' && !editingOverview;
  const snapshot = workOrder.customer_snapshot || {};
  // The order's own responsible contact (snapshot) is the source of truth here — it's what the
  // picker below edits, so an edit reflects immediately. Fall back to the resolved customer
  // contact for older orders that never captured one.
  //
  // ⚠️ MEN ALDRIG PÅ SLUTKUNDEN. `useCustomerContact` svarar med hen när ordern har en, eftersom
  // fältvyn ska visa den som står på plats — det är en ANNAN person än kundens kontakt. Föll vi
  // tillbaka på den här hamnade slutkundens adress under kundkontaktens namn, exakt den
  // hopblandning ändringen finns för att ta bort.
  const cardContact = customerInfo && !customerInfo.isOnSiteContact ? customerInfo : null;
  // Reserv när uppslaget svarade med slutkunden: kundkortet är redan hämtat här för väljaren, så
  // den delade regeln kan lösa kundens egen kontakt lokalt. Utan den ritades inget Kundkontakt-kort
  // alls på en order som har en slutkund men vars snapshot aldrig fångade kundens kontakt.
  // Ingen hook — den här raden ligger efter komponentens tidiga returer.
  const cardFallback = customerCard ? resolveCrmContact({ ...customerCard, contacts: customerContacts }) : null;
  const customerPhone: string | null = (snapshot.phone || null) ?? cardContact?.phone ?? cardFallback?.phone ?? null;
  const customerEmail: string | null = (snapshot.email || null) ?? cardContact?.email ?? cardFallback?.email ?? null;
  const customerContact: string | null = (snapshot.contact_name || null) ?? cardContact?.contactName ?? cardFallback?.name ?? null;
  const workAddressText = joinAddress([workOrder.work_address?.street_address, workOrder.work_address?.postal_code, workOrder.work_address?.city]);
  const rot = workOrder.rot_details || {};
  // Reverse charge (omvänd skattskyldighet / byggmoms): a business order whose VAT is 0. Detected
  // from the computed VAT (robust even if the work order's vat_percent column drifted to 25 — the
  // pricing/Fortnox document are still 0), so the economy card reads "Omvänd skattskyldighet"
  // instead of a misleading "Moms 0 kr / Moms % 25".
  const ecoSubtotal = Number(workOrder.pricing_summary?.subtotal ?? 0);
  const ecoVat = Number(workOrder.pricing_summary?.vat ?? 0);
  // `undefined` när den SPARADE prissättningen inte kan svara på frågan — en nyskapad
  // standalone-order har `pricing_summary: {}`, och ett hårt `false` där säger fel sak om en
  // byggmomskund (raden hade lästs "Moms (0 %) 0 kr"). Fliken härleder då ur sina egna live-siffror
  // efter samma regel som pricing.ts. Har summan ett värde vinner den: den är robust mot en
  // vat_percent-kolumn som drivit iväg till 25 på en byggmomsorder.
  const reverseCharge = ecoSubtotal > 0 ? (workOrder.quote_type === 'business' && ecoVat === 0) : undefined;
  // Ekonomi och Artiklar är inte längre egna flikar — de ligger i Ekonomi-kortet på översikten,
  // så artikelraderna, summan och faktureringen står bredvid arbetet de gäller i stället för
  // bakom var sin flik. Kommentarerna ligger av samma skäl längst ner på översikten: en
  // @-omnämnd hamnar direkt i tråden utan att först leta rätt på en flik.
  const tabs: Array<[WorkOrderTab, string]> = [
    ['overview', 'Översikt'], ['files', 'Filer'], ['time', 'Tid'],
  ];

  // Read-only field display used when the overview is locked.
  const readField = (label: string, value: React.ReactNode) => (
    <div className="grid gap-0.5">
      <span className={crm.sectionTitle}>{label}</span>
      <span className="text-sm text-slate-800">{value || '–'}</span>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-6 pb-10">

      {/* Klistrad åtgärdsrad under redigering.
          ────────────────────────────────────
          Löser två fel som båda kom av att Spara/Avbryt bara fanns i sidhuvudet:

          • "Interna anteckningar" ligger ~1 500 px ner. Man skrev färdigt och fick scrolla hela
            vägen tillbaka upp för att spara — eller trodde att det inte gick att spara alls.
          • Bytte man flik mitt i en redigering FÖRSVANN knapparna helt, medan redigeringsläget
            levde kvar (statusstegen förblev låsta). Utkastet fanns kvar i state, men det syntes
            inte, och vägen tillbaka var osynlig.

          Raden ligger därför utanför flikpanelerna och följer med på alla tre flikarna. Överkant,
          inte underkant: supportwidgeten är fastnaglad nere till höger och hade legat över
          Spara. */}
      {editingOverview ? (
        <div className="sticky top-2 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#cfdcc9] bg-[#f9fbf7]/95 px-4 py-2.5 shadow-[0_10px_28px_-14px_rgba(20,44,27,0.5)] backdrop-blur">
          <p className="m-0 text-sm text-slate-600">
            Du redigerar översikten.
            {activeTab !== 'overview' ? (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => setActiveTab('overview')}
                  className="font-semibold text-[color:var(--ek-accent)] underline-offset-2 hover:underline"
                >
                  Visa fälten
                </button>
              </>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={cancelOverview} disabled={saving} className={crm.ghostButton}>Avbryt</button>
            <button type="button" onClick={saveWorkOrder} disabled={saving} className={cn(crm.saveButton, 'h-8 w-auto px-5')}>
              {saving ? 'Sparar…' : 'Spara'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Header */}
      <div>
        <button type="button" onClick={() => router.push(backTo)} className="mb-2 inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800">
          <BackArrow /> {backLabel}
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(crm.badge, workOrderStatusClass[workOrder.status])}>{workOrderStatusLabel[workOrder.status]}</span>
              {/* Faktureringsläget är ett EGET faktum, inte en status. Sedan en delfakturerad order
                  får stå som Pågående skulle det annars vara osynligt att fakturor redan gått ut. */}
              {workOrder.partial_invoicing_started_at && workOrder.status !== 'invoiced' && workOrder.status !== 'partially_invoiced' ? (
                <span className={cn(crm.badge, 'border-amber-200 bg-amber-50 text-amber-700')}>Delfakturerad</span>
              ) : null}
              {/* Numret stod som naken versaltext mellan två piller och läste som ett tredje
                  piller som tappat sin bakgrund. Det är ett faktum i samma rad som de andra —
                  ge det samma form, i en neutral ton så statusen fortsatt äger färgen. */}
              <span className={cn(crm.badge, 'border-[#dbe4d6] bg-[#eef3ec] tabular-nums text-slate-600')}>
                {documentRef(workOrder.fortnox_order_number, workOrder.order_number)}
              </span>
              {overdue ? (
                <span className={cn(crm.badge, 'border-rose-200 bg-rose-50 text-rose-700')}>Försenad</span>
              ) : null}
              {fortnoxConnected ? (
                <span className={cn(crm.badge, syncStatusClass[workOrder.fortnox_order_sync_status])}>
                  Fortnox: {syncStatusLabel[workOrder.fortnox_order_sync_status]}
                </span>
              ) : null}
            </div>
            {/* crm.pageTitle (18 px), inte 24: detaljvyn missade den komprimering resten av CRM
                gick igenom, och projektnamnet här är ofta "6579 - Kund - Projekt" — på 24 px tog
                den en hel rad för sig själv och tryckte ner allt som faktiskt är arbetsytan. */}
            <h1 className={cn(crm.pageTitle, 'm-0')}>{workOrder.project_name}</h1>
            {/* slate-600, inte 500: raden ligger på sidbakgrunden (#e5ede5) där slate-500 mäter
                3,98:1 och faller under AA. Se pageSubtitle-noten i crmTokens. */}
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span>{workOrder.client_name}</span>
              <span>·</span>
              <span>{workOrder.quote_type === 'private' ? 'Privatkund' : 'Företag'}</span>
              {workOrder.customer_id ? (
                <a
                  // Bär med varifrån ordern öppnades, annars tappas planeringen vid en sväng
                  // förbi kundkortet: tillbaka till ordern, men ordern vet inte längre om tavlan.
                  href={withReturnTo(
                    `/crm/kunder/${workOrder.customer_id}`,
                    backTo === '/crm/arbetsorder'
                      ? `/crm/arbetsorder/${workOrder.id}`
                      : withReturnTo(`/crm/arbetsorder/${workOrder.id}`, backTo),
                  )}
                  className="font-medium text-emerald-700 transition hover:text-emerald-800 hover:underline"
                >
                  Öppna kundkort →
                </a>
              ) : null}
            </div>
          </div>
          {/* Under redigering äger den klistrade raden längst upp Spara/Avbryt — se kommentaren
              vid den. Här står bara ingången, i samma vikt som Filers "Ladda upp filer":
              samma plats och samma rang ska inte ha två olika knappvikter. */}
          {activeTab === 'overview' && !editingOverview ? (
            <button
              type="button"
              onClick={() => setEditingOverview(true)}
              className={crm.primaryButton}
              style={{ backgroundColor: 'var(--crm-primary)' }}
            >
              Redigera
            </button>
          ) : null}
        </div>
      </div>

      {/* Status stepper — stegen är klickbara genvägar till statusväljaren. Bara arbetsstatusarna
          (WORK_ORDER_STATUS_OPTIONS) går att sätta för hand: fakturastatus sätts av faktureringen
          och nekas av routen med 409, och en färdigfakturerad order är låst. Medan översikten
          redigeras äger formulärets väljare statusen — annars hade ett klick sparat direkt mitt i
          ett osparat utkast och tystat de övriga ändringarna. */}
      <Card className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={crm.cardTitle}>Förlopp</p>
          {/* slate-500, inte 400: slate-400 mäter 2,46:1 mot kortbakgrunden — långt under AA.
              Se sectionTitle-noten i crmTokens. */}
          {statusFlowEditable ? (
            <span className="text-xs text-slate-500">Klicka på ett steg för att ändra status</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {WORK_ORDER_STATUS_FLOW.map((step, i) => {
            const currentIndex = WORK_ORDER_STATUS_FLOW.indexOf(workOrder.status);
            const done = currentIndex >= 0 && i <= currentIndex;
            const isCurrent = workOrder.status === step;
            const clickable = statusFlowEditable && !isCurrent && WORK_ORDER_STATUS_OPTIONS.includes(step);
            const stepClass = cn(
              'rounded-full border px-3 py-1 text-xs font-semibold transition',
              isCurrent ? 'text-white' : done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-[#e0e8dc] bg-[#f1f5ee] text-slate-400',
            );
            const stepStyle = isCurrent ? { backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' } : undefined;
            return (
              <div key={step} className="flex items-center gap-1.5">
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => setStatusFromFlow(step)}
                    disabled={statusSaving !== null}
                    title={`Sätt status till ${workOrderStatusLabel[step]}`}
                    className={cn(stepClass, 'hover:border-emerald-300 hover:bg-emerald-100 hover:text-emerald-800')}
                  >
                    {statusSaving === step ? 'Sparar…' : workOrderStatusLabel[step]}
                  </button>
                ) : (
                  <span className={stepClass} style={stepStyle} aria-current={isCurrent ? 'step' : undefined}>
                    {workOrderStatusLabel[step]}
                  </span>
                )}
                {i < WORK_ORDER_STATUS_FLOW.length - 1 ? <span className={cn('h-px w-4', done ? 'bg-emerald-300' : 'bg-[#d4ddcd]')} /> : null}
              </div>
            );
          })}
          {workOrder.status === 'cancelled' ? (
            <span className={cn(crm.badge, 'ml-1', workOrderStatusClass.cancelled)}>Avbruten</span>
          ) : null}
        </div>
      </Card>

      {/* Tab strip */}
      <div className="flex flex-wrap gap-2">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveTab(value)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-sm font-semibold transition',
              activeTab === value ? 'text-white' : 'border-[#e0e8dc] bg-[#f9fbf7] text-slate-600 hover:border-[#cfdcc9]',
            )}
            style={activeTab === value ? { backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ─── Overview ───
          Vänsterspalten bär nu artikelraderna med sin redigerare (m² / tjocklek / densitet på en
          rad), så den fick mer av bredden. Sidokolumnen rymmer sitt innehåll på 300 px — den är
          etiketter, kontaktlänkar och knappar. */}
      {activeTab === 'overview' ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)] lg:items-start">
          <div className="grid gap-5">

            <Card className="grid gap-4 md:grid-cols-2">
              {editingOverview ? (
                <>
                  <label className="grid gap-1 text-sm text-slate-600">
                    <span className={crm.sectionTitle}>Status</span>
                    {/* invoiced / partially_invoiced are system-managed by the invoicing flow and
                        aren't in WORK_ORDER_STATUS_OPTIONS — show them read-only so the picker can't
                        render a value-less <select> or silently regress the status on save. */}
                    {/* Bara en FÄRDIGfakturerad order är låst. En delfakturerad rullar ofta vidare
                        och måste kunna sättas tillbaka till Pågående — statusen bär arbetsläget,
                        inte faktureringsläget (det visas som egen badge). */}
                    {workOrder.status === 'invoiced' ? (
                      <div className="flex h-11 items-center">
                        <span className={cn(crm.badge, workOrderStatusClass[workOrder.status])}>{workOrderStatusLabel[workOrder.status]}</span>
                      </div>
                    ) : (
                      // Nuvarande status läggs till i listan om den inte är valbar (delfakturerad).
                      // Annars matchar <Select value> ingen option, webbläsaren visar den FÖRSTA
                      // ("Utkast") och ett omedvetet val skulle degradera ordern.
                      <Select value={draft.status} onChange={(e) => setField('status', e.target.value as WorkOrderStatus)}>
                        {(WORK_ORDER_STATUS_OPTIONS.includes(workOrder.status)
                          ? WORK_ORDER_STATUS_OPTIONS
                          : [workOrder.status, ...WORK_ORDER_STATUS_OPTIONS]
                        ).map((value) => <option key={value} value={value}>{workOrderStatusLabel[value]}</option>)}
                      </Select>
                    )}
                  </label>
                  <label className="grid gap-1 text-sm text-slate-600">
                    <span className={crm.sectionTitle}>Ansvarig</span>
                    <Select value={draft.assigned_to} onChange={(e) => setField('assigned_to', e.target.value)}>
                      <option value="">Ej tilldelad</option>
                      {assignees.map((u) => <option key={u.id} value={u.id}>{u.full_name || 'Namnlös'}</option>)}
                    </Select>
                  </label>
                  <label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
                    <span className={crm.sectionTitle}>Önskat installationsdatum</span>
                    <Input value={draft.desired_installation_date} onChange={(e) => setField('desired_installation_date', e.target.value)} type="date" />
                  </label>
                </>
              ) : (
                <>
                  {/* Status står redan som badge i sidhuvudet OCH som markerat steg i förloppet
                      direkt ovanför. En tredje utskrift av samma ord tillför inget — den bara
                      tar den plats där Ansvarig och datumet ska kunna läsas direkt.
                      I redigeringsläget finns väljaren kvar; där är den kontrollen, inte en kopia. */}
                  {readField('Ansvarig', (workOrder.assigned_to ? (assigneeNameById.get(workOrder.assigned_to) || workOrder.assignee?.full_name) : null) || 'Ej tilldelad')}
                  {readField('Önskat installationsdatum', formatDate(workOrder.desired_installation_date))}
                  {/* Adressen skrevs ut TVÅ gånger i läsläget — en gång som kartlänk och en gång
                      som "Gatuadress"-fält, tecken för tecken samma sträng. Kvar står EN utskrift,
                      och det är den användbara: den man kan trycka på för att navigera. */}
                  <div className="grid gap-0.5 md:col-span-2">
                    <span className={crm.sectionTitle}>Arbetsadress</span>
                    {workAddressText ? (
                      <AddressLink value={workAddressText} className="text-sm" />
                    ) : (
                      <span className={crm.emptyValue}>Ingen angiven — lägg till den under Redigera så hittar installatörerna dit.</span>
                    )}
                  </div>
                </>
              )}
            </Card>

            {/* ⚠️ Arbetsadressen har EGET kort bara i redigeringsläget.
                I läsläget är den en rad i faktakortet ovan (vem, när, var — tre fakta som hör
                ihop och som tillsammans är en kortkropp värd namnet). Som eget kort var den en
                rubrik och en rad i 90 px höjd och såg oavslutad ut.
                I redigeringsläget är den tre fält plus adressökning plus en hjälptext — då bär
                den ett eget kort, och att blanda in den i statusväljarens kort hade gett ett
                formulär utan tydlig gruppering. */}
            {editingOverview ? (
              <Card className="grid gap-4">
                <div className="flex items-center justify-between gap-2">
                  <p className={crm.cardTitle}>Arbetsadress</p>
                  {workAddressText ? <AddressLink value={workAddressText} className="text-xs" /> : null}
                </div>
                  <label className="grid gap-1 text-sm text-slate-600">
                    <span className={crm.sectionTitle}>Gatuadress</span>
                    <AddressAutocompleteInput
                      value={draft.street_address}
                      onChange={(street) => setField('street_address', street)}
                      onSelect={(s) => setDraft((d) => (d ? {
                        ...d,
                        street_address: s.street || d.street_address,
                        postal_code: s.postal_code || d.postal_code,
                        city: s.city || d.city,
                      } : d))}
                      placeholder="Sök adress, t.ex. Industrivägen 4 Södertälje"
                    />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span className={crm.sectionTitle}>Postnummer</span>
                      <Input value={draft.postal_code} onChange={(e) => setField('postal_code', e.target.value)} placeholder="123 45" />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span className={crm.sectionTitle}>Ort</span>
                      <Input value={draft.city} onChange={(e) => setField('city', e.target.value)} placeholder="Ort" />
                    </label>
                  </div>
                  <p className="text-[11px] leading-snug text-slate-500">Adressen där arbetet utförs. Faktura- och övriga adresser ligger på kundkortet.</p>
              </Card>
            ) : null}

            <Card className="grid gap-4">
              <p className={crm.cardTitle}>Intern handoff</p>
              {editingOverview ? (
                <>
                  <label className="grid gap-1 text-sm text-slate-600">
                    <span className={crm.sectionTitle}>Arbetets scope</span>
                    <Input value={draft.work_scope} onChange={(e) => setField('work_scope', e.target.value)} placeholder="Kort operativ scope" />
                  </label>
                  {/* Måttblocket kan hämtas om här. Artiklarna rättas ofta EFTER att ordern
                      skapats, och då står beskrivningen kvar på offertens mått — installatören
                      bygger efter en siffra som inte gäller längre. Offerten är låst vid det
                      laget, så det här är enda stället att komma åt det. */}
                  <div className="grid gap-1 text-sm text-slate-600">
                    <div className="flex items-center justify-between gap-2">
                      <span className={crm.sectionTitle}>Överlämningsnotering</span>
                      <button
                        type="button"
                        onClick={addMeasurementsToHandoff}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                      >
                        Hämta mått från rader
                      </button>
                    </div>
                    {/* autoGrow: "Hämta mått från rader" fyller rutinmässigt fältet med 8–12
                        rader. I en ruta med fast höjd blev det en scrollfälla mitt på sidan —
                        hjulet åts av fältet och sidan stod still. */}
                    <Textarea autoGrow value={draft.handoff_notes} onChange={(e) => setField('handoff_notes', e.target.value)} placeholder="Detaljer till teamet" />
                    <p className="text-[11px] leading-snug text-slate-400">
                      Hämtar måtten från orderns artikelrader. Text du skrivit själv står kvar under dem.
                    </p>
                  </div>
                  <label className="grid gap-1 text-sm text-slate-600">
                    <span className={crm.sectionTitle}>Interna anteckningar</span>
                    <Textarea autoGrow value={draft.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Internt orderunderlag" />
                  </label>
                </>
              ) : (
                <div className="grid gap-3">
                  {readField('Arbetets scope', workOrder.internal_handoff?.work_scope)}
                  <div className="grid gap-0.5">
                    <span className={crm.sectionTitle}>Överlämningsnotering</span>
                    <span className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{workOrder.internal_handoff?.handoff_notes || '–'}</span>
                  </div>
                  <div className="grid gap-0.5">
                    <span className={crm.sectionTitle}>Interna anteckningar</span>
                    <span className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{workOrder.notes || '–'}</span>
                  </div>
                </div>
              )}
            </Card>

            {/* Spåret bakom snabböversiktens "Säckar (rapporterat)". Ligger efter handoffen
                (som säger vad teamet SKULLE göra) och före Ekonomi. */}
            <WorkOrderSackTrailCard
              reports={sackReports.reports}
              loading={sackReports.loading}
              loadError={sackReports.loadError}
              isRemoving={sackReports.isRemoving}
              onDelete={removeSackReport}
            />

            {/* ─── Ekonomi ────────────────────────────────────────────────────
                Artiklar, summering och fakturering i ETT kort (var två egna flikar).
                Summeringen är artiklarnas enda — den räknar live medan raderna
                redigeras, till skillnad från den sparade pricing_summary som låg här
                förut, och bär nu även momssatsen och byggmomsen. */}
            <Card className="grid gap-4">
              <p className={crm.cardTitle}>Ekonomi</p>

              <WorkOrderArticles
                embedded
                items={(workOrder.line_items || []) as ArticleLineItem[]}
                currencyCode={workOrder.currency_code}
                vatPercent={workOrder.vat_percent}
                quoteType={workOrder.quote_type}
                rotDetails={workOrder.rot_details}
                reverseCharge={reverseCharge}
                saving={savingArticles}
                fortnoxConnected={fortnoxConnected}
                // Bara en FÄRDIGfakturerad order är låst. En delfakturerad går att redigera — rundorna
                // nycklas på radens id, så positionen är betydelselös och projektet kan ändras medan det
                // pågår. Servern (validateLineItemEdit) skyddar det som redan står på en utställd faktura.
                canEdit={!workOrder.fortnox_invoice_number && workOrder.status !== 'invoiced'}
                // Skälet skickas in — komponenten får inte gissa det. Här, och bara här, betyder
                // canEdit=false verkligen att ordern är färdigfakturerad.
                lockedReason="Arbetsordern är fakturerad och kan inte ändras."
                // Avskrivning finns kvar även när editorn är låst — det är hela poängen. Utom på en
                // färdigfakturerad order, där det inte finns något kvar att skriva av.
                onSave={saveArticles}
              />

              {rot.enabled ? (
                <div className="grid gap-2 rounded-xl border border-[#e0e8dc] bg-[#f1f5ee] p-3.5">
                  <p className={crm.sectionTitle}>ROT-uppställning</p>
                  <div className="grid gap-x-6 sm:grid-cols-2">
                    {rot.property_designation ? <StatField label="Fastighetsbeteckning" value={rot.property_designation} /> : null}
                    {rot.rot_percent != null ? <StatField label="Skattereduktion" value={`${rot.rot_percent}%`} /> : null}
                    {rot.max_deduction != null ? <StatField label="Max avdrag" value={formatCurrency(rot.max_deduction, workOrder.currency_code)} /> : null}
                    {rot.brf_org_number ? <StatField label="BRF org.nr" value={rot.brf_org_number} /> : null}
                  </div>
                </div>
              ) : null}

              {fortnoxConnected ? (
                <div className="grid gap-3 border-t border-[#e0e8dc] pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className={crm.sectionTitle}>Fortnox faktura</p>
                    <span className={cn(crm.badge, syncStatusClass[workOrder.fortnox_invoice_sync_status])}>{syncStatusLabel[workOrder.fortnox_invoice_sync_status]}</span>
                  </div>

                  {/* Delfakturering history — one expandable row per invoice round (empty for one-shot
                      invoices). Expanding shows exactly which articles + quantities that round billed. */}
                  {invoiceRounds.length > 0 ? (
                    <div className="grid gap-1.5">
                      {invoiceRounds.map((r) => {
                        const open = expandedRounds.has(r.id);
                        const lines = roundLineBreakdown((workOrder.line_items || []) as Array<Record<string, any>>, r.line_quantities);
                        return (
                          <div key={r.id} className="overflow-hidden rounded-lg border border-[#e0e8dc] bg-[#f1f5ee]">
                            <button
                              type="button"
                              onClick={() => toggleRound(r.id)}
                              aria-expanded={open}
                              className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[#eaf0e6]"
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                <svg className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-90')} width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                  <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-slate-700">
                                    Delfaktura {r.round_number}{r.fortnox_invoice_number ? ` · #${r.fortnox_invoice_number}` : ''}
                                  </p>
                                  <p className="text-[11px] text-slate-400">{formatDateTime(r.created_at)}</p>
                                </div>
                              </div>
                              <span className="shrink-0 text-xs tabular-nums text-slate-600">{formatCurrency(r.amount, workOrder.currency_code)}</span>
                            </button>
                            {open ? (
                              <div className="grid gap-1 border-t border-[#dce4d8] px-2.5 py-1.5">
                                {lines.length === 0 ? (
                                  <p className="text-[11px] text-slate-400">Inga rader.</p>
                                ) : (
                                  lines.map((l, i) => (
                                    <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                                      <span className="min-w-0 truncate text-slate-600">
                                        {l.name}
                                        {l.quantity ? <span className="text-slate-400"> · {l.quantity}{l.unit ? ` ${l.unit}` : ''}</span> : null}
                                      </span>
                                      <span className="shrink-0 tabular-nums text-slate-500">{formatCurrency(l.amount, workOrder.currency_code)}</span>
                                    </div>
                                  ))
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {workOrder.status === 'invoiced' && workOrder.fortnox_invoice_number ? (
                    <>
                      <StatField label="Fakturanummer" value={`#${workOrder.fortnox_invoice_number}`} />
                      {workOrder.fortnox_invoiced_at ? (
                        <p className="text-xs text-slate-400">Skapad {formatDateTime(workOrder.fortnox_invoiced_at)}</p>
                      ) : null}
                      <p className="text-[11px] leading-4 text-slate-400">
                        {invoiceRounds.length > 1 ? 'Alla delfakturor finns i Fortnox. Slutför faktureringen där.' : 'Fakturautkast finns i Fortnox. Slutför faktureringen där.'}
                      </p>
                    </>
                  ) : workOrder.status === 'completed' || workOrder.status === 'partially_invoiced' || workOrder.partial_invoicing_started_at ? (
                    <>
                      <div className="grid gap-2">
                        <button type="button" onClick={() => setConfirmInvoiceOpen(true)} disabled={creatingInvoice || submittingPartial} className={cn(crm.saveButton, 'h-10 w-full')}>
                          {creatingInvoice ? 'Skapar…' : workOrder.partial_invoicing_started_at ? 'Fakturera resten' : 'Fakturera allt'}
                        </button>
                        <button type="button" onClick={() => setShowPartialModal(true)} disabled={creatingInvoice || submittingPartial} className={cn(crm.ghostButton, 'h-10 w-full')}>
                          Delfakturera…
                        </button>
                      </div>
                      <p className="text-[11px] leading-4 text-slate-400">Skapar fakturautkast i Fortnox. Bokföring och utskick görs sedan i Fortnox.</p>
                    </>
                  ) : (
                    <p className="text-[11px] leading-4 text-slate-400">Sätt arbetsordern till “Fakturera” för att skapa en faktura i Fortnox.</p>
                  )}
                </div>
              ) : null}
            </Card>
          </div>

          {/* Sidebar
              ────────
              KLISTRAD. Vänsterspalten är på en riktig order 2–3 gånger så hög som den här —
              Ekonomi-kortet ensamt bär ofta ett dussin artikelrader. Topplinjerad slutade
              sidokolumnen efter en dryg tredjedel och resten av sidan scrollade förbi ~1 600 px
              tom yta, samtidigt som det som står här (Fortnox-åtgärderna, kontakten, säck- och
              timtalen) är precis det man vill kunna läsa av MEDAN man går igenom raderna.

              max-h + overflow-auto är avsiktligt: på en kort skärm är kolumnen själv högre än
              rutan, och utan taket hade dess nedre del aldrig gått att nå. */}
          <div
            className={cn(
              'grid gap-5 lg:sticky lg:content-start lg:overflow-y-auto lg:pb-2',
              // Går fri från den klistrade åtgärdsraden när den finns, och lägger sig tätt när
              // den inte gör det — annars stod 64 px tomt ovanför kolumnen i läsläget.
              editingOverview ? 'lg:top-16 lg:max-h-[calc(100vh-5rem)]' : 'lg:top-4 lg:max-h-[calc(100vh-2rem)]',
            )}
          >

            {/* ─── Kontakt & referens ────────────────────────────────────────
                ETT kort, TVÅ tydligt åtskilda avsnitt.

                ⚠️ De två är INTE samma sak och får aldrig börja läsas som det. "Er referens" är
                kundens formella referens — den enda av de två som kunden ser, och den som styr
                fakturan till rätt attestant. "Kundkontakt" är personen vi och installatörerna
                ringer, och den skickas inte till Fortnox. De delade en gång FÄLT, vilket gjorde
                att en rättad telefonkontakt skrev om referensen. Det felet är inte tillbaka —
                utkastet har fortfarande `your_reference` skilt från `contact_*` — men kortet bär
                med flit egen rubrik per avsnitt och en hårfin avdelare emellan, så skillnaden
                syns även när de nu står i samma ruta.

                Var två egna kort. Vart och ett blev en rubrik och en rad, och två sådana på rad
                gav mer kantlinje än innehåll. */}
            {editingOverview || draft?.your_reference || customerPhone || customerEmail || customerContact ? (
              <Card className="grid gap-3">
                <p className={crm.cardTitle}>Kontakt &amp; referens</p>

                {editingOverview ? (
                  <label className="grid gap-1 text-sm text-slate-600">
                    <span className={crm.sectionTitle}>Er referens</span>
                    <Input
                      value={draft.your_reference}
                      onChange={(e) => setField('your_reference', e.target.value)}
                      placeholder="Kundens referens"
                    />
                    <span className="text-xs text-slate-500">Kundens egen referens — följer med till Fortnox och syns på order och faktura.</span>
                  </label>
                ) : draft?.your_reference ? (
                  <div className="grid gap-0.5">
                    <span className={crm.sectionTitle}>Er referens</span>
                    <p className="m-0 text-sm font-semibold text-slate-900">{draft.your_reference}</p>
                  </div>
                ) : null}

                {editingOverview ? (
                  <div className="grid gap-3 border-t border-[#e0e8dc] pt-3">
                    <div className="grid gap-0.5">
                      <span className={crm.sectionTitle}>Kundkontakt</span>
                      <span className="text-xs text-slate-500">För er och installatörerna. Skickas inte till Fortnox.</span>
                    </div>
                {/* Pick a different contact if the responsible person changed offer→order. */}
                {customerContacts.length > 0 ? (
                  <Select
                    aria-label="Välj kontaktperson"
                    value={customerContacts.find((c) => c.name === draft.contact_name)?.id ?? ''}
                    onChange={(e) => {
                      const c = customerContacts.find((x) => x.id === e.target.value);
                      if (!c) return;
                      // Delad regel, fält för fält: kontaktraden vinner där den har ett värde,
                      // kortet fyller luckorna. Råa c.phone/c.email tömde fälten när raden
                      // saknade dem (privatkundens automatiska kontakt bär bara namnet).
                      const resolved = resolveCrmContact({ ...customerCard, contacts: customerContacts }, c);
                      setDraft((d) => (d ? { ...d, contact_name: resolved.name, contact_phone: resolved.phone, contact_email: resolved.email } : d));
                    }}
                  >
                    <option value="">Skriv manuellt…</option>
                    {customerContacts.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.role ? ` (${c.role})` : ''}{c.is_primary ? ' – primär' : ''}</option>
                    ))}
                  </Select>
                ) : null}
                <label className="grid gap-1 text-sm text-slate-600">
                  <span className={crm.sectionTitle}>Namn</span>
                  <Input value={draft.contact_name} onChange={(e) => setField('contact_name', e.target.value)} placeholder="Kontaktperson" />
                </label>
                <label className="grid gap-1 text-sm text-slate-600">
                  <span className={crm.sectionTitle}>Telefon</span>
                  <Input value={draft.contact_phone} onChange={(e) => setField('contact_phone', e.target.value)} placeholder="070-123 45 67" inputMode="tel" />
                </label>
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span className={crm.sectionTitle}>E-post</span>
                      <Input value={draft.contact_email} onChange={(e) => setField('contact_email', e.target.value)} placeholder="namn@exempel.se" type="email" />
                    </label>
                  </div>
                ) : (customerPhone || customerEmail || customerContact) ? (
                  // Avdelaren bara när BÅDA avsnitten står i kortet — annars ritar den en linje
                  // under en rubrik som inget står ovanför.
                  <div className={cn('grid gap-1.5', draft?.your_reference && 'border-t border-[#e0e8dc] pt-3')}>
                    <span className={crm.sectionTitle}>Kundkontakt</span>
                    <p className="m-0 text-sm font-semibold text-slate-900">{customerContact || workOrder.client_name}</p>
                    <div className="grid gap-1.5 text-sm">
                      {customerPhone ? <PhoneLink value={customerPhone} /> : null}
                      {customerEmail ? <EmailLink value={customerEmail} /> : null}
                    </div>
                  </div>
                ) : null}
              </Card>
            ) : null}

            {/* Fortnox order */}
            {fortnoxConnected ? (
              <Card className="grid gap-3">
                <div className="flex items-center justify-between gap-2">
                  <p className={crm.cardTitle}>Fortnox order</p>
                  <span className={cn(crm.badge, syncStatusClass[workOrder.fortnox_order_sync_status])}>{syncStatusLabel[workOrder.fortnox_order_sync_status]}</span>
                </div>
                {workOrder.fortnox_order_number ? (
                  <StatField label="Ordernummer" value={`#${workOrder.fortnox_order_number}`} />
                ) : null}
                {workOrder.fortnox_order_synced_at ? (
                  <p className="text-xs text-slate-500">Synkad {formatDateTime(workOrder.fortnox_order_synced_at)}</p>
                ) : null}
                {workOrder.fortnox_order_sync_status !== 'synced' ? (
                  <button type="button" onClick={pushToFortnox} disabled={pushingFortnox} className={cn(crm.saveButton, 'h-10 w-full')}>
                    {pushingFortnox ? 'Skickar…' : workOrder.fortnox_order_sync_status === 'failed' ? 'Försök igen' : 'Skicka till Fortnox'}
                  </button>
                ) : (
                  <button type="button" onClick={pushToFortnox} disabled={pushingFortnox} className={crm.ghostButton}>
                    {pushingFortnox ? 'Skickar…' : 'Synka om'}
                  </button>
                )}

                {/* Order confirmation PDF/email — available once the order exists in Fortnox */}
                {workOrder.fortnox_order_number ? (
                  <div className="grid grid-cols-2 gap-2 border-t border-[#e0e8dc] pt-3">
                    <button
                      type="button"
                      onClick={() => openFortnoxPdf(`/api/crm/work-orders/${workOrder.id}/fortnox/pdf`)}
                      // Handrullad kopia av ghostButton — nu delad recept, så paret får samma
                      // höjd och samma hover som resten av sidokolumnen.
                      className={cn(crm.ghostButton, 'h-9 w-full')}
                    >
                      Hämta PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => documentEmail.start({
                        id: workOrder.id,
                        kind: 'order',
                        ref: documentRef(workOrder.fortnox_order_number, workOrder.order_number),
                        projectName: workOrder.project_name,
                        customerName: workOrder.client_name,
                        snapshotEmail: snapshot.email,
                        customerId: workOrder.customer_id,
                        pdfUrl: `/api/crm/work-orders/${workOrder.id}/fortnox/pdf`,
                      })}
                      disabled={documentEmail.sendingId === workOrder.id}
                      // Var indigo — sidans enda färg utanför varumärkesrampen, och starkare än
                      // "Skicka till Fortnox" som är den mer konsekvensrika åtgärden.
                      className={cn(crm.saveButton, 'h-9')}
                    >
                      {documentEmail.sendingId === workOrder.id ? 'Mejlar…' : 'Mejla order'}
                    </button>
                    <p className="col-span-2 text-[11px] leading-4 text-slate-400">Orderbekräftelse från Fortnox. Mejlet öppnas i ditt eget mejlprogram – PDF:en laddas ner att bifoga.</p>
                  </div>
                ) : null}
              </Card>
            ) : null}

            {/* Snapshot */}
            <Card className="grid gap-3">
              <p className={crm.cardTitle}>Snabböversikt</p>
              {/* Hårfina avdelare i stället för fem separata rutor: raderna hör ihop och läses
                  som en lista, inte som fem avstängda fält. */}
              <div className="grid divide-y divide-[#e8eee4]">
                {/* Total och Rader står i Ekonomi-kortet i spalten bredvid — här blev de bara
                    en andra uppsättning av samma siffror. Kvar står det som inte syns någon
                    annanstans på sidan. */}
                {totalSacks > 0 ? <StatField label="Säckar (beräknat)" value={`${totalSacks} st`} /> : null}
                {/* Rapporterat bredvid beräknat, så avvikelsen syns på ordern och inte bara på
                    planeringstavlan. Saknad rapport skrivs ut som "Ej rapporterat" och ALDRIG som
                    en nolla: noll rapporterade säckar påstår att inget material gick åt, medan
                    avsaknad av rapport bara säger att ingen rapporterat. Det senare gäller varje
                    order där ingen rapporterat. Talet går genom supersede-regeln: finns en
                    egenkontroll är den jobbets sanning, annars summan av delrapporterna — aldrig
                    bådadera. Spåret bakom talet står i Säckrapporter-kortet nedan. */}
                {totalSacks > 0 || reportedSacks != null ? (
                  <StatField
                    label="Säckar (rapporterat)"
                    value={reportedSacks == null
                      ? <span className="font-normal text-slate-400">Ej rapporterat</span>
                      : `${reportedSacks} st`}
                  />
                ) : null}
                <StatField label="Loggade timmar" value={`${totalLoggedHours.toFixed(1)} h`} />
                <StatField label="Kommentarer" value={comments.length} />
                {/* Dokumentreferens enligt husets standard: Fortnox-numret när det finns, vårt
                    eget dessförinnan. Stod tidigare som ett avhugget uuid ("Offert a1b2c3d4…") —
                    ett nummer som varken gick att slå upp eller matchade något annat i appen. */}
                <StatField
                  label="Källa"
                  value={workOrder.quote_id
                    ? `Offert ${documentRef(sourceQuote?.fortnox_offer_number, sourceQuote?.quote_number)}`
                    : 'Skapad direkt (utan offert)'}
                />
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {/* ─── Comments (on the overview, full width below the columns) ─── */}
      {activeTab === 'overview' ? (
        <WorkOrderCommentsTab
          comments={comments}
          loading={commentsLoading}
          currentUserId={currentUserId}
          mentionUsers={mentionUsers}
          onCreate={createComment}
          onUpdate={updateComment}
          onDelete={deleteComment}
        />
      ) : null}

      {/* ─── Files ─── */}
      {activeTab === 'files' ? (
        <WorkOrderFilesTab
          workOrderId={workOrderId}
          files={workOrderFiles.files}
          loading={workOrderFiles.loading}
          currentUserId={currentUserId}
          canUpload={workOrderFiles.canUpload}
          canMarkInternal={workOrderFiles.canMarkInternal}
          canDeleteAny={workOrderFiles.canDeleteAny}
          uploadProgress={workOrderFiles.uploadProgress}
          onUpload={workOrderFiles.uploadFiles}
          onDelete={workOrderFiles.deleteFile}
        />
      ) : null}

      {/* ─── Time ─── */}
      {activeTab === 'time' ? (
        <WorkOrderTimeTab
          entries={timeEntries}
          loading={timeEntriesLoading}
          totalHours={totalLoggedHours}
          currentUserId={currentUserId}
          onCreate={createTimeEntry}
          onUpdate={updateTimeEntry}
          onDelete={deleteTimeEntry}
        />
      ) : null}

      {/* Delfakturering modal — per-article quantities to invoice now. */}
      {showPartialModal && workOrder ? (
        <WorkOrderPartialInvoiceModal
          lineItems={(workOrder.line_items || []) as any}
          rounds={invoiceRounds}
          currencyCode={workOrder.currency_code}
          submitting={submittingPartial}
          onClose={() => setShowPartialModal(false)}
          onSubmit={submitPartialInvoice}
        />
      ) : null}

      {/* Fakturera allt / Fakturera resten — bekräftelsen innan ett utkast skapas i Fortnox.
          Bekräftelseknappen bär samma etikett som knappen som öppnade dialogen. */}
      {confirmInvoiceOpen ? (
        <CrmConfirmDialog
          title={workOrder.partial_invoicing_started_at ? 'Fakturera resten av ordern?' : 'Skapa fakturautkast i Fortnox?'}
          message={
            workOrder.partial_invoicing_started_at
              ? 'Ett fakturautkast skapas i Fortnox för det som inte redan delfakturerats. Bokföring och utskick görs sedan i Fortnox.'
              : 'Ett fakturautkast skapas från den här ordern. Själva faktureringen görs sedan i Fortnox.'
          }
          confirmLabel={workOrder.partial_invoicing_started_at ? 'Fakturera resten' : 'Fakturera allt'}
          busy={creatingInvoice}
          onConfirm={() => void createInvoice()}
          onCancel={() => setConfirmInvoiceOpen(false)}
        />
      ) : null}

      {documentEmail.modal}
    </div>
  );
}

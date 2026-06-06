"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm, syncStatusLabel, syncStatusClass } from '@/app/crm/lib/crmTokens';
import { PhoneLink, EmailLink, AddressLink } from '@/app/crm/components/ContactLinks';
import { lineItemQuantity } from '@/lib/domains/crm/lineItems';
import { inferMaterialFromArticle, sacksFor } from '@/lib/domains/crm/materials';
import { parseDecimal } from '@/lib/shared/number';
import WorkOrderTimeTab, { type TimeEntryItem, type TimeDraft } from './WorkOrderTimeTab';
import WorkOrderCommentsTab, { type CommentItem } from './WorkOrderCommentsTab';
import { type MentionUser } from '@/app/crm/components/MentionTextarea';

// ─── Types ──────────────────────────────────────────────────────────────────

type WorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'cancelled';
type WorkOrderTab = 'overview' | 'economy' | 'articles' | 'time' | 'comments';
type FortnoxSyncStatus = 'not_synced' | 'pending' | 'synced' | 'failed';

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
};

type WorkOrderItem = {
  id: string;
  quote_id: string;
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
  delivery_address: string;
  invoice_address: string;
  work_scope: string;
  handoff_notes: string;
  notes: string;
};

type AssignableUser = { id: string; full_name: string | null; role?: string | null };

// ─── Meta / helpers ───────────────────────────────────────────────────────────

const workOrderStatusMeta: Record<WorkOrderStatus, { label: string; className: string }> = {
  draft:       { label: 'Utkast',   className: 'border-slate-200 bg-slate-50 text-slate-600' },
  scheduled:   { label: 'Planerad', className: 'border-sky-200 bg-sky-50 text-sky-700' },
  ready:       { label: 'Redo',     className: 'border-amber-200 bg-amber-50 text-amber-700' },
  in_progress: { label: 'Pågår',    className: 'border-violet-200 bg-violet-50 text-violet-700' },
  completed:   { label: 'Klar',     className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  cancelled:   { label: 'Avbruten', className: 'border-rose-200 bg-rose-50 text-rose-700' },
};

// The normal forward flow shown as a stepper. `cancelled` is off-flow.
const STATUS_FLOW: WorkOrderStatus[] = ['draft', 'scheduled', 'ready', 'in_progress', 'completed'];

function formatDate(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '–' : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}
function formatDateTime(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '–' : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function formatCurrency(value: number | string | null | undefined, currencyCode: string) {
  const numeric = typeof value === 'number' ? value : Number(String(value || '0'));
  if (!Number.isFinite(numeric)) return '–';
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currencyCode || 'SEK', maximumFractionDigits: 0 }).format(numeric);
}
function isOverdue(date: string | null, status: WorkOrderStatus) {
  if (!date || status === 'completed' || status === 'cancelled') return false;
  const d = new Date(`${date}T23:59:59`);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}
function joinAddress(parts: Array<string | null | undefined>) {
  return parts.filter((p) => p && p.trim()).join(', ');
}

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

function StatField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#e0e8dc] bg-[#f1f5ee] px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <strong className="text-slate-900">{value}</strong>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function WorkOrderDetailClient({ workOrderId, fortnoxConnected, currentUserId }: { workOrderId: string; fortnoxConnected: boolean; currentUserId: string | null }) {
  const router = useRouter();
  const toast = useToast();

  const [workOrder, setWorkOrder] = useState<WorkOrderItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pushingFortnox, setPushingFortnox] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkOrderTab>('overview');
  const [draft, setDraft] = useState<WorkOrderDraft | null>(null);

  const [assignees, setAssignees] = useState<AssignableUser[]>([]);
  const [mentionUsers, setMentionUsers] = useState<MentionUser[]>([]);
  const [customerInfo, setCustomerInfo] = useState<{ contactName: string | null; phone: string | null; email: string | null } | null>(null);
  const [timeEntries, setTimeEntries] = useState<TimeEntryItem[]>([]);
  const [timeEntriesLoading, setTimeEntriesLoading] = useState(false);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);

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
      } catch { if (active) setError('Kunde inte ladda arbetsorder'); }
      finally { if (active) setLoading(false); }
    }
    load();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId]);

  // Load assignees + related lists once the work order is loaded
  useEffect(() => {
    if (!workOrder) return;
    let active = true;
    async function loadRelated() {
      setTimeEntriesLoading(true); setCommentsLoading(true);
      try {
        const [assigneeRes, timeRes, commentRes, mentionRes] = await Promise.all([
          fetch('/api/crm/work-orders/assignees', { cache: 'no-store' }),
          fetch(`/api/crm/work-orders/${workOrderId}/time-entries`, { cache: 'no-store' }),
          fetch(`/api/crm/work-orders/${workOrderId}/comments`, { cache: 'no-store' }),
          fetch('/api/crm/work-orders/mention-users', { cache: 'no-store' }),
        ]);
        const [assigneeJson, timeJson, commentJson, mentionJson] = await Promise.all([
          assigneeRes.json().catch(() => ({})), timeRes.json().catch(() => ({})), commentRes.json().catch(() => ({})), mentionRes.json().catch(() => ({})),
        ]);
        if (!active) return;
        setAssignees(assigneeRes.ok && assigneeJson.ok ? assigneeJson.data?.items || [] : []);
        setTimeEntries(timeRes.ok && timeJson.ok ? timeJson.data?.items || [] : []);
        setComments(commentRes.ok && commentJson.ok ? commentJson.data?.items || [] : []);
        setMentionUsers(mentionRes.ok && mentionJson.ok ? mentionJson.data?.items || [] : []);
      } catch { /* non-fatal */ }
      finally { if (active) { setTimeEntriesLoading(false); setCommentsLoading(false); } }
    }
    loadRelated();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrder?.id]);

  // Load the linked customer for reliable contact info. The quote snapshot only carries
  // the primary contact person's details, which private customers usually lack — so we
  // read the customer's own phone/mobile/email straight from the customer card.
  useEffect(() => {
    const customerId = workOrder?.customer_id;
    if (!customerId) { setCustomerInfo(null); return; }
    let active = true;
    fetch(`/api/crm/customers/${customerId}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (!active) return;
        const c = json?.data?.item;
        if (!c) { setCustomerInfo(null); return; }
        const primary = (c.contacts || []).find((x: any) => x.is_primary) || (c.contacts || [])[0] || null;
        setCustomerInfo({
          contactName: primary?.name || null,
          phone: c.phone || c.mobile || primary?.phone || null,
          email: c.email || primary?.email || null,
        });
      })
      .catch(() => { if (active) setCustomerInfo(null); });
    return () => { active = false; };
  }, [workOrder?.customer_id]);

  function applyWorkOrder(item: WorkOrderItem) {
    setWorkOrder(item);
    setDraft({
      status: item.status,
      assigned_to: item.assigned_to || '',
      desired_installation_date: item.desired_installation_date || '',
      street_address: item.work_address?.street_address || '',
      postal_code: item.work_address?.postal_code || '',
      city: item.work_address?.city || '',
      delivery_address: item.work_address?.delivery_address || '',
      invoice_address: item.work_address?.invoice_address || '',
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
  const sackRows = useMemo(() => {
    if (!workOrder?.line_items) return [];
    return workOrder.line_items.map((item) => {
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
          work_address: {
            street_address: draft.street_address,
            postal_code: draft.postal_code,
            city: draft.city,
            delivery_address: draft.delivery_address,
            invoice_address: draft.invoice_address,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte spara arbetsorder'); return; }
      if (json.data?.item) applyWorkOrder(json.data.item as WorkOrderItem);
      toast.success('Arbetsorder sparad');
    } catch { toast.error('Kunde inte spara arbetsorder'); }
    finally { setSaving(false); }
  }

  async function pushToFortnox() {
    if (!workOrder) return;
    setPushingFortnox(true);
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrder.id}/fortnox`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte skicka till Fortnox'); return; }
      if (json.data?.item) applyWorkOrder(json.data.item as WorkOrderItem);
      if (json.data?.fortnox_error) toast.error(`Fortnox-synk misslyckades: ${json.data.fortnox_error}`);
      else toast.success('Arbetsorder synkad med Fortnox');
    } catch { toast.error('Fel vid Fortnox-synk'); }
    finally { setPushingFortnox(false); }
  }

  // ── Time entries (create / update / delete) ──
  async function createTimeEntry(data: TimeDraft): Promise<boolean> {
    if (!workOrder) return false;
    if (!data.work_date || !data.hours.trim()) { toast.error('Datum och timmar krävs'); return false; }
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrder.id}/time-entries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_date: data.work_date, hours: Number(data.hours.replace(',', '.')), note: data.note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte logga tid'); return false; }
      if (json.data?.item) setTimeEntries((c) => [json.data.item, ...c]);
      toast.success('Tid loggad');
      return true;
    } catch { toast.error('Kunde inte logga tid'); return false; }
  }

  async function updateTimeEntry(id: string, data: TimeDraft): Promise<boolean> {
    if (!workOrder) return false;
    if (!data.work_date || !data.hours.trim()) { toast.error('Datum och timmar krävs'); return false; }
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrder.id}/time-entries/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_date: data.work_date, hours: Number(data.hours.replace(',', '.')), note: data.note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte uppdatera tidrad'); return false; }
      if (json.data?.item) setTimeEntries((c) => c.map((e) => (e.id === id ? json.data.item : e)));
      toast.success('Tidrad uppdaterad');
      return true;
    } catch { toast.error('Kunde inte uppdatera tidrad'); return false; }
  }

  async function deleteTimeEntry(id: string): Promise<boolean> {
    if (!workOrder) return false;
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrder.id}/time-entries/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte ta bort tidrad'); return false; }
      setTimeEntries((c) => c.filter((e) => e.id !== id));
      toast.success('Tidrad borttagen');
      return true;
    } catch { toast.error('Kunde inte ta bort tidrad'); return false; }
  }

  // ── Comments (create / update / delete) ──
  async function createComment(body: string): Promise<boolean> {
    if (!workOrder || !body.trim()) { toast.error('Kommentar krävs'); return false; }
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrder.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte spara kommentar'); return false; }
      if (json.data?.item) setComments((c) => [json.data.item, ...c]);
      toast.success('Kommentar sparad');
      return true;
    } catch { toast.error('Kunde inte spara kommentar'); return false; }
  }

  async function updateComment(id: string, body: string): Promise<boolean> {
    if (!workOrder || !body.trim()) { toast.error('Kommentar krävs'); return false; }
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrder.id}/comments/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte uppdatera kommentar'); return false; }
      if (json.data?.item) setComments((c) => c.map((e) => (e.id === id ? json.data.item : e)));
      toast.success('Kommentar uppdaterad');
      return true;
    } catch { toast.error('Kunde inte uppdatera kommentar'); return false; }
  }

  async function deleteComment(id: string): Promise<boolean> {
    if (!workOrder) return false;
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrder.id}/comments/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte ta bort kommentar'); return false; }
      setComments((c) => c.filter((e) => e.id !== id));
      toast.success('Kommentar borttagen');
      return true;
    } catch { toast.error('Kunde inte ta bort kommentar'); return false; }
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
        <button type="button" onClick={() => router.push('/crm/arbetsorder')} className="inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800">
          <BackArrow /> Arbetsorder
        </button>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error || 'Arbetsordern hittades inte.'}</div>
      </div>
    );
  }

  const meta = workOrderStatusMeta[workOrder.status];
  const overdue = isOverdue(workOrder.desired_installation_date, workOrder.status);
  const snapshot = workOrder.customer_snapshot || {};
  // Prefer the live customer record; fall back to the quote snapshot.
  const customerPhone: string | null = customerInfo?.phone ?? (snapshot.phone || null);
  const customerEmail: string | null = customerInfo?.email ?? (snapshot.email || null);
  const customerContact: string | null = customerInfo?.contactName ?? (snapshot.contact_name || null);
  const workAddressText = joinAddress([workOrder.work_address?.street_address, workOrder.work_address?.postal_code, workOrder.work_address?.city]);
  const rot = workOrder.rot_details || {};
  const tabs: Array<[WorkOrderTab, string]> = [
    ['overview', 'Översikt'], ['economy', 'Ekonomi'], ['articles', 'Artiklar'], ['time', 'Tid'], ['comments', 'Kommentarer'],
  ];

  return (
    <div className="grid grid-cols-1 gap-6 pb-10">

      {/* Header */}
      <div>
        <button type="button" onClick={() => router.push('/crm/arbetsorder')} className="mb-2 inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800">
          <BackArrow /> Arbetsorder
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(crm.badge, meta.className)}>{meta.label}</span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{workOrder.order_number}</span>
              {overdue ? (
                <span className={cn(crm.badge, 'border-rose-200 bg-rose-50 text-rose-700')}>Försenad</span>
              ) : null}
              {fortnoxConnected ? (
                <span className={cn(crm.badge, syncStatusClass[workOrder.fortnox_order_sync_status])}>
                  Fortnox: {syncStatusLabel[workOrder.fortnox_order_sync_status]}
                  {workOrder.fortnox_order_number ? ` · #${workOrder.fortnox_order_number}` : ''}
                </span>
              ) : null}
            </div>
            <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">{workOrder.project_name}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span>{workOrder.client_name}</span>
              <span>·</span>
              <span>{workOrder.quote_type === 'private' ? 'Privatkund' : 'Företag'}</span>
              {workOrder.customer_id ? (
                <a href={`/crm/kunder/${workOrder.customer_id}`} className="font-medium text-emerald-700 transition hover:text-emerald-800 hover:underline">Öppna kundkort →</a>
              ) : null}
            </div>
          </div>
          <button type="button" onClick={saveWorkOrder} disabled={saving} className={cn(crm.saveButton, 'h-10 w-auto px-5')}>
            {saving ? 'Sparar…' : 'Spara arbetsorder'}
          </button>
        </div>
      </div>

      {/* Status stepper */}
      <Card className="grid gap-3">
        <p className={crm.sectionTitle}>Förlopp</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FLOW.map((step, i) => {
            const currentIndex = STATUS_FLOW.indexOf(workOrder.status);
            const done = currentIndex >= 0 && i <= currentIndex;
            const isCurrent = workOrder.status === step;
            return (
              <div key={step} className="flex items-center gap-1.5">
                <span className={cn(
                  'rounded-full border px-3 py-1 text-xs font-semibold transition',
                  isCurrent ? 'text-white' : done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-[#e0e8dc] bg-[#f1f5ee] text-slate-400',
                )} style={isCurrent ? { backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' } : undefined}>
                  {workOrderStatusMeta[step].label}
                </span>
                {i < STATUS_FLOW.length - 1 ? <span className={cn('h-px w-4', done ? 'bg-emerald-300' : 'bg-[#d4ddcd]')} /> : null}
              </div>
            );
          })}
          {workOrder.status === 'cancelled' ? (
            <span className={cn(crm.badge, 'ml-1', workOrderStatusMeta.cancelled.className)}>Avbruten</span>
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

      {/* ─── Overview ─── */}
      {activeTab === 'overview' ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-start">
          <div className="grid gap-5">

            <Card className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm text-slate-600">
                <span className={crm.sectionTitle}>Status</span>
                <Select value={draft.status} onChange={(e) => setField('status', e.target.value as WorkOrderStatus)}>
                  {Object.entries(workOrderStatusMeta).map(([value, m]) => <option key={value} value={value}>{m.label}</option>)}
                </Select>
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
            </Card>

            <Card className="grid gap-4">
              <div className="flex items-center justify-between gap-2">
                <p className={crm.sectionTitle}>Arbetsadress</p>
                {workAddressText ? <AddressLink value={workAddressText} className="text-xs" /> : null}
              </div>
              <label className="grid gap-1 text-sm text-slate-600">
                <span className={crm.sectionTitle}>Gatuadress</span>
                <Input value={draft.street_address} onChange={(e) => setField('street_address', e.target.value)} placeholder="Gatuadress" />
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
              <label className="grid gap-1 text-sm text-slate-600">
                <span className={crm.sectionTitle}>Leveransadress</span>
                <Input value={draft.delivery_address} onChange={(e) => setField('delivery_address', e.target.value)} placeholder="Leveransadress" />
              </label>
              <label className="grid gap-1 text-sm text-slate-600">
                <span className={crm.sectionTitle}>Fakturaadress</span>
                <Input value={draft.invoice_address} onChange={(e) => setField('invoice_address', e.target.value)} placeholder="Fakturaadress" />
              </label>
            </Card>

            <Card className="grid gap-4">
              <p className={crm.sectionTitle}>Intern handoff</p>
              <label className="grid gap-1 text-sm text-slate-600">
                <span className={crm.sectionTitle}>Arbetets scope</span>
                <Input value={draft.work_scope} onChange={(e) => setField('work_scope', e.target.value)} placeholder="Kort operativ scope" />
              </label>
              <label className="grid gap-1 text-sm text-slate-600">
                <span className={crm.sectionTitle}>Överlämningsnotering</span>
                <Textarea value={draft.handoff_notes} onChange={(e) => setField('handoff_notes', e.target.value)} rows={4} placeholder="Detaljer till teamet" />
              </label>
              <label className="grid gap-1 text-sm text-slate-600">
                <span className={crm.sectionTitle}>Interna anteckningar</span>
                <Textarea value={draft.notes} onChange={(e) => setField('notes', e.target.value)} rows={4} placeholder="Internt orderunderlag" />
              </label>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="grid gap-5 lg:content-start">

            {/* Customer contact */}
            {(customerPhone || customerEmail || customerContact) ? (
              <Card className="grid gap-3">
                <p className={crm.sectionTitle}>Kundkontakt</p>
                <p className="text-sm font-semibold text-slate-900">{customerContact || workOrder.client_name}</p>
                <div className="grid gap-1.5 text-sm">
                  {customerPhone ? <PhoneLink value={customerPhone} /> : null}
                  {customerEmail ? <EmailLink value={customerEmail} /> : null}
                </div>
              </Card>
            ) : null}

            {/* Fortnox order */}
            {fortnoxConnected ? (
              <Card className="grid gap-3">
                <div className="flex items-center justify-between gap-2">
                  <p className={crm.sectionTitle}>Fortnox order</p>
                  <span className={cn(crm.badge, syncStatusClass[workOrder.fortnox_order_sync_status])}>{syncStatusLabel[workOrder.fortnox_order_sync_status]}</span>
                </div>
                {workOrder.fortnox_order_number ? (
                  <StatField label="Ordernummer" value={`#${workOrder.fortnox_order_number}`} />
                ) : null}
                {workOrder.fortnox_order_synced_at ? (
                  <p className="text-xs text-slate-400">Synkad {formatDateTime(workOrder.fortnox_order_synced_at)}</p>
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
              </Card>
            ) : null}

            {/* Snapshot */}
            <Card className="grid gap-3">
              <p className={crm.sectionTitle}>Snabböversikt</p>
              <div className="grid gap-2 text-sm">
                <StatField label="Total" value={formatCurrency(workOrder.pricing_summary?.total ?? workOrder.amount, workOrder.currency_code)} />
                <StatField label="Rader" value={(workOrder.line_items || []).length} />
                {totalSacks > 0 ? <StatField label="Säckar (beräknat)" value={`${totalSacks} st`} /> : null}
                <StatField label="Loggade timmar" value={`${totalLoggedHours.toFixed(1)} h`} />
                <StatField label="Kommentarer" value={comments.length} />
                <StatField label="Källa" value={`Offert ${workOrder.quote_id.slice(0, 8)}…`} />
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {/* ─── Economy ─── */}
      {activeTab === 'economy' ? (
        <Card className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={crm.sectionTitle}>Ekonomi</p>
            <div className="flex flex-wrap gap-2">
              <span className={cn(crm.badge, 'border-slate-200 bg-slate-50 text-slate-600')}>Delsumma {formatCurrency(workOrder.pricing_summary?.subtotal ?? 0, workOrder.currency_code)}</span>
              <span className={cn(crm.badge, 'border-slate-200 bg-slate-50 text-slate-600')}>Moms {formatCurrency(workOrder.pricing_summary?.vat ?? 0, workOrder.currency_code)}</span>
              <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>Total {formatCurrency(workOrder.pricing_summary?.total ?? workOrder.amount, workOrder.currency_code)}</span>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <StatField label="Valuta" value={workOrder.currency_code} />
            <StatField label="Moms %" value={String(workOrder.vat_percent)} />
            <StatField label="ROT" value={rot.enabled ? 'Aktivt' : 'Ej aktivt'} />
          </div>
          {rot.enabled ? (
            <div className="grid gap-2 rounded-xl border border-[#e0e8dc] bg-[#f1f5ee] p-4">
              <p className={crm.sectionTitle}>ROT-uppställning</p>
              <div className="grid gap-1.5 text-sm sm:grid-cols-2">
                {rot.property_designation ? <StatField label="Fastighetsbeteckning" value={rot.property_designation} /> : null}
                {rot.rot_percent != null ? <StatField label="Skattereduktion" value={`${rot.rot_percent}%`} /> : null}
                {rot.max_deduction != null ? <StatField label="Max avdrag" value={formatCurrency(rot.max_deduction, workOrder.currency_code)} /> : null}
                {rot.brf_org_number ? <StatField label="BRF org.nr" value={rot.brf_org_number} /> : null}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ─── Articles ─── */}
      {activeTab === 'articles' ? (
        <Card className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <p className={crm.sectionTitle}>Artiklar</p>
            {totalSacks > 0 ? <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>{totalSacks} säckar totalt</span> : null}
          </div>
          <div className="grid gap-2">
            {(workOrder.line_items || []).map((item) => {
              const sack = sackRows.find((s) => s.id === item.id);
              return (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e0e8dc] bg-[#f1f5ee] px-3 py-2.5 text-sm">
                  <div className="grid gap-0.5">
                    <strong className="text-slate-900">{item.article_name || 'Offert-rad'}</strong>
                    <span className="text-xs text-slate-500">
                      {item.article_number || 'Utan artikelnummer'}{item.thickness_mm ? ` · ${item.thickness_mm} mm` : ''}
                      {sack && sack.material ? ` · ${sack.material.short}` : ''}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    {sack && sack.sacks > 0 ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">{sack.sacks} säck</span>
                    ) : null}
                    <span>{item.pricing_mode === 'm3' ? `m² ${item.m2 || '0'}` : `Antal ${item.quantity || '0'}`} · A-pris {formatCurrency(item.unit_price || 0, workOrder.currency_code)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
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

      {/* ─── Comments ─── */}
      {activeTab === 'comments' ? (
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
    </div>
  );
}

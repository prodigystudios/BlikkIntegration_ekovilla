"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/shared/cn';
import { crm, workOrderStatusLabel, workOrderStatusClass } from '@/app/crm/lib/crmTokens';
import { PhoneLink, EmailLink, AddressLink } from '@/app/crm/components/ContactLinks';
import WorkOrderTimeTab from '@/app/crm/arbetsorder/WorkOrderTimeTab';
import WorkOrderCommentsTab from '@/app/crm/arbetsorder/WorkOrderCommentsTab';
import WorkOrderArticlesTab, { type ArticleLineItem } from '@/app/crm/arbetsorder/WorkOrderArticlesTab';
import { useWorkOrderActivity } from '@/app/crm/arbetsorder/useWorkOrderActivity';
import { useCustomerContact } from '@/app/crm/arbetsorder/useCustomerContact';
import { formatDate, joinAddress } from '@/app/crm/lib/format';

const CRM_PRIMARY = '#1a3f26'; // brand green; --crm-primary is scoped to /crm so hardcode here

type WorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'invoiced' | 'cancelled';

type InstallerWorkOrder = {
  id: string;
  order_number: string;
  project_name: string;
  client_name: string;
  quote_type: 'private' | 'business';
  customer_id: string | null;
  customer_snapshot: Record<string, any> | null;
  work_address: { street_address?: string | null; postal_code?: string | null; city?: string | null; delivery_address?: string | null } | null;
  internal_handoff: { work_scope?: string | null; handoff_notes?: string | null } | null;
  line_items: ArticleLineItem[] | null;
  rot_details: Record<string, any> | null;
  currency_code: string;
  vat_percent: number | string;
  desired_installation_date: string | null;
  status: WorkOrderStatus;
};

type InstallerTab = 'info' | 'articles' | 'time' | 'comments';

export default function WorkOrderInstallerClient({ workOrderId, currentUserId }: { workOrderId: string; currentUserId: string | null }) {
  const router = useRouter();
  const [workOrder, setWorkOrder] = useState<InstallerWorkOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InstallerTab>('info');
  const customerInfo = useCustomerContact(workOrderId);

  const activity = useWorkOrderActivity(workOrderId);
  const totalHours = useMemo(() => activity.timeEntries.reduce((s, e) => s + Number(e.hours || 0), 0), [activity.timeEntries]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/crm/work-orders/${workOrderId}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !json.ok) { setError(json?.error || 'Kunde inte ladda arbetsorder'); return; }
        setWorkOrder(json.data?.item as InstallerWorkOrder);
      } catch { if (active) setError('Kunde inte ladda arbetsorder'); }
      finally { if (active) setLoading(false); }
    }
    load();
    return () => { active = false; };
  }, [workOrderId]);

  if (loading) {
    return (
      <div className="mx-auto grid max-w-2xl gap-4 px-4 py-6">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-[#dfe6da]" />
        <div className="h-40 animate-pulse rounded-2xl bg-[#dfe6da]" />
      </div>
    );
  }

  if (error || !workOrder) {
    return (
      <div className="mx-auto grid max-w-2xl gap-4 px-4 py-6">
        <button type="button" onClick={() => router.back()} className="w-fit text-sm text-slate-500 hover:text-slate-800">← Tillbaka</button>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error || 'Arbetsordern hittades inte.'}</div>
      </div>
    );
  }

  const snapshot = workOrder.customer_snapshot || {};
  const phone: string | null = customerInfo?.phone ?? (snapshot.phone || null);
  const email: string | null = customerInfo?.email ?? (snapshot.email || null);
  const contactName: string | null = customerInfo?.contactName ?? (snapshot.contact_name || null);
  const addressText = joinAddress([workOrder.work_address?.street_address, workOrder.work_address?.postal_code, workOrder.work_address?.city]);
  const workScope = workOrder.internal_handoff?.work_scope || '';
  const handoffNotes = workOrder.internal_handoff?.handoff_notes || '';

  const tabs: Array<[InstallerTab, string]> = [
    ['info', 'Info'], ['articles', 'Artiklar'], ['time', 'Tid'], ['comments', 'Kommentarer'],
  ];

  return (
    <div className="mx-auto grid max-w-2xl gap-5 px-4 py-6" style={{ minHeight: '100dvh', backgroundColor: '#e5ede5' }}>
      {/* Header */}
      <div>
        <button type="button" onClick={() => router.back()} className="mb-2 inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800">← Tillbaka</button>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(crm.badge, workOrderStatusClass[workOrder.status])}>{workOrderStatusLabel[workOrder.status]}</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{workOrder.order_number}</span>
        </div>
        <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-slate-900">{workOrder.project_name}</h1>
        <p className="m-0 text-sm text-slate-500">{workOrder.client_name} · Planerad {formatDate(workOrder.desired_installation_date)}</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveTab(value)}
            className={cn('rounded-full border px-3.5 py-1.5 text-sm font-semibold transition', activeTab === value ? 'text-white' : 'border-[#e0e8dc] bg-[#f9fbf7] text-slate-600')}
            style={activeTab === value ? { backgroundColor: CRM_PRIMARY, borderColor: CRM_PRIMARY } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Info */}
      {activeTab === 'info' ? (
        <div className="grid gap-4">
          {(phone || email || contactName) ? (
            <div className={cn(crm.cardInner, 'grid gap-3')}>
              <p className={crm.sectionTitle}>Kundkontakt</p>
              <p className="text-sm font-semibold text-slate-900">{contactName || workOrder.client_name}</p>
              <div className="grid gap-1.5 text-sm">
                {phone ? <PhoneLink value={phone} /> : null}
                {email ? <EmailLink value={email} /> : null}
              </div>
            </div>
          ) : null}

          <div className={cn(crm.cardInner, 'grid gap-2')}>
            <div className="flex items-center justify-between gap-2">
              <p className={crm.sectionTitle}>Arbetsadress</p>
              {addressText ? <AddressLink value={addressText} className="text-xs" /> : null}
            </div>
            <p className="text-sm leading-relaxed text-slate-700">{addressText || '–'}</p>
            {workOrder.work_address?.delivery_address ? (
              <p className="text-xs text-slate-500">Leverans: {workOrder.work_address.delivery_address}</p>
            ) : null}
          </div>

          <div className={cn(crm.cardInner, 'grid gap-2')}>
            <p className={crm.sectionTitle}>Arbetsbeskrivning</p>
            {workScope ? <p className="text-sm font-medium text-slate-800">{workScope}</p> : null}
            {handoffNotes ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{handoffNotes}</p>
            ) : (!workScope ? <p className="text-sm text-slate-400">Ingen arbetsbeskrivning angiven.</p> : null)}
          </div>
        </div>
      ) : null}

      {/* Articles (read-only) */}
      {activeTab === 'articles' ? (
        <WorkOrderArticlesTab
          items={(workOrder.line_items || []) as ArticleLineItem[]}
          currencyCode={workOrder.currency_code}
          vatPercent={workOrder.vat_percent}
          quoteType={workOrder.quote_type}
          rotDetails={workOrder.rot_details}
          saving={false}
          fortnoxConnected={false}
          canEdit={false}
          onSave={async () => false}
        />
      ) : null}

      {/* Time (write) */}
      {activeTab === 'time' ? (
        <WorkOrderTimeTab
          entries={activity.timeEntries}
          loading={activity.timeEntriesLoading}
          totalHours={totalHours}
          currentUserId={currentUserId}
          onCreate={activity.createTimeEntry}
          onUpdate={activity.updateTimeEntry}
          onDelete={activity.deleteTimeEntry}
        />
      ) : null}

      {/* Comments (write) */}
      {activeTab === 'comments' ? (
        <WorkOrderCommentsTab
          comments={activity.comments}
          loading={activity.commentsLoading}
          currentUserId={currentUserId}
          mentionUsers={activity.mentionUsers}
          onCreate={activity.createComment}
          onUpdate={activity.updateComment}
          onDelete={activity.deleteComment}
        />
      ) : null}
    </div>
  );
}

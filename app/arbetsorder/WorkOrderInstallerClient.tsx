"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/shared/cn';
import { crm, workOrderStatusLabel, workOrderStatusClass } from '@/app/crm/lib/crmTokens';
import { PhoneLink, EmailLink, AddressLink } from '@/app/crm/components/ContactLinks';
import WorkOrderCommentsTab from '@/app/crm/arbetsorder/WorkOrderCommentsTab';
import WorkOrderArticlesTab, { type ArticleLineItem } from '@/app/crm/arbetsorder/WorkOrderArticlesTab';
import WorkOrderTimeTab from '@/app/crm/arbetsorder/WorkOrderTimeTab';
import { useWorkOrderActivity } from '@/app/crm/arbetsorder/useWorkOrderActivity';
import { useCustomerContact } from '@/app/crm/arbetsorder/useCustomerContact';
import { formatDate, joinAddress, documentRef } from '@/app/crm/lib/format';

const CRM_PRIMARY = '#1a3f26'; // brand green; --crm-primary is scoped to /crm so hardcode here

type WorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'invoiced' | 'cancelled';

type InstallerWorkOrder = {
  id: string;
  order_number: string;
  fortnox_order_number: string | null;
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

type InstallerTab = 'info' | 'articles' | 'time';

export default function WorkOrderInstallerClient({
  workOrderId,
  currentUserId,
  canReportTime = false,
}: {
  workOrderId: string;
  currentUserId: string | null;
  /** Testfönstret för Tid-fliken — se app/arbetsorder/[id]/page.tsx. */
  canReportTime?: boolean;
}) {
  const router = useRouter();
  const [workOrder, setWorkOrder] = useState<InstallerWorkOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InstallerTab>('info');
  const customerInfo = useCustomerContact(workOrderId);

  // Utan Tid-fliken finns ingen konsument för tidraderna — hämta dem inte då.
  const activity = useWorkOrderActivity(workOrderId, { includeTimeEntries: canReportTime });

  // ⚠️ ALLA HOOKS MÅSTE LIGGA FÖRE DE TIDIGA RETURERNA NEDAN (`if (loading)`, `if (error)`).
  // Den här summan används först längst ner, men får inte deklareras där: första rendern går ut
  // genom laddningsgrenen, nästa gör det inte, och en hook som bara körs i den andra ger
  // "Rendered more hooks than during the previous render" — en krasch för ALLA som öppnar sidan,
  // inte bara för dem som ser fliken. Repot har ingen ESLint som fångar det.
  const totalLoggedHours = useMemo(
    () => activity.timeEntries.reduce((sum, item) => sum + Number(item.hours || 0), 0),
    [activity.timeEntries],
  );

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

  // Comments render at the bottom of the Info tab (not a separate tab) so an @-mention notification
  // lands straight on the thread.
  //
  // TID-FLIKEN ÄR STÄNGD FÖR BESÄTTNINGEN, öppen bara för attestansvariga (`canReportTime`).
  //
  // Skälet är inte längre tekniskt: fas 4 är byggd, klockslag är obligatoriska och CRM kan bära
  // hela bilden. Skälet är att besättningen fortfarande rapporterar i Blikk, som läses ut för hand
  // före varje lönekörning. En flik här hade blivit en ANDRA plats att rapportera på — och timmar
  // som hamnar i CRM i stället för i Blikk når aldrig lönen. Att flytta någon från Blikk ger samma
  // utfall som att stänga vägen.
  //
  // Villkoret är alltså ett testfönster (William 2026-08-14: "jag måste ändå kunna testa"), inte en
  // behörighetsmodell. Vid cutovern tas `canReportTime` bort härifrån och ur page.tsx, och den gula
  // rutan nedan med den.
  const tabs: Array<[InstallerTab, string]> = [
    ['info', 'Info'], ['articles', 'Artiklar'],
    ...(canReportTime ? [['time', 'Tid'] as [InstallerTab, string]] : []),
  ];

  return (
    <div className="mx-auto grid max-w-2xl gap-5 px-4 py-6" style={{ minHeight: '100dvh', backgroundColor: '#e5ede5' }}>
      {/* Header */}
      <div>
        <button type="button" onClick={() => router.back()} className="mb-2 inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800">← Tillbaka</button>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(crm.badge, workOrderStatusClass[workOrder.status])}>{workOrderStatusLabel[workOrder.status]}</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{documentRef(workOrder.fortnox_order_number, workOrder.order_number)}</span>
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

          {/* Where to report time. A CRM-planned job has no Blikk project, so it cannot be picked
              in /tidrapport the usual way — without this the crew opens the job, finds no time tab
              and no matching project, and guesses. Says the convention plainly until fas 4 brings
              time into CRM.

              Döljs för den som HAR Tid-fliken: två anvisningar som pekar åt olika håll är värre än
              ingen alls, och den som testar den nya vägen ska inte samtidigt läsa att tiden hör
              hemma i Blikk. Besättningen ser rutan oförändrad. */}
          {!canReportTime ? (
            <div className="grid gap-1.5 rounded-2xl border border-solid border-amber-200 bg-amber-50 p-3.5">
              <p className={cn(crm.sectionTitle, 'text-amber-700')}>Tidrapportering</p>
              <p className="text-sm leading-relaxed text-amber-900">
                Rapportera tiden i <strong className="font-semibold">Tidrapport</strong> som <strong className="font-semibold">internt projekt</strong>, och skriv ordernumret{' '}
                <strong className="font-semibold">{documentRef(workOrder.fortnox_order_number, workOrder.order_number)}</strong> i kommentaren.
              </p>
              <p className="text-xs text-amber-700">Tidrapporteringen flyttar hit när Blikk kopplas bort.</p>
            </div>
          ) : null}

          {/* Comments (write) — at the bottom of Info, no longer a separate tab */}
          <WorkOrderCommentsTab
            comments={activity.comments}
            loading={activity.commentsLoading}
            currentUserId={currentUserId}
            mentionUsers={activity.mentionUsers}
            onCreate={activity.createComment}
            onUpdate={activity.updateComment}
            onDelete={activity.deleteComment}
          />
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

      {/* Tid — samma komponent som kontorets flik, alltså samma klockslagskrav och samma
          serveruträkning av minuterna. Fältet ska inte ha en egen variant av regeln. */}
      {activeTab === 'time' && canReportTime ? (
        <WorkOrderTimeTab
          entries={activity.timeEntries}
          loading={activity.timeEntriesLoading}
          totalHours={totalLoggedHours}
          currentUserId={currentUserId}
          onCreate={activity.createTimeEntry}
          onUpdate={activity.updateTimeEntry}
          onDelete={activity.deleteTimeEntry}
        />
      ) : null}

    </div>
  );
}

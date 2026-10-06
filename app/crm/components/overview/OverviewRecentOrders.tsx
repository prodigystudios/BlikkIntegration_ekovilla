"use client";

import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/shared/cn';
import { crm, workOrderStatusClass, workOrderStatusLabel } from '@/app/crm/lib/crmTokens';
import { documentRef, formatDate } from '@/app/crm/lib/format';
import { netAmount } from '@/lib/domains/crm/pricing';
import { formatCurrency, stockholmDateISO } from './overviewFormat';
import { CrmTable, CustomerCell, type CrmTableColumn } from '@/app/crm/components/CrmTable';
import { recentWidth } from './OverviewRecentTable';
import { RecentCard } from './OverviewStates';
import type { WorkOrderItem } from './overviewTypes';

// Postens adress — kundlänken och radklicket går dit, så den står en gång.
const orderHref = (order: WorkOrderItem) => `/crm/arbetsorder/${order.id}`;

const COLUMNS: Array<CrmTableColumn<WorkOrderItem>> = [
  // Numret via documentRef: Fortnox-numret först, det interna bara som reserv. Visning, inte
  // uppslag — länken går på id:t.
  { header: 'Ordernr', className: recentWidth.number, cell: (order) => documentRef(order.fortnox_order_number, order.order_number) },
  {
    header: 'Kund',
    className: recentWidth.name,
    cell: (order) => <CustomerCell href={orderHref(order)} customer={order.client_name} project={order.project_name} />,
  },
  // Netto, som resten av översikten. Ordervärdet — inte resten att fakturera, som nyckeltalet Att
  // fakturera visar för en delfakturerad order.
  { header: 'Exkl. moms', className: recentWidth.amount, cell: (order) => formatCurrency(netAmount(order), order.currency_code) },
  // Listan är sorterad på när ordern skapades (created_desc).
  { header: 'Skapad', className: recentWidth.date, cell: (order) => formatDate(stockholmDateISO(order.created_at)) },
  {
    header: 'Status',
    className: recentWidth.status,
    cell: (order) => <span className={cn(crm.badge, workOrderStatusClass[order.status])}>{workOrderStatusLabel[order.status]}</span>,
  },
];

export default function OverviewRecentOrders({ loading, failed, workOrders }: {
  loading: boolean;
  failed: boolean;
  workOrders: WorkOrderItem[];
}) {
  return (
    <RecentCard title="Senaste ordrar" href="/crm/arbetsorder" loading={loading} failed={failed}>
      {workOrders.length === 0 ? <EmptyState description="Inga arbetsordrar ännu." /> : (
        <CrmTable size="compact" label="Senaste ordrar" columns={COLUMNS} rows={workOrders} rowHref={orderHref} />
      )}
    </RecentCard>
  );
}

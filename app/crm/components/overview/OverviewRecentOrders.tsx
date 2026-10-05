"use client";

import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/shared/cn';
import { crm, workOrderStatusClass, workOrderStatusLabel } from '@/app/crm/lib/crmTokens';
import { documentRef, formatDate } from '@/app/crm/lib/format';
import { netAmount } from '@/lib/domains/crm/pricing';
import { formatCurrency, stockholmDateISO } from './overviewFormat';
import { CustomerCell, RecentTable, recentWidth, type RecentColumn } from './OverviewRecentTable';
import { RecentCard } from './OverviewStates';
import type { WorkOrderItem } from './overviewTypes';

const COLUMNS: Array<RecentColumn<WorkOrderItem>> = [
  // Numret via documentRef: Fortnox-numret först, det interna bara som reserv. Visning, inte
  // uppslag — länken går på id:t.
  { header: 'Ordernr', className: recentWidth.number, cell: (order) => documentRef(order.fortnox_order_number, order.order_number) },
  {
    header: 'Kund',
    className: recentWidth.name,
    cell: (order) => <CustomerCell href={`/crm/arbetsorder/${order.id}`} customer={order.client_name} project={order.project_name} />,
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
        <RecentTable label="Senaste ordrar" columns={COLUMNS} rows={workOrders} />
      )}
    </RecentCard>
  );
}

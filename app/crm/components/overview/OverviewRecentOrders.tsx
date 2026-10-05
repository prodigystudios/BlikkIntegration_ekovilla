"use client";

import Link from 'next/link';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/shared/cn';
import { crm, workOrderStatusClass, workOrderStatusLabel } from '@/app/crm/lib/crmTokens';
import { documentRef } from '@/app/crm/lib/format';
import { netAmount } from '@/lib/domains/crm/pricing';
import { formatCurrency, stockholmDay } from './overviewFormat';
import { RecentCard, RecentCell, RecentTable, recentColumn } from './OverviewStates';
import type { WorkOrderItem } from './overviewTypes';

const HEADERS = [
  { label: 'Ordernr', className: recentColumn.number },
  { label: 'Företag', className: recentColumn.name },
  { label: 'Exkl. moms', className: recentColumn.amount },
  // Listan är sorterad på när ordern skapades (created_desc).
  { label: 'Skapad', className: recentColumn.date },
  { label: 'Status', className: recentColumn.status },
];

export default function OverviewRecentOrders({ loading, failed, workOrders }: {
  loading: boolean;
  failed: boolean;
  workOrders: WorkOrderItem[];
}) {
  return (
    <RecentCard title="Senaste ordrar" href="/crm/arbetsorder" loading={loading} failed={failed}>
      {workOrders.length === 0 ? <EmptyState description="Inga arbetsordrar ännu." /> : (
        <RecentTable label="Senaste ordrar" headers={HEADERS}>
          {workOrders.map((order) => (
            <tr key={order.id}>
              {/* Numret via documentRef: Fortnox-numret först, det interna bara som reserv. Visning,
                  inte uppslag — länken nedan går på id:t. */}
              <RecentCell className={cn(recentColumn.number, 'truncate tabular-nums text-slate-500')}>
                {documentRef(order.fortnox_order_number, order.order_number)}
              </RecentCell>
              <RecentCell className={recentColumn.name}>
                <Link href={`/crm/arbetsorder/${order.id}`} className={cn('font-semibold', crm.link)}>
                  {order.client_name}
                </Link>
              </RecentCell>
              {/* Netto, som resten av översikten. Ordervärdet — inte resten att fakturera, som
                  nyckeltalet Att fakturera visar för en delfakturerad order. */}
              <RecentCell className={cn(recentColumn.amount, 'whitespace-nowrap tabular-nums')}>
                {formatCurrency(netAmount(order), order.currency_code)}
              </RecentCell>
              <RecentCell className={cn(recentColumn.date, 'whitespace-nowrap tabular-nums text-slate-500')}>
                {stockholmDay(order.created_at)}
              </RecentCell>
              <RecentCell className={recentColumn.status}>
                <span className={cn(crm.badge, workOrderStatusClass[order.status])}>{workOrderStatusLabel[order.status]}</span>
              </RecentCell>
            </tr>
          ))}
        </RecentTable>
      )}
    </RecentCard>
  );
}

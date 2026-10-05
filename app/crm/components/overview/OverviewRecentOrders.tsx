"use client";

import Link from 'next/link';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/shared/cn';
import { crm, workOrderStatusClass, workOrderStatusLabel } from '@/app/crm/lib/crmTokens';
import { formatCurrency } from './overviewFormat';
import { RecentCard } from './OverviewStates';
import type { WorkOrderItem } from './overviewTypes';

export default function OverviewRecentOrders({ loading, failed, workOrders }: {
  loading: boolean;
  failed: boolean;
  workOrders: WorkOrderItem[];
}) {
  return (
    <RecentCard title="Senaste ordrar" href="/crm/arbetsorder" loading={loading} failed={failed}>
      {workOrders.length === 0 ? <EmptyState description="Inga arbetsordrar ännu." /> : (
        <div className="grid gap-2">
          {workOrders.map((order) => (
            <Link key={order.id} href={`/crm/arbetsorder/${order.id}`} className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 no-underline transition hover:border-slate-200 hover:bg-slate-50">
              <div className="min-w-0">
                <strong className={cn('block truncate', crm.bodyStrong)}>{order.project_name}</strong>
                <p className={cn('m-0 truncate', crm.meta)}>{order.client_name} · {formatCurrency(order.amount, order.currency_code)}</p>
              </div>
              <span className={cn('shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', workOrderStatusClass[order.status])}>{workOrderStatusLabel[order.status]}</span>
            </Link>
          ))}
        </div>
      )}
    </RecentCard>
  );
}

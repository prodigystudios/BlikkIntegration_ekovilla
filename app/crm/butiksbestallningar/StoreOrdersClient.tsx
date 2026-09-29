'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import {
  STORE_ORDER_LIST_LIMIT,
  STORE_ORDER_STATUS_LABELS,
  formatStoreOrderKr,
  type StoreOrderStatus,
} from '@/lib/domains/portal/storeOrders';
import type { StoreOrderListItem } from '@/lib/domains/portal/storeOrdersView';
import { storeOrderStatusAccent, storeOrderStatusClass } from './storeOrderStatusStyle';

// Listan över butiksbeställningar (fas 8). Urvalen följer det Ekovilla gör med dem: bekräfta, leverera, fakturera.
// Tillbakadragna och makulerade står under Avslutade. Listan filtreras här: sidan har redan läst de senaste.

type Filter = 'received' | 'confirmed' | 'delivered' | 'invoiced' | 'closed' | 'all';

const FILTERS: [Filter, string][] = [
  ['received', 'Att bekräfta'],
  ['confirmed', 'Bekräftade'],
  ['delivered', 'Levererade'],
  ['invoiced', 'Fakturerade'],
  ['closed', 'Avslutade'],
  ['all', 'Alla'],
];

const CLOSED: ReadonlySet<StoreOrderStatus> = new Set(['withdrawn', 'cancelled']);

function inFilter(status: StoreOrderStatus, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'closed') return CLOSED.has(status);
  return status === filter;
}

const EMPTY: Record<Filter, string> = {
  received: 'Inga beställningar väntar på bekräftelse.',
  confirmed: 'Inga bekräftade beställningar väntar på leverans.',
  delivered: 'Inga levererade beställningar väntar på faktura.',
  invoiced: 'Inga fakturerade beställningar än.',
  closed: 'Inga tillbakadragna eller makulerade beställningar.',
  all: 'Inga butiksbeställningar än. De kommer hit när en butik beställer material i återförsäljarportalen.',
};

export default function StoreOrdersClient({
  orders,
  capped,
  error,
}: {
  orders: StoreOrderListItem[];
  capped: boolean;
  error?: string;
}) {
  const [filter, setFilter] = useState<Filter>('received');
  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>;
    for (const [value] of FILTERS) out[value] = orders.filter((o) => inFilter(o.status, value)).length;
    return out;
  }, [orders]);
  const visible = orders.filter((o) => inFilter(o.status, filter));

  return (
    <div className="grid grid-cols-1 gap-4">
      <div>
        <h1 className={crm.pageTitle}>Butiksbeställningar</h1>
        <p className={cn('mt-1', crm.pageSubtitle)}>Material som butikerna beställer i återförsäljarportalen.</p>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error} Ladda om sidan för att försöka igen.
        </div>
      ) : null}

      <div className={cn(crm.card, 'grid gap-2 p-2.5 md:p-3')}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Visa">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[13px] font-semibold transition',
                filter === value
                  ? 'border-[color:var(--ek-green)] bg-[color:var(--ek-green)] text-white'
                  : 'border-[#e0e8dc] bg-[#f9fbf7] text-slate-600 hover:border-[#cfdcc9]',
              )}
            >
              {label} <span className={cn('ml-0.5', filter === value ? 'text-white/70' : 'text-slate-500')}>{counts[value]}</span>
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-[#cfdcc9] bg-[#f1f5ee] px-4 py-8 text-center text-sm text-slate-600">
            <span>{EMPTY[filter]}</span>
            {filter !== 'all' && orders.length > 0 ? (
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="rounded-lg border border-[#dce4d8] bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-[#c8d4c3]"
              >
                Visa alla
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="grid gap-1">
            {visible.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/crm/butiksbestallningar/${order.id}`}
                  className="group flex items-stretch overflow-hidden rounded-lg border border-[#e3e9df] bg-white text-left no-underline shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:border-[#cfdcc9] hover:shadow-[0_8px_20px_-10px_rgba(20,44,27,0.30)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ek-accent)]"
                >
                  <span className={cn('w-1.5 shrink-0', storeOrderStatusAccent[order.status])} aria-hidden="true" />
                  <div className="grid min-w-0 flex-1 gap-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className={cn(crm.bodyStrong, 'shrink-0 tabular-nums')}>{order.orderNumber}</span>
                        <span className="truncate text-sm text-slate-700">{order.storeName}</span>
                      </div>
                      <div className={cn(crm.meta, 'mt-0.5')}>
                        Mottagen {order.receivedLabel}
                        {order.changed ? <span className="text-slate-500"> (ändrad av butiken)</span> : null}
                      </div>
                    </div>
                    <div className={cn(crm.meta, 'min-w-0 truncate')}>
                      {order.desiredPeriod ? <>Önskad leverans: {order.desiredPeriod}</> : <span className="text-slate-500">Ingen önskad leverans</span>}
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <span className="text-right">
                        <span className={cn(crm.bodyStrong, 'tabular-nums')}>{formatStoreOrderKr(order.linesTotal)}</span>
                        <span className={cn(crm.micro, 'block')}>
                          {order.lineCount} {order.lineCount === 1 ? 'rad' : 'rader'}, exkl. moms och frakt
                        </span>
                      </span>
                      <span className={cn(crm.badge, storeOrderStatusClass[order.status])}>{STORE_ORDER_STATUS_LABELS[order.status]}</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {capped ? (
          <p className={cn(crm.meta, 'px-1')}>
            Listan visar alla som väntar på bekräftelse, leverans eller faktura, och de {STORE_ORDER_LIST_LIMIT} senaste
            avslutade.
          </p>
        ) : null}
      </div>
    </div>
  );
}

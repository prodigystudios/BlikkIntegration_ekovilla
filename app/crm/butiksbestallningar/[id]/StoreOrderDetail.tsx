import Link from 'next/link';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { STORE_ORDER_STATUS_LABELS, formatStoreOrderKr as kr } from '@/lib/domains/portal/storeOrders';
import type { StoreOrderView } from '@/lib/domains/portal/storeOrdersView';
import { storeOrderStatusClass } from '../storeOrderStatusStyle';
import StoreOrderActions from './StoreOrderActions';

// En butiksbeställning som sidan visar den (fas 8): butikens rader med dess priser, leveransen och vad som hänt.
// Ekovillas steg (kunden, frakten, Bekräfta, Fortnox-ordern) står i StoreOrderActions, för den ansvarige och admin.

/** Vad som gäller just nu, överst: det enda sidan behöver säga innan man läser raderna. */
function StateNotice({ order }: { order: StoreOrderView }) {
  if (order.status === 'received') {
    return (
      <div className="grid gap-1 rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
        <p>
          Butiken kan ändra eller dra tillbaka beställningen tills den är bekräftad.
          {order.changedAtLabel ? ` Den ändrades senast ${order.changedAtLabel}.` : ''}
        </p>
        {!order.customerLinked ? (
          <p>
            Beställningen är inte kopplad till någon kund i CRM:et. En kund behöver kopplas innan den kan bekräftas.
            {order.customerNumber ? ` Portalen skickade kundnumret ${order.customerNumber}.` : ' Butiken har inget kundnummer i portalen.'}
          </p>
        ) : null}
      </div>
    );
  }
  if (order.status === 'withdrawn') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-700">
        Butiken drog tillbaka beställningen{order.withdrawnAtLabel ? ` ${order.withdrawnAtLabel}` : ''}. Den ska inte levereras.
      </div>
    );
  }
  if (order.status === 'cancelled') {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
        Makulerad av Ekovilla. {order.cancelReason ? <>Skäl till butiken: {order.cancelReason}</> : null}
      </div>
    );
  }
  return null;
}

function Totals({ order }: { order: StoreOrderView }) {
  const { totals } = order;
  // Utan frakt och utan att den väntar (tillbakadragen, makulerad): ingen frakt och ingen moms kommer, så inget löfte.
  const closedWithoutFreight = order.freight === null && !order.freightPending;
  return (
    <dl className="grid gap-1.5 border-t border-[#e3e9df] pt-3 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-slate-600">Butikens rader</dt>
        <dd className="tabular-nums text-slate-900">{kr(totals.lines)}</dd>
      </div>
      {closedWithoutFreight ? null : (
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Frakt</dt>
          <dd className={cn('tabular-nums', order.freight ? 'text-slate-900' : 'text-slate-500')}>
            {order.freight === null ? 'Sätts innan beställningen bekräftas' : order.freight.mode === 'none' ? 'Ingen frakt' : kr(order.freight.price)}
          </dd>
        </div>
      )}
      {totals.vat !== null && totals.total !== null ? (
        <>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Moms {order.vatPercent} %</dt>
            <dd className="tabular-nums text-slate-900">{kr(totals.vat)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-[#e3e9df] pt-1.5">
            <dt className={crm.bodyStrong}>Totalt inkl. moms</dt>
            <dd className={cn(crm.bodyStrong, 'tabular-nums')}>{kr(totals.total)}</dd>
          </div>
        </>
      ) : closedWithoutFreight ? null : (
        <p className={cn(crm.meta, 'text-right')}>Moms {order.vatPercent} % tillkommer på raderna och frakten.</p>
      )}
    </dl>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className={crm.label}>{label}</dt>
      <dd className={crm.fieldValue}>{children}</dd>
    </div>
  );
}

export default function StoreOrderDetail({ order, canManage = false }: { order: StoreOrderView; canManage?: boolean }) {
  const { delivery } = order;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid gap-2">
        <Link href="/crm/butiksbestallningar" className={cn(crm.link, 'w-fit text-sm')}>
          Alla butiksbeställningar
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className={cn(crm.pageTitle, 'tabular-nums')}>{order.orderNumber}</h1>
          <span className={cn(crm.badge, storeOrderStatusClass[order.status])}>{STORE_ORDER_STATUS_LABELS[order.status]}</span>
        </div>
        <p className={crm.pageSubtitle}>
          {order.storeName}
          {order.assignedToName ? <span className="text-slate-500">, ansvarig {order.assignedToName}</span> : null}
        </p>
      </div>

      <StateNotice order={order} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.9fr)] lg:items-start">
        <section className={cn(crm.cardInner, 'grid gap-3')} aria-labelledby="store-order-lines">
          <h2 id="store-order-lines" className={crm.cardTitle}>
            Rader <span className="font-normal text-slate-500">med butikens priser, exkl. moms</span>
          </h2>
          <ul className="grid divide-y divide-[#e3e9df]">
            {order.lines.map((line, index) => (
              <li key={`${line.articleNumber}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 py-2 first:pt-0">
                <span className="min-w-0 text-sm font-medium text-slate-900">{line.name}</span>
                <span className="text-right text-sm font-semibold tabular-nums text-slate-900">{kr(line.total)}</span>
                <span className={cn(crm.meta, 'tabular-nums')}>Artikel {line.articleNumber}</span>
                <span className={cn(crm.meta, 'text-right tabular-nums')}>
                  {line.quantity} {line.unit} × {kr(line.unitCost)}
                </span>
              </li>
            ))}
          </ul>
          <Totals order={order} />
        </section>

        <aside className="grid gap-4">
          {canManage ? (
            <StoreOrderActions
              id={order.id}
              status={order.status}
              storeVersion={order.storeVersion}
              freightSetAt={order.freightSetAt}
              customerId={order.customerId}
              storeName={order.storeName}
              customerNumber={order.customerNumber}
              customer={order.customer}
              freight={order.freight}
              fortnoxOrderNumber={order.fortnoxOrderNumber}
              fortnoxError={order.fortnoxError}
            />
          ) : null}
          <section className={cn(crm.cardInner, 'grid gap-3')} aria-labelledby="store-order-delivery">
            <h2 id="store-order-delivery" className={crm.cardTitle}>
              Leverans
            </h2>
            <dl className="grid gap-2.5">
              <Field label="Adress">
                <span className="block">{delivery.address.street}</span>
                <span className="block">
                  {delivery.address.postalCode} {delivery.address.city}
                </span>
              </Field>
              <Field label="Önskad leverans">{delivery.desiredPeriod || <span className={crm.emptyValue}>Inte angiven</span>}</Field>
              <Field label="Butikens referens">{delivery.reference || <span className={crm.emptyValue}>Ingen</span>}</Field>
              <Field label="Mottagare">
                {delivery.contactName || <span className={crm.emptyValue}>Inte angiven</span>}
                {delivery.contactPhone ? (
                  <a href={`tel:${delivery.contactPhone.replace(/[^\d+]/g, '')}`} className={cn(crm.link, 'block w-fit')}>
                    {delivery.contactPhone}
                  </a>
                ) : null}
              </Field>
              {delivery.message ? (
                <Field label="Meddelande från butiken">
                  <span className="whitespace-pre-wrap break-words">{delivery.message}</span>
                </Field>
              ) : null}
            </dl>
          </section>

          <section className={cn(crm.cardInner, 'grid gap-3')} aria-labelledby="store-order-events">
            <h2 id="store-order-events" className={crm.cardTitle}>
              Händelser
            </h2>
            <ol className="grid gap-2">
              {order.events.map((event) => (
                <li key={event.label} className="grid gap-0.5">
                  <span className="text-sm text-slate-900">{event.label}</span>
                  <span className={crm.meta}>
                    {event.at}
                    {event.by ? `, ${event.by}` : ''}
                  </span>
                </li>
              ))}
            </ol>
            <dl className={cn(crm.micro, 'grid gap-1 border-t border-[#e3e9df] pt-2')}>
              <div>
                <dt className="inline">Kund i CRM:et: </dt>
                <dd className="inline">
                  {order.customer
                    ? `${order.customer.name}${order.customer.fortnoxCustomerNumber ? ` (kundnummer ${order.customer.fortnoxCustomerNumber})` : ''}`
                    : order.customerLinked
                      ? 'kopplad'
                      : 'ingen'}
                </dd>
              </div>
              <div>
                <dt className="inline">Kundnummer från portalen: </dt>
                <dd className="inline">{order.customerNumber ?? 'inget'}</dd>
              </div>
              {order.fortnoxOrderNumber ? (
                <div>
                  <dt className="inline">Fortnox-order: </dt>
                  <dd className="inline">{order.fortnoxOrderNumber}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

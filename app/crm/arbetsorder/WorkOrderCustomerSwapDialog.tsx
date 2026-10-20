"use client";

import { useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import EntityCombobox from '@/app/crm/components/EntityCombobox';
import { searchCustomerOptions } from '@/app/crm/lib/customerSearch';
import { withReturnTo } from '@/app/crm/lib/returnTo';
import { resolveCrmContact } from '@/lib/domains/crm/contacts';
import { getCrmCustomerDisplayName } from '@/lib/domains/crm/customers';
import type { WorkOrderReadinessIssue } from '@/lib/domains/crm/workOrderReadiness';
import {
  buildWorkOrderCustomerSwapUpdate,
  currentJobSite,
  customerSite,
  customerSwapBlock,
  customerSwapBlockMessage,
  customerSwapReadinessBlockers,
  defaultWorkAddressChoice,
  type SwapCustomerCard,
  type SwappableWorkOrder,
  type WorkAddressChoice,
} from '@/lib/domains/crm/workOrderCustomerSwap';

// "Byt kund" på arbetsordern. Reglerna är serverns egna (workOrderCustomerSwap.ts) och körs här också,
// så att dialogen säger samma sak som servern innan något skickas: spärren, arbetsplatsens förval och
// det kortet saknar. Servern prövar ändå allt igen — den kan veta mer (fakturarundor, portaljobb).

export type CustomerSwapOrder = {
  id: string;
  status: string;
  quote_id: string | null;
  customer_id: string | null;
  client_name: string;
  quote_type: 'private' | 'business';
  customer_snapshot: Record<string, unknown> | null;
  work_address: Record<string, unknown> | null;
  rot_details: Record<string, unknown> | null;
  line_items: Array<Record<string, unknown>> | null;
  internal_handoff: Record<string, unknown> | null;
  vat_percent: number | string;
  fortnox_order_number: string | null;
  fortnox_invoice_number: string | null;
  partial_invoicing_started_at: string | null;
  updated_at: string;
};

const typeLabel = (type: 'private' | 'business') => (type === 'private' ? 'Privatkund' : 'Företag');

const formatSite = (site: { street_address: string | null; postal_code: string | null; city: string | null }) =>
  [site.street_address, [site.postal_code, site.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/** Orderns moms just nu, så långt klienten ser den: snapshotens flagga, annars en företagsorder på 0 %. */
function orderReverseVat(order: CustomerSwapOrder): boolean {
  const flag = order.customer_snapshot?.reverse_vat;
  if (typeof flag === 'boolean') return flag;
  return order.quote_type === 'business' && Number(order.vat_percent) === 0;
}

/** Faktureringen har börjat — samma tecken som servern läser ur raden (rundorna ser bara servern). */
const invoicingStarted = (order: CustomerSwapOrder) =>
  order.status === 'invoiced' || order.status === 'partially_invoiced'
  || Boolean(order.partial_invoicing_started_at) || Boolean(order.fortnox_invoice_number);

function asSwappable(order: CustomerSwapOrder): SwappableWorkOrder {
  return { ...order, prospect_id: null };
}

export default function WorkOrderCustomerSwapDialog({
  workOrder,
  onClose,
  onSwapped,
}: {
  workOrder: CustomerSwapOrder;
  onClose: () => void;
  /** Bytet är gjort. `item` är ordern som servern läste om, eller null när den inte gick att läsa. */
  onSwapped: (result: { item: unknown | null; customerName: string; fortnoxError: string | null }) => void;
}) {
  const reverseVat = orderReverseVat(workOrder);
  const orderBlock = workOrder.status === 'cancelled' ? 'cancelled' as const : invoicingStarted(workOrder) ? 'invoiced' as const : null;

  const [customerId, setCustomerId] = useState('');
  const [customerLabel, setCustomerLabel] = useState('');
  const [card, setCard] = useState<SwapCustomerCard | null>(null);
  const [loadingCard, setLoadingCard] = useState(false);
  const [workAddress, setWorkAddress] = useState<WorkAddressChoice>(() => defaultWorkAddressChoice(workOrder));
  const [saving, setSaving] = useState(false);
  const [serverBlockers, setServerBlockers] = useState<WorkOrderReadinessIssue[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickCustomer(id: string, label: string) {
    setCustomerId(id);
    setCustomerLabel(label);
    setCard(null);
    setServerBlockers(null);
    setError(null);
    setLoadingCard(true);
    try {
      const res = await fetch(`/api/crm/customers/${id}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok || !json?.data?.item) { setError(json?.error || 'Kundkortet gick inte att läsa.'); return; }
      setCard(json.data.item as SwapCustomerCard);
    } catch {
      setError('Kundkortet gick inte att läsa.');
    } finally {
      setLoadingCard(false);
    }
  }

  function clearCustomer() {
    setCustomerId('');
    setCustomerLabel('');
    setCard(null);
    setServerBlockers(null);
    setError(null);
  }

  const swappable = asSwappable(workOrder);
  const block = card ? customerSwapBlock(swappable, card, { invoiced: false, isPortalJob: false, currentReverseVat: reverseVat }) : null;
  const preview = card && !block
    ? buildWorkOrderCustomerSwapUpdate(swappable, card, { workAddress, fallbackRot: null, fortnoxCustomerNumber: card.fortnox_customer_id })
    : null;
  const blockers = serverBlockers ?? (card && preview ? customerSwapReadinessBlockers(swappable, card, preview, workAddress) : []);
  const newName = card ? getCrmCustomerDisplayName(card) : '';
  const contact = card ? resolveCrmContact(card) : null;
  const keepSite = formatSite(currentJobSite(swappable));
  const newSite = card ? formatSite(customerSite(card)) : '';
  const canSubmit = Boolean(card && !block && blockers.length === 0 && !saving && !loadingCard);

  async function submit() {
    if (!card || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrder.id}/customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: card.id, work_address: workAddress }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const listed = json?.errorDetails?.details?.blockers;
        if (Array.isArray(listed) && listed.length > 0) { setServerBlockers(listed as WorkOrderReadinessIssue[]); return; }
        setError(json?.error || 'Kunden kunde inte bytas.');
        return;
      }
      onSwapped({ item: json.data?.item ?? null, customerName: newName, fortnoxError: json.data?.fortnox_error ?? null });
    } catch {
      setError('Kunden kunde inte bytas.');
    } finally {
      setSaving(false);
    }
  }

  const cardHref = card ? withReturnTo(`/crm/kunder/${card.id}`, `/crm/arbetsorder/${workOrder.id}`) : null;

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Byt kund"
      maxWidth="sm:max-w-[560px]"
      header={
        <>
          <h2 className="text-lg font-bold text-slate-900">Byt kund</h2>
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            {workOrder.quote_id
              ? `Ordern flyttas till en annan kund. Offerten står kvar på ${workOrder.client_name}.`
              : 'Ordern flyttas till en annan kund.'}
          </p>
        </>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5"
          >
            {orderBlock ? 'Stäng' : 'Avbryt'}
          </button>
          {orderBlock ? null : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5"
              style={{ backgroundColor: 'var(--crm-primary)' }}
            >
              {saving ? 'Byter kund…' : 'Byt kund'}
            </button>
          )}
        </>
      }
    >
      {orderBlock ? (
        <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-relaxed text-amber-800">
          {customerSwapBlockMessage(orderBlock, { quote_type: workOrder.quote_type, reverseVat })}
        </p>
      ) : (
        <div className="grid gap-4">
          {/* Från och till på en skena: den tomma ringen är kunden ordern har, den fyllda den den flyttas till. */}
          <div className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-3 rounded-xl border border-[#dde6d9] bg-[#f1f5ee] p-3.5">
            <div className="row-span-2 flex flex-col items-center pt-[0.3rem]" aria-hidden="true">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-solid border-slate-400 bg-[#f1f5ee]" />
              <span className="my-1 w-px flex-1 bg-[#c5d3bf]" />
              <span className="mb-[1.6rem] h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-600" />
            </div>
            <div className="min-w-0 pb-3.5">
              <p className="m-0 text-xs text-slate-500">Nuvarande kund</p>
              <p className="m-0 truncate text-sm font-semibold text-slate-800">{workOrder.client_name}</p>
              <p className="m-0 text-xs text-slate-500">{typeLabel(workOrder.quote_type)}{workOrder.quote_type === 'business' && reverseVat ? ', omvänd skattskyldighet' : ''}</p>
            </div>
            <div className="min-w-0">
              <p className="m-0 mb-1 text-xs text-slate-500">Ny kund</p>
              <EntityCombobox
                value={customerId}
                valueLabel={customerLabel}
                onChange={(id, label) => void pickCustomer(id, label)}
                onClear={clearCustomer}
                search={searchCustomerOptions}
                placeholder="Sök kund…"
                disabled={saving}
              />
            </div>
          </div>

          {loadingCard ? <p className="m-0 text-sm text-slate-500">Läser kundkortet…</p> : null}

          {card && block ? (
            <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-relaxed text-amber-800">
              {customerSwapBlockMessage(block, { quote_type: workOrder.quote_type, reverseVat })}
            </p>
          ) : null}

          {card && !block ? (
            <>
              <fieldset className="m-0 grid gap-2 border-0 p-0">
                <legend className={cn('mb-1.5 p-0', crm.sectionTitle)}>Arbetsadress</legend>
                {([
                  ['keep', 'Behåll orderns', keepSite || 'Ordern saknar arbetsadress'],
                  ['customer', 'Den nya kundens adress', newSite || 'Kortet saknar adress'],
                ] as const).map(([value, title, address]) => (
                  <label key={value} className="relative block cursor-pointer">
                    <input
                      type="radio"
                      name="swap-work-address"
                      value={value}
                      checked={workAddress === value}
                      onChange={() => { setWorkAddress(value); setServerBlockers(null); }}
                      className="peer sr-only"
                    />
                    <span className="block rounded-xl border border-solid border-[#dde6d9] bg-[#f1f5ee] px-3.5 py-2.5 transition peer-checked:border-emerald-500 peer-checked:bg-emerald-50 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500/40">
                      <span className="block text-sm font-semibold text-slate-800">{title}</span>
                      <span className="block text-sm text-slate-600">{address}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <div>
                <p className={cn('m-0 mb-1.5', crm.sectionTitle)}>Det här händer</p>
                <ul className="m-0 grid list-disc gap-1 pl-5 text-sm leading-relaxed text-slate-700">
                  <li>
                    {contact?.name
                      ? `Kundkontakt och Er referens blir ${contact.name}.`
                      : `Kundkontakt och Er referens töms: kortet har ingen kontaktperson.${contact?.phone ? ` Kortets telefon ${contact.phone} följer med.` : ''}`}
                  </li>
                  {workOrder.rot_details?.enabled === true ? <li>{`ROT-sökande blir ${newName}.`}</li> : null}
                  <li>Märkning och kontakt på plats står kvar.</li>
                  {workOrder.fortnox_order_number ? <li>{`Fortnox-order ${workOrder.fortnox_order_number} byter kund i samma steg.`}</li> : null}
                </ul>
              </div>
            </>
          ) : null}

          {blockers.length > 0 ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-800">
              <p className="m-0 font-semibold">Kundkortet behöver kompletteras</p>
              <ul className="m-0 mt-1 grid list-disc gap-1 pl-5 leading-relaxed">
                {blockers.map((issue) => <li key={issue.field}>{issue.message}</li>)}
              </ul>
              {cardHref ? <a href={cardHref} className={cn('mt-2 inline-block', crm.link)}>Öppna kundkortet</a> : null}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-800">{error}</p>
          ) : null}
        </div>
      )}
    </CrmModal>
  );
}

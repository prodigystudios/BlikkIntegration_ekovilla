"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import EntityCombobox from '@/app/crm/components/EntityCombobox';
import CrmConfirmDialog from '@/app/crm/components/CrmConfirmDialog';
import { searchCustomerOptions } from '@/app/crm/lib/customerSearch';
import { formatStoreOrderKr as kr, type StoreOrderFreight, type StoreOrderStatus } from '@/lib/domains/portal/storeOrders';

// Ekovillas steg på en butiksbeställning (RESELLER_PORTAL_CRM_PLAN.md fas 8b), för den ansvarige och admin (sidan frågar
// crm_store_order_can_manage innan den visar kortet; routerna frågar igen). Stegen är en ordningsföljd: butikens
// kundkort, frakten, och sedan Bekräfta, som låser beställningen för butiken och skapar Fortnox-ordern. Efter
// bekräftelsen visar kortet Fortnox-ordern tills den finns, med "Skicka till Fortnox" om den inte kunde skapas.
// Varje steg läser om sidan (serverkomponent) efteråt, så att summorna och händelserna stämmer.

type Props = {
  id: string;
  status: StoreOrderStatus;
  storeVersion: number;
  /** Det säljaren ser av Ekovillas val; Bekräfta skickar dem, och servern nekar om någon annan ändrat dem. */
  freightSetAt: string | null;
  customerId: string | null;
  storeName: string;
  /** Kundnumret portalen skickade. */
  customerNumber: string | null;
  customer: { name: string; fortnoxCustomerNumber: string | null } | null;
  freight: StoreOrderFreight;
  fortnoxOrderNumber: string | null;
  fortnoxError: string | null;
};

type ApiResult = { ok: boolean; status: number; data: any; error: string | null; code: string | null };

async function send(url: string, method: 'PUT' | 'POST', body: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    const ok = res.ok && json?.ok === true;
    return { ok, status: res.status, data: json?.data ?? null, error: ok ? null : (json?.error ?? null), code: json?.errorDetails?.code ?? null };
  } catch {
    return { ok: false, status: 0, data: null, error: null, code: null };
  }
}

// Bara företag: butiken är ett företag, och servern nekar ett privatkundskort ändå.
const searchStores = (query: string) => searchCustomerOptions(query, { businessOnly: true });

/** Kronor med högst två decimaler, med svenskt komma och mellanslag som tusentalsavgränsare. */
function parsePrice(text: string): number | null {
  const compact = text.replace(/\s+/g, '');
  if (!/^\d{1,7}([.,]\d{1,2})?$/.test(compact)) return null;
  const value = Number(compact.replace(',', '.'));
  return value > 0 && value <= 1_000_000 ? value : null;
}

function StepNumber({ n, done, className }: { n: number; done: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums',
        className,
        done ? 'bg-[color:var(--ek-green)] text-white' : 'border border-slate-300 bg-white text-slate-500',
      )}
    >
      {done ? '✓' : n}
    </span>
  );
}

type StepProps = { props: Props; busy: boolean; run: Runner; editing: boolean; setEditing: (editing: boolean) => void };

function CustomerStep({ props, busy, run, editing, setEditing }: StepProps) {
  const [customerId, setCustomerId] = useState('');
  const [customerLabel, setCustomerLabel] = useState('');
  // Ett nytt val varje gång: ett kort som valdes och avbröts ska inte stå kvar nästa gång.
  function edit(on: boolean) {
    setCustomerId('');
    setCustomerLabel('');
    setEditing(on);
  }
  const linked = props.customer && props.customer.fortnoxCustomerNumber;
  const open = editing || !props.customer;

  async function link() {
    if (!customerId) return;
    const done = await run(`/api/crm/portal/store-orders/${props.id}/customer`, 'PUT', { customer_id: customerId }, 'Kunden kunde inte kopplas.', (data) =>
      data?.store_link_attempted && data?.store_linked === false
        ? { error: 'Kunden är kopplad till beställningen, men kopplingen sparades inte på butiken.' }
        : 'Kunden är kopplad.',
    );
    if (done) edit(false);
  }

  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2.5 gap-y-1.5">
      <StepNumber n={1} done={Boolean(linked) && !editing} />
      <div className="grid min-w-0 gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 className={crm.bodyStrong}>Butikens kundkort</h3>
          {props.customer && !editing ? (
            <button type="button" onClick={() => edit(true)} disabled={busy} className={cn(crm.link, 'bg-transparent p-0 text-xs')}>
              Byt
            </button>
          ) : null}
        </div>
        {props.customer && !editing ? (
          <p className={crm.fieldValue}>
            {props.customer.name}
            {props.customer.fortnoxCustomerNumber ? (
              <span className="text-slate-500">, kundnummer {props.customer.fortnoxCustomerNumber}</span>
            ) : (
              <span className="block text-xs text-rose-700">Kortet har inget kundnummer i Fortnox. Byt till butikens kort i Fortnox.</span>
            )}
          </p>
        ) : null}
        {open ? (
          <>
            {!props.customer ? (
              <p className={crm.meta}>
                {props.customerNumber
                  ? `Portalen skickade kundnumret ${props.customerNumber}, som inte finns som företagskund i kundregistret.`
                  : `${props.storeName} har inget kundnummer i portalen.`}{' '}
                Välj butikens kort: det är butiken vi fakturerar. Kopplingen gäller också butikens nästa beställning och jobb.
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <EntityCombobox
                value={customerId}
                valueLabel={customerLabel}
                onChange={(id, label) => {
                  setCustomerId(id);
                  setCustomerLabel(label);
                }}
                onClear={() => {
                  setCustomerId('');
                  setCustomerLabel('');
                }}
                search={searchStores}
                placeholder="Sök butikens kundkort…"
                disabled={busy}
              />
              <div className="flex gap-2">
                <button type="button" onClick={link} disabled={!customerId || busy} className={cn(crm.saveButton, 'px-4 sm:w-auto')}>
                  Koppla
                </button>
                {editing ? (
                  <button type="button" onClick={() => edit(false)} disabled={busy} className={cn(crm.ghostButton, 'h-9')}>
                    Avbryt
                  </button>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </li>
  );
}

const savedMode = (freight: StoreOrderFreight): 'none' | 'charged' => freight?.mode ?? 'charged';
const savedPriceText = (freight: StoreOrderFreight) => (freight?.mode === 'charged' ? String(freight.price).replace('.', ',') : '');

function FreightStep({ props, busy, run, editing, setEditing }: StepProps) {
  const [mode, setMode] = useState<'none' | 'charged'>(savedMode(props.freight));
  const [priceText, setPriceText] = useState(savedPriceText(props.freight));
  const [touched, setTouched] = useState(false);
  // Fälten läses om ur det som är sparat varje gång: någon annan kan ha sparat under tiden, och en ändring som avbröts
  // ska inte stå kvar och sparas nästa gång.
  function edit(on: boolean) {
    setMode(savedMode(props.freight));
    setPriceText(savedPriceText(props.freight));
    setTouched(false);
    setEditing(on);
  }
  const open = editing || props.freight === null;
  const price = parsePrice(priceText);
  const priceInvalid = mode === 'charged' && price === null;

  async function save() {
    setTouched(true);
    if (priceInvalid) return;
    const body = mode === 'none' ? { mode: 'none' } : { mode: 'charged', price };
    const done = await run(`/api/crm/portal/store-orders/${props.id}/freight`, 'PUT', body, 'Frakten kunde inte sparas.', () =>
      mode === 'none' ? 'Ingen frakt.' : 'Frakten är sparad.',
    );
    if (done) setEditing(false);
  }

  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2.5 gap-y-1.5">
      <StepNumber n={2} done={props.freight !== null && !editing} />
      <div className="grid min-w-0 gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 className={crm.bodyStrong}>Frakt</h3>
          {props.freight !== null && !editing ? (
            <button type="button" onClick={() => edit(true)} disabled={busy} className={cn(crm.link, 'bg-transparent p-0 text-xs')}>
              Ändra
            </button>
          ) : null}
        </div>
        {props.freight !== null && !editing ? (
          <p className={crm.fieldValue}>{props.freight.mode === 'none' ? 'Ingen frakt' : `${kr(props.freight.price)} exkl. moms`}</p>
        ) : null}
        {open ? (
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="sr-only">Frakt</legend>
            <label className="flex w-auto cursor-pointer items-center gap-2 text-sm text-slate-800">
              <input
                type="radio"
                name={`freight-${props.id}`}
                checked={mode === 'charged'}
                onChange={() => setMode('charged')}
                disabled={busy}
                className="h-4 w-4 accent-[color:var(--ek-green)]"
              />
              Frakt, som artikel 1050
            </label>
            {mode === 'charged' ? (
              <div className="grid gap-1 pl-6">
                <div className="grid grid-cols-[minmax(0,9rem)_auto] items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Fraktens pris i kronor, exkl. moms"
                    aria-invalid={touched && priceInvalid}
                    value={priceText}
                    onChange={(e) => setPriceText(e.target.value)}
                    onBlur={() => setTouched(true)}
                    disabled={busy}
                    className={cn(crm.input, 'tabular-nums', touched && priceInvalid && 'border-rose-300')}
                  />
                  <span className={crm.meta}>kr exkl. moms</span>
                </div>
                {touched && priceInvalid ? <p className="text-xs text-rose-700">Ange priset i kronor, större än noll och med högst två decimaler.</p> : null}
              </div>
            ) : null}
            <label className="flex w-auto cursor-pointer items-center gap-2 text-sm text-slate-800">
              <input
                type="radio"
                name={`freight-${props.id}`}
                checked={mode === 'none'}
                onChange={() => setMode('none')}
                disabled={busy}
                className="h-4 w-4 accent-[color:var(--ek-green)]"
              />
              Ingen frakt
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={busy} className={cn(crm.saveButton, 'px-4 sm:w-auto')}>
                Spara frakten
              </button>
              {editing ? (
                <button type="button" onClick={() => edit(false)} disabled={busy} className={cn(crm.ghostButton, 'h-9')}>
                  Avbryt
                </button>
              ) : null}
            </div>
          </fieldset>
        ) : null}
      </div>
    </li>
  );
}

/** Vad som sägs när anropet gick igenom: en text, eller `{ error }` när steget gick men något efter det inte gjorde det. */
type SuccessMessage = string | { error: string };

type Runner = (
  url: string,
  method: 'PUT' | 'POST',
  body: unknown,
  failure: string,
  success: (data: any) => SuccessMessage,
) => Promise<boolean>;

// Lägen där sidan inte längre stämmer med beställningen: läs om den.
const STALE_CODES = new Set([
  'store_order_not_received',
  'store_order_changed',
  'store_order_changed_here',
  'store_order_customer_changed',
  'store_order_not_confirmed',
  'store_order_push_in_progress',
]);

/** Vad Fortnox-försöket blev, som säljaren läser det. */
function fortnoxMessage(data: any, confirmed: boolean): SuccessMessage {
  const lead = confirmed ? 'Beställningen är bekräftad' : null;
  // Felet först: en order som skapades men inte kunde kopplas har både ett nummer och ett fel, och felet är det viktiga.
  if (data?.fortnox_error) {
    if (data?.fortnox_order_number) return { error: lead ? `${lead}. ${data.fortnox_error}` : data.fortnox_error };
    return { error: lead ? `${lead}, men Fortnox-ordern kunde inte skapas. ${data.fortnox_error}` : `Fortnox-ordern kunde inte skapas. ${data.fortnox_error}` };
  }
  if (data?.fortnox_order_number) {
    return lead ? `${lead} och Fortnox-order ${data.fortnox_order_number} är skapad.` : `Fortnox-order ${data.fortnox_order_number} är skapad.`;
  }
  if (data?.fortnox_outcome === 'in_progress') return `${lead ?? 'Klart'}. Fortnox-ordern skapas av ett annat försök just nu.`;
  return `${lead ?? 'Klart'}.`;
}

export default function StoreOrderActions(props: Props) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [editingFreight, setEditingFreight] = useState(false);

  const run: Runner = async (url, method, body, failure, success) => {
    if (busy) return false;
    setBusy(true);
    try {
      const result = await send(url, method, body);
      if (!result.ok) {
        toast.error(result.error || failure);
        // Läs om när sidan inte längre stämmer, och när svaret inte kom fram (nätet, 5xx, en tidsgräns): steget kan ha
        // gått igenom ändå, och en bekräftad beställning ska inte stå kvar som ny.
        if ((result.code && STALE_CODES.has(result.code)) || result.status === 0 || result.status >= 500) router.refresh();
        return false;
      }
      const message = success(result.data);
      if (typeof message === 'string') toast.success(message);
      else toast.error(message.error);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  };

  async function confirm() {
    const body = { version: props.storeVersion, freightSetAt: props.freightSetAt, customerId: props.customerId };
    const ok = await run(`/api/crm/portal/store-orders/${props.id}/confirm`, 'POST', body, 'Beställningen kunde inte bekräftas.', (data) =>
      fortnoxMessage(data, true),
    );
    setConfirming(false);
    return ok;
  }

  if (props.status === 'confirmed' && !props.fortnoxOrderNumber) {
    return (
      <section className={cn(crm.cardInner, 'grid gap-2.5 border-amber-200')} aria-labelledby="store-order-fortnox">
        <h2 id="store-order-fortnox" className={crm.cardTitle}>
          Fortnox-ordern
        </h2>
        {props.fortnoxError ? (
          <p className="text-sm text-rose-800">
            Beställningen är bekräftad, men Fortnox-ordern kunde inte skapas. {props.fortnoxError}
          </p>
        ) : (
          <p className={crm.meta}>Beställningen är bekräftad. Fortnox-ordern har inte skapats än.</p>
        )}
        <p className={crm.meta}>
          Var felet tillfälligt görs nya försök av sig själv under ett dygn. Annars: rätta det som felet säger och skicka igen.
          Butiken får bekräftelsen när ordern finns.
        </p>
        <button
          type="button"
          onClick={() =>
            run(`/api/crm/portal/store-orders/${props.id}/fortnox`, 'POST', {}, 'Fortnox-ordern kunde inte skickas.', (data) => fortnoxMessage(data, false))
          }
          disabled={busy}
          className={cn(crm.saveButton, 'px-4 sm:w-auto sm:justify-self-start')}
        >
          {busy ? 'Skickar…' : 'Skicka till Fortnox'}
        </button>
      </section>
    );
  }

  if (props.status !== 'received') return null;

  const customerReady = Boolean(props.customer?.fortnoxCustomerNumber);
  const freightReady = props.freight !== null;
  // Ett steg som ändras har osparade värden: Bekräfta hade bekräftat det som är sparat, inte det som står i fältet.
  const editing = editingCustomer || editingFreight;
  const ready = customerReady && freightReady && !editing;
  const missing = editing
    ? 'spara eller avbryt ändringen'
    : [!customerReady ? 'koppla butikens kundkort' : null, !freightReady ? 'sätt frakten' : null].filter(Boolean).join(' och ');

  return (
    <section className={cn(crm.cardInner, 'grid gap-3')} aria-labelledby="store-order-confirm">
      <div className="grid gap-1">
        <h2 id="store-order-confirm" className={crm.cardTitle}>
          Bekräfta beställningen
        </h2>
        <p className={crm.meta}>När den är bekräftad kan butiken inte längre ändra den, och Fortnox-ordern skapas.</p>
      </div>
      <ol className="m-0 grid list-none gap-3.5 p-0">
        <CustomerStep props={props} busy={busy} run={run} editing={editingCustomer} setEditing={setEditingCustomer} />
        <FreightStep props={props} busy={busy} run={run} editing={editingFreight} setEditing={setEditingFreight} />
        <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2.5 gap-y-1.5">
          {/* Mitt för knappen, som är högre än de andra stegens rubrikrad. */}
          <StepNumber n={3} done={false} className="mt-2" />
          <div className="grid gap-1.5">
            <button type="button" onClick={() => setConfirming(true)} disabled={!ready || busy} className={cn(crm.saveButton, 'px-4')}>
              Bekräfta beställningen
            </button>
            {!ready ? <p className={crm.meta}>Innan dess: {missing}.</p> : null}
          </div>
        </li>
      </ol>
      {confirming ? (
        <CrmConfirmDialog
          title="Bekräfta beställningen?"
          message="Butiken kan inte längre ändra eller dra tillbaka den, och Fortnox-ordern skapas med 25 % moms."
          confirmLabel={busy ? 'Bekräftar…' : 'Bekräfta'}
          busy={busy}
          focusCancel
          onConfirm={confirm}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </section>
  );
}

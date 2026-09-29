"use client";

import { useRef, useState, useTransition } from 'react';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { useRouter } from 'next/navigation';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import EntityCombobox from '@/app/crm/components/EntityCombobox';
import CrmConfirmDialog from '@/app/crm/components/CrmConfirmDialog';
import { searchCustomerOptions } from '@/app/crm/lib/customerSearch';
import {
  STORE_ORDER_CANCEL_REASON_MAX,
  formatStoreOrderDay,
  formatStoreOrderKr as kr,
  isStoreOrderDeliveredOnAllowed,
  storeOrderCanBeCancelled,
  type StoreOrderFreight,
  type StoreOrderStatus,
} from '@/lib/domains/portal/storeOrders';

// Ekovillas steg på en butiksbeställning (RESELLER_PORTAL_CRM_PLAN.md fas 8b), för den ansvarige och admin (sidan frågar
// crm_store_order_can_manage innan den visar kortet; routerna frågar igen). Ett kort per läge:
//   mottagen    butikens kundkort, frakten, och sedan Bekräfta, som låser beställningen för butiken och skapar
//               Fortnox-ordern (en ordningsföljd, därför numrerad);
//   bekräftad   Fortnox-ordern tills den finns ("Skicka till Fortnox" om den inte kunde skapas), sedan Markera som
//               levererad;
//   levererad   Fakturera beställningen.
// Rubriken är stegets handling, som i Bekräfta-kortet.
// Makulera står längst ner så länge beställningen är mottagen eller bekräftad (8b2).
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
  /** Beställningens nummer (B-…), i makuleringens rubrik. */
  orderNumber: string;
  /** Leveransdagens gränser (svenska dagar), räknade på servern: från dagen beställningen kom in till i dag. */
  deliveredOnBounds: { min: string; max: string };
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

/** Samma prövning som servern: ett kort med kundnummer i Fortnox, och ett nummer som bara är blanksteg är inget nummer. */
const customerIsReady = (props: Props) => Boolean(props.customer?.fortnoxCustomerNumber?.trim());

function CustomerStep({ props, busy, run, editing, setEditing }: StepProps) {
  const [customerId, setCustomerId] = useState('');
  const [customerLabel, setCustomerLabel] = useState('');
  // Ett nytt val varje gång: ett kort som valdes och avbröts ska inte stå kvar nästa gång.
  function edit(on: boolean) {
    setCustomerId('');
    setCustomerLabel('');
    setEditing(on);
  }
  const linked = customerIsReady(props);
  const open = editing || !props.customer;

  async function link() {
    if (!customerId) return;
    const body = { customer_id: customerId, expected_customer_id: props.customerId };
    const done = await run(`/api/crm/portal/store-orders/${props.id}/customer`, 'PUT', body, 'Kunden kunde inte kopplas.', (data) =>
      data?.store_link === 'failed'
        ? { error: 'Kunden är kopplad till beställningen, men kopplingen sparades inte på butiken.' }
        : data?.store_link === 'kept'
          ? 'Kunden är kopplad till beställningen. Butiken är redan kopplad till ett annat kort, som gäller dess nästa beställningar och jobb.'
          : 'Kunden är kopplad.',
    );
    // Klart, eller sidan stämde inte: stängt, så att det som nu är sparat syns.
    if (done !== 'failed') edit(false);
  }

  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2.5 gap-y-1.5">
      <StepNumber n={1} done={linked && !editing} />
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
            {props.customer.fortnoxCustomerNumber?.trim() ? (
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
                  ? `Beställningen är inte kopplad till något kundkort. Portalen skickade kundnumret ${props.customerNumber}.`
                  : `Beställningen är inte kopplad till något kundkort, och ${props.storeName} har inget kundnummer i portalen.`}{' '}
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
    const expectedSetAt = props.freightSetAt;
    const body = mode === 'none' ? { mode: 'none', expectedSetAt } : { mode: 'charged', price, expectedSetAt };
    const done = await run(`/api/crm/portal/store-orders/${props.id}/freight`, 'PUT', body, 'Frakten kunde inte sparas.', () =>
      mode === 'none' ? 'Ingen frakt.' : 'Frakten är sparad.',
    );
    // Klart: stängt. Sidan stämde inte: stängt och tömt, så att det nya syns och ingen gammal siffra sparas igen.
    if (done === 'ok') setEditing(false);
    else if (done === 'stale') edit(false);
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

/** `stale`: servern sa att sidan inte längre stämmer; den läses om, och ett öppet steg ska stängas så att det nya syns. */
type RunResult = 'ok' | 'failed' | 'stale';

type Runner = (
  url: string,
  method: 'PUT' | 'POST',
  body: unknown,
  failure: string,
  success: (data: any) => SuccessMessage,
  staleCodes?: ReadonlySet<string>,
) => Promise<RunResult>;

// Lägen där sidan inte längre stämmer med beställningen: läs om den, och stäng ett öppet steg så att det nya syns.
// Stegen och Bekräfta har var sina: ett kort utan kundnummer som säljaren just valt är ett felval, inte en gammal sida.
const STEP_STALE_CODES = new Set(['store_order_not_received', 'store_order_customer_changed', 'store_order_freight_changed']);
const CONFIRM_STALE_CODES = new Set([
  'store_order_not_received',
  'store_order_changed',
  'store_order_changed_here',
  'store_order_not_confirmed',
  'store_order_push_in_progress',
  // Bekräftelsens krav: sidan visade dem som uppfyllda, så den stämmer inte längre.
  'store_order_freight_missing',
  'store_order_customer_missing',
  'store_order_customer_not_in_fortnox',
]);
// Levererad, Fakturera och Makulera (8b2): beställningen är inte längre som sidan visar den.
const FULFIL_STALE_CODES = new Set([
  'store_order_not_confirmed',
  'store_order_fortnox_order_missing',
  'store_order_not_delivered',
  'store_order_not_cancellable',
  'store_order_changed',
  // Dagen utanför gränserna: sidan kan ha stått öppen över midnatt, och gränserna läses om.
  'store_order_delivered_on_out_of_range',
  // Fortnox-ordern är makulerad eller fakturerad i Fortnox: ett nytt försök ger samma nej, så dialogen stängs.
  'store_order_fortnox_order_cancelled',
  'store_order_fortnox_order_invoiced',
]);
// Ett annat steg pågår: sidan läses om efter Levererad och Fakturera. Makulera läser inte om, så att skälet står kvar i
// dialogen när säljaren försöker igen om en stund.
const FULFIL_BUSY_CODES = ['store_order_busy', 'store_order_invoice_in_progress'];
const STEP_FULFIL_STALE_CODES = new Set([...FULFIL_STALE_CODES, ...FULFIL_BUSY_CODES]);

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

/** Vad Fakturera blev, som säljaren läser det. */
function invoiceMessage(data: any): string {
  const number = data?.fortnox_invoice_number;
  if (data?.source === 'adopted') return `Faktura ${number} fanns redan i Fortnox och är nu kopplad.`;
  if (data?.source === 'already') return `Beställningen är redan fakturerad, med faktura ${number}.`;
  return `Faktura ${number} är skapad i Fortnox.`;
}

/** Makulera, längst ner i kortet: sällsynt och går inte att ta tillbaka, så den står tyst under huvudsteget. */
function CancelFoot({ onOpen, disabled }: { onOpen: () => void; disabled: boolean }) {
  return (
    <div className="border-t border-[#e3e9df] pt-3">
      <button type="button" onClick={onOpen} disabled={disabled} className={crm.dangerButton}>
        Makulera beställningen
      </button>
    </div>
  );
}

/**
 * Skälet till butiken, och vad makuleringen gör. Skälet ägs av kortet (`reason`), så att det står kvar om sidan läses om
 * och kortet byter läge medan dialogen är öppen; det töms när dialogen öppnas.
 */
function CancelDialog({
  props,
  busy,
  reason,
  setReason,
  onConfirm,
  onClose,
}: {
  props: Props;
  busy: boolean;
  reason: string;
  setReason: (reason: string) => void;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const trimmed = reason.trim();
  const invalid = trimmed.length === 0;
  const consequence =
    props.status === 'received'
      ? 'Butiken ser att Ekovilla makulerat beställningen, och skälet.'
      : props.fortnoxOrderNumber
        ? `Fortnox-order ${props.fortnoxOrderNumber} makuleras också. Butiken ser att Ekovilla makulerat beställningen, och skälet.`
        : 'Fortnox-ordern har inte skapats. Finns den ändå i Fortnox makuleras den också. Butiken ser att Ekovilla makulerat beställningen, och skälet.';
  function submit() {
    setTouched(true);
    if (!invalid) onConfirm(trimmed);
  }
  return (
    <CrmConfirmDialog
      title={`Makulera ${props.orderNumber}?`}
      message={`${consequence} Det går inte att ångra.`}
      confirmLabel={busy ? 'Makulerar…' : 'Makulera beställningen'}
      busy={busy}
      tone="danger"
      onConfirm={submit}
      onCancel={busy ? () => {} : onClose}
    >
      <label className="grid gap-1">
        <span className={crm.label}>Skäl till butiken</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          disabled={busy}
          rows={4}
          maxLength={STORE_ORDER_CANCEL_REASON_MAX}
          aria-invalid={touched && invalid}
          placeholder="t.ex. Artikeln går inte att leverera före jul"
          className={cn(crm.input, 'h-auto min-h-[96px] py-2', touched && invalid && 'border-rose-300')}
        />
        {touched && invalid ? <span className="text-xs text-rose-700">Skriv skälet. Butiken ser det.</span> : null}
      </label>
    </CrmConfirmDialog>
  );
}

export default function StoreOrderActions(props: Props) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Medan sidan läses om efter ett steg bär knapparna de gamla värdena: Bekräfta hade skickat dem och fått "ändrad".
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [editingFreight, setEditingFreight] = useState(false);
  // Leveransdagen: i dag som förval (serverns svenska dag). Sidan kan stå öppen över midnatt, så övre gränsen är den senare
  // av serverns och webbläsarens svenska dag, läst när fältet används; servern prövar ändå.
  const [deliveredOn, setDeliveredOn] = useState(props.deliveredOnBounds.max);
  const [today, setToday] = useState(props.deliveredOnBounds.max);
  const refreshToday = () => {
    const now = stockholmTodayISO();
    setToday(now > props.deliveredOnBounds.max ? now : props.deliveredOnBounds.max);
  };
  const deliveredOnBounds = { min: props.deliveredOnBounds.min, max: today };
  const [confirmingDelivery, setConfirmingDelivery] = useState(false);
  const [confirmingInvoice, setConfirmingInvoice] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const openCancel = () => {
    setCancelReason('');
    setCancelling(true);
  };

  // Två klick i samma bildruta ser båda `busy` som falskt; referensen stoppar det andra.
  const inFlight = useRef(false);
  const run: Runner = async (url, method, body, failure, success, staleCodes = STEP_STALE_CODES) => {
    if (inFlight.current) return 'failed';
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await send(url, method, body);
      if (!result.ok) {
        toast.error(result.error || failure);
        // Läs om när sidan inte längre stämmer, och när svaret inte kom fram (nätet, 5xx, en tidsgräns): steget kan ha
        // gått igenom ändå, och en bekräftad beställning ska inte stå kvar som ny.
        const stale = Boolean(result.code && staleCodes.has(result.code));
        if (stale || result.status === 0 || result.status >= 500) refresh();
        return stale ? 'stale' : 'failed';
      }
      const message = success(result.data);
      if (typeof message === 'string') toast.success(message);
      else toast.error(message.error);
      refresh();
      return 'ok';
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  async function confirm() {
    const body = { version: props.storeVersion, freightSetAt: props.freightSetAt, customerId: props.customerId };
    const ok = await run(
      `/api/crm/portal/store-orders/${props.id}/confirm`,
      'POST',
      body,
      'Beställningen kunde inte bekräftas.',
      (data) => fortnoxMessage(data, true),
      CONFIRM_STALE_CODES,
    );
    setConfirming(false);
    return ok;
  }

  async function markDelivered() {
    await run(
      `/api/crm/portal/store-orders/${props.id}/deliver`,
      'POST',
      { deliveredOn },
      'Leveransen kunde inte sparas.',
      () => 'Beställningen är markerad som levererad.',
      STEP_FULFIL_STALE_CODES,
    );
    setConfirmingDelivery(false);
  }

  async function invoice() {
    await run(
      `/api/crm/portal/store-orders/${props.id}/invoice`,
      'POST',
      {},
      'Fakturan kunde inte skapas.',
      invoiceMessage,
      STEP_FULFIL_STALE_CODES,
    );
    setConfirmingInvoice(false);
  }

  async function cancel(reason: string) {
    const done = await run(
      `/api/crm/portal/store-orders/${props.id}/cancel`,
      'POST',
      { reason, status: props.status, version: props.storeVersion },
      'Beställningen kunde inte makuleras.',
      (data) => {
        const numbers: string[] = Array.isArray(data?.fortnox_order_numbers) ? data.fortnox_order_numbers : [];
        if (numbers.length === 0) return 'Beställningen är makulerad.';
        return `Beställningen är makulerad, och Fortnox-order ${numbers.join(' och ')} också.`;
      },
      FULFIL_STALE_CODES,
    );
    // Stängd när den gick igenom eller sidan inte längre stämmer; ett fel från Fortnox låter skälet stå kvar.
    if (done !== 'failed') setCancelling(false);
  }

  const locked = busy || refreshing;
  const cancelFoot = storeOrderCanBeCancelled(props.status) ? <CancelFoot onOpen={openCancel} disabled={locked} /> : null;
  const cancelDialog = cancelling ? (
    <CancelDialog
      props={props}
      busy={busy}
      reason={cancelReason}
      setReason={setCancelReason}
      onConfirm={cancel}
      onClose={() => setCancelling(false)}
    />
  ) : null;

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
            run(`/api/crm/portal/store-orders/${props.id}/fortnox`, 'POST', {}, 'Fortnox-ordern kunde inte skickas.', (data) => fortnoxMessage(data, false), CONFIRM_STALE_CODES)
          }
          disabled={locked}
          className={cn(crm.saveButton, 'px-4 sm:w-auto sm:justify-self-start')}
        >
          {busy ? 'Skickar…' : 'Skicka till Fortnox'}
        </button>
        {cancelFoot}
        {cancelDialog}
      </section>
    );
  }

  if (props.status === 'confirmed') {
    const dayValid = isStoreOrderDeliveredOnAllowed(deliveredOn, deliveredOnBounds);
    return (
      <section className={cn(crm.cardInner, 'grid gap-2.5')} aria-labelledby="store-order-delivery-step">
        <div className="grid gap-1">
          <h2 id="store-order-delivery-step" className={crm.cardTitle}>
            Markera som levererad
          </h2>
          <p className={crm.meta}>
            Fortnox-order {props.fortnoxOrderNumber}. Ange dagen varorna kom fram till butiken. Butiken får beskedet.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,11rem)_auto] sm:items-center">
          <input
            type="date"
            aria-label="Leveransdag"
            value={deliveredOn}
            min={deliveredOnBounds.min}
            max={deliveredOnBounds.max}
            onFocus={refreshToday}
            onChange={(e) => {
              refreshToday();
              setDeliveredOn(e.target.value);
            }}
            aria-invalid={!dayValid}
            disabled={locked}
            className={cn(crm.input, 'tabular-nums', !dayValid && 'border-rose-300')}
          />
          <button
            type="button"
            onClick={() => setConfirmingDelivery(true)}
            disabled={locked || !dayValid}
            className={cn(crm.saveButton, 'px-4 sm:w-auto')}
          >
            Markera som levererad
          </button>
        </div>
        {!dayValid ? (
          <p className="text-xs text-rose-700">
            Välj en dag från {formatStoreOrderDay(deliveredOnBounds.min)}, då beställningen kom in, till och med i dag.
          </p>
        ) : null}
        {cancelFoot}
        {cancelDialog}
        {confirmingDelivery ? (
          <CrmConfirmDialog
            title="Markera som levererad?"
            message={`Levererad ${formatStoreOrderDay(deliveredOn)}. Butiken får beskedet, och det går inte att ångra.`}
            confirmLabel={busy ? 'Sparar…' : 'Markera som levererad'}
            busy={busy}
            focusCancel
            onConfirm={markDelivered}
            onCancel={() => setConfirmingDelivery(false)}
          />
        ) : null}
      </section>
    );
  }

  if (props.status === 'delivered') {
    return (
      <section className={cn(crm.cardInner, 'grid gap-2.5')} aria-labelledby="store-order-invoice-step">
        <div className="grid gap-1">
          <h2 id="store-order-invoice-step" className={crm.cardTitle}>
            Fakturera beställningen
          </h2>
          <p className={crm.meta}>
            Fakturan skapas i Fortnox ur order {props.fortnoxOrderNumber}, som ett utkast. Ekonomi bokför och skickar den i Fortnox.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmingInvoice(true)}
          disabled={locked}
          className={cn(crm.saveButton, 'px-4 sm:w-auto sm:justify-self-start')}
        >
          Fakturera
        </button>
        {confirmingInvoice ? (
          <CrmConfirmDialog
            title="Fakturera beställningen?"
            message={`Fakturan skapas i Fortnox ur order ${props.fortnoxOrderNumber}. Butiken får beskedet, och det går inte att ångra.`}
            confirmLabel={busy ? 'Fakturerar…' : 'Fakturera'}
            busy={busy}
            focusCancel
            onConfirm={invoice}
            onCancel={() => setConfirmingInvoice(false)}
          />
        ) : null}
      </section>
    );
  }

  if (props.status !== 'received') return null;

  const customerReady = customerIsReady(props);
  const freightReady = props.freight !== null;
  // Ett steg som ändras har osparade värden: Bekräfta hade bekräftat det som är sparat, inte det som står i fältet.
  const editing = editingCustomer || editingFreight;
  const ready = customerReady && freightReady && !editing && !refreshing;
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
        {/* Medan sidan läses om efter ett steg bär knapparna de gamla värdena: allt är låst tills de nya kommit. */}
        <CustomerStep props={props} busy={locked} run={run} editing={editingCustomer} setEditing={setEditingCustomer} />
        <FreightStep props={props} busy={locked} run={run} editing={editingFreight} setEditing={setEditingFreight} />
        <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2.5 gap-y-1.5">
          {/* Mitt för knappen, som är högre än de andra stegens rubrikrad. */}
          <StepNumber n={3} done={false} className="mt-2" />
          <div className="grid gap-1.5">
            <button type="button" onClick={() => setConfirming(true)} disabled={!ready || busy} className={cn(crm.saveButton, 'px-4')}>
              Bekräfta beställningen
            </button>
            {!ready && missing ? <p className={crm.meta}>Innan dess: {missing}.</p> : null}
          </div>
        </li>
      </ol>
      {cancelFoot}
      {cancelDialog}
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

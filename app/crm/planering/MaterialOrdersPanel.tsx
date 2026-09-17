'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmConfirmDialog from '@/app/crm/components/CrmConfirmDialog';
import SelectMenu from '@/components/ui/SelectMenu';
import { shortDayISO, stockholmTodayISO } from './planningDates';
import type { OpsDepot } from '@/lib/domains/planning/types';
import type { DepotForecast, DepotMaterialForecast } from '@/lib/domains/planning/depotForecast';
import type { MaterialSupplier } from '@/lib/domains/planning/materialSuppliers';
import type { MaterialOrder } from '@/lib/domains/planning/materialOrdersStore';
import {
  ORDER_MESSAGE_MAX,
  OTHER_LINES_MAX,
  OTHER_LINE_TEXT_MAX,
  buildOrderLines,
  describeOrderLineProblem,
  type OrderDeliveryState,
  type OrderWarning,
  type OtherLineInput,
} from '@/lib/domains/planning/materialOrders';
import {
  addComposerRow,
  composerFromOrder,
  composerInvalidRows,
  composerLines,
  composerSuggestion,
  composerTotals,
  draftErrorKind,
  draftSnapshot,
  orderSection,
  palletNote,
  sendResponseUnclear,
  sendingPhase,
  stepByPallet,
  storedDraftSnapshot,
  supplierOverview,
  type ComposerDepot,
  type ComposerRow,
} from '@/lib/domains/planning/materialOrderComposer';

// Administrera → Beställningar: materialbeställning till fabriken, ett mail per lass.
//
// Reglerna bor i lib/domains/planning/materialOrderComposer.ts (förslag, datum, lägen) och på servern
// (material-orders-rutterna). Här ritas de. Plan: ~/.claude/plans/etapp4-bestallningsmail.md.
//
// 🧨 INGET SKICKAS AV SIG SJÄLVT. Skicka kräver ett tryck och en bekräftelse (fokus på Avbryt, så ett Enter inte
// skickar), och ett fel lämnar aldrig kvar en ifylld kvittens som gör nästa tryck till en reflex. "Försök igen" på
// ett oklart utskick bekräftas inte: det skickar samma mail med samma nyckel och kan inte bli ett andra mail.
// 🧨 SIDAN LOVAR INGET SERVERN INTE HÅLLER. Förslagen och kontrollerna här är förhandsbesked; Granska bygger om
// raderna ur registret och Skicka prövar varningarna och utskickets fönster i databasen.

const API = '/api/crm/planering/material-orders';
const STOCK_API = '/api/crm/planering/depot-stock';
const SUPPLIERS_API = '/api/crm/planering/material-suppliers';
const DEPOTS_API = '/api/crm/planering/depots';

const PANEL = 'rounded-2xl border border-[#e0e8dc] bg-white p-4';
const LABEL = 'mb-1.5 block text-[10.5px] font-bold uppercase tracking-wide text-slate-400';
const SECTION = 'mb-2 mt-4 px-1 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400 first:mt-0';
const TEXTAREA =
  'w-full rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-[13px] leading-relaxed text-slate-900 outline-none transition focus:border-[color:var(--ek-accent)] focus:ring-2 focus:ring-[color:var(--ek-accent-ring)]';

type OrderRow = MaterialOrder & { delivery_state: OrderDeliveryState | null };
type ShownWarning = OrderWarning & { text: string };
type Review = { order: MaterialOrder; warnings: ShownWarning[]; fingerprint: string };
type Selection = { kind: 'supplier'; id: string } | { kind: 'order'; id: string; initial?: Review };
type Draft = { depots: ComposerDepot[]; other_lines: OtherLineInput[]; message: string };

type ApiResult = { status: number; ok: boolean; data: any; error: string | null; code: string | null; details: any };

async function callApi(url: string, init?: { method: string; body?: unknown }): Promise<ApiResult> {
  const r = await fetch(url, {
    cache: 'no-store',
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const j = await r.json().catch(() => null);
  return {
    status: r.status,
    ok: Boolean(j?.ok),
    data: j?.data ?? null,
    error: j?.error ?? null,
    code: j?.errorDetails?.code ?? null,
    details: j?.errorDetails?.details ?? null,
  };
}

const stampFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function stamp(iso: string | null): string {
  return iso ? stampFmt.format(new Date(iso)) : '';
}

const DELIVERY_STATE: Record<OrderDeliveryState, { label: string; tone: string }> = {
  waiting: { label: 'Väntar', tone: 'border-[#cfe3d6] bg-[#e7f0ea] text-[#1f4a2e]' },
  partial: { label: 'Delvis framme', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  arrived: { label: 'Framme', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  cancelled: { label: 'Avbokad', tone: 'border-slate-200 bg-slate-50 text-slate-500' },
  none: { label: 'Bara övrigt', tone: 'border-slate-200 bg-slate-50 text-slate-500' },
};

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded-full border px-2 py-px text-[10.5px] font-bold', tone)}>{children}</span>;
}

function orderChip(o: Pick<OrderRow, 'status' | 'delivery_state' | 'send_error' | 'send_error_code'>) {
  if (o.status === 'sending') return <Chip tone="border-amber-300 bg-amber-50 text-amber-800">Okänt om mailet gick fram</Chip>;
  if (o.status === 'draft') {
    const err = draftErrorKind(o);
    if (err === 'rejected') return <Chip tone="border-rose-200 bg-rose-50 text-rose-700">Avvisades</Chip>;
    if (err === 'not_delivered') return <Chip tone="border-rose-200 bg-rose-50 text-rose-700">Gick inte fram</Chip>;
    return <Chip tone="border-slate-200 bg-slate-50 text-slate-600">Utkast</Chip>;
  }
  const s = DELIVERY_STATE[o.delivery_state ?? 'none'];
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

function sacksText(sacks: number, perPallet: number | null): string {
  if (perPallet && sacks % perPallet === 0) return `${sacks / perPallet} pall (${sacks} säck)`;
  return `${sacks} säck`;
}

export default function MaterialOrdersPanel({
  onChanged,
  onDirtyChange,
}: {
  /** Tavlan: ett skickat lass blir väntade leveranser som ska synas. */
  onChanged: () => void;
  /** Osparade ändringar i en beställning — modalen frågar innan de kastas. */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  // Leverantörer och depåer SOM DE ÄR SPARADE — egen läsning, inte modalens listor. De andra flikarna skriver
  // osparad text rakt in i sina listor (useEntityCrud.patchLocal), och en Plats som skrivits men inte sparats
  // fick panelen att säga att allt var i ordning medan Granska nekade "saknar Plats" (Williams QA 2026-09-17).
  // Servern sätter ihop ordern ur det sparade registret; panelen ska se samma sak.
  const [suppliers, setSuppliers] = useState<MaterialSupplier[]>([]);
  const [depots, setDepots] = useState<OpsDepot[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [forecast, setForecast] = useState<DepotForecast | null>(null);
  const [forecastError, setForecastError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<Selection | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      const r = await callApi(API);
      if (!r.ok) throw new Error(r.error || 'Kunde inte hämta beställningarna');
      setOrders(r.data.orders as OrderRow[]);
      setOrdersError(null);
    } catch (e: any) {
      setOrdersError(e?.message || 'Kunde inte hämta beställningarna');
    }
  }, []);

  const loadForecast = useCallback(async () => {
    // Prognosen ger förslagen. Felar den går det ändå att beställa för hand — men det ska stå, annars ser
    // "inga behov" ut som ett svar.
    try {
      const r = await callApi(STOCK_API);
      if (!r.ok || !r.data?.forecast) throw new Error();
      setForecast(r.data.forecast as DepotForecast);
      setForecastError(false);
    } catch {
      setForecast(null);
      setForecastError(true);
    }
  }, []);

  const loadRegistry = useCallback(async () => {
    // Utan registret går ingen beställning att sätta ihop — och ett tomt register får inte se ut som "borttagen".
    try {
      const [s, d] = await Promise.all([callApi(SUPPLIERS_API), callApi(DEPOTS_API)]);
      if (!s.ok) throw new Error(s.error || 'Kunde inte hämta leverantörerna');
      if (!d.ok) throw new Error(d.error || 'Kunde inte hämta depåerna');
      setSuppliers(s.data.suppliers as MaterialSupplier[]);
      setDepots(d.data.depots as OpsDepot[]);
      setRegistryError(null);
    } catch (e: any) {
      setRegistryError(e?.message || 'Kunde inte hämta leverantörer och depåer');
    }
  }, []);

  const reloadAll = useCallback(async () => {
    await Promise.all([loadOrders(), loadForecast(), loadRegistry()]);
  }, [loadOrders, loadForecast, loadRegistry]);

  useEffect(() => {
    reloadAll().finally(() => setLoading(false));
  }, [reloadAll]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const forecastRows = useMemo(() => forecast?.rows ?? [], [forecast]);
  const overview = useMemo(() => supplierOverview({ suppliers, forecastRows, depots, orders }), [suppliers, forecastRows, depots, orders]);
  const action = orders.filter((o) => orderSection(o) === 'action').sort((a, b) => Number(b.status === 'sending') - Number(a.status === 'sending'));
  const onTheWay = orders.filter((o) => orderSection(o) === 'on_the_way');
  const history = orders.filter((o) => orderSection(o) === 'history');

  // Förval: det som kräver åtgärd, annars den leverantör som brådskar mest.
  useEffect(() => {
    if (loading || selection) return;
    if (action[0]) setSelection({ kind: 'order', id: action[0].id });
    else if (overview[0]) setSelection({ kind: 'supplier', id: overview[0].supplier.id });
  }, [loading, selection, action, overview]);

  function select(next: Selection) {
    // Samma val igen: inget byts, inget kastas. Utan grenen frågade dialogen "försvinner?", nollade flaggan och
    // lät kompositören stå kvar — och nästa Stäng kastade ändringarna utan att fråga (granskningsfynd).
    if (selection && `${next.kind}:${next.id}` === `${selection.kind}:${selection.id}`) return;
    if (dirty) {
      setPendingSelection(next);
      return;
    }
    setSelection(next);
  }

  function selectSupplier(s: (typeof overview)[number]) {
    // En fabrik med en öppen order får ingen ny — databasen tillåter en i taget. Öppna den som finns.
    if (s.open_order) select({ kind: 'order', id: s.open_order.id });
    else select({ kind: 'supplier', id: s.supplier.id });
  }

  const today = stockholmTodayISO();
  const selectedKey = selection ? `${selection.kind}:${selection.id}` : '';

  if (loading) return <div className="grid h-full place-items-center text-[12.5px] text-slate-400">Laddar…</div>;
  if (registryError) {
    return (
      <div className="p-5">
        <div className="max-w-xl rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] text-rose-700">
          <div className="font-semibold">Leverantörer eller depåer kunde inte hämtas</div>
          <p className="mt-0.5">{registryError}</p>
          <p className="mt-1 text-[11px] text-rose-500">Beställningar går inte att sätta ihop utan dem.</p>
          <button type="button" onClick={() => reloadAll()} className={cn(crm.ghostButton, 'mt-2')}>
            Försök igen
          </button>
        </div>
      </div>
    );
  }

  const itemClass = (on: boolean) =>
    cn('mb-2 block w-full rounded-xl border bg-white p-3 text-left transition', on ? 'border-emerald-400 ring-2 ring-emerald-500/15' : 'border-[#e0e8dc] hover:border-[#c8d4c3]');

  return (
    <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)]">
      <div className="overflow-y-auto border-r border-[#e0e8dc] p-4">
        <div className="mb-3 flex items-center justify-between gap-2 px-1">
          <p className="text-[11.5px] text-slate-500">Ett mail per lass till fabriken.</p>
          <button type="button" onClick={() => reloadAll()} className="text-[11.5px] font-bold text-slate-500 transition hover:text-emerald-700">
            Läs om
          </button>
        </div>

        {ordersError && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">
            <div className="font-semibold">Beställningarna kunde inte hämtas</div>
            {ordersError}
          </div>
        )}

        {action.length > 0 && (
          <>
            <div className={SECTION}>Kräver åtgärd</div>
            {action.map((o) => (
              <button key={o.id} type="button" onClick={() => select({ kind: 'order', id: o.id })} className={itemClass(selectedKey === `order:${o.id}`)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13.5px] font-bold text-slate-800">
                    #{o.order_no} · {o.supplier_name ?? 'Leverantör borttagen'}
                  </span>
                  {orderChip(o)}
                </div>
                <div className="mt-1 text-[11.5px] text-slate-500">
                  {o.status === 'sending'
                    ? `Utskick påbörjat ${stamp(o.attempt_started_at)}`
                    : `${o.lines.length} ${o.lines.length === 1 ? 'rad' : 'rader'} · spärrar nya beställningar till fabriken`}
                </div>
              </button>
            ))}
          </>
        )}

        <div className={SECTION}>Nästa beställning</div>
        {overview.length === 0 && <p className="px-1 text-[11.5px] text-slate-400">Ingen aktiv leverantör. Lägg upp fabrikerna under Leverantörer.</p>}
        {overview.map((s) => {
          const on = selectedKey === `supplier:${s.supplier.id}` || (!!s.open_order && selectedKey === `order:${s.open_order.id}`);
          return (
            <button key={s.supplier.id} type="button" onClick={() => selectSupplier(s)} className={itemClass(on)}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13.5px] font-bold text-slate-800">{s.supplier.name}</span>
                {s.open_order && <Chip tone="border-slate-200 bg-slate-50 text-slate-600">#{s.open_order.order_no} öppen</Chip>}
              </div>
              <div className="mt-1 text-[11.5px] text-slate-500">
                {s.needs === 0 ? (
                  forecastError ? 'Prognosen saknas' : 'Inga behov i prognosen'
                ) : (
                  <>
                    {s.needs} {s.needs === 1 ? 'behov' : 'behov'}
                    {s.order_by && (
                      <>
                        {' · '}
                        <span className={cn(s.order_by <= today && 'font-bold text-rose-600')}>
                          {s.order_by <= today ? 'beställ idag' : `beställ senast ${shortDayISO(s.order_by)}`}
                        </span>
                      </>
                    )}
                  </>
                )}
              </div>
            </button>
          );
        })}

        {onTheWay.length > 0 && (
          <>
            <div className={SECTION}>På väg</div>
            {onTheWay.map((o) => (
              <OrderListItem key={o.id} order={o} on={selectedKey === `order:${o.id}`} onClick={() => select({ kind: 'order', id: o.id })} className={itemClass} />
            ))}
          </>
        )}

        {history.length > 0 && (
          <>
            <div className={SECTION}>Historik</div>
            {history.map((o) => (
              <OrderListItem key={o.id} order={o} on={selectedKey === `order:${o.id}`} onClick={() => select({ kind: 'order', id: o.id })} className={itemClass} />
            ))}
          </>
        )}
      </div>

      <div className="min-h-0 overflow-y-auto bg-gradient-to-b from-[#fcfdfb] to-[#f9fbf7] p-5">
        {!selection ? (
          <div className="grid h-full place-items-center text-[12.5px] text-slate-400">Välj en leverantör för att beställa.</div>
        ) : selection.kind === 'supplier' ? (
          (() => {
            const supplier = suppliers.find((s) => s.id === selection.id);
            if (!supplier) return <div className="grid h-full place-items-center text-[12.5px] text-slate-400">Leverantören finns inte längre.</div>;
            return (
              <NewOrder
                key={supplier.id}
                supplier={supplier}
                suppliers={suppliers}
                depots={depots}
                forecastRows={forecastRows}
                forecastError={forecastError}
                today={today}
                onDirtyChange={setDirty}
                onCreated={(review) => {
                  setDirty(false);
                  setSelection({ kind: 'order', id: review.order.id, initial: review });
                  loadOrders();
                }}
                onListChanged={loadOrders}
                // Genom select: raderna här är osparade, och skyddet ska fråga innan de kastas.
                onOpenExisting={(id) => select({ kind: 'order', id })}
              />
            );
          })()
        ) : (
          <OrderDetail
            key={selection.id}
            orderId={selection.id}
            initial={selection.initial}
            suppliers={suppliers}
            depots={depots}
            forecastRows={forecastRows}
            forecastError={forecastError}
            today={today}
            onDirtyChange={setDirty}
            onListChanged={loadOrders}
            onBoardChanged={() => {
              onChanged();
              loadForecast();
            }}
            onDiscarded={(supplierId) => {
              // Ur listan direkt: förvalet hade annars kunnat öppna det slängda utkastet innan listan lästs om.
              const discardedId = selection.id;
              setOrders((prev) => prev.filter((o) => o.id !== discardedId));
              setDirty(false);
              setSelection(supplierId ? { kind: 'supplier', id: supplierId } : null);
              loadOrders();
            }}
          />
        )}
      </div>

      {pendingSelection && (
        <CrmConfirmDialog
          title="Lämna beställningen?"
          message="Ändringarna är inte granskade och försvinner. Tryck Granska först om de ska sparas."
          confirmLabel="Lämna utan att spara"
          cancelLabel="Stanna kvar"
          tone="danger"
          onCancel={() => setPendingSelection(null)}
          onConfirm={() => {
            setDirty(false);
            setSelection(pendingSelection);
            setPendingSelection(null);
          }}
        />
      )}
    </div>
  );
}

function OrderListItem({ order, on, onClick, className }: { order: OrderRow; on: boolean; onClick: () => void; className: (on: boolean) => string }) {
  return (
    <button type="button" onClick={onClick} className={className(on)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-bold text-slate-800">
          #{order.order_no} · {order.supplier_name ?? 'Leverantör borttagen'}
        </span>
        {orderChip(order)}
      </div>
      <div className="mt-1 text-[11.5px] text-slate-500">Skickad {stamp(order.sent_at)}</div>
    </button>
  );
}

// ── Ny beställning ──────────────────────────────────────────────────────────

function NewOrder({
  supplier,
  suppliers,
  depots,
  forecastRows,
  forecastError,
  today,
  onDirtyChange,
  onCreated,
  onListChanged,
  onOpenExisting,
}: {
  supplier: MaterialSupplier;
  suppliers: MaterialSupplier[];
  depots: OpsDepot[];
  forecastRows: DepotMaterialForecast[];
  forecastError: boolean;
  today: string;
  onDirtyChange: (dirty: boolean) => void;
  onCreated: (review: Review) => void;
  onListChanged: () => void;
  onOpenExisting: (orderId: string) => void;
}) {
  const toast = useToast();
  const [existing, setExisting] = useState<{ id: string; order_no: number } | null>(null);
  const initial = useMemo<Draft>(
    () => ({ depots: composerSuggestion({ supplier, suppliers, forecastRows, depots, today }), other_lines: [], message: '' }),
    // Förslaget räknas EN gång per leverantör. En omladdad prognos får inte skriva över det någon fyllt i.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supplier.id],
  );
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [serverProblems, setServerProblems] = useState<string[]>([]);

  const baseline = useMemo(() => snapshotOf(initial), [initial]);
  const dirty = snapshotOf(draft) !== baseline;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  async function review() {
    setBusy(true);
    setServerProblems([]);
    try {
      const r = await callApi(API, {
        method: 'POST',
        body: { supplier_id: supplier.id, lines: composerLines(draft.depots), other_lines: draft.other_lines, message: draft.message.trim() || null },
      });
      if (r.status === 201 && r.ok) {
        onCreated({ order: r.data.order, warnings: r.data.warnings, fingerprint: r.data.warnings_fingerprint });
        return;
      }
      if (r.code === 'material_order_open_exists' && r.details?.order_id) {
        // Raderna står kvar: en kollega hann före, och det man själv fyllt i ska inte försvinna i samma stund.
        setExisting({ id: r.details.order_id, order_no: Number(r.details.order_no) });
        toast.error(r.error || 'Det finns redan en öppen beställning till leverantören');
        onListChanged();
        return;
      }
      if (Array.isArray(r.details?.problems)) setServerProblems(r.details.problems);
      toast.error(r.error || 'Kunde inte granska beställningen');
    } catch {
      toast.error('Kunde inte granska beställningen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid max-w-[1600px] items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="min-w-0">
        <SupplierHeader supplier={supplier} />
        {existing && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900">
            <span>
              Någon har redan en öppen beställning (#{existing.order_no}) till {supplier.name}. Dina rader står kvar här. För över dem till #
              {existing.order_no}, där bara en beställning i taget går till fabriken.
            </span>
            <button type="button" onClick={() => onOpenExisting(existing.id)} className={crm.ghostButton}>
              Öppna #{existing.order_no}
            </button>
          </div>
        )}
        <Composer
          supplier={supplier}
          depots={depots}
          forecastRows={forecastRows}
          forecastError={forecastError}
          today={today}
          value={draft}
          onChange={setDraft}
          disabled={busy}
          serverProblems={serverProblems}
          footer={(canReview) => (
            <button type="button" onClick={review} disabled={busy || !canReview} className={crm.formButton} style={{ backgroundColor: 'var(--crm-primary)' }}>
              {busy ? 'Granskar…' : 'Granska'}
            </button>
          )}
        />
      </div>
      <div className="min-w-0 2xl:sticky 2xl:top-0">
        <div className="rounded-2xl border border-dashed border-[#d5dfd0] bg-white/60 p-5 text-[12.5px] leading-relaxed text-slate-500">
          <div className="text-[13.5px] font-extrabold text-[#142c1b]">Mailet till {supplier.name}</div>
          <p className="mt-1">
            Tryck <span className="font-semibold text-slate-700">Granska</span> så visas exakt det mail som går till fabriken, och det som bör ses
            över innan det skickas. Inget skickas förrän du trycker Skicka.
          </p>
          <p className="mt-2 text-[11.5px] text-slate-400">Utkastet sparas och syns för andra som administrerar lagret tills det skickas eller slängs.</p>
        </div>
      </div>
    </div>
  );
}

function snapshotOf(d: Draft): string {
  return draftSnapshot({ lines: composerLines(d.depots), other_lines: d.other_lines, message: d.message });
}

function SupplierHeader({ supplier, badge }: { supplier: MaterialSupplier; badge?: React.ReactNode }) {
  return (
    <div className="mb-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[18px] font-extrabold tracking-tight text-[#142c1b]">{supplier.name}</h3>
        {badge}
        {!supplier.active && <Chip tone="border-rose-200 bg-rose-50 text-rose-700">Inaktiv</Chip>}
      </div>
      <p className="mt-0.5 text-[12px] text-slate-500">
        {supplier.email} · ledtid {supplier.lead_time_days} {supplier.lead_time_days === 1 ? 'dag' : 'dagar'} · mailet på{' '}
        {supplier.order_email_language === 'en' ? 'engelska' : 'svenska'}
      </p>
      {supplier.lead_time_days === 0 && (
        <p className="mt-1 text-[11.5px] text-amber-700">Ledtiden är 0 dagar, så leveransdatumen föreslås från idag. Stämmer det? Ändra under Leverantörer.</p>
      )}
    </div>
  );
}

// ── Kompositören: raderna, övrigt och meddelandet ───────────────────────────

const REASON_TEXT = (row: ComposerRow): string | null => {
  const f = row.forecast;
  switch (row.reason) {
    case 'on_order':
      return f && f.next_arrival
        ? `${f.on_order} säck redan på väg, väntas ${shortDayISO(f.next_arrival)}. Fyll i om det inte räcker.`
        : 'Ett lass är redan på väg. Fyll i om det inte räcker.';
    case 'overdue':
      return `${f?.overdue_inflow ?? 0} säck är beställda men försenade. Ring fabriken hellre än att beställa igen.`;
    case 'shared_material':
      return `Flera leverantörer levererar ${row.material}. Fyll i om det ska beställas härifrån.`;
    default:
      return null;
  }
};

function Composer({
  supplier,
  depots,
  forecastRows,
  forecastError,
  today,
  value,
  onChange,
  disabled,
  serverProblems,
  footer,
}: {
  supplier: MaterialSupplier;
  depots: OpsDepot[];
  forecastRows: DepotMaterialForecast[];
  forecastError: boolean;
  today: string;
  value: Draft;
  onChange: (next: Draft) => void;
  disabled: boolean;
  serverProblems: string[];
  /** Knapparna längst ned. `canReview` = underlaget går att skicka till Granska. */
  footer: (canReview: boolean) => React.ReactNode;
}) {
  const activeDepots = depots.filter((d) => d.active);
  const [addDepotId, setAddDepotId] = useState('');
  const [addMaterial, setAddMaterial] = useState(supplier.materials[0] ?? '');

  const lines = composerLines(value.depots);
  const invalid = composerInvalidRows(value.depots);
  const totals = composerTotals(value.depots);
  // Samma regler som Granska, i förväg — så att "saknar Plats" syns innan man trycker, inte efter.
  const check = invalid.length === 0 && lines.length > 0 ? buildOrderLines(lines, { supplier, depots, today }) : null;
  const problems = check && !check.ok ? check.problems.map(describeOrderLineProblem) : [];
  const canReview = lines.length > 0 && invalid.length === 0 && problems.length === 0;

  function setDepot(depotId: string, patch: Partial<ComposerDepot>) {
    onChange({ ...value, depots: value.depots.map((d) => (d.depot_id === depotId ? { ...d, ...patch } : d)) });
  }
  function setRow(depotId: string, material: string, patch: Partial<ComposerRow>) {
    onChange({
      ...value,
      depots: value.depots.map((d) => (d.depot_id === depotId ? { ...d, rows: d.rows.map((r) => (r.material === material ? { ...r, ...patch } : r)) } : d)),
    });
  }
  function removeRow(depotId: string, material: string) {
    onChange({
      ...value,
      depots: value.depots
        .map((d) => (d.depot_id === depotId ? { ...d, rows: d.rows.filter((r) => r.material !== material) } : d))
        .filter((d) => d.rows.length > 0),
    });
  }
  function addRow() {
    const depot = activeDepots.find((d) => d.id === addDepotId);
    if (!depot || !addMaterial) return;
    onChange({ ...value, depots: addComposerRow(value.depots, { depot, material: addMaterial }, { forecastRows, leadTimeDays: supplier.lead_time_days, today }) });
  }
  function setOther(i: number, patch: Partial<OtherLineInput>) {
    onChange({ ...value, other_lines: value.other_lines.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  }

  return (
    <div className="grid gap-3">
      {forecastError && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
          Prognosen kunde inte räknas ut, så inga förslag visas. Det går att beställa för hand, men titta på saldot under Lager först.
        </p>
      )}

      {value.depots.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[#d5dfd0] bg-white px-4 py-5 text-center text-[12.5px] text-slate-500">
          {forecastError ? 'Lägg till det som ska beställas nedan.' : `Prognosen visar inga behov av ${supplier.materials.join(', ') || 'fabrikens material'}. Lägg till för hand nedan om något ska med.`}
        </div>
      )}

      {value.depots.map((d) => {
        // Ur registret när depån finns där — samma källa som kontrollen nedan och som Granska. Raden bär platsen från
        // när den lades till, och efter en sparad Plats + Läs om hade rubriken annars sagt "saknar" medan kontrollen
        // sa ja.
        const registryDepot = depots.find((x) => x.id === d.depot_id);
        const location = registryDepot ? registryDepot.location : d.location;
        const hasLocation = (location ?? '').trim() !== '';
        return (
          <section key={d.depot_id} className={PANEL}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-[14px] font-extrabold text-[#142c1b]">{d.depot_name}</h4>
                {hasLocation ? (
                  <p className="text-[11.5px] text-slate-500">Leveransadress: {location}</p>
                ) : (
                  <p className="text-[11.5px] font-semibold text-rose-600">
                    Saknar Plats. Fyll i leveransadressen under Depåer och tryck Spara där, sedan Läs om här.
                  </p>
                )}
              </div>
              <label className="flex items-center gap-2">
                <span className="text-[11.5px] font-semibold text-slate-500">Leverans senast</span>
                <input
                  type="date"
                  value={d.requested_on}
                  min={today}
                  disabled={disabled}
                  onChange={(e) => setDepot(d.depot_id, { requested_on: e.target.value })}
                  className={cn(crm.input, 'w-auto tabular-nums')}
                  aria-label={`Leveransdatum ${d.depot_name}`}
                />
              </label>
            </div>

            <ul className="mt-3 grid gap-2">
              {d.rows.map((r) => {
                const note = palletNote(r.sacks, r.sacks_per_pallet);
                const reason = (note.kind === 'none' && REASON_TEXT(r)) || null;
                const f = r.forecast;
                return (
                  <li key={r.material} className="rounded-xl border border-[#eef3eb] bg-[#fbfcfa] px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-bold text-slate-800">{r.material}</div>
                        <div className="text-[11.5px] tabular-nums text-slate-500">
                          {f ? (
                            <>
                              saldo {f.opening}
                              {f.run_out_day && (
                                <>
                                  {' · tar slut '}
                                  <strong className="text-rose-600">{shortDayISO(f.run_out_day)}</strong>
                                </>
                              )}
                              {f.worst_deficit > 0 && <> · förslag {sacksText(f.suggested_sacks, r.sacks_per_pallet)}</>}
                              {f.on_order > 0 && f.next_arrival && <> · {f.on_order} säck på väg, väntas {shortDayISO(f.next_arrival)}</>}
                            </>
                          ) : (
                            'Inget behov i prognosen'
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {r.sacks_per_pallet && (
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => setRow(d.depot_id, r.material, { sacks: stepByPallet(r.sacks, r.sacks_per_pallet as number, -1) })}
                            className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce4d8] bg-white text-[16px] font-bold text-slate-600 transition hover:border-[#c8d4c3] disabled:opacity-50"
                            aria-label={`En pall mindre ${r.material}`}
                          >
                            −
                          </button>
                        )}
                        <input
                          inputMode="numeric"
                          value={r.sacks}
                          disabled={disabled}
                          onChange={(e) => setRow(d.depot_id, r.material, { sacks: e.target.value })}
                          className={cn(crm.input, 'w-24 text-right tabular-nums')}
                          aria-label={`Säckar ${r.material} till ${d.depot_name}`}
                        />
                        {r.sacks_per_pallet && (
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => setRow(d.depot_id, r.material, { sacks: stepByPallet(r.sacks, r.sacks_per_pallet as number, 1) })}
                            className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce4d8] bg-white text-[16px] font-bold text-slate-600 transition hover:border-[#c8d4c3] disabled:opacity-50"
                            aria-label={`En pall till ${r.material}`}
                          >
                            +
                          </button>
                        )}
                        <span className="w-28 text-[11.5px] tabular-nums">
                          {note.kind === 'pallets' && <span className="text-slate-600">= {note.pallets} pall</span>}
                          {note.kind === 'not_whole' && <span className="font-semibold text-rose-600">inte hela pallar ({note.sacks_per_pallet}/pall)</span>}
                          {note.kind === 'unknown' && <span className="text-amber-700">säck, pallstorlek okänd</span>}
                          {note.kind === 'invalid' && <span className="font-semibold text-rose-600">ange ett heltal</span>}
                          {note.kind === 'none' && <span className="text-slate-400">beställs inte</span>}
                        </span>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => removeRow(d.depot_id, r.material)}
                          className="text-[11.5px] font-semibold text-slate-400 transition hover:text-rose-600 disabled:opacity-50"
                        >
                          Ta bort
                        </button>
                      </div>
                    </div>
                    {reason && <p className="mt-1.5 text-[11.5px] text-amber-700">{reason}</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <div className="rounded-2xl border border-dashed border-[#c6d3c0] bg-[#fbfdfa] p-3">
        <span className={LABEL}>Lägg till depå eller material</span>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <SelectMenu
            value={addDepotId}
            onChange={setAddDepotId}
            placeholder="Välj depå"
            aria-label="Depå att lägga till"
            className="min-h-9 py-0 text-[13px]"
            options={activeDepots.map((d) => ({ value: d.id, label: d.name }))}
          />
          <SelectMenu
            value={addMaterial}
            onChange={setAddMaterial}
            aria-label="Material att lägga till"
            className="min-h-9 py-0 text-[13px]"
            options={supplier.materials.map((m) => ({ value: m, label: m }))}
          />
          <button type="button" onClick={addRow} disabled={disabled || !addDepotId || !addMaterial} className={crm.ghostButton}>
            Lägg till
          </button>
        </div>
      </div>

      <div className={PANEL}>
        <h4 className="text-[13.5px] font-extrabold text-[#142c1b]">Övrigt på lasset</h4>
        <p className="mb-2.5 mt-0.5 text-[11.5px] text-slate-500">Följer med i mailet, till exempel tillbehör. Rör aldrig lagret.</p>
        <div className="grid gap-2">
          {value.other_lines.map((o, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto]">
              <input
                value={o.text}
                maxLength={OTHER_LINE_TEXT_MAX}
                disabled={disabled}
                onChange={(e) => setOther(i, { text: e.target.value })}
                placeholder="Vad ska med?"
                className={crm.input}
                aria-label="Övrigt på lasset"
              />
              <SelectMenu
                value={o.depot_id ?? ''}
                onChange={(v) => setOther(i, { depot_id: v || null })}
                aria-label="Till depå"
                className="min-h-9 py-0 text-[13px]"
                options={[{ value: '', label: 'Ingen särskild depå' }, ...activeDepots.map((d) => ({ value: d.id, label: d.name }))]}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...value, other_lines: value.other_lines.filter((_, j) => j !== i) })}
                className="px-1 text-[11.5px] font-semibold text-slate-400 transition hover:text-rose-600"
              >
                Ta bort
              </button>
            </div>
          ))}
        </div>
        {value.other_lines.length < OTHER_LINES_MAX && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...value, other_lines: [...value.other_lines, { text: '', depot_id: null }] })}
            className={cn(crm.ghostButton, 'mt-2')}
          >
            Lägg till rad
          </button>
        )}

        <span className={cn(LABEL, 'mt-4')}>Meddelande till fabriken</span>
        <textarea
          value={value.message}
          maxLength={ORDER_MESSAGE_MAX}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, message: e.target.value })}
          rows={3}
          placeholder="Valfritt, till exempel att chauffören ska ringa innan"
          className={TEXTAREA}
          aria-label="Meddelande till fabriken"
        />
      </div>

      {(problems.length > 0 || serverProblems.length > 0 || invalid.length > 0) && (
        <ul className="grid gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">
          {invalid.map((p) => (
            <li key={`inv-${p.depot_name}-${p.material}`}>
              {p.depot_name} · {p.material}: antalet måste vara ett heltal
            </li>
          ))}
          {[...new Set([...problems, ...serverProblems])].map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e0e8dc] bg-white px-4 py-3">
        <div className="text-[12.5px] tabular-nums text-slate-600">
          {totals.lines === 0 ? (
            <span className="text-slate-400">Fyll i antal på minst en rad</span>
          ) : (
            <>
              <strong className="text-slate-800">Totalt {totals.pallets !== null ? `${totals.pallets} pall · ` : ''}{totals.sacks} säck</strong>
              <span className="text-slate-400">
                {' '}
                · {totals.lines} {totals.lines === 1 ? 'rad' : 'rader'}
                {totals.pallets === null && ' · pallar okända för något material'}
              </span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">{footer(canReview)}</div>
      </div>
    </div>
  );
}

// ── En befintlig order ──────────────────────────────────────────────────────

function OrderDetail({
  orderId,
  initial,
  suppliers,
  depots,
  forecastRows,
  forecastError,
  today,
  onDirtyChange,
  onListChanged,
  onBoardChanged,
  onDiscarded,
}: {
  orderId: string;
  initial?: Review;
  suppliers: MaterialSupplier[];
  depots: OpsDepot[];
  forecastRows: DepotMaterialForecast[];
  forecastError: boolean;
  today: string;
  onDirtyChange: (dirty: boolean) => void;
  onListChanged: () => void;
  onBoardChanged: () => void;
  onDiscarded: (supplierId: string | null) => void;
}) {
  const [review, setReview] = useState<Review | null>(initial ?? null);
  const [deliveryState, setDeliveryState] = useState<OrderDeliveryState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await callApi(`${API}/${orderId}`);
      if (!r.ok) throw new Error(r.error || 'Kunde inte läsa beställningen');
      setReview({ order: r.data.order, warnings: r.data.warnings, fingerprint: r.data.warnings_fingerprint });
      setDeliveryState(r.data.delivery_state ?? null);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Kunde inte läsa beställningen');
    }
  }, [orderId]);

  useEffect(() => {
    if (!initial) load();
  }, [initial, load]);

  // Ett skickat eller avgjort läge är inte längre ett utkast — inget att tappa.
  useEffect(() => {
    if (review && review.order.status !== 'draft') onDirtyChange(false);
  }, [review, onDirtyChange]);

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] text-rose-700">
        <div className="font-semibold">Beställningen kunde inte läsas</div>
        {error}
        <button type="button" onClick={load} className={cn(crm.ghostButton, 'mt-2 block')}>
          Försök igen
        </button>
      </div>
    );
  }
  if (!review) return <div className="grid h-full place-items-center text-[12.5px] text-slate-400">Laddar…</div>;

  const order = review.order;
  const supplier = suppliers.find((s) => s.id === order.supplier_id) ?? null;
  const refresh = async () => {
    await load();
    onListChanged();
  };

  if (order.status === 'draft') {
    return (
      <DraftOrder
        review={review}
        supplier={supplier}
        depots={depots}
        forecastRows={forecastRows}
        forecastError={forecastError}
        today={today}
        onDirtyChange={onDirtyChange}
        onReviewed={(next) => {
          setReview(next);
          onListChanged();
        }}
        onRefresh={refresh}
        onSent={async () => {
          await refresh();
          onBoardChanged();
        }}
        onDiscarded={() => onDiscarded(order.supplier_id)}
      />
    );
  }
  if (order.status === 'sending') {
    return (
      <SendingOrder
        order={order}
        onRefresh={refresh}
        onSettled={async () => {
          await refresh();
          onBoardChanged();
        }}
      />
    );
  }
  return <SentOrder order={order} deliveryState={deliveryState} />;
}

// ── Utkast: rader + granskat mail + Skicka ──────────────────────────────────

function DraftOrder({
  review,
  supplier,
  depots,
  forecastRows,
  forecastError,
  today,
  onDirtyChange,
  onReviewed,
  onRefresh,
  onSent,
  onDiscarded,
}: {
  review: Review;
  supplier: MaterialSupplier | null;
  depots: OpsDepot[];
  forecastRows: DepotMaterialForecast[];
  forecastError: boolean;
  today: string;
  onDirtyChange: (dirty: boolean) => void;
  onReviewed: (next: Review) => void;
  onRefresh: () => Promise<void>;
  onSent: () => Promise<void>;
  onDiscarded: () => void;
}) {
  const toast = useToast();
  const { order, warnings, fingerprint } = review;
  const fromOrder = useCallback(
    (o: MaterialOrder): Draft => ({
      depots: composerFromOrder(o, { forecastRows, depots }),
      other_lines: o.other_lines.map((x) => ({ text: x.text, depot_id: x.depot_id })),
      message: o.message ?? '',
    }),
    [forecastRows, depots],
  );
  // Utkastet läses in EN gång per order (och igen när någon annan hunnit ändra det). En omladdad lista eller
  // prognos får inte kasta det som skrivs.
  const [draft, setDraft] = useState<Draft>(() => fromOrder(order));
  const [busy, setBusy] = useState(false);
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [testing, setTesting] = useState(false);

  // En ny revision som någon ANNAN sparat (upptäckt vid Skicka eller en omläsning): följ med, om det här utkastet
  // var orört. Annars stod den gamla versionen kvar som "ändrad", och nästa Granska igen hade skrivit tillbaka den
  // över kollegans granskade ändring (granskningsfynd). Egna ändringar lämnas — de är inte kollegans att kasta.
  const seenOrder = useRef(order);
  useEffect(() => {
    const prev = seenOrder.current;
    seenOrder.current = order;
    if (prev.revision !== order.revision && snapshotOf(draft) === storedDraftSnapshot(prev)) setDraft(fromOrder(order));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  const dirty = snapshotOf(draft) !== storedDraftSnapshot(order);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  // Ett nytt avtryck = andra varningar än de som kvitterades. Kvittensen gäller inte dem.
  useEffect(() => setAcknowledged(false), [fingerprint]);

  const reviewed = Boolean(order.email_subject && order.email_text);
  const needsAck = warnings.length > 0;
  const canSend = reviewed && !dirty && !busy && (!needsAck || acknowledged) && supplier !== null && supplier.active;

  async function saveReview() {
    setBusy(true);
    setServerProblems([]);
    try {
      const r = await callApi(`${API}/${order.id}`, {
        method: 'PATCH',
        body: { revision: order.revision, lines: composerLines(draft.depots), other_lines: draft.other_lines, message: draft.message.trim() || null },
      });
      if (r.ok) {
        onReviewed({ order: r.data.order, warnings: r.data.warnings, fingerprint: r.data.warnings_fingerprint });
        return;
      }
      if (r.code === 'material_order_revision_changed' && r.details?.order) {
        // Någon annan hann före. Visa deras version — att skriva över den tyst är precis vad revisionen finns mot.
        toast.error(r.error || 'Någon annan har ändrat beställningen');
        setDraft(fromOrder(r.details.order));
        await onRefresh();
        return;
      }
      if (Array.isArray(r.details?.problems)) setServerProblems(r.details.problems);
      toast.error(r.error || 'Kunde inte granska beställningen');
      if (r.code === 'material_order_not_draft') await onRefresh();
    } catch {
      toast.error('Kunde inte granska beställningen');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setConfirmSend(false);
    setBusy(true);
    try {
      const r = await callApi(`${API}/${order.id}/send`, {
        method: 'POST',
        body: { revision: order.revision, attempt: order.send_attempt, acknowledged_warnings: needsAck ? fingerprint : null },
      });
      if (r.status === 201 && r.ok) {
        toast.success(`Beställning #${r.data.order_no} skickad till ${order.supplier_name ?? 'fabriken'}`);
        if (r.data.missing > 0) toast.error(`${r.data.missing} rader kunde inte bli väntade leveranser (depån finns inte längre). Boka in dem under Lager.`);
        await onSent();
        return;
      }
      if (r.status === 202 && r.ok) {
        toast.error(r.data.message || 'Okänt om mailet gick fram');
        await onSent();
        return;
      }
      if (r.ok && r.data?.state === 'already_sent') {
        toast.success('Beställningen var redan skickad');
        await onSent();
        return;
      }
      if (r.code === 'material_order_acknowledge_warnings' && r.details) {
        toast.error('Varningarna har ändrats sedan granskningen. Titta på dem igen.');
        onReviewed({ order, warnings: r.details.warnings, fingerprint: r.details.warnings_fingerprint });
        return;
      }
      if (sendResponseUnclear(r)) {
        // En dödad funktion eller ett 5xx kan komma EFTER att Resend tagit emot mailet. Säg inte "misslyckades".
        toast.error('Oklart om beställningen gick iväg. Läser om den, tryck inte igen förrän läget syns.');
        await onSent();
        return;
      }
      toast.error(r.error || 'Kunde inte skicka beställningen');
      await onRefresh();
    } catch {
      // Svaret uteblev. Utskicket kan ha tagits — läs om, så visar sidan läget i stället för en knapp att trycka igen.
      toast.error('Svaret uteblev. Läser om beställningen, tryck inte igen förrän läget syns.');
      await onRefresh();
    } finally {
      setAcknowledged(false);
      setBusy(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const r = await callApi(`${API}/${order.id}/test-mail`, { method: 'POST' });
      if (!r.ok) return toast.error(r.error || 'Kunde inte skicka testmailet');
      toast.success(`Testmail skickat till ${r.data.sent_to}`);
    } catch {
      toast.error('Kunde inte skicka testmailet');
    } finally {
      setTesting(false);
    }
  }

  async function discard() {
    setConfirmDiscard(false);
    setBusy(true);
    try {
      const r = await callApi(`${API}/${order.id}`, { method: 'DELETE' });
      if (!r.ok) {
        toast.error(r.error || 'Kunde inte slänga utkastet');
        await onRefresh();
        return;
      }
      toast.success(`Utkast #${order.order_no} slängt`);
      onDiscarded();
    } catch {
      toast.error('Kunde inte slänga utkastet');
    } finally {
      setBusy(false);
    }
  }

  const badge = <Chip tone="border-slate-200 bg-slate-50 text-slate-600">Utkast #{order.order_no}</Chip>;

  return (
    <div className="grid max-w-[1600px] items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="min-w-0">
        {supplier ? (
          <SupplierHeader supplier={supplier} badge={badge} />
        ) : (
          <div className="mb-3.5">
            <div className="flex items-center gap-2">
              <h3 className="text-[18px] font-extrabold text-[#142c1b]">{order.supplier_name ?? 'Leverantör borttagen'}</h3>
              {badge}
            </div>
            <p className="mt-1 text-[11.5px] font-semibold text-rose-600">
              {order.supplier_id === null
                ? 'Leverantören är borttagen. Utkastet kan bara slängas.'
                : 'Leverantören hittades inte i registret. Tryck Läs om, eller stäng och öppna Administrera igen.'}
            </p>
          </div>
        )}
        {order.created_by_name && <p className="-mt-2.5 mb-3 text-[11.5px] text-slate-400">Påbörjat av {order.created_by_name}</p>}

        {supplier ? (
          <Composer
            supplier={supplier}
            depots={depots}
            forecastRows={forecastRows}
            forecastError={forecastError}
            today={today}
            value={draft}
            onChange={setDraft}
            disabled={busy}
            serverProblems={serverProblems}
            footer={(canReview) => (
              <>
                <button type="button" onClick={() => setConfirmDiscard(true)} disabled={busy} className={crm.dangerButton}>
                  Släng utkast
                </button>
                {/* Aktiv även utan ändringar: servern kan säga "granska igen" när en depås Plats, fabrikens adress
                    eller mallen ändrats sedan granskningen, och då ska mailet gå att bygga om utan att röra en rad.
                    Oförändrat underlag skrivs inte (updateDraft), men varningarna läses om. */}
                <button
                  type="button"
                  onClick={saveReview}
                  disabled={busy || !canReview}
                  className={crm.formButton}
                  style={{ backgroundColor: 'var(--crm-primary)' }}
                >
                  {busy ? 'Arbetar…' : 'Granska igen'}
                </button>
              </>
            )}
          />
        ) : (
          <button type="button" onClick={() => setConfirmDiscard(true)} disabled={busy} className={crm.dangerButton}>
            Släng utkast
          </button>
        )}
      </div>

      <div className="grid min-w-0 gap-3 2xl:sticky 2xl:top-0">
        {draftErrorKind(order) === 'rejected' && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">
            <div className="font-semibold">Förra försöket avvisades. Inget skickades.</div>
            {order.send_error}
          </div>
        )}
        {draftErrorKind(order) === 'not_delivered' && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">
            <div className="font-semibold">Förra utskicket gick inte fram, enligt kopian i order@. Beställningen kan skickas igen.</div>
            Felet då: {order.send_error}
          </div>
        )}

        <div className="relative">
          <MailSheet order={order} />
          {dirty && (
            // Mailet till höger är det GRANSKADE. Med ändringar i raderna är det inte längre det som skulle gå.
            <div className="absolute inset-0 grid place-items-center rounded-2xl bg-white/80 p-6 text-center backdrop-blur-[1px]">
              <div>
                <div className="text-[13.5px] font-extrabold text-[#142c1b]">Du har ändrat beställningen</div>
                <p className="mt-1 text-[12px] text-slate-500">Tryck Granska igen så visas mailet som faktiskt går.</p>
              </div>
            </div>
          )}
        </div>

        <div className={PANEL}>
          {needsAck ? (
            <>
              <h4 className="text-[13.5px] font-extrabold text-amber-800">Se över innan du skickar</h4>
              <ul className="mt-2 grid gap-1.5">
                {warnings.map((w, i) => (
                  <li key={i} className="flex gap-2 text-[12px] leading-snug text-amber-800">
                    <span aria-hidden className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    {w.text}
                  </li>
                ))}
              </ul>
              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={busy || dirty}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#1a3f26]"
                />
                Jag har sett varningarna och vill skicka ändå
              </label>
            </>
          ) : (
            <p className="text-[12px] font-semibold text-emerald-700">Inga varningar.</p>
          )}

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button type="button" onClick={sendTest} disabled={testing || busy || dirty || !reviewed} className={crm.ghostButton}>
              {testing ? 'Skickar…' : 'Skicka test till mig'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmSend(true)}
              disabled={!canSend}
              className={cn(crm.formButton, 'ml-auto')}
              style={{ backgroundColor: 'var(--crm-primary)' }}
            >
              {busy ? 'Arbetar…' : `Skicka till ${order.supplier_name ?? 'fabriken'}`}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Testmailet är det granskade mailet, till din egen adress. När beställningen skickas blir raderna väntade leveranser på
            veckotavlan.
          </p>
        </div>
      </div>

      {confirmSend && (
        <CrmConfirmDialog
          title={`Skicka beställning #${order.order_no}?`}
          message={`Mailet går till ${order.recipient_email ?? 'fabriken'} med kopia till ${order.bcc ?? 'order@'}. Det går inte att ta tillbaka.`}
          confirmLabel="Skicka"
          focusCancel
          onCancel={() => setConfirmSend(false)}
          onConfirm={send}
        />
      )}
      {confirmDiscard && (
        <CrmConfirmDialog
          title={`Släng utkast #${order.order_no}?`}
          message="Raderna och meddelandet försvinner. Inget har skickats till fabriken."
          confirmLabel="Släng utkast"
          tone="danger"
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={discard}
        />
      )}
    </div>
  );
}

/** Mailet som det är lagrat — det som skickas, byte för byte. */
function MailSheet({ order }: { order: MaterialOrder }) {
  if (!order.email_subject || !order.email_text) {
    return (
      <div className="rounded-2xl border border-dashed border-[#d5dfd0] bg-white p-5 text-[12.5px] text-slate-500">
        Mailet visas när beställningen är granskad.
      </div>
    );
  }
  const header: [string, string | null][] = [
    ['Till', order.recipient_email],
    ['Från', order.from_address],
    ['Svar till', order.reply_to],
    ['Kopia', order.bcc],
  ];
  return (
    <article className="overflow-hidden rounded-2xl border border-[#dfe6da] bg-white shadow-[0_1px_0_rgba(20,44,27,0.04)]">
      <div className="border-b border-[#eef3eb] bg-[#fbfcfa] px-5 py-3">
        <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px]">
          {header.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-400">{k}</dt>
              <dd className="truncate text-slate-700">{v ?? '—'}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-2.5 text-[14px] font-bold leading-snug text-[#142c1b]">{order.email_subject}</div>
      </div>
      <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words px-5 py-4 text-[13px] leading-relaxed text-slate-800">
        {order.email_text}
      </div>
    </article>
  );
}

// ── Oklart utskick ──────────────────────────────────────────────────────────

function SendingOrder({ order, onRefresh, onSettled }: { order: MaterialOrder; onRefresh: () => Promise<void>; onSettled: () => Promise<void> }) {
  const toast = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'delivered' | 'not_delivered' | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const phase = sendingPhase(order, now);

  async function retry() {
    setBusy(true);
    try {
      // Samma försök och samma revision: Resend känner igen nyckeln och skickar inte mailet en gång till.
      const r = await callApi(`${API}/${order.id}/send`, {
        method: 'POST',
        body: { revision: order.revision, attempt: order.send_attempt, acknowledged_warnings: null },
      });
      if (r.status === 201 && r.ok) {
        toast.success(`Beställning #${r.data.order_no} registrerad som skickad`);
        await onSettled();
      } else if (r.status === 202 && r.ok) {
        toast.error(r.data.message || 'Fortfarande okänt om mailet gick fram');
        await onRefresh();
      } else if (r.ok && r.data?.state === 'already_sent') {
        toast.success('Beställningen var redan skickad');
        await onSettled();
      } else if (sendResponseUnclear(r)) {
        toast.error('Fortfarande oklart om mailet gick fram. Läser om beställningen.');
        await onSettled();
      } else {
        toast.error(r.error || 'Kunde inte försöka igen');
        await onRefresh();
      }
    } catch {
      toast.error('Svaret uteblev. Läser om beställningen.');
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function resolve(delivered: boolean) {
    setConfirm(null);
    setBusy(true);
    try {
      const r = await callApi(`${API}/${order.id}/resolve`, { method: 'POST', body: { delivered } });
      if (!r.ok) {
        toast.error(r.error || 'Kunde inte spara beskedet');
        await onRefresh();
        return;
      }
      toast.success(delivered ? 'Beställningen registrerad som skickad' : 'Beställningen är ett utkast igen');
      await onSettled();
    } catch {
      toast.error('Kunde inte spara beskedet');
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid max-w-[1600px] items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="grid min-w-0 gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[18px] font-extrabold tracking-tight text-[#142c1b]">
              #{order.order_no} · {order.supplier_name ?? 'Leverantör borttagen'}
            </h3>
            {orderChip({ status: order.status, delivery_state: null, send_error: order.send_error, send_error_code: order.send_error_code })}
          </div>
          <p className="mt-0.5 text-[12px] text-slate-500">Utskick påbörjat {stamp(order.attempt_started_at)}</p>
        </div>

        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <h4 className="text-[14px] font-extrabold text-amber-900">Okänt om mailet gick fram</h4>
          <p className="mt-1 text-[12.5px] leading-relaxed text-amber-900/80">
            Utskicket fick inget klart svar, så mailet kan ha gått fram. Beställningen står kvar tills det är avgjort, och ingen ny beställning till
            fabriken kan göras under tiden.
          </p>
          {order.send_error && <p className="mt-1.5 text-[11.5px] text-amber-800">Senaste felet: {order.send_error}</p>}

          {phase.kind !== 'resolve' ? (
            <>
              <p className="mt-3 text-[12px] font-semibold text-amber-900">
                Försök igen skickar samma mail. Fabriken får det högst en gång, även om det redan gick fram.
              </p>
              <button
                type="button"
                onClick={retry}
                disabled={busy || phase.kind === 'wait'}
                className={cn(crm.formButton, 'mt-2.5')}
                style={{ backgroundColor: 'var(--crm-primary)' }}
              >
                {busy
                  ? 'Försöker…'
                  : phase.kind === 'wait'
                    ? `Försök igen om ${Math.floor(phase.seconds / 60)}:${String(phase.seconds % 60).padStart(2, '0')}`
                    : 'Försök igen'}
              </button>
            </>
          ) : (
            <>
              <p className="mt-3 text-[12px] font-semibold text-amber-900">
                Mer än 23 timmar har gått. Titta i kopian i {order.bcc ?? 'order@ekovilla.se'}: finns beställning #{order.order_no} där?
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" onClick={() => setConfirm('delivered')} disabled={busy} className={crm.formButton} style={{ backgroundColor: 'var(--crm-primary)' }}>
                  Ja, mailet gick fram
                </button>
                <button type="button" onClick={() => setConfirm('not_delivered')} disabled={busy} className={crm.ghostButton}>
                  Nej, det gick inte fram
                </button>
              </div>
            </>
          )}
        </div>
        <OrderLinesSummary order={order} />
      </div>
      <div className="min-w-0">
        <MailSheet order={order} />
      </div>

      {confirm === 'delivered' && (
        <CrmConfirmDialog
          title="Mailet gick fram?"
          message="Beställningen registreras som skickad och raderna blir väntade leveranser på veckotavlan."
          confirmLabel="Ja, det gick fram"
          onCancel={() => setConfirm(null)}
          onConfirm={() => resolve(true)}
        />
      )}
      {confirm === 'not_delivered' && (
        <CrmConfirmDialog
          title="Mailet gick inte fram?"
          message="Beställningen blir ett utkast igen och kan skickas på nytt. Säg bara det om mailet inte finns i kopian, annars får fabriken två."
          confirmLabel="Det gick inte fram"
          tone="danger"
          onCancel={() => setConfirm(null)}
          onConfirm={() => resolve(false)}
        />
      )}
    </div>
  );
}

// ── Skickad ─────────────────────────────────────────────────────────────────

function SentOrder({ order, deliveryState }: { order: MaterialOrder; deliveryState: OrderDeliveryState | null }) {
  return (
    <div className="grid max-w-[1600px] items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="grid min-w-0 gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[18px] font-extrabold tracking-tight text-[#142c1b]">
              #{order.order_no} · {order.supplier_name ?? 'Leverantör borttagen'}
            </h3>
            {orderChip({ status: 'sent', delivery_state: deliveryState, send_error: null, send_error_code: null })}
          </div>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Skickad {stamp(order.sent_at)}
            {order.sent_by_name && ` av ${order.sent_by_name}`}
            {order.verified_by_name && ` · registrerad som skickad av ${order.verified_by_name} efter ett oklart utskick`}
          </p>
        </div>
        <OrderLinesSummary order={order} />
        <p className="px-1 text-[11.5px] text-slate-500">
          Ankomsten bekräftas på veckotavlan. Svarar fabriken med ett annat datum eller antal ändrar du det under Lager → Väntade leveranser.
        </p>
      </div>
      <div className="min-w-0">
        <MailSheet order={order} />
      </div>
    </div>
  );
}

function OrderLinesSummary({ order }: { order: MaterialOrder }) {
  const groups = composerFromOrder(order, { forecastRows: [], depots: [] });
  return (
    <div className={PANEL}>
      <h4 className="text-[13.5px] font-extrabold text-[#142c1b]">Beställt</h4>
      <div className="mt-2 grid gap-2.5">
        {groups.map((g) => (
          <div key={g.depot_id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-bold text-slate-800">{g.depot_name}</span>
              <span className="text-[11.5px] tabular-nums text-slate-500">senast {shortDayISO(g.requested_on)}</span>
            </div>
            <ul className="mt-0.5 grid gap-0.5">
              {g.rows.map((r) => (
                <li key={r.material} className="flex justify-between gap-3 text-[12px] tabular-nums text-slate-600">
                  <span>{r.material}</span>
                  <span>{sacksText(Number(r.sacks), r.sacks_per_pallet)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {order.other_lines.length > 0 && (
          <div>
            <span className="text-[12.5px] font-bold text-slate-800">Övrigt på lasset</span>
            <ul className="mt-0.5 grid gap-0.5">
              {order.other_lines.map((o, i) => (
                <li key={i} className="text-[12px] text-slate-600">
                  {o.text}
                  {o.depot_name && <span className="text-slate-400"> · {o.depot_name}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {order.message && <p className="text-[12px] italic text-slate-500">”{order.message}”</p>}
      </div>
    </div>
  );
}

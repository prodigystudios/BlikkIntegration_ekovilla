import type { SupabaseClient } from '@supabase/supabase-js';
import {
  STORE_ORDER_STATUSES,
  STORE_ORDER_VAT_PERCENT,
  storeOrderLineTotal,
  storeOrderLinesTotal,
  type StoreOrderBody,
  type StoreOrderStatus,
} from './storeOrders';

/**
 * Butiksbeställningarna som sidorna visar dem (RESELLER_PORTAL_CRM_PLAN.md fas 8): listan och en beställning.
 *
 * SESSIONSKLIENTEN: RLS släpper den som har crm.access (samma nyckel som CRM:et och sidorna), och sessionen läser bara
 * visningskolumnerna (kolumngrant). Första kroppen, notisens lån och utskickets bokföring ser den aldrig.
 * Tiderna formateras på servern i svensk tid, så att servern och webbläsaren skriver samma sträng.
 */

const LIST_SELECT =
  'id, order_number, store_name, status, payload, store_version, received_at, changed_at, withdrawn_at, confirmed_at, fortnox_order_number';

const DETAIL_SELECT = `id, order_id, order_number, reseller_id, store_name, customer_id, assigned_to, assigned_to_name,
  assignment_source, status, payload, store_version, portal_updated_at, received_at, changed_at, withdrawn_at,
  freight_mode, freight_price, freight_set_by_name, freight_set_at, confirmed_at, confirmed_by_name, fortnox_order_number,
  fortnox_order_sync_status, fortnox_error, delivered_on, delivered_by_name, fortnox_invoice_number, invoiced_on,
  invoiced_by_name, cancelled_at, cancelled_by_name, cancel_reason`;

/** Så många av de senaste som listan läser. PostgREST kapar vid 1000; sidan säger till när gränsen nås. */
export const STORE_ORDER_LIST_LIMIT = 500;

const stockholm = (iso: string) =>
  new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' });

const isStatus = (value: unknown): value is StoreOrderStatus => STORE_ORDER_STATUSES.includes(value as StoreOrderStatus);

export type StoreOrderListItem = {
  id: string;
  orderNumber: string;
  storeName: string;
  status: StoreOrderStatus;
  lineCount: number;
  /** Butikens rader, exkl. moms och frakt. */
  linesTotal: number;
  desiredPeriod: string;
  receivedLabel: string;
  /** Butiken har ändrat beställningen efter att den kom. */
  changed: boolean;
  fortnoxOrderNumber: string | null;
};

type ListRow = {
  id: string;
  order_number: string;
  store_name: string;
  status: string;
  payload: StoreOrderBody;
  store_version: number;
  received_at: string;
  fortnox_order_number: string | null;
};

export async function listStoreOrderViews(session: SupabaseClient): Promise<{ orders: StoreOrderListItem[]; capped: boolean }> {
  const { data, error } = await session
    .from('crm_store_orders')
    .select(LIST_SELECT)
    .order('received_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(STORE_ORDER_LIST_LIMIT);
  if (error) throw new Error(`Beställningarna gick inte att läsa: ${error.message}`);
  const rows = (data ?? []) as ListRow[];
  return {
    capped: rows.length >= STORE_ORDER_LIST_LIMIT,
    orders: rows.filter((row) => isStatus(row.status)).map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      storeName: row.store_name,
      status: row.status as StoreOrderStatus,
      lineCount: row.payload.lines.length,
      linesTotal: storeOrderLinesTotal(row.payload.lines),
      desiredPeriod: row.payload.delivery.desiredPeriod,
      receivedLabel: stockholm(row.received_at),
      changed: row.store_version > 1,
      fortnoxOrderNumber: row.fortnox_order_number,
    })),
  };
}

export type StoreOrderViewLine = {
  articleNumber: string;
  name: string;
  unit: string;
  quantity: number;
  unitCost: number;
  total: number;
};

export type StoreOrderEvent = { label: string; at: string; by: string | null };

export type StoreOrderView = {
  id: string;
  orderId: string;
  orderNumber: string;
  storeName: string;
  status: StoreOrderStatus;
  assignedToName: string | null;
  lines: StoreOrderViewLine[];
  linesTotal: number;
  vatPercent: number;
  delivery: StoreOrderBody['delivery'];
  /** Butikens eget kundnummer hos Ekovilla, som portalen skickade. */
  customerNumber: string | null;
  customerLinked: boolean;
  storeVersion: number;
  /** Ekovillas frakt: null = inte beslutad än. */
  freight: { mode: 'none' } | { mode: 'charged'; price: number } | null;
  fortnoxOrderNumber: string | null;
  cancelReason: string | null;
  events: StoreOrderEvent[];
};

type DetailRow = ListRow & {
  order_id: string;
  customer_id: string | null;
  assigned_to_name: string | null;
  freight_mode: 'none' | 'charged' | null;
  freight_price: number | string | null;
  changed_at: string | null;
  withdrawn_at: string | null;
  confirmed_at: string | null;
  confirmed_by_name: string | null;
  delivered_on: string | null;
  delivered_by_name: string | null;
  invoiced_on: string | null;
  invoiced_by_name: string | null;
  fortnox_invoice_number: string | null;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  cancel_reason: string | null;
};

/**
 * Beställningens händelser, i den ordning de kan hända: ändringar och tillbakadragning bara före bekräftelsen, leverans
 * efter den, fakturan efter leveransen och makuleringen före leveransen. Ordningen följer alltså av statusflödet (vakten
 * i databasen), och inga tider jämförs: en leveransdag hade annars sorterats före en bekräftelse samma dag.
 */
function storeOrderEvents(row: DetailRow): StoreOrderEvent[] {
  const events: StoreOrderEvent[] = [{ label: 'Mottagen från butiken', at: stockholm(row.received_at), by: null }];
  if (row.changed_at) {
    const times = row.store_version - 1;
    events.push({
      label: times === 1 ? 'Ändrad av butiken' : `Ändrad av butiken ${times} gånger, senast`,
      at: stockholm(row.changed_at),
      by: null,
    });
  }
  if (row.withdrawn_at) events.push({ label: 'Tillbakadragen av butiken', at: stockholm(row.withdrawn_at), by: null });
  if (row.confirmed_at) events.push({ label: 'Bekräftad', at: stockholm(row.confirmed_at), by: row.confirmed_by_name });
  if (row.delivered_on) events.push({ label: 'Levererad', at: row.delivered_on, by: row.delivered_by_name });
  if (row.invoiced_on) events.push({ label: 'Fakturerad', at: row.invoiced_on, by: row.invoiced_by_name });
  if (row.cancelled_at) events.push({ label: 'Makulerad', at: stockholm(row.cancelled_at), by: row.cancelled_by_name });
  return events;
}

/** En beställning, eller null när sessionen inte ser någon med det id:t. */
export async function getStoreOrderView(session: SupabaseClient, id: string): Promise<StoreOrderView | null> {
  const { data, error } = await session.from('crm_store_orders').select(DETAIL_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(`Beställningen gick inte att läsa: ${error.message}`);
  const row = data as DetailRow | null;
  if (!row || !isStatus(row.status)) return null;
  const body = row.payload;
  return {
    id: row.id,
    orderId: row.order_id,
    orderNumber: row.order_number,
    storeName: row.store_name,
    status: row.status,
    assignedToName: row.assigned_to_name,
    lines: body.lines.map((line) => ({
      articleNumber: line.articleNumber,
      name: line.name,
      unit: line.unit,
      quantity: line.quantity,
      unitCost: line.unitCost,
      total: storeOrderLineTotal(line),
    })),
    linesTotal: storeOrderLinesTotal(body.lines),
    vatPercent: STORE_ORDER_VAT_PERCENT,
    delivery: body.delivery,
    customerNumber: body.store.ekovillaCustomerNumber,
    customerLinked: row.customer_id !== null,
    storeVersion: row.store_version,
    // numeric kommer som sträng från PostgREST.
    freight:
      row.freight_mode === 'none'
        ? { mode: 'none' }
        : row.freight_mode === 'charged'
          ? { mode: 'charged', price: Number(row.freight_price) }
          : null,
    fortnoxOrderNumber: row.fortnox_order_number,
    cancelReason: row.cancel_reason,
    events: storeOrderEvents(row),
  };
}

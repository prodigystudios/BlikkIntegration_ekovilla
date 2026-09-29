import type { SupabaseClient } from '@supabase/supabase-js';
import { getCrmCustomerDisplayName, type CrmCustomerType } from '@/lib/domains/crm/customers';
import {
  STORE_ORDER_LIST_LIMIT,
  STORE_ORDER_STATUSES,
  STORE_ORDER_VAT_PERCENT,
  storeOrderLineTotal,
  storeOrderLinesTotal,
  storeOrderTotals,
  type StoreOrderBody,
  type StoreOrderFreight,
  type StoreOrderStatus,
  type StoreOrderTotals,
} from './storeOrders';

/**
 * Butiksbeställningarna som sidorna visar dem (RESELLER_PORTAL_CRM_PLAN.md fas 8): listan och en beställning.
 *
 * SESSIONSKLIENTEN: RLS släpper den som har crm.access (samma nyckel som CRM:et och sidorna), och sessionen läser bara
 * visningskolumnerna (kolumngrant). Första kroppen, notisens lån och utskickets bokföring ser den aldrig.
 * Tiderna formateras på servern i svensk tid, så att servern och webbläsaren skriver samma sträng.
 */

// Bara det listan visar: raderna (antal och summa) och önskad leverans ur kroppen, inte meddelandet eller leveransen.
const LIST_SELECT =
  'id, order_number, store_name, status, store_version, received_at, lines:payload->lines, desired_period:payload->delivery->>desiredPeriod';
/** PostgREST kapar vid 1000 rader: de pågående läses sida för sida. */
const PAGE = 1000;

const DETAIL_SELECT = `id, order_number, store_name, customer_id, assigned_to_name, status, payload, store_version,
  received_at, changed_at, withdrawn_at, freight_mode, freight_price, confirmed_at, confirmed_by_name, fortnox_order_number,
  delivered_on, delivered_by_name, invoiced_on, invoiced_by_name, cancelled_at, cancelled_by_name, cancel_reason,
  customer:crm_customers(customer_type, company_name, first_name, last_name, fortnox_customer_id)`;

const stockholm = (iso: string) =>
  new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' });
/** En svensk kalenderdag (`YYYY-MM-DD`), som "2 okt. 2026". Läses som UTC-midnatt, som i Stockholm är samma dag. */
const swedishDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium' });

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
};

type ListRow = {
  id: string;
  order_number: string;
  store_name: string;
  status: string;
  store_version: number;
  received_at: string;
  lines: StoreOrderBody['lines'];
  desired_period: string | null;
};

/** Pågående: något återstår för Ekovilla (bekräfta, leverera, fakturera). De läses alla, hur gamla de än är. */
const ACTIVE_STATUSES: StoreOrderStatus[] = ['received', 'confirmed', 'delivered'];

async function readActiveStoreOrders(session: SupabaseClient): Promise<ListRow[]> {
  const active: ListRow[] = [];
  for (let after: string | null = null; ; ) {
    let page = session.from('crm_store_orders').select(LIST_SELECT).in('status', ACTIVE_STATUSES);
    if (after) page = page.gt('id', after);
    const { data, error } = await page.order('id', { ascending: true }).limit(PAGE);
    if (error) throw new Error(`Beställningarna gick inte att läsa: ${error.message}`);
    const rows = (data ?? []) as ListRow[];
    active.push(...rows);
    if (rows.length < PAGE) return active;
    after = rows[rows.length - 1].id;
  }
}

/** De senast mottagna avslutade, och en till än gränsen: bara så syns det om något faktiskt föll bort. */
async function readClosedStoreOrders(session: SupabaseClient): Promise<ListRow[]> {
  const { data, error } = await session
    .from('crm_store_orders')
    .select(LIST_SELECT)
    .in('status', STORE_ORDER_STATUSES.filter((status) => !ACTIVE_STATUSES.includes(status)))
    .order('received_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(STORE_ORDER_LIST_LIMIT + 1);
  if (error) throw new Error(`Beställningarna gick inte att läsa: ${error.message}`);
  return (data ?? []) as ListRow[];
}

/**
 * Listan: ALLA pågående (att bekräfta, leverera och fakturera), så att ingen försvinner ur sitt urval hur många som än
 * kommit efter den, och de senaste av de avslutade (fakturerade, tillbakadragna, makulerade). `capped` säger att de
 * avslutade är fler än listan visar.
 *
 * De pågående läses sida för sida med nyckel (id), inte med förskjutning: en beställning som kommer eller byter status
 * medan sidorna läses hade annars gett en dubblett eller tappats. Ordningen sätts efteråt.
 */
export async function listStoreOrderViews(session: SupabaseClient): Promise<{ orders: StoreOrderListItem[]; capped: boolean }> {
  const [active, closedRows] = await Promise.all([readActiveStoreOrders(session), readClosedStoreOrders(session)]);
  const rest = closedRows.slice(0, STORE_ORDER_LIST_LIMIT);
  // En beställning som bytte status mellan läsningarna (levererad → fakturerad) kan finnas i båda: en gång räcker.
  const unique = new Map<string, ListRow>();
  for (const row of [...active, ...rest]) if (!unique.has(row.id)) unique.set(row.id, row);
  return {
    capped: closedRows.length > STORE_ORDER_LIST_LIMIT,
    orders: [...unique.values()]
      .filter((row) => isStatus(row.status))
      .sort((a, b) => (a.received_at < b.received_at ? 1 : a.received_at > b.received_at ? -1 : a.id < b.id ? -1 : 1))
      .map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        storeName: row.store_name,
        status: row.status as StoreOrderStatus,
        lineCount: row.lines.length,
        linesTotal: storeOrderLinesTotal(row.lines),
        desiredPeriod: row.desired_period ?? '',
        receivedLabel: stockholm(row.received_at),
        changed: row.store_version > 1,
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
  orderNumber: string;
  storeName: string;
  status: StoreOrderStatus;
  assignedToName: string | null;
  lines: StoreOrderViewLine[];
  /** Raderna, frakten och momsen (`storeOrderTotals`): räknade en gång, här. */
  totals: StoreOrderTotals;
  vatPercent: number;
  /**
   * Frakten ska beslutas innan beställningen kan bekräftas: den är mottagen och frakten är inte satt. En tillbakadragen
   * eller makulerad utan frakt får ingen, och ingen moms, så sidan lovar inga.
   */
  freightPending: boolean;
  delivery: StoreOrderBody['delivery'];
  /** Butikens kundnummer hos Ekovilla, som portalen skickade i den senaste versionen. */
  customerNumber: string | null;
  customerLinked: boolean;
  /**
   * Kundkortet beställningen är kopplad till, som sessionen ser det (kortets egen läspolicy): namnet och Fortnox-numret.
   * null när ingen kund är kopplad, eller när kortet inte syns. Det är det här kortet som blir Fortnox-ordern (8b), och
   * det kan skilja från portalens nummer: en kund som redan står på beställningen byts aldrig av butiken.
   */
  customer: { name: string; fortnoxCustomerNumber: string | null } | null;
  /** Senaste ändringen från butiken och tillbakadragningen, i svensk tid; null när de inte hänt. */
  changedAtLabel: string | null;
  withdrawnAtLabel: string | null;
  /** Ekovillas frakt: null = inte beslutad än. */
  freight: StoreOrderFreight;
  fortnoxOrderNumber: string | null;
  cancelReason: string | null;
  events: StoreOrderEvent[];
};

type DetailRow = Omit<ListRow, 'lines' | 'desired_period'> & {
  payload: StoreOrderBody;
  fortnox_order_number: string | null;
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
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  cancel_reason: string | null;
  customer: {
    customer_type: CrmCustomerType;
    company_name: string | null;
    first_name: string | null;
    last_name: string | null;
    fortnox_customer_id: string | null;
  } | null;
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
  if (row.delivered_on) events.push({ label: 'Levererad', at: swedishDay(row.delivered_on), by: row.delivered_by_name });
  if (row.invoiced_on) events.push({ label: 'Fakturerad', at: swedishDay(row.invoiced_on), by: row.invoiced_by_name });
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
  const freight: StoreOrderFreight =
    // numeric kommer som sträng från PostgREST.
    row.freight_mode === 'none'
      ? { mode: 'none' }
      : row.freight_mode === 'charged'
        ? { mode: 'charged', price: Number(row.freight_price) }
        : null;
  return {
    id: row.id,
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
    totals: storeOrderTotals(body.lines, freight, STORE_ORDER_VAT_PERCENT),
    vatPercent: STORE_ORDER_VAT_PERCENT,
    freightPending: freight === null && row.status === 'received',
    delivery: body.delivery,
    customerNumber: body.store.ekovillaCustomerNumber,
    customerLinked: row.customer_id !== null,
    customer: row.customer
      ? { name: getCrmCustomerDisplayName(row.customer), fortnoxCustomerNumber: row.customer.fortnox_customer_id }
      : null,
    changedAtLabel: row.changed_at ? stockholm(row.changed_at) : null,
    withdrawnAtLabel: row.withdrawn_at ? stockholm(row.withdrawn_at) : null,
    freight,
    fortnoxOrderNumber: row.fortnox_order_number,
    cancelReason: row.cancel_reason,
    events: storeOrderEvents(row),
  };
}

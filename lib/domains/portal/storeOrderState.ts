import type { ConfirmedDelivery } from './jobState';
import type { StoreOrderStatus } from './storeOrders';

/**
 * Vad butiken ska se av sin beställning, härlett ur crm_store_orders (RESELLER_PORTAL_CRM_PLAN.md fas 8b3, kontraktets
 * Flöde 3, "Status tillbaka"). Ren: utskicket läser raden och det senast köade läget, och köar det den här funktionen
 * säger.
 *
 * Kontraktets händelser, i den ordning butiken ser dem:
 *   store_order.confirmed   bekräftad OCH Fortnox-ordern finns: kontraktet kräver ekovillaOrderNumber (Fortnox-numret).
 *                           confirmedAt är när någon tryckte Bekräfta, inte när numret kom: då låstes beställningen, och
 *                           CRM:et svarar 409 på butikens ändringar sedan dess ("Låser beställningen" i kontraktet).
 *   store_order.delivered   deliveredAt = leveransdagen (svensk dag, som knappen sparade den).
 *   store_order.invoiced    invoicedAt = fakturadagen (svensk dag).
 *   store_order.cancelled   reason = skälet säljaren skrev. Portalen daterar makuleringen med occurredAt.
 *
 * 🧨 HÄNDELSEN BYGGS HELT UR RADEN. occurredAt är när CRM:et gjorde steget (confirmed_at, delivered_at, invoiced_at,
 * cancelled_at, som knapparna skriver), aldrig körningens tid. Vakten låter statusen bara gå framåt och skriver numret en
 * gång, så varje rad som databasen tar emot ger alltid samma nyckel och samma kropp: confirmed_at och cancelled_at krävs
 * av tabellens checkar, och en leverans eller faktura utan sin tid (bara en rad skriven för hand) dateras med dagens
 * början i UTC, aldrig med körningens tid. Därför kan utskicket köa FÖRST och spara läget sedan: en krasch mellan de två
 * ger samma händelser nästa varv, och kön känner igen nycklarna. Jobben (jobState.ts) behöver i stället
 * sync_pending_events, eftersom deras occurredAt är körningens tid.
 *
 * Reglerna, som jobbens (William 2026-09-28):
 *   - Inget efter "bekräftad" köas förrän den är LEVERERAD. En uppgiven händelse håller inte kvar resten av kön (fas 1b),
 *     och portalen räknar statusen ur datumen: en "levererad" utan "bekräftad" hade gett en levererad beställning utan
 *     Ekovillas ordernummer.
 *   - "Makulerad" behöver ingen bekräftelse, och efter den köas ingenting. En beställning som makulerades innan
 *     "bekräftad" köats får bara makuleringen, också när den hann få ett Fortnox-nummer: butiken såg den aldrig
 *     bekräftad.
 *   - Mottagen och tillbakadragen (butikens egen, som vakten också markerar) ger ingenting.
 *   - Bara bekräftelsen spärrar, som för jobben: ger en köad leverans upp (portalen nere i över två dygn) går en senare
 *     fakturering ändå fram, och butiken ser Fakturerad utan leveransdag.
 */

export type StoreOrderEventType =
  | 'store_order.confirmed'
  | 'store_order.delivered'
  | 'store_order.invoiced'
  | 'store_order.cancelled';

/** Det senast köade läget, som det sparas i crm_store_orders.sync_state. */
export type StoreOrderSyncState = {
  /** Idempotency-Key för den köade store_order.confirmed. Satt = bekräftad är köad. */
  confirmedKey?: string;
  delivered?: true;
  invoiced?: true;
  cancelled?: true;
};

export type StoreOrderEventPayload = {
  type: StoreOrderEventType;
  occurredAt: string;
  data: Record<string, string>;
};

export type StoreOrderEvent = {
  idempotencyKey: string;
  payload: StoreOrderEventPayload;
};

/** Raden, med de kolumner som avgör vad butiken ser. */
export type StoreOrderSyncRow = {
  status: StoreOrderStatus;
  fortnoxOrderNumber: string | null;
  confirmedAt: string | null;
  deliveredOn: string | null;
  deliveredAt: string | null;
  invoicedOn: string | null;
  invoicedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
};

export type DeriveStoreOrderInput = {
  /** Portalens orderId (crm_store_orders.order_id). */
  orderId: string;
  order: StoreOrderSyncRow;
  state: StoreOrderSyncState;
  /** Status i kön för den köade store_order.confirmed. */
  confirmedDelivery: ConfirmedDelivery;
  now: Date;
};

export type DeriveStoreOrderResult = {
  events: StoreOrderEvent[];
  state: StoreOrderSyncState;
  /** Räkna om beställningen igen utan en ny ändring: något väntar på att "bekräftad" levereras. */
  revisit: boolean;
};

/** Början av en butiksbeställnings kö i portal_outbound_events (`store_order:<orderId>`). */
export const STORE_ORDER_QUEUE_PREFIX = 'store_order:';

export function storeOrderOrderingKey(orderId: string): string {
  return `${STORE_ORDER_QUEUE_PREFIX}${orderId}`;
}

/**
 * Tiden i kontraktets form (…Z; databasen skriver +00:00). Saknas den tar en leverans eller faktura dagens början i UTC,
 * så att händelsen fortfarande byggs helt ur raden. Utan dag (bekräftad, makulerad: checkarna kräver tiden) körningens.
 */
function occurredAt(value: string | null, day: string | null, now: Date): string {
  const at = value ? new Date(value) : null;
  if (at && !Number.isNaN(at.getTime())) return at.toISOString();
  return day ? `${day}T00:00:00.000Z` : now.toISOString();
}

function event(
  type: StoreOrderEventType,
  orderId: string,
  occurredAt: string,
  data: Record<string, string>,
): StoreOrderEvent {
  return {
    // Kontraktets form: <event>-<id>-<tidpunkt>.
    idempotencyKey: `${type}-${orderId}-${occurredAt}`,
    payload: { type, occurredAt, data: { orderId, ...data } },
  };
}

export function deriveStoreOrderEvents(input: DeriveStoreOrderInput): DeriveStoreOrderResult {
  const { orderId, order, now } = input;
  const state: StoreOrderSyncState = { ...input.state };
  // Leveransen köas alltid före fakturan (i samma varv eller tidigare): ett läge med fakturan har också leveransen.
  if (state.invoiced) state.delivered = true;
  const events: StoreOrderEvent[] = [];
  const done = { events, state, revisit: false };

  if (state.cancelled) return done;

  if (order.status === 'cancelled') {
    events.push(event('store_order.cancelled', orderId, occurredAt(order.cancelledAt, null, now), { reason: order.cancelReason ?? '' }));
    state.cancelled = true;
    return done;
  }

  if (order.status !== 'confirmed' && order.status !== 'delivered' && order.status !== 'invoiced') return done;
  // Dagarna följer statusen (vaktens checkar), men en händelse utan dag skickas inte: portalen hade nekat den.
  const deliveredOn = order.status !== 'confirmed' ? order.deliveredOn : null;
  const invoicedOn = order.status === 'invoiced' && deliveredOn ? order.invoicedOn : null;

  if (!state.confirmedKey) {
    if (!order.fortnoxOrderNumber) return done;
    const confirmedAt = occurredAt(order.confirmedAt, null, now);
    const confirmed = event('store_order.confirmed', orderId, confirmedAt, {
      ekovillaOrderNumber: order.fortnoxOrderNumber,
      confirmedAt,
    });
    events.push(confirmed);
    state.confirmedKey = confirmed.idempotencyKey;
    // Resten får vänta tills den är levererad.
    return { ...done, revisit: Boolean(deliveredOn) };
  }

  const waiting = (deliveredOn && !state.delivered) || (invoicedOn && !state.invoiced);
  if (!waiting) return done;
  if (input.confirmedDelivery === 'pending') return { ...done, revisit: true };
  // Uppgiven (eller borta): beställningen står still tills någon skickar om den på portalsidan.
  if (input.confirmedDelivery !== 'sent') return done;

  if (deliveredOn && !state.delivered) {
    events.push(event('store_order.delivered', orderId, occurredAt(order.deliveredAt, deliveredOn, now), { deliveredAt: deliveredOn }));
    state.delivered = true;
  }
  if (invoicedOn && !state.invoiced) {
    events.push(event('store_order.invoiced', orderId, occurredAt(order.invoicedAt, invoicedOn, now), { invoicedAt: invoicedOn }));
    state.invoiced = true;
  }
  return done;
}

/** Läser sync_state ur databasen. Okända eller trasiga fält tas bort, så att härledningen alltid får rätt form. */
export function parseStoreOrderSyncState(raw: unknown): StoreOrderSyncState {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const state: StoreOrderSyncState = {};
  if (typeof src.confirmedKey === 'string' && src.confirmedKey) state.confirmedKey = src.confirmedKey;
  if (src.delivered === true) state.delivered = true;
  if (src.invoiced === true) state.invoiced = true;
  if (src.cancelled === true) state.cancelled = true;
  return state;
}

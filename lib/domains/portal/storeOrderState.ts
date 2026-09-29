import type { ConfirmedDelivery } from './jobState';

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
 * gång, så samma rad ger alltid samma nyckel och samma kropp. Därför kan utskicket köa FÖRST och spara läget sedan: en
 * krasch mellan de två ger samma händelser nästa varv, och kön känner igen nycklarna. Jobben (jobState.ts) behöver i
 * stället sync_pending_events, eftersom deras occurredAt är körningens tid. Bara en rad som saknar sin tid (skriven för
 * hand) får körningens tid.
 *
 * Reglerna, som jobbens (William 2026-09-28):
 *   - Inget efter "bekräftad" köas förrän den är LEVERERAD. En uppgiven händelse håller inte kvar resten av kön (fas 1b),
 *     och portalen räknar statusen ur datumen: en "levererad" utan "bekräftad" hade gett en levererad beställning utan
 *     Ekovillas ordernummer.
 *   - "Makulerad" behöver ingen bekräftelse, och efter den köas ingenting. En beställning som makulerades innan
 *     "bekräftad" köats får bara makuleringen, också när den hann få ett Fortnox-nummer: butiken såg den aldrig
 *     bekräftad.
 *   - Mottagen och tillbakadragen (butikens egen, som vakten också markerar) ger ingenting.
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
  status: string;
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

export function storeOrderOrderingKey(orderId: string): string {
  return `store_order:${orderId}`;
}

function isoOrNow(value: string | null, now: Date): string {
  const at = value ? new Date(value) : null;
  return at && !Number.isNaN(at.getTime()) ? at.toISOString() : now.toISOString();
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
  const events: StoreOrderEvent[] = [];
  const done = { events, state, revisit: false };

  if (state.cancelled) return done;

  if (order.status === 'cancelled') {
    events.push(event('store_order.cancelled', orderId, isoOrNow(order.cancelledAt, now), { reason: order.cancelReason ?? '' }));
    state.cancelled = true;
    return done;
  }

  if (order.status !== 'confirmed' && order.status !== 'delivered' && order.status !== 'invoiced') return done;
  // Dagarna följer statusen (vaktens checkar), men en händelse utan dag skickas inte: portalen hade nekat den.
  const delivered = order.status !== 'confirmed' && Boolean(order.deliveredOn);
  const invoiced = order.status === 'invoiced' && delivered && Boolean(order.invoicedOn);

  if (!state.confirmedKey) {
    if (!order.fortnoxOrderNumber) return done;
    const confirmedAt = isoOrNow(order.confirmedAt, now);
    const confirmed = event('store_order.confirmed', orderId, confirmedAt, {
      ekovillaOrderNumber: order.fortnoxOrderNumber,
      confirmedAt,
    });
    events.push(confirmed);
    state.confirmedKey = confirmed.idempotencyKey;
    // Resten får vänta tills den är levererad.
    return { ...done, revisit: delivered };
  }

  const waiting = (delivered && !state.delivered) || (invoiced && !state.invoiced);
  if (!waiting) return done;
  if (input.confirmedDelivery === 'pending') return { ...done, revisit: true };
  // Uppgiven (eller borta): beställningen står still tills någon skickar om den på portalsidan.
  if (input.confirmedDelivery !== 'sent') return done;

  if (!state.delivered) {
    events.push(event('store_order.delivered', orderId, isoOrNow(order.deliveredAt, now), { deliveredAt: order.deliveredOn as string }));
    state.delivered = true;
  }
  if (invoiced && !state.invoiced) {
    events.push(event('store_order.invoiced', orderId, isoOrNow(order.invoicedAt, now), { invoicedAt: order.invoicedOn as string }));
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

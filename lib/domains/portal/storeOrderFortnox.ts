import { buildOrderRows } from '@/lib/domains/fortnox/orders';
import { STORE_ORDER_VAT_PERCENT, type StoreOrderBody, type StoreOrderFreight, type StoreOrderStatus } from './storeOrders';

/**
 * Fortnox-ordern för en butiksbeställning (RESELLER_PORTAL_CRM_PLAN.md fas 8b, kontraktets "Flöde 3", väg B): ett eget
 * POST /orders med arbetsorderns radbyggare. Ren: databasstegen står i ./storeOrderActions.ts.
 *
 * Besluten (William 2026-09-29):
 *   - 25 % moms på raderna och frakten, och kontot efter momsen (`fortnoxSalesAccount`): butiken är slutkund.
 *   - Priset är butikens unitCost. Ekovilla lägger bara till frakten: artikel 1050 FRAKT, säljarens pris, antal 1.
 *
 * Fortnox gränser, uppmätta i testbolaget 2026-09-29:
 *   - `YourReference` över 50 tecken nekar hela ordern (2001600). Butikens mottagare får vara 200.
 *   - `YourOrderNumber` kapas tyst vid 30 tecken, leveransadressen vid 60 och en textrad vid 255.
 *   - `Comments` (intern, skrivs inte ut) tar 1024 tecken och behåller radbrytningar; över det nekas ordern (2001896).
 * Vi kapar själva, så att det som skickas är det som står i Fortnox, och det som inte ryms står i textraden.
 */

/** Fraktens artikel (William 2026-09-29). Finns i prod, inte i testbolaget. */
export const STORE_ORDER_FREIGHT_ARTICLE = '1050';

export const FORTNOX_YOUR_REFERENCE_MAX = 50;
export const FORTNOX_YOUR_ORDER_NUMBER_MAX = 30;
export const FORTNOX_TEXT_ROW_MAX = 255;
export const FORTNOX_COMMENTS_MAX = 1024;

/** Det ur artikelregistret raderna tar: benämningen och enhetskoden (portalen skickar enheten med gemener). */
export type StoreOrderRegisterArticle = { article_number: string; description: string | null; unit: string | null };

type OrderLineItems = NonNullable<Parameters<typeof buildOrderRows>[0]>;

const nonEmpty = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** Högst `max` tecken, utan mellanslag i slutet. */
const cap = (value: string, max: number) => value.trim().slice(0, max).trimEnd();

/**
 * Beställningens rader som arbetsorderns rader, så att `buildOrderRows` bygger dem som alla andra ordrar: butikens
 * rader med butikens pris, och frakten sist när den tas ut.
 */
export function storeOrderLineItems(
  body: Pick<StoreOrderBody, 'lines'>,
  freight: StoreOrderFreight,
  register: ReadonlyMap<string, StoreOrderRegisterArticle>,
): OrderLineItems {
  const items: OrderLineItems = body.lines.map((line) => {
    const article = register.get(line.articleNumber);
    return {
      pricing_mode: 'item',
      article_number: line.articleNumber,
      article_name: nonEmpty(article?.description) ?? line.name,
      article_unit_name: nonEmpty(article?.unit) ?? nonEmpty(line.unit),
      unit_price: String(line.unitCost),
      quantity: String(line.quantity),
      discount_percent: '',
      line_note: '',
      is_rot_work: false,
      labor_cost: '',
      written_off: false,
    };
  });
  if (freight?.mode === 'charged') {
    const article = register.get(STORE_ORDER_FREIGHT_ARTICLE);
    items.push({
      pricing_mode: 'item',
      article_number: STORE_ORDER_FREIGHT_ARTICLE,
      article_name: nonEmpty(article?.description) ?? 'Frakt',
      article_unit_name: nonEmpty(article?.unit),
      unit_price: String(freight.price),
      quantity: '1',
      discount_percent: '',
      line_note: '',
      is_rot_work: false,
      labor_cost: '',
      written_off: false,
    });
  }
  return items;
}

/**
 * Orderns textrad: vilken beställning det är, önskad leverans och mottagaren. Butikens referens står här också när den
 * är längre än "Ert ordernummer" rymmer. Fortnox tar bort radbrytningar i en rad, så delarna skiljs med två
 * mellanslag, som arbetsorderns textrad.
 */
export function storeOrderDocumentNote(body: Pick<StoreOrderBody, 'orderNumber' | 'delivery'>): string {
  const { delivery } = body;
  const recipient = [nonEmpty(delivery.contactName), nonEmpty(delivery.contactPhone)].filter(Boolean).join(' ');
  const reference = nonEmpty(delivery.reference);
  const parts = [
    `Butiksbeställning ${body.orderNumber.trim()}`,
    nonEmpty(delivery.desiredPeriod) ? `Leverans: ${delivery.desiredPeriod.trim()}` : null,
    recipient ? `Mottagare: ${recipient}` : null,
    reference && reference.length > FORTNOX_YOUR_ORDER_NUMBER_MAX ? `Butikens referens: ${reference}` : null,
  ];
  return cap(parts.filter(Boolean).join('  '), FORTNOX_TEXT_ROW_MAX);
}

const COMMENTS_CUT = ' … (hela meddelandet står i CRM:et)';

/** Butikens meddelande som orderns interna anteckning (skrivs inte ut), eller null när det saknas. */
export function storeOrderComments(body: Pick<StoreOrderBody, 'delivery'>): string | null {
  const message = nonEmpty(body.delivery.message);
  if (!message) return null;
  const text = `Meddelande från butiken: ${message}`;
  if (text.length <= FORTNOX_COMMENTS_MAX) return text;
  return `${cap(text, FORTNOX_COMMENTS_MAX - COMMENTS_CUT.length)}${COMMENTS_CUT}`;
}

export type StoreOrderFortnoxInput = {
  body: StoreOrderBody;
  freight: StoreOrderFreight;
  customerNumber: string;
  /** Kortets org.nr när det är giltigt (`documentOrganisationNumber`), annars null: Fortnox tar då kortets. */
  organisationNumber: string | null;
  /** Den ansvariges namn. */
  ourReference: string | null;
  register: ReadonlyMap<string, StoreOrderRegisterArticle>;
  /** Svensk kalenderdag. */
  orderDate: string;
};

/**
 * Kroppen till POST /orders. Leveransen går till butiken: adressen, mottagaren som Er referens och butikens referens
 * som Ert ordernummer (kontraktet). Ingen VATType: Fortnox nekar den, och raderna bär momsen och kontot.
 */
export function buildStoreOrderFortnoxOrder(input: StoreOrderFortnoxInput) {
  const { body } = input;
  const { delivery } = body;
  const rows = buildOrderRows(
    storeOrderLineItems(body, input.freight, input.register),
    STORE_ORDER_VAT_PERCENT,
    false,
    false,
    storeOrderDocumentNote(body),
  );
  const yourReference = nonEmpty(delivery.contactName);
  const yourOrderNumber = nonEmpty(delivery.reference);
  const ourReference = nonEmpty(input.ourReference);
  const comments = storeOrderComments(body);
  return {
    Order: {
      CustomerNumber: input.customerNumber,
      OrderDate: input.orderDate,
      ...(input.organisationNumber ? { OrganisationNumber: input.organisationNumber } : {}),
      ...(ourReference ? { OurReference: cap(ourReference, FORTNOX_YOUR_REFERENCE_MAX) } : {}),
      ...(yourReference ? { YourReference: cap(yourReference, FORTNOX_YOUR_REFERENCE_MAX) } : {}),
      ...(yourOrderNumber ? { YourOrderNumber: cap(yourOrderNumber, FORTNOX_YOUR_ORDER_NUMBER_MAX) } : {}),
      DeliveryAddress1: delivery.address.street.trim(),
      DeliveryZipCode: delivery.address.postalCode.trim(),
      DeliveryCity: delivery.address.city.trim(),
      ...(comments ? { Comments: comments } : {}),
      OrderRows: rows,
    },
  };
}

// ------------------------------------------------------------------------------------------------------ bekräftelsen

export type StoreOrderConfirmBlocker =
  /** Inte mottagen längre: bekräftad, tillbakadragen eller makulerad. */
  | 'not_received'
  /** Butiken ändrade beställningen efter att sidan lästes. */
  | 'changed'
  | 'freight_missing'
  | 'customer_missing'
  /** Kortet har inget kundnummer i Fortnox, så ordern kan inte skapas. */
  | 'customer_not_in_fortnox';

export type StoreOrderConfirmRow = {
  status: StoreOrderStatus;
  store_version: number;
  freight_mode: string | null;
  customer_id: string | null;
};

/**
 * Får beställningen bekräftas nu? Mottagen, samma version som säljaren såg, frakten beslutad och en kund med kundnummer
 * i Fortnox. Databasen kräver själv frakten och mottagen (crm_store_orders_guard och checken), men svaret här säger
 * varför, i den ordning säljaren kan göra något åt det.
 */
export function decideStoreOrderConfirm(
  row: StoreOrderConfirmRow,
  expectedVersion: number,
  card: { fortnox_customer_id: string | null } | null,
): { ok: true } | { ok: false; reason: StoreOrderConfirmBlocker } {
  if (row.status !== 'received') return { ok: false, reason: 'not_received' };
  if (row.store_version !== expectedVersion) return { ok: false, reason: 'changed' };
  if (!row.freight_mode) return { ok: false, reason: 'freight_missing' };
  if (!row.customer_id || !card) return { ok: false, reason: 'customer_missing' };
  if (!nonEmpty(card.fortnox_customer_id)) return { ok: false, reason: 'customer_not_in_fortnox' };
  return { ok: true };
}

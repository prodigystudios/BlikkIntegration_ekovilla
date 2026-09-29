import { z } from 'zod';
import { pricingModeFromUnit } from '@/lib/domains/crm/lineItems';
import { amount, portalId, portalStoreSchema, required, trimmed } from './jobIntake';
import { STORE_ORDER_CONFIRMED_STATUSES, type StoreOrderStatus } from './storeOrders';

/**
 * Butiksbeställningens kropp från portalen (kontraktets "Flöde 3": `EkovillaStoreOrder` plus butikens kundnummer, och
 * `updatedAt` i en ändring) och besluten om en ny, ändrad eller tillbakadragen beställning. Rent: ingen databas. Stegen
 * mot databasen står i ./storeOrdersStore.ts.
 *
 * Reglerna (kontraktet, William 2026-09-29):
 *   - Affärsnyckeln är orderId. Samma orderId igen med samma första kropp är en upprepning (201 och den befintliga), med
 *     en annan en konflikt (409): portalen fryser kroppen vid första försöket.
 *   - En ändring gäller bara en mottagen beställning, och bara om updatedAt är STRIKT nyare än den senast mottagna. En
 *     äldre eller samma är ett sent omförsök och ignoreras (200 ignored), så att den aldrig skriver över en nyare.
 *   - Efter bekräftelsen är beställningen låst: en ändring och en tillbakadragning får 409, och det betyder bara det.
 *     Portalen läser varje 409 på en ändring som "Ekovilla hann bekräfta", så en makulerad eller tillbakadragen
 *     beställning ignorerar i stället (200): makuleringen kommer som store_order.cancelled.
 *   - Samma butik och samma nummer i en ändring som i beställningen. En annan är ett fel i anropet (400), aldrig 409.
 */

export const PORTAL_STORE_ORDERS_PATH = '/api/portal/store-orders';

// Portalens id:n står i sökvägar (planens punkt 16): samma regel som jobbens.
export const portalStoreOrderId = portalId;

const lineSchema = z
  .object({
    articleNumber: required(50),
    name: required(500),
    unit: trimmed(20),
    // Hela enheter: paket, rullar, pallar, styck (kontraktet).
    quantity: z.number().int('Antalet är hela enheter.').positive('Måste vara större än noll.').max(100_000, 'Högst 100000.'),
    unitCost: amount.min(0, 'Priset kan inte vara negativt.').max(10_000_000),
    lineCost: amount,
  })
  // Inblåsning (m³) säljs bara som jobb (portalens isOrderableArticle). En sådan rad hade blivit ett antal i fel enhet.
  .refine((line) => pricingModeFromUnit(line.unit) !== 'm3', {
    message: 'Inblåsning (m3) beställs som ett jobb, inte i en butiksbeställning.',
    path: ['unit'],
  });

export const portalStoreOrderSchema = z.object({
  orderId: portalStoreOrderId,
  orderNumber: required(50),
  // Samma butik som i ett jobb: butikens första kontakt (upsertPortalReseller) delas.
  store: portalStoreSchema,
  delivery: z.object({
    // Föraren kör dit: alla tre delarna krävs.
    address: z.object({ street: required(200), postalCode: required(20), city: required(100) }),
    desiredPeriod: trimmed(200),
    reference: trimmed(200),
    contactName: trimmed(200),
    contactPhone: trimmed(50),
    message: trimmed(4000),
  }),
  lines: z.array(lineSchema).min(1, 'Beställningen har inga rader.').max(200, 'Högst 200 rader.'),
  costTotal: amount.min(0),
});

/** Kontraktet: UTC med hela millisekunder, `2026-09-28T10:15:00.123Z`. Samma text står i Idempotency-Key. */
const UPDATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const portalStoreOrderChangeSchema = portalStoreOrderSchema.extend({
  updatedAt: z
    .string()
    .regex(UPDATED_AT, 'updatedAt skrivs i UTC med millisekunder, till exempel 2026-09-28T10:15:00.123Z.')
    // En tid som inte finns (30 februari) blir en annan dag i Date; bara en som går tillbaka oförändrad godtas.
    .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v, 'updatedAt är ingen giltig tid.'),
});

export const portalStoreOrderWithdrawSchema = z.object({ orderId: portalStoreOrderId });

export type PortalStoreOrder = z.infer<typeof portalStoreOrderSchema>;
export type PortalStoreOrderChange = z.infer<typeof portalStoreOrderChangeSchema>;

// -------------------------------------------------------------------------------------------------------- besluten

/** Det ur beställningens rad som besluten behöver. */
export type StoreOrderDecisionRow = {
  status: StoreOrderStatus;
  reseller_id: string;
  order_number: string;
  /** Det senast mottagna updatedAt, som Postgres skriver det. null = bara den första kroppen. */
  portal_updated_at: string | null;
};

export type StoreOrderChangeDecision =
  | { kind: 'apply' }
  /** Ett sent omförsök, en tillbakadragen eller en makulerad beställning: 200 ignored. */
  | { kind: 'ignored' }
  /** Redan bekräftad: 409. */
  | { kind: 'confirmed' }
  /** En annan butik eller ett annat nummer än beställningens: 400. */
  | { kind: 'mismatch'; field: 'store.resellerId' | 'orderNumber' };

export function decideStoreOrderChange(
  row: StoreOrderDecisionRow,
  change: { resellerId: string; orderNumber: string; updatedAt: string },
): StoreOrderChangeDecision {
  if (row.reseller_id !== change.resellerId) return { kind: 'mismatch', field: 'store.resellerId' };
  // Båda är trimmade: Zod trimmar kroppen, och den sparade kom samma väg.
  if (row.order_number !== change.orderNumber) return { kind: 'mismatch', field: 'orderNumber' };
  if (STORE_ORDER_CONFIRMED_STATUSES.has(row.status)) return { kind: 'confirmed' };
  if (row.status !== 'received') return { kind: 'ignored' };
  // Äldre ELLER SAMMA: kontraktet. Jämförs som tider, eftersom Postgres skriver dem med +00:00.
  if (row.portal_updated_at !== null && Date.parse(row.portal_updated_at) >= Date.parse(change.updatedAt)) {
    return { kind: 'ignored' };
  }
  return { kind: 'apply' };
}

export type StoreOrderWithdrawDecision =
  | { kind: 'apply' }
  /** Redan tillbakadragen: samma svar igen. */
  | { kind: 'withdrawn' }
  | { kind: 'confirmed' }
  /** Makulerad av Ekovilla innan butiken hann: 200 ignored, makuleringen kommer som store_order.cancelled. */
  | { kind: 'ignored' };

export function decideStoreOrderWithdraw(row: Pick<StoreOrderDecisionRow, 'status'>): StoreOrderWithdrawDecision {
  if (row.status === 'received') return { kind: 'apply' };
  if (row.status === 'withdrawn') return { kind: 'withdrawn' };
  if (STORE_ORDER_CONFIRMED_STATUSES.has(row.status)) return { kind: 'confirmed' };
  return { kind: 'ignored' };
}

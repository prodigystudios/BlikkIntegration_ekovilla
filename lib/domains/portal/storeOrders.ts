/**
 * Butiksbeställningarna från återförsäljarportalen (RESELLER_PORTAL_CRM_PLAN.md fas 8, kontraktets "Flöde 3"): butiken
 * köper material ur prislistan, Ekovilla levererar till butiken och fakturerar den.
 *
 * Ren: sidorna importerar den, så den får aldrig dra in zod, databasen eller node:crypto. Kroppens schema och besluten
 * står i ./storeOrderIntake.ts, databasstegen i ./storeOrdersStore.ts.
 *
 * Besluten (William 2026-09-29):
 *   - Momsen som i CRM:et i dag, per dokument: 25 % på en butiksbeställning, också på frakten. Butiken är slutkund.
 *   - Ekovilla ändrar aldrig butikens rader. Priset är alltid butikens unitCost; Ekovilla lägger bara till frakten.
 *   - Notisen när en beställning kommer, ändras eller dras tillbaka går till den ansvarige, eller till reserven.
 */

export const STORE_ORDER_STATUSES = ['received', 'withdrawn', 'confirmed', 'delivered', 'invoiced', 'cancelled'] as const;
export type StoreOrderStatus = (typeof STORE_ORDER_STATUSES)[number];

/** Portalens ord för statusen (kontraktet): Ny heter Skickad hos butiken. */
export const STORE_ORDER_STATUS_LABELS: Record<StoreOrderStatus, string> = {
  received: 'Ny',
  withdrawn: 'Tillbakadragen',
  confirmed: 'Bekräftad',
  delivered: 'Levererad',
  invoiced: 'Fakturerad',
  cancelled: 'Makulerad',
};

/** Från och med bekräftelsen är beställningen låst hos butiken: en ändring eller tillbakadragning får 409. */
export const STORE_ORDER_CONFIRMED_STATUSES: ReadonlySet<StoreOrderStatus> = new Set(['confirmed', 'delivered', 'invoiced']);

/** Momsen på en butiksbeställning, raderna och frakten (William 2026-09-29). */
export const STORE_ORDER_VAT_PERCENT = 25;

export type StoreOrderAddress = { street: string; postalCode: string; city: string };

export type StoreOrderLine = {
  articleNumber: string;
  name: string;
  unit: string;
  /** Hela enheter. */
  quantity: number;
  /** Butikens pris per enhet, exkl. moms: det som blir Price på Fortnox-ordern. */
  unitCost: number;
  /** Bara information (kontraktet): CRM:et räknar själv. */
  lineCost: number;
};

export type StoreOrderDelivery = {
  address: StoreOrderAddress;
  desiredPeriod: string;
  /** Butikens eget ordernummer eller godsmärkning. */
  reference: string;
  contactName: string;
  contactPhone: string;
  message: string;
};

/** Kroppen som den sparas (`payload`): en ny beställning, eller en ändring med `updatedAt`. */
export type StoreOrderBody = {
  orderId: string;
  orderNumber: string;
  store: {
    resellerId: string;
    name: string;
    address: StoreOrderAddress;
    ekovillaCustomerNumber: string | null;
  };
  delivery: StoreOrderDelivery;
  lines: StoreOrderLine[];
  costTotal: number;
  updatedAt?: string;
};

/** Radens summa exkl. moms, i hela ören: antal × butikens pris. */
export function storeOrderLineTotal(line: Pick<StoreOrderLine, 'quantity' | 'unitCost'>): number {
  return Math.round(line.quantity * line.unitCost * 100) / 100;
}

/** Beställningens summa exkl. moms och frakt, radernas summor lagda ihop i ören. */
export function storeOrderLinesTotal(lines: readonly Pick<StoreOrderLine, 'quantity' | 'unitCost'>[]): number {
  const ore = lines.reduce((sum, line) => sum + Math.round(storeOrderLineTotal(line) * 100), 0);
  return ore / 100;
}

export type StoreOrderFreight = { mode: 'none' } | { mode: 'charged'; price: number } | null;

export type StoreOrderTotals = {
  lines: number;
  /** Fraktens pris exkl. moms; 0 för "Ingen frakt". null = inte beslutad än. */
  freight: number | null;
  /** Raderna och frakten, exkl. moms. null tills frakten är beslutad. */
  net: number | null;
  vat: number | null;
  total: number | null;
};

/**
 * Beställningens belopp, som sidan visar dem: butikens rader, Ekovillas frakt, 25 % moms på båda, avrundat till hela
 * ören. Utan fraktbeslut finns ingen summa inkl. moms än, eftersom frakten ska med. Fortnox räknar sin egen moms per rad,
 * så öresavrundningen kan skilja på fakturan; det här är sidans besked, inte fakturans.
 */
export function storeOrderTotals(
  lines: readonly Pick<StoreOrderLine, 'quantity' | 'unitCost'>[],
  freight: StoreOrderFreight,
  vatPercent: number = STORE_ORDER_VAT_PERCENT,
): StoreOrderTotals {
  const linesOre = Math.round(storeOrderLinesTotal(lines) * 100);
  if (freight === null) return { lines: linesOre / 100, freight: null, net: null, vat: null, total: null };
  const freightOre = freight.mode === 'charged' ? Math.round(freight.price * 100) : 0;
  const netOre = linesOre + freightOre;
  const vatOre = Math.round((netOre * vatPercent) / 100);
  return { lines: linesOre / 100, freight: freightOre / 100, net: netOre / 100, vat: vatOre / 100, total: (netOre + vatOre) / 100 };
}

/** Så många av de senaste avslutade (fakturerade, tillbakadragna, makulerade) som listan läser; de pågående läses alla. */
export const STORE_ORDER_LIST_LIMIT = 500;

const ore = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "4 414,20 kr": beloppen på sidorna. */
export function formatStoreOrderKr(amount: number): string {
  return `${ore.format(amount)} kr`;
}

const kronor = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });

/** "B-2026-003 · 2 rader · 4 414 kr exkl. moms · Vecka 41": notisens brödtext. */
export function storeOrderSummary(body: Pick<StoreOrderBody, 'orderNumber' | 'lines' | 'delivery'>): string {
  const count = body.lines.length;
  return [
    body.orderNumber.trim(),
    `${count} ${count === 1 ? 'rad' : 'rader'}`,
    `${kronor.format(storeOrderLinesTotal(body.lines))} kr exkl. moms`,
    body.delivery.desiredPeriod.trim(),
  ]
    .filter(Boolean)
    .join(' · ');
}

// ---------------------------------------------------------------------------------------------------------- notisen

export type StoreOrderNoticeKind = 'received' | 'changed' | 'withdrawn';

/**
 * Den notis den ansvarige borde ha fått för beställningen som den står nu: `v<version>` för en mottagen, `withdrawn`
 * för en tillbakadragen, och ingen när Ekovilla tagit över (bekräftad och framåt, makulerad).
 */
export function storeOrderNoticeKey(row: { status: StoreOrderStatus; store_version: number }): string | null {
  if (row.status === 'received') return `v${row.store_version}`;
  if (row.status === 'withdrawn') return 'withdrawn';
  return null;
}

/**
 * Vad som ska skickas nu, eller null om den ansvarige redan vet. Mellan två notiser kan flera ändringar ha kommit;
 * bara den senaste sägs. Har den ansvarige aldrig fått någon notis är beställningen "Ny", också om den hunnit ändras.
 * En tillbakadragning sägs alltid: att ingen notis är bokförd betyder inte att ingen kom fram (bokföringen kan ha
 * fallit efter utskicket), och en ansvarig som fått "Ny beställning" får aldrig bli utan "drog tillbaka".
 */
export function decideStoreOrderNotice(row: {
  status: StoreOrderStatus;
  store_version: number;
  notified_key: string | null;
}): { key: string; kind: StoreOrderNoticeKind } | null {
  const key = storeOrderNoticeKey(row);
  if (!key || key === row.notified_key) return null;
  if (key === 'withdrawn') return { key, kind: 'withdrawn' };
  return { key, kind: row.notified_key ? 'changed' : 'received' };
}

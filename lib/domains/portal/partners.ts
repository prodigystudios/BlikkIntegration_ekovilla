import { z } from 'zod';
import type { OutboxDelivery } from './outboxDelivery';

/**
 * Partner i återförsäljarportalen (RESELLER_PORTAL_CRM_PLAN.md 10a, kontraktets flöde 5): flaggan på kundkortet och
 * inbjudan av ett företag med dess första admin. Rent: reglerna, kroppen till portalen och hur portalens svar läses.
 * Databasen och kön bor i partnersStore.ts.
 *
 * Williams beslut 2026-10-01:
 *   - En kund flaggas som Återförsäljare eller Partner. Typen finns bara i CRM:et; portalen är densamma för båda.
 *   - Bara ett företagskort med kundnummer i Fortnox kan bjudas in: portalens företag bär numret, och jobben når
 *     Fortnox genom det.
 *   - Ett kort kan bli flera företag i portalen. En kedja kan dela kundnummer mellan butiker.
 */

export const PORTAL_PARTNER_TYPES = ['reseller', 'partner'] as const;
export type PortalPartnerType = (typeof PORTAL_PARTNER_TYPES)[number];

export const PORTAL_PARTNER_TYPE_LABELS: Record<PortalPartnerType, string> = {
  reseller: 'Återförsäljare',
  partner: 'Partner',
};

/** Portalens route för flöde 5. */
export const RESELLERS_PATH = '/api/ekovilla/resellers';

/** Köns nycklar för ett företag: dess inbjudningar skickas i tur och ordning, och bara den senaste väntande behövs. */
export const RESELLER_INVITE_QUEUE_PREFIX = 'reseller:';

export function resellerInviteOrderingKey(resellerId: string): string {
  return `${RESELLER_INVITE_QUEUE_PREFIX}${resellerId}`;
}

export function resellerInviteSupersedeKey(resellerId: string): string {
  return `reseller-invite:${resellerId}`;
}

/** Försökets nyckel, samma i kön, i tabellen (dess check) och hos portalen. `attempt` börjar på 1. */
export function resellerInviteIdempotencyKey(resellerId: string, attempt: number): string {
  return `reseller-invite-${resellerId}-${attempt}`;
}

/** CRM:et väljer företagets id: ett uuid med gemener, som `crypto.randomUUID()` ger. */
export const PORTAL_RESELLER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Ett nytt företags id (uuid v4), valt av formuläret när det öppnas. `getRandomValues` och inte `randomUUID`: den
 * senare finns bara i en säker miljö (https eller localhost), och formuläret ska gå att öppna också över http på
 * det lokala nätet.
 */
export function newPortalResellerId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ------------------------------------------------------------------------------------------------------- kortet

type CardAddress = { street?: string | null; street_address?: string | null; postal_code?: string | null; city?: string | null } | null;

export type PartnerCard = {
  id: string;
  customer_type: 'business' | 'private';
  company_name: string | null;
  organization_number: string | null;
  fortnox_customer_id: string | null;
  phone: string | null;
  email: string | null;
  visit_address: CardAddress;
  invoice_address: CardAddress;
  delivery_address: CardAddress;
};

export const PARTNER_CARD_SELECT =
  'id, customer_type, company_name, organization_number, fortnox_customer_id, phone, email, visit_address, invoice_address, delivery_address';

export type PartnerIneligibleReason = 'not_business' | 'no_fortnox_number';

export const PARTNER_INELIGIBLE_MESSAGES: Record<PartnerIneligibleReason, string> = {
  not_business: 'Bara ett företagskort kan bjudas in till portalen.',
  no_fortnox_number: 'Kunden har inget kundnummer i Fortnox än. Skapa den i Fortnox först: företaget i portalen behöver numret.',
};

export type PartnerEligibility = { ok: true; customerNumber: string } | { ok: false; reason: PartnerIneligibleReason };

/** Kan kortet bjudas in? Flaggan prövas för sig: den kan sättas innan kortet har ett kundnummer. */
export function partnerEligibility(card: Pick<PartnerCard, 'customer_type' | 'fortnox_customer_id'>): PartnerEligibility {
  if (card.customer_type !== 'business') return { ok: false, reason: 'not_business' };
  const customerNumber = card.fortnox_customer_id?.trim();
  if (!customerNumber) return { ok: false, reason: 'no_fortnox_number' };
  return { ok: true, customerNumber };
}

// ------------------------------------------------------------------------------------------------- formuläret

/** Butikens uppgifter i formuläret. Samma gränser som crm_portal_resellers. */
export const inviteStoreSchema = z.object({
  name: z.string().trim().min(1, 'Ange företagets namn i portalen.').max(200, 'Namnet får vara högst 200 tecken.'),
  street: z.string().trim().max(200, 'Gatuadressen får vara högst 200 tecken.'),
  postalCode: z.string().trim().max(20, 'Postnumret får vara högst 20 tecken.'),
  city: z.string().trim().min(1, 'Ange ort.').max(100, 'Orten får vara högst 100 tecken.'),
  phone: z.string().trim().max(50, 'Telefonnumret får vara högst 50 tecken.'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, 'E-postadressen får vara högst 254 tecken.')
    .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Ange en giltig e-postadress, eller lämna fältet tomt.'),
});

export type InviteStore = z.infer<typeof inviteStoreSchema>;

/** Den första admin i portalen. Adressen med gemener: portalens inloggning skiljer inte på stora och små bokstäver. */
export const inviteAdminSchema = z.object({
  name: z.string().trim().min(1, 'Ange adminens namn.').max(200, 'Namnet får vara högst 200 tecken.'),
  email: z.string().trim().toLowerCase().max(254, 'E-postadressen får vara högst 254 tecken.').email('Ange adminens e-postadress.'),
});

export type InviteAdmin = z.infer<typeof inviteAdminSchema>;

function addressOf(address: CardAddress): { street: string; postalCode: string; city: string } | null {
  if (!address) return null;
  const street = (address.street ?? address.street_address ?? '').trim();
  const postalCode = (address.postal_code ?? '').trim();
  const city = (address.city ?? '').trim();
  return street || postalCode || city ? { street, postalCode, city } : null;
}

/**
 * Formulärets förval ur kortet: besöksadressen, annars fakturaadressen, annars leveransadressen. Kortets e-post bara om
 * den är EN giltig adress: förvalet går också rakt till portalen, när ett företag utan inbjudan får sin första admin,
 * och portalen hade nekat hela inbjudan för ett fält som admin aldrig såg.
 */
export function defaultInviteStore(card: PartnerCard): InviteStore {
  const address = addressOf(card.visit_address) ?? addressOf(card.invoice_address) ??
    addressOf(card.delivery_address) ?? { street: '', postalCode: '', city: '' };
  const email = (card.email ?? '').trim().toLowerCase();
  return {
    name: (card.company_name ?? '').trim().slice(0, 200),
    street: address.street.slice(0, 200),
    postalCode: address.postalCode.slice(0, 20),
    city: address.city.slice(0, 100),
    phone: (card.phone ?? '').trim().slice(0, 50),
    email: email.length <= 254 && z.string().email().safeParse(email).success ? email : '',
  };
}

// ---------------------------------------------------------------------------------------------------- kroppen

/** Kroppen i kontraktets flöde 5. Sparas också på inbjudan, så att nästa försök har företagets uppgifter. */
export const resellerInvitePayloadSchema = z.object({
  resellerId: z.string().min(1),
  name: z.string(),
  organizationNumber: z.string(),
  address: z.object({ street: z.string(), postalCode: z.string(), city: z.string() }),
  phone: z.string(),
  email: z.string(),
  ekovillaCustomerNumber: z.string().min(1),
  admin: z.object({ name: z.string(), email: z.string() }),
});

export type ResellerInvitePayload = z.infer<typeof resellerInvitePayloadSchema>;

export function buildResellerInvitePayload(input: {
  resellerId: string;
  store: InviteStore;
  organizationNumber: string | null;
  customerNumber: string;
  admin: InviteAdmin;
}): ResellerInvitePayload {
  const { store } = input;
  return {
    resellerId: input.resellerId,
    name: store.name,
    organizationNumber: (input.organizationNumber ?? '').trim(),
    address: { street: store.street, postalCode: store.postalCode, city: store.city },
    phone: store.phone,
    email: store.email,
    ekovillaCustomerNumber: input.customerNumber,
    admin: { name: input.admin.name, email: input.admin.email },
  };
}

/**
 * Nästa försök för ett företag: företagets uppgifter från förra försöket, och kortets kundnummer och den admin som
 * anges nu. Finns inget förra försök (företaget skapades utanför CRM:et), eller går det inte att läsa, byggs uppgifterna
 * ur butikens rad och kortet. Portalen ändrar inte ett befintligt företag, men ett företag som inte hann skapas (ett nekat
 * första försök) skapas av nästa.
 */
export function nextResellerInvitePayload(input: {
  previous: unknown;
  store: { resellerId: string; name: string; street: string; postalCode: string; city: string };
  card: PartnerCard;
  customerNumber: string;
  admin: InviteAdmin;
}): ResellerInvitePayload {
  const previous = resellerInvitePayloadSchema.safeParse(input.previous);
  if (previous.success) {
    return { ...previous.data, ekovillaCustomerNumber: input.customerNumber, admin: { name: input.admin.name, email: input.admin.email } };
  }
  const defaults = defaultInviteStore(input.card);
  return buildResellerInvitePayload({
    resellerId: input.store.resellerId,
    store: {
      name: input.store.name,
      street: input.store.street,
      postalCode: input.store.postalCode,
      city: input.store.city,
      phone: defaults.phone,
      email: defaults.email,
    },
    organizationNumber: input.card.organization_number,
    customerNumber: input.customerNumber,
    admin: input.admin,
  });
}

// ------------------------------------------------------------------------------------------------ portalens svar

/**
 * Varför portalen nekade en inbjudan, i ord som admin kan göra något åt. Kön sparar `HTTP <status>: <svarets början>`
 * (outbox.ts) och svaret har kontraktets kuvert: `{ ok: false, error, errorDetails: { code } }`. Läses bara när
 * händelsen gavs upp; null annars.
 */
export function describeInviteFailure(delivery: Pick<OutboxDelivery, 'status' | 'lastHttpStatus' | 'lastError'>): string | null {
  if (delivery.status !== 'dead') return null;
  const body = parseErrorBody(delivery.lastError);
  if (body.code === 'admin_email_taken') {
    return 'Adressen har redan ett konto i ett annat företag i portalen. Bjud in med en annan adress.';
  }
  if (body.message) return `Portalen nekade inbjudan: ${body.message}`;
  return delivery.lastHttpStatus
    ? `Portalen nekade inbjudan (HTTP ${delivery.lastHttpStatus}).`
    : 'Inbjudan gick inte fram till portalen.';
}

function parseErrorBody(lastError: string | null): { code: string | null; message: string | null } {
  const match = /^HTTP \d{3}: ([\s\S]*)$/.exec(lastError ?? '');
  if (!match) return { code: null, message: null };
  try {
    const body = JSON.parse(match[1]) as { error?: unknown; errorDetails?: { code?: unknown } };
    return {
      code: typeof body.errorDetails?.code === 'string' ? body.errorDetails.code : null,
      message: typeof body.error === 'string' && body.error.trim() ? body.error.trim().slice(0, 300) : null,
    };
  } catch {
    // Svaret är kapat efter 500 tecken, eller inte JSON (en proxy, en felsida).
    return { code: null, message: null };
  }
}

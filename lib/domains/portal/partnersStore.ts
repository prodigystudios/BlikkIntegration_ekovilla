import type { SupabaseClient } from '@supabase/supabase-js';
import { resolvePortalTarget } from './config';
import { dispatchPortalOutbox, enqueuePortalEvent } from './outbox';
import { NOT_QUEUED, readOutboxDeliveries, type OutboxDelivery } from './outboxDelivery';
import {
  PARTNER_CARD_SELECT,
  RESELLERS_PATH,
  buildResellerInvitePayload,
  defaultInviteStore,
  describeInviteFailure,
  nextResellerInvitePayload,
  partnerEligibility,
  resellerInviteIdempotencyKey,
  resellerInviteOrderingKey,
  resellerInviteSupersedeKey,
  type InviteAdmin,
  type InviteStore,
  type PartnerCard,
  type PartnerEligibility,
  type PartnerIneligibleReason,
  type PortalPartnerType,
  type ResellerInvitePayload,
} from './partners';

/**
 * Partner i portalen mot databasen (RESELLER_PORTAL_CRM_PLAN.md 10a): rutan på kundkortet, flaggan och inbjudan.
 *
 * Två klienter, med flit:
 *   sessionen      kortet, flaggan, butikerna, inbjudningarna och köns status. RLS är grinden: allt utom kortet kräver
 *                  crm.portal.manage.
 *   service-rollen butikens rad, inbjudan och kön. Bara service_role skriver dem: butikens kundkoppling (fas 3c) och
 *                  kön (fas 1b). Används först när sessionen har läst kortet och flaggan. Se "Reviewed elevations" i
 *                  SUPABASE_CONVENTIONS.md.
 *
 * 🧨 En UPDATE som inte träffar någon rad svarar utan fel i PostgREST. Varje "bara om" läser tillbaka raderna.
 */

// ----------------------------------------------------------------------------------------------------- läsningen

export type PartnerInviteView = {
  attempt: number;
  adminName: string;
  adminEmail: string;
  invitedByName: string | null;
  createdAt: string;
  delivery: OutboxDelivery;
  /** Varför portalen nekade, i klartext. null när den inte har nekat. */
  failure: string | null;
};

export type PartnerStoreView = {
  resellerId: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  /** Kundnumret portalen senast skickade, eller kortets nummer när CRM:et bjöd in företaget. */
  customerNumber: string | null;
  /** Den senaste inbjudan från CRM:et. null = företaget kom till portalen på annat sätt (skript, koppling för hand). */
  invite: PartnerInviteView | null;
};

export type PortalPartnerView = {
  customerId: string;
  partnerType: PortalPartnerType | null;
  eligibility: PartnerEligibility;
  /** Formulärets förval för ett nytt företag. */
  defaults: InviteStore;
  stores: PartnerStoreView[];
};

type StoreRow = { reseller_id: string; name: string; street: string; postal_code: string; city: string; customer_number: string | null };
type InviteRow = {
  reseller_id: string;
  attempt: number;
  idempotency_key: string;
  admin_name: string;
  admin_email: string;
  invited_by_name: string | null;
  created_at: string;
};
type InviteRowWithPayload = InviteRow & { payload: unknown };

const STORE_SELECT = 'reseller_id, name, street, postal_code, city, customer_number';
const INVITE_SELECT = 'reseller_id, attempt, idempotency_key, admin_name, admin_email, invited_by_name, created_at';

async function readCard(session: SupabaseClient, customerId: string): Promise<PartnerCard | null> {
  const { data, error } = await session.from('crm_customers').select(PARTNER_CARD_SELECT).eq('id', customerId).maybeSingle();
  if (error) throw new Error(`Kundkortet gick inte att läsa: ${error.message}`);
  return (data as PartnerCard | null) ?? null;
}

async function readPartnerType(session: SupabaseClient, customerId: string): Promise<PortalPartnerType | null> {
  const { data, error } = await session.from('crm_portal_partners').select('partner_type').eq('customer_id', customerId).maybeSingle();
  if (error) throw new Error(`Partnerflaggan gick inte att läsa: ${error.message}`);
  return ((data as { partner_type: PortalPartnerType } | null) ?? null)?.partner_type ?? null;
}

/**
 * Det senaste försöket per företag. Några få företag per kort, och några få försök per företag. Kroppen läses bara av
 * inbjudan, som behöver den för nästa försök; rutan visar den aldrig.
 */
async function readLatestInvites(client: SupabaseClient, resellerIds: string[]): Promise<Map<string, InviteRow>>;
async function readLatestInvites(
  client: SupabaseClient,
  resellerIds: string[],
  options: { withPayload: true },
): Promise<Map<string, InviteRowWithPayload>>;
async function readLatestInvites(
  client: SupabaseClient,
  resellerIds: string[],
  options?: { withPayload: true },
): Promise<Map<string, InviteRow | InviteRowWithPayload>> {
  if (resellerIds.length === 0) return new Map();
  const { data, error } = await client
    .from('crm_portal_reseller_invites')
    .select(options?.withPayload ? `${INVITE_SELECT}, payload` : INVITE_SELECT)
    .in('reseller_id', resellerIds)
    .order('attempt', { ascending: false });
  if (error) throw new Error(`Inbjudningarna gick inte att läsa: ${error.message}`);
  const latest = new Map<string, InviteRow>();
  // Högsta försöket först: den första raden per företag är den senaste.
  for (const row of (data ?? []) as unknown as InviteRow[]) if (!latest.has(row.reseller_id)) latest.set(row.reseller_id, row);
  return latest;
}

function toInviteView(row: InviteRow, delivery: OutboxDelivery): PartnerInviteView {
  return {
    attempt: row.attempt,
    adminName: row.admin_name,
    adminEmail: row.admin_email,
    invitedByName: row.invited_by_name,
    createdAt: row.created_at,
    delivery,
    failure: describeInviteFailure(delivery),
  };
}

/** Rutan på kundkortet. null = kortet finns inte för sessionen. Kräver crm.portal.manage (RLS på allt utom kortet). */
export async function readPortalPartner(session: SupabaseClient, customerId: string): Promise<PortalPartnerView | null> {
  const [card, partnerType, storesRead] = await Promise.all([
    readCard(session, customerId),
    readPartnerType(session, customerId),
    session.from('crm_portal_resellers').select(STORE_SELECT).eq('customer_id', customerId).order('name').order('reseller_id'),
  ]);
  if (!card) return null;
  if (storesRead.error) throw new Error(`Företagen i portalen gick inte att läsa: ${storesRead.error.message}`);
  const stores = (storesRead.data ?? []) as StoreRow[];

  const invites = await readLatestInvites(session, stores.map((s) => s.reseller_id));
  const deliveries = await readOutboxDeliveries(session, [...invites.values()].map((i) => i.idempotency_key));

  return {
    customerId: card.id,
    partnerType,
    eligibility: partnerEligibility(card),
    defaults: defaultInviteStore(card),
    stores: stores.map((s) => {
      const invite = invites.get(s.reseller_id);
      return {
        resellerId: s.reseller_id,
        name: s.name,
        street: s.street,
        postalCode: s.postal_code,
        city: s.city,
        customerNumber: s.customer_number,
        invite: invite ? toInviteView(invite, deliveries.get(invite.idempotency_key) ?? NOT_QUEUED) : null,
      };
    }),
  };
}

// ------------------------------------------------------------------------------------------------------- flaggan

export type SetPartnerTypeResult =
  | { kind: 'saved'; partnerType: PortalPartnerType | null }
  | { kind: 'not_found' }
  | { kind: 'not_business' }
  | { kind: 'forbidden' }
  | { kind: 'db_error'; message: string };

/**
 * Sätter eller tar bort flaggan, med sessionen (RLS: crm.portal.manage, och bara som sig själv). Att ta bort flaggan
 * rör inte företagen i portalen: de står kvar, kopplade till kortet, men inga nya kan bjudas in.
 */
export async function setPortalPartnerType(
  session: SupabaseClient,
  customerId: string,
  partnerType: PortalPartnerType | null,
  actorId: string,
): Promise<SetPartnerTypeResult> {
  const card = await readCard(session, customerId);
  if (!card) return { kind: 'not_found' };

  if (partnerType === null) {
    const removed = await session.from('crm_portal_partners').delete().eq('customer_id', customerId).select('customer_id');
    if (removed.error) {
      return removed.error.code === '42501' ? { kind: 'forbidden' } : { kind: 'db_error', message: removed.error.message };
    }
    // Noll rader: flaggan fanns inte, eller RLS släppte inte igenom. Läs om för att veta vilket.
    if ((removed.data ?? []).length === 0 && (await readPartnerType(session, customerId)) !== null) return { kind: 'forbidden' };
    return { kind: 'saved', partnerType: null };
  }

  if (card.customer_type !== 'business') return { kind: 'not_business' };
  const saved = await session
    .from('crm_portal_partners')
    .upsert({ customer_id: customerId, partner_type: partnerType, updated_by: actorId }, { onConflict: 'customer_id' })
    .select('partner_type');
  if (saved.error) {
    return saved.error.code === '42501' ? { kind: 'forbidden' } : { kind: 'db_error', message: saved.error.message };
  }
  const row = (saved.data ?? [])[0] as { partner_type: PortalPartnerType } | undefined;
  return row ? { kind: 'saved', partnerType: row.partner_type } : { kind: 'forbidden' };
}

// ------------------------------------------------------------------------------------------------------ inbjudan

export type InvitePortalResellerInput =
  /** Ett nytt företag. `resellerId` väljs av formuläret när det öppnas: ett dubbelklick blir samma företag. */
  | { mode: 'new'; customerId: string; resellerId: string; store: InviteStore; admin: InviteAdmin }
  /**
   * "Skicka inbjudan igen" till ett företag på kortet, till samma eller en annan admin. `expectedAttempt` är det
   * senaste försöket som admin såg (0 = inget): ett dubbelklick, eller någon annans försök under tiden, blir `changed`.
   */
  | { mode: 'resend'; customerId: string; resellerId: string; admin: InviteAdmin; expectedAttempt: number };

export type InvitePortalResellerResult =
  | { kind: 'integration_off'; message: string }
  | { kind: 'not_found' }
  | { kind: 'ineligible'; reason: PartnerIneligibleReason }
  | { kind: 'not_partner' }
  /** Ett nytt företag med ett id som redan hör till ett annat kort. */
  | { kind: 'reseller_id_taken' }
  /** "Skicka igen" till ett företag som inte finns på kortet. */
  | { kind: 'store_not_found' }
  | { kind: 'changed' }
  | { kind: 'db_error'; message: string }
  | {
      kind: 'invited';
      /** false = samma inbjudan en gång till (ett dubbelklick); inget nytt köades. */
      created: boolean;
      resellerId: string;
      attempt: number;
      /** null = statusen gick inte att läsa efter utskicket; inbjudan och händelsen finns. */
      delivery: OutboxDelivery | null;
    };

export type InviteDeps = {
  session: SupabaseClient;
  admin: SupabaseClient;
  env: Record<string, string | undefined>;
  actor: { id: string; name: string | null };
  now: () => Date;
  fetchImpl?: typeof fetch;
};

/** Ett första utskick direkt, som publiceringen: få händelser och kort tid, så att knappen svarar snabbt. */
const INVITE_DISPATCH = { limit: 5, budgetMs: 15_000 };

async function readStore(client: SupabaseClient, resellerId: string): Promise<(StoreRow & { customer_id: string | null }) | null> {
  const { data, error } = await client
    .from('crm_portal_resellers')
    .select(`${STORE_SELECT}, customer_id`)
    .eq('reseller_id', resellerId)
    .maybeSingle();
  if (error) throw new Error(`Företaget gick inte att läsa: ${error.message}`);
  return (data as (StoreRow & { customer_id: string | null }) | null) ?? null;
}

async function deliveryOf(admin: SupabaseClient, key: string): Promise<OutboxDelivery | null> {
  try {
    return (await readOutboxDeliveries(admin, [key])).get(key) ?? NOT_QUEUED;
  } catch (e) {
    console.error('[portal-invite] status efter utskicket', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Steg 3 och 4: köa försöket och gör ett första utskick. Kastar bara om köandet föll. */
async function queueInvite(deps: InviteDeps, resellerId: string, idempotencyKey: string, payload: unknown): Promise<void> {
  await enqueuePortalEvent(deps.admin, {
    idempotencyKey,
    path: RESELLERS_PATH,
    payload,
    orderingKey: resellerInviteOrderingKey(resellerId),
    supersedeKey: resellerInviteSupersedeKey(resellerId),
  });
  try {
    await dispatchPortalOutbox(deps.admin, { env: deps.env, ...INVITE_DISPATCH, now: deps.now, fetchImpl: deps.fetchImpl });
  } catch (e) {
    // Händelsen ligger i kön; utskicket görs om av cron och med "Skicka väntande nu".
    console.error('[portal-invite] första utskicket misslyckades', e instanceof Error ? e.message : e);
  }
}

/**
 * Samma formulär en gång till (ett dubbelklick, eller ett nytt tryck efter ett fel): inbjudan finns redan. Föll förra
 * anropet efter att inbjudan sparats men innan den köades, köas den nu, med sin egen kropp och nyckel. Annars hade den
 * aldrig skickats, och knappen sagt att allt gick bra.
 */
async function settleExistingInvite(deps: InviteDeps, resellerId: string, latest: InviteRowWithPayload): Promise<InvitePortalResellerResult> {
  let delivery = await deliveryOf(deps.admin, latest.idempotency_key);
  if (delivery?.status === 'not_queued') {
    try {
      await queueInvite(deps, resellerId, latest.idempotency_key, latest.payload);
    } catch (e) {
      return { kind: 'db_error', message: e instanceof Error ? e.message : 'Inbjudan kunde inte köas.' };
    }
    delivery = await deliveryOf(deps.admin, latest.idempotency_key);
  }
  return { kind: 'invited', created: false, resellerId, attempt: latest.attempt, delivery };
}

/**
 * Bjuder in ett företag till portalen, eller skickar inbjudan igen (kontraktets flöde 5).
 *
 * Ordningen, och varför den tål ett avbrott var som helst:
 *   1. butikens rad (service-rollen), kopplad till kortet som en koppling för hand. Det första jobbet har då kund,
 *      också om portalen inte skulle skicka kundnumret. Samma id en gång till = samma rad. Finns raden men ingen
 *      inbjudan, finns inget företag i portalen än, och formulärets uppgifter skrivs på raden.
 *   2. inbjudan med nästa försöksnummer (service-rollen). Unik på (företaget, försöket): två samtidiga tryck blir ett.
 *   3. händelsen i kön (service-rollen; samma nyckel = samma händelse). En äldre väntande inbjudan till samma företag
 *      ersätts: bara den senaste admin behöver fram.
 *   4. ett första utskick. Det som inte hinner eller inte går fram ligger kvar i kön.
 * Dör anropet efter 1 står företaget på kortet utan inbjudan, och samma formulär eller "Bjud in en admin" gör klart det.
 * Dör det efter 2 gör samma formulär klart köandet, och "Skicka inbjudan igen" köar ett nytt försök.
 */
export async function invitePortalReseller(deps: InviteDeps, input: InvitePortalResellerInput): Promise<InvitePortalResellerResult> {
  // Avstängd integration: ingenting sparas eller köas, så att ingen inbjudan går iväg den dag hemligheten sätts.
  const target = resolvePortalTarget(deps.env);
  if (!target.ok) return { kind: 'integration_off', message: target.message };

  const [card, partnerType, existingStore, invites] = await Promise.all([
    readCard(deps.session, input.customerId),
    readPartnerType(deps.session, input.customerId),
    readStore(deps.session, input.resellerId),
    readLatestInvites(deps.session, [input.resellerId], { withPayload: true }),
  ]);
  if (!card) return { kind: 'not_found' };
  const eligibility = partnerEligibility(card);
  if (!eligibility.ok) return { kind: 'ineligible', reason: eligibility.reason };
  if (!partnerType) return { kind: 'not_partner' };

  let store = existingStore;
  if (store && store.customer_id !== card.id) return input.mode === 'new' ? { kind: 'reseller_id_taken' } : { kind: 'store_not_found' };
  if (!store && input.mode === 'resend') return { kind: 'store_not_found' };

  const latest = invites.get(input.resellerId) ?? null;
  if (input.mode === 'new' && latest) return settleExistingInvite(deps, input.resellerId, latest);
  if (input.mode === 'resend' && (latest?.attempt ?? 0) !== input.expectedAttempt) return { kind: 'changed' };

  if (input.mode === 'new') {
    const details = { name: input.store.name, street: input.store.street, postal_code: input.store.postalCode, city: input.store.city };
    if (store) {
      // Steg 1 gjordes av ett anrop som dog innan inbjudan sparades. Formuläret kan ha rättats sedan dess.
      const updated = await deps.admin.from('crm_portal_resellers').update(details).eq('reseller_id', input.resellerId).eq('customer_id', card.id);
      if (updated.error) return { kind: 'db_error', message: `Företaget kunde inte sparas: ${updated.error.message}` };
    } else {
      // Steg 1. Bara om id:t är ledigt; ett samtidigt tryck med samma id hann annars först, och då gäller dess rad.
      const at = deps.now().toISOString();
      const inserted = await deps.admin.from('crm_portal_resellers').upsert(
        {
          reseller_id: input.resellerId,
          ...details,
          customer_number: eligibility.customerNumber,
          customer_id: card.id,
          customer_linked_by: deps.actor.id,
          customer_linked_at: at,
          first_seen_at: at,
          last_seen_at: at,
        },
        { onConflict: 'reseller_id', ignoreDuplicates: true },
      );
      if (inserted.error) return { kind: 'db_error', message: `Företaget kunde inte sparas: ${inserted.error.message}` };
      store = await readStore(deps.admin, input.resellerId);
      if (!store) return { kind: 'db_error', message: 'Företaget sparades men gick inte att läsa tillbaka.' };
      if (store.customer_id !== card.id) return { kind: 'reseller_id_taken' };
    }
  }
  if (!store) return { kind: 'store_not_found' };

  const payload: ResellerInvitePayload =
    input.mode === 'new'
      ? buildResellerInvitePayload({
          resellerId: input.resellerId,
          store: input.store,
          organizationNumber: card.organization_number,
          customerNumber: eligibility.customerNumber,
          admin: input.admin,
        })
      : nextResellerInvitePayload({
          previous: latest?.payload,
          store: { resellerId: store.reseller_id, name: store.name, street: store.street, postalCode: store.postal_code, city: store.city },
          card,
          customerNumber: eligibility.customerNumber,
          admin: input.admin,
        });

  // Steg 2.
  const attempt = (latest?.attempt ?? 0) + 1;
  const idempotencyKey = resellerInviteIdempotencyKey(input.resellerId, attempt);
  const saved = await deps.admin
    .from('crm_portal_reseller_invites')
    .insert({
      reseller_id: input.resellerId,
      attempt,
      idempotency_key: idempotencyKey,
      payload,
      admin_name: input.admin.name,
      admin_email: input.admin.email,
      invited_by: deps.actor.id,
      invited_by_name: deps.actor.name ? deps.actor.name.slice(0, 200) : null,
    })
    .select('attempt');
  if (saved.error) {
    if (saved.error.code !== '23505') return { kind: 'db_error', message: `Inbjudan kunde inte sparas: ${saved.error.message}` };
    // Ett samtidigt tryck tog försöksnumret. Ett nytt företag har då sin inbjudan; ett "skicka igen" visar läget.
    if (input.mode === 'resend') return { kind: 'changed' };
    const winner = (await readLatestInvites(deps.admin, [input.resellerId], { withPayload: true })).get(input.resellerId);
    if (!winner) return { kind: 'db_error', message: 'Inbjudan krockade men gick inte att läsa.' };
    return settleExistingInvite(deps, input.resellerId, winner);
  }

  // Steg 3 och 4.
  try {
    await queueInvite(deps, input.resellerId, idempotencyKey, payload);
  } catch (e) {
    return { kind: 'db_error', message: e instanceof Error ? e.message : 'Inbjudan kunde inte köas.' };
  }

  return {
    kind: 'invited',
    created: true,
    resellerId: input.resellerId,
    attempt,
    delivery: await deliveryOf(deps.admin, idempotencyKey),
  };
}

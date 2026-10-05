import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getCrmCustomerDisplayName, type CrmCustomerType } from '@/lib/domains/crm/customers';
import { FortnoxApiError, fortnoxDelete, fortnoxGet } from './client';
import type { FortnoxCustomer } from './types';

/**
 * Ta bort en kund — hos oss OCH i Fortnox, eller ingenstans.
 *
 * Reglerna (William 2026-10-02):
 *  - Bara en kund utan offerter, arbetsordrar och portalkoppling. Knappen är till för dubbletter och felregistreringar;
 *    kontaktpersoner följer med kunden (ON DELETE CASCADE) och samtal tappar bara kopplingen. Uppgifter likaså.
 *  - Säger Fortnox nej (kunden har fakturor eller andra dokument där) tas ingenting bort, och beskedet visas.
 *  - Bara admin. Routen kräver `crm.admin`, samma nyckel som raderingspolicyn `crm_customers_delete_admin`.
 *
 * 🧨 ORDNINGEN: spärren → Fortnox (läs, jämför, ta bort) → samtalens namn → vår rad.
 *  - Fortnox före vår rad: Fortnox-importen (`syncFortnoxCustomers`) skapar en rad för varje kundnummer den inte hittar
 *    hos oss, inaktiva också. En kund som bara försvann här hade kommit tillbaka vid nästa import.
 *  - En kund som Fortnox inte känner till (404) räknas som borttagen där: den togs bort direkt i Fortnox, eller av ett
 *    tidigare försök.
 *  - 🧨 FORTNOX ÅTERANVÄNDER KUNDNUMMER (uppmätt i testbolaget 2026-10-02: kund 21 raderad, nästa nya kund fick 21).
 *    Ett nummer på vår rad kan alltså tillhöra en ANNAN kund i Fortnox — togs vår kund bort direkt i Fortnox och en ny
 *    skapades efteråt. Kunden läses därför först och jämförs med kortet (`sameFortnoxCustomer`); stämmer den inte tas
 *    ingenting bort. Och går vår radering fel efter Fortnox ja kopplas numret loss från vår rad.
 *  - 🧨 Jämförelsen räcker inte ensam för ett OMFÖRSÖK: Fortnox-importen matchar på nummer och skriver över vår rad med
 *    den nya kundens namn och org.nr, och efter det går jämförelsen igenom. Ett läge där vår rad kan stå kvar med ett
 *    nummer Fortnox redan tagit bort får därför aldrig sluta i "försök igen": ett osäkert svar på borttagningen avgörs
 *    direkt genom att läsa om kunden, och bara när det inte går (eller numret inte kunde kopplas loss) avråder beskedet.
 *  - Samtalens namn: `crm_calls_reference_or_company_check` kräver prospect_id, customer_id eller company_name, och båda
 *    id:na blir NULL när kunden raderas (ON DELETE SET NULL). Ett samtal loggat på kundkortet utan eget företagsnamn hade
 *    fällt hela raderingen — efter att Fortnox redan sagt ja. Samtalet får kundens namn, samma namn det visades med.
 *    Görs EFTER Fortnox, så ett nej lämnar samtalen orörda.
 *
 * Känd gräns: en offert eller arbetsorder som skapas mellan spärren och raderingen tappar kopplingen (SET NULL) i
 * stället för att stoppa raderingen. Fönstret är en Fortnox-rundresa, och den som raderar är admin på en kund som
 * nyss saknade dokument.
 */

/** Det som hindrar att kunden tas bort. Portalen räknar partner, återförsäljare, portaljobb och butiksbeställningar. */
export type CustomerDeletionBlockers = { quotes: number; workOrders: number; portal: number };

export function customerDeletionBlocked(blockers: CustomerDeletionBlockers): boolean {
  return blockers.quotes > 0 || blockers.workOrders > 0 || blockers.portal > 0;
}

function countNoun(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "Kunden har 3 offerter och 1 arbetsorder och kan inte tas bort." — null när ingenting spärrar. */
export function describeCustomerDeletionBlockers(blockers: CustomerDeletionBlockers): string | null {
  const parts = [
    blockers.quotes > 0 ? countNoun(blockers.quotes, 'offert', 'offerter') : null,
    blockers.workOrders > 0 ? countNoun(blockers.workOrders, 'arbetsorder', 'arbetsordrar') : null,
    blockers.portal > 0 ? countNoun(blockers.portal, 'koppling till partnerportalen', 'kopplingar till partnerportalen') : null,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} och ${parts[parts.length - 1]}`;
  return `Kunden har ${list} och kan inte tas bort.`;
}

/** Fortnox känner inte till kundnumret: DELETE och GET på ett raderat nummer svarar 404 (testbolaget 2026-10-02). */
export function fortnoxCustomerAlreadyGone(e: unknown): boolean {
  return e instanceof FortnoxApiError && e.status === 404;
}

function digitsOf(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function normalizedName(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Det Fortnox-kunden jämförs på: samma två fält som `buildFortnoxCustomerPayload` skickar. */
export type FortnoxCustomerIdentity = { name: string | null; organisationNumber: string | null };

/**
 * Är Fortnox-kunden bakom numret samma kund som kortet? Org.numret (personnumret för en privatperson, i samma fält i
 * Fortnox) avgör när båda har ett — de tio sista siffrorna, så 19800101-1234 och 800101-1234 är samma. Annars namnet,
 * utan hänsyn till versaler och mellanslag. Hellre ett nej för mycket: då tas ingenting bort, och ett namn som drivit
 * isär rättas på kortet (sparandet skriver namnet till Fortnox).
 */
export function sameFortnoxCustomer(
  customer: Pick<DeleteRow, 'customer_type' | 'company_name' | 'first_name' | 'last_name' | 'organization_number' | 'personal_number'>,
  fortnox: FortnoxCustomerIdentity,
): boolean {
  const isBusiness = customer.customer_type === 'business';
  const ours = digitsOf(isBusiness ? customer.organization_number : customer.personal_number);
  const theirs = digitsOf(fortnox.organisationNumber);
  if (ours.length >= 10 && theirs.length >= 10) return ours.slice(-10) === theirs.slice(-10);

  const name = normalizedName(isBusiness
    ? customer.company_name
    : [customer.first_name, customer.last_name].filter(Boolean).join(' '));
  return name !== '' && name === normalizedName(fortnox.name);
}

/** Fortnox svarade nej (4xx). 404 räknas inte — det är "redan borttagen". */
function fortnoxRefused(e: unknown): boolean {
  return e instanceof FortnoxApiError && e.status >= 400 && e.status < 500 && e.status !== 404;
}

/**
 * Kunden togs inte bort i Fortnox, eller vi vet inte. `fortnoxError` bär Fortnox fel.
 *
 * `deleted`: 'no' när det är säkert att ingenting är borttaget (läsningen föll, Fortnox sa nej, eller kunden fanns kvar
 * vid omläsningen efter ett osäkert svar). 'unknown' när borttagningen fick ett nätverksfel eller 5xx och omläsningen
 * också föll — den kan ha hunnit fram, och vår rad står kvar med numret.
 */
export class CustomerFortnoxDeleteError extends Error {
  constructor(
    public readonly fortnoxCustomerNumber: string,
    public readonly fortnoxError: unknown,
    public readonly deleted: 'no' | 'unknown',
  ) {
    super(`Fortnox tog inte bort kund ${fortnoxCustomerNumber}`);
    this.name = 'CustomerFortnoxDeleteError';
  }
}

/**
 * Kunden står kvar hos oss. Med ett `fortnoxCustomerNumber` är den redan borttagen i Fortnox (eller fanns inte där);
 * `detached` säger om numret hann kopplas loss från vår rad, så att ett nytt försök inte går till Fortnox igen.
 */
export class CustomerLocalDeleteError extends Error {
  constructor(
    message: string,
    public readonly fortnoxCustomerNumber: string | null,
    public readonly detached: boolean = false,
  ) {
    super(message);
    this.name = 'CustomerLocalDeleteError';
  }
}

type DeleteRow = {
  id: string;
  customer_type: CrmCustomerType;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  organization_number: string | null;
  personal_number: string | null;
  fortnox_customer_id: string | null;
};

export type CustomerDeleteDeps = {
  read: (customerId: string) => Promise<DeleteRow | null>;
  countBlockers: (customerId: string) => Promise<CustomerDeletionBlockers>;
  /** Kunden bakom numret i Fortnox, eller null när Fortnox inte känner till numret. */
  readFortnoxCustomer: (fortnoxCustomerNumber: string) => Promise<FortnoxCustomerIdentity | null>;
  deleteInFortnox: (fortnoxCustomerNumber: string) => Promise<void>;
  /** Ger kundens samtal utan eget företagsnamn kundens namn. Se ORDNINGEN ovan. */
  nameUnnamedCalls: (customerId: string, name: string) => Promise<void>;
  /** true när raden togs bort, false när ingen rad matchade (redan borta, eller nekad av RLS). */
  deleteRow: (customerId: string) => Promise<boolean>;
  /** Tar bort Fortnox-numret från vår rad. Se ÅTERANVÄNDER KUNDNUMMER ovan. */
  detachFortnoxNumber: (customerId: string) => Promise<void>;
};

/**
 * Räknar rader i `table` som pekar på kunden — via `customer_id`, och via `prospect_id` där tabellen har en sådan
 * (offerter och arbetsordrar: prospektet är samma rad i crm_customers). Kastar hellre än svarar noll: noll betyder
 * "ta bort".
 */
async function countLinkedRows(admin: SupabaseClient, table: string, alsoProspect: boolean, customerId: string) {
  const query = admin.from(table).select('customer_id', { count: 'exact', head: true });
  const { count, error } = await (alsoProspect
    ? query.or(`customer_id.eq.${customerId},prospect_id.eq.${customerId}`)
    : query.eq('customer_id', customerId));
  if (error) throw new Error(`Kopplingarna i ${table} gick inte att läsa: ${error.message}`);
  return count ?? 0;
}

/**
 * Raderingen och samtalen går genom sessionen, så databasens egen policy (`crm.admin`) prövar dem också. Spärren läser
 * elevated: den måste se varje rad som pekar på kunden, och sessionen får inte ens läsa `customer_id` i
 * `crm_portal_jobs` (kolumngrant) — en sessionsräkning hade felat där, eller svarat noll under RLS och släppt igenom.
 */
export function customerDeleteDeps(session: SupabaseClient): CustomerDeleteDeps {
  const admin = getSupabaseAdmin();
  return {
    read: async (id) => {
      const { data, error } = await session
        .from('crm_customers')
        .select('id, customer_type, company_name, first_name, last_name, organization_number, personal_number, fortnox_customer_id')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`Kunden gick inte att läsa: ${error.message}`);
      return (data as DeleteRow | null) ?? null;
    },
    countBlockers: async (id) => {
      const [quotes, workOrders, partners, resellers, jobs, storeOrders] = await Promise.all([
        countLinkedRows(admin, 'crm_quotes', true, id),
        countLinkedRows(admin, 'crm_work_orders', true, id),
        countLinkedRows(admin, 'crm_portal_partners', false, id),
        countLinkedRows(admin, 'crm_portal_resellers', false, id),
        countLinkedRows(admin, 'crm_portal_jobs', false, id),
        countLinkedRows(admin, 'crm_store_orders', false, id),
      ]);
      return { quotes, workOrders, portal: partners + resellers + jobs + storeOrders };
    },
    readFortnoxCustomer: async (customerNumber) => {
      try {
        const { Customer } = await fortnoxGet<{ Customer: FortnoxCustomer }>(`/customers/${encodeURIComponent(customerNumber)}`);
        return { name: Customer?.Name ?? null, organisationNumber: Customer?.OrganisationNumber ?? null };
      } catch (e) {
        if (fortnoxCustomerAlreadyGone(e)) return null;
        throw e;
      }
    },
    deleteInFortnox: (customerNumber) => fortnoxDelete(`/customers/${encodeURIComponent(customerNumber)}`),
    nameUnnamedCalls: async (id, name) => {
      // Bara samtal som annars bryter CHECK:en: båda referenserna blir NULL. Ett samtal vars andra referens pekar på en
      // kund som står kvar behåller sin koppling och behöver inget namn — fick det det här skulle det bära fel bolag.
      const { error } = await session
        .from('crm_calls')
        .update({ company_name: name })
        .is('company_name', null)
        .or([
          `and(customer_id.eq.${id},prospect_id.is.null)`,
          `and(customer_id.eq.${id},prospect_id.eq.${id})`,
          `and(customer_id.is.null,prospect_id.eq.${id})`,
        ].join(','));
      if (error) throw new Error(`Samtalen gick inte att märka med kundens namn: ${error.message}`);
    },
    deleteRow: async (id) => {
      // `.select()` för att se att raden faktiskt försvann: en DELETE som RLS filtrerar bort svarar `error: null`.
      const { data, error } = await session.from('crm_customers').delete().eq('id', id).select('id').maybeSingle();
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
    detachFortnoxNumber: async (id) => {
      const { data, error } = await session
        .from('crm_customers')
        .update({ fortnox_customer_id: null, sync_status: 'not_synced' })
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (error || !data) throw new Error(error?.message || 'Ingen rad uppdaterades.');
    },
  };
}

export type DeleteCustomerResult =
  /** Borttagen här, och i Fortnox när den hade ett nummer (`fortnoxCustomerNumber`). */
  | { kind: 'deleted'; fortnoxCustomerNumber: string | null }
  | { kind: 'not_found' }
  /** Kunden har offerter, arbetsordrar eller portalkoppling. Ingenting gjort, Fortnox inte tillfrågat. */
  | { kind: 'blocked'; blockers: CustomerDeletionBlockers }
  /** Kunden bakom numret i Fortnox är inte kortets kund (`sameFortnoxCustomer`). Ingenting gjort. */
  | { kind: 'fortnox_mismatch'; fortnoxCustomerNumber: string; fortnoxName: string | null };

/**
 * Tar bort kunden i Fortnox och sedan hos oss. Se reglerna och ordningen överst i filen.
 *
 * Kastar `CustomerFortnoxDeleteError` när Fortnox säger nej eller inte svarar (se `deleted`) och
 * `CustomerLocalDeleteError` när vår radering faller efter Fortnox. Läsfel före Fortnox kastas som de är.
 */
export async function deleteCrmCustomerWithFortnox(
  customerId: string,
  deps: CustomerDeleteDeps,
): Promise<DeleteCustomerResult> {
  const customer = await deps.read(customerId);
  if (!customer) return { kind: 'not_found' };

  const blockers = await deps.countBlockers(customerId);
  if (customerDeletionBlocked(blockers)) return { kind: 'blocked', blockers };

  const fortnoxCustomerNumber = customer.fortnox_customer_id?.trim() || null;
  if (fortnoxCustomerNumber) {
    let fortnoxCustomer: FortnoxCustomerIdentity | null;
    try {
      fortnoxCustomer = await deps.readFortnoxCustomer(fortnoxCustomerNumber);
    } catch (e) {
      throw new CustomerFortnoxDeleteError(fortnoxCustomerNumber, e, 'no');
    }
    // null: Fortnox känner inte till numret — borttagen där redan. Annars måste det vara vår kund.
    if (fortnoxCustomer) {
      if (!sameFortnoxCustomer(customer, fortnoxCustomer)) {
        return { kind: 'fortnox_mismatch', fortnoxCustomerNumber, fortnoxName: fortnoxCustomer.name };
      }
      try {
        await deps.deleteInFortnox(fortnoxCustomerNumber);
      } catch (e) {
        if (!fortnoxCustomerAlreadyGone(e)) {
          if (fortnoxRefused(e)) throw new CustomerFortnoxDeleteError(fortnoxCustomerNumber, e, 'no');
          // Nätverksfel eller 5xx: borttagningen kan ha hunnit fram. Avgör det NU — se OMFÖRSÖK överst.
          let after: FortnoxCustomerIdentity | null;
          try {
            after = await deps.readFortnoxCustomer(fortnoxCustomerNumber);
          } catch {
            throw new CustomerFortnoxDeleteError(fortnoxCustomerNumber, e, 'unknown');
          }
          if (after) throw new CustomerFortnoxDeleteError(fortnoxCustomerNumber, e, 'no');
          // Borta: borttagningen gick fram trots felet. Vidare till vår rad.
        }
      }
    }
  }

  try {
    await deps.nameUnnamedCalls(customerId, getCrmCustomerDisplayName(customer));
    if (!await deps.deleteRow(customerId)) throw new Error('Ingen rad togs bort.');
  } catch (e) {
    const message = (e as Error)?.message || 'Okänt fel';
    if (!fortnoxCustomerNumber) throw new CustomerLocalDeleteError(message, null);
    let detached = false;
    try {
      await deps.detachFortnoxNumber(customerId);
      detached = true;
    } catch (detachError) {
      console.error('[crm] Fortnox-numret kunde inte kopplas loss efter raderingen i Fortnox', {
        customerId, fortnoxCustomerNumber, error: (detachError as Error)?.message,
      });
    }
    throw new CustomerLocalDeleteError(message, fortnoxCustomerNumber, detached);
  }

  return { kind: 'deleted', fortnoxCustomerNumber };
}

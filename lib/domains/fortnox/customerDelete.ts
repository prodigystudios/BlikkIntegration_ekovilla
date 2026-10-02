import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getCrmCustomerDisplayName, type CrmCustomerType } from '@/lib/domains/crm/customers';
import { FortnoxApiError, fortnoxDelete } from './client';

/**
 * Ta bort en kund — hos oss OCH i Fortnox, eller ingenstans.
 *
 * Reglerna (William 2026-10-02):
 *  - Bara en kund utan offerter, arbetsordrar och portalkoppling. Knappen är till för dubbletter och felregistreringar;
 *    kontaktpersoner följer med kunden (ON DELETE CASCADE) och samtal tappar bara kopplingen. Uppgifter likaså.
 *  - Säger Fortnox nej (kunden har fakturor eller andra dokument där) tas ingenting bort, och beskedet visas.
 *  - Bara admin. Routen kräver `crm.admin`, samma nyckel som raderingspolicyn `crm_customers_delete_admin`.
 *
 * 🧨 ORDNINGEN: spärren → Fortnox → samtalens namn → vår rad.
 *  - Fortnox före vår rad: Fortnox-importen (`syncFortnoxCustomers`) skapar en rad för varje kundnummer den inte hittar
 *    hos oss, inaktiva också. En kund som bara försvann här hade kommit tillbaka vid nästa import.
 *  - En kund som Fortnox inte känner till räknas som borttagen där. Går vår radering fel efter Fortnox ja står kunden
 *    kvar här med ett nummer som inte finns längre — ett nytt försök tar sig då förbi Fortnox och läker det.
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
    blockers.portal > 0 ? countNoun(blockers.portal, 'koppling till återförsäljarportalen', 'kopplingar till återförsäljarportalen') : null,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} och ${parts[parts.length - 1]}`;
  return `Kunden har ${list} och kan inte tas bort.`;
}

/**
 * Fortnox känner inte till kundnumret. 404 är vad API:t svarar på ett okänt nummer; koden 2000433 ("Kunde inte hitta
 * kund") är samma besked när det kommer som 400.
 */
export function fortnoxCustomerAlreadyGone(e: unknown): boolean {
  return e instanceof FortnoxApiError && (e.status === 404 || e.fortnoxCode === 2000433);
}

/** Fortnox tog inte bort kunden. Ingenting är borttaget, varken där eller här. `fortnoxError` bär Fortnox fel. */
export class CustomerFortnoxDeleteError extends Error {
  constructor(public readonly fortnoxCustomerNumber: string, public readonly fortnoxError: unknown) {
    super(`Fortnox tog inte bort kund ${fortnoxCustomerNumber}`);
    this.name = 'CustomerFortnoxDeleteError';
  }
}

/** Kunden är borttagen i Fortnox (eller fanns inte där) men står kvar hos oss. Ett nytt försök läker det. */
export class CustomerLocalDeleteError extends Error {
  constructor(message: string, public readonly fortnoxCustomerNumber: string | null) {
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
  fortnox_customer_id: string | null;
};

export type CustomerDeleteDeps = {
  read: (customerId: string) => Promise<DeleteRow | null>;
  countBlockers: (customerId: string) => Promise<CustomerDeletionBlockers>;
  deleteInFortnox: (fortnoxCustomerNumber: string) => Promise<void>;
  /** Ger kundens samtal utan eget företagsnamn kundens namn. Se ORDNINGEN ovan. */
  nameUnnamedCalls: (customerId: string, name: string) => Promise<void>;
  /** true när raden togs bort, false när ingen rad matchade (redan borta, eller nekad av RLS). */
  deleteRow: (customerId: string) => Promise<boolean>;
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
        .select('id, customer_type, company_name, first_name, last_name, fortnox_customer_id')
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
    deleteInFortnox: (customerNumber) => fortnoxDelete(`/customers/${encodeURIComponent(customerNumber)}`),
    nameUnnamedCalls: async (id, name) => {
      const { error } = await session
        .from('crm_calls')
        .update({ company_name: name })
        .or(`customer_id.eq.${id},prospect_id.eq.${id}`)
        .is('company_name', null);
      if (error) throw new Error(`Samtalen gick inte att märka med kundens namn: ${error.message}`);
    },
    deleteRow: async (id) => {
      // `.select()` för att se att raden faktiskt försvann: en DELETE som RLS filtrerar bort svarar `error: null`.
      const { data, error } = await session.from('crm_customers').delete().eq('id', id).select('id').maybeSingle();
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
  };
}

export type DeleteCustomerResult =
  /** Borttagen här, och i Fortnox när den hade ett nummer (`fortnoxCustomerNumber`). */
  | { kind: 'deleted'; fortnoxCustomerNumber: string | null }
  | { kind: 'not_found' }
  /** Kunden har offerter, arbetsordrar eller portalkoppling. Ingenting gjort, Fortnox inte tillfrågat. */
  | { kind: 'blocked'; blockers: CustomerDeletionBlockers };

/**
 * Tar bort kunden i Fortnox och sedan hos oss. Se reglerna och ordningen överst i filen.
 *
 * Kastar `CustomerFortnoxDeleteError` när Fortnox säger nej eller inte svarar (ingenting borttaget) och
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
    try {
      await deps.deleteInFortnox(fortnoxCustomerNumber);
    } catch (e) {
      if (!fortnoxCustomerAlreadyGone(e)) throw new CustomerFortnoxDeleteError(fortnoxCustomerNumber, e);
    }
  }

  try {
    await deps.nameUnnamedCalls(customerId, getCrmCustomerDisplayName(customer));
    if (!await deps.deleteRow(customerId)) throw new Error('Ingen rad togs bort.');
  } catch (e) {
    throw new CustomerLocalDeleteError((e as Error)?.message || 'Okänt fel', fortnoxCustomerNumber);
  }

  return { kind: 'deleted', fortnoxCustomerNumber };
}

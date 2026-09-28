import type { SupabaseClient } from '@supabase/supabase-js';
import { getCrmCustomerDisplayName, type CrmCustomerType } from '@/lib/domains/crm/customers';

/**
 * Butikerna i återförsäljarportalen och reserven för fördelningen (`crm_portal_resellers`, `crm_portal_settings`;
 * RESELLER_PORTAL_CRM_PLAN.md fas 3a). Läsningar och de två ändringar sidan gör: butikens säljare och reserven.
 *
 * SESSIONSKLIENTEN: RLS kräver crm.portal.manage, och sessionen får bara ändra just de kolumnerna (kolumngrant).
 * Butikerna läggs till och uppdateras av jobbets intag (fas 3b) med service-rollen. Att den som väljs kan skriva
 * arbetsordrar prövar routen innan den sparar (`userCanWriteWorkOrders` i assignment.ts).
 */

/**
 * Portalens id:n: samma tecken som i sökvägar (planens punkt 16) och migreringens check. Ett id av bara punkter
 * (`.`, `..`) nekas: webbläsaren skriver om det i adressen, och sidan hade aldrig kunnat spara butiken.
 */
export const RESELLER_ID_PATTERN = /^(?!\.+$)[A-Za-z0-9._~-]{1,100}$/;

export type PortalReseller = {
  resellerId: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  /** Kundnumret i Fortnox som portalen senast skickade. null = butiken är inte kopplad i portalen. */
  customerNumber: string | null;
  customerId: string | null;
  /** Kundkortets namn, om butiken är kopplad till ett. */
  customerName: string | null;
  sellerUserId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

const RESELLER_SELECT = `reseller_id, name, street, postal_code, city, customer_number, customer_id, seller_user_id,
  first_seen_at, last_seen_at, customer:crm_customers(customer_type, company_name, first_name, last_name)`;

type ResellerRow = {
  reseller_id: string;
  name: string;
  street: string;
  postal_code: string;
  city: string;
  customer_number: string | null;
  customer_id: string | null;
  seller_user_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  customer: { customer_type: CrmCustomerType; company_name: string | null; first_name: string | null; last_name: string | null } | null;
};

export function toPortalReseller(row: ResellerRow): PortalReseller {
  return {
    resellerId: row.reseller_id,
    name: row.name,
    street: row.street,
    postalCode: row.postal_code,
    city: row.city,
    customerNumber: row.customer_number,
    customerId: row.customer_id,
    // Kundkortet kan vara dolt för sessionen (RLS) fast kopplingen finns; då visas numret utan namn.
    customerName: row.customer ? getCrmCustomerDisplayName(row.customer) : null,
    sellerUserId: row.seller_user_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** Alla butiker, i bokstavsordning. Några tiotal som mest, långt under PostgRESTs tak på 1000. */
export async function listPortalResellers(session: SupabaseClient): Promise<PortalReseller[]> {
  const { data, error } = await session.from('crm_portal_resellers').select(RESELLER_SELECT).order('name').order('reseller_id');
  if (error) throw new Error(`Butikerna gick inte att läsa: ${error.message}`);
  return ((data ?? []) as unknown as ResellerRow[]).map(toPortalReseller);
}

export type PortalSettings = { fallbackUserId: string | null; updatedAt: string | null };

export async function getPortalSettings(session: SupabaseClient): Promise<PortalSettings> {
  const { data, error } = await session.from('crm_portal_settings').select('fallback_user_id, updated_at').eq('id', true).maybeSingle();
  if (error) throw new Error(`Portalens inställningar gick inte att läsa: ${error.message}`);
  const row = data as { fallback_user_id: string | null; updated_at: string } | null;
  return { fallbackUserId: row?.fallback_user_id ?? null, updatedAt: row?.updated_at ?? null };
}

export type SaveAssigneeResult =
  | { kind: 'saved'; userId: string | null }
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'db_error'; message: string };

/**
 * Sparar och läser tillbaka raden. En UPDATE som RLS stoppar, eller som inte träffar någon rad, ger inget fel i
 * PostgREST, bara noll rader: därför `not_found` när ingen rad kommer tillbaka.
 */
async function saveAssignee(
  query: PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>,
  column: string,
): Promise<SaveAssigneeResult> {
  const { data, error } = await query;
  if (error) {
    if (error.code === '42501') return { kind: 'forbidden' };
    if (error.code === '23503') return { kind: 'db_error', message: 'Användaren finns inte.' };
    return { kind: 'db_error', message: error.message };
  }
  if (!data) return { kind: 'not_found' };
  const value = (data as Record<string, unknown>)[column];
  return { kind: 'saved', userId: typeof value === 'string' ? value : null };
}

export function setResellerSeller(
  session: SupabaseClient,
  resellerId: string,
  sellerUserId: string | null,
  actorId: string,
): Promise<SaveAssigneeResult> {
  return saveAssignee(
    session
      .from('crm_portal_resellers')
      .update({ seller_user_id: sellerUserId, updated_by: actorId })
      .eq('reseller_id', resellerId)
      .select('seller_user_id')
      .maybeSingle(),
    'seller_user_id',
  );
}

export function setPortalFallbackUser(session: SupabaseClient, userId: string | null, actorId: string): Promise<SaveAssigneeResult> {
  return saveAssignee(
    session
      .from('crm_portal_settings')
      .update({ fallback_user_id: userId, updated_by: actorId })
      .eq('id', true)
      .select('fallback_user_id')
      .maybeSingle(),
    'fallback_user_id',
  );
}

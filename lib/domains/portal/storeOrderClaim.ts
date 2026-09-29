import type { SupabaseClient } from '@supabase/supabase-js';
import { claimFortnoxPush } from '@/lib/domains/fortnox/helpers';
import { settle } from './settle';

/**
 * Claimarna på en butiksbeställning (RESELLER_PORTAL_CRM_PLAN.md fas 8b), med stämpel.
 *
 * Den delade claimen (`claimFortnoxPush`, samma som arbetsordern) säger inte vems den är: den sätter läget 'pending' och
 * tiden, och räknas som gammal efter två minuter. Här läses tiden direkt efter att claimen tagits (ingen annan kan ta den
 * förrän den är gammal), och varje steg släpper och skriver bara med sin egen stämpel. Så kan ett försök vars claim
 * blivit gammal aldrig släppa en claim som någon annan tagit över (pushen, fas 8b1, och Levererad, Fakturera och
 * Makulera, 8b2).
 */

const TABLE = 'crm_store_orders';

export type StoreOrderClaimColumns = readonly [status: string, claimedAt: string];
export const STORE_ORDER_CLAIM: StoreOrderClaimColumns = ['fortnox_order_sync_status', 'fortnox_order_claimed_at'];
export const STORE_ORDER_INVOICE_CLAIM: StoreOrderClaimColumns = ['fortnox_invoice_sync_status', 'fortnox_invoice_claimed_at'];

/**
 * Tar claimen och läser dess stämpel (tiden den togs). null: någon annan håller den, eller den hann släppas före
 * läsningen (upptagen). Går stämpeln inte att läsa släpps claimen, bara om den togs efter anropet, till `dropValue`
 * (synkläget som det var), och felet kastas.
 */
export async function takeStoreOrderClaim(
  admin: SupabaseClient,
  id: string,
  [status, claimedAt]: StoreOrderClaimColumns,
  dropValue: string,
): Promise<string | null> {
  // En millisekund före: claimen stämplas med samma klocka (claimFortnoxPush), och en stämpel i samma millisekund räknas.
  const since = new Date(Date.now() - 1).toISOString();
  if (!(await claimFortnoxPush(admin, TABLE, id, status, claimedAt))) return null;
  const read = await settle(admin.from(TABLE).select(claimedAt).eq('id', id).maybeSingle());
  const stamp = (read.data as Record<string, unknown> | null)?.[claimedAt];
  if (!read.error && typeof stamp === 'string') return stamp;
  if (!read.error) return null;
  const dropped = await settle(
    admin.from(TABLE).update({ [status]: dropValue, [claimedAt]: null }).eq('id', id).eq(status, 'pending').gt(claimedAt, since),
  );
  if (dropped.error) console.error('[portal-store-orders] claimen kunde inte släppas', { id, claim: status, error: dropped.error.message });
  throw new Error(`Claimen gick inte att läsa: ${read.error?.message ?? 'ingen stämpel'}`);
}

/** Släpper claimen, bara om den fortfarande är den egna (stämpeln). Ett fel loggas bara: den blir gammal efter två minuter. */
export async function releaseStoreOrderClaim(
  admin: SupabaseClient,
  id: string,
  [status, claimedAt]: StoreOrderClaimColumns,
  stamp: string,
  value: string,
): Promise<void> {
  const released = await settle(admin.from(TABLE).update({ [status]: value, [claimedAt]: null }).eq('id', id).eq(claimedAt, stamp));
  if (released.error) console.error('[portal-store-orders] claimen kunde inte släppas', { id, claim: status, error: released.error.message });
}

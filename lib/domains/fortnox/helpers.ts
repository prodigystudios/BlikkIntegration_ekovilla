import { getSupabaseAdmin } from '@/lib/supabase/server';

// A Fortnox push completes well within this window; a 'pending' claim older than this is
// treated as abandoned (a crashed/timed-out request) and may be re-claimed, so the guard
// can never permanently deadlock a document.
const PUSH_CLAIM_STALE_MS = 120_000;

// Atomically claims the right to push a row to Fortnox so two concurrent requests
// (a double-clicked button, the auto-push-on-create racing a manual "Skicka till Fortnox",
// or a retried POST) can't each create a DUPLICATE Fortnox document.
//
// It flips `statusCol` to 'pending' and stamps `claimedAtCol`, but ONLY when no fresh claim
// is already held — i.e. the status is not already 'pending', or the existing 'pending' claim
// is stale (a crashed/timed-out push). Returns true iff this caller acquired the claim.
//
// IMPORTANT: this can't be one UPDATE with an .or() filter. PostgREST rejects a logical
// .or()/.and() filter on a mutation, raising a misleading "column <x> does not exist" even
// for columns that plainly exist (they work in SELECT and in the SET clause). So we express
// the "claim unless a fresh pending claim is held" condition as TWO single-predicate
// conditional UPDATEs. Each is still one atomic statement, so PostgreSQL's READ COMMITTED
// re-evaluation keeps it race-safe across instances: of two concurrent claimers, only one
// flips the row and the other matches 0 rows.
export async function claimFortnoxPush(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: 'crm_work_orders' | 'crm_quotes',
  id: string,
  statusCol: string,
  claimedAtCol: string,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - PUSH_CLAIM_STALE_MS).toISOString();
  const stamp = { [statusCol]: 'pending', [claimedAtCol]: new Date().toISOString() };

  // A DB error here is NOT a lost claim — swallowing it would masquerade a real failure
  // (rejected filter, missing column, constraint) as "another push is already in progress"
  // and permanently deadlock the document. Fail loudly so the actual cause surfaces.
  const fail = (e: { message: string }, phase: string): never => {
    throw new Error(`[Fortnox] push-claim (${phase}) mot ${table}/${id} misslyckades: ${e.message}`);
  };

  // 1) Normal case: the row isn't currently held — claim it. Covers every non-'pending'
  //    status (not_synced / synced / failed), which is also the only state a never-claimed
  //    row is in. One concurrent claimer wins; the other re-reads 'pending' → 0 rows.
  const first = await supabase
    .from(table).update(stamp).eq('id', id).neq(statusCol, 'pending').select('id');
  if (first.error) fail(first.error, 'normal');
  if (Array.isArray(first.data) && first.data.length > 0) return true;

  // 2) The row IS 'pending' but the claim is stale (a crashed/timed-out push) — re-claim it,
  //    so the guard can never permanently deadlock. A 'pending' row always carries a
  //    claimedAt (stamped together with the status here), so a timestamp test is sufficient.
  const second = await supabase
    .from(table).update(stamp).eq('id', id).eq(statusCol, 'pending').lt(claimedAtCol, staleBefore).select('id');
  if (second.error) fail(second.error, 'stale');
  return Array.isArray(second.data) && second.data.length > 0;
}

// Resolve whether a Fortnox document should be reverse-charge VAT (omvänd skattskyldighet /
// byggmoms). The point-in-time `customer_snapshot.reverse_vat` is authoritative when present
// (set at quote/order creation). Legacy rows whose snapshot predates the flag fall back to the
// live customer record. Drives both the document VATType and the 0 % row VAT in the push.
export async function resolveReverseVat(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  snapshotReverseVat: boolean | null | undefined,
  customerId: string | null | undefined,
): Promise<boolean> {
  if (typeof snapshotReverseVat === 'boolean') return snapshotReverseVat;
  if (!customerId) return false;
  const { data } = await supabase
    .from('crm_customers')
    .select('reverse_vat')
    .eq('id', customerId)
    .maybeSingle();
  return (data as { reverse_vat?: boolean | null } | null)?.reverse_vat === true;
}

// Looks up the assigned user's full name for use as OurReference in Fortnox documents.
export async function resolveOurReference(
  userId: string | null,
  supabase: ReturnType<typeof getSupabaseAdmin>,
): Promise<string | undefined> {
  if (!userId) return undefined;
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();
  return (data as { full_name?: string | null } | null)?.full_name ?? undefined;
}

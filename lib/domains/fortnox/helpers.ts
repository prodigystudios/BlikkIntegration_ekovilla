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
// is already held — i.e. the status is not already 'pending', or the existing claim is
// stale/absent. The conditional UPDATE is a single statement, so PostgreSQL's READ COMMITTED
// re-evaluation makes it race-safe across serverless instances: the loser of two concurrent
// claims matches 0 rows. Returns true iff this caller acquired the claim.
export async function claimFortnoxPush(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: 'crm_work_orders' | 'crm_quotes',
  id: string,
  statusCol: string,
  claimedAtCol: string,
): Promise<boolean> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - PUSH_CLAIM_STALE_MS).toISOString();
  const { data } = await supabase
    .from(table)
    .update({ [statusCol]: 'pending', [claimedAtCol]: now.toISOString() })
    .eq('id', id)
    // Claim only if no live push holds it: status not pending, OR the prior claim is
    // absent/stale. (`.or()` combines with the `.eq('id', …)` as AND.)
    .or(`${statusCol}.neq.pending,${claimedAtCol}.is.null,${claimedAtCol}.lt.${staleBefore}`)
    .select('id');
  return Array.isArray(data) && data.length > 0;
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

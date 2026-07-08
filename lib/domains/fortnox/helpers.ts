import { getSupabaseAdmin } from '@/lib/supabase/server';
import { parseDecimal } from '@/lib/shared/number';
import { DEFAULT_ROT_HOUSE_WORK_TYPE } from './types';

// The standing Fortnox article that aggregated per-row ROT labour is booked to. A ROT deduction
// may only be claimed on the LABOUR portion, not material — so labour carved out of material rows
// (each row's `labor_cost`) is summed onto this single husarbete row instead of flagging the
// material rows themselves. Rows a seller marks fully as ROT work (is_rot_work) keep their own
// article/price/type and are NOT folded in here.
export const ROT_LABOR_ARTICLE_NUMBER = '10058';
export const ROT_LABOR_DESCRIPTION = 'Arbetskostnad ROT';

// The ROT labour carved out of a single row (kr, ex VAT), clamped to the row's own net so the
// remaining material can never go negative. Returns 0 when it's not a ROT document, when the row is
// already fully flagged as ROT work (is_rot_work — its whole amount is labour, handled separately),
// or when no labour was entered. `rowNet` is the row's discounted total (lineItemRowTotal).
export function rowRotLaborCarveout(
  item: { labor_cost?: string | null; is_rot_work?: boolean | null },
  rowNet: number,
  rotEnabled: boolean,
): number {
  if (!rotEnabled || item.is_rot_work) return 0;
  const labor = item.labor_cost ? parseDecimal(item.labor_cost) : 0;
  if (!(labor > 0)) return 0;
  return Math.min(labor, Math.max(0, rowNet));
}

// Split a carved ROT material row so the two resulting rows' ROUNDED totals still sum to the row's
// rounded total — no drift versus the CRM total. Fortnox stores a row Price at 2 decimals and
// re-multiplies by the quantity, so we (a) round the reduced material unit price to 2 dp, then
// (b) let the aggregated labour absorb whatever rounding residual that leaves. Returns the unit
// price to send on the material row and the labour amount to add to the aggregated husarbete row.
export function splitRotMaterialRow(
  rowNet: number,
  quantity: number,
  carve: number,
): { materialUnitPrice: number; labour: number } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const targetTotal = round2(rowNet);
  const materialNet = Math.max(0, rowNet - carve);
  const materialUnitPrice = quantity > 0 ? round2(materialNet / quantity) : round2(materialNet);
  const materialShown = quantity > 0 ? round2(quantity * materialUnitPrice) : materialUnitPrice;
  // Residual (rowNet rounding + material-unit rounding) rides on the labour row, so material +
  // labour is exact to the öre. Clamp at 0: for an absurd sub-öre carve the material rounding can
  // exceed the carve and drive this negative, which must never pollute the aggregated labour total.
  const labour = Math.max(0, round2(targetTotal - materialShown));
  return { materialUnitPrice, labour };
}

// The aggregated "Arbetskostnad ROT" husarbete row appended to a ROT document once material rows
// have carved out labour. Returns null when nothing was carved (so no empty row is emitted). The
// shape is quantity-agnostic: each builder spreads the quantity key it needs (offers → Quantity,
// orders → OrderedQuantity/DeliveredQuantity, invoices → DeliveredQuantity). `vat` is the row VAT
// already resolved by the caller (0 % under reverse charge, though that never co-occurs with ROT).
export function rotLaborRow(total: number, vat: number): {
  ArticleNumber: string;
  Description: string;
  Price: number;
  VAT: number;
  HouseWork: true;
  HouseWorkType: string;
} | null {
  const price = Math.round(total * 100) / 100;
  if (!(price > 0)) return null;
  return {
    ArticleNumber: ROT_LABOR_ARTICLE_NUMBER,
    Description: ROT_LABOR_DESCRIPTION,
    Price: price,
    VAT: vat,
    HouseWork: true,
    HouseWorkType: DEFAULT_ROT_HOUSE_WORK_TYPE,
  };
}

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

// Builds the Fortnox Remarks line for a separate on-site contact (slutkund) captured on the
// quote/order outside the customer card. Returns null when no on-site contact was entered, so
// the caller can conditionally include it. Kept document-level (Remarks) rather than a line-item
// row — it's not a priced row and reads better as a note.
export function buildEndContactNote(
  snapshot: { end_contact_name?: string | null; end_contact_phone?: string | null; end_contact_email?: string | null } | null | undefined,
): string | null {
  const name = snapshot?.end_contact_name?.trim();
  const phone = snapshot?.end_contact_phone?.trim();
  const email = snapshot?.end_contact_email?.trim();
  const parts = [name, phone, email].filter(Boolean);
  return parts.length ? `Kontaktperson på arbetsplatsen: ${parts.join(', ')}` : null;
}

// Builds a ROT property note (Fastighetsbeteckning + BRF org.nr) for a text row on the
// offer/order/invoice. Fortnox has NO API field for the ROT property designation — it must be
// typed manually into the husarbete dialog — so we surface it as a plain comment line for whoever
// finalizes the invoice. Returns null when nothing was entered. Both values share ONE line
// (double-space separated) so they never become two consecutive text rows (which Fortnox turns
// into a bogus priced row). Newlines are stripped by Fortnox, so whitespace is the separator.
export function buildRotPropertyNote(
  rot: { property_designation?: string | null; brf_org_number?: string | null } | null | undefined,
): string | null {
  const property = rot?.property_designation?.trim();
  const brf = rot?.brf_org_number?.trim();
  const parts: string[] = [];
  if (property) parts.push(`Fastighetsbeteckning: ${property}`);
  if (brf) parts.push(`BRF org.nr: ${brf}`);
  return parts.length ? parts.join('  ') : null;
}

// Appends a document-level text note to a Fortnox row list WITHOUT creating two consecutive
// text rows — Fortnox treats a second consecutive text row (Description only, no amounts) as a
// new priced product row. If the last row is already a text row we merge the note into it
// (double-space separated); otherwise we push a new text row. Mutates and returns `rows`.
export function appendFortnoxTextNote<T extends { Description: string }>(
  rows: T[], note: string | null | undefined,
): T[] {
  if (!note) return rows;
  const last = rows[rows.length - 1];
  const lastIsTextRow = !!last && Object.keys(last).length === 1 && 'Description' in last;
  if (lastIsTextRow) {
    last.Description = `${last.Description}  ${note}`;
  } else {
    rows.push({ Description: note } as T);
  }
  return rows;
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

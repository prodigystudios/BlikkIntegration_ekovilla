import type { SupabaseClient } from '@supabase/supabase-js';
import type { ComposedOrder, OrderLine, OtherLine } from './materialOrders';
import type { ExpectedDeliveryStatus } from './expectedDeliveries';
import type { OrderEmailLanguage } from './materialOrderEmail';

// Materialbeställningarnas läsningar och skrivningar. Tunna: reglerna bor i ./materialOrders.ts och i
// databasen (supabase/sql/20260917_ops_material_orders.sql).
//
// 🧨 SESSIONSKLIENTEN, ALLTID. RLS kräver planning.depot.manage, och RPC:erna prövar has_permission på
// auth.uid() — under service-role är den null och grinden nekar. Mottagare, mailtext och leverantörsnamn finns
// bara i den här tabellen; läs dem aldrig via en embed från ops_expected_deliveries.

export type MaterialOrderStatus = 'draft' | 'sending' | 'sent';

export type MaterialOrder = {
  id: string;
  order_no: number;
  supplier_id: string | null;
  status: MaterialOrderStatus;
  lines: OrderLine[];
  other_lines: OtherLine[];
  message: string | null;
  revision: number;
  supplier_name: string | null;
  recipient_email: string | null;
  from_address: string | null;
  reply_to: string | null;
  bcc: string | null;
  email_language: OrderEmailLanguage | null;
  email_subject: string | null;
  email_text: string | null;
  composed_by_name: string | null;
  send_attempt: number;
  attempt_started_at: string | null;
  last_try_at: string | null;
  send_error: string | null;
  send_error_code: string | null;
  provider_message_id: string | null;
  sent_at: string | null;
  sent_by_name: string | null;
  verified_by_name: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

const ORDER_SELECT =
  'id, order_no, supplier_id, status, lines, other_lines, message, revision, supplier_name, recipient_email, ' +
  'from_address, reply_to, bcc, email_language, email_subject, email_text, composed_by_name, send_attempt, ' +
  'attempt_started_at, last_try_at, send_error, send_error_code, provider_message_id, sent_at, sent_by_name, ' +
  'verified_by_name, created_by_name, created_at, updated_at';

function toOrder(row: Record<string, any>): MaterialOrder {
  return {
    id: row.id,
    order_no: Number(row.order_no),
    supplier_id: row.supplier_id ?? null,
    status: row.status,
    lines: Array.isArray(row.lines) ? row.lines : [],
    other_lines: Array.isArray(row.other_lines) ? row.other_lines : [],
    message: row.message ?? null,
    revision: Number(row.revision),
    supplier_name: row.supplier_name ?? null,
    recipient_email: row.recipient_email ?? null,
    from_address: row.from_address ?? null,
    reply_to: row.reply_to ?? null,
    bcc: row.bcc ?? null,
    email_language: row.email_language ?? null,
    email_subject: row.email_subject ?? null,
    email_text: row.email_text ?? null,
    composed_by_name: row.composed_by_name ?? null,
    send_attempt: Number(row.send_attempt),
    attempt_started_at: row.attempt_started_at ?? null,
    last_try_at: row.last_try_at ?? null,
    send_error: row.send_error ?? null,
    send_error_code: row.send_error_code ?? null,
    provider_message_id: row.provider_message_id ?? null,
    sent_at: row.sent_at ?? null,
    sent_by_name: row.sent_by_name ?? null,
    verified_by_name: row.verified_by_name ?? null,
    created_by_name: row.created_by_name ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

type DbError = { message: string; code?: string } | null;

/** De öppna (utkast och pågående utskick) och de senaste skickade. */
export async function listOrders(
  supabase: SupabaseClient,
  opts: { sentLimit: number },
): Promise<{ data: MaterialOrder[]; error: DbError }> {
  const [open, sent] = await Promise.all([
    supabase.from('ops_material_orders').select(ORDER_SELECT).in('status', ['draft', 'sending']).order('created_at', { ascending: false }),
    supabase
      .from('ops_material_orders')
      .select(ORDER_SELECT)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(opts.sentLimit),
  ]);
  if (open.error) return { data: [], error: open.error };
  if (sent.error) return { data: [], error: sent.error };
  return { data: [...(open.data ?? []), ...(sent.data ?? [])].map((r) => toOrder(r as Record<string, any>)), error: null };
}

export async function getOrder(supabase: SupabaseClient, id: string): Promise<{ data: MaterialOrder | null; error: DbError }> {
  const { data, error } = await supabase.from('ops_material_orders').select(ORDER_SELECT).eq('id', id).maybeSingle();
  if (error) return { data: null, error };
  return { data: data ? toOrder(data as Record<string, any>) : null, error: null };
}

/** Den öppna ordern till en leverantör, om det finns en — svaret på en 23505 vid skapande. */
export async function findOpenOrderForSupplier(
  supabase: SupabaseClient,
  supplierId: string,
): Promise<{ data: { id: string; order_no: number; status: MaterialOrderStatus } | null; error: DbError }> {
  const { data, error } = await supabase
    .from('ops_material_orders')
    .select('id, order_no, status')
    .eq('supplier_id', supplierId)
    .in('status', ['draft', 'sending'])
    .maybeSingle();
  if (error) return { data: null, error };
  return { data: data ? { id: data.id, order_no: Number(data.order_no), status: data.status } : null, error: null };
}

/** Skapa ett tomt utkast (för att få ett ordernummer att rendera mailet med). */
export async function insertDraft(
  supabase: SupabaseClient,
  input: { supplierId: string; actorUserId: string; actorName: string | null },
): Promise<{ data: MaterialOrder | null; error: DbError }> {
  const { data, error } = await supabase
    .from('ops_material_orders')
    .insert({ supplier_id: input.supplierId, created_by: input.actorUserId, created_by_name: input.actorName })
    .select(ORDER_SELECT)
    .single();
  if (error) return { data: null, error };
  return { data: toOrder(data as Record<string, any>), error: null };
}

/**
 * Skriv en sammansatt order på ett utkast. Villkoras på status 'draft' OCH revisionen läsaren såg — databasen
 * kräver revision+1, och två admins i samma utkast skriver då inte tyst över varandra. data null = någon annan
 * hann före (eller utkastet är skickat/slängt).
 */
export async function writeComposed(
  supabase: SupabaseClient,
  id: string,
  revision: number,
  composed: ComposedOrder,
): Promise<{ data: MaterialOrder | null; error: DbError }> {
  const { data, error } = await supabase
    .from('ops_material_orders')
    .update({ ...composed, revision: revision + 1 })
    .eq('id', id)
    .eq('status', 'draft')
    .eq('revision', revision)
    .select(ORDER_SELECT)
    .maybeSingle();
  if (error) return { data: null, error };
  return { data: data ? toOrder(data as Record<string, any>) : null, error: null };
}

export async function deleteDraft(supabase: SupabaseClient, id: string): Promise<{ deleted: boolean; error: DbError }> {
  const { data, error } = await supabase.from('ops_material_orders').delete().eq('id', id).eq('status', 'draft').select('id').maybeSingle();
  if (error) return { deleted: false, error };
  return { deleted: Boolean(data), error: null };
}

/** Bokför ett oklart utfall på det pågående försöket. Rör aldrig utskickstillståndet (det gör bara RPC:erna). */
export async function recordSendError(
  supabase: SupabaseClient,
  id: string,
  attempt: number,
  code: string,
  message: string,
): Promise<void> {
  await supabase
    .from('ops_material_orders')
    .update({ send_error: message.slice(0, 1000), send_error_code: code.slice(0, 100) })
    .eq('id', id)
    .eq('status', 'sending')
    .eq('send_attempt', attempt);
}

/** Status på de väntade leveranser en skickad order gav upphov till, per order. */
export async function expectedStatusesForOrders(
  supabase: SupabaseClient,
  orderIds: string[],
): Promise<{ data: Map<string, { status: ExpectedDeliveryStatus }[]>; error: DbError }> {
  const out = new Map<string, { status: ExpectedDeliveryStatus }[]>();
  // Portioner: `.in()` ligger i URL:en.
  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200);
    const { data, error } = await supabase.from('ops_expected_deliveries').select('order_id, status').in('order_id', chunk);
    if (error) return { data: out, error };
    for (const r of (data ?? []) as { order_id: string; status: ExpectedDeliveryStatus }[]) {
      const list = out.get(r.order_id) ?? [];
      list.push({ status: r.status });
      out.set(r.order_id, list);
    }
  }
  return { data: out, error: null };
}

// ---- RPC:erna ----------------------------------------------------------------

export type ClaimResult =
  | 'claimed'
  | 'reclaimed'
  | 'in_progress'
  | 'already_sent'
  | 'revision_changed'
  | 'attempt_changed'
  | 'window_expired'
  | 'not_reviewed'
  | 'lines_invalid'
  | 'not_found';

export async function claimSend(
  supabase: SupabaseClient,
  id: string,
  revision: number,
  attempt: number,
): Promise<{ data: ClaimResult | null; error: DbError }> {
  const { data, error } = await supabase.rpc('claim_material_order_send', { p_order_id: id, p_revision: revision, p_attempt: attempt });
  return { data: (data as ClaimResult) ?? null, error: error ?? null };
}

export async function finalizeSend(
  supabase: SupabaseClient,
  id: string,
  providerMessageId: string,
): Promise<{ data: number | null; error: DbError }> {
  const { data, error } = await supabase.rpc('finalize_material_order', { p_order_id: id, p_provider_message_id: providerMessageId });
  return { data: typeof data === 'number' ? data : data == null ? null : Number(data), error: error ?? null };
}

export type ReleaseResult = 'released' | 'stale' | 'retried' | 'not_found';

export async function releaseSend(
  supabase: SupabaseClient,
  id: string,
  attempt: number,
  code: string,
  message: string,
): Promise<{ data: ReleaseResult | null; error: DbError }> {
  const { data, error } = await supabase.rpc('release_material_order_send', {
    p_order_id: id,
    p_attempt: attempt,
    p_error_code: code,
    p_error: message,
  });
  return { data: (data as ReleaseResult) ?? null, error: error ?? null };
}

export type ResolveResult = 'marked_sent' | 'released' | 'window_open' | 'in_progress' | 'not_sending' | 'already_sent' | 'lines_invalid' | 'not_found';

export async function resolveSend(
  supabase: SupabaseClient,
  id: string,
  delivered: boolean,
): Promise<{ data: ResolveResult | null; error: DbError }> {
  const { data, error } = await supabase.rpc('resolve_material_order_send', { p_order_id: id, p_delivered: delivered });
  return { data: (data as ResolveResult) ?? null, error: error ?? null };
}

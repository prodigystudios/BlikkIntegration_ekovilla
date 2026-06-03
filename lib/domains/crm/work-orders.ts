import type { SupabaseClient } from '@supabase/supabase-js';
import { crmQuoteSelect } from './quotes';

export const crmWorkOrderSelect = `
  id,
  quote_id,
  prospect_id,
  order_number,
  project_name,
  client_name,
  quote_type,
  customer_snapshot,
  work_address,
  pricing_summary,
  line_items,
  rot_details,
  internal_handoff,
  currency_code,
  amount,
  vat_percent,
  desired_installation_date,
  source_status,
  status,
  notes,
  created_by,
  assigned_to,
  created_at,
  updated_at
`;

export const crmWorkOrderTimeEntrySelect = `
  id,
  work_order_id,
  user_id,
  work_date,
  hours,
  note,
  created_at,
  updated_at,
  user:profiles(
    id,
    full_name
  )
`;

export const crmWorkOrderCommentSelect = `
  id,
  work_order_id,
  created_by,
  body,
  created_at,
  author:profiles(
    id,
    full_name
  )
`;

export type CrmWorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'cancelled';

type WorkOrderAddress = {
  street_address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  delivery_address?: string | null;
  invoice_address?: string | null;
};

type WorkOrderUpdateInput = {
  status: CrmWorkOrderStatus;
  desired_installation_date: string | null;
  notes: string | null;
  internal_handoff: Record<string, any>;
  work_address: WorkOrderAddress;
};

type CreateWorkOrderTimeEntryInput = {
  work_order_id: string;
  user_id: string;
  work_date: string;
  hours: number;
  note: string | null;
};

type CreateWorkOrderCommentInput = {
  work_order_id: string;
  created_by: string;
  body: string;
};

type QuoteSource = {
  id: string;
  prospect_id: string | null;
  customer_name: string | null;
  quote_type: 'private' | 'business';
  customer_snapshot: Record<string, any> | null;
  pricing_summary: Record<string, any> | null;
  line_items: Array<Record<string, any>> | null;
  rot_details: Record<string, any> | null;
  internal_handoff: Record<string, any> | null;
  project_name: string;
  description: string | null;
  amount: number;
  currency_code: string;
  vat_percent: number;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
  notes: string | null;
  created_by: string;
  assigned_to: string;
  work_order_id: string | null;
  work_order_number: string | null;
};

function buildWorkOrderNumber(quoteId: string) {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `AO-${datePart}-${quoteId.slice(0, 6).toUpperCase()}`;
}

function getClientName(source: QuoteSource) {
  return source.customer_snapshot?.customer_name
    || source.customer_snapshot?.company_name
    || source.customer_name
    || source.project_name;
}

function getWorkAddress(source: QuoteSource) {
  return {
    street_address: source.customer_snapshot?.visit_address || source.customer_snapshot?.street_address || null,
    postal_code: source.customer_snapshot?.postal_code || null,
    city: source.customer_snapshot?.city || null,
    delivery_address: source.customer_snapshot?.delivery_address || null,
    invoice_address: source.customer_snapshot?.invoice_address || null,
  };
}

export async function createCrmWorkOrderFromQuote(supabase: SupabaseClient, quoteId: string, actorUserId: string) {
  const quoteResult = await supabase
    .from('crm_quotes')
    .select('id, prospect_id, customer_name, quote_type, customer_snapshot, pricing_summary, line_items, rot_details, internal_handoff, project_name, description, amount, currency_code, vat_percent, status, notes, created_by, assigned_to, work_order_id, work_order_number')
    .eq('id', quoteId)
    .single<QuoteSource>();

  if (quoteResult.error) {
    return { data: null, error: quoteResult.error, reason: quoteResult.error.code === 'PGRST116' ? 'not_found' : 'quote_fetch_failed' as const };
  }

  const quote = quoteResult.data;

  if (!quote) {
    return { data: null, error: { message: 'Offerten hittades inte' }, reason: 'not_found' as const };
  }

  if (quote.status !== 'won') {
    return { data: null, error: { message: 'Arbetsorder kan bara skapas från vunnen offert' }, reason: 'quote_not_won' as const };
  }

  if (quote.work_order_id || quote.work_order_number) {
    return { data: null, error: { message: 'Arbetsorder finns redan för offerten' }, reason: 'already_created' as const };
  }

  const orderNumber = buildWorkOrderNumber(quote.id);

  const createResult = await supabase
    .from('crm_work_orders')
    .insert({
      quote_id: quote.id,
      prospect_id: quote.prospect_id,
      order_number: orderNumber,
      project_name: quote.project_name,
      client_name: getClientName(quote),
      quote_type: quote.quote_type,
      customer_snapshot: quote.customer_snapshot || {},
      work_address: getWorkAddress(quote),
      pricing_summary: quote.pricing_summary || {},
      line_items: quote.line_items || [],
      rot_details: quote.rot_details || {},
      internal_handoff: quote.internal_handoff || {},
      currency_code: quote.currency_code || 'SEK',
      amount: quote.amount || 0,
      vat_percent: quote.vat_percent || 25,
      desired_installation_date: quote.internal_handoff?.desired_installation_date || null,
      source_status: quote.status,
      status: 'draft',
      notes: quote.internal_handoff?.handoff_notes || quote.notes || quote.description || null,
      created_by: actorUserId,
      assigned_to: quote.assigned_to,
    })
    .select(crmWorkOrderSelect)
    .single();

  if (createResult.error) {
    return { data: null, error: createResult.error, reason: createResult.error.code === '23505' ? 'already_created' as const : 'work_order_create_failed' as const };
  }

  const workOrder = createResult.data;

  const quoteUpdateResult = await supabase
    .from('crm_quotes')
    .update({
      work_order_id: workOrder.id,
      work_order_number: workOrder.order_number,
      converted_to_work_order_at: new Date().toISOString(),
      converted_to_work_order_by: actorUserId,
    })
    .eq('id', quote.id)
    .select(crmQuoteSelect)
    .single();

  if (quoteUpdateResult.error) {
    return { data: null, error: quoteUpdateResult.error, reason: 'quote_update_failed' as const };
  }

  return {
    data: {
      item: quoteUpdateResult.data,
      workOrder,
    },
    error: null,
    reason: null,
  };
}

export async function listCrmWorkOrdersWithFilters(
  supabase: SupabaseClient,
  options: { search?: string; status?: CrmWorkOrderStatus; workOrderId?: string; customerId?: string },
) {
  let query = supabase
    .from('crm_work_orders')
    .select(crmWorkOrderSelect)
    .order('desired_installation_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100);

  if (options.search) {
    query = query.or(
      `order_number.ilike.%${options.search}%,project_name.ilike.%${options.search}%,client_name.ilike.%${options.search}%,notes.ilike.%${options.search}%`,
    );
  }

  if (options.status) {
    query = query.eq('status', options.status);
  }

  if (options.workOrderId) {
    query = query.eq('id', options.workOrderId);
  }

  if (options.customerId) {
    query = query.eq('customer_id', options.customerId);
  }

  return query;
}

export async function updateCrmWorkOrder(supabase: SupabaseClient, id: string, input: WorkOrderUpdateInput) {
  return supabase.from('crm_work_orders').update(input).eq('id', id).select(crmWorkOrderSelect).single();
}

export async function listCrmWorkOrderTimeEntries(supabase: SupabaseClient, workOrderId: string) {
  return supabase
    .from('crm_work_order_time_entries')
    .select(crmWorkOrderTimeEntrySelect)
    .eq('work_order_id', workOrderId)
    .order('work_date', { ascending: false })
    .order('created_at', { ascending: false });
}

export async function createCrmWorkOrderTimeEntry(supabase: SupabaseClient, input: CreateWorkOrderTimeEntryInput) {
  return supabase.from('crm_work_order_time_entries').insert(input).select(crmWorkOrderTimeEntrySelect).single();
}

export async function listCrmWorkOrderComments(supabase: SupabaseClient, workOrderId: string) {
  return supabase
    .from('crm_work_order_comments')
    .select(crmWorkOrderCommentSelect)
    .eq('work_order_id', workOrderId)
    .order('created_at', { ascending: false });
}

export async function createCrmWorkOrderComment(supabase: SupabaseClient, input: CreateWorkOrderCommentInput) {
  return supabase.from('crm_work_order_comments').insert(input).select(crmWorkOrderCommentSelect).single();
}
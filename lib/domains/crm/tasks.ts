import type { SupabaseClient } from '@supabase/supabase-js';

export const crmTaskSelect = `
  id,
  user_id,
  kind,
  title,
  body,
  status,
  due_at,
  remind_at,
  completed_at,
  created_at,
  updated_at,
  related_type,
  related_id,
  metadata
`;

type CrmTaskStatus = 'open' | 'done' | 'cancelled';
type CrmTaskPriority = 'low' | 'normal' | 'high';

type CreateCrmTaskInput = {
  prospect_id: string | null;
  user_id: string;
  title: string;
  details: string | null;
  status: CrmTaskStatus;
  priority: CrmTaskPriority;
  due_date: string | null;
  remind_at: string | null;
  source: string | null;
  completed_at: string | null;
};

type UpdateCrmTaskInput = Omit<CreateCrmTaskInput, 'user_id'>;

type ListCrmTasksOptions = {
  search?: string;
  status?: CrmTaskStatus;
  prospectId?: string;
};

type RawCrmTaskRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  status: 'active' | 'done' | 'cancelled' | string;
  due_at: string | null;
  remind_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  related_type: string | null;
  related_id: string | null;
  metadata: Record<string, unknown> | null;
};

function getTaskPriority(value: unknown): CrmTaskPriority {
  return value === 'low' || value === 'high' || value === 'normal' ? value : 'normal';
}

export function mapCrmTaskRow(row: RawCrmTaskRow) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const source = typeof metadata.source === 'string' ? metadata.source : null;

  return {
    id: row.id,
    prospect_id: row.related_type === 'crm_prospect' ? row.related_id : null,
    user_id: row.user_id,
    title: row.title,
    details: row.body,
    status: row.status === 'done' ? 'done' : row.status === 'cancelled' ? 'cancelled' : 'open',
    priority: getTaskPriority((metadata as Record<string, unknown>).priority),
    due_date: row.due_at ? String(row.due_at).slice(0, 10) : null,
    remind_at: row.remind_at,
    source,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapCrmTaskRows(rows: RawCrmTaskRow[] | null | undefined) {
  return (rows || []).map(mapCrmTaskRow);
}

export async function listCrmTasks(supabase: SupabaseClient, options: ListCrmTasksOptions) {
  let query = supabase.from('dashboard_work_items').select(crmTaskSelect).eq('kind', 'note').order('status', { ascending: true }).order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).limit(100);

  if (options.search) {
    query = query.or(`title.ilike.%${options.search}%,body.ilike.%${options.search}%`);
  }

  if (options.status) {
    const dbStatus = options.status === 'done' ? 'done' : options.status === 'cancelled' ? 'cancelled' : 'active';
    query = query.eq('status', dbStatus);
  }

  if (options.prospectId) {
    query = query.eq('related_type', 'crm_prospect').eq('related_id', options.prospectId);
  }

  return query;
}

export async function createCrmTask(supabase: SupabaseClient, input: CreateCrmTaskInput) {
  const result = await supabase.from('dashboard_work_items').insert({
    user_id: input.user_id,
    kind: 'note',
    title: input.title,
    body: input.details,
    status: input.status === 'done' ? 'done' : input.status === 'cancelled' ? 'cancelled' : 'active',
    due_at: input.due_date ? `${input.due_date}T12:00:00.000Z` : null,
    remind_at: input.remind_at,
    related_type: input.prospect_id ? 'crm_prospect' : null,
    related_id: input.prospect_id,
    metadata: {
      priority: input.priority,
      source: input.source,
      crm: true,
    },
    completed_at: input.completed_at,
  }).select(crmTaskSelect).single();

  return {
    ...result,
    data: result.data ? mapCrmTaskRow(result.data as RawCrmTaskRow) : null,
  };
}

export async function updateCrmTask(supabase: SupabaseClient, id: string, input: UpdateCrmTaskInput) {
  const result = await supabase.from('dashboard_work_items').update({
    title: input.title,
    body: input.details,
    status: input.status === 'done' ? 'done' : input.status === 'cancelled' ? 'cancelled' : 'active',
    due_at: input.due_date ? `${input.due_date}T12:00:00.000Z` : null,
    remind_at: input.remind_at,
    related_type: input.prospect_id ? 'crm_prospect' : null,
    related_id: input.prospect_id,
    metadata: {
      priority: input.priority,
      source: input.source,
      crm: true,
    },
    completed_at: input.completed_at,
  }).eq('id', id).select(crmTaskSelect).single();

  return {
    ...result,
    data: result.data ? mapCrmTaskRow(result.data as RawCrmTaskRow) : null,
  };
}
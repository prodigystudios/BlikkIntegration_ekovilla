import type { SupabaseClient } from '@supabase/supabase-js';

export const crmTaskSelect = `
  id,
  user_id,
  created_by,
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

// A task can be linked to one CRM entity via the polymorphic related_type/related_id.
export type CrmRelatedType = 'crm_prospect' | 'crm_customer' | 'crm_quote';

type CreateCrmTaskInput = {
  related_type: CrmRelatedType | null;
  related_id: string | null;
  related_label: string | null;
  user_id: string;
  // Vem som skapade uppgiften. Skiljer sig från user_id när en chef lagt den på en säljare.
  created_by: string;
  title: string;
  details: string | null;
  status: CrmTaskStatus;
  priority: CrmTaskPriority;
  due_date: string | null;
  remind_at: string | null;
  source: string | null;
  completed_at: string | null;
};

// Varken ägare eller skapare ändras vid redigering: en uppgift flyttas inte mellan personer,
// den skapas åt rätt person från början. Skaparen är dessutom ett historiskt faktum.
type UpdateCrmTaskInput = Omit<CreateCrmTaskInput, 'user_id' | 'created_by'>;

type ListCrmTasksOptions = {
  search?: string;
  status?: CrmTaskStatus;
  prospectId?: string;
  customerId?: string;
  limit?: number;
};

// Taket när anroparen inte ber om något. Har alltid funnits, men var hårdkodat.
const CRM_TASKS_DEFAULT_LIMIT = 100;

type RawCrmTaskRow = {
  id: string;
  user_id: string;
  created_by: string | null;
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
  const relatedLabel = typeof (metadata as Record<string, unknown>).related_label === 'string'
    ? ((metadata as Record<string, unknown>).related_label as string)
    : null;
  const relatedType: CrmRelatedType | null =
    row.related_type === 'crm_prospect' || row.related_type === 'crm_customer' || row.related_type === 'crm_quote'
      ? row.related_type
      : null;

  return {
    id: row.id,
    related_type: relatedType,
    related_id: relatedType ? row.related_id : null,
    related_label: relatedType ? relatedLabel : null,
    // Back-compat: keep prospect_id populated when the relation is a prospect.
    prospect_id: relatedType === 'crm_prospect' ? row.related_id : null,
    user_id: row.user_id,
    created_by: row.created_by ?? null,
    // Uppgiften är delegerad när skaparen inte är den som ska göra den. Härleds här i stället
    // för i varje vy — både uppgiftslistan och mottagarens rad behöver samma bedömning, och
    // äldre rader (skapade före kolumnen fanns) har created_by null och är alltså inte delegerade.
    delegated: Boolean(row.created_by && row.created_by !== row.user_id),
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
  let query = supabase.from('dashboard_work_items').select(crmTaskSelect).eq('kind', 'note').order('status', { ascending: true }).order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).limit(options.limit ?? CRM_TASKS_DEFAULT_LIMIT);

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

  if (options.customerId) {
    query = query.eq('related_type', 'crm_customer').eq('related_id', options.customerId);
  }

  return query;
}

/**
 * Uppgifter som `creatorUserId` skapat ÅT NÅGON ANNAN.
 *
 * Kräver en elevated klient: raderna tillhör mottagaren, och tabellens SELECT-policy är
 * egen-bara. Policyn lämnas medvetet orörd — se huvudkommentaren i
 * 20260817_dashboard_work_items_created_by.sql för varför en vidgad policy hade läckt in i
 * den personliga dashboarden.
 *
 * Elevationen är ofarlig därför att filtret är slutet om anroparen själv: `created_by` måste
 * vara hen, och `user_id` måste vara någon annan. Inget annat blir läsbart. Anropas ALDRIG med
 * ett creatorUserId som kommer från klienten — bara från den inloggade sessionen.
 */
export async function listCrmTasksDelegatedBy(
  admin: SupabaseClient,
  creatorUserId: string,
  options: { search?: string } = {}
) {
  let query = admin
    .from('dashboard_work_items')
    .select(crmTaskSelect)
    .eq('kind', 'note')
    .eq('created_by', creatorUserId)
    .neq('user_id', creatorUserId);

  // Sökningen måste tillämpas här också. Klienten skickar samma `q` oavsett vy, och utan den
  // här grenen hade en sökning i den delegerade vyn tyst gett hela listan tillbaka.
  if (options.search) {
    query = query.or(`title.ilike.%${options.search}%,body.ilike.%${options.search}%`);
  }

  return query
    .order('status', { ascending: true })
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100);
}

/**
 * Alla uppgifter som hör till en offert — oavsett vem de ligger på.
 *
 * Kräver en elevated klient, av samma skäl som listCrmTasksDelegatedBy ovan: tabellens
 * SELECT-policy är egen-bara, så med sessionsklienten hade två säljare sett olika flöden på
 * SAMMA offert. Policyn lämnas medvetet orörd — se huvudkommentaren i
 * 20260817_dashboard_work_items_created_by.sql för varför en vidgad policy hade läckt in i
 * allas personliga dashboard.
 *
 * Elevationen är trygg av tre skäl, och alla tre måste hålla:
 *
 * 1. Behörigheten kommer från OFFERTEN, inte från uppgiften. Anroparen (rutten) måste ha läst
 *    offerten med sessionsklienten först — syns den inte, körs den här frågan aldrig.
 * 2. Urvalet kan inte råka träffa en privat anteckning. `related_type` skrivs bara av
 *    createCrmTask/updateCrmTask här i CRM-domänen; dashboardens egen composer
 *    (components/dashboard/DashboardNotes.tsx) sätter aldrig kolumnen. En rad med
 *    related_type='crm_quote' ÄR per konstruktion en CRM-uppgift.
 * 3. `kind='note'` håller möten utanför.
 *
 * ⚠️ related_id är en TEXT-kolumn, inte uuid. quoteId skickas som sträng.
 */
export async function listCrmQuoteTasks(admin: SupabaseClient, quoteId: string) {
  return admin
    .from('dashboard_work_items')
    .select(crmTaskSelect)
    .eq('kind', 'note')
    .eq('related_type', 'crm_quote')
    .eq('related_id', quoteId)
    // Samma ordning som listCrmTasks: öppna före klara, närmast förfallodatum först.
    .order('status', { ascending: true })
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(CRM_TASKS_DEFAULT_LIMIT);
}

/**
 * Sätter namn på den uppgiften ligger på, och på den som lade dit den.
 *
 * Kräver elevated klient: profiles-RLS är self-only, så varken klienten eller sessionsrutten kan
 * slå upp en kollegas namn. Samma skäl som notisrutten redan slår upp avsändaren elevated
 * (app/api/crm/tasks/route.ts). Utan det här steget hade offertens flöde visat rå uuid:n för allt
 * som ligger på någon annan.
 *
 * Ett misslyckat uppslag är inte fatalt — raderna kommer tillbaka med null-namn, och UI:t visar
 * dem som "En kollega". En uppgiftslista utan namn är sämre, men en tom lista är värre.
 */
export async function attachCrmTaskParticipantNames<T extends { user_id: string; created_by: string | null }>(
  admin: SupabaseClient,
  tasks: T[]
): Promise<Array<T & { assignee_name: string | null; creator_name: string | null }>> {
  const ids = Array.from(new Set(
    tasks.flatMap((task) => [task.user_id, task.created_by]).filter((id): id is string => Boolean(id))
  ));

  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await admin.from('profiles').select('id, full_name').in('id', ids);
    for (const row of (data || []) as Array<{ id: string; full_name: string | null }>) {
      if (row.full_name) names.set(row.id, row.full_name);
    }
  }

  return tasks.map((task) => ({
    ...task,
    assignee_name: names.get(task.user_id) ?? null,
    creator_name: task.created_by ? names.get(task.created_by) ?? null : null,
  }));
}

export async function createCrmTask(supabase: SupabaseClient, input: CreateCrmTaskInput) {
  const result = await supabase.from('dashboard_work_items').insert({
    user_id: input.user_id,
    created_by: input.created_by,
    kind: 'note',
    title: input.title,
    body: input.details,
    status: input.status === 'done' ? 'done' : input.status === 'cancelled' ? 'cancelled' : 'active',
    due_at: input.due_date ? `${input.due_date}T12:00:00.000Z` : null,
    remind_at: input.remind_at,
    related_type: input.related_id ? input.related_type : null,
    related_id: input.related_id,
    metadata: {
      priority: input.priority,
      source: input.source,
      related_label: input.related_id ? input.related_label : null,
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
    related_type: input.related_id ? input.related_type : null,
    related_id: input.related_id,
    metadata: {
      priority: input.priority,
      source: input.source,
      related_label: input.related_id ? input.related_label : null,
      crm: true,
    },
    completed_at: input.completed_at,
  }).eq('id', id).select(crmTaskSelect).single();

  return {
    ...result,
    data: result.data ? mapCrmTaskRow(result.data as RawCrmTaskRow) : null,
  };
}
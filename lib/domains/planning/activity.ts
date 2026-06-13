import type { SupabaseClient } from '@supabase/supabase-js';

// Activity log / audit trail for the CRM-first planning (Wave 7). Every schedule change is appended
// to ops_activity_events so planners can trace "who changed what, when". Writes are best-effort —
// a logging failure must NEVER break the user's action — so logActivity swallows its own errors.

export type ActivityEntityType = 'segment' | 'crew' | 'truck_crew' | 'day_note' | 'confirmation';

// The acting user. name is the durable display snapshot stored on the row (profiles are
// self-read-only, so the log can never re-read another planner's name).
export type ActivityActor = { id: string; name?: string | null };

export type LogActivityInput = {
  action: string; // dotted key, e.g. 'segment.create'
  entityType: ActivityEntityType;
  entityId?: string | null;
  workOrderId?: string | null;
  segmentId?: string | null;
  summary: string; // Swedish one-liner shown in the modal
  details?: Record<string, unknown>;
};

// Append one event. Best-effort: never throws, never returns an error to the caller — a broken
// audit write must not turn a successful placement into a failed request.
export async function logActivity(
  supabase: SupabaseClient,
  actor: ActivityActor,
  input: LogActivityInput,
): Promise<void> {
  try {
    const { error } = await supabase.from('ops_activity_events').insert({
      actor_id: actor.id,
      actor_name: actor.name ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      work_order_id: input.workOrderId ?? null,
      segment_id: input.segmentId ?? null,
      summary: input.summary,
      details: input.details ?? {},
    });
    if (error) console.error('[planning] logActivity failed:', error.message);
  } catch (e) {
    console.error('[planning] logActivity threw:', (e as Error)?.message);
  }
}

export type ActivityEvent = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  work_order_id: string | null;
  segment_id: string | null;
  summary: string | null;
  details: Record<string, unknown>;
};

const ACTIVITY_SELECT =
  'id, created_at, actor_id, actor_name, action, entity_type, entity_id, work_order_id, segment_id, summary, details';

export type ListActivityOptions = {
  limit: number;
  // Keyset pagination: only events strictly older than this ISO timestamp ("load more").
  before?: string | null;
  actor?: string | null; // case-insensitive substring over actor_name
  action?: string | null; // exact action key
  search?: string | null; // case-insensitive substring over summary
};

// Newest-first page of events for the activity modal. RLS (planning.schedule.read) applies.
export async function listActivityEvents(
  supabase: SupabaseClient,
  opts: ListActivityOptions,
): Promise<{ data: ActivityEvent[]; error: { message: string } | null }> {
  let q = supabase
    .from('ops_activity_events')
    .select(ACTIVITY_SELECT)
    .order('created_at', { ascending: false })
    .limit(opts.limit);

  if (opts.before) q = q.lt('created_at', opts.before);
  if (opts.actor) q = q.ilike('actor_name', `%${opts.actor}%`);
  if (opts.action) q = q.eq('action', opts.action);
  if (opts.search) q = q.ilike('summary', `%${opts.search}%`);

  const { data, error } = await q;
  return { data: (data ?? []) as ActivityEvent[], error };
}

// Pure summary/action builder for a segment PATCH — the patch carries several intents (move,
// reorder, set job type, pause/resume), so derive the action key + Swedish line from which fields
// were sent. Unit-tested; keep deterministic.
export function describeSegmentPatch(
  patch: {
    truckId?: string;
    startDay?: string;
    endDay?: string;
    sortIndex?: number;
    jobType?: string | null;
    onHold?: boolean;
  },
  ref: string,
): { action: string; summary: string } {
  if (patch.onHold === true) return { action: 'segment.hold', summary: `Pausade ${ref}` };
  if (patch.onHold === false) return { action: 'segment.resume', summary: `Återupptog ${ref}` };
  if (patch.truckId !== undefined || patch.startDay !== undefined || patch.endDay !== undefined) {
    return { action: 'segment.move', summary: `Flyttade ${ref}` };
  }
  if (patch.jobType !== undefined) return { action: 'segment.jobtype', summary: `Ändrade jobbtyp för ${ref}` };
  if (patch.sortIndex !== undefined) return { action: 'segment.reorder', summary: `Ändrade ordningen för ${ref}` };
  return { action: 'segment.update', summary: `Uppdaterade ${ref}` };
}

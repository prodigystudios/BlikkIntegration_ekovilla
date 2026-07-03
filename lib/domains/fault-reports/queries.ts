import type { SupabaseClient } from '@supabase/supabase-js';
import type { FaultStatus } from './types';

const faultReportSelect =
  'id, reporter_id, reporter_name, category, comment, status, reply, responder_id, responder_name, responded_at, created_at, updated_at';

// The caller's own reports ("Mina ärenden"). Small set (one user) — no pagination needed.
export async function listMyFaultReports(supabase: SupabaseClient, reporterId: string) {
  return supabase
    .from('fault_reports')
    .select(faultReportSelect)
    .eq('reporter_id', reporterId)
    .order('created_at', { ascending: false })
    .limit(100);
}

// Supervisor inbox. Constrained (optional status filter) + capped well under the PostgREST row
// cap. Unresolved-first isn't expressible in one order, so order by recency; the UI filters.
export async function listInboxFaultReports(supabase: SupabaseClient, options: { status?: FaultStatus } = {}) {
  let query = supabase
    .from('fault_reports')
    .select(faultReportSelect)
    .order('created_at', { ascending: false })
    .limit(200);

  if (options.status) {
    query = query.eq('status', options.status);
  }

  return query;
}

export async function getFaultReport(supabase: SupabaseClient, id: string) {
  return supabase.from('fault_reports').select(faultReportSelect).eq('id', id).maybeSingle();
}

// The append-only reply/status history for a report, oldest first (a timeline). RLS scopes it to
// the reporter or a supervisor.
export async function listFaultReportUpdates(supabase: SupabaseClient, reportId: string) {
  return supabase
    .from('fault_report_updates')
    .select('id, report_id, status, reply, responder_id, responder_name, created_at')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
    .limit(100);
}

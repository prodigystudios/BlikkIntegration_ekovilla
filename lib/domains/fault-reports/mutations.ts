import type { SupabaseClient } from '@supabase/supabase-js';
import type { CreateFaultReportInput, UpdateFaultReportInput } from './schemas';
import { mapFaultReportRow } from './mappers';
import type { FaultReportRow, FaultReportView } from './types';

const faultReportSelect =
  'id, reporter_id, reporter_name, category, comment, status, reply, responder_id, responder_name, responded_at, created_at, updated_at';

type MutationResult = { data: FaultReportView | null; error: { message: string; code?: string } | null };

// Create a fault report as the current user (session client — RLS enforces reporter_id).
export async function createFaultReport(
  supabase: SupabaseClient,
  input: CreateFaultReportInput & { reporter_id: string; reporter_name: string },
): Promise<MutationResult> {
  const result = await supabase
    .from('fault_reports')
    .insert({
      reporter_id: input.reporter_id,
      reporter_name: input.reporter_name,
      category: input.category,
      comment: input.comment,
    })
    .select(faultReportSelect)
    .single();

  return { data: result.data ? mapFaultReportRow(result.data as FaultReportRow) : null, error: result.error };
}

// Append one immutable history entry (status + reply at this moment). Called alongside
// updateFaultReport so the ärende keeps a timeline of everything a supervisor has sent.
export async function addFaultReportUpdate(
  supabase: SupabaseClient,
  input: { report_id: string; status: string; reply: string | null; responder_id: string; responder_name: string },
) {
  return supabase.from('fault_report_updates').insert({
    report_id: input.report_id,
    status: input.status,
    reply: input.reply,
    responder_id: input.responder_id,
    responder_name: input.responder_name,
  });
}

// Supervisor update: set status + reply, stamp responder + responded_at + updated_at.
export async function updateFaultReport(
  supabase: SupabaseClient,
  id: string,
  input: UpdateFaultReportInput & { responder_id: string; responder_name: string },
): Promise<MutationResult> {
  const now = new Date().toISOString();
  const result = await supabase
    .from('fault_reports')
    .update({
      status: input.status,
      reply: input.reply,
      responder_id: input.responder_id,
      responder_name: input.responder_name,
      responded_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .select(faultReportSelect)
    .single();

  return { data: result.data ? mapFaultReportRow(result.data as FaultReportRow) : null, error: result.error };
}

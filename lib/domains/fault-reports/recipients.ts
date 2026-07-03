import type { SupabaseClient } from '@supabase/supabase-js';

// The fixed, admin-managed set of arbetsledare who receive fault reports (in-app + email).

// List active recipient user_ids. Call with the service-role client (getSupabaseAdmin()) from the
// fan-out path so it sees every recipient regardless of the caller's RLS scope.
export async function listActiveRecipients(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin.from('fault_report_recipients').select('user_id').eq('active', true);
  if (error) return [];
  return dedupeRecipients((data || []).map((r: { user_id: string }) => r.user_id));
}

// Resolve emails for the given user_ids. Emails live on the auth user, not profiles, so this uses
// the admin auth API (service-role only). Tolerates missing/blank emails.
export async function resolveRecipientEmails(admin: SupabaseClient, userIds: string[]): Promise<string[]> {
  const emails: string[] = [];
  for (const id of dedupeRecipients(userIds)) {
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      const email = data?.user?.email?.trim();
      if (email) emails.push(email);
    } catch {
      /* skip an unresolvable recipient rather than failing the whole send */
    }
  }
  return dedupeEmails(emails);
}

// Pure helpers (unit tested).
export function dedupeRecipients(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const v = (id || '').trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function dedupeEmails(emails: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const v = (raw || '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

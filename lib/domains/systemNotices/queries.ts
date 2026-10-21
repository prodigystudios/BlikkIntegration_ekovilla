import type { SupabaseClient } from '@supabase/supabase-js';
import type { CreateSystemNoticeInput } from './schemas';

// EN literal — supabase-js typar svaret utifrån select-strängens literaltyp.
export const systemNoticeSelect = 'id, kind, message, affected_areas, starts_at, ends_at, created_by_name, created_at, updated_at';

// Taket är ett skydd mot en trasig rad, inte en urvalsregel: allvarligast-först sorteras i TS, efter taket, så ett
// tak som faktiskt nåddes hade kunnat kapa en störning. I praktiken är det ett eller två aktiva.
export const ACTIVE_NOTICES_CAP = 50;

// Det som är aktivt just nu. RLS släpper bara igenom aktiva rader till andra än admin — men admin ser allt, så filtret
// här är det som gör svaret till "det bannern ska visa" oavsett vem som frågar. Bara sluttiden: starts_at sätts av
// databasens klocka och jämförs inte med appens (se isSystemNoticeActive).
export function listActiveSystemNotices(supabase: SupabaseClient, now: string) {
  return supabase
    .from('app_system_notices')
    .select(systemNoticeSelect)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .order('starts_at', { ascending: false })
    .limit(ACTIVE_NOTICES_CAP);
}

// Admin-flikens historik, senast påslagna först. Aktiva hämtas för sig (listActiveSystemNotices): ett meddelande utan
// sluttid som slogs på för länge sedan hade annars kunnat falla ur listan — synligt för alla, men utan "Slå av nu".
export function listRecentSystemNotices(supabase: SupabaseClient, limit: number) {
  return supabase
    .from('app_system_notices')
    .select(systemNoticeSelect)
    .order('starts_at', { ascending: false })
    .limit(limit);
}

export function insertSystemNotice(
  supabase: SupabaseClient,
  input: CreateSystemNoticeInput & { created_by: string; created_by_name: string },
) {
  // starts_at, created_at och updated_at sätts av databasens now() (kolumnernas DEFAULT), samma klocka som RLS-policyn
  // jämför med. Med appserverns klocka hade ett meddelande kunnat vara osynligt tills klockorna gått i fas.
  return supabase
    .from('app_system_notices')
    .insert({
      kind: input.kind,
      message: input.message,
      affected_areas: input.affected_areas,
      ends_at: input.ends_at,
      created_by: input.created_by,
      created_by_name: input.created_by_name,
    })
    .select(systemNoticeSelect)
    .single();
}

// 🧨 PostgREST svarar `error: null` på en UPDATE/DELETE som RLS stoppat — 0 rader. `.select()` + maybeSingle gör det
// till `data: null`, som routen kan säga ifrån om.
export function updateSystemNotice(supabase: SupabaseClient, id: string, patch: Record<string, unknown>) {
  return supabase.from('app_system_notices').update(patch).eq('id', id).select(systemNoticeSelect).maybeSingle();
}

export function deleteSystemNotice(supabase: SupabaseClient, id: string) {
  return supabase.from('app_system_notices').delete().eq('id', id).select('id').maybeSingle();
}

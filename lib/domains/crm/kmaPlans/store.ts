import type { SupabaseClient } from '@supabase/supabase-js';

import type { KmaDirectoryEntry, KmaStoredPlanSource } from './prefill';

// Databasen för KMA-planerna — tunna frågor med SESSIONSKLIENTEN. RLS gör hela auktoriseringen
// (supabase/archive/sql/20260924_crm_work_order_kma_plans.sql): läsning kräver crm.workorder.read,
// skapande crm.workorder.write. Ingen fråga här eleverar sig, och ingen behöver: namn och nummer
// kommer ur Kontaktlistan, som varje inloggad redan läser.

const TABLE = 'crm_work_order_kma_plans';

const LIST_SELECT = 'id, revision, issued_on, project_name, created_by_name, created_at';
const SOURCE_SELECT = 'input, project_name, issued_on, created_by_name, revision';

export type KmaPlanListRow = {
  id: string;
  revision: number;
  issued_on: string;
  project_name: string;
  created_by_name: string;
  created_at: string;
};

export type KmaPlanInsert = {
  work_order_id: string;
  revision: number;
  issued_on: string;
  project_name: string;
  input: unknown;
  document: unknown;
  created_by: string;
  created_by_name: string;
};

/** Ordens revisioner, nyaste först. */
export async function listKmaPlans(supabase: SupabaseClient, workOrderId: string) {
  return supabase
    .from(TABLE)
    .select(LIST_SELECT)
    .eq('work_order_id', workOrderId)
    .order('revision', { ascending: false })
    .returns<KmaPlanListRow[]>();
}

/** Ordens senaste plan — källan vid Revidera. */
export async function latestKmaPlanForOrder(supabase: SupabaseClient, workOrderId: string) {
  return supabase
    .from(TABLE)
    .select(SOURCE_SELECT)
    .eq('work_order_id', workOrderId)
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle<KmaStoredPlanSource>();
}

/**
 * Den senaste plan en person skapat, på vilken order som helst — eller bolagets senaste när
 * `userId` är null. Förifyllnadens källa till organisationsblocket.
 *
 * Sista sorteringen är på `id`: två planer med samma tidsstämpel får inte byta plats mellan två
 * anrop (samma kontrakt som lib/domains/planning/pagedRead.ts kräver av en sortering).
 */
export async function latestKmaPlanBy(supabase: SupabaseClient, userId: string | null) {
  let query = supabase.from(TABLE).select(SOURCE_SELECT);
  if (userId) query = query.eq('created_by', userId);
  return query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle<KmaStoredPlanSource>();
}

/**
 * Nästa revisionsnummer och revision 1:s datum ("Upprättad").
 *
 * max + 1 räknas här och inte i databasen; två som sparar samtidigt krockar på det unika indexet
 * (work_order_id, revision) och rutten svarar 409 — hellre det än två planer med samma nummer.
 */
export async function kmaRevisionState(
  supabase: SupabaseClient,
  workOrderId: string,
): Promise<{ data: { next: number; firstIssuedOn: string | null } | null; error: { message: string; code?: string } | null }> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('revision, issued_on')
    .eq('work_order_id', workOrderId)
    .order('revision', { ascending: true })
    .returns<Array<{ revision: number; issued_on: string }>>();
  if (error) return { data: null, error };
  const rows = data ?? [];
  const last = rows[rows.length - 1];
  return { data: { next: (last?.revision ?? 0) + 1, firstIssuedOn: rows[0]?.issued_on ?? null }, error: null };
}

export async function insertKmaPlan(supabase: SupabaseClient, row: KmaPlanInsert) {
  return supabase.from(TABLE).insert(row).select(LIST_SELECT).single<KmaPlanListRow>();
}

/**
 * En revisions dokument, för PDF:en. Filtrerar på BÅDE id och order: en plan-id från en annan order
 * i URL:en ska ge 404, inte en annan kunds plan under den här orderns adress.
 */
export async function getKmaPlanDocument(supabase: SupabaseClient, workOrderId: string, planId: string) {
  return supabase
    .from(TABLE)
    .select('id, revision, document')
    .eq('id', planId)
    .eq('work_order_id', workOrderId)
    .maybeSingle<{ id: string; revision: number; document: unknown }>();
}

/**
 * Kontaktlistan (public.contacts) — telefonnumren till förifyllnaden och förslagen i dialogen.
 *
 * Läsbar för varje inloggad och kuraterad av admin, så självregistrerade konton finns aldrig här
 * ("inloggad" är inte "anställd"). Listan är liten; skulle den någon gång passera PostgRESTs tysta
 * tak på 1000 rader blir följden ett tomt nummerfält, aldrig ett felaktigt.
 */
export async function listKmaDirectory(supabase: SupabaseClient) {
  return supabase
    .from('contacts')
    .select('name, phone, role')
    .order('name', { ascending: true })
    .order('id', { ascending: true })
    .returns<KmaDirectoryEntry[]>();
}

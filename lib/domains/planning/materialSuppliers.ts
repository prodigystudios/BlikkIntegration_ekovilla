import type { SupabaseClient } from '@supabase/supabase-js';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';

// Leverantörsregistret: vem materialet beställs FRÅN.
//
// Registret är den saknade halvan av materialbeställningen. Systemet vet redan vad som behövs
// (bokade jobb, säckantal, material, depåkoppling) men ingenting om mottagaren. Här bor namn,
// adress, vilka material leverantören levererar och hur lång ledtid de har.
//
// 🧨 HELA REGISTRET LIGGER BAKOM planning.depot.manage, ÄVEN LÄSNING. Raden bär en mailadress och
// en kontaktperson. Rollen `konsult` håller planning.schedule.read, och Lager-området i
// planeringsadmin är öppet för alla — hade SELECT varit board-nivå (som ops_depots) vore
// fabrikernas adresser läsbara för varje konsult. Se RLS-noten i
// supabase/sql/20260910_ops_material_suppliers.sql.
//
// Rena hjälpare enhetstestas; DB-funktionerna är tunna RLS-avgränsade läsningar och skrivningar.

export type MaterialSupplier = {
  id: string;
  name: string;
  email: string;
  contact_name: string | null;
  phone: string | null;
  /** Kanoniska kortkoder ur MATERIAL_SHORTS. */
  materials: string[];
  lead_time_days: number;
  note: string | null;
  active: boolean;
};

const SUPPLIER_SELECT = 'id, name, email, contact_name, phone, materials, lead_time_days, note, active';

export type SupplierProblem =
  | 'name_required'
  | 'name_too_long'
  | 'email_required'
  | 'email_invalid'
  | 'materials_required'
  | 'material_unknown'
  | 'lead_time_invalid';

// Samma grovhet som resten av appen använder på en adress: ett tecken, ett @, en punkt i domänen.
// Den riktiga prövningen är att mailet går fram — det här fångar felskrivningen, inte allt.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Ren validering av en leverantör. Speglar createSupplierSchema i app/api/crm/planering/_lib.ts —
 * schemat är grinden som räknas, den här är samma regel i testbar form och för UI:t.
 *
 * ⚠️ TOM MATERIALLISTA VÄGRAS. En leverantör utan material matchar aldrig ett behov och blir
 * osynlig i mottagarvalet — men syns i registret, så det ser ut som om den vore upplagd. Databasen
 * tillåter det (kolumnen har `default '{}'`); regeln bor här och i Zod.
 */
export function validateSupplier(input: {
  name: string;
  email: string;
  materials: string[];
  leadTimeDays?: number;
}): SupplierProblem | null {
  const name = input.name.trim();
  if (!name) return 'name_required';
  if (name.length > 120) return 'name_too_long';

  const email = input.email.trim();
  if (!email) return 'email_required';
  if (!EMAIL.test(email)) return 'email_invalid';

  if (input.materials.length === 0) return 'materials_required';
  // Tecken för tecken mot katalogen. Ett material som inte finns i MATERIAL_SHORTS kan aldrig
  // matcha ett behov, och felet syns först när beställningen inte hittar någon mottagare.
  if (input.materials.some((m) => !MATERIAL_SHORTS.includes(m))) return 'material_unknown';

  const lead = input.leadTimeDays ?? 0;
  if (!Number.isInteger(lead) || lead < 0 || lead > 365) return 'lead_time_invalid';

  return null;
}

/**
 * Leverantörer som levererar ett visst material.
 *
 * 🧨 BARA AKTIVA. En avvecklad leverantör ligger kvar i registret för historikens skull, men får
 * aldrig bli mottagare av en ny beställning — det är hela skillnaden mellan att avaktivera och att
 * radera. Avaktiveringen vore verkningslös om urvalet inte respekterade den.
 *
 * Matchningen är exakt: ingen normalisering, ingen skiftlägesokänslighet. Koden är identiteten,
 * inte en etikett, och att vara tolerant här hade bara flyttat felet till det ställe där en
 * felstavad kod matchade ett behov den inte hörde ihop med.
 *
 * Ordningen är anroparens (listAllSuppliers sorterar på namn) — funktionen sorterar inte om.
 */
export function suppliersForMaterial(suppliers: MaterialSupplier[], material: string): MaterialSupplier[] {
  return suppliers.filter((s) => s.active && s.materials.includes(material));
}

/**
 * Förvald mottagare för ett material — eller null.
 *
 * 🧨 GISSAR ALDRIG MELLAN TVÅ FABRIKER. Finns det flera aktiva leverantörer av materialet returneras
 * null, så att valet måste göras för hand. Ett "förval" som tar den första i listan ser ut som ett
 * svar men är ett myntkast, och priset är att ett lass säckar går till fel fabrik — samma felklass
 * som en gång skickade hela orderns säckar till första materialet på raden.
 *
 * Normalfallet (en leverantör per material) förväljer alltså, tvetydigheten frågar.
 */
export function defaultSupplierForMaterial(
  suppliers: MaterialSupplier[],
  material: string,
): MaterialSupplier | null {
  const matches = suppliersForMaterial(suppliers, material);
  return matches.length === 1 ? matches[0] : null;
}

function toSupplier(row: Record<string, any>): MaterialSupplier {
  return {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    contact_name: (row.contact_name as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    // Postgres text[] kommer som array, men en null-kolumn (eller en rad från en äldre migrering)
    // skulle ge undefined och krascha varje .includes() nedströms.
    materials: Array.isArray(row.materials) ? (row.materials as string[]) : [],
    lead_time_days: Number(row.lead_time_days ?? 0),
    note: (row.note as string | null) ?? null,
    active: row.active !== false,
  };
}

/**
 * Hela registret, inaktiva inkluderade — panelen ska kunna visa och återaktivera dem.
 *
 * Ingen paginering, med flit: registret är en handfull fabriker och växer inte med drift, till
 * skillnad från leverans- och segmentläsningarna som just fick sin paginering. Skulle det någon
 * gång bli en lång lista är det readAllPages i ./pagedRead som ska in — inte ett tyst 1000-tak.
 */
export async function listAllSuppliers(
  supabase: SupabaseClient,
): Promise<{ data: MaterialSupplier[]; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('ops_material_suppliers')
    .select(SUPPLIER_SELECT)
    .order('name', { ascending: true });
  if (error) return { data: [], error };
  return { data: ((data as Record<string, any>[]) ?? []).map(toSupplier), error: null };
}

export type CreateSupplierInput = {
  name: string;
  email: string;
  contactName: string | null;
  phone: string | null;
  materials: string[];
  leadTimeDays: number;
  note: string | null;
  actorUserId: string;
};

// created_by måste vara anroparen (RLS insert-policyn kräver created_by = auth.uid()).
export async function createSupplier(supabase: SupabaseClient, input: CreateSupplierInput) {
  return supabase
    .from('ops_material_suppliers')
    .insert({
      name: input.name.trim(),
      email: input.email.trim(),
      contact_name: input.contactName,
      phone: input.phone,
      materials: input.materials,
      lead_time_days: input.leadTimeDays,
      note: input.note,
      created_by: input.actorUserId,
    })
    .select(SUPPLIER_SELECT)
    .single();
}

export type UpdateSupplierInput = {
  name?: string;
  email?: string;
  contactName?: string | null;
  phone?: string | null;
  materials?: string[];
  leadTimeDays?: number;
  note?: string | null;
  active?: boolean;
};

/**
 * Ändra en leverantör.
 *
 * ⚠️ Noll matchande rader ger `data: null` UTAN fel — så svarar PostgREST, och raden kan lika gärna
 * vara osynlig bakom RLS som borttagen. Anroparen MÅSTE skilja på det och en lyckad skrivning;
 * tigande läses annars som "sparat". Samma tautologi har bitit i det här repot förr.
 */
export async function updateSupplier(supabase: SupabaseClient, id: string, patch: UpdateSupplierInput) {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.email !== undefined) update.email = patch.email.trim();
  if (patch.contactName !== undefined) update.contact_name = patch.contactName;
  if (patch.phone !== undefined) update.phone = patch.phone;
  if (patch.materials !== undefined) update.materials = patch.materials;
  if (patch.leadTimeDays !== undefined) update.lead_time_days = patch.leadTimeDays;
  if (patch.note !== undefined) update.note = patch.note;
  if (patch.active !== undefined) update.active = patch.active;

  return supabase
    .from('ops_material_suppliers')
    .update(update)
    .eq('id', id)
    .select(SUPPLIER_SELECT)
    .maybeSingle();
}

/**
 * Ta bort en leverantör.
 *
 * Registret har `active` för avveckling, och det är den vägen som ska användas när fabriken har
 * levererat något — annars försvinner namnet ur en historik som ännu inte finns. Radering är kvar
 * för en rad som lagts upp av misstag.
 *
 * ⚠️ När beställningarna landar (etapp 4) får deras supplier_id `on delete set null` och en
 * snapshottad supplier_name, så en radering inte skriver om vad en skickad beställning påstår sig
 * ha gått till. Den dagen: kontrollera att snapshoten finns INNAN den här vägen lämnas öppen.
 *
 * Returnerar den raderade raden så anroparen kan skilja "fanns inte" från "raderad".
 */
export async function deleteSupplier(supabase: SupabaseClient, id: string) {
  return supabase.from('ops_material_suppliers').delete().eq('id', id).select('id').maybeSingle();
}

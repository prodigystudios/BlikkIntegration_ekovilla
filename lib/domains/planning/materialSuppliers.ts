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
  /**
   * Beställningsstorlek: material beställs i hela pallar, och pallen är olika stor hos olika
   * fabriker (Williams besked 2026-09-10). `suggested_sacks` avrundas UPP till närmaste multipel.
   *
   * 1 = ingen avrundning, och det är defaulten — en leverantör som säljer lösa säckar ska gå att
   * lägga upp, och en ny rad får inte tyst börja avrunda.
   */
  round_up_to: number;
  note: string | null;
  active: boolean;
};

const SUPPLIER_SELECT =
  'id, name, email, contact_name, phone, materials, lead_time_days, round_up_to, note, active';

/**
 * Det MINSTA en rad behöver bära för att urvalsregeln ska gälla den.
 *
 * ⚠️ FINNS FÖR ATT REGELN SKA VARA EN, INTE TVÅ. Registret läser hela rader; prognosen läser bara
 * de ofarliga villkoren via planning_supply_terms (adress och kontaktperson stannar bakom
 * depot.manage). Utan den här abstraktionen hade "vilken leverantör gäller för materialet" fått
 * skrivas en gång till för den smala formen — och två kopior av ett val mellan fabriker glider
 * isär tyst.
 */
export type MaterialSupply = {
  materials: string[];
  active: boolean;
};

/** Ledtid och pallstorlek, utan något som pekar ut VEM leverantören är. */
export type SupplyTerms = MaterialSupply & {
  supplier_id: string;
  lead_time_days: number;
  round_up_to: number;
};

/**
 * Leveransvillkoren för alla aktiva leverantörer, via SECURITY DEFINER-RPC.
 *
 * 🧨 LÄSER INTE ops_material_suppliers DIREKT, OCH DET ÄR HELA POÄNGEN. Tabellens SELECT-policy
 * kräver planning.depot.manage, medan lagerrutten grindar på planning.schedule.read. RLS NEKAR
 * INTE — den filtrerar: för `sales` och `konsult` kom noll rader tillbaka UTAN FEL, och prognosen
 * föll tyst tillbaka på ingen ledtid och ingen avrundning. Utfallet var "beställ senast den dag
 * depån är tom", bara för dem som inte var admin. Se filhuvudet i
 * supabase/sql/20260911_planning_supply_terms.sql.
 *
 * ⚠️ SESSIONSKLIENTEN, ALDRIG ADMIN-KLIENTEN: funktionen prövar has_permission, som nycklar på
 * auth.uid() — null under service-role, alltså alltid nekad.
 */
export async function listSupplyTerms(
  supabase: SupabaseClient,
): Promise<{ data: SupplyTerms[]; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc('planning_supply_terms');
  if (error) return { data: [], error };
  const rows = ((data as Record<string, any>[]) ?? []).map((r) => ({
    supplier_id: r.supplier_id as string,
    materials: Array.isArray(r.materials) ? (r.materials as string[]) : [],
    lead_time_days: Number(r.lead_time_days ?? 0),
    round_up_to: Number(r.round_up_to ?? 1) || 1,
    // Funktionen returnerar bara aktiva rader; fältet finns för att urvalsregeln ska vara DELAD
    // med registret i stället för omskriven för den smala formen.
    active: true,
  }));
  return { data: rows, error: null };
}

export type SupplierProblem =
  | 'name_required'
  | 'name_too_long'
  | 'email_required'
  | 'email_invalid'
  | 'materials_required'
  | 'material_unknown'
  | 'lead_time_invalid'
  | 'round_up_invalid';

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
  roundUpTo?: number;
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

  // 1 = ingen avrundning. NOLL är inte "ingen avrundning" utan en division med noll i väntan på att
  // hända — roundUpToMultiple måste kunna lita på att talet är minst 1.
  const roundUp = input.roundUpTo ?? 1;
  if (!Number.isInteger(roundUp) || roundUp < 1 || roundUp > 1000) return 'round_up_invalid';

  return null;
}

/**
 * Avrunda UPP till närmaste hela beställningsstorlek.
 *
 * ⚠️ ANVÄNDS PÅ `worst_deficit`, ALDRIG PÅ ETT DELBEHOV. Underskottet är sanningen om vad som
 * behövs; pallen är en leveransform. Avrundas varje dags rörelse för sig staplas felen uppåt och
 * förslaget växer med antalet händelser i stället för med behovet — 3 dagar à 1 säck blir tre
 * pallar i stället för en.
 *
 * Noll säckar avrundas till noll: ett behov som inte finns blir inte en pall.
 */
export function roundUpToMultiple(sacks: number, multiple: number): number {
  if (!(sacks > 0)) return 0;
  const step = Number.isInteger(multiple) && multiple >= 1 ? multiple : 1;
  return Math.ceil(sacks / step) * step;
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
export function suppliersForMaterial<T extends MaterialSupply>(suppliers: T[], material: string): T[] {
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
export function defaultSupplierForMaterial<T extends MaterialSupply>(
  suppliers: T[],
  material: string,
): T | null {
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
    // Default 1, aldrig 0: en nolla här hade blivit en division med noll i avrundningen.
    round_up_to: Number(row.round_up_to ?? 1) || 1,
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
  roundUpTo: number;
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
      round_up_to: input.roundUpTo,
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
  roundUpTo?: number;
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
  if (patch.roundUpTo !== undefined) update.round_up_to = patch.roundUpTo;
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

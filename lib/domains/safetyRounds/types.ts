// Skyddsrondens former och etiketter — ren modul, inga beroenden, så att klientformuläret kan
// importera den utan att dra med sig servern.
//
// Värdena är databasens (check constraints i supabase/sql/20260924_safety_rounds.sql); etiketterna
// är Excel-mallens ("Skyddsrond_mall_arbetsplats.xlsx"). Skalan är OK / Delvis / Brist / Ej relevant
// — mallens rullista, inte dess instruktionstext (Williams beslut 2026-09-24).

export const ITEM_STATUSES = ['ok', 'partial', 'defect', 'na'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  ok: 'OK',
  partial: 'Delvis',
  defect: 'Brist',
  na: 'Ej relevant',
};

/** null i databasen = "–" i mallen. */
export const RISK_LEVELS = ['low', 'medium', 'high', 'severe'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'Låg',
  medium: 'Medel',
  high: 'Hög',
  severe: 'Allvarlig',
};

export const TO_ACTION_PLAN = ['yes', 'no', 'fixed'] as const;
export type ToActionPlan = (typeof TO_ACTION_PLAN)[number];
export const TO_ACTION_PLAN_LABELS: Record<ToActionPlan, string> = {
  yes: 'Ja',
  no: 'Nej',
  fixed: 'Direkt åtgärdad',
};

export const PARTICIPANT_ROLES = ['leader', 'safety_rep', 'installer', 'site_manager', 'other'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];
export const PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string> = {
  leader: 'Chef/arbetsledare',
  safety_rep: 'Skyddsombud',
  installer: 'Montör',
  site_manager: 'BAS-U/platschef',
  other: 'Övrig',
};

export const ACTION_STATUSES = ['not_started', 'in_progress', 'done', 'delayed', 'written_off'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  not_started: 'Ej påbörjad',
  in_progress: 'Pågår',
  done: 'Klar',
  delayed: 'Försenad',
  written_off: 'Avskriven',
};

export const ACTION_EFFECTS = ['yes', 'no', 'partial', 'not_assessed'] as const;
export type ActionEffect = (typeof ACTION_EFFECTS)[number];
export const ACTION_EFFECT_LABELS: Record<ActionEffect, string> = {
  yes: 'Ja',
  no: 'Nej',
  partial: 'Delvis',
  not_assessed: 'Ej bedömd',
};

export type RoundStatus = 'draft' | 'completed';

/** Förifyllt "Typ av arbete" — mallens egen text. */
export const DEFAULT_WORK_TYPE = 'Tilläggsisolering / lösull / cellulosaisolering';
/**
 * Förifylld arbetsgivare. Samma bolag som står som entreprenör i KMA-planen (Williams beslut
 * 2026-09-24, lib/domains/crm/kmaPlans/template.ts) — fältet är fritt och kan ändras i ronden.
 */
export const DEFAULT_EMPLOYER = 'Isoleringslandslaget AB';

// ── Rader ────────────────────────────────────────────────────────────────────

export type SafetyRound = {
  id: string;
  work_order_id: string;
  round_number: number;
  status: RoundStatus;
  order_number: string | null;
  fortnox_order_number: string | null;
  project_name: string;
  client_name: string | null;
  site_address: string | null;
  object_label: string | null;
  held_on: string;
  held_at: string | null;
  client_label: string | null;
  contract_step: string | null;
  employer: string | null;
  work_type: string | null;
  weather: string | null;
  leader_id: string | null;
  leader_name: string | null;
  safety_rep_name: string | null;
  next_round_due: string | null;
  previous_followed_up: boolean | null;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  completed_by: string | null;
};

export type SafetyRoundParticipant = {
  id: string;
  round_id: string;
  profile_id: string | null;
  name: string;
  role: ParticipantRole;
  company: string | null;
  present: boolean;
  initials: string | null;
  comment: string | null;
  position: number;
};

export type SafetyRoundItem = {
  id: string;
  round_id: string;
  catalog_item_id: string | null;
  category_code: string;
  category_label: string;
  number: number | null;
  text: string;
  position: number;
  status: ItemStatus | null;
  risk: RiskLevel | null;
  description: string | null;
  fixed_on_site: boolean | null;
  to_action_plan: ToActionPlan | null;
  comment: string | null;
};

export type SafetyRoundAction = {
  id: string;
  round_id: string;
  item_id: string | null;
  position: number;
  finding: string;
  risk: RiskLevel | null;
  action: string | null;
  responsible_id: string | null;
  responsible_name: string | null;
  due_on: string | null;
  status: ActionStatus;
  followed_up_on: string | null;
  effect: ActionEffect | null;
  cost_note: string | null;
};

/** Ett foto på en punkt. Två objekt i lagringen: den fulla bilden och den lilla till PDF:en. */
export type SafetyRoundPhoto = {
  id: string;
  round_id: string;
  item_id: string;
  /** "Foto-nr" i mallen — löpnummer per rond, aldrig återanvänt. */
  photo_no: number;
  storage_path: string;
  print_path: string;
  size_bytes: number;
  print_size_bytes: number;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
};

/** Allt formuläret och protokollet behöver om EN rond. */
export type SafetyRoundBundle = {
  round: SafetyRound;
  participants: SafetyRoundParticipant[];
  items: SafetyRoundItem[];
  actions: SafetyRoundAction[];
  photos: SafetyRoundPhoto[];
};

/** En rad i listorna (/skyddsrond och kortet på arbetsordern). */
export type SafetyRoundListRow = Pick<
  SafetyRound,
  | 'id'
  | 'work_order_id'
  | 'round_number'
  | 'status'
  | 'order_number'
  | 'fortnox_order_number'
  | 'project_name'
  | 'held_on'
  | 'leader_name'
  | 'next_round_due'
  | 'created_at'
>;

/** Ordern som lookup-funktionerna lämnar ut — ingenting mer (se SQL-filen, avsnitt 7). */
export type SafetyRoundOrder = {
  id: string;
  order_number: string | null;
  fortnox_order_number: string | null;
  project_name: string | null;
  client_name: string | null;
  status: string | null;
  work_address: Record<string, unknown> | null;
  customer_address: Record<string, unknown> | null;
};

/**
 * Ordernumret som visas: Fortnox-numret när det finns, annars det interna. Samma regel som
 * orderLookupRef (app/crm/lib/format.ts) — rått nummer, aldrig documentRef:s "#".
 */
export function safetyRoundOrderRef(row: { fortnox_order_number: string | null; order_number: string | null }): string {
  return (row.fortnox_order_number || '').trim() || (row.order_number || '').trim();
}

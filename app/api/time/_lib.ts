import { z } from 'zod';
import { TIME_REFERENCE_KINDS, type TimeReferenceKind } from '@/lib/domains/time/reference';
import { TIME_PERIOD_STATUSES } from '@/lib/domains/time/approvals';

// Delat för hela tid-ytan (app/api/time/**). Guards importeras från lib/auth/guards, INTE från
// app/api/crm/_shared — tid är hela företagets, inte en CRM-yta, och nycklarna (time.*) ligger
// medvetet utanför crm.*-rymden.
export { requirePermission, requireSignedInUser } from '@/lib/auth/guards';
export { ok, routeError, validationError, invalidUuidParam, isNoRowsError } from '@/lib/api/responses';
export { can, getEffectivePermissions } from '@/lib/auth/permissions';
// Periodlåset (fas 4.4) svarar på två sätt: triggern kastar (P0001) och policyn filtrerar bort
// raden (noll rader). Båda ska bli begripliga svar, inte 500 respektive "hittades inte".
export { periodLockError, explainWriteMiss } from '@/lib/domains/time/approvals';

// Härledd ur domänen så en ny referenstyp inte kan glömmas bort här.
export const timeReferenceKindSchema = z.enum(TIME_REFERENCE_KINDS as [TimeReferenceKind, ...TimeReferenceKind[]]);

const optionalText = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value ?? null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  },
  z.string().nullable(),
);

export const createTimeReferenceSchema = z.object({
  name: z.string().trim().min(1, 'Namn krävs'),
  code: optionalText.optional().default(null),
  // Lönesorten byrån räknar på. Fritext med flit — se lib/domains/time/reference.ts.
  payroll_code: optionalText.optional().default(null),
  requires_note: z.boolean().optional().default(false),
  sort_index: z.coerce.number().int().min(0).optional().default(0),
  is_active: z.boolean().optional().default(true),
  billable: z.boolean().nullable().optional(),
});

// Allt valfritt: adminvyn sparar ett fält i taget (typiskt bara payroll_code).
export const updateTimeReferenceSchema = createTimeReferenceSchema.partial();

// ── Tidrader ─────────────────────────────────────────────────────────────────

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum (ÅÅÅÅ-MM-DD)');
const clockSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Ogiltigt klockslag (TT:MM)');

export const rangeQuerySchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
});

// Formen speglar tabellens CHECK: `kind` avgör vilket mål som får vara ifyllt. Den fullständiga
// regeln — och uträkningen av minuterna — bor i buildTimeEntryRow, så den går att testa utan
// databas och kan aldrig kringgås av en route som glömmer den.
export const createTimeEntrySchema = z.object({
  kind: z.enum(['work_order', 'internal', 'absence']),
  work_date: isoDateSchema,
  work_order_id: z.string().uuid().nullable().optional(),
  internal_project_id: z.string().uuid().nullable().optional(),
  absence_type_id: z.string().uuid().nullable().optional(),
  start_time: clockSchema.nullable().optional(),
  end_time: clockSchema.nullable().optional(),
  break_minutes: z.coerce.number().int().min(0).max(1439).optional().default(0),
  // Frånvaro anges i timmar — byrån vill ha "Frånvarotimmar", inte ett pass med start och slut.
  hours: z.coerce.number().min(0).max(24).nullable().optional(),
  time_code_id: z.string().uuid().nullable().optional(),
  note: optionalText.optional().default(null),
});

// ── Attest ───────────────────────────────────────────────────────────────────

// Perioden anges som månad ('2026-08') och aldrig som ett fritt datumintervall: attesten ÄR en
// kalendermånad, och en route som tar from/to hade bjudit in till halvmånader som databasens CHECK
// sedan avvisar med ett obegripligt fel.
//
// ⚠️ Månadsdelen måste vara 01–12, inte bara två siffror. `\d{2}` släpper igenom '2026-13', som
// blir datumet '2026-13-01' och ett Postgres-fel (22008) — alltså ett 500 för en ren
// inmatningsmiss. Nåbart från UI:t: <input type="month"> faller tillbaka på ett textfält i
// webbläsare som saknar stöd.
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Ogiltig period (ÅÅÅÅ-MM)');

export const periodQuerySchema = z.object({
  period: monthSchema,
});

export const setPeriodStatusSchema = z.object({
  period: monthSchema,
  status: z.enum(TIME_PERIOD_STATUSES),
  // Utelämnad = sig själv. Sätts bara av attestytan, och kräver time.approve.
  user_id: z.string().uuid().nullable().optional(),
  // Anledning vid återöppning.
  note: optionalText.optional().default(null),
});

// ── Ersättningar (traktamente, utlägg, milersättning) ────────────────────────

export const createCompensationSchema = z.object({
  entry_date: isoDateSchema,
  kind: z.enum(['travel', 'per_diem', 'expense']),
  // Mil eller dagar. Utlägg har ingen kvantitet — där är beloppet hela sanningen.
  quantity: z.coerce.number().min(0).nullable().optional(),
  // Beloppet lagras alltid, även om systemet en dag räknar ut det ur en sats: räknas det vid
  // visning ändras gamla månaders underlag retroaktivt när satsen justeras.
  amount: z.coerce.number().min(0, 'Beloppet kan inte vara negativt'),
  note: optionalText.optional().default(null),
});

export const updateCompensationSchema = createCompensationSchema.partial();

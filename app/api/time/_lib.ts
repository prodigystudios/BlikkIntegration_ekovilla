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

// Adminrättelse. Allt är valfritt — det som utelämnas ärvs från raden som redan finns
// (mergeCorrection i lib/domains/time/entries.ts).
//
// ⚠️ `user_id` finns INTE med, och ska aldrig göra det. Att rätta ett fel är en sak; att flytta
// någons timmar till en annan persons löneunderlag är en annan. Routen läser ägaren ur databasen.
//
// Allt annat går att rätta, inklusive vilket jobb raden hör till: att ha rapporterat på fel
// arbetsorder är precis den sortens misstag rättelsen finns för.
export const correctTimeEntrySchema = z.object({
  kind: z.enum(['work_order', 'internal', 'absence']).optional(),
  work_date: isoDateSchema.optional(),
  work_order_id: z.string().uuid().nullable().optional(),
  internal_project_id: z.string().uuid().nullable().optional(),
  absence_type_id: z.string().uuid().nullable().optional(),
  time_code_id: z.string().uuid().nullable().optional(),
  start_time: clockSchema.nullable().optional(),
  end_time: clockSchema.nullable().optional(),
  break_minutes: z.coerce.number().int().min(0).max(1439).optional(),
  hours: z.coerce.number().min(0).max(24).nullable().optional(),
  note: optionalText.optional(),
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

// Attestens dagvy: en namngiven persons månad. Ligger bara på /api/admin/time/** — /api/time/**
// ska förbli "min egen tid" utan en enda parameter som öppnar för andras (se kommentaren i
// app/api/time/entries/route.ts om Blikk-motsvarigheten som tar ?userId= utan behörighetskontroll).
export const personPeriodQuerySchema = z.object({
  period: monthSchema,
  user_id: z.string().uuid('Ogiltigt användar-id'),
});

export const setPeriodStatusSchema = z.object({
  period: monthSchema,
  status: z.enum(TIME_PERIOD_STATUSES),
  // Utelämnad = sig själv. Sätts bara av attestytan, och kräver time.approve.
  user_id: z.string().uuid().nullable().optional(),
  // Anledning vid återöppning.
  note: optionalText.optional().default(null),
});

// ── Kvitton ──────────────────────────────────────────────────────────────────

// Uppladdningen i tre steg, som arbetsorderfilerna: (1) be om en signerad URL, (2) ladda upp direkt
// till lagringen, (3) skicka med sökvägen när posten sparas. Bytena passerar aldrig en route
// handler — ett kvitto från en telefon är 2-5 MB och ska inte behöva rymmas i en request-kropp.
//
// Steg 1 tar `entry_date` för att kunna neka innan uppladdningen om månaden redan är inlämnad.
// Låset i databasen fångar det ändå i steg 3, men då har användaren redan betalat för bytena över
// mobilnätet och får sitt nej efteråt.
export const receiptUploadUrlSchema = z.object({
  file_name: z.string().trim().min(1, 'Filnamn krävs').max(200),
  content_type: z.string().trim().max(120).optional().default(''),
  size_bytes: z.coerce.number().int().min(0),
  entry_date: isoDateSchema,
});

// ⚠️ STORLEK OCH MIMETYPE SAKNAS HÄR MED FLIT. Klientens påståenden om dem duger till att avvisa
// det uppenbart felaktiga tidigt, men får aldrig hamna i databasen: routen läser objektets faktiska
// storlek och typ ur lagringen i steg 3. Det enda klienten bidrar med är var filen hamnade (som
// prövas) och vad den ska heta för ögat.
export const receiptAttachmentSchema = z.object({
  storage_path: z.string().trim().min(1, 'Sökväg krävs').max(400),
  file_name: z.string().trim().min(1, 'Filnamn krävs').max(200),
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
  // Momsen i kronor. NULLBAR OCH INTE DEFAULT 0 — "moms ej ifylld" och "moms är noll kronor" är
  // olika påståenden för den som bokför, och en default hade gjort varje utlägg till ett momsfritt
  // sådant utan att någon sagt det. Taket (moms <= belopp) sitter i databasen, som är den enda som
  // ser båda fälten vid en partiell uppdatering.
  vat_amount: z.coerce.number().min(0, 'Momsen kan inte vara negativ').nullable().optional(),
  note: optionalText.optional().default(null),
  // Kvittot, om det laddades upp innan posten sparades. Sökvägen är ett PÅSTÅENDE tills routen
  // prövat den mot isReceiptPath — se receiptAttachmentSchema.
  receipt: receiptAttachmentSchema.nullable().optional(),
});

export const updateCompensationSchema = createCompensationSchema.partial();

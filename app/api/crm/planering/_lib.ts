import { z } from 'zod';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';

// Planning is a CRM surface, so it shares the CRM route helpers + permission gate directly.
export { ok, routeError, validationError, invalidUuidParam, requirePermission } from '../_shared';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum (YYYY-MM-DD)');

export const listSegmentsQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
});

const jobType = z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(40).nullable());

export const placeSegmentSchema = z.object({
  work_order_id: z.string().uuid('Ogiltig arbetsorder'),
  truck_id: z.string().uuid('Ogiltig bil'),
  start_day: isoDate,
  end_day: isoDate,
  sort_index: z.coerce.number().int().min(0).optional(),
  job_type: jobType.optional(),
});

// Vad grabbarna ska göra, när platshållaren är publicerad till entreprenaden. Tom text är samma sak
// som ingen beskrivning — annars sparas en blank rad som ser ut som ett svar på kortet i fält.
const workDescription = z.preprocess(
  (v) => (v == null ? null : String(v).trim() || null),
  z.string().max(2000, 'Beskrivningen är för lång').nullable(),
);

// Create a placeholder placement (booked slot before a CRM work order exists). Carries its own
// title/customer instead of a work_order_id.
export const createPlaceholderSchema = z.object({
  title: z.string().trim().min(1, 'Ange en titel').max(120, 'Titeln är för lång'),
  customer: z.string().trim().max(120).nullable().optional(),
  truck_id: z.string().uuid('Ogiltig bil'),
  start_day: isoDate,
  end_day: isoDate,
  job_type: jobType.optional(),
  field_visible: z.boolean().optional(),
  work_description: workDescription.optional(),
});

// Redigera en platshållare. Alla fält valfria (bara det som skickas skrivs), men minst ett måste
// med — en tom patch hade blivit en UPDATE utan kolumner, alltså ett databasfel på en begäran som
// egentligen bara var meningslös.
export const updatePlaceholderSchema = z
  .object({
    title: z.string().trim().min(1, 'Ange en titel').max(120, 'Titeln är för lång').optional(),
    customer: z.string().trim().max(120).nullable().optional(),
    truck_id: z.string().uuid('Ogiltig bil').optional(),
    start_day: isoDate.optional(),
    end_day: isoDate.optional(),
    job_type: jobType.optional(),
    field_visible: z.boolean().optional(),
    work_description: workDescription.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Inget att spara');

export const moveSegmentSchema = z.object({
  truck_id: z.string().uuid('Ogiltig bil').optional(),
  start_day: isoDate.optional(),
  end_day: isoDate.optional(),
  sort_index: z.coerce.number().int().min(0).optional(),
  job_type: jobType.optional(),
  on_hold: z.boolean().optional(),
});

// Assign a crew member to a segment. member_name is the durable display snapshot (profiles are
// self-read-only, so the board never re-reads the person) — required even though member_id is too.
export const assignCrewSchema = z.object({
  member_id: z.string().uuid('Ogiltig montör'),
  member_name: z.string().trim().min(1, 'Namn krävs').max(120),
});

// Assign a crew member to a truck for a date range (weekly truck crew / rotation).
export const assignTruckCrewSchema = z.object({
  truck_id: z.string().uuid('Ogiltig bil'),
  member_id: z.string().uuid('Ogiltig montör'),
  member_name: z.string().trim().min(1, 'Namn krävs').max(120),
  start_day: isoDate,
  end_day: isoDate,
});

// Replace a truck's default crew (standardbemanning): the whole standing team in one go.
export const replaceDefaultCrewSchema = z.object({
  members: z
    .array(
      z.object({
        member_id: z.string().uuid('Ogiltig montör').nullable(),
        member_name: z.string().trim().min(1, 'Namn krävs').max(120),
        role: z.enum(['leader', 'member']),
      }),
    )
    .max(12, 'För många i teamet'),
});

// Fork a week from the default crew, or drop the week's override back to the default.
export const truckCrewWeekSchema = z.object({
  action: z.enum(['materialize', 'restore']),
  truck_id: z.string().uuid('Ogiltig bil'),
  start_day: isoDate,
  end_day: isoDate,
});

// Copy a truck's crew from one week to another.
export const copyTruckCrewSchema = z.object({
  truck_id: z.string().uuid('Ogiltig bil'),
  source_start: isoDate,
  source_end: isoDate,
  target_start: isoDate,
  target_end: isoDate,
});

// Create a day note (dagsanteckning) pinned to a calendar day.
export const createDayNoteSchema = z.object({
  note_day: isoDate,
  body: z.string().trim().min(1, 'Skriv en notering').max(500, 'Noteringen är för lång'),
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Ogiltig färg').nullable();

// Fleet administration (planning.truck.manage).
export const createTruckSchema = z.object({
  name: z.string().trim().min(1, 'Ange ett namn').max(60, 'Namnet är för långt'),
  color: hexColor.optional(),
});

export const updateTruckSchema = z.object({
  name: z.string().trim().min(1, 'Ange ett namn').max(60, 'Namnet är för långt').optional(),
  color: hexColor.optional(),
  active: z.boolean().optional(),
  depot_id: z.string().uuid('Ogiltig depå').nullable().optional(),
});

// Depot (depå) administration (planning.depot.manage).
export const createDepotSchema = z.object({
  name: z.string().trim().min(1, 'Ange ett namn').max(80, 'Namnet är för långt'),
  location: z.string().trim().max(200).nullable().optional(),
});

export const updateDepotSchema = z.object({
  name: z.string().trim().min(1, 'Ange ett namn').max(80, 'Namnet är för långt').optional(),
  location: z.string().trim().max(200).nullable().optional(),
  active: z.boolean().optional(),
});

// Job-type administration (planning.truck.manage). The key is derived from the label server-side
// and never edited.
export const createJobTypeSchema = z.object({
  label: z.string().trim().min(1, 'Ange ett namn').max(40, 'Namnet är för långt'),
  color: hexColor.unwrap(),
});

export const updateJobTypeSchema = z.object({
  label: z.string().trim().min(1, 'Ange ett namn').max(40, 'Namnet är för långt').optional(),
  color: hexColor.unwrap().optional(),
  active: z.boolean().optional(),
  sort_index: z.coerce.number().int().min(0).optional(),
});

// Record a delivery of sacks into a depot. material must be a known catalogue short so deliveries
// reconcile with derived consumption.
//
// 🧨 delivered_on FÅR INTE LIGGA I FRAMTIDEN. listDeliveryRows (lib/domains/planning/depotStock.ts)
// summerar hela ops_depot_deliveries utan datumfilter, så en rad daterad framåt höjer saldot REDAN
// IDAG. `shortfall = max(0, planned − balance)` faller då till 0 och bristbanderollen tystnar — på
// en depå som i verkligheten är tom. Ingenting felar, och felet upptäcks först när en bil står utan
// material.
//
// Att en beställd leverans ska kunna ligga i framtiden är just skälet till att beställningar bor i
// egna tabeller: den här tabellen betyder "står fysiskt på depån", inget annat.
//
// Taket läses per anrop, inte vid modulladdning — en serverprocess lever över midnatt och hade
// annars fryst gårdagens datum. stockholmTodayISO() (inte toISOString()) eftersom servern kör UTC:
// mellan midnatt och 02:00 svensk tid är de olika kalenderdagar.
export const createDeliverySchema = z.object({
  depot_id: z.string().uuid('Ogiltig depå'),
  material: z.string().trim().refine((m) => MATERIAL_SHORTS.includes(m), 'Okänt material'),
  sacks: z.coerce.number().int().positive('Ange ett antal säckar'),
  delivered_on: isoDate.refine(
    (d) => d <= stockholmTodayISO(),
    'Leveransdatum kan inte ligga i framtiden — registrera leveransen när den kommit fram',
  ),
  note: z.string().trim().max(300).nullable().optional(),
});

// En VÄNTAD leverans: material som är beställt men inte står på depån än.
//
// 🧨 Spegelvänt datumkrav mot createDeliverySchema, och det är hela poängen med att det är två
// tabeller. En registrerad leverans får inte ligga i framtiden (den räknas i saldot direkt); en
// väntad SKA normalt göra det, och räknas aldrig i saldot förrän ankomsten kvitteras.
export const createExpectedDeliverySchema = z.object({
  depot_id: z.string().uuid('Ogiltig depå'),
  material: z.string().trim().refine((m) => MATERIAL_SHORTS.includes(m), 'Okänt material'),
  sacks: z.coerce.number().int().positive('Ange ett antal säckar'),
  expected_on: isoDate,
  note: z.string().trim().max(300).nullable().optional(),
});

// Ändra en väntad leverans. Vanligaste fallet är att fabriken flyttar datumet — då ska raden gå att
// rätta, inte avbokas och läggas upp på nytt: avbokningen tappar spåret av vad som faktiskt
// beställdes, och en ny rad ser ut som en andra beställning.
//
// Inget datumtak, som vid inläggningen: en väntad leverans ska normalt ligga i framtiden. Att flytta
// den BAKÅT måste också gå — en försenad leverans som visade sig ha kommit tidigare än trott.
export const updateExpectedDeliverySchema = z
  .object({
    depot_id: z.string().uuid('Ogiltig depå').optional(),
    material: z.string().trim().refine((m) => MATERIAL_SHORTS.includes(m), 'Okänt material').optional(),
    sacks: z.coerce.number().int().positive('Ange ett antal säckar').optional(),
    expected_on: isoDate.optional(),
    note: z.string().trim().max(300).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Inget att spara');

// Kvittering av en väntad leverans. `sacks` är vad som FAKTISKT kom, förifyllt med det beställda:
// kommer 120 av 180 är det 120 som ska in i lagret. Datumtaket vaktas också i databasen
// (receive_expected_delivery), eftersom det är saldot som står på spel.
export const receiveExpectedDeliverySchema = z.object({
  delivered_on: isoDate.refine(
    (d) => d <= stockholmTodayISO(),
    'Ankomstdatum kan inte ligga i framtiden',
  ),
  sacks: z.coerce.number().int().positive('Ange ett antal säckar'),
  note: z.string().trim().max(300).nullable().optional(),
});

// ── Leverantörsregistret (planning.depot.manage) ────────────────────────────
//
// Vem materialet beställs FRÅN. Registret finns för att beställningsmailet ska slå upp adressen på
// SERVERN via supplier_id — orderbekräftelsens route tar ett fritt recipient_email och mailar dit
// oförändrat, och kopieras det mönstret till inköp blir flödet en öppen relä.

// Ett tomt fält är samma sak som inget värde: en blank sträng i registret ser ut som en ifylld
// uppgift. Samma preprocess-idiom som jobType/workDescription ovan.
const nullableText = (max: number, tooLong: string) =>
  z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(max, tooLong).nullable());

// 🧨 KODEN ÄR IDENTITETEN, INTE EN ETIKETT. Materialet väljer mottagare, alltså vilken fabrik
// mailet går till: en sträng som inte ligger tecken för tecken i MATERIAL_SHORTS matchar aldrig ett
// behov — eller matchar fel. Enda stället vokabulären prövas, därav ingen CHECK i SQL.
//
// Minst ett material krävs. Databasen tillåter en tom lista (`default '{}'`), men en leverantör
// utan material blir osynlig i mottagarvalet samtidigt som den syns i registret — den ser upplagd
// ut och är det inte. `.max()` biter FÖRE dedupliceringen och är därmed också storleksgränsen.
const supplierMaterials = z
  .array(z.string().trim().refine((m) => MATERIAL_SHORTS.includes(m), 'Okänt material'))
  .min(1, 'Välj minst ett material')
  .max(MATERIAL_SHORTS.length, 'För många material')
  .transform((list) => [...new Set(list)]);

// Ledtiden går rakt in i en datumuträkning (suggested_date = max(idag, run_out − ledtid)), så en
// felskrivning som 3650 klampar varje förslag till "beställ idag" utan att se fel ut. Taket vaktas
// också i databasen.
const leadTimeDays = z.coerce
  .number()
  .int('Ledtiden anges i hela dagar')
  .min(0, 'Ledtiden kan inte vara negativ')
  .max(365, 'Ledtiden är orimligt lång');

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1, 'Ange ett namn').max(120, 'Namnet är för långt'),
  // Obligatorisk: en leverantör som inte kan ta emot en beställning är en kontakt, inte en
  // leverantör. Utan adress hade raden legat i väljaren och felat först vid utskicket.
  email: z.string().trim().email('Ogiltig e-postadress').max(200, 'Adressen är för lång'),
  contact_name: nullableText(120, 'Namnet är för långt').optional(),
  phone: nullableText(40, 'Numret är för långt').optional(),
  materials: supplierMaterials,
  lead_time_days: leadTimeDays.optional().default(0),
  note: nullableText(300, 'Noteringen är för lång').optional(),
});

export const updateSupplierSchema = z
  .object({
    name: z.string().trim().min(1, 'Ange ett namn').max(120, 'Namnet är för långt').optional(),
    email: z.string().trim().email('Ogiltig e-postadress').max(200, 'Adressen är för lång').optional(),
    contact_name: nullableText(120, 'Namnet är för långt').optional(),
    phone: nullableText(40, 'Numret är för långt').optional(),
    materials: supplierMaterials.optional(),
    lead_time_days: leadTimeDays.optional(),
    note: nullableText(300, 'Noteringen är för lång').optional(),
    // Avveckling sker genom avaktivering — inaktiva leverantörer ligger kvar men blir aldrig
    // mottagare (suppliersForMaterial filtrerar på active).
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Inget att spara');

// List the activity log (audit trail). Newest-first, keyset-paginated by `before` (ISO timestamp),
// with optional filters on actor name, exact action key, and a free-text search over the summary.
export const listActivityQuerySchema = z.object({
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  actor: z.string().trim().min(1).max(120).optional(),
  action: z.string().trim().min(1).max(40).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

// Send an order confirmation (orderbekräftelse) for a scheduled job. At least one channel must be
// chosen; the matching recipient is required (enforced in the route for a clear Swedish message).
export const sendConfirmationSchema = z.object({
  send_email: z.boolean().optional().default(false),
  recipient_email: z.string().trim().email('Ogiltig e-postadress').nullable().optional(),
  send_sms: z.boolean().optional().default(false),
  recipient_phone: z.string().trim().min(3, 'Ogiltigt telefonnummer').nullable().optional(),
  custom_message: z.string().trim().max(2000).nullable().optional(),
});

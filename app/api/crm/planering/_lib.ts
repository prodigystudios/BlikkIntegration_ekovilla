import { z } from 'zod';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';

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
export const createDeliverySchema = z.object({
  depot_id: z.string().uuid('Ogiltig depå'),
  material: z.string().trim().refine((m) => MATERIAL_SHORTS.includes(m), 'Okänt material'),
  sacks: z.coerce.number().int().positive('Ange ett antal säckar'),
  delivered_on: isoDate,
  note: z.string().trim().max(300).nullable().optional(),
});

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

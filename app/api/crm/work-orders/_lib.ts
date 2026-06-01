import { z } from 'zod';
export { ok, routeError, validationError, requireCrmUser, requireSignedInUser } from '../_shared';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

const workOrderStatusSchema = z.enum(['draft', 'scheduled', 'ready', 'in_progress', 'completed', 'cancelled']);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum');

export const createWorkOrderTimeEntrySchema = z.object({
  work_date: dateSchema,
  hours: z.coerce.number().positive('Timmar måste vara större än 0').max(24, 'Timmar får inte överstiga 24'),
  note: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
});

export const createWorkOrderCommentSchema = z.object({
  body: z.string().trim().min(1, 'Kommentar krävs'),
});

export const listCrmWorkOrdersQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: workOrderStatusSchema.optional(),
  work_order_id: z.string().uuid('Ogiltig arbetsorder').optional(),
});

export const updateCrmWorkOrderSchema = z.object({
  status: workOrderStatusSchema,
  desired_installation_date: z.preprocess((value) => normalizeOptionalText(value), dateSchema.nullable()).optional().default(null),
  notes: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  internal_handoff: z.object({
    desired_installation_date: z.preprocess((value) => normalizeOptionalText(value), dateSchema.nullable()).optional().default(null),
    handoff_notes: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    work_scope: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  }).optional().default({}),
  work_address: z.object({
    street_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    postal_code: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    city: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    delivery_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    invoice_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  }).optional().default({}),
});


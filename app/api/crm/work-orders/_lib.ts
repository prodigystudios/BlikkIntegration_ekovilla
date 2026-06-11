import { z } from 'zod';
import { quoteLineItemSchema } from '../quotes/_lib';
export { ok, routeError, validationError, invalidUuidParam, requireCrmUser, requireCrmWriter, requirePermission, requireSignedInUser, pickProvidedFields } from '../_shared';

// Reuses the quote line-item schema so work order article edits validate identically.
export const updateWorkOrderLineItemsSchema = z.object({
  line_items: z.array(quoteLineItemSchema).default([]),
});

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

// 'ready' is retired (migration 20260607 dropped it from the DB CHECK + migrated rows to
// 'scheduled'), so it's not accepted on write. It stays in the display label/class maps
// (crmTokens) only as a fallback for any un-migrated legacy row.
const workOrderStatusSchema = z.enum(['draft', 'scheduled', 'in_progress', 'completed', 'partially_invoiced', 'invoiced', 'cancelled']);

// Per-article quantities for a delfakturering (partial invoice) round: how much of each line
// item (matched by its index in line_items) to invoice now. Quantities are coerced to numbers;
// the domain validates them against each line's remaining quantity. Swedish comma input is
// normalised client-side before submit.
export const partialInvoiceSchema = z.object({
  lines: z
    .array(z.object({ index: z.number().int().min(0), quantity: z.coerce.number().min(0) }))
    .min(1, 'Ange minst en rad att fakturera'),
});
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum');

// Create a standalone work order (no originating quote). Customer is required; identity
// (name/snapshot/address) is derived from the customer card server-side.
export const createStandaloneWorkOrderSchema = z.object({
  customer_id: z.string().uuid('Välj en kund'),
  project_name: z.string().trim().min(1, 'Ordernamn krävs'),
  desired_installation_date: z.preprocess((value) => normalizeOptionalText(value), dateSchema.nullable()).optional().default(null),
});

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
  customer_id: z.string().uuid('Ogiltig kund').optional(),
});

export const updateCrmWorkOrderSchema = z.object({
  status: workOrderStatusSchema,
  assigned_to: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltig användare').nullable()).optional(),
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


import { z } from 'zod';
export { ok, routeError, validationError, requireCrmUser } from '../_shared';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

const statusSchema = z.enum(['open', 'done']);
const prioritySchema = z.enum(['low', 'normal', 'high']);
const relatedTypeSchema = z.enum(['crm_prospect', 'crm_customer', 'crm_quote']);
const dueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum');

export const listCrmTasksQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: statusSchema.optional(),
  prospect_id: z.string().uuid('Ogiltigt prospekt').optional(),
});

export const createCrmTaskSchema = z.object({
  // A task may link to one CRM entity (prospect, customer or quote) via related_type/related_id.
  related_type: z.preprocess((value) => normalizeOptionalText(value), relatedTypeSchema.nullable()).optional().default(null),
  related_id: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltig koppling').nullable()).optional().default(null),
  related_label: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  title: z.string().trim().min(1, 'Uppgiftstitel krävs'),
  details: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  status: statusSchema.optional().default('open'),
  priority: prioritySchema.optional().default('normal'),
  due_date: z.preprocess((value) => normalizeOptionalText(value), dueDateSchema.nullable()).optional().default(null),
  remind_at: z.preprocess((value) => normalizeOptionalText(value), z.string().datetime('Ogiltig påminnelsetid').nullable()).optional().default(null),
  source: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
}).refine((data) => (data.related_id ? data.related_type != null : true), {
  message: 'Koppling kräver en typ',
  path: ['related_type'],
}).refine((data) => (data.related_type ? data.related_id != null : true), {
  message: 'Välj vilken post uppgiften ska kopplas till',
  path: ['related_id'],
});

export const updateCrmTaskSchema = createCrmTaskSchema;


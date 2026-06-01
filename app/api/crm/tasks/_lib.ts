import { z } from 'zod';
export { ok, routeError, validationError, requireCrmUser } from '../_shared';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

const statusSchema = z.enum(['open', 'done']);
const prioritySchema = z.enum(['low', 'normal', 'high']);
const dueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum');

export const listCrmTasksQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: statusSchema.optional(),
  prospect_id: z.string().uuid('Ogiltigt prospekt').optional(),
});

export const createCrmTaskSchema = z.object({
  prospect_id: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltigt prospekt').nullable()).optional().default(null),
  title: z.string().trim().min(1, 'Uppgiftstitel krävs'),
  details: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  status: statusSchema.optional().default('open'),
  priority: prioritySchema.optional().default('normal'),
  due_date: z.preprocess((value) => normalizeOptionalText(value), dueDateSchema.nullable()).optional().default(null),
  remind_at: z.preprocess((value) => normalizeOptionalText(value), z.string().datetime('Ogiltig påminnelsetid').nullable()).optional().default(null),
  source: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
});

export const updateCrmTaskSchema = createCrmTaskSchema;


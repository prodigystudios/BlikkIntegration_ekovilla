import { z } from 'zod';
export { ok, routeError, validationError, requireCrmUser, requireCrmWriter } from '../_shared';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

const outcomeSchema = z.enum(['no_answer', 'follow_up', 'positive', 'negative']);

export const listCrmCallsQuerySchema = z.object({
  q: z.string().trim().optional(),
  prospect_id: z.string().uuid('Ogiltigt prospekt').optional(),
  customer_id: z.string().uuid('Ogiltig kund').optional(),
});

export const createCrmCallSchema = z.object({
  prospect_id: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltigt prospekt').nullable()).optional().default(null),
  customer_id: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltig kund').nullable()).optional().default(null),
  opportunity_id: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltig affärsmöjlighet').nullable()).optional().default(null),
  company_name: z.preprocess((value) => normalizeOptionalText(value), z.string().min(1, 'Företagsnamn krävs').nullable()).optional().default(null),
  organization_number: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  contact_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  phone: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  email: z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().email('Ogiltig e-post').nullable()
  ).optional().default(null),
  city: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  source: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  outcome: outcomeSchema,
  summary: z.string().trim().min(1, 'Samtalsanteckning krävs'),
  next_step: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  call_at: z.string().datetime().optional(),
}).superRefine((value, ctx) => {
  if (!value.prospect_id && !value.customer_id && !value.opportunity_id && !value.company_name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['company_name'],
      message: 'Företagsnamn krävs för fristående samtal',
    });
  }
});

export const updateCrmCallSchema = createCrmCallSchema;


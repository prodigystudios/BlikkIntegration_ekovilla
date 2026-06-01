import { domainToASCII } from 'node:url';
import { z } from 'zod';
export { ok, routeError, validationError, requireCrmUser } from '../_shared';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

const outcomeSchema = z.enum(['no_answer', 'follow_up', 'positive', 'negative']);

function isValidEmailAddress(value: string) {
  const trimmed = value.trim();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return false;

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1);
  const asciiDomain = domainToASCII(domainPart);

  if (!asciiDomain) return false;

  return z.string().email().safeParse(`${localPart}@${asciiDomain}`).success;
}

export const listCrmCallsQuerySchema = z.object({
  q: z.string().trim().optional(),
  prospect_id: z.string().uuid('Ogiltigt prospekt').optional(),
});

export const createCrmCallSchema = z.object({
  prospect_id: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltigt prospekt').nullable()).optional().default(null),
  company_name: z.preprocess((value) => normalizeOptionalText(value), z.string().min(1, 'Företagsnamn krävs').nullable()).optional().default(null),
  organization_number: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  contact_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  phone: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  email: z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().nullable().refine((value) => value == null || isValidEmailAddress(value), 'Ogiltig e-post')
  ).optional().default(null),
  city: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  source: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  outcome: outcomeSchema,
  summary: z.string().trim().min(1, 'Samtalsanteckning krävs'),
  next_step: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  call_at: z.string().datetime().optional(),
}).superRefine((value, ctx) => {
  if (!value.prospect_id && !value.company_name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['company_name'],
      message: 'Företagsnamn krävs för fristående samtal',
    });
  }
});

export const updateCrmCallSchema = createCrmCallSchema;


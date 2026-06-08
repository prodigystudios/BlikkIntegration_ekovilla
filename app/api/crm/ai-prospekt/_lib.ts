import { domainToASCII } from 'node:url';
import { z } from 'zod';
export { ok, routeError, validationError, requireCrmUser, requireCrmWriter, requireCrmAdmin } from '../_shared';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildOptionalTextSchema() {
  return z.preprocess((value) => normalizeOptionalText(value), z.string().nullable());
}

const asciiEmailSchema = z.string().email();

function isValidEmailAddress(value: string) {
  const trimmed = value.trim();
  const atIndex = trimmed.lastIndexOf('@');

  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return false;
  }

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1);
  const asciiDomain = domainToASCII(domainPart);

  if (!asciiDomain) return false;
  return asciiEmailSchema.safeParse(`${localPart}@${asciiDomain}`).success;
}

export const listCrmAiProspectSuggestionsQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(['all', 'pending', 'approved', 'rejected']).optional().default('all'),
});

export const createCrmAiProspectSuggestionSchema = z.object({
  company_name: z.string().trim().min(1, 'Företagsnamn krävs'),
  organization_number: buildOptionalTextSchema().optional().default(null),
  contact_name: buildOptionalTextSchema().optional().default(null),
  phone: buildOptionalTextSchema().optional().default(null),
  email: z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().refine(isValidEmailAddress, 'Ogiltig e-post').nullable(),
  ).optional().default(null),
  city: buildOptionalTextSchema().optional().default(null),
  website: buildOptionalTextSchema().optional().default(null),
  source: buildOptionalTextSchema().optional().default(null),
  rationale: buildOptionalTextSchema().optional().default(null),
  notes: buildOptionalTextSchema().optional().default(null),
});

export const reviewCrmAiProspectSuggestionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  review_note: buildOptionalTextSchema().optional().default(null),
});


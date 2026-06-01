import { domainToASCII } from 'node:url';
import { z } from 'zod';
export { ok, routeError, validationError, requireCrmUser } from '../_shared';

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

  if (!asciiDomain) {
    return false;
  }

  return asciiEmailSchema.safeParse(`${localPart}@${asciiDomain}`).success;
}

export const listCrmProspectsQuerySchema = z.object({
  q: z.string().trim().optional(),
});

export const createCrmProspectSchema = z.object({
  company_name: z.string().trim().min(1, 'Företagsnamn krävs'),
  organization_number: buildOptionalTextSchema().optional().default(null),
  contact_name: buildOptionalTextSchema().optional().default(null),
  phone: buildOptionalTextSchema().optional().default(null),
  email: z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().refine(isValidEmailAddress, 'Ogiltig e-post').nullable(),
  ).optional().default(null),
  street_address: buildOptionalTextSchema().optional().default(null),
  postal_code: buildOptionalTextSchema().optional().default(null),
  city: buildOptionalTextSchema().optional().default(null),
  source: buildOptionalTextSchema().optional().default(null),
  notes: buildOptionalTextSchema().optional().default(null),
});

export const updateCrmProspectSchema = createCrmProspectSchema.extend({
  status: z.enum(['new', 'contacted', 'qualified', 'quoted', 'won', 'lost']),
});


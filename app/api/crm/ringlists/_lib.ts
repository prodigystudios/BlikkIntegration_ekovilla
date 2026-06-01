import { z } from 'zod';
export { ok, routeError, validationError, requireCrmAdmin } from '../_shared';

export const assignCrmRinglistProspectsSchema = z.object({
  prospect_ids: z.array(z.string().uuid()).min(1, 'Välj minst ett prospekt'),
  assigned_to: z.string().uuid('Ogiltig användare').nullable(),
});

const optionalTextSchema = z.preprocess((value) => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.string().nullable());

export const importCrmRinglistRowsSchema = z.object({
  assigned_to: z.string().uuid('Ogiltig användare').nullable(),
  rows: z.array(z.object({
    row_number: z.number().int().positive(),
    company_name: z.string().trim().min(1, 'Företagsnamn krävs'),
    organization_number: optionalTextSchema.optional().default(null),
    contact_name: optionalTextSchema.optional().default(null),
    phone: optionalTextSchema.optional().default(null),
    email: optionalTextSchema.optional().default(null),
    city: optionalTextSchema.optional().default(null),
    source: optionalTextSchema.optional().default(null),
    notes: optionalTextSchema.optional().default(null),
  })).min(1, 'Minst en rad krävs').max(500, 'Importen är för stor, dela upp filen i mindre delar'),
});


import { z } from 'zod';
import { TIME_REFERENCE_KINDS, type TimeReferenceKind } from '@/lib/domains/time/reference';

// Delat för hela tid-ytan (app/api/time/**). Guards importeras från lib/auth/guards, INTE från
// app/api/crm/_shared — tid är hela företagets, inte en CRM-yta, och nycklarna (time.*) ligger
// medvetet utanför crm.*-rymden.
export { requirePermission, requireSignedInUser } from '@/lib/auth/guards';
export { ok, routeError, validationError, invalidUuidParam, isNoRowsError } from '@/lib/api/responses';

// Härledd ur domänen så en ny referenstyp inte kan glömmas bort här.
export const timeReferenceKindSchema = z.enum(TIME_REFERENCE_KINDS as [TimeReferenceKind, ...TimeReferenceKind[]]);

const optionalText = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value ?? null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  },
  z.string().nullable(),
);

export const createTimeReferenceSchema = z.object({
  name: z.string().trim().min(1, 'Namn krävs'),
  code: optionalText.optional().default(null),
  // Lönesorten byrån räknar på. Fritext med flit — se lib/domains/time/reference.ts.
  payroll_code: optionalText.optional().default(null),
  requires_note: z.boolean().optional().default(false),
  sort_index: z.coerce.number().int().min(0).optional().default(0),
  is_active: z.boolean().optional().default(true),
  billable: z.boolean().nullable().optional(),
});

// Allt valfritt: adminvyn sparar ett fält i taget (typiskt bara payroll_code).
export const updateTimeReferenceSchema = createTimeReferenceSchema.partial();

import { z } from 'zod';

// Code is the unit's key (required on create, immutable afterwards).
export const unitCreateSchema = z.object({
  code: z.string().trim().min(1, 'Kod krävs').max(30),
  description: z.string().trim().max(100).optional(),
});

// On update the code comes from the URL; only the description is editable.
export const unitUpdateSchema = z.object({
  description: z.string().trim().max(100).optional(),
});

import { z } from 'zod';
export { ok, routeError, validationError, requireCrmUser, requireCrmWriter } from '../_shared';

export const coachContextSchema = z.object({
  type: z.enum(['prospect', 'call', 'quote']),
  id: z.string().uuid('Ogiltig kontext'),
});

export const coachRequestSchema = z.object({
  prompt: z.string().trim().min(1, 'Fråga krävs'),
  quick_action: z.string().trim().nullable().optional().default(null),
  context: z.preprocess((value) => value ?? null, coachContextSchema.nullable()).optional().default(null),
});


import { z } from 'zod';
export { ok, routeError, validationError, requireCrmUser } from '../_shared';

const opportunityStatusSchema = z.enum(['qualified', 'quoted', 'won', 'lost']);

export const listCrmOpportunitiesQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: opportunityStatusSchema.optional(),
  prospect_id: z.string().uuid().optional(),
});

export const createCrmOpportunitySchema = z.object({
  prospect_id: z.string().uuid().nullable().optional().default(null),
  title: z.string().trim().min(1, 'Titel krävs'),
  status: opportunityStatusSchema.default('qualified'),
  notes: z.string().trim().nullable().optional().default(null),
});

export const updateCrmOpportunitySchema = z.object({
  prospect_id: z.string().uuid().nullable().optional().default(null),
  title: z.string().trim().min(1, 'Titel krävs'),
  status: opportunityStatusSchema,
  notes: z.string().trim().nullable().optional().default(null),
});

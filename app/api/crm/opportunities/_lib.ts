import { z } from 'zod';
export { ok, routeError, validationError, requireCrmUser, requireCrmWriter } from '../_shared';

const opportunityStatusSchema = z.enum(['qualified', 'quoted', 'won', 'lost']);
const customerTypeSchema = z.enum(['business', 'private']);

const opportunityIdentitySchema = z.object({
  prospect_id: z.string().uuid().nullable().optional().default(null),
  customer_id: z.string().uuid().nullable().optional().default(null),
  customer_type: customerTypeSchema.nullable().optional().default(null),
  customer_name: z.string().trim().nullable().optional().default(null),
  contact_name: z.string().trim().nullable().optional().default(null),
}).refine(
  (d) => !!(d.prospect_id || d.customer_id || d.customer_name),
  { message: 'Prospekt, kund eller kundnamn krävs' }
);

export const listCrmOpportunitiesQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: opportunityStatusSchema.optional(),
  prospect_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
});

export const createCrmOpportunitySchema = opportunityIdentitySchema.and(z.object({
  title: z.string().trim().min(1, 'Titel krävs'),
  status: opportunityStatusSchema.default('qualified'),
  notes: z.string().trim().nullable().optional().default(null),
}));

export const updateCrmOpportunitySchema = opportunityIdentitySchema.and(z.object({
  title: z.string().trim().min(1, 'Titel krävs'),
  status: opportunityStatusSchema,
  notes: z.string().trim().nullable().optional().default(null),
}));

import { z } from 'zod';
export { ok, routeError, validationError, requireCrmUser } from '../_shared';

const customerTypeSchema = z.enum(['business', 'private']);
const customerStatusSchema = z.enum(['active', 'inactive', 'churned']);
const customerStageSchema = z.enum(['prospect', 'customer', 'fortnox_customer']);

const addressSchema = z
  .object({
    street: z.string().trim().nullable().optional().default(null),
    postal_code: z.string().trim().nullable().optional().default(null),
    city: z.string().trim().nullable().optional().default(null),
  })
  .nullable()
  .optional()
  .default(null);

export const listCrmCustomersQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: customerStatusSchema.optional(),
  stage: customerStageSchema.optional(),
  assigned_to: z.string().uuid().optional(),
});

export const searchCrmCustomersQuerySchema = z.object({
  q: z.string().trim().min(1, 'Sökterm krävs'),
});

export const createCrmCustomerSchema = z
  .object({
    customer_type: customerTypeSchema,
    customer_stage: customerStageSchema.optional().default('customer'),
    company_name: z.string().trim().nullable().optional().default(null),
    organization_number: z.string().trim().nullable().optional().default(null),
    first_name: z.string().trim().nullable().optional().default(null),
    last_name: z.string().trim().nullable().optional().default(null),
    personal_number: z.string().trim().nullable().optional().default(null),
    visit_address: addressSchema,
    invoice_address: addressSchema,
    fortnox_customer_id: z.string().trim().nullable().optional().default(null),
    source: z.string().trim().nullable().optional().default(null),
    notes: z.string().trim().nullable().optional().default(null),
  })
  .refine(
    (d) =>
      d.customer_type === 'business' ? !!d.company_name : !!(d.first_name && d.last_name),
    { message: 'Företagsnamn krävs för företagskund, för- och efternamn krävs för privatkund' }
  );

export const updateCrmCustomerSchema = z
  .object({
    customer_type: customerTypeSchema.optional(),
    customer_stage: customerStageSchema.optional(),
    company_name: z.string().trim().nullable().optional(),
    organization_number: z.string().trim().nullable().optional(),
    first_name: z.string().trim().nullable().optional(),
    last_name: z.string().trim().nullable().optional(),
    personal_number: z.string().trim().nullable().optional(),
    visit_address: addressSchema,
    invoice_address: addressSchema,
    fortnox_customer_id: z.string().trim().nullable().optional(),
    status: customerStatusSchema.optional(),
    source: z.string().trim().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
    assigned_to: z.string().uuid().optional(),
  });

export const createCrmCustomerContactSchema = z.object({
  name: z.string().trim().min(1, 'Namn krävs'),
  role: z.string().trim().nullable().optional().default(null),
  phone: z.string().trim().nullable().optional().default(null),
  email: z.string().trim().email('Ogiltig e-post').nullable().optional().default(null),
  is_primary: z.boolean().optional().default(false),
});

export const updateCrmCustomerContactSchema = z.object({
  name: z.string().trim().min(1, 'Namn krävs').optional(),
  role: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().email('Ogiltig e-post').nullable().optional(),
  is_primary: z.boolean().optional(),
});

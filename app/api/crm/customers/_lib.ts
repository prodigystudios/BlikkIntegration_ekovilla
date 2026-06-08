import { z } from 'zod';
export { ok, routeError, validationError, requireCrmUser } from '../_shared';

// Zod's built-in .email() rejects Unicode domain names (e.g. byggmästaren.se).
// This helper validates the structural shape of an email while accepting IDN domains.
function intlEmail(msg: string) {
  return z.string().trim()
    .refine((val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), { message: msg })
    .nullable()
    .optional();
}

const customerTypeSchema = z.enum(['business', 'private']);
const customerStatusSchema = z.enum(['active', 'inactive', 'churned']);
const customerStageSchema = z.enum(['prospect', 'customer', 'fortnox_customer']);

// Risk/intelligence flags from tic.io, stored as a JSONB list on the customer.
const riskIndicatorSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  notes: z.string().optional(),
  score: z.number().nullable().optional(),
});

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
    email: intlEmail('Ogiltig e-post').default(null),
    phone: z.string().trim().nullable().optional().default(null),
    mobile: z.string().trim().nullable().optional().default(null),
    visit_address: addressSchema,
    delivery_address: addressSchema,
    invoice_address: addressSchema,
    invoice_email: intlEmail('Ogiltig faktura-epost').default(null),
    payment_terms: z.string().trim().nullable().optional().default(null),
    price_list: z.string().trim().nullable().optional().default(null),
    discount: z.coerce.number().min(0).max(100).nullable().optional().default(null),
    vat_number: z.string().trim().nullable().optional().default(null),
    reverse_vat: z.boolean().optional().default(false),
    annual_revenue: z.coerce.number().min(0).nullable().optional().default(null),
    number_of_employees: z.coerce.number().int().min(0).nullable().optional().default(null),
    legal_entity_type: z.string().trim().nullable().optional().default(null),
    sni_code: z.string().trim().nullable().optional().default(null),
    sni_name: z.string().trim().nullable().optional().default(null),
    operating_profit: z.coerce.number().nullable().optional().default(null),
    profit_after_financial_items: z.coerce.number().nullable().optional().default(null),
    total_assets: z.coerce.number().nullable().optional().default(null),
    operating_margin: z.coerce.number().nullable().optional().default(null),
    equity_ratio: z.coerce.number().nullable().optional().default(null),
    financial_year: z.coerce.number().int().nullable().optional().default(null),
    risk_indicators: z.array(riskIndicatorSchema).nullable().optional().default(null),
    fortnox_customer_id: z.string().trim().nullable().optional().default(null),
    source: z.string().trim().nullable().optional().default(null),
    notes: z.string().trim().nullable().optional().default(null),
    create_in_fortnox: z.boolean().optional().default(false),
  })
  .refine(
    (d) =>
      d.customer_type === 'business' ? !!d.company_name : !!(d.first_name && d.last_name),
    { message: 'Företagsnamn krävs för företagskund, för- och efternamn krävs för privatkund' }
  )
  // Personal number is required for private customers – it is the OrganisationNumber
  // Fortnox uses to compute ROT deductions, so a private customer must never lack it.
  .refine(
    (d) => d.customer_type !== 'private' || !!d.personal_number,
    { message: 'Personnummer krävs för privatkund', path: ['personal_number'] }
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
    email: intlEmail('Ogiltig e-post'),
    phone: z.string().trim().nullable().optional(),
    mobile: z.string().trim().nullable().optional(),
    visit_address: addressSchema,
    delivery_address: addressSchema,
    invoice_address: addressSchema,
    invoice_email: intlEmail('Ogiltig faktura-epost'),
    payment_terms: z.string().trim().nullable().optional(),
    price_list: z.string().trim().nullable().optional(),
    discount: z.coerce.number().min(0).max(100).nullable().optional(),
    vat_number: z.string().trim().nullable().optional(),
    reverse_vat: z.boolean().optional(),
    annual_revenue: z.coerce.number().min(0).nullable().optional(),
    number_of_employees: z.coerce.number().int().min(0).nullable().optional(),
    legal_entity_type: z.string().trim().nullable().optional(),
    sni_code: z.string().trim().nullable().optional(),
    sni_name: z.string().trim().nullable().optional(),
    operating_profit: z.coerce.number().nullable().optional(),
    profit_after_financial_items: z.coerce.number().nullable().optional(),
    total_assets: z.coerce.number().nullable().optional(),
    operating_margin: z.coerce.number().nullable().optional(),
    equity_ratio: z.coerce.number().nullable().optional(),
    financial_year: z.coerce.number().int().nullable().optional(),
    risk_indicators: z.array(riskIndicatorSchema).nullable().optional(),
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
  email: intlEmail('Ogiltig e-post').default(null),
  is_primary: z.boolean().optional().default(false),
});

export const updateCrmCustomerContactSchema = z.object({
  name: z.string().trim().min(1, 'Namn krävs').optional(),
  role: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  email: intlEmail('Ogiltig e-post'),
  is_primary: z.boolean().optional(),
});

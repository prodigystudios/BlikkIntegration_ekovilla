import { z } from 'zod';
import { ROT_HOUSE_WORK_TYPES } from '@/lib/domains/fortnox/types';
export { ok, routeError, validationError, requireCrmUser, requireCrmWriter, requirePermission } from '../_shared';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseAmount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = normalizeOptionalText(value);
  if (!normalized) return NaN;
  const numeric = Number(normalized.replace(/\s+/g, '').replace(',', '.'));
  return numeric;
}

const statusSchema = z.enum(['draft', 'sent', 'follow_up', 'won', 'lost']);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum');
const quoteTypeSchema = z.enum(['private', 'business']);
const customerSourceKindSchema = z.enum(['prospect', 'local', 'fortnox']);
const customerSyncIntentSchema = z.enum(['local_only', 'on_work_order', 'linked']);
const lineItemConstructionSchema = z.enum(['vagg', 'snedtak', 'vind', '']);
const lineItemPricingSchema = z.enum(['m3', 'item']);

const customerSourceSchema = z.object({
  kind: customerSourceKindSchema.optional().default('local'),
  sync_intent: customerSyncIntentSchema.optional().default('local_only'),
  fortnox_customer_id: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  fortnox_customer_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
});

const customerSnapshotSchema = z.object({
  customer_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  company_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  organization_number: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  personal_number: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  contact_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  email: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  phone: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  street_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  postal_code: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  city: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  visit_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  delivery_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  delivery_postal_code: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  delivery_city: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  invoice_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
});

const pricingSummarySchema = z.object({
  subtotal: z.preprocess(parseAmount, z.number().finite('Ogiltig delsumma').min(0)).optional().default(0),
  vat: z.preprocess(parseAmount, z.number().finite('Ogiltig moms').min(0)).optional().default(0),
  total: z.preprocess(parseAmount, z.number().finite('Ogiltig totalsumma').min(0)).optional().default(0),
});

const rotDetailsSchema = z.object({
  enabled: z.boolean().optional().default(false),
  applicant_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  personal_number: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  property_designation: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  rot_percent: z.preprocess(parseAmount, z.number().finite('Ogiltig ROT-procent').min(0).max(100)).optional().default(30),
  max_deduction: z.preprocess(parseAmount, z.number().finite('Ogiltigt maxavdrag').min(0)).optional().default(50000),
  brf_org_number: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
});

const internalHandoffSchema = z.object({
  desired_installation_date: z.preprocess((value) => normalizeOptionalText(value), dateSchema.nullable()).optional().default(null),
  handoff_notes: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  work_scope: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
});

export const quoteLineItemSchema = z.object({
  id: z.string().min(1, 'Rad-id krävs'),
  construction: lineItemConstructionSchema.optional().default(''),
  m2: z.preprocess((value) => normalizeOptionalText(value) ?? '', z.string()).optional().default(''),
  thickness_mm: z.preprocess((value) => normalizeOptionalText(value) ?? '', z.string()).optional().default(''),
  auto_price: z.boolean().optional().default(true),
  unit_price: z.preprocess((value) => normalizeOptionalText(value) ?? '', z.string()).optional().default(''),
  pricing_mode: lineItemPricingSchema.optional().default('item'),
  quantity: z.preprocess((value) => normalizeOptionalText(value) ?? '', z.string()).optional().default(''),
  article_id: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  article_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  article_number: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  article_price: z.preprocess((value) => (value == null || value === '' ? null : parseAmount(value)), z.number().finite('Ogiltigt artikelpris').nullable()).optional().default(null),
  article_unit_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  discount_percent: z.preprocess((value) => normalizeOptionalText(value) ?? '', z.string()).optional().default(''),
  line_note: z.preprocess((value) => normalizeOptionalText(value) ?? '', z.string()).optional().default(''),
  is_rot_work: z.boolean().optional().default(false),
  house_work_type: z.preprocess((value) => normalizeOptionalText(value) ?? 'CONSTRUCTION', z.enum(ROT_HOUSE_WORK_TYPES)).optional().default('CONSTRUCTION'),
  density: z.preprocess((value) => normalizeOptionalText(value) ?? '', z.string()).optional().default(''),
});

export const listCrmQuotesQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: statusSchema.optional(),
  prospect_id: z.string().uuid('Ogiltigt prospekt').optional(),
  opportunity_id: z.string().uuid('Ogiltig affärsmöjlighet').optional(),
  customer_id: z.string().uuid('Ogiltig kund').optional(),
});

export const createCrmQuoteSchema = z.object({
  prospect_id: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltigt prospekt').nullable()).optional().default(null),
  opportunity_id: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltig affärsmöjlighet').nullable()).optional().default(null),
  // The linked CRM customer. Without this the quote/customer relation breaks: the
  // customer's quote list and the edit-view picker both resolve via customer_id.
  customer_id: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltig kund').nullable()).optional().default(null),
  customer_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  project_name: z.string().trim().min(1, 'Offertnamn krävs'),
  description: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  quote_type: quoteTypeSchema.optional().default('business'),
  customer_source: customerSourceSchema.optional().default({}),
  customer_snapshot: customerSnapshotSchema.optional().default({}),
  pricing_summary: pricingSummarySchema.optional().default({}),
  line_items: z.array(quoteLineItemSchema).optional().default([]),
  rot_details: rotDetailsSchema.optional().default({}),
  internal_handoff: internalHandoffSchema.optional().default({}),
  amount: z.preprocess(parseAmount, z.number().finite('Ogiltigt belopp').min(0, 'Belopp måste vara 0 eller högre')),
  currency_code: z.preprocess((value) => normalizeOptionalText(value)?.toUpperCase(), z.string().length(3).nullable()).optional().default('SEK'),
  vat_percent: z.preprocess(parseAmount, z.number().finite('Ogiltig moms').min(0).max(100)).optional().default(25),
  valid_until: z.preprocess((value) => normalizeOptionalText(value), dateSchema.nullable()).optional().default(null),
  status: statusSchema.optional().default('draft'),
  quote_date: dateSchema,
  follow_up_date: z.preprocess((value) => normalizeOptionalText(value), dateSchema.nullable()).optional().default(null),
  notes: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
}).superRefine((value, ctx) => {
  if (!value.prospect_id && !value.opportunity_id && !value.customer_name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customer_name'],
      message: 'Kundnamn krävs om offerten inte kopplas till ett prospekt eller en affärsmöjlighet',
    });
  }

  if (value.quote_type === 'private' && !value.customer_snapshot.personal_number) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customer_snapshot', 'personal_number'],
      message: 'Personnummer krävs för privatkund',
    });
  }

  if (value.quote_type === 'business' && !value.customer_snapshot.company_name && !value.customer_name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customer_snapshot', 'company_name'],
      message: 'Företagsnamn krävs för företagskund',
    });
  }

  if (value.quote_type === 'business' && value.rot_details.enabled) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rot_details', 'enabled'],
      message: 'ROT gäller bara privatkund',
    });
  }

  if (value.rot_details.enabled && !value.rot_details.personal_number) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rot_details', 'personal_number'],
      message: 'Personnummer krävs när ROT används',
    });
  }

  if (value.line_items.length > 0) {
    const hasPopulatedRow = value.line_items.some((item) => item.article_name || item.m2 || item.quantity || item.unit_price);

    if (!hasPopulatedRow) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['line_items'],
        message: 'Lägg till minst en offert-rad eller rensa radlistan',
      });
    }
  }

  if (value.customer_source.kind === 'prospect' && !value.prospect_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customer_source', 'kind'],
      message: 'Prospekt måste vara valt när kundkällan är prospekt',
    });
  }

});

export const updateCrmQuoteSchema = createCrmQuoteSchema;

// Persist only fields the client actually sent (shared helper, also used by work orders).
// Prevents a partial PATCH — status change, "clear articles" save — from wiping untouched
// columns (line_items, internal_handoff, rot_details, customer_id) with schema defaults.
export { pickProvidedFields as pickProvidedQuoteFields } from '../_shared';


import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/route';

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
const lineItemConstructionSchema = z.enum(['vagg', 'snedtak', 'vind', '']);
const lineItemPricingSchema = z.enum(['m3', 'item']);

const customerSnapshotSchema = z.object({
  customer_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  company_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  personal_number: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  contact_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  email: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  phone: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  street_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  postal_code: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  city: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  visit_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  delivery_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
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
});

const internalHandoffSchema = z.object({
  desired_installation_date: z.preprocess((value) => normalizeOptionalText(value), dateSchema.nullable()).optional().default(null),
  handoff_notes: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  work_scope: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
});

const quoteLineItemSchema = z.object({
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
});

export const listCrmQuotesQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: statusSchema.optional(),
  prospect_id: z.string().uuid('Ogiltigt prospekt').optional(),
});

export const createCrmQuoteSchema = z.object({
  prospect_id: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltigt prospekt').nullable()).optional().default(null),
  customer_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  project_name: z.string().trim().min(1, 'Offertnamn krävs'),
  description: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  quote_type: quoteTypeSchema.optional().default('business'),
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
  if (!value.prospect_id && !value.customer_name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customer_name'],
      message: 'Kundnamn krävs om offerten inte kopplas till ett prospekt',
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
});

export const updateCrmQuoteSchema = createCrmQuoteSchema;

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      errorDetails: { code, message, ...(details !== undefined ? { details } : {}) },
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function getFirstValidationMessage(parsedError: z.ZodError) {
  const flattened = parsedError.flatten();
  const fieldErrorGroups = Object.values(flattened.fieldErrors);

  for (const messages of fieldErrorGroups) {
    const firstMessage = messages?.find(Boolean);
    if (firstMessage) return firstMessage;
  }

  return flattened.formErrors.find(Boolean) || 'Invalid request';
}

export function validationError(parsedError: z.ZodError) {
  return routeError(400, 'validation_error', getFirstValidationMessage(parsedError), parsedError.flatten());
}

export async function requireCrmUser() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return { currentUser: null, response: routeError(401, 'unauthorized', 'Unauthorized') };
  }

  if (!(currentUser.role === 'sales' || currentUser.role === 'admin')) {
    return { currentUser: null, response: routeError(403, 'forbidden', 'Forbidden') };
  }

  return { currentUser, response: null };
}
import { z } from 'zod';
import { ROT_HOUSE_WORK_TYPES } from '@/lib/domains/fortnox/types';
import { can, getEffectivePermissions } from '@/lib/auth/permissions';
import { listCrmSellers } from '@/lib/domains/crm/customers';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { routeError } from '../_shared';
export { ok, routeError, validationError, invalidUuidParam, isNoRowsError, requireCrmUser, requireCrmWriter, requirePermission } from '../_shared';

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
  // Separate on-site contact (slutkund) outside the customer card. null unless entered.
  end_contact_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  end_contact_phone: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  end_contact_email: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  // Free-text märkning (företag) → Fortnox "Ert referensnummer". null unless entered.
  label: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  // Point-in-time byggmoms flag (omvänd skattskyldighet). null = unknown (legacy rows).
  reverse_vat: z.boolean().nullable().optional().default(null),
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
  // Artikelns beskrivning ur artikelregistret, kopierad till raden när artikeln väljs. MÅSTE ligga
  // i schemat — annars strippar Zod fältet vid varje sparning och hjälptexten försvinner tyst så
  // fort offerten öppnas igen. Samma fälla som is_rot_work och written_off gick i.
  // INTERN: läses aldrig av Fortnox-pushen, se tests/fortnox/offers.test.ts.
  article_note: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  discount_percent: z.preprocess((value) => normalizeOptionalText(value) ?? '', z.string()).optional().default(''),
  line_note: z.preprocess((value) => normalizeOptionalText(value) ?? '', z.string()).optional().default(''),
  is_rot_work: z.boolean().optional().default(false),
  house_work_type: z.preprocess((value) => normalizeOptionalText(value) ?? 'CONSTRUCTION', z.enum(ROT_HOUSE_WORK_TYPES)).optional().default('CONSTRUCTION'),
  // Labour carved out of a material row for ROT (kr, ex VAT). Summed onto the "Arbetskostnad ROT"
  // Fortnox row at push time; stored as entered so the split can be recomputed on edit.
  labor_cost: z.preprocess((value) => normalizeOptionalText(value) ?? '', z.string()).optional().default(''),
  density: z.preprocess((value) => normalizeOptionalText(value) ?? '', z.string()).optional().default(''),
  // Avskriven rad (bara meningsfull på en arbetsorder): såld men aldrig utförd, räknas bort ur
  // summan och skickas inte till Fortnox. MÅSTE finnas i schemat — annars strippar Zod flaggan vid
  // varje sparning av artiklarna och avskrivningen försvinner tyst. Samma fälla som is_rot_work
  // gick i en gång (se FORTNOX_INTEGRATION.md brist 3).
  written_off: z.boolean().optional().default(false),
});

export const listCrmQuotesQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: statusSchema.optional(),
  prospect_id: z.string().uuid('Ogiltigt prospekt').optional(),
  customer_id: z.string().uuid('Ogiltig kund').optional(),
  // Optional cap override. The default (100) suits the offer list; board views that
  // group ALL of a seller's quotes client-side pass a higher value so won/lost
  // quotes aren't truncated. Bounded to keep the query safe.
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  // Pagination offset for the offer list's "Visa fler".
  offset: z.coerce.number().int().min(0).optional(),
  // Tab filter (status group). Server-side so the paginated list is correct.
  filter: z.enum(['all', 'active', 'follow_up', 'won', 'lost']).optional(),
  // Assignee scope — comma-separated user ids ('mine' is resolved to the current user id on the
  // client before sending). Empty/absent = everyone.
  assignee: z.string().trim().optional(),
  // Row order. Default (status_asc) is the historical working order; the offer list asks for
  // 'created_desc' (newest first) or 'follow_up_asc' (most urgent first), the overview for
  // 'updated_desc'.
  sort: z.enum(['status_asc', 'updated_desc', 'created_desc', 'follow_up_asc']).optional(),
});

export const createCrmQuoteSchema = z.object({
  prospect_id: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltigt prospekt').nullable()).optional().default(null),
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
  // Ansvarig säljare. Optional UTAN default och INTE nullable: kolumnen är not null, och
  // `undefined` måste betyda "rör inte" — ett default hade skrivit ett värde vid varje PATCH.
  // Vem som får sätta fältet avgörs i rutterna (crm.admin); schemat bara släpper igenom det.
  // MÅSTE stå här: ett fält utanför schemat strippas tyst av Zod vid varje sparning, samma
  // fälla som is_rot_work, written_off och article_note gick i.
  assigned_to: z.string().uuid('Ogiltig ansvarig säljare').optional(),
}).superRefine((value, ctx) => {
  if (!value.prospect_id && !value.customer_id && !value.customer_name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customer_name'],
      message: 'Kundnamn krävs om offerten inte kopplas till ett prospekt eller en kund',
    });
  }

  // Personnummer krävs INTE på offerten, inte ens med ROT påslaget. Kunden vill i praktiken ofta
  // inte lämna ut numret förrän hen bestämt sig för att tacka ja, och en spärr här tvingar då
  // fram antingen ett påhittat nummer eller en offert utan ROT — båda sämre än att fråga senare.
  // (De platshållarnummer som ligger i kundregistret, `11111` och `0000000`, uppstod på just
  // det sättet.)
  //
  // Kravet ligger i stället på ARBETSORDERN (`createCrmWorkOrderFromQuote` /
  // `createStandaloneCrmWorkOrder` → `missing_personal_number` / `invalid_personal_number`), som
  // är efter att kunden tackat ja och före allt som når bokföringen. Offertformuläret fäller redan
  // ut ett inmatningsfält på den felkoden, så numret efterfrågas i det ögonblick det behövs.
  // Samma placering som fastighetsbeteckningen (FORTNOX_INTEGRATION.md 4b, V3) — de två ROT-
  // förutsättningarna följs nu åt i stället för att gälla i olika skeden.
  //
  // Formatkravet på tolv siffror står kvar där ett nummer FAKTISKT skrivs in (kundformuläret,
  // POST/PATCH /api/crm/customers, orderskapandet). Det som tas bort är kravet att lämna ett
  // nummer — aldrig kravet att det som lämnas är komplett; ett tiosiffrigt nummer bryter ROT
  // tyst i Fortnox (FORTNOX_INTEGRATION.md 4e).

  if (value.quote_type === 'business' && !value.customer_snapshot.company_name && !value.customer_name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customer_snapshot', 'company_name'],
      message: 'Företagsnamn krävs för företagskund',
    });
  }

  // Er referens (kontaktperson) becomes YourReference on the Fortnox offer and carries
  // through offer → order → invoice. Required on a real quote save — guarded by line_items
  // so a status-only PATCH (which omits rows, e.g. marking a quote won/lost from the list)
  // can't be blocked on a legacy quote whose snapshot predates this rule. The quote form
  // always sends at least one row, so every genuine save is covered.
  if (value.line_items.length > 0 && !value.customer_snapshot.contact_name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customer_snapshot', 'contact_name'],
      message: 'Er referens (kontaktperson) krävs',
    });
  }

  if (value.quote_type === 'business' && value.rot_details.enabled) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rot_details', 'enabled'],
      message: 'ROT gäller bara privatkund',
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

/**
 * Avgör om en inkommande `assigned_to` får skrivas.
 *
 * Att byta ansvarig säljare kräver crm.admin — chefen som gör offerten åt en säljare. Det
 * är också vad RLS förutsätter: offertens UPDATE-policy har `auth.uid() = assigned_to` i
 * BÅDE using och with check, så en säljare som lämnade över sin egen offert hade skrivit sig
 * själv ur policyn i samma operation och fått 0 rader tillbaka. Admin passerar båda grenarna.
 *
 * Oförändrat värde släpps igenom utan behörighetskrav: en klient som ekar tillbaka offertens
 * nuvarande ansvariga i sin payload ska inte få 403 för att den råkade skicka med fältet.
 * `undefined` tillbaka betyder "skriv inte kolumnen".
 *
 * Mottagaren valideras mot säljarlistan (sales/admin). Utan den kontrollen går det att parkera
 * en offert på en installatör, som varken kan öppna eller redigera den — offerten blir låst
 * för alla utom administratörer.
 */
export async function authorizeQuoteAssignee(
  requested: string | undefined,
  currentAssignee: string | null
): Promise<{ assignedTo: string | undefined; response: null } | { assignedTo: null; response: Response }> {
  if (requested === undefined || requested === currentAssignee) {
    return { assignedTo: undefined, response: null };
  }

  const permissions = await getEffectivePermissions();
  if (!can(permissions, 'crm.admin')) {
    return {
      assignedTo: null,
      response: routeError(
        403,
        'crm_quote_assignee_forbidden',
        'Bara en administratör kan ändra ansvarig säljare på en offert.'
      ),
    };
  }

  const sellers = await listCrmSellers(getSupabaseAdmin());
  if (!sellers.some((seller) => seller.id === requested)) {
    return {
      assignedTo: null,
      response: routeError(
        422,
        'crm_quote_assignee_invalid',
        'Ansvarig säljare måste vara en säljare eller administratör.'
      ),
    };
  }

  return { assignedTo: requested, response: null };
}

// Persist only fields the client actually sent (shared helper, also used by work orders).
// Prevents a partial PATCH — status change, "clear articles" save — from wiping untouched
// columns (line_items, internal_handoff, rot_details, customer_id) with schema defaults.
export { pickProvidedFields as pickProvidedQuoteFields } from '../_shared';


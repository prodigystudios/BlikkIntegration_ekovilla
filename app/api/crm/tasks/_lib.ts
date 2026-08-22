import { z } from 'zod';
import { can, getEffectivePermissions } from '@/lib/auth/permissions';
import { listCrmSellers } from '@/lib/domains/crm/customers';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { routeError } from '../_shared';
export { ok, routeError, validationError, requireCrmUser, requireCrmWriter } from '../_shared';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

const statusSchema = z.enum(['open', 'done']);
const prioritySchema = z.enum(['low', 'normal', 'high']);
const relatedTypeSchema = z.enum(['crm_prospect', 'crm_customer', 'crm_quote']);
const dueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum');

export const listCrmTasksQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: statusSchema.optional(),
  prospect_id: z.string().uuid('Ogiltigt prospekt').optional(),
  customer_id: z.string().uuid('Ogiltig kund').optional(),
  // 'delegated' = uppgifter den inloggade skapat ÅT ANDRA. Egen läsväg och inte ett filter på
  // den vanliga listan: raderna tillhör mottagaren och ligger utanför anroparens RLS.
  scope: z.enum(['own', 'delegated']).optional().default('own'),
  // Samma form som offertrutten (quotes/_lib.ts): valfri, och utan den gäller domänens
  // egen tak-gräns som förut.
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

export const createCrmTaskSchema = z.object({
  // A task may link to one CRM entity (prospect, customer or quote) via related_type/related_id.
  related_type: z.preprocess((value) => normalizeOptionalText(value), relatedTypeSchema.nullable()).optional().default(null),
  related_id: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltig koppling').nullable()).optional().default(null),
  related_label: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  title: z.string().trim().min(1, 'Uppgiftstitel krävs'),
  details: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  status: statusSchema.optional().default('open'),
  priority: prioritySchema.optional().default('normal'),
  due_date: z.preprocess((value) => normalizeOptionalText(value), dueDateSchema.nullable()).optional().default(null),
  remind_at: z.preprocess((value) => normalizeOptionalText(value), z.string().datetime('Ogiltig påminnelsetid').nullable()).optional().default(null),
  source: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  // Vem uppgiften ska ligga på. Utelämnad = den som skapar den, alltså dagens beteende.
  // Optional UTAN default, så `undefined` betyder "mig själv" och inte ett skrivet värde.
  // Att sätta någon annan kräver crm.admin — se authorizeTaskOwner.
  user_id: z.string().uuid('Ogiltig mottagare').optional(),
}).refine((data) => (data.related_id ? data.related_type != null : true), {
  message: 'Koppling kräver en typ',
  path: ['related_type'],
}).refine((data) => (data.related_type ? data.related_id != null : true), {
  message: 'Välj vilken post uppgiften ska kopplas till',
  path: ['related_id'],
});

export const updateCrmTaskSchema = createCrmTaskSchema;

/**
 * Avgör om en uppgift får läggas på någon annan än den som skapar den.
 *
 * Att delegera kräver crm.admin — säljchefen lägger upp uppgifter åt sina säljare. Mottagaren
 * valideras dessutom mot säljarkatalogen (sales/admin): utan den kontrollen går det att parkera
 * en uppgift på en installatör, som varken når /crm eller ser uppgiftslistan, och uppgiften blir
 * osynlig för alla utom den som skrev den.
 *
 * Returnerar `null` som ägare när uppgiften är till en själv — anroparen använder då sitt eget
 * id och den vanliga sessionsvägen, precis som förut.
 */
export async function authorizeTaskOwner(
  requested: string | undefined,
  currentUserId: string
): Promise<{ ownerId: string | null; response: null } | { ownerId: null; response: Response }> {
  if (requested === undefined || requested === currentUserId) {
    return { ownerId: null, response: null };
  }

  const permissions = await getEffectivePermissions();
  if (!can(permissions, 'crm.admin')) {
    return {
      ownerId: null,
      response: routeError(
        403,
        'crm_task_owner_forbidden',
        'Bara en administratör kan lägga upp uppgifter åt någon annan.'
      ),
    };
  }

  const sellers = await listCrmSellers(getSupabaseAdmin());
  if (!sellers.some((seller) => seller.id === requested)) {
    return {
      ownerId: null,
      response: routeError(
        422,
        'crm_task_owner_invalid',
        'Uppgiften kan bara läggas på en säljare eller administratör.'
      ),
    };
  }

  return { ownerId: requested, response: null };
}


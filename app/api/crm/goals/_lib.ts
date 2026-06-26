import { z } from 'zod';
import { getCurrentMonthStartDate } from '@/lib/domains/crm/goals';
export { ok, routeError, validationError, requireCrmUser, requireCrmWriter, requireCrmAdmin } from '../_shared';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

const nonNegativeIntSchema = z.coerce.number().int().min(0, 'Värdet kan inte vara negativt');
const nonNegativeNumberSchema = z.coerce.number().min(0, 'Värdet kan inte vara negativt');

export const listCrmGoalsQuerySchema = z.object({
  period_type: z.enum(['week', 'month']).optional().default('month'),
  period_start: z.preprocess(
    (value) => normalizeOptionalText(value) || getCurrentMonthStartDate(),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt perioddatum'),
  ),
});

export const upsertCrmGoalsSchema = z.object({
  period_type: z.enum(['week', 'month']).optional().default('month'),
  period_start: z.preprocess(
    (value) => normalizeOptionalText(value) || getCurrentMonthStartDate(),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt perioddatum'),
  ),
  goals: z.array(z.object({
    user_id: z.string().uuid('Ogiltig användare'),
    calls_target: nonNegativeIntSchema,
    quotes_target: nonNegativeIntSchema,
    quote_value_target: nonNegativeNumberSchema,
    order_count_target: nonNegativeIntSchema,
    order_value_target: nonNegativeNumberSchema,
  })).min(1, 'Minst ett mål krävs').max(50, 'För många mål i samma uppdatering'),
});


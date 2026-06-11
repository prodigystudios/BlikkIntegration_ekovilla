import { z } from 'zod';

// Planning is a CRM surface, so it shares the CRM route helpers + permission gate directly.
export { ok, routeError, validationError, invalidUuidParam, requirePermission } from '../_shared';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum (YYYY-MM-DD)');

export const listSegmentsQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
});

const jobType = z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(40).nullable());

export const placeSegmentSchema = z.object({
  work_order_id: z.string().uuid('Ogiltig arbetsorder'),
  truck_id: z.string().uuid('Ogiltig bil'),
  start_day: isoDate,
  end_day: isoDate,
  sort_index: z.coerce.number().int().min(0).optional(),
  job_type: jobType.optional(),
});

export const moveSegmentSchema = z.object({
  truck_id: z.string().uuid('Ogiltig bil').optional(),
  start_day: isoDate.optional(),
  end_day: isoDate.optional(),
  sort_index: z.coerce.number().int().min(0).optional(),
  job_type: jobType.optional(),
});

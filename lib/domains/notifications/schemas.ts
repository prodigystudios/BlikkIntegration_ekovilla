import { z } from 'zod';

// Query for GET /api/notifications. Keep the page small (well under the PostgREST row cap) and
// paginate with a created_at cursor.
export const listNotificationsQuerySchema = z.object({
  unreadOnly: z
    .preprocess((v) => (v === 'true' || v === true ? true : v === 'false' || v === false ? false : v), z.boolean())
    .optional()
    .default(false),
  limit: z.coerce.number().int().min(1).max(50).optional().default(30),
  // ISO timestamp; return rows strictly older than this (keyset pagination on created_at).
  before: z.string().datetime().optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

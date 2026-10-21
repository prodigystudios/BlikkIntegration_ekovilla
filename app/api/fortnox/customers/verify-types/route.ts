import { z } from 'zod';
import { requireCrmAdmin, ok, routeError, validationError } from '../../_shared';
import { verifyCustomerTypesBatch } from '@/lib/domains/fortnox/customers';

// Processes one throttled batch of queued customers and reads their Fortnox cards.
// Resumable – the client loops until remaining === 0, passing the previous batch's
// `last` as `after` so a card that keeps failing is not retried first in every batch.
export const maxDuration = 60;

const bodySchema = z.object({
  after: z.string().min(1).nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    // Kroppen är valfri: utan den börjar omgången från början av kön.
    const rawBody = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(rawBody ?? {});
    if (!parsed.success) return validationError(parsed.error);

    const result = await verifyCustomerTypesBatch(parsed.data.after ?? null);
    return ok(result);
  } catch (e: any) {
    return routeError(500, 'fortnox_verify_types_failed', e?.message || 'Hämtningen av kundkort misslyckades');
  }
}

import { z } from 'zod';
import { routeError } from '../_shared';
import { FortnoxApiError, FortnoxNotConnectedError } from '@/lib/domains/fortnox/client';
import type { FortnoxArticleInput } from '@/lib/domains/fortnox/types';

// Shared body schema for the article write endpoints. ArticleNumber is only
// meaningful on create (Fortnox auto-assigns when omitted); the update route
// takes the number from the URL and ignores any in the body.
export const fortnoxArticleInputSchema = z.object({
  article_number: z.string().trim().max(50).optional(),
  description: z.string().trim().min(1, 'Beskrivning krävs').max(200),
  sales_price: z.number().nonnegative().nullable().optional(),
  purchase_price: z.number().nonnegative().nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  type: z.enum(['STOCK', 'SERVICE']),
  active: z.boolean(),
});

export type FortnoxArticleBody = z.infer<typeof fortnoxArticleInputSchema>;

// Map the snake_case API body to the domain's Fortnox-shaped input.
export function toFortnoxArticleInput(body: FortnoxArticleBody): FortnoxArticleInput {
  return {
    ArticleNumber: body.article_number ?? null,
    Description: body.description,
    SalesPrice: body.sales_price ?? null,
    PurchasePrice: body.purchase_price ?? null,
    Unit: body.unit ?? null,
    Type: body.type,
    Active: body.active,
  };
}

// Translate a thrown error from a Fortnox write into a deliberate route response.
// FortnoxNotConnectedError → 400 (admin must connect first); FortnoxApiError keeps
// Fortnox's own status (e.g. 4xx when an article is in use and cannot be deleted).
export function fortnoxWriteError(e: unknown, code: string, fallback: string) {
  if (e instanceof FortnoxNotConnectedError) {
    return routeError(400, 'fortnox_not_connected', e.message);
  }
  if (e instanceof FortnoxApiError) {
    const status = e.status >= 400 && e.status < 600 ? e.status : 502;
    return routeError(status, 'fortnox_api_error', e.message);
  }
  return routeError(500, code, (e as any)?.message || fallback);
}

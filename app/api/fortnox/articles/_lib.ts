import { z } from 'zod';
import { routeError } from '../_shared';
import { FortnoxApiError, FortnoxNotConnectedError } from '@/lib/domains/fortnox/client';
import type { FortnoxArticleInput, FortnoxArticlePriceInput } from '@/lib/domains/fortnox/types';

// Shared body schema for the article write endpoints. ArticleNumber is only
// meaningful on create (Fortnox auto-assigns when omitted); the update route
// takes the number from the URL and ignores any in the body. Sales prices are
// per price list in `prices` (price: null clears that list's price).
export const fortnoxArticleInputSchema = z.object({
  article_number: z.string().trim().max(50).optional(),
  description: z.string().trim().min(1, 'Namn krävs').max(200),
  purchase_price: z.number().nonnegative().nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  type: z.enum(['STOCK', 'SERVICE']),
  active: z.boolean(),
  vat: z.number().min(0).max(100).nullable().optional(),
  ean: z.string().trim().max(40).nullable().optional(),
  manufacturer: z.string().trim().max(100).nullable().optional(),
  manufacturer_article_number: z.string().trim().max(100).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  prices: z
    .array(
      z.object({
        price_list: z.string().trim().min(1).max(50),
        price: z.number().nonnegative().nullable(),
      }),
    )
    .optional(),
});

export type FortnoxArticleBody = z.infer<typeof fortnoxArticleInputSchema>;

// Map the snake_case API body to the domain's Fortnox-shaped input.
export function toFortnoxArticleInput(body: FortnoxArticleBody): FortnoxArticleInput {
  return {
    ArticleNumber: body.article_number ?? null,
    Description: body.description,
    PurchasePrice: body.purchase_price ?? null,
    Unit: body.unit ?? null,
    Type: body.type,
    Active: body.active,
    VAT: body.vat ?? null,
    EAN: body.ean ?? null,
    Manufacturer: body.manufacturer ?? null,
    ManufacturerArticleNumber: body.manufacturer_article_number ?? null,
    Note: body.note ?? null,
  };
}

// Extract the per-price-list prices from the API body.
export function toFortnoxPrices(body: FortnoxArticleBody): FortnoxArticlePriceInput[] {
  return (body.prices ?? []).map((p) => ({ priceList: p.price_list, price: p.price }));
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

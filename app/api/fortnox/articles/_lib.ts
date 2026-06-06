import { z } from 'zod';
import type { FortnoxArticleInput, FortnoxArticlePriceInput } from '@/lib/domains/fortnox/types';

// Shared Fortnox error→response mapper, re-exported so the article routes can
// keep importing it from this module.
export { fortnoxWriteError } from '../_shared';

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

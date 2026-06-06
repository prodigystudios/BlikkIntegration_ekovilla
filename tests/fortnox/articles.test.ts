import { describe, it, expect } from 'vitest';
import { buildFortnoxArticlePayload } from '@/lib/domains/fortnox/articles';
import {
  fortnoxArticleInputSchema,
  toFortnoxArticleInput,
  toFortnoxPrices,
} from '@/app/api/fortnox/articles/_lib';
import type { FortnoxArticleInput } from '@/lib/domains/fortnox/types';

function input(overrides: Partial<FortnoxArticleInput> = {}): FortnoxArticleInput {
  return {
    ArticleNumber: null,
    Description: 'Lösull',
    PurchasePrice: 60,
    Unit: 'm³',
    Type: 'STOCK',
    Active: true,
    VAT: 25,
    EAN: '7350001234567',
    Manufacturer: 'Ekovilla',
    ManufacturerArticleNumber: 'EK-1',
    Note: 'Anteckning',
    ...overrides,
  };
}

describe('buildFortnoxArticlePayload', () => {
  it('never sends SalesPrice – it is read-only on price-list accounts (regression for Fortnox 2000321)', () => {
    const create = buildFortnoxArticlePayload(input(), true);
    const update = buildFortnoxArticlePayload(input(), false);
    expect('SalesPrice' in create).toBe(false);
    expect('SalesPrice' in update).toBe(false);
  });

  it('maps the writable fields with exact Fortnox field names', () => {
    const payload = buildFortnoxArticlePayload(input(), false);
    expect(payload).toMatchObject({
      Description: 'Lösull',
      PurchasePrice: 60,
      Unit: 'm³',
      Type: 'STOCK',
      Active: true,
      VAT: 25,
      EAN: '7350001234567',
      Manufacturer: 'Ekovilla',
      ManufacturerArticleNumber: 'EK-1',
      Note: 'Anteckning',
    });
  });

  it('includes ArticleNumber on create only when one is supplied', () => {
    const withNumber = buildFortnoxArticlePayload(input({ ArticleNumber: 'A100' }), true);
    expect(withNumber).toMatchObject({ ArticleNumber: 'A100' });

    const autoNumber = buildFortnoxArticlePayload(input({ ArticleNumber: '' }), true);
    expect('ArticleNumber' in autoNumber).toBe(false);
  });

  it('never includes ArticleNumber on update (it is the immutable key from the URL)', () => {
    const payload = buildFortnoxArticlePayload(input({ ArticleNumber: 'A100' }), false);
    expect('ArticleNumber' in payload).toBe(false);
  });

  it('omits null optional fields so an update never blanks existing Fortnox data', () => {
    const payload = buildFortnoxArticlePayload(
      input({ PurchasePrice: null, Unit: null, VAT: null, EAN: null, Manufacturer: null, ManufacturerArticleNumber: null, Note: null }),
      false,
    );
    expect(payload.PurchasePrice).toBeUndefined();
    expect(payload.Unit).toBeUndefined();
    expect(payload.VAT).toBeUndefined();
    expect(payload.EAN).toBeUndefined();
    expect(payload.Manufacturer).toBeUndefined();
    expect(payload.ManufacturerArticleNumber).toBeUndefined();
    expect(payload.Note).toBeUndefined();
  });

  it('keeps Active=false rather than dropping it (inactivation must reach Fortnox)', () => {
    const payload = buildFortnoxArticlePayload(input({ Active: false }), false);
    expect(payload.Active).toBe(false);
  });
});

describe('toFortnoxArticleInput', () => {
  it('maps the snake_case API body to the Fortnox-shaped input', () => {
    const result = toFortnoxArticleInput({
      article_number: 'A1',
      description: 'Vara',
      purchase_price: 80,
      unit: 'st',
      type: 'SERVICE',
      active: true,
      vat: 12,
      ean: '12345',
      manufacturer: 'Acme',
      manufacturer_article_number: 'X-9',
      note: 'Not',
    });
    expect(result).toEqual({
      ArticleNumber: 'A1',
      Description: 'Vara',
      PurchasePrice: 80,
      Unit: 'st',
      Type: 'SERVICE',
      Active: true,
      VAT: 12,
      EAN: '12345',
      Manufacturer: 'Acme',
      ManufacturerArticleNumber: 'X-9',
      Note: 'Not',
    });
  });

  it('normalises missing optional fields to null', () => {
    const result = toFortnoxArticleInput({
      description: 'Minimal',
      type: 'STOCK',
      active: false,
    });
    expect(result.ArticleNumber).toBeNull();
    expect(result.PurchasePrice).toBeNull();
    expect(result.Unit).toBeNull();
    expect(result.VAT).toBeNull();
    expect(result.EAN).toBeNull();
    expect(result.Manufacturer).toBeNull();
    expect(result.ManufacturerArticleNumber).toBeNull();
    expect(result.Note).toBeNull();
  });
});

describe('toFortnoxPrices', () => {
  it('maps the prices array to per-price-list input (null clears a list)', () => {
    const result = toFortnoxPrices({
      description: 'Vara',
      type: 'STOCK',
      active: true,
      prices: [
        { price_list: 'A', price: 900 },
        { price_list: 'BYGG', price: null },
      ],
    });
    expect(result).toEqual([
      { priceList: 'A', price: 900 },
      { priceList: 'BYGG', price: null },
    ]);
  });

  it('returns an empty array when no prices are sent', () => {
    expect(toFortnoxPrices({ description: 'Vara', type: 'STOCK', active: true })).toEqual([]);
  });
});

describe('fortnoxArticleInputSchema', () => {
  it('accepts a valid body', () => {
    const parsed = fortnoxArticleInputSchema.safeParse({
      description: 'Giltig',
      type: 'STOCK',
      active: true,
      prices: [{ price_list: 'A', price: 900 }],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an empty description', () => {
    const parsed = fortnoxArticleInputSchema.safeParse({ description: '   ', type: 'STOCK', active: true });
    expect(parsed.success).toBe(false);
  });

  it('rejects an unknown article type', () => {
    const parsed = fortnoxArticleInputSchema.safeParse({ description: 'Vara', type: 'WIDGET', active: true });
    expect(parsed.success).toBe(false);
  });

  it('rejects a negative price on a price list', () => {
    const parsed = fortnoxArticleInputSchema.safeParse({
      description: 'Vara',
      type: 'STOCK',
      active: true,
      prices: [{ price_list: 'A', price: -1 }],
    });
    expect(parsed.success).toBe(false);
  });
});

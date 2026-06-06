import { describe, it, expect } from 'vitest';
import { buildFortnoxArticlePayload } from '@/lib/domains/fortnox/articles';
import { fortnoxArticleInputSchema, toFortnoxArticleInput } from '@/app/api/fortnox/articles/_lib';
import type { FortnoxArticleInput } from '@/lib/domains/fortnox/types';

function input(overrides: Partial<FortnoxArticleInput> = {}): FortnoxArticleInput {
  return {
    ArticleNumber: null,
    Description: 'Lösull',
    SalesPrice: 100,
    PurchasePrice: 60,
    Unit: 'm³',
    Type: 'STOCK',
    Active: true,
    ...overrides,
  };
}

describe('buildFortnoxArticlePayload', () => {
  it('never sends SalesPrice – it is read-only on price-list accounts (regression for Fortnox 2000321)', () => {
    const create = buildFortnoxArticlePayload(input({ SalesPrice: 999 }), true);
    const update = buildFortnoxArticlePayload(input({ SalesPrice: 999 }), false);
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

  it('omits null price/unit so an update never blanks existing Fortnox data', () => {
    const payload = buildFortnoxArticlePayload(
      input({ PurchasePrice: null, Unit: null }),
      false,
    );
    expect(payload.PurchasePrice).toBeUndefined();
    expect(payload.Unit).toBeUndefined();
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
      sales_price: 120,
      purchase_price: 80,
      unit: 'st',
      type: 'SERVICE',
      active: true,
    });
    expect(result).toEqual({
      ArticleNumber: 'A1',
      Description: 'Vara',
      SalesPrice: 120,
      PurchasePrice: 80,
      Unit: 'st',
      Type: 'SERVICE',
      Active: true,
    });
  });

  it('normalises missing optional fields to null', () => {
    const result = toFortnoxArticleInput({
      description: 'Minimal',
      type: 'STOCK',
      active: false,
    });
    expect(result.ArticleNumber).toBeNull();
    expect(result.SalesPrice).toBeNull();
    expect(result.PurchasePrice).toBeNull();
    expect(result.Unit).toBeNull();
  });
});

describe('fortnoxArticleInputSchema', () => {
  it('accepts a valid body', () => {
    const parsed = fortnoxArticleInputSchema.safeParse({
      description: 'Giltig',
      type: 'STOCK',
      active: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an empty description', () => {
    const parsed = fortnoxArticleInputSchema.safeParse({
      description: '   ',
      type: 'STOCK',
      active: true,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an unknown article type', () => {
    const parsed = fortnoxArticleInputSchema.safeParse({
      description: 'Vara',
      type: 'WIDGET',
      active: true,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a negative sales price', () => {
    const parsed = fortnoxArticleInputSchema.safeParse({
      description: 'Vara',
      sales_price: -1,
      type: 'STOCK',
      active: true,
    });
    expect(parsed.success).toBe(false);
  });
});

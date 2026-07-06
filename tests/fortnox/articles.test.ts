import { describe, it, expect } from 'vitest';
import { buildFortnoxArticlePayload } from '@/lib/domains/fortnox/articles';
import { articleSearchTokens, matchesArticleSearch, sortArticlesFavoritesFirst } from '@/lib/domains/fortnox/articleSearch';
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

describe('articleSearchTokens', () => {
  it('splits multi-word queries into separate tokens (AND-across-tokens matching)', () => {
    expect(articleSearchTokens('cellulosa lösull')).toEqual(['cellulosa', 'lösull']);
    expect(articleSearchTokens('lösull 15')).toEqual(['lösull', '15']);
  });

  it('collapses extra whitespace and trims', () => {
    expect(articleSearchTokens('  lösull   15kg  ')).toEqual(['lösull', '15kg']);
  });

  it('strips characters that would corrupt the PostgREST filter or act as LIKE wildcards', () => {
    // comma, parens, percent, underscore, backslash, quote, asterisk
    expect(articleSearchTokens('15,5')).toEqual(['155']);
    expect(articleSearchTokens('lösull (25%)')).toEqual(['lösull', '25']);
    expect(articleSearchTokens('a_b*c')).toEqual(['abc']);
  });

  it('single token behaves like the old contains-match (no regression)', () => {
    expect(articleSearchTokens('lösull')).toEqual(['lösull']);
  });

  it('empty / whitespace / null → no tokens (falls back to default list)', () => {
    expect(articleSearchTokens('')).toEqual([]);
    expect(articleSearchTokens('   ')).toEqual([]);
    expect(articleSearchTokens(undefined)).toEqual([]);
    expect(articleSearchTokens(null)).toEqual([]);
    expect(articleSearchTokens('%%% ,,,')).toEqual([]);
  });
});

describe('matchesArticleSearch (client-side register filter)', () => {
  const article = { article_number: 'EK-1042', description: 'Cellulosa lösull 15kg säck' };

  it('matches multi-word queries regardless of word order', () => {
    expect(matchesArticleSearch(article, 'lösull cellulosa')).toBe(true);
    expect(matchesArticleSearch(article, 'lösull 15')).toBe(true);
    expect(matchesArticleSearch(article, '15 säck')).toBe(true);
  });

  it('matches across number and description', () => {
    expect(matchesArticleSearch(article, '1042 lösull')).toBe(true);
  });

  it('requires every token to appear (AND)', () => {
    expect(matchesArticleSearch(article, 'lösull glasull')).toBe(false);
  });

  it('empty query matches everything', () => {
    expect(matchesArticleSearch(article, '')).toBe(true);
    expect(matchesArticleSearch(article, '   ')).toBe(true);
  });

  it('tolerates null fields', () => {
    expect(matchesArticleSearch({ article_number: null, description: null }, 'x')).toBe(false);
    expect(matchesArticleSearch({ article_number: 'EK-9', description: null }, 'ek-9')).toBe(true);
  });
});

describe('sortArticlesFavoritesFirst', () => {
  it('floats favorites to the top, preserving order within each group (stable)', () => {
    const rows = [
      { article_number: 'A', is_favorite: false },
      { article_number: 'B', is_favorite: true },
      { article_number: 'C', is_favorite: false },
      { article_number: 'D', is_favorite: true },
    ];
    expect(sortArticlesFavoritesFirst(rows).map((r) => r.article_number)).toEqual(['B', 'D', 'A', 'C']);
  });

  it('no favorites → order unchanged', () => {
    const rows = [
      { article_number: 'A', is_favorite: false },
      { article_number: 'B', is_favorite: false },
    ];
    expect(sortArticlesFavoritesFirst(rows).map((r) => r.article_number)).toEqual(['A', 'B']);
  });
});

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

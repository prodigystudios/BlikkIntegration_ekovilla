import { describe, it, expect } from 'vitest';
import {
  cachedArticleToInput,
  pickDefaultPriceList,
  planArticleCopy,
  type CachedArticleRow,
} from '@/lib/domains/fortnox/articleCopy';

function row(overrides: Partial<CachedArticleRow>): CachedArticleRow {
  return {
    article_number: '100',
    description: 'Lösull',
    note: null,
    sales_price: '650.00',
    purchase_price: '120.5',
    unit: 'M3',
    article_type: null,
    active: true,
    // Prods verkliga form: listendpointen skickar VAT som STRÄNG.
    raw: { VAT: '25', EAN: '', Housework: false },
    ...overrides,
  };
}

describe('pickDefaultPriceList', () => {
  it('väljer A när den finns, annars den första, annars ingen', () => {
    expect(pickDefaultPriceList([{ code: 'B' }, { code: 'A' }])).toBe('A');
    expect(pickDefaultPriceList([{ code: 'B' }, { code: 'C' }])).toBe('B');
    expect(pickDefaultPriceList([])).toBeNull();
  });
});

describe('cachedArticleToInput', () => {
  it('läser numeric som sträng (PostgREST) och Fortnox fältnamn exakt', () => {
    const { input } = cachedArticleToInput(row({}), 'M3');
    expect(input).toEqual({
      ArticleNumber: '100',
      Description: 'Lösull',
      PurchasePrice: 120.5,
      Unit: 'M3',
      Type: 'STOCK',
      Active: true,
      VAT: 25,
      EAN: null,
      Manufacturer: null,
      ManufacturerArticleNumber: null,
      Note: null,
    });
  });

  it('tolkar momsen som sträng — en 0 %-artikel får inte bli Fortnox standardmoms', () => {
    expect(cachedArticleToInput(row({ raw: { VAT: '0' } }), null).input.VAT).toBe(0);
    expect(cachedArticleToInput(row({ raw: { VAT: '12' } }), null).input.VAT).toBe(12);
    expect(cachedArticleToInput(row({ raw: { VAT: 25 } }), null).input.VAT).toBe(25);
    expect(cachedArticleToInput(row({ raw: {} }), null).input.VAT).toBeNull();
    expect(cachedArticleToInput(row({ raw: { VAT: ' ' } }), null).input.VAT).toBeNull();
  });

  it('läser priser med komma, och tomt blir null — inte 0', () => {
    expect(cachedArticleToInput(row({ purchase_price: '1,5' }), null).input.PurchasePrice).toBe(1.5);
    expect(cachedArticleToInput(row({ purchase_price: ' ' }), null).input.PurchasePrice).toBeNull();
  });

  it('bär med husarbete-flaggan från prod', () => {
    expect(cachedArticleToInput(row({ raw: { VAT: '25', Housework: true } }), null).housework).toBe(true);
    expect(cachedArticleToInput(row({}), null).housework).toBe(false);
  });

  it('behåller känd typ och säger när typen är okänd', () => {
    expect(cachedArticleToInput(row({ article_type: 'SERVICE' }), null)).toMatchObject({
      input: { Type: 'SERVICE' },
      typeKnown: true,
    });
    expect(cachedArticleToInput(row({ article_type: null }), null).typeKnown).toBe(false);
  });

  it('en tom beskrivning blir artikelnumret — Fortnox kräver en beskrivning', () => {
    expect(cachedArticleToInput(row({ description: '  ' }), null).input.Description).toBe('100');
  });

  it('inaktiva artiklar förblir inaktiva', () => {
    expect(cachedArticleToInput(row({ active: false }), null).input.Active).toBe(false);
  });
});

describe('planArticleCopy', () => {
  const rows = [
    row({ article_number: '2', unit: 'RLE', sales_price: '10' }),
    row({ article_number: '10', unit: 'M3' }),
    row({ article_number: '1', unit: 'st' }),
    row({ article_number: '3', unit: null, sales_price: null }),
  ];

  it('tar bara artiklar som saknas i testbolaget och räknar resten', () => {
    const plan = planArticleCopy(rows, new Set(['1']), ['st', 'm3'], 'A');
    expect(plan.items.map((i) => i.articleNumber)).toEqual(['2', '3', '10']);
    expect(plan.alreadyPresent).toBe(1);
  });

  it('skapar saknade enheter men återanvänder en befintlig med annan versal', () => {
    const plan = planArticleCopy(rows, new Set(), ['st', 'm3'], 'A');
    expect(plan.unitsToCreate).toEqual(['RLE']);
    expect(plan.unitAliases).toEqual({ M3: 'm3' });
    expect(plan.items.find((i) => i.articleNumber === '10')?.input.Unit).toBe('m3');
    expect(plan.items.find((i) => i.articleNumber === '3')?.input.Unit).toBeNull();
  });

  it('sätter standardprislistans pris när det finns ett', () => {
    const plan = planArticleCopy(rows, new Set(), ['st'], 'A');
    expect(plan.items.find((i) => i.articleNumber === '2')?.prices).toEqual([{ priceList: 'A', price: 10 }]);
    expect(plan.items.find((i) => i.articleNumber === '3')?.prices).toEqual([]);
    expect(planArticleCopy(rows, new Set(), ['st'], null).items[0].prices).toEqual([]);
  });
});

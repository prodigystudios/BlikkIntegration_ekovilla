import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PRICELIST_PATH,
  basePrices,
  buildPricelistDraft,
  isAllowedValidFrom,
  isIsoDate,
  pricelistContentHash,
  pricelistIdempotencyKey,
  roundToOre,
  type ListPrice,
  type RegisterArticle,
} from '@/lib/domains/portal/pricelist';
import { emptyPortalArticleFields, type PortalArticleFields } from '@/lib/domains/portal/articleFields';
import { isValidIdempotencyKey } from '@/lib/domains/portal/idempotency';
import { CONTRACT_PRICELIST } from './helpers/contractFixtures';

/**
 * Prislistan till portalen (fas 2b). Det som skyddas:
 *   - fältnamnen och formen är kontraktets (portalen läser dem, typsystemet når inte dit);
 *   - bara grundpriset (FromQuantity 0), i hela ören; 0 kr är ett pris;
 *   - enheten med gemener, och en artikel utan enhet, pris, namn eller som är inaktiv skickas inte;
 *   - hashen är stabil för samma innehåll och ändras med varje fält, så att nyckeln skiljer två listor åt;
 *   - giltig från: i dag eller senare, bara riktiga datum.
 */

function field(articleNumber: string, patch: Partial<PortalArticleFields> = {}): PortalArticleFields {
  return {
    ...emptyPortalArticleFields(articleNumber),
    customer_name: `Kund ${articleNumber}`,
    category: 'losull',
    publish: true,
    sort_order: 10,
    ...patch,
  };
}
function reg(articleNumber: string, patch: Partial<RegisterArticle> = {}): RegisterArticle {
  return { article_number: articleNumber, description: `Fortnox ${articleNumber}`, unit: 'st', active: true, ...patch };
}
function price(articleNumber: string, value: number, fromQuantity = 0): ListPrice {
  return { articleNumber, fromQuantity, price: value };
}

describe('kontraktet', () => {
  it('ger exakt kontraktets exempel ur samma indata', () => {
    const expected = CONTRACT_PRICELIST.articles[0];
    const draft = buildPricelistDraft({
      fields: [
        field(expected.articleNumber, {
          customer_name: expected.customerName,
          note: expected.note,
          category: 'losull',
          labor_share: expected.laborShare,
          sort_order: expected.sortOrder,
        }),
      ],
      register: [reg(expected.articleNumber, { description: expected.name, unit: 'M3' })],
      prices: [price(expected.articleNumber, expected.unitCost)],
    });
    expect(draft.articles).toEqual([expected]);
  });

  it('artikeln har exakt kontraktets nycklar, varken fler eller färre', () => {
    const draft = buildPricelistDraft({ fields: [field('1')], register: [reg('1')], prices: [price('1', 10)] });
    expect(Object.keys(draft.articles[0]).sort()).toEqual(Object.keys(CONTRACT_PRICELIST.articles[0]).sort());
  });

  it('skickas till portalens route för prislistor', () => {
    expect(PRICELIST_PATH).toBe('/api/ekovilla/pricelists');
    const contract = readFileSync('RESELLER_PORTAL_INTEGRATION_PLAN.md', 'utf8');
    expect(contract).toContain('POST {RESELLER_PORTAL_URL}/api/ekovilla/pricelists');
  });
});

describe('roundToOre', () => {
  it.each([
    [342, 342],
    [102.5, 102.5],
    [1.005, 1.01], // Math.round(1.005 * 100) / 100 ger 1
    [0.1 + 0.2, 0.3],
    [2764.735, 2764.74],
    [13826.4, 13826.4],
    [1e-7, 0],
    [0, 0],
  ])('%s → %s', (value, expected) => {
    expect(roundToOre(value)).toBe(expected);
  });
});

describe('basePrices', () => {
  it('bara FromQuantity 0; mängdrabatten tas inte med', () => {
    const base = basePrices([price('1', 100, 10), price('1', 120), price('2', 50, 5)]);
    expect([...base]).toEqual([['1', 120]]);
  });

  it('första grundpriset gäller, och ett negativt eller icke-tal räknas inte', () => {
    const base = basePrices([price('1', 120), price('1', 999), price('2', -1), price('3', Number.NaN), price('4', 0)]);
    expect([...base]).toEqual([
      ['1', 120],
      ['4', 0],
    ]);
  });
});

describe('buildPricelistDraft', () => {
  it('enheten med gemener, priset i hela ören, namnet ur Fortnox', () => {
    const draft = buildPricelistDraft({
      fields: [field('1')],
      register: [reg('1', { unit: ' FÖRP ', description: '  STOSAR 5-PACK ' })],
      prices: [price('1', 329.404)],
    });
    expect(draft.articles[0]).toMatchObject({ unit: 'förp', unitCost: 329.4, name: 'STOSAR 5-PACK' });
  });

  it('0 kr är ett pris och skickas', () => {
    const draft = buildPricelistDraft({ fields: [field('1')], register: [reg('1')], prices: [price('1', 0)] });
    expect(draft.articles.map((a) => a.unitCost)).toEqual([0]);
  });

  it.each([
    ['inaktiv', reg('1', { active: false }), [price('1', 10)], ['inactive']],
    ['utan enhet', reg('1', { unit: null }), [price('1', 10)], ['missing_unit']],
    ['med blank enhet', reg('1', { unit: '  ' }), [price('1', 10)], ['missing_unit']],
    ['utan grundpris', reg('1'), [price('1', 10, 5)], ['missing_price']],
    ['utan namn', reg('1', { description: '  ' }), [price('1', 10)], ['missing_name']],
    ['inaktiv utan enhet och pris', reg('1', { active: false, unit: null }), [], ['inactive', 'missing_unit', 'missing_price']],
  ])('en markerad artikel %s skickas inte, med skälen', (_label, article, prices, reasons) => {
    const draft = buildPricelistDraft({ fields: [field('1')], register: [article], prices });
    expect(draft.articles).toEqual([]);
    expect(draft.skipped).toEqual([{ articleNumber: '1', customerName: 'Kund 1', reasons }]);
  });

  it('en markerad artikel som inte finns i registret skickas inte', () => {
    const draft = buildPricelistDraft({ fields: [field('9')], register: [], prices: [price('9', 10)] });
    expect(draft.skipped).toEqual([{ articleNumber: '9', customerName: 'Kund 9', reasons: ['not_in_register'] }]);
  });

  it('en markerad rad utan kundnamn eller kategori skickas inte', () => {
    const draft = buildPricelistDraft({
      fields: [field('1', { category: null }), field('2', { customer_name: '' })],
      register: [reg('1'), reg('2')],
      prices: [price('1', 10), price('2', 10)],
    });
    expect(draft.articles).toEqual([]);
    expect(draft.skipped.map((s) => s.reasons)).toEqual([['incomplete_fields'], ['incomplete_fields']]);
  });

  it('en omarkerad artikel skickas aldrig, också med allt ifyllt', () => {
    const draft = buildPricelistDraft({ fields: [field('1', { publish: false })], register: [reg('1')], prices: [price('1', 10)] });
    expect(draft.articles).toEqual([]);
    expect(draft.skipped).toEqual([]);
  });

  it('ordningen, sedan artikelnumret; de hoppade i samma ordning', () => {
    const draft = buildPricelistDraft({
      fields: [field('b', { sort_order: 20 }), field('a', { sort_order: 20 }), field('c', { sort_order: 5 }), field('x', { sort_order: 1 })],
      register: [reg('a'), reg('b'), reg('c')],
      prices: [price('a', 1), price('b', 1), price('c', 1)],
    });
    expect(draft.articles.map((a) => a.articleNumber)).toEqual(['c', 'a', 'b']);
    expect(draft.skipped.map((s) => s.articleNumber)).toEqual(['x']);
  });

  it('omarkerade med pris: bara aktiva artiklar i registret, sorterade', () => {
    const draft = buildPricelistDraft({
      fields: [field('1'), field('2', { publish: false })],
      register: [reg('1'), reg('2'), reg('3', { active: false }), reg('5')],
      prices: [price('1', 10), price('2', 20), price('3', 30), price('4', 40), price('5', 50.005)],
    });
    expect(draft.unmarked).toEqual([
      { articleNumber: '2', name: 'Fortnox 2', unitCost: 20 },
      { articleNumber: '5', name: 'Fortnox 5', unitCost: 50.01 },
    ]);
  });
});

describe('hashen och nyckeln', () => {
  const input = { fields: [field('1'), field('2', { sort_order: 20 })], register: [reg('1'), reg('2')], prices: [price('1', 10), price('2', 20)] };

  it('samma innehåll ger samma hash, oavsett indatans ordning', () => {
    const a = buildPricelistDraft(input);
    const b = buildPricelistDraft({
      fields: [...input.fields].reverse(),
      register: [...input.register].reverse(),
      prices: [...input.prices].reverse(),
    });
    expect(b.hash).toBe(a.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashen tas över JSON med sorterade nycklar', () => {
    const [article] = buildPricelistDraft(input).articles;
    const reordered = Object.fromEntries(Object.entries(article).reverse()) as typeof article;
    expect(pricelistContentHash([reordered])).toBe(pricelistContentHash([article]));
  });

  it.each([
    ['kundnamnet', { customer_name: 'Annat' }],
    ['kategorin', { category: 'skivor' as const }],
    ['arbetsandelen', { labor_share: 0.001 }],
    ['anteckningen', { note: 'x' }],
    ['ordningen', { sort_order: 11 }],
  ])('ändrar %s → ny hash', (_label, patch) => {
    const before = buildPricelistDraft(input).hash;
    const after = buildPricelistDraft({ ...input, fields: [field('1', patch), input.fields[1]] }).hash;
    expect(after).not.toBe(before);
  });

  it('ändrat pris, enhet eller namn i Fortnox → ny hash', () => {
    const before = buildPricelistDraft(input).hash;
    expect(buildPricelistDraft({ ...input, prices: [price('1', 10.01), input.prices[1]] }).hash).not.toBe(before);
    expect(buildPricelistDraft({ ...input, register: [reg('1', { unit: 'pkt' }), input.register[1]] }).hash).not.toBe(before);
    expect(buildPricelistDraft({ ...input, register: [reg('1', { description: 'Nytt' }), input.register[1]] }).hash).not.toBe(before);
  });

  it('nyckeln: pricelist-<giltig från>-<hash>, godkänd av kön och av databasens check', () => {
    const { hash } = buildPricelistDraft(input);
    const key = pricelistIdempotencyKey('2026-10-01', hash);
    expect(key).toBe(`pricelist-2026-10-01-${hash}`);
    expect(isValidIdempotencyKey(key)).toBe(true);
    // Samma mönster som migreringens check (20260928072725).
    expect(key).toMatch(/^pricelist-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{64}$/);
    expect(key.slice(-64)).toBe(hash);
  });
});

describe('giltig från', () => {
  it('riktiga datum', () => {
    expect(isIsoDate('2026-10-01')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-01', '26-10-01', '2026-10-01T00:00', '']) {
      expect(isIsoDate(bad), bad).toBe(false);
    }
  });

  it('i dag eller senare, mot den svenska dagen', () => {
    expect(isAllowedValidFrom('2026-09-28', '2026-09-28')).toBe(true);
    expect(isAllowedValidFrom('2026-10-01', '2026-09-28')).toBe(true);
    expect(isAllowedValidFrom('2026-09-27', '2026-09-28')).toBe(false);
    expect(isAllowedValidFrom('2026-02-30', '2026-01-01')).toBe(false);
  });
});

describe('webbläsarens del', () => {
  // Sidans klient får bara TYPER ur prislistans moduler: pricelist.ts läser node:crypto, pricelistPublish.ts Fortnox
  // och service-rollen. En vanlig import hade dragit in dem i webbläsarens paket, eller fått bygget att falla.
  it('ResellerPortalClient importerar bara typer ur prislistans och Fortnox moduler', () => {
    const source = readFileSync('app/crm/installningar/aterforsaljarportalen/ResellerPortalClient.tsx', 'utf8');
    const imports = [...source.matchAll(/\bimport\s+(type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]/g)].map((m) => ({
      typeOnly: Boolean(m[1]),
      from: m[3],
    }));
    const serverOnly = imports.filter((i) => /^@\/lib\/domains\/(portal\/pricelist|fortnox)/.test(i.from));
    // Två typimporter finns; hittar mönstret dem inte har det slutat fungera och testet är tomt.
    expect(serverOnly.map((i) => i.from).sort()).toEqual(['@/lib/domains/portal/pricelist', '@/lib/domains/portal/pricelistPublish']);
    expect(serverOnly.filter((i) => !i.typeOnly)).toEqual([]);
    expect(source).not.toMatch(/\bimport\s*\(\s*['"]@\/lib\/domains\/(portal\/pricelist|fortnox)/);
    expect(source).not.toMatch(/\bimport\s+['"]@\/lib\/domains\/(portal\/pricelist|fortnox)/);
  });
});

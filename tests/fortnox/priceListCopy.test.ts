import { describe, it, expect } from 'vitest';
import { parsePortalPricelist, planPriceListCopy, samePrice } from '@/lib/domains/fortnox/priceListCopy';

const present = new Set(['1010', '13003', '2410509', '2410508']);

describe('parsePortalPricelist', () => {
  it('läser portalens form och tar bara artikelnummer och inpris', () => {
    // Som `fortnox(...)` i portalens seed.ts bygger raderna.
    const parsed = parsePortalPricelist({
      id: 'pl-2026-09-25',
      resellerId: null,
      validFrom: '2026-09-25',
      articles: [
        { id: 'art-160-2410509', articleNumber: '2410509', name: 'EKOVILLA cellulosa', customerName: 'Lösull på vinden', note: '', category: 'losull', unit: 'm3', unitCost: 342, laborShare: 0.45 },
        { id: 'art-160-2410508', articleNumber: '2410508', name: 'EKOVILLA CELLULOSAISOLERING 14/54', customerName: 'Säck', note: '', category: 'losull', unit: 'st', unitCost: 102.5, laborShare: 0 },
      ],
    });
    expect(parsed).toEqual({
      validFrom: '2026-09-25',
      prices: [
        { articleNumber: '2410509', price: 342 },
        { articleNumber: '2410508', price: 102.5 },
      ],
    });
  });

  it('kastar med en förklaring när formen har ändrats, i stället för att tyst skicka noll artiklar', () => {
    expect(() => parsePortalPricelist(undefined)).toThrow(/PRICELIST/);
    expect(() => parsePortalPricelist({ validFrom: '2026-09-25', articles: [] })).toThrow(/articles/);
    expect(() =>
      parsePortalPricelist({ validFrom: '2026-09-25', articles: [{ articleNumber: '1010', price: 2900 }] }),
    ).toThrow(/unitCost/);
  });
});

describe('samePrice', () => {
  it('är samma pris inom en halv öre, och annars inte', () => {
    expect(samePrice(0.1 + 0.2, 0.3)).toBe(true);
    expect(samePrice(335.3, 335.31)).toBe(false);
    expect(samePrice(12.345, 12.345)).toBe(true);
  });
});

describe('planPriceListCopy', () => {
  it('skapar det som saknas, ändrar det som skiljer och låter resten vara', () => {
    const plan = planPriceListCopy(
      [
        { articleNumber: '2410509', price: 342 },
        { articleNumber: '13003', price: 335.3 },
        { articleNumber: '1010', price: 2900 },
      ],
      present,
      [
        { articleNumber: '13003', fromQuantity: 0, price: 300 },
        { articleNumber: '1010', fromQuantity: 0, price: 2900 },
      ],
    );
    expect(plan.toCreate).toEqual([{ articleNumber: '2410509', price: 342 }]);
    expect(plan.toUpdate).toEqual([{ articleNumber: '13003', price: 335.3, current: 300 }]);
    expect(plan.unchanged).toBe(1);
    expect(plan.missingArticles).toEqual([]);
    expect(plan.rejected).toEqual([]);
    expect(plan.notInSource).toEqual([]);
  });

  it('skickar priset som det står i källan, utan att avrunda det', () => {
    const plan = planPriceListCopy([{ articleNumber: '13003', price: 12.345 }], present, []);
    expect(plan.toCreate).toEqual([{ articleNumber: '13003', price: 12.345 }]);
  });

  it('jämför på ören: flyttalsbrus är ingen ändring', () => {
    // 1.1 + 2.2 === 3.3000000000000003, alltså INTE === 3.3. (Ett literalt 335.30000000000001 är
    // samma tal som 335.3 och hade inte prövat något — mutationstestet avslöjade det.)
    const noisy = 1.1 + 2.2;
    expect(noisy).not.toBe(3.3);
    const plan = planPriceListCopy(
      [{ articleNumber: '13003', price: 3.3 }],
      present,
      [{ articleNumber: '13003', fromQuantity: 0, price: noisy }],
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.toUpdate).toEqual([]);
  });

  it('jämför bara mot grundpriset — en mängdrabatt är inget befintligt grundpris', () => {
    const plan = planPriceListCopy(
      [{ articleNumber: '13003', price: 335.3 }],
      present,
      [{ articleNumber: '13003', fromQuantity: 10, price: 300 }],
    );
    expect(plan.toCreate).toEqual([{ articleNumber: '13003', price: 335.3 }]);
  });

  it('listar artiklar som saknas i testbolaget i stället för att försöka sätta ett pris', () => {
    const plan = planPriceListCopy([{ articleNumber: '4WCBTD60', price: 10849.8 }], present, []);
    expect(plan.missingArticles).toEqual(['4WCBTD60']);
    expect(plan.toCreate).toEqual([]);
  });

  it('en artikel som står flera gånger får inget pris alls — vilket som gäller går inte att veta', () => {
    const plan = planPriceListCopy(
      [
        { articleNumber: '1010', price: 2900 },
        { articleNumber: '1010', price: 2500 },
        { articleNumber: '13003', price: 335.3 },
      ],
      present,
      [],
    );
    expect(plan.toCreate).toEqual([{ articleNumber: '13003', price: 335.3 }]);
    expect(plan.rejected).toEqual([{ articleNumber: '1010', reason: 'står 2 gånger i källan, inget pris sätts' }]);
  });

  it('avvisar 0 kr, negativa och ogiltiga priser och säger varför', () => {
    const plan = planPriceListCopy(
      [
        { articleNumber: '1010', price: 0 },
        { articleNumber: '2410508', price: -1 },
        { articleNumber: '13003', price: Number.NaN },
      ],
      present,
      [],
    );
    expect(plan.toCreate).toEqual([]);
    expect(plan.rejected.map((r) => r.articleNumber)).toEqual(['1010', '13003', '2410508']);
  });

  it('rapporterar grundpriser på listan som inte står i källan, utan att röra dem', () => {
    const plan = planPriceListCopy(
      [{ articleNumber: '1010', price: 2900 }],
      present,
      [
        { articleNumber: '1010', fromQuantity: 0, price: 2900 },
        { articleNumber: '99', fromQuantity: 0, price: 10 },
        { articleNumber: '98', fromQuantity: 5, price: 10 },
      ],
    );
    expect(plan.notInSource).toEqual(['99']);
    expect(plan.unchanged).toBe(1);
  });

  it('sorterar artikelnumren som tal, som artikelkopieringen', () => {
    const plan = planPriceListCopy(
      [
        { articleNumber: '2410509', price: 1 },
        { articleNumber: '13003', price: 1 },
        { articleNumber: '1010', price: 1 },
      ],
      present,
      [],
    );
    expect(plan.toCreate.map((p) => p.articleNumber)).toEqual(['1010', '13003', '2410509']);
  });
});

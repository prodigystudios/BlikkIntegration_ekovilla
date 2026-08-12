import { describe, it, expect } from 'vitest';
import {
  computeInvoiceState,
  activeLineItems,
  validatePartialRequest,
  buildInvoiceRows,
  roundSubtotal,
  hasCarvedRotLabor,
  PartialInvoiceError,
  type PartialInvoiceLineItem,
} from '@/lib/domains/fortnox/partialInvoices';

const itemLine = (overrides: Partial<PartialInvoiceLineItem> = {}): PartialInvoiceLineItem => ({
  pricing_mode: 'item',
  unit_price: '100',
  quantity: '50',
  ...overrides,
});

describe('computeInvoiceState', () => {
  it('reports the full quantity as remaining when there are no prior rounds', () => {
    const [state] = computeInvoiceState([itemLine()], []);
    expect(state).toEqual({ index: 0, total: 50, invoiced: 0, remaining: 50 });
  });

  it('subtracts a single prior round from the remaining', () => {
    const [state] = computeInvoiceState([itemLine()], [{ line_quantities: [{ index: 0, quantity: 30 }] }]);
    expect(state).toMatchObject({ invoiced: 30, remaining: 20 });
  });

  it('sums multiple prior rounds per line', () => {
    const [state] = computeInvoiceState([itemLine()], [
      { line_quantities: [{ index: 0, quantity: 30 }] },
      { line_quantities: [{ index: 0, quantity: 10 }] },
    ]);
    expect(state).toMatchObject({ invoiced: 40, remaining: 10 });
  });

  it('uses the computed m³ volume (m² × thickness / 1000) as the line total', () => {
    const [state] = computeInvoiceState([{ pricing_mode: 'm3', m2: '100', thickness_mm: '200', unit_price: '700' }], []);
    expect(state.total).toBe(20);
    expect(state.remaining).toBe(20);
  });

  it('never returns a negative remaining', () => {
    const [state] = computeInvoiceState([itemLine({ quantity: '10' })], [{ line_quantities: [{ index: 0, quantity: 15 }] }]);
    expect(state.remaining).toBe(0);
  });
});

describe('validatePartialRequest', () => {
  const state = () => computeInvoiceState([itemLine(), itemLine({ quantity: '10' })], []);

  it('accepts a request within remaining and dedupes quantities by index', () => {
    const { requestByIndex, isFinalRound } = validatePartialRequest(state(), [
      { index: 0, quantity: 20 },
      { index: 0, quantity: 5 },
    ]);
    expect(requestByIndex.get(0)).toBe(25);
    expect(isFinalRound).toBe(false);
  });

  it('rejects invoicing more than a line has remaining', () => {
    expect(() => validatePartialRequest(state(), [{ index: 0, quantity: 60 }])).toThrow(PartialInvoiceError);
  });

  it('rejects an all-zero request', () => {
    expect(() => validatePartialRequest(state(), [{ index: 0, quantity: 0 }])).toThrow(PartialInvoiceError);
  });

  it('rejects an unknown line index', () => {
    expect(() => validatePartialRequest(state(), [{ index: 9, quantity: 1 }])).toThrow(PartialInvoiceError);
  });

  it('flags the final round only when every line reaches zero remaining', () => {
    const partial = validatePartialRequest(state(), [{ index: 0, quantity: 50 }]);
    expect(partial.isFinalRound).toBe(false); // line 1 still has 10 left

    const final = validatePartialRequest(state(), [{ index: 0, quantity: 50 }, { index: 1, quantity: 10 }]);
    expect(final.isFinalRound).toBe(true);
  });

  it('flags the final round across rounds (remaining measured from prior rounds)', () => {
    const afterFirst = computeInvoiceState([itemLine()], [{ line_quantities: [{ index: 0, quantity: 30 }] }]);
    const { isFinalRound } = validatePartialRequest(afterFirst, [{ index: 0, quantity: 20 }]);
    expect(isFinalRound).toBe(true);
  });
});

describe('buildInvoiceRows', () => {
  it('emits a row only for lines with a positive quantity, using DeliveredQuantity', () => {
    const rows = buildInvoiceRows([itemLine(), itemLine()], new Map([[1, 5]]), 25, false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ DeliveredQuantity: 5, Price: 100, VAT: 25 });
    // Invoice rows use DeliveredQuantity, not OrderedQuantity/Quantity.
    expect((rows[0] as any).OrderedQuantity).toBeUndefined();
    expect((rows[0] as any).Quantity).toBeUndefined();
  });

  it('sends a percentage discount with DiscountType PERCENT', () => {
    const [row] = buildInvoiceRows([itemLine({ discount_percent: '25' })], new Map([[0, 10]]), 25, false);
    expect(row).toMatchObject({ Discount: 25, DiscountType: 'PERCENT' });
  });

  it('marks HouseWork only when ROT is enabled and the row is rot work', () => {
    const on = buildInvoiceRows([itemLine({ is_rot_work: true })], new Map([[0, 1]]), 25, true);
    expect(on[0]).toMatchObject({ HouseWork: true, HouseWorkType: 'CONSTRUCTION' });
    // Non-ROT → HouseWork omitted (never false — that stamps EMPTYHOUSEWORK and 2004021).
    const off = buildInvoiceRows([itemLine({ is_rot_work: true })], new Map([[0, 1]]), 25, false);
    expect((off[0] as any).HouseWork).toBeUndefined();
  });

  it('forces 0 % VAT on rows for reverse charge (byggmoms), else the passed vatPercent', () => {
    const [reverse] = buildInvoiceRows([itemLine()], new Map([[0, 10]]), 25, false, true);
    expect((reverse as any).VAT).toBe(0);
    const [normal] = buildInvoiceRows([itemLine()], new Map([[0, 10]]), 25, false, false);
    expect((normal as any).VAT).toBe(25);
  });

  it('appends the ROT property note as a trailing text row on the partial invoice', () => {
    const rows = buildInvoiceRows([itemLine()], new Map([[0, 10]]), 25, true, false, 'Fastighetsbeteckning: Haggården 6:3');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ Description: 'Fastighetsbeteckning: Haggården 6:3' });
    expect((rows[1] as any).DeliveredQuantity).toBeUndefined();
  });
});

describe('roundSubtotal', () => {
  it('sums quantity × unit price for the billed lines', () => {
    expect(roundSubtotal([itemLine({ unit_price: '100' })], new Map([[0, 30]]))).toBe(3000);
  });

  it('applies the line discount', () => {
    expect(roundSubtotal([itemLine({ unit_price: '100', discount_percent: '25' })], new Map([[0, 10]]))).toBe(750);
  });
});

describe('hasCarvedRotLabor (partial-invoice Phase-2 guard)', () => {
  it('detects a material row with carved-out labour', () => {
    expect(hasCarvedRotLabor([itemLine({ labor_cost: '500' })])).toBe(true);
  });

  it('ignores labour on a row flagged fully as ROT work (whole row is the labour, invoiced per row)', () => {
    expect(hasCarvedRotLabor([itemLine({ is_rot_work: true, labor_cost: '500' })])).toBe(false);
  });

  it('returns false when nothing is carved (empty / zero / missing / null)', () => {
    expect(hasCarvedRotLabor([itemLine({ labor_cost: '' }), itemLine({ labor_cost: '0' }), itemLine()])).toBe(false);
    expect(hasCarvedRotLabor(null)).toBe(false);
  });
});

// En artikel som såldes men aldrig utfördes skrivs AV, den raderas inte. Radering hade förskjutit
// arrayindexen som varje fakturarunda lagrar sina antal mot — en redan utställd fakturas antal
// hade tyst pekat om till fel artikel. Flaggan gör återstående 0 så ordern kan stängas.
describe('computeInvoiceState — avskriven rad', () => {
  const three = [
    { pricing_mode: 'item', unit_price: '100', quantity: '10' },
    { pricing_mode: 'item', unit_price: '200', quantity: '5' },
    { pricing_mode: 'item', unit_price: '300', quantity: '2' },
  ];

  it('nollar återstående på en avskriven rad utan att röra dess antal', () => {
    const items = three.map((it, i) => (i === 2 ? { ...it, written_off: true } : it));
    const state = computeInvoiceState(items, []);
    expect(state[2].total).toBe(2);      // antalet står kvar — raden fanns
    expect(state[2].remaining).toBe(0);  // …men det finns inget kvar att fakturera
    expect(state[0].remaining).toBe(10); // övriga rader orörda
  });

  // Kärnan i buggen: utan avskrivning når isFinalRound aldrig sant, så ordern fastnar som
  // delfakturerad i evighet med en summa som räknar arbete som aldrig utfördes.
  it('låter sista rundan bli slutrunda när resten är avskriven', () => {
    const items = three.map((it, i) => (i === 2 ? { ...it, written_off: true } : it));
    const rounds = [{ line_quantities: [{ index: 0, quantity: 10 }] }];
    const state = computeInvoiceState(items, rounds);
    const { isFinalRound } = validatePartialRequest(state, [{ index: 1, quantity: 5 }]);
    expect(isFinalRound).toBe(true);
  });

  it('utan avskrivning är samma runda INTE slutrunda', () => {
    const state = computeInvoiceState(three, [{ line_quantities: [{ index: 0, quantity: 10 }] }]);
    const { isFinalRound } = validatePartialRequest(state, [{ index: 1, quantity: 5 }]);
    expect(isFinalRound).toBe(false);
  });

  it('vägrar fakturera en avskriven rad', () => {
    const items = three.map((it, i) => (i === 2 ? { ...it, written_off: true } : it));
    const state = computeInvoiceState(items, []);
    expect(() => validatePartialRequest(state, [{ index: 2, quantity: 1 }])).toThrow(/överstiger återstående/);
  });

  // Indexen får ALDRIG förskjutas — det är hela skälet till att raden flaggas i stället för raderas.
  it('behåller radernas index när en rad skrivs av', () => {
    const items = three.map((it, i) => (i === 0 ? { ...it, written_off: true } : it));
    const state = computeInvoiceState(items, []);
    expect(state.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(state[1].total).toBe(5);
    expect(state[2].total).toBe(2);
  });
});

describe('activeLineItems', () => {
  it('filtrerar bort avskrivna rader men behåller ordningen på resten', () => {
    const items = [{ id: 'a' }, { id: 'b', written_off: true }, { id: 'c' }];
    expect(activeLineItems(items).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('tål null och tom lista', () => {
    expect(activeLineItems(null)).toEqual([]);
    expect(activeLineItems([])).toEqual([]);
  });
});

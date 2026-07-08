import { describe, it, expect } from 'vitest';
import { buildOrderRows } from '@/lib/domains/fortnox/orders';
import { ROT_LABOR_ARTICLE_NUMBER } from '@/lib/domains/fortnox/helpers';

describe('buildOrderRows', () => {
  it('returns an empty array for no line items', () => {
    expect(buildOrderRows([], 25, false)).toEqual([]);
  });

  // Regression: Fortnox order rows require `OrderedQuantity`, not `Quantity` (offer rows
  // use Quantity). Sending Quantity to /orders returns 400 "Felaktigt fältnamn (Quantity)".
  it('uses OrderedQuantity (not Quantity) for order rows', () => {
    const [row] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '3' }], 25, false);
    expect((row as any).OrderedQuantity).toBe(3);
    expect((row as any).Quantity).toBeUndefined();
    expect(row.Price).toBe(100);
  });

  // Fortnox invoices the delivered quantity, so delivered must equal ordered or the row
  // sum stays 0 (new rows) / stale (edited rows).
  it('sets DeliveredQuantity equal to OrderedQuantity', () => {
    const [row] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '3' }], 25, false);
    expect((row as any).DeliveredQuantity).toBe(3);
    expect((row as any).DeliveredQuantity).toBe((row as any).OrderedQuantity);
  });

  it('sends the computed m³ volume as both ordered and delivered quantity', () => {
    const [row] = buildOrderRows([{ pricing_mode: 'm3', m2: '100', thickness_mm: '200', unit_price: '700' }], 25, false);
    expect((row as any).OrderedQuantity).toBe(20);
    expect((row as any).DeliveredQuantity).toBe(20);
  });

  it('clamps discount to [0,100] so the Fortnox row matches the CRM pricing', () => {
    const [over] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1', discount_percent: '150' }], 25, false);
    expect((over as any).Discount).toBe(100);
    const [normal] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1', discount_percent: '25' }], 25, false);
    expect((normal as any).Discount).toBe(25);
  });

  // Regression: a CRM percentage discount must be sent with DiscountType:'PERCENT', else
  // Fortnox treats Discount as kronor (its AMOUNT default) and the order/invoice total drifts.
  it('sends DiscountType PERCENT with a discount, and omits it when there is no discount', () => {
    const [withDiscount] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1', discount_percent: '25' }], 25, false);
    expect((withDiscount as any).Discount).toBe(25);
    expect((withDiscount as any).DiscountType).toBe('PERCENT');
    const [noDiscount] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1' }], 25, false);
    expect((noDiscount as any).DiscountType).toBeUndefined();
  });

  it('marks HouseWork only when ROT is enabled and the row is rot work', () => {
    const [withRot] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1', is_rot_work: true }], 25, true);
    expect((withRot as any).HouseWork).toBe(true);
    // Non-ROT → HouseWork omitted (never false — that stamps EMPTYHOUSEWORK and 2004021).
    const [withoutRot] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1', is_rot_work: true }], 25, false);
    expect((withoutRot as any).HouseWork).toBeUndefined();
  });

  // The per-row free text (Radtext) reaches Fortnox as its own text row (no amounts) after
  // the article row — otherwise it is dropped whenever an article is chosen.
  it('adds a text-only row for the Radtext when an article name is present', () => {
    const rows = buildOrderRows([{ article_name: 'Lösull', unit_price: '100', quantity: '1', line_note: 'Extra tätning' }], 25, false);
    expect(rows).toHaveLength(2);
    expect(rows[0].Description).toBe('Lösull');
    expect(rows[1].Description).toBe('Extra tätning');
    expect((rows[1] as any).OrderedQuantity).toBeUndefined();
    expect((rows[1] as any).Price).toBeUndefined();
  });

  it('does not duplicate the Radtext when it is already the row Description (no article name)', () => {
    const rows = buildOrderRows([{ unit_price: '100', quantity: '1', line_note: 'Bara fritext' }], 25, false);
    expect(rows).toHaveLength(1);
    expect(rows[0].Description).toBe('Bara fritext');
  });

  it('forces 0 % VAT on rows for reverse charge (byggmoms), else the passed vatPercent', () => {
    const [reverse] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1' }], 25, false, true);
    expect((reverse as any).VAT).toBe(0);
    const [normal] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1' }], 25, false, false);
    expect((normal as any).VAT).toBe(25);
  });

  it('appends the ROT property note as a trailing text row (standalone-order path)', () => {
    const rows = buildOrderRows(
      [{ article_name: 'Lösull', unit_price: '100', quantity: '1' }],
      25, true, false, 'Fastighetsbeteckning: Haggården 6:3  BRF org.nr: 769600-1234',
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].Description).toBe('Fastighetsbeteckning: Haggården 6:3  BRF org.nr: 769600-1234');
    expect((rows[1] as any).OrderedQuantity).toBeUndefined();
  });
});

describe('buildOrderRows – ROT labour carve-out', () => {
  it('carves labor_cost out of a material row into one aggregated Arbetskostnad ROT row', () => {
    const rows = buildOrderRows(
      [{ pricing_mode: 'item', article_name: 'Lösull', unit_price: '200', quantity: '100', labor_cost: '8000' }],
      25, true,
    );
    expect(rows).toHaveLength(2);
    const [material, labor] = rows as any[];
    expect(material.Price).toBeCloseTo(120, 6); // 12000 material over 100 units
    expect(material.OrderedQuantity).toBe(100);
    expect(material.DeliveredQuantity).toBe(100);
    expect(material.HouseWork).toBeUndefined();
    expect(labor.ArticleNumber).toBe(ROT_LABOR_ARTICLE_NUMBER);
    expect(labor.Price).toBe(8000);
    expect(labor.OrderedQuantity).toBe(1);
    expect(labor.DeliveredQuantity).toBe(1);
    expect(labor.HouseWork).toBe(true);
    expect(labor.HouseWorkType).toBe('CONSTRUCTION');
  });

  it('leaves fully-flagged ROT rows untouched and emits no aggregated row', () => {
    const rows = buildOrderRows(
      [{ pricing_mode: 'item', unit_price: '100', quantity: '10', is_rot_work: true, labor_cost: '500' }],
      25, true,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).Price).toBe(100);
    expect((rows[0] as any).HouseWork).toBe(true);
  });
});

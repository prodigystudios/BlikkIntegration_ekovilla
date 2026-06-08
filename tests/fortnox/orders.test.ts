import { describe, it, expect } from 'vitest';
import { buildOrderRows } from '@/lib/domains/fortnox/orders';

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
    const [withoutRot] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1', is_rot_work: true }], 25, false);
    expect((withoutRot as any).HouseWork).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { updateWorkOrderLineItemsSchema } from '@/app/api/crm/work-orders/_lib';
import { lineItemQuantity } from '@/lib/domains/crm/lineItems';

// 🧨 En rad UTAN prisläge räknas som m³ överallt där den läses. Schemats default var 'item', så en
// gammal m³-rad som sparades om via arbetsordern fick läget omskrivet — antalet lästes då ur det
// tomma quantity-fältet, och radens värde föll till 0 kr utan att någon märkte det.
describe('radschemat — prisläget när det saknas', () => {
  it('behåller en lägeslös rad som m³, så volymen står kvar', () => {
    const parsed = updateWorkOrderLineItemsSchema.parse({
      line_items: [{ id: 'a', article_name: 'Lösull', m2: '40', thickness_mm: '200', unit_price: '700' }],
    });
    const row = parsed.line_items[0];
    expect(row.pricing_mode).toBe('m3');
    expect(lineItemQuantity(row)).toBe(8);
  });

  it('rör inte ett uttryckligt styckläge', () => {
    const parsed = updateWorkOrderLineItemsSchema.parse({
      line_items: [{ id: 'a', pricing_mode: 'item', quantity: '3' }],
    });
    expect(parsed.line_items[0].pricing_mode).toBe('item');
  });
});

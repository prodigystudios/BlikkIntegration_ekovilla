import { describe, it, expect } from 'vitest';
import { lineItemQuantity, isBlankLineItem } from '@/lib/domains/crm/lineItems';

describe('lineItemQuantity', () => {
  it('computes m³ volume from m² × thickness/1000', () => {
    expect(lineItemQuantity({ pricing_mode: 'm3', m2: '100', thickness_mm: '200' })).toBe(20);
    // 24,4 m² × 200 mm → 4.88 m³ (Swedish comma handled)
    expect(lineItemQuantity({ pricing_mode: 'm3', m2: '24,4', thickness_mm: '200' })).toBeCloseTo(4.88, 5);
  });

  it('treats a missing pricing_mode as m³ (matches the form default)', () => {
    expect(lineItemQuantity({ m2: '50', thickness_mm: '100' })).toBe(5);
  });

  it('uses the entered quantity for item pricing', () => {
    expect(lineItemQuantity({ pricing_mode: 'item', quantity: '12' })).toBe(12);
    expect(lineItemQuantity({ pricing_mode: 'item', quantity: '1,5' })).toBe(1.5);
  });

  it('returns 0 for empty m³ or item inputs', () => {
    expect(lineItemQuantity({ pricing_mode: 'm3', m2: '', thickness_mm: '' })).toBe(0);
    expect(lineItemQuantity({ pricing_mode: 'item', quantity: '' })).toBe(0);
  });
});

describe('isBlankLineItem', () => {
  // Formulärets startrad: allt tomt, med de defaultvärden createEmptyLineItem sätter.
  const emptyRow = {
    construction: '',
    m2: '',
    thickness_mm: '',
    unit_price: '',
    quantity: '',
    article_id: null,
    article_name: null,
    article_number: null,
    article_note: null,
    article_price: null,
    article_unit_name: null,
    discount_percent: '',
    line_note: '',
    is_rot_work: false,
    labor_cost: '',
    density: '',
  };

  it('räknar en orörd startrad som tom', () => {
    // Att den här är true är hela poängen: auto_price, pricing_mode och house_work_type sätts av
    // createEmptyLineItem utan att någon valt dem, och lästes de som innehåll hade varje ny rad
    // krävt en bekräftelse för att tas bort. Därför står de inte i LineItemContentSource.
    expect(isBlankLineItem(emptyRow)).toBe(true);
  });

  it('ser en vald artikel som innehåll', () => {
    expect(isBlankLineItem({ ...emptyRow, article_name: 'Ekovilla lösull' })).toBe(false);
    expect(isBlankLineItem({ ...emptyRow, article_number: '10058' })).toBe(false);
  });

  it('ser varje ifyllt fält säljaren skriver i som innehåll', () => {
    const filled: Array<[string, Record<string, string | boolean>]> = [
      ['construction', { construction: 'vagg' }],
      ['m2', { m2: '120' }],
      ['thickness_mm', { thickness_mm: '200' }],
      ['quantity', { quantity: '3' }],
      ['unit_price', { unit_price: '1250' }],
      ['discount_percent', { discount_percent: '10' }],
      ['line_note', { line_note: 'Endast vindsbjälklag' }],
      ['labor_cost', { labor_cost: '4000' }],
      ['density', { density: '38' }],
      ['is_rot_work', { is_rot_work: true }],
    ];
    for (const [label, patch] of filled) {
      expect(isBlankLineItem({ ...emptyRow, ...patch }), label).toBe(false);
    }
  });

  it('räknar blanksteg som tomt', () => {
    expect(isBlankLineItem({ ...emptyRow, m2: '   ', line_note: '  ' })).toBe(true);
  });
});

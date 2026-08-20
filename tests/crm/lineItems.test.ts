import { describe, it, expect } from 'vitest';
import { lineItemQuantity, isBlankLineItem, isUnpricedLineItem, isConfiguredLineItem } from '@/lib/domains/crm/lineItems';

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

describe('isUnpricedLineItem', () => {
  // Spärren som stängde 900-stubben: en rad utan prisförankring blir 0 kr i varje Fortnox-dokument,
  // och på en ROT-offert dessutom carve 0 → ingen "Arbetskostnad ROT"-rad alls. Förut dolde
  // formulärets egen 900-stub det genom att visa ett pris som ingen annan yta kände till.

  it('saknar prisförankring när varken A-pris eller artikel finns', () => {
    expect(isUnpricedLineItem({ unit_price: '', article_price: null })).toBe(true);
    expect(isUnpricedLineItem({})).toBe(true);
    expect(isUnpricedLineItem({ unit_price: null, article_price: undefined })).toBe(true);
  });

  it('räknar blanksteg som avsaknad av pris', () => {
    expect(isUnpricedLineItem({ unit_price: '   ', article_price: null })).toBe(true);
  });

  it('är prissatt så fort någon av källorna finns', () => {
    expect(isUnpricedLineItem({ unit_price: '750', article_price: null })).toBe(false);
    expect(isUnpricedLineItem({ unit_price: '', article_price: 900 })).toBe(false);
    expect(isUnpricedLineItem({ unit_price: '750', article_price: 900 })).toBe(false);
  });

  it('⚠️ ett skrivet 0 ÄR ett pris', () => {
    // Skillnaden hela predikatet finns för. `lineItemUnitPrice` svarar 0 i båda fallen, så summan
    // kan inte skilja dem åt — men "raden ingår i priset" är ett medvetet val säljaren gjort,
    // medan en rad utan källa är ett fel som ska synas. Spärra aldrig på priset === 0.
    expect(isUnpricedLineItem({ unit_price: '0', article_price: null })).toBe(false);
    expect(isUnpricedLineItem({ unit_price: '', article_price: 0 })).toBe(false);
  });
});

describe('isConfiguredLineItem', () => {
  // Avgör vilka rader som MÅSTE ha ett pris. Måste vara smalare än "inte tom": en rad kan bära
  // innehåll utan att vara debiterbar, och de raderna ska gå igenom både sparning och push.

  it('ser artikel, mängd och pris som debiterbart innehåll', () => {
    expect(isConfiguredLineItem({ article_name: 'Ekovilla lösull' })).toBe(true);
    expect(isConfiguredLineItem({ m2: '120' })).toBe(true);
    expect(isConfiguredLineItem({ quantity: '3' })).toBe(true);
    expect(isConfiguredLineItem({ unit_price: '750' })).toBe(true);
  });

  it('⚠️ en ren textrad är INTE debiterbar', () => {
    // buildOfferRows/buildOrderRows bygger `Description: article_name || line_note || 'Artikel'`,
    // så en rad med bara radtext är en tillåten form. Räknade spärren den som debiterbar skulle
    // befintliga offerter bli permanent opushbara — 409 utan att peka ut vilken rad.
    expect(isConfiguredLineItem({ article_name: null, m2: '', quantity: '', unit_price: '' })).toBe(false);
  });

  it('räknar blanksteg som tomt', () => {
    expect(isConfiguredLineItem({ m2: '   ', quantity: '  ', unit_price: ' ' })).toBe(false);
  });

  it('håller med formulärets spärr om vad som kräver pris', () => {
    // Raden 900-stubben dolde: mått ifyllda, ingen artikel, inget pris.
    const stubRow = { article_name: null, m2: '100', quantity: '', unit_price: '', article_price: null };
    expect(isConfiguredLineItem(stubRow)).toBe(true);
    expect(isUnpricedLineItem(stubRow)).toBe(true);
  });
});

describe('isConfiguredLineItem – råa databasvärden', () => {
  // Predikatet körs på RÅ JSONB i Fortnox-pushens spärr, inte bara på formulärets strängar.
  it('klarar tal i stället för strängar utan att kasta', () => {
    expect(() => isConfiguredLineItem({ m2: 120 as unknown as string })).not.toThrow();
    expect(isConfiguredLineItem({ m2: 120 as unknown as string })).toBe(true);
    expect(isConfiguredLineItem({ quantity: 0 as unknown as string })).toBe(true);
  });
});

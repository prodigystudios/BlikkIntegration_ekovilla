import { describe, it, expect } from 'vitest';
import { lineItemUnitLabel, lineItemSubline, formatUnitPrice, formatDiscount, displayUnit } from '@/app/crm/components/lineItemTable';

// Intl skriver ett hårt mellanslag (U+00A0) mellan tal och "kr" — jämför utan det.
const plain = (s: string) => s.replace(/ /g, ' ');

describe('lineItemUnitLabel', () => {
  it('kubikrad = m³, styckrad = artikelns enhet, annars st', () => {
    expect(lineItemUnitLabel({ pricing_mode: 'm3' })).toBe('m³');
    expect(lineItemUnitLabel({})).toBe('m³');
    expect(lineItemUnitLabel({ pricing_mode: 'item', article_unit_name: 'm' })).toBe('m');
    expect(lineItemUnitLabel({ pricing_mode: 'item', article_unit_name: '  ' })).toBe('st');
  });
});

describe('displayUnit', () => {
  it('Fortnox m3/m2 läses som m³/m², allt annat som det står', () => {
    expect(displayUnit('m3')).toBe('m³');
    expect(displayUnit('M2')).toBe('m²');
    expect(displayUnit(' st ')).toBe('st');
    expect(displayUnit('h')).toBe('h');
  });

  it('en styckrad i m2 visar m² i mängdkolumnen', () => {
    expect(lineItemUnitLabel({ pricing_mode: 'item', article_unit_name: 'm2' })).toBe('m²');
  });

  it('en kubikartikel som prissätts per styck räknas i st, inte i m³', () => {
    expect(lineItemUnitLabel({ pricing_mode: 'item', article_unit_name: 'm3' })).toBe('st');
  });
});

describe('lineItemSubline', () => {
  it('kubikrad: artikelnumret och måtten volymen räknas ur, med decimalkomma', () => {
    expect(lineItemSubline({ article_number: '1001', pricing_mode: 'm3', m2: '19,5', thickness_mm: '300', density: '30' }))
      .toBe('Art.nr 1001, 19,5 m², 300 mm, 30 kg/m³');
  });

  it('hoppar över mått som saknas eller är noll — en halvifylld rad ska inte visa "0 mm"', () => {
    expect(lineItemSubline({ article_number: '1001', pricing_mode: 'm3', m2: '120', thickness_mm: '', density: '0' }))
      .toBe('Art.nr 1001, 120 m²');
  });

  it('styckrad: bara artikelnumret, och ingenting när även det saknas', () => {
    expect(lineItemSubline({ article_number: '2140', pricing_mode: 'item', m2: '5' })).toBe('Art.nr 2140');
    expect(lineItemSubline({ pricing_mode: 'item' })).toBe('');
  });
});

describe('formatUnitPrice', () => {
  it('hela kronor utan decimaler, ören med två — à-priset avrundas inte bort', () => {
    expect(plain(formatUnitPrice(690))).toBe('690 kr');
    expect(plain(formatUnitPrice(85.5))).toBe('85,50 kr');
    expect(plain(formatUnitPrice(2500))).toBe('2 500 kr');
  });

  it('avrundar till ören innan formatet väljs — 85,995 och 85,996 skrivs båda "86 kr"', () => {
    expect(plain(formatUnitPrice(85.995))).toBe('86 kr');
    expect(plain(formatUnitPrice(85.996))).toBe('86 kr');
    expect(plain(formatUnitPrice(85.994))).toBe('85,99 kr');
  });
});

describe('formatDiscount', () => {
  it('rabatt i procent, streck utan rabatt', () => {
    expect(formatDiscount('10')).toBe('10 %');
    expect(formatDiscount('12,5')).toBe('12,5 %');
    expect(formatDiscount('')).toBe('–');
    expect(formatDiscount('0')).toBe('–');
  });
});

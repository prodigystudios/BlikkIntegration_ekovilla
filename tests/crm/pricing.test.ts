import { describe, it, expect } from 'vitest';
import { lineItemRowTotal, computePricing, resolveQuoteVatBreakdown, quoteAmountDisplay } from '@/lib/domains/crm/pricing';

describe('lineItemRowTotal', () => {
  it('item mode: quantity × unit_price', () => {
    expect(lineItemRowTotal({ pricing_mode: 'item', quantity: '3', unit_price: '100' })).toBe(300);
  });

  it('m3 mode: (m² × tjocklek/1000) × unit_price', () => {
    // 10 m² × 300 mm = 3 m³ × 900 = 2700
    expect(lineItemRowTotal({ pricing_mode: 'm3', m2: '10', thickness_mm: '300', unit_price: '900' })).toBe(2700);
  });

  it('falls back to article_price when unit_price is empty', () => {
    expect(lineItemRowTotal({ pricing_mode: 'item', quantity: '2', unit_price: '', article_price: 150 })).toBe(300);
  });

  it('applies discount', () => {
    expect(lineItemRowTotal({ pricing_mode: 'item', quantity: '1', unit_price: '1000', discount_percent: '25' })).toBe(750);
  });

  it('handles Swedish comma decimals', () => {
    // 1,5 m² × 100 mm = 0,15 m³ × 1000 = 150
    expect(lineItemRowTotal({ pricing_mode: 'm3', m2: '1,5', thickness_mm: '100', unit_price: '1000' })).toBeCloseTo(150, 6);
  });
});

describe('computePricing', () => {
  const rows = [
    { pricing_mode: 'item' as const, quantity: '2', unit_price: '1000' }, // 2000
    { pricing_mode: 'item' as const, quantity: '1', unit_price: '500' },  // 500
  ];

  it('sums subtotal, vat and total', () => {
    const p = computePricing(rows, 25);
    expect(p.subtotal).toBe(2500);
    expect(p.vat).toBe(625);
    expect(p.total).toBe(3125);
  });

  it('no ROT for business customers', () => {
    const p = computePricing(rows, 25, { isPrivate: false, rot: { enabled: true } });
    expect(p.rotDeduction).toBe(0);
    expect(p.toPay).toBe(p.total);
  });

  it('ROT (private): floored % of husarbete rows incl VAT, capped at max', () => {
    // husarbete row: 1000 incl 25% moms = 1250; 30% = 375
    const p = computePricing(
      [{ pricing_mode: 'item', quantity: '1', unit_price: '1000', is_rot_work: true }],
      25,
      { isPrivate: true, rot: { enabled: true, rot_percent: 30, max_deduction: 50000 } },
    );
    expect(p.rotDeduction).toBe(375);
    expect(p.toPay).toBe(p.total - 375);
  });

  it('ROT respects the max deduction cap', () => {
    const p = computePricing(
      [{ pricing_mode: 'item', quantity: '100', unit_price: '1000', is_rot_work: true }],
      25,
      { isPrivate: true, rot: { enabled: true, rot_percent: 30, max_deduction: 5000 } },
    );
    expect(p.rotDeduction).toBe(5000);
  });

  it('ROT floors the öre (e.g. 393,75 → 393)', () => {
    // row 1050 incl 25% moms = 1312,5; 30% = 393,75 → 393
    const p = computePricing(
      [{ pricing_mode: 'item', quantity: '1', unit_price: '1050', is_rot_work: true }],
      25,
      { isPrivate: true, rot: { enabled: true, rot_percent: 30 } },
    );
    expect(p.rotDeduction).toBe(393);
  });
});

describe('resolveQuoteVatBreakdown', () => {
  it('prefers the stored pricing_summary (subtotal ex moms, total incl moms)', () => {
    const b = resolveQuoteVatBreakdown({
      pricing_summary: { subtotal: 100_000, vat: 25_000, total: 125_000 },
      amount: 999, // ignored when pricing_summary is present
      vat_percent: 25,
    });
    expect(b).toEqual({ subtotal: 100_000, vat: 25_000, total: 125_000, vatPercent: 25 });
  });

  it('derives a missing vat from total − subtotal', () => {
    const b = resolveQuoteVatBreakdown({ pricing_summary: { subtotal: 80_000, total: 100_000 }, vat_percent: 25 });
    expect(b.vat).toBe(20_000);
  });

  it('legacy fallback: treats the scalar amount as the incl-moms total', () => {
    const b = resolveQuoteVatBreakdown({ pricing_summary: null, amount: 125_000, vat_percent: 25 });
    expect(b.total).toBe(125_000);
    expect(b.subtotal).toBe(100_000);
    expect(b.vat).toBe(25_000);
  });

  it('handles 0% vat without dividing oddly', () => {
    const b = resolveQuoteVatBreakdown({ pricing_summary: null, amount: 5_000, vat_percent: 0 });
    expect(b).toEqual({ subtotal: 5_000, vat: 0, total: 5_000, vatPercent: 0 });
  });
});

describe('quoteAmountDisplay', () => {
  const breakdown = { subtotal: 100_000, vat: 25_000, total: 125_000, vatPercent: 25 };

  it('private → headline is the incl-moms total', () => {
    const d = quoteAmountDisplay('private', breakdown);
    expect(d.primary).toBe(125_000);
    expect(d.basisSuffix).toBe('inkl. moms');
    expect(d.primaryLabel).toBe('Att betala inkl. moms');
  });

  it('business → headline is ex moms, moms still exposed for the breakdown', () => {
    const d = quoteAmountDisplay('business', breakdown);
    expect(d.primary).toBe(100_000);
    expect(d.basisSuffix).toBe('ex moms');
    expect(d.vat).toBe(25_000);
    expect(d.vatPercent).toBe(25);
    expect(d.reverseCharge).toBe(false);
  });

  it('business at 0 % VAT → reverse charge (omvänd skattskyldighet), not a plain ex-moms', () => {
    const d = quoteAmountDisplay('business', { subtotal: 100_000, vat: 0, total: 100_000, vatPercent: 0 });
    expect(d.reverseCharge).toBe(true);
    expect(d.primary).toBe(100_000);
    expect(d.basisSuffix).toBe('omvänd skattskyldighet');
    expect(d.primaryLabel).toBe('Belopp (omvänd skattskyldighet)');
  });

  it('private at 0 % VAT is NOT reverse charge (byggmoms is B2B only)', () => {
    const d = quoteAmountDisplay('private', { subtotal: 100_000, vat: 0, total: 100_000, vatPercent: 0 });
    expect(d.reverseCharge).toBe(false);
  });
});

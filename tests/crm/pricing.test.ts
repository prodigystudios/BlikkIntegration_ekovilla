import { describe, it, expect } from 'vitest';
import {
  lineItemRowTotal, computePricing, resolveQuoteVatBreakdown, quoteAmountDisplay,
  rowMarginPercent, marginTier, quoteMargin, splitRowLabor, MARGIN_THRESHOLDS,
} from '@/lib/domains/crm/pricing';

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

  it('ROT base includes carved-out labor_cost from unflagged material rows (not the whole row)', () => {
    // Material row 10000 with 4000 labour carved out: only the 4000 is the ROT base.
    // 4000 incl 25% moms = 5000; 30% = 1500. The 6000 material must NOT count.
    const p = computePricing(
      [{ pricing_mode: 'item', quantity: '1', unit_price: '10000', labor_cost: '4000' }],
      25,
      { isPrivate: true, rot: { enabled: true, rot_percent: 30, max_deduction: 50000 } },
    );
    expect(p.rotDeduction).toBe(1500);
    // Total is unchanged by the split — still the full row.
    expect(p.subtotal).toBe(10000);
  });

  it('ROT base clamps labor_cost to the row total', () => {
    // labor_cost 99999 on a 1000 row → base is the 1000 row, not 99999.
    // 1000 incl 25% = 1250; 30% = 375.
    const p = computePricing(
      [{ pricing_mode: 'item', quantity: '1', unit_price: '1000', labor_cost: '99999' }],
      25,
      { isPrivate: true, rot: { enabled: true, rot_percent: 30, max_deduction: 50000 } },
    );
    expect(p.rotDeduction).toBe(375);
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

// ---------------------------------------------------------------------------
// Täckningsgrad (TG)
// ---------------------------------------------------------------------------

describe('rowMarginPercent', () => {
  it('räknar TG på intäkten, inte på inköpet', () => {
    // Köp 100, sälj 200 → 50 % TG. Samma affär är 100 % PÅSLAG; blandas de ihop blir tröskeln
    // dubbelt fel och en usel affär lyser grön.
    expect(rowMarginPercent({ revenue: 200, quantity: 1, purchasePrice: 100 })).toBeCloseTo(50, 6);
    expect(rowMarginPercent({ revenue: 150, quantity: 1, purchasePrice: 100 })).toBeCloseTo(33.333, 3);
  });

  it('räknar inköpet mot antalet', () => {
    expect(rowMarginPercent({ revenue: 2000, quantity: 10, purchasePrice: 100 })).toBeCloseTo(50, 6);
  });

  it('ger negativ TG när intäkten ligger under inköpet', () => {
    expect(rowMarginPercent({ revenue: 80, quantity: 1, purchasePrice: 100 })).toBeCloseTo(-25, 6);
  });

  it('ger null när inköpspriset saknas — 61 av 289 artiklar har inget', () => {
    expect(rowMarginPercent({ revenue: 200, quantity: 1, purchasePrice: null })).toBeNull();
    expect(rowMarginPercent({ revenue: 200, quantity: 1, purchasePrice: undefined })).toBeNull();
    expect(rowMarginPercent({ revenue: 200, quantity: 1, purchasePrice: 0 })).toBeNull();
  });

  it('ger null för en tom rad i stället för att lysa rött', () => {
    // En nyss tillagd rad ska inte larma innan säljaren skrivit något.
    expect(rowMarginPercent({ revenue: 0, quantity: 0, purchasePrice: 100 })).toBeNull();
    expect(rowMarginPercent({ revenue: 0, quantity: 5, purchasePrice: 100 })).toBeNull();
  });
});

describe('marginTier', () => {
  // Skillnaden är inte teoretisk: 1 000 kr intäkt mot 600 kr inköp ger exakt 40,0 %, och runda
  // priser är just vad säljare skriver.
  it('40,0 % är gult, inte grönt — runda priser träffar gränsen på pricken', () => {
    expect(rowMarginPercent({ revenue: 1000, quantity: 1, purchasePrice: 600 })).toBe(40);
    expect(marginTier(rowMarginPercent({ revenue: 1000, quantity: 1, purchasePrice: 600 }))).toBe('watch');
  });

  // Säljchefens formulering, 2026-08-14: "Under 25% - röd / 25-40 - gul / >40 - grön".
  // Övre gränsen är alltså EXKLUSIV och den undre inklusiv — 40,0 är gult, 25,0 är gult.
  it('delar in efter trösklarna: undre gränsen inklusiv, övre exklusiv', () => {
    expect(marginTier(60)).toBe('good');
    expect(marginTier(MARGIN_THRESHOLDS.good + 0.1)).toBe('good');
    expect(marginTier(MARGIN_THRESHOLDS.good)).toBe('watch');
    expect(marginTier(MARGIN_THRESHOLDS.watch)).toBe('watch');
    expect(marginTier(MARGIN_THRESHOLDS.watch - 0.1)).toBe('bad');
    expect(marginTier(-10)).toBe('bad');
  });

  it('okänt inköpspris är UNKNOWN, aldrig rött', () => {
    // Ett saknat inköpspris är inte en dålig affär — att färga det rött hade fått säljaren att
    // jaga godkännande för artiklar som ingen prissatt.
    expect(marginTier(null)).toBe('unknown');
    expect(marginTier(undefined)).toBe('unknown');
    expect(marginTier(Number.NaN)).toBe('unknown');
  });

  it('respekterar egna trösklar när säljchefen satt sina', () => {
    expect(marginTier(45, { good: 40, watch: 30 })).toBe('good');
    expect(marginTier(35, { good: 40, watch: 30 })).toBe('watch');
    expect(marginTier(25, { good: 40, watch: 30 })).toBe('bad');
  });
});

describe('quoteMargin', () => {
  it('viktar efter belopp — inte ett ovägt snitt av radernas procent', () => {
    // 5-kronorsraden har 80 % TG, 50 000-raden har 20 %. Ett ovägt snitt vore 50 % och skulle
    // dölja att offerten som helhet är svag.
    const result = quoteMargin([
      { revenue: 5, quantity: 1, purchasePrice: 1 },
      { revenue: 50000, quantity: 1, purchasePrice: 40000 },
    ]);
    expect(result.revenue).toBe(50005);
    expect(result.cost).toBe(40001);
    expect(result.marginPercent).toBeCloseTo(20.006, 2);
  });

  it('håller rader utan inköpspris UTANFÖR summorna och rapporterar dem', () => {
    // Att räkna dem som kostnadsfria hade blåst upp TG:n till en farligt optimistisk siffra.
    const result = quoteMargin([
      { revenue: 200, quantity: 1, purchasePrice: 100 },
      { revenue: 1000, quantity: 1, purchasePrice: null },
    ]);
    expect(result.marginPercent).toBeCloseTo(50, 6);
    expect(result.revenue).toBe(200);
    expect(result.unpricedRows).toBe(1);
    expect(result.unpricedRevenue).toBe(1000);
  });

  it('fångar den AUTO-PRISSATTA raden som obedömd i stället för att tappa den', () => {
    // Regressionsvakt: formuläret prissätter auto-rader med sin egen stub, så de HAR en intäkt på
    // skärmen men saknar artikel och därmed inköpspris. Räknades de inte skulle säljaren se en grön
    // TG som ignorerade nästan hela offertvärdet — utan en enda varning.
    const result = quoteMargin([
      { revenue: 100, quantity: 1, purchasePrice: 40 },
      { revenue: 18000, quantity: 20, purchasePrice: null }, // 20 m³ × 900 kr, ingen artikel vald
    ]);
    expect(result.marginPercent).toBeCloseTo(60, 6);
    expect(result.unpricedRows).toBe(1);
    expect(result.unpricedRevenue).toBe(18000);
  });

  it('ger null när ingen rad går att bedöma', () => {
    const result = quoteMargin([{ revenue: 200, quantity: 1, purchasePrice: null }]);
    expect(result.marginPercent).toBeNull();
    expect(result.unpricedRows).toBe(1);
  });

  it('räknar inte tomma rader som obedömbara', () => {
    // En tom rad har ingen intäkt och ska varken påverka TG:n eller flaggas som "kunde inte bedömas".
    const result = quoteMargin([{ revenue: 0, quantity: 0, purchasePrice: null }]);
    expect(result.unpricedRows).toBe(0);
    expect(result.marginPercent).toBeNull();
  });
});

// ─── ROT: arbete i TG:n ────────────────────────────────────────────────────────
//
// En ROT-offert bryter ut arbetet ur priset. Arbete köps inte in, så det saknar inköpspris — och
// tidigare lyftes varje rad utan inköpspris ut ur BÅDA summorna. Eftersom arbete är nästan ren
// marginal drog det ner den sammanvägda siffran hårt. Reglerna nedan är beslutade av William
// 2026-08-19; se MarginRow.isLabor.
describe('splitRowLabor', () => {
  it('bryter UT arbetet ur radpriset — det läggs aldrig till', () => {
    // ⚠️ Regressionsvakt mot den dyraste feltolkningen: "Varav" har lästs som "plus". En rad på
    // 18 000 kr med 12 000 kr arbete är fortfarande 18 000 kr, inte 30 000.
    const split = splitRowLabor(18000, '12000');
    expect(split.labor).toBe(12000);
    expect(split.material).toBe(6000);
    expect(split.labor + split.material).toBe(18000);
    expect(split.clamped).toBe(false);
  });

  it('kapar ett belopp som överstiger radtotalen', () => {
    // Samma kapning som rowRotLaborCarveout gör vid pushen — materialet får aldrig gå negativt.
    const split = splitRowLabor(18000, '25000');
    expect(split.labor).toBe(18000);
    expect(split.material).toBe(0);
    expect(split.clamped).toBe(true);
  });

  it('läser svenska kommadecimaler', () => {
    expect(splitRowLabor(1000, '199,50').labor).toBeCloseTo(199.5, 6);
  });

  it('ger noll arbete för tomt, nollat eller negativt belopp', () => {
    for (const input of ['', null, undefined, '0', '-500']) {
      const split = splitRowLabor(18000, input);
      expect(split.labor, String(input)).toBe(0);
      expect(split.material, String(input)).toBe(18000);
      expect(split.clamped, String(input)).toBe(false);
    }
  });

  it('klarar en rad utan pris utan att gå negativt', () => {
    const split = splitRowLabor(0, '200');
    expect(split.labor).toBe(0);
    expect(split.material).toBe(0);
    expect(split.clamped).toBe(true);
  });
});

describe('TG på ROT-offerter', () => {
  it('den utbrutna arbetskostnaden ändrar inte TG:n — den ingår redan', () => {
    // ⚠️ REGRESSIONSVAKT MOT EN FELDIAGNOS. Fältet "Varav arbetskostnad (ROT, kr)" BRYTER UT arbetet
    // ur radpriset utan att ändra radtotalen: 150 000 kr förblir 150 000 kr, och först vid
    // Fortnox-pushen delas raden i material + "Arbetskostnad ROT" (art. 10058). Intäkten som skickas
    // hit innehåller alltså redan arbetet, medan kostnaden bara är materialets — arbetsdelen får
    // full TG av sig själv.
    //
    // Att läsa `labor_cost` här och dra av det vore alltså inte en fix utan en NY bugg: TG:n skulle
    // falla från 46,7 % till 20 % på precis de offerter felet påstods gälla.
    const heltRadprisetInklArbete = quoteMargin([
      { revenue: 150000, quantity: 100, purchasePrice: 800 },
    ]);
    expect(heltRadprisetInklArbete.marginPercent).toBeCloseTo(46.667, 3);
    expect(heltRadprisetInklArbete.unpricedRows).toBe(0);
  });

  it('räknar en arbetsrad utan inköpspris som full TG i stället för att utesluta den', () => {
    // Material 100 000 mot 80 000 inköp (20 %) + 50 000 arbete utan inköpskostnad.
    // Före regeln uteslöts arbetsraden och säljaren såg 20 % — en röd offert som krävde
    // säljchefsgodkännande fast den sanna blandade TG:n är 46,7 %.
    const result = quoteMargin([
      { revenue: 100000, quantity: 100, purchasePrice: 800 },
      { revenue: 50000, quantity: 1, purchasePrice: null, isLabor: true },
    ]);
    expect(result.marginPercent).toBeCloseTo(46.667, 3);
    expect(result.revenue).toBe(150000);
    expect(result.cost).toBe(80000);
    // Arbetsraden är BEDÖMD, inte obedömbar — annars hade upplysningen "1 rad saknar inköpspris"
    // stått kvar under en siffra som faktiskt räknar med raden.
    expect(result.unpricedRows).toBe(0);
    expect(result.unpricedRevenue).toBe(0);
  });

  it('låter en arbetsrad SOM HAR inköpspris räkna sin kostnad som vanligt', () => {
    // Kryssrutan går att sätta på vilken rad som helst. Hade isLabor nollat kostnaden rakt av
    // skulle en materialrad som råkat kryssas tappa hela sitt inköp och lysa 100 %.
    const result = quoteMargin([
      { revenue: 1000, quantity: 1, purchasePrice: 600, isLabor: true },
    ]);
    expect(result.marginPercent).toBeCloseTo(40, 6);
    expect(result.cost).toBe(600);
  });

  it('håller MATERIAL utan inköpspris utanför även när offerten är ROT', () => {
    // Regeln gäller arbete, inte "allt utan inköpspris". 61 av 289 artiklar saknar inköpspris, och
    // att räkna dem som kostnadsfria är just den farligt optimistiska siffran quoteMargin undviker.
    const result = quoteMargin([
      { revenue: 1000, quantity: 1, purchasePrice: 600 },
      { revenue: 9000, quantity: 3, purchasePrice: null },
    ]);
    expect(result.marginPercent).toBeCloseTo(40, 6);
    expect(result.unpricedRows).toBe(1);
    expect(result.unpricedRevenue).toBe(9000);
  });

  it('ger radmärket 100 % på en arbetsrad utan inköpspris', () => {
    expect(rowMarginPercent({ revenue: 50000, quantity: 1, purchasePrice: null, isLabor: true })).toBe(100);
    // Utan antal också — arbete prissätts ibland som klumpsumma, och kostnaden är noll oavsett.
    expect(rowMarginPercent({ revenue: 50000, quantity: 0, purchasePrice: null, isLabor: true })).toBe(100);
  });

  it('ger fortfarande null för en tom arbetsrad', () => {
    // En nyss tillagd rad med kryssrutan i ska inte lysa grönt innan säljaren skrivit ett pris.
    expect(rowMarginPercent({ revenue: 0, quantity: 0, purchasePrice: null, isLabor: true })).toBeNull();
  });
});

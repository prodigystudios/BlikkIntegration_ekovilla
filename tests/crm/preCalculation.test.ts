import { describe, it, expect } from 'vitest';
import { calculatePreCalculation, isBlownRow, type PreCalculationInput } from '@/lib/domains/crm/preCalculation';

// Förkalkylen på offerten. Tre saker kan gå tyst fel, och alla tre åt samma håll — ett jobb som ser
// lönsammare ut än det är:
//
//   1. team-timmar förväxlas med man-timmar (faktor teamSize)
//   2. ett saknat produktivitetstal tolkas som noll timmar
//   3. en ofullständig materialsumma visas som ett svar i stället för som en undre gräns

// 100 m² × 200 mm = 20 m³ Ekovilla vid 45 kg/m³ → 900 kg / 14 kg = 65 säck (Math.ceil).
const losull = (over: Record<string, unknown> = {}) => ({
  article_name: 'EKOVILLA cellulosa 0,038W/mK vind',
  article_number: '2410510',
  pricing_mode: 'm3',
  m2: '100',
  thickness_mm: '200',
  density: '45',
  construction: 'vind',
  revenue: 100_000,
  ...over,
});

const base: PreCalculationInput = {
  items: [],
  laborCostPerHour: 650,
  teamSize: 2,
  rates: [{ construction: 'vind', material: 'EKOVILLA', m3PerHour: 20 }],
  sackPrices: [{ material: 'EKOVILLA', purchasePrice: 100 }],
};

const calc = (over: Partial<PreCalculationInput> = {}) => calculatePreCalculation({ ...base, ...over });

describe('isBlownRow', () => {
  it('lösull såld per volym blåses', () => {
    expect(isBlownRow(losull() as any)).toBe(true);
  });

  it('en omdöpt rad känns igen på densiteten — samma regel som efterkalkylen', () => {
    expect(isBlownRow({ article_name: 'Lösull vind', pricing_mode: 'm3', density: '45', revenue: 0 } as any)).toBe(true);
  });

  it('skivor och etablering blåses inte', () => {
    expect(isBlownRow({ article_name: 'EKOVILLA LEVY 30MM', pricing_mode: 'item', revenue: 0 } as any)).toBe(false);
    expect(isBlownRow({ article_name: 'Etableringskostnad', pricing_mode: 'item', revenue: 0 } as any)).toBe(false);
  });
});

describe('materialet räknas via planerade säckar', () => {
  it('säckar × kr/säck — samma antal som arbetsbeskrivningen skriver', () => {
    const result = calc({ items: [losull() as any] });
    // 20 m³ × 45 kg/m³ = 900 kg / 14 kg per säck = 64,29 → 65 hela säckar.
    expect(result.materialCost).toBe(65 * 100);
  });

  it('densiteten slår igenom — det är hela poängen med att gå via säckar', () => {
    // Samma volym, tätare blåsning: 20 m³ × 60 kg/m³ = 1 200 kg / 14 = 85,7 → 86 säck.
    const result = calc({ items: [losull({ density: '60' }) as any] });
    expect(result.materialCost).toBe(86 * 100);
  });

  it('saknad kostnadsartikel ger okänd materialkostnad, inte en delsumma', () => {
    const result = calc({ items: [losull() as any], sackPrices: [] });
    expect(result.materialCost).toBeNull();
    expect(result.tb1).toBeNull();
    expect(result.gaps.map((g) => g.kind)).toContain('missing_sack_price');
  });

  it('övriga rader kostar inköpspris × antal', () => {
    const levy = { article_name: 'EKOVILLA LEVY 30MM', pricing_mode: 'item', quantity: '4', revenue: 2_309, purchasePrice: 499.89 };
    const result = calc({ items: [losull() as any, levy as any] });
    expect(result.materialCost).toBeCloseTo(65 * 100 + 4 * 499.89, 6);
  });

  it('en rad utan inköpspris gör summan okänd och redovisas', () => {
    const duk = { article_name: 'Vindduk', pricing_mode: 'item', quantity: '2', revenue: 4_800, purchasePrice: null };
    const result = calc({ items: [losull() as any, duk as any] });
    expect(result.materialCost).toBeNull();
    const gap = result.gaps.find((g) => g.kind === 'unpriced_rows');
    expect(gap && 'revenue' in gap ? gap.revenue : 0).toBe(4_800);
  });

  it('inköpspris 0 är ett svar — etableringen kostar inget och stoppar ingenting', () => {
    const etablering = { article_name: 'Etableringskostnad', pricing_mode: 'item', quantity: '1', revenue: 4_500, purchasePrice: 0 };
    const result = calc({ items: [losull() as any, etablering as any] });
    expect(result.materialCost).toBe(65 * 100);
    expect(result.gaps.map((g) => g.kind)).not.toContain('unpriced_rows');
  });
});

describe('arbetstiden uppskattas ur produktiviteten', () => {
  it('team-timmar × TEAMSTORLEK × timkostnad — inte team-timmar rakt av', () => {
    // 20 m³ / 20 m³ per timme = 1 team-timme = 2 man-timmar × 650 = 1 300 kr.
    const result = calc({ items: [losull() as any] });
    expect(result.teamHours).toBeCloseTo(1, 10);
    expect(result.laborCost).toBeCloseTo(1_300, 10);
  });

  it('ett lag om tre kostar mer per team-timme', () => {
    const result = calc({ items: [losull() as any], teamSize: 3 });
    expect(result.laborCost).toBeCloseTo(1 * 3 * 650, 10);
  });

  it('produktiviteten slås upp per KOMBINATION — vind och vägg kan ha olika takt', () => {
    const result = calc({
      items: [losull({ construction: 'vagg' }) as any],
      rates: [
        { construction: 'vind', material: 'EKOVILLA', m3PerHour: 20 },
        { construction: 'vagg', material: 'EKOVILLA', m3PerHour: 10 },
      ],
    });
    expect(result.teamHours).toBeCloseTo(2, 10);
  });

  it('saknat produktivitetstal ger okänd tid, ALDRIG noll timmar', () => {
    const result = calc({ items: [losull() as any], rates: [] });
    expect(result.teamHours).toBeNull();
    expect(result.laborCost).toBeNull();
    expect(result.tb2).toBeNull();
    // TB1 står kvar — materialet går ju att räkna.
    expect(result.tb1).toBe(100_000 - 6_500);
    const gap = result.gaps.find((g) => g.kind === 'missing_rate');
    expect(gap?.message).toContain('Vind × EKOVILLA');
  });

  it('en rad utan placering kan inte tidsättas — och luckan säger vilken', () => {
    const result = calc({ items: [losull({ construction: '' }) as any] });
    expect(result.teamHours).toBeNull();
    const gap = result.gaps.find((g) => g.kind === 'missing_rate');
    expect(gap?.message).toContain('Ospecificerad placering');
  });

  it('ETT moment utan takt gör hela tiden okänd — inte en delsumma', () => {
    const result = calc({
      items: [losull() as any, losull({ construction: 'vagg' }) as any],
      // Bara vind har en takt.
    });
    expect(result.teamHours).toBeNull();
  });

  it('utan timkostnad går TB2 inte att räkna men TB1 står kvar', () => {
    const result = calc({ items: [losull() as any], laborCostPerHour: null });
    expect(result.tb1).toBe(100_000 - 6_500);
    expect(result.tb2).toBeNull();
    expect(result.gaps.map((g) => g.kind)).toContain('no_labor_rate');
  });
});

describe('TB och TG', () => {
  it('fullständigt underlag ger båda talen', () => {
    const result = calc({ items: [losull() as any] });
    expect(result.revenue).toBe(100_000);
    expect(result.tb1).toBe(93_500);
    expect(result.tb2).toBe(93_500 - 1_300);
    expect(result.tg1).toBeCloseTo(93.5, 10);
    expect(result.tg2).toBeCloseTo(92.2, 10);
    expect(result.gaps).toEqual([]);
  });

  it('avskrivna rader är ute ur både intäkt och kostnad', () => {
    const result = calc({ items: [losull() as any, losull({ written_off: true, revenue: 50_000 }) as any] });
    expect(result.revenue).toBe(100_000);
    expect(result.materialCost).toBe(65 * 100);
  });

  it('en offert kan gå med förlust — TB2 får bli negativ', () => {
    const result = calc({ items: [losull({ revenue: 5_000 }) as any] });
    expect(result.tb2).toBeLessThan(0);
  });
});

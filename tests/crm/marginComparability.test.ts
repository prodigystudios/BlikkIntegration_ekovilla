import { describe, it, expect } from 'vitest';
import { calculatePreCalculation } from '@/lib/domains/crm/preCalculation';
import { calculateAfterCalculation } from '@/lib/domains/crm/afterCalculation';
import { isBlownInsulationRow } from '@/lib/domains/crm/afterCalculationLoader';
import { planIsPartial } from '@/lib/domains/crm/marginComparability';

// Regressionsskydd för granskningsfyndet 2026-09-21: kortet höll på att ställa plan mot utfall på
// två olika intäktsunderlag, utan att något flaggade det. 0 av 187 skarpa ordrar träffades, men
// mekanismen är reell och spärren är det som gör den ofarlig.

// Lösullsrad MED varumärke, UTAN densitet (fritext, valideras aldrig), vars artikel saknar pris.
const losullUtanDensitet = {
  article_name: 'EKOVILLA cellulosa vind', article_number: '2410510',
  pricing_mode: 'm3', m2: '250', thickness_mm: '400', density: '', unit_price: '900',
};
const etablering = {
  article_name: 'Etableringskostnad', article_number: '1010',
  pricing_mode: 'item', quantity: '1', unit_price: '3000',
};

describe('planIsPartial', () => {
  it('lika intäkter är jämförbara', () => {
    expect(planIsPartial(93000, 93000)).toBe(false);
  });

  // 🧨 MUTATIONSPRÖVAT: höjs toleransen till t.ex. 5000 faller det här. Halvkronan är mot
  // flyttalsbrus, inte en tolerans för utlyfta rader — en utlyft rad är ALDRIG ett avrundningsfel.
  it('en utlyft rad gör planen till en delmängd', () => {
    expect(planIsPartial(3000, 93000)).toBe(true);
  });

  it('okänd orderintäkt går inte att jämföra mot — då är planen inte bevisat partiell', () => {
    expect(planIsPartial(3000, null)).toBe(false);
  });

  // 🧨 GRÄNSFALLEN ÄR DET SOM PINNAR TOLERANSEN. Utan dem passerade en mutation som vidgade den
  // till 5 000 kr — testet ovan har 90 000 kr i glapp och märker ingen skillnad. En utlyft rad på
  // en krona är fortfarande en utlyft rad.
  it('en krona i glapp är en delmängd, inte brus', () => {
    expect(planIsPartial(92999, 93000)).toBe(true);
  });

  it('flyttalsbrus under halvkronan är inte en delmängd', () => {
    expect(planIsPartial(93000.2, 93000)).toBe(false);
    expect(planIsPartial(92999.7, 93000)).toBe(false);
  });
});

describe('den falska invarianten', () => {
  it('plan och utfall KAN båda finnas på olika nämnare — därav spärren', () => {
    const pre = calculatePreCalculation({
      items: [
        { ...losullUtanDensitet, revenue: 90000, purchasePrice: null } as any,
        { ...etablering, revenue: 3000, purchasePrice: 0 } as any,
      ],
      laborCostPerHour: 650, teamSize: 2,
      rates: [{ construction: 'vind', material: 'EKOVILLA', m3PerHour: 22 }],
      sackPrices: [{ material: 'EKOVILLA', purchasePrice: 92.4 }],
    });
    // Raden är blåst, så efterkalkylen ser den aldrig bland otherMaterialRows och den når därmed
    // aldrig unpricedLabels — det är precis därför slutledningen "utfall finns ⟹ jämförbart" brast.
    expect(isBlownInsulationRow(losullUtanDensitet as any)).toBe(true);

    const post = calculateAfterCalculation({
      revenue: 93000,
      sackRows: [{ id: 'r1', work_order_id: 'w', kind: 'final', sacks_blown: 500, material: 'EKOVILLA' } as any],
      timeRows: [{ minutes_worked: 4800 }],
      costArticles: [{ material: 'EKOVILLA', articleNumber: '2410508', purchasePrice: 92.4 }],
      otherMaterialRows: [{ label: 'Etablering', articleNumber: '1010', quantity: 1, purchasePrice: 0, revenue: 3000 }],
      hasBlownInsulationRows: true,
      laborCostPerHour: 650,
    });

    expect(pre.tg1).not.toBeNull();
    expect(post.tg1).not.toBeNull();
    expect(post.gaps).toHaveLength(0);          // inget flaggar det
    expect(pre.revenue).toBe(3000);
    expect(post.revenue).toBe(93000);
    expect(planIsPartial(pre.revenue, post.revenue)).toBe(true); // spärren fångar det
  });
});

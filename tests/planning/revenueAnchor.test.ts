import { describe, it, expect } from 'vitest';
import { revenueAnchorSegments } from '@/lib/domains/planning/weekValue';

// Skyddet mot att samma omsättning skrivs ut flera gånger på tavlan. Belagt i månadsvyn innan
// fixen: 9 av 10 flerkortsjobb visade SAMMA belopp två till tre gånger (#55 på 38 045 kr × 2,
// #82 på 64 859 kr × 2). Bara ett av tio var ett äkta etappfall med olika belopp.

const seg = (over: Partial<Parameters<typeof revenueAnchorSegments>[0][number]> = {}) => ({
  id: 'a', work_order_id: 'wo-1', stage_id: null, start_day: '2026-09-21', sort_index: 0, ...over,
});

describe('revenueAnchorSegments', () => {
  it('en placering blir sitt eget ankare', () => {
    expect(revenueAnchorSegments([seg()])).toEqual(new Set(['a']));
  });

  // 🧨 MUTATIONSPRÖVAT: byts nyckeln mot segmentets id blir båda ankare, och beloppet skrivs ut två
  // gånger. Att dela upp ett jobb på två besök gör det inte värt dubbelt.
  it('två placeringar av SAMMA scope ger ETT ankare — den tidigaste', () => {
    const anchors = revenueAnchorSegments([
      seg({ id: 'sen', start_day: '2026-09-25' }),
      seg({ id: 'tidig', start_day: '2026-09-21' }),
    ]);
    expect(anchors).toEqual(new Set(['tidig']));
  });

  // 🧨 MUTATIONSPRÖVAT: utelämnas stage_id ur nyckeln tappar etapp 2 sitt belopp helt — och två
  // etapper ÄR två belopp.
  it('två ETAPPER av samma order ger två ankare', () => {
    const anchors = revenueAnchorSegments([
      seg({ id: 'e1', stage_id: 'stage-1' }),
      seg({ id: 'e2', stage_id: 'stage-2' }),
    ]);
    expect(anchors).toEqual(new Set(['e1', 'e2']));
  });

  it('etapp och rest är olika scope', () => {
    const anchors = revenueAnchorSegments([
      seg({ id: 'etapp', stage_id: 'stage-1' }),
      seg({ id: 'rest', stage_id: null }),
    ]);
    expect(anchors.size).toBe(2);
  });

  // 🧨 MUTATIONSPRÖVAT: tas sort_index/id-avgörandet bort avgörs oavgjort av radordningen i svaret,
  // och den byter efter en orelaterad UPDATE — beloppet hoppar mellan kort utan att något ändrats.
  it('samma dag avgörs av sort_index, sedan id — aldrig av radordningen', () => {
    const a = revenueAnchorSegments([seg({ id: 'b', sort_index: 1 }), seg({ id: 'a', sort_index: 0 })]);
    const b = revenueAnchorSegments([seg({ id: 'a', sort_index: 0 }), seg({ id: 'b', sort_index: 1 })]);
    expect(a).toEqual(new Set(['a']));
    expect(b).toEqual(a);
  });

  it('platshållare bär ingen omsättning', () => {
    expect(revenueAnchorSegments([seg({ id: 'p', work_order_id: null })]).size).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import {
  computeStageState,
  hasUnallocatedWork,
  scopeLineItems,
  StageAllocationError,
  validateStageAllocation,
  type StageLineItem,
  type WorkOrderStage,
} from '@/lib/domains/crm/workOrderStages';
import { totalSacks } from '@/lib/domains/crm/materials';
import { lineItemRowTotal } from '@/lib/domains/crm/pricing';

// En m3-rad: 300 m2 x 200 mm = 60 m3, 1 200 kr/m3 = 72 000 kr.
const wall = (): StageLineItem & Record<string, unknown> => ({
  id: 'r-wall',
  pricing_mode: 'm3',
  m2: '300',
  thickness_mm: '200',
  unit_price: '1200',
  density: '38',
  article_name: 'Ekovilla lösull',
});
// 180 m2 x 300 mm = 54 m3, 1 200 kr/m3 = 64 800 kr.
const roof = (): StageLineItem & Record<string, unknown> => ({
  id: 'r-roof',
  pricing_mode: 'm3',
  m2: '180',
  thickness_mm: '300',
  unit_price: '1200',
  density: '38',
  article_name: 'Ekovilla lösull',
});

const stage = (id: string, lines: Array<[string, number]>): WorkOrderStage => ({
  id,
  stage_number: 1,
  title: 'Etapp',
  line_quantities: lines.map(([line_id, quantity]) => ({ line_id, quantity })),
});

const revenue = (rows: unknown[]) => rows.reduce<number>((s, r) => s + lineItemRowTotal(r as never), 0);

describe('computeStageState', () => {
  it('räknar allokerat och kvar per rad', () => {
    const state = computeStageState([wall(), roof()], [stage('s1', [['r-wall', 24]])]);
    expect(state[0]).toMatchObject({ lineId: 'r-wall', total: 60, allocated: 24, unallocated: 36 });
    expect(state[1]).toMatchObject({ lineId: 'r-roof', total: 54, allocated: 0, unallocated: 54 });
  });

  it('summerar över flera etapper och dubbla poster för samma rad', () => {
    const state = computeStageState([wall()], [stage('s1', [['r-wall', 10], ['r-wall', 5]]), stage('s2', [['r-wall', 20]])]);
    expect(state[0].allocated).toBe(35);
    expect(state[0].unallocated).toBe(25);
  });

  it('utelämnar den etapp som redigeras, så dess egna antal inte blockerar den själv', () => {
    const stages = [stage('s1', [['r-wall', 60]])];
    expect(computeStageState([wall()], stages)[0].unallocated).toBe(0);
    expect(computeStageState([wall()], stages, { excludeStageId: 's1' })[0].unallocated).toBe(60);
  });

  it('en avskriven rad har ingenting att planera', () => {
    const state = computeStageState([{ ...wall(), written_off: true }], [stage('s1', [['r-wall', 24]])]);
    expect(state[0]).toMatchObject({ total: 0, allocated: 0, unallocated: 0 });
  });

  it('KAPAR allokeringen när raden sänkts efter att etappen skapades', () => {
    // Etappen tog 60 m3; raden är nu bara 30 m3 (150 m2 x 200 mm). Utan kapningen hade "kvar" blivit
    // -30 och beskärningen planerat mer än vad som är sålt.
    const shrunk = { ...wall(), m2: '150' };
    const state = computeStageState([shrunk], [stage('s1', [['r-wall', 60]])]);
    expect(state[0]).toMatchObject({ total: 30, allocated: 30, unallocated: 0 });
  });

  it('ignorerar en rad utan id och en etapp som pekar på en borttagen rad', () => {
    const noId = { pricing_mode: 'item', quantity: '5' } as StageLineItem;
    expect(computeStageState([noId], [stage('s1', [['r-wall', 5]])])[0].allocated).toBe(0);
    expect(computeStageState([wall()], [stage('s1', [['r-borta', 10]])])[0].unallocated).toBe(60);
  });
});

describe('validateStageAllocation', () => {
  const state = () => computeStageState([wall(), roof()], []);

  it('släpper igenom och dedupar begärda antal', () => {
    const out = validateStageAllocation(state(), [
      { line_id: 'r-wall', quantity: 20 },
      { line_id: 'r-wall', quantity: 4 },
      { line_id: 'r-roof', quantity: 54 },
    ]);
    expect(out.get('r-wall')).toBe(24);
    expect(out.get('r-roof')).toBe(54);
  });

  it('avvisar överallokering med radens verkliga rest i beskedet', () => {
    expect(() => validateStageAllocation(state(), [{ line_id: 'r-wall', quantity: 61 }]))
      .toThrow(/bara 60 kvar/);
    expect(() => validateStageAllocation(state(), [{ line_id: 'r-wall', quantity: 61 }]))
      .toThrow(StageAllocationError);
  });

  it('avvisar en tom etapp', () => {
    expect(() => validateStageAllocation(state(), [])).toThrow(StageAllocationError);
    expect(() => validateStageAllocation(state(), [{ line_id: 'r-wall', quantity: 0 }])).toThrow(StageAllocationError);
  });

  it('avvisar en rad som inte finns på ordern', () => {
    expect(() => validateStageAllocation(state(), [{ line_id: 'r-borta', quantity: 1 }]))
      .toThrow(/finns inte längre/);
  });

  it('summerar dubbletter INNAN taket prövas', () => {
    // 40 + 30 = 70 > 60. Prövas posterna var för sig släpps båda igenom och etappen tar 70 av 60.
    expect(() => validateStageAllocation(state(), [
      { line_id: 'r-wall', quantity: 40 },
      { line_id: 'r-wall', quantity: 30 },
    ])).toThrow(StageAllocationError);
  });
});

describe('scopeLineItems', () => {
  const items = [wall(), roof()];

  // M7 — BAKÅTKOMPATIBILITETEN.
  // MUTANT: låt 'whole' gå genom projektionen i stället för att returnera arrayen orörd. Då
  // räknas varje befintlig order om genom en väg den aldrig gick förut.
  it('M7: whole returnerar EXAKT samma element, inte kopior', () => {
    const scoped = scopeLineItems(items, { kind: 'whole' });
    expect(scoped).toBe(items);
    expect(scoped[0]).toBe(items[0]);
    expect(totalSacks(scoped as never)).toBe(totalSacks(items as never));
    expect(revenue(scoped)).toBe(revenue(items));
  });

  it('beskär till etappens antal och utelämnar rader etappen inte rör', () => {
    const s1 = stage('s1', [['r-wall', 30]]);
    const scoped = scopeLineItems(items, { kind: 'stage', stage: s1, siblings: [] });
    expect(scoped).toHaveLength(1);
    expect(revenue(scoped)).toBe(30 * 1200);
  });

  it('resten är det ingen etapp tagit', () => {
    const s1 = stage('s1', [['r-wall', 30]]);
    const rest = scopeLineItems(items, { kind: 'rest', stages: [s1] });
    expect(rest).toHaveLength(2);
    expect(revenue(rest)).toBe(30 * 1200 + 54 * 1200);
  });

  // M6 — summan över scopes måste vara hela ordern.
  // MUTANT: låt 'rest' bara dra av den FÖRSTA etappen. Då dubbelräknas etapp 2:s rader.
  it('M6: etapperna plus resten är exakt hela ordern', () => {
    const s1 = stage('s1', [['r-wall', 20]]);
    const s2 = stage('s2', [['r-wall', 10], ['r-roof', 4]]);
    const stages = [s1, s2];

    const parts = [
      scopeLineItems(items, { kind: 'stage', stage: s1, siblings: stages }),
      scopeLineItems(items, { kind: 'stage', stage: s2, siblings: stages }),
      scopeLineItems(items, { kind: 'rest', stages }),
    ];
    const summed = parts.reduce((s, p) => s + revenue(p), 0);
    expect(summed).toBeCloseTo(revenue(items), 6);
  });

  // M8 — säckarnas riktning.
  // sacksFor avrundar UPP per rad, så en uppdelning kan bara ADDERA spill. Skillnaden är bunden av
  // antalet rader gånger antalet scopes; blir summan LÄGRE har beskärningen tappat material, och
  // då beställs för lite.
  it('M8: summan av etappernas säckar är minst helorderns, aldrig lägre', () => {
    const s1 = stage('s1', [['r-wall', 20]]);
    const s2 = stage('s2', [['r-wall', 10], ['r-roof', 4]]);
    const stages = [s1, s2];

    const whole = totalSacks(items as never);
    const parts = [
      scopeLineItems(items, { kind: 'stage', stage: s1, siblings: stages }),
      scopeLineItems(items, { kind: 'stage', stage: s2, siblings: stages }),
      scopeLineItems(items, { kind: 'rest', stages }),
    ].reduce((s, p) => s + totalSacks(p as never), 0);

    expect(parts).toBeGreaterThanOrEqual(whole);
    expect(parts - whole).toBeLessThanOrEqual(items.length * 3);
  });

  it('en etapp på en avskriven rad ger ingenting', () => {
    const written = [{ ...wall(), written_off: true }];
    expect(scopeLineItems(written, { kind: 'stage', stage: stage('s1', [['r-wall', 10]]), siblings: [] })).toEqual([]);
  });

  it('beskär en antalsrad utan att röra dess enhet', () => {
    const meters = { id: 'r-m', pricing_mode: 'item', quantity: '120', unit_price: '250', article_unit_name: 'm' };
    const scoped = scopeLineItems([meters], { kind: 'stage', stage: stage('s1', [['r-m', 45]]), siblings: [] });
    expect(scoped[0]).toMatchObject({ quantity: '45', article_unit_name: 'm' });
    expect(revenue(scoped)).toBe(45 * 250);
  });
});

describe('hasUnallocatedWork', () => {
  it('en order utan etapper har allt kvar', () => {
    expect(hasUnallocatedWork([wall()], [])).toBe(true);
    expect(hasUnallocatedWork([], [])).toBe(false);
  });

  it('falskt först när varje rad är helt tagen', () => {
    expect(hasUnallocatedWork([wall()], [stage('s1', [['r-wall', 30]])])).toBe(true);
    expect(hasUnallocatedWork([wall()], [stage('s1', [['r-wall', 60]])])).toBe(false);
  });
});

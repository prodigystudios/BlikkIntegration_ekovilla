import { describe, it, expect } from 'vitest';
import {
  actionsForItem,
  defaultFindingForItem,
  groupItemsByCategory,
  needsDetails,
  stepCounts,
  withEmptyCategories,
} from '@/lib/domains/safetyRounds/form';
import { completeBundle, makeAction, makeItem } from './helpers/fixtures';

// Formulärets rena logik. Grupperingen delas med protokollet — ordningen på papperet och i mobilen
// får aldrig gå isär.

describe('groupItemsByCategory', () => {
  it('grupperar i den ordning kategorierna först förekommer, och en egen punkt hamnar i sin kategori', () => {
    const items = [
      makeItem({ category_code: 'A', category_label: 'A-lbl', number: 1 }),
      makeItem({ category_code: 'B', category_label: 'B-lbl', number: 4 }),
      makeItem({ category_code: 'A', category_label: 'A-lbl', number: 2 }),
      // Egen punkt i A, sist i rondens ordning — ska ändå stå under A.
      makeItem({ category_code: 'A', category_label: 'A-lbl', number: null, catalog_item_id: null, text: 'Egen?' }),
    ];
    const groups = groupItemsByCategory(items);
    expect(groups.map((g) => g.code)).toEqual(['A', 'B']);
    expect(groups[0].items.map((i) => i.number)).toEqual([1, 2, null]);
    expect(groups[1].items.map((i) => i.number)).toEqual([4]);
  });
});

describe('withEmptyCategories', () => {
  it('lägger till katalogens tomma kategorier sist (I har inga fasta punkter)', () => {
    const groups = groupItemsByCategory([makeItem({ category_code: 'A', category_label: 'A-lbl' })]);
    const merged = withEmptyCategories(groups, [
      { code: 'A', label: 'A-lbl' },
      { code: 'I', label: 'Egna punkter / objektsspecifika risker' },
    ]);
    expect(merged.map((g) => [g.code, g.items.length])).toEqual([
      ['A', 1],
      ['I', 0],
    ]);
  });
});

describe('needsDetails', () => {
  it('bara Delvis och Brist fäller ut detaljerna', () => {
    expect(needsDetails({ status: 'partial' })).toBe(true);
    expect(needsDetails({ status: 'defect' })).toBe(true);
    expect(needsDetails({ status: 'ok' })).toBe(false);
    expect(needsDetails({ status: 'na' })).toBe(false);
    expect(needsDetails({ status: null })).toBe(false);
  });
});

describe('defaultFindingForItem', () => {
  it('tar beskrivningen, annars kontrollpunktens fråga', () => {
    expect(defaultFindingForItem({ description: '  Räcke saknas  ', text: 'Fallskydd?' })).toBe('Räcke saknas');
    expect(defaultFindingForItem({ description: '   ', text: 'Fallskydd?' })).toBe('Fallskydd?');
    expect(defaultFindingForItem({ description: null, text: 'Fallskydd?' })).toBe('Fallskydd?');
  });

  it('kapas till fältets tak (500)', () => {
    expect(defaultFindingForItem({ description: 'x'.repeat(600), text: 'y' })).toHaveLength(500);
  });
});

describe('stepCounts + actionsForItem', () => {
  it('räknar flikarnas tal', () => {
    const bundle = completeBundle();
    bundle.items.push(makeItem({ status: null }));
    expect(stepCounts(bundle)).toEqual({ participants: 2, assessed: 3, total: 4, actions: 1 });
  });

  it('hittar punktens åtgärder', () => {
    const a = makeAction({ item_id: 'x' });
    const b = makeAction({ item_id: 'y' });
    const c = makeAction({ item_id: 'x' });
    expect(actionsForItem([a, b, c], 'x')).toEqual([a, c]);
  });
});

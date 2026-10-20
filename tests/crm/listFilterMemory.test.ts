import { describe, it, expect } from 'vitest';
import { restoreListFilters, serializeListFilters, type ListFilters, type ListFilterRules } from '@/lib/domains/crm/listFilterMemory';
import { DEFAULT_WORK_ORDER_STATUS_FILTER, WORK_ORDER_STATUS_FILTER_OPTIONS, type WorkOrderStatusFilterOption } from '@/lib/domains/crm/listStatusFilter';
import { MINE } from '@/lib/domains/crm/assigneeFilter';

// Orderlistans filter sitter kvar i fliken när man går in på en order och tillbaka (William, 2026-10-20).

type Sort = 'created_desc' | 'planned_asc';
type Filters = ListFilters<WorkOrderStatusFilterOption, Sort>;

const defaults: Filters = {
  search: '',
  statuses: [...DEFAULT_WORK_ORDER_STATUS_FILTER],
  sort: 'created_desc',
  assignee: [MINE],
};

const rules: ListFilterRules<WorkOrderStatusFilterOption, Sort> = {
  statusOptions: WORK_ORDER_STATUS_FILTER_OPTIONS,
  sortOptions: ['created_desc', 'planned_asc'],
  defaults,
  allowMine: true,
};

const roundTrip = (current: Filters, withRules = rules) => restoreListFilters(serializeListFilters(current, defaults), withRules);

describe('serializeListFilters', () => {
  it('startvalet sparas inte — nyckeln ska tas bort, inte skrivas som {}', () => {
    expect(serializeListFilters({ ...defaults }, defaults)).toBeNull();
  });

  it('bara fälten som avviker följer med, så ett fält på startvalet räknas om nästa gång', () => {
    expect(JSON.parse(serializeListFilters({ ...defaults, sort: 'planned_asc' }, defaults)!)).toEqual({ sort: 'planned_asc' });
  });

  it('samma statusar och ansvariga i en annan ordning är fortfarande startvalet', () => {
    expect(serializeListFilters({
      ...defaults,
      statuses: [...DEFAULT_WORK_ORDER_STATUS_FILTER].reverse(),
    }, defaults)).toBeNull();
    const twoSellers: Filters = { ...defaults, assignee: ['u1', 'u2'] };
    expect(serializeListFilters({ ...twoSellers, assignee: ['u2', 'u1'] }, twoSellers)).toBeNull();
  });
});

describe('restoreListFilters', () => {
  it('en rundresa ger tillbaka exakt det som var valt', () => {
    const chosen: Filters = { search: 'Lindberg', statuses: ['invoiced'], sort: 'planned_asc', assignee: ['u1', 'u2'] };
    expect(roundTrip(chosen)).toEqual(chosen);
  });

  it('"Alla ansvariga" överlever, fast startvalet är "Mina"', () => {
    expect(roundTrip({ ...defaults, assignee: [] }).assignee).toEqual([]);
  });

  it('ett tomt statusval är giltigt — användaren har bockat ur allt', () => {
    expect(roundTrip({ ...defaults, statuses: [] }).statuses).toEqual([]);
  });

  it('statusarna läses tillbaka i menyns ordning', () => {
    expect(restoreListFilters(JSON.stringify({ statuses: ['cancelled', 'draft'] }), rules).statuses).toEqual(['draft', 'cancelled']);
  });

  it('inget sparat, trasig JSON eller fel form ger startvalet', () => {
    for (const raw of [null, '', '{', '"text"', '[1,2]', 'null', '42']) {
      expect(restoreListFilters(raw, rules)).toEqual(defaults);
    }
  });

  it('startvalet lämnas ut som kopior, så att listan inte kan ändra i det', () => {
    const restored = restoreListFilters(null, rules);
    expect(restored.statuses).not.toBe(defaults.statuses);
    expect(restored.assignee).not.toBe(defaults.assignee);
  });

  it('ett statusval med en okänd status förkastas helt i stället för att bli "Ingen status"', () => {
    // Gallrat hade ['omdopt'] blivit [] — en lista utan rader som ingen valt.
    expect(restoreListFilters(JSON.stringify({ statuses: ['omdopt'] }), rules).statuses).toEqual(defaults.statuses);
    expect(restoreListFilters(JSON.stringify({ statuses: ['invoiced', 'omdopt'] }), rules).statuses).toEqual(defaults.statuses);
  });

  it('en sökning som inte är text ger tom sökruta — listan anropar search.trim()', () => {
    expect(restoreListFilters(JSON.stringify({ search: 42 }), rules).search).toBe('');
  });

  it('en okänd sortering ger startvalets sortering', () => {
    expect(restoreListFilters(JSON.stringify({ sort: 'follow_up_asc' }), rules).sort).toBe('created_desc');
  });

  it('ett trasigt ansvarigval ger startvalet', () => {
    expect(restoreListFilters(JSON.stringify({ assignee: 'u1' }), rules).assignee).toEqual([MINE]);
    expect(restoreListFilters(JSON.stringify({ assignee: ['u1', 7] }), rules).assignee).toEqual([MINE]);
    expect(restoreListFilters(JSON.stringify({ assignee: [''] }), rules).assignee).toEqual([MINE]);
  });

  it('"Mina" följer inte med dit menyn saknar valet', () => {
    const noMine = { ...rules, defaults: { ...defaults, assignee: [] }, allowMine: false };
    expect(restoreListFilters(JSON.stringify({ assignee: [MINE, 'u1'] }), noMine).assignee).toEqual(['u1']);
  });

  it('varje fält läses för sig — ett trasigt fält tar inte med sig de andra', () => {
    const restored = restoreListFilters(JSON.stringify({ search: 'Lind', sort: 'okänd', statuses: ['invoiced'] }), rules);
    expect(restored).toEqual({ ...defaults, search: 'Lind', statuses: ['invoiced'] });
  });
});

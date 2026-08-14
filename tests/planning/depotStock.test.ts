import { describe, it, expect } from 'vitest';
import {
  attributePlannedDemand, computeDepotBalances,
  type PlannedDemandSegment, type StockRow,
} from '@/lib/domains/planning/depotStock';
import { materialShortFromLineItems, MATERIAL_SHORTS } from '@/lib/domains/crm/materials';

describe('computeDepotBalances', () => {
  const depots = [
    { id: 'd1', name: 'Huvudlager' },
    { id: 'd2', name: 'Syd' },
  ];

  it('nets deliveries against consumption per depot + material', () => {
    const delivered: StockRow[] = [
      { depot_id: 'd1', material: 'EKOVILLA', sacks: 100 },
      { depot_id: 'd1', material: 'EKOVILLA', sacks: 50 }, // two deliveries, same material
      { depot_id: 'd1', material: 'PAROC', sacks: 40 },
    ];
    const consumed: StockRow[] = [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 30 }];

    const d1 = computeDepotBalances(depots, delivered, consumed).find((d) => d.depot_id === 'd1')!;
    const eko = d1.rows.find((r) => r.material === 'EKOVILLA')!;
    expect(eko).toEqual({ material: 'EKOVILLA', delivered: 150, consumed: 30, balance: 120, planned: 0, shortfall: 0 });
    expect(d1.rows.find((r) => r.material === 'PAROC')!.balance).toBe(40);
    expect(d1.total_balance).toBe(160);
  });

  it('shows a material that has only consumption (negative balance)', () => {
    const d1 = computeDepotBalances(depots, [], [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 25 }]).find((d) => d.depot_id === 'd1')!;
    expect(d1.rows[0]).toEqual({ material: 'EKOVILLA', delivered: 0, consumed: 25, balance: -25, planned: 0, shortfall: 25 });
  });

  it('flags a shortfall when planned demand exceeds the balance', () => {
    const delivered: StockRow[] = [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 150 }];
    const planned: StockRow[] = [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 250 }];
    const eko = computeDepotBalances(depots, delivered, [], planned).find((d) => d.depot_id === 'd1')!.rows[0];
    expect(eko).toMatchObject({ material: 'EKOVILLA', balance: 150, planned: 250, shortfall: 100 });
  });

  it('no shortfall when the balance covers the planned demand', () => {
    const delivered: StockRow[] = [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 300 }];
    const planned: StockRow[] = [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 250 }];
    expect(computeDepotBalances(depots, delivered, [], planned)[0].rows[0].shortfall).toBe(0);
  });

  it('returns every depot, with empty rows when it has no movements', () => {
    const result = computeDepotBalances(depots, [{ depot_id: 'd1', material: 'PAROC', sacks: 10 }], []);
    expect(result.map((d) => d.depot_id)).toEqual(['d1', 'd2']);
    expect(result.find((d) => d.depot_id === 'd2')!.rows).toEqual([]);
    expect(result.find((d) => d.depot_id === 'd2')!.total_balance).toBe(0);
  });
});

describe('materialShortFromLineItems', () => {
  it('returns the short of the first recognised material', () => {
    const short = materialShortFromLineItems([{ article_name: 'Ekovilla Cellulosa Lösull' }]);
    expect(short).toBe('EKOVILLA');
    expect(MATERIAL_SHORTS).toContain(short);
  });
  it('returns null when no material is recognised', () => {
    expect(materialShortFromLineItems([{ article_name: 'Arbete' }])).toBeNull();
    expect(materialShortFromLineItems(null)).toBeNull();
  });
});

describe('attributePlannedDemand', () => {
  const seg = (over: Partial<PlannedDemandSegment> = {}): PlannedDemandSegment => ({
    work_order_id: 'wo1',
    depot_id: 'd1',
    status: 'scheduled',
    material: 'EKOVILLA',
    sacks: 40,
    ...over,
  });

  it('counts a work order once even when it spans several segments', () => {
    expect(attributePlannedDemand([seg(), seg(), seg()])).toEqual([
      { depot_id: 'd1', material: 'EKOVILLA', sacks: 40 },
    ]);
  });

  it('falls through to the next segment when the first truck has no depot', () => {
    // Regression: the work order used to be marked seen before the depot check, so a job whose
    // earliest segment sat on a depot-less truck vanished from planned demand entirely — taking
    // the shortfall warning with it.
    const rows = attributePlannedDemand([seg({ depot_id: null }), seg({ depot_id: 'd2' })]);
    expect(rows).toEqual([{ depot_id: 'd2', material: 'EKOVILLA', sacks: 40 }]);
  });

  it('still drops a work order that never resolves to a depot', () => {
    expect(attributePlannedDemand([seg({ depot_id: null }), seg({ depot_id: null })])).toEqual([]);
  });

  it('attributes to the first valid segment, so input order decides the depot', () => {
    const rows = attributePlannedDemand([seg({ depot_id: 'd2' }), seg({ depot_id: 'd1' })]);
    expect(rows).toEqual([{ depot_id: 'd2', material: 'EKOVILLA', sacks: 40 }]);
  });

  it('ignores closed work orders and rows with nothing to blow', () => {
    expect(attributePlannedDemand([seg({ status: 'completed' })])).toEqual([]);
    expect(attributePlannedDemand([seg({ status: null })])).toEqual([]);
    expect(attributePlannedDemand([seg({ sacks: 0 })])).toEqual([]);
    expect(attributePlannedDemand([seg({ material: null })])).toEqual([]);
    expect(attributePlannedDemand([seg({ work_order_id: null })])).toEqual([]);
  });

  it('keeps separate work orders apart', () => {
    const rows = attributePlannedDemand([seg(), seg({ work_order_id: 'wo2', depot_id: 'd2', sacks: 12 })]);
    expect(rows).toEqual([
      { depot_id: 'd1', material: 'EKOVILLA', sacks: 40 },
      { depot_id: 'd2', material: 'EKOVILLA', sacks: 12 },
    ]);
  });
});

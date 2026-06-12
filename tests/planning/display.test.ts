import { describe, it, expect } from 'vitest';
import { workOrderRef, materialLabelFromLineItems, mapWorkOrderJob } from '@/lib/domains/planning/display';

describe('workOrderRef', () => {
  it('leads with the Fortnox number when present', () => {
    expect(workOrderRef('5418', 'AO-20260611-A1B2')).toEqual({ ref: '#5418', isFortnox: true });
  });
  it('falls back to the internal order number when not synced', () => {
    expect(workOrderRef(null, 'AO-20260611-A1B2')).toEqual({ ref: 'AO-20260611-A1B2', isFortnox: false });
    expect(workOrderRef('  ', 'AO-1')).toEqual({ ref: 'AO-1', isFortnox: false });
  });
});

describe('materialLabelFromLineItems', () => {
  it('title-cases the recognised material brand', () => {
    expect(materialLabelFromLineItems([{ article_name: 'EKOVILLA cellulosa lösull' }])).toBe('Ekovilla');
  });
  it('returns null when no known material is present', () => {
    expect(materialLabelFromLineItems([{ article_name: 'Diverse' }])).toBeNull();
    expect(materialLabelFromLineItems(null)).toBeNull();
  });
});

describe('mapWorkOrderJob', () => {
  it('produces the shared card fields', () => {
    const job = mapWorkOrderJob({
      order_number: 'AO-1',
      fortnox_order_number: '5418',
      project_name: 'Vind',
      client_name: 'Bygg AB',
      status: 'in_progress',
      work_address: { street_address: 'Jobbvägen 1', city: 'Nacka' },
      customer_snapshot: { street_address: 'Kontoret 9', city: 'Sthlm' },
      line_items: [{ article_name: 'Ekovilla', m2: '10', thickness_mm: '200', density: '45', pricing_mode: 'm3' }],
    });
    expect(job).toMatchObject({
      ref: '#5418',
      is_fortnox_ref: true,
      project_name: 'Vind',
      client_name: 'Bygg AB',
      status: 'in_progress',
      address: 'Jobbvägen 1, Nacka',
      total_sacks: 7,
      material: 'Ekovilla',
    });
  });
});

import { describe, it, expect } from 'vitest';
import { mapWorkOrderToBacklogItem, resolveBacklogAddress } from '@/lib/domains/planning/backlog';

const baseRow = {
  id: '00000000-0000-0000-0000-000000000001',
  order_number: 'AO-1',
  fortnox_order_number: null as string | null,
  project_name: 'Vind Storgatan',
  client_name: 'Bygg AB',
  status: 'scheduled',
  desired_installation_date: '2026-06-20',
  work_address: null as Record<string, unknown> | null,
  customer_snapshot: null as Record<string, unknown> | null,
  line_items: [] as unknown[],
};

describe('resolveBacklogAddress', () => {
  it('prefers the separate work address', () => {
    expect(
      resolveBacklogAddress(
        { street_address: 'Jobbvägen 1', postal_code: '11122', city: 'Stockholm' },
        { street_address: 'Kontoret 9', city: 'Göteborg' },
      ),
    ).toBe('Jobbvägen 1, 11122, Stockholm');
  });

  it('falls back to a delivery address on the snapshot', () => {
    expect(
      resolveBacklogAddress(null, {
        delivery_address: 'Leveransgatan 2',
        delivery_city: 'Malmö',
        street_address: 'Kontoret 9',
      }),
    ).toBe('Leveransgatan 2, Malmö');
  });

  it('falls back to the customer card address', () => {
    expect(
      resolveBacklogAddress({}, { street_address: 'Kontoret 9', postal_code: '40010', city: 'Göteborg' }),
    ).toBe('Kontoret 9, 40010, Göteborg');
  });

  it('returns null when there is no address', () => {
    expect(resolveBacklogAddress(null, null)).toBeNull();
  });
});

describe('mapWorkOrderToBacklogItem', () => {
  it('computes total sacks from Ekovilla line items (m³ × density ÷ bag weight, rounded up)', () => {
    const row = {
      ...baseRow,
      // 10 m² × 200 mm = 2 m³; 2 × 45 / 14 (Ekovilla bag weight) = 6.43 → 7 säck
      line_items: [{ article_name: 'Ekovilla Cellulosa Lösull', m2: '10', thickness_mm: '200', density: '45', pricing_mode: 'm3' }],
    };
    const item = mapWorkOrderToBacklogItem(row, 0);
    expect(item.total_sacks).toBe(7);
    expect(item.material).toBe('Ekovilla');
  });

  it('leads with the internal order number when no Fortnox number yet', () => {
    const item = mapWorkOrderToBacklogItem(baseRow, 0);
    expect(item.ref).toBe('AO-1');
    expect(item.is_fortnox_ref).toBe(false);
    expect(item.material).toBeNull();
  });

  it('leads with the Fortnox order number once synced', () => {
    const item = mapWorkOrderToBacklogItem({ ...baseRow, fortnox_order_number: '5418' }, 0);
    expect(item.ref).toBe('#5418');
    expect(item.is_fortnox_ref).toBe(true);
  });

  it('passes through identity, date, contact and the segment count', () => {
    const item = mapWorkOrderToBacklogItem({ ...baseRow, customer_snapshot: { email: 'a@b.se', phone: '070-1234567' } }, 2);
    expect(item).toMatchObject({
      id: baseRow.id,
      project_name: 'Vind Storgatan',
      client_name: 'Bygg AB',
      status: 'scheduled',
      desired_installation_date: '2026-06-20',
      contact_email: 'a@b.se',
      contact_phone: '070-1234567',
      segment_count: 2,
    });
  });
});

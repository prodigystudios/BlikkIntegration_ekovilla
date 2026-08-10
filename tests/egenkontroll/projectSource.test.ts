import { describe, it, expect } from 'vitest';
import {
  mapCrmWorkOrderToEgenkontrollProject,
  mapBlikkProjectToEgenkontrollProject,
  etappRowsFromLineItems,
  type CrmWorkOrderLookupRow,
} from '@/lib/domains/egenkontroll/projectSource';

const crmRow = (over: Partial<CrmWorkOrderLookupRow> = {}): CrmWorkOrderLookupRow => ({
  id: 'wo-1',
  order_number: 'AO-20260810-A1B2',
  fortnox_order_number: '5418',
  project_name: 'Vindsisolering',
  client_name: 'Villa Ek',
  desired_installation_date: '2026-08-14',
  work_address: { street_address: 'Jobbvägen 1', postal_code: '131 30', city: 'Nacka' },
  customer_snapshot: { street_address: 'Kontoret 9', postal_code: '111 22', city: 'Stockholm' },
  internal_handoff: { work_scope: 'Vind + snedtak' },
  line_items: [],
  ...over,
});

describe('mapCrmWorkOrderToEgenkontrollProject', () => {
  it('normalises a work order into the shape the form reads', () => {
    expect(mapCrmWorkOrderToEgenkontrollProject(crmRow())).toEqual({
      source: 'crm',
      workOrderId: 'wo-1',
      blikkProjectId: null,
      orderNumber: '5418',
      customerName: 'Villa Ek',
      address: { streetAddress: 'Jobbvägen 1', postalCode: '131 30', city: 'Nacka' },
      installationDate: '2026-08-14',
      description: 'Vindsisolering — Vind + snedtak',
      lineItems: [],
    });
  });

  it('leads with the Fortnox number, falling back to the internal order number', () => {
    expect(mapCrmWorkOrderToEgenkontrollProject(crmRow({ fortnox_order_number: null })).orderNumber).toBe('AO-20260810-A1B2');
    expect(mapCrmWorkOrderToEgenkontrollProject(crmRow({ fortnox_order_number: '  ' })).orderNumber).toBe('AO-20260810-A1B2');
  });

  it('prefers the job-site address, then a delivery address, then the customer address', () => {
    expect(mapCrmWorkOrderToEgenkontrollProject(crmRow()).address.streetAddress).toBe('Jobbvägen 1');

    const delivery = mapCrmWorkOrderToEgenkontrollProject(
      crmRow({
        work_address: {},
        customer_snapshot: { delivery_address: 'Leveransgatan 3', delivery_postal_code: '120 00', delivery_city: 'Årsta', street_address: 'Kontoret 9' },
      }),
    );
    expect(delivery.address).toEqual({ streetAddress: 'Leveransgatan 3', postalCode: '120 00', city: 'Årsta' });

    const fallback = mapCrmWorkOrderToEgenkontrollProject(crmRow({ work_address: null }));
    expect(fallback.address.streetAddress).toBe('Kontoret 9');
  });

  it('trims a timestamp down to a plain day, and blanks an unusable date', () => {
    expect(mapCrmWorkOrderToEgenkontrollProject(crmRow({ desired_installation_date: '2026-08-14T09:00:00Z' })).installationDate).toBe('2026-08-14');
    expect(mapCrmWorkOrderToEgenkontrollProject(crmRow({ desired_installation_date: null })).installationDate).toBe('');
  });

  it('dates the egenkontroll from the SCHEDULED day, not the date the customer once asked for', () => {
    // desired_installation_date is written when the order is created and never follows the planner
    // moving the job. Signing a compliance document with a stale date is the failure to avoid.
    const rescheduled = mapCrmWorkOrderToEgenkontrollProject(
      crmRow({ desired_installation_date: '2026-08-14', scheduled_day: '2026-08-21' }),
    );
    expect(rescheduled.installationDate).toBe('2026-08-21');

    // Not yet placed on the calendar → fall back to the requested date rather than nothing.
    expect(mapCrmWorkOrderToEgenkontrollProject(crmRow({ scheduled_day: null })).installationDate).toBe('2026-08-14');
  });
});

describe('mapBlikkProjectToEgenkontrollProject', () => {
  it('normalises a legacy Blikk project into the same shape', () => {
    expect(
      mapBlikkProjectToEgenkontrollProject({
        id: 4711,
        orderNumber: '9001',
        customer: { name: 'Bygg AB' },
        workSiteAddress: { streetAddress: 'Byggvägen 5', postalCode: '100 00', city: 'Solna' },
        startDate: '2026-08-12T00:00:00Z',
        description: 'Vind - 120 m2 x 400 mm - 42 eko',
      }),
    ).toEqual({
      source: 'blikk',
      workOrderId: null,
      blikkProjectId: '4711',
      orderNumber: '9001',
      customerName: 'Bygg AB',
      address: { streetAddress: 'Byggvägen 5', postalCode: '100 00', city: 'Solna' },
      installationDate: '2026-08-12',
      description: 'Vind - 120 m2 x 400 mm - 42 eko',
      lineItems: null,
    });
  });

  it('falls back to the location field and the created date', () => {
    const p = mapBlikkProjectToEgenkontrollProject({
      id: 1,
      location: { streetAddress: 'Gata 1', postalCode: '111 11', city: 'Sthlm' },
      created: '2026-08-01T10:00:00Z',
    })!;
    expect(p.address.streetAddress).toBe('Gata 1');
    expect(p.installationDate).toBe('2026-08-01');
  });

  it('still maps a project that has no id — the legacy API returns those on purpose', () => {
    // /api/projects/lookup returns the list summary when the match has no id. The form has always
    // been fillable from that; only the Blikk comment is skipped. Rejecting it here would turn a
    // supported case into a hard "Ordern hittades inte".
    const summary = mapBlikkProjectToEgenkontrollProject({
      orderNumber: '9001',
      customer: { name: 'Bygg AB' },
      description: 'Vind - 120 m2 x 400 mm - 42 eko',
    });
    expect(summary).not.toBeNull();
    expect(summary!.blikkProjectId).toBeNull();
    expect(summary!.orderNumber).toBe('9001');
    expect(summary!.customerName).toBe('Bygg AB');
  });

  it('returns null only when there is no payload at all', () => {
    expect(mapBlikkProjectToEgenkontrollProject(null)).toBeNull();
    expect(mapBlikkProjectToEgenkontrollProject(undefined)).toBeNull();
  });
});

describe('etappRowsFromLineItems', () => {
  const vind = { construction: 'vind', m2: '120', thickness_mm: '400', density: '30', pricing_mode: 'm3', article_name: 'Ekovilla Cellulosa Lösull', line_note: 'Vind' };
  const vagg = { construction: 'vagg', m2: '40', thickness_mm: '200', density: '45', pricing_mode: 'm3', article_name: 'Ekovilla Cellulosa Lösull', line_note: 'Yttervägg' };

  it('splits attic rows (blown open) from closed cavities', () => {
    const { open, closed } = etappRowsFromLineItems([vind, vagg], '0.038');
    expect(open.map((r) => r.etapp)).toEqual(['Vind']);
    expect(closed.map((r) => r.etapp)).toEqual(['Yttervägg']);
  });

  it('carries area, ordered thickness and density straight across', () => {
    const { open } = etappRowsFromLineItems([vind], '0.038');
    expect(open[0]).toMatchObject({
      etapp: 'Vind',
      ytaM2: '120',
      bestalldTjocklek: '400',
      installeradDensitet: '30',
      lambdavarde: '0.038',
    });
    // Measured-on-site fields stay blank — they are what the installer fills in.
    expect(open[0].installeradTjocklek).toBe('');
    expect(open[0].sattningsprocent).toBe('');
  });

  it('computes the ordered sack count from the row geometry', () => {
    // 120 m² × 0.4 m = 48 m³ × 30 kg/m³ = 1440 kg ÷ 14 kg/säck = 103 (rounded up)
    expect(etappRowsFromLineItems([vind]).open[0].antalSack).toBe('103');
    // 40 m² × 0.2 m = 8 m³ × 45 = 360 kg ÷ 14 = 26 (rounded up)
    expect(etappRowsFromLineItems([vagg]).closed[0].antalSackKgPerSack).toBe('26');
  });

  it('leaves the sack count blank when the material is not a known lösull article', () => {
    const { closed } = etappRowsFromLineItems([{ ...vagg, article_name: 'Diverse material' }]);
    expect(closed[0].antalSackKgPerSack).toBe('');
  });

  it('skips rows that are articles rather than construction stages', () => {
    // Travel, equipment and the carved-out ROT labour row have no area/thickness.
    const rows = etappRowsFromLineItems([
      { construction: '', m2: '', thickness_mm: '', quantity: '1', pricing_mode: 'item', article_name: 'Arbetskostnad ROT' },
      { construction: 'vagg', m2: '40', thickness_mm: '', density: '45', article_name: 'Ekovilla' },
      vind,
    ]);
    expect(rows.open).toHaveLength(1);
    expect(rows.closed).toHaveLength(0);
  });

  it('falls back to a HUMAN construction label, then the article, when a row has no note', () => {
    // The egenkontroll is printed and handed to the customer — 'vagg' must never appear on it.
    expect(etappRowsFromLineItems([{ ...vind, line_note: '' }]).open[0].etapp).toBe('Vind');
    expect(etappRowsFromLineItems([{ ...vagg, line_note: '' }]).closed[0].etapp).toBe('Vägg');
    expect(etappRowsFromLineItems([{ ...vagg, line_note: '', construction: 'snedtak' }]).closed[0].etapp).toBe('Snedtak');
    expect(etappRowsFromLineItems([{ ...vind, line_note: '', construction: '' }]).closed[0].etapp).toBe('Ekovilla Cellulosa Lösull');
  });

  it('skips item-priced rows even when measurements linger on them', () => {
    // lineItemQuantity reads `quantity` for pricing_mode 'item', so a leftover m²/thickness would
    // otherwise produce a sack count computed from "1 m³" — an invented number on a signed document.
    const stale = { ...vind, pricing_mode: 'item', quantity: '1' };
    expect(etappRowsFromLineItems([stale])).toEqual({ open: [], closed: [] });
  });

  it('tolerates a missing or empty item list', () => {
    expect(etappRowsFromLineItems(null)).toEqual({ open: [], closed: [] });
    expect(etappRowsFromLineItems([])).toEqual({ open: [], closed: [] });
  });
});

import { describe, it, expect } from 'vitest';
import {
  RESOLVE_AFTER_MS,
  RETRY_WAIT_MS,
  addComposerRow,
  composerFromOrder,
  composerInvalidRows,
  composerLines,
  composerSuggestion,
  composerTotals,
  draftErrorKind,
  draftSnapshot,
  orderSection,
  palletNote,
  parseSacks,
  sendResponseUnclear,
  sendingPhase,
  stepByPallet,
  storedDraftSnapshot,
  suggestRequestedOn,
  supplierOverview,
  type ComposerDepot,
} from '@/lib/domains/planning/materialOrderComposer';
import type { DepotMaterialForecast } from '@/lib/domains/planning/depotForecast';
import type { MaterialSupplier } from '@/lib/domains/planning/materialSuppliers';
import type { OpsDepot } from '@/lib/domains/planning/types';

const TODAY = '2026-09-17';

const supplier = (over: Partial<MaterialSupplier> = {}): MaterialSupplier => ({
  id: 's-eko',
  name: 'Ekovilla Oy',
  email: 'fabrik@example.fi',
  contact_name: null,
  phone: null,
  materials: ['EKOVILLA'],
  lead_time_days: 7,
  note: null,
  active: true,
  order_email_language: 'sv',
  order_email_subject: null,
  order_email_body: null,
  ...over,
});

const depot = (id: string, over: Partial<OpsDepot> = {}): OpsDepot => ({ id, name: id.toUpperCase(), location: `Väg ${id}`, active: true, ...over });

const row = (over: Partial<DepotMaterialForecast>): DepotMaterialForecast => ({
  depot_id: 'd1',
  depot_name: 'D1',
  material: 'EKOVILLA',
  opening: 100,
  run_out_day: '2026-10-10',
  shortfall_at_run_out: 20,
  worst_deficit: 150,
  suggested_sacks: 162,
  suggested_pallets: 3,
  sacks_per_pallet: 54,
  suggested_date: '2026-10-03',
  supply_known: true,
  beyond_horizon: 0,
  overdue_inflow: 0,
  on_order: 0,
  next_arrival: null,
  arrivals: [],
  ...over,
});

describe('suggestRequestedOn', () => {
  it('dagen före depåns tidigaste run-out', () => {
    expect(suggestRequestedOn(['2026-10-20', '2026-10-10'], 7, TODAY)).toBe('2026-10-09');
  });

  it('aldrig tidigare än idag + ledtid — även om depån tar slut innan', () => {
    expect(suggestRequestedOn(['2026-09-20'], 7, TODAY)).toBe('2026-09-24');
  });

  it('utan run-out: så tidigt ledtiden medger; negativ ledtid räknas som 0', () => {
    expect(suggestRequestedOn([null], 7, TODAY)).toBe('2026-09-24');
    expect(suggestRequestedOn([], -3, TODAY)).toBe(TODAY);
  });
});

describe('composerSuggestion', () => {
  const eko = supplier();
  const depots = [depot('d1'), depot('d2')];

  it('förifyller förslaget när fabriken är ensam leverantör och inget är på väg', () => {
    const [g] = composerSuggestion({ supplier: eko, suppliers: [eko], forecastRows: [row({})], depots, today: TODAY });
    expect(g.rows[0]).toMatchObject({ material: 'EKOVILLA', sacks: '162', reason: 'suggested' });
    expect(g.requested_on).toBe('2026-10-09');
  });

  it('0 med skäl: redan på väg, försenat, eller flera leverantörer av materialet', () => {
    const other = supplier({ id: 's-två', name: 'Två' });
    const onOrder = composerSuggestion({ supplier: eko, suppliers: [eko], forecastRows: [row({ on_order: 54, next_arrival: '2026-10-01' })], depots, today: TODAY });
    expect(onOrder[0].rows[0]).toMatchObject({ sacks: '0', reason: 'on_order' });
    // Försenat väger tyngre än på väg: det är fabriken man ska ringa.
    const overdue = composerSuggestion({ supplier: eko, suppliers: [eko], forecastRows: [row({ on_order: 54, overdue_inflow: 54 })], depots, today: TODAY });
    expect(overdue[0].rows[0]).toMatchObject({ sacks: '0', reason: 'overdue' });
    const shared = composerSuggestion({ supplier: eko, suppliers: [eko, other], forecastRows: [row({})], depots, today: TODAY });
    expect(shared[0].rows[0]).toMatchObject({ sacks: '0', reason: 'shared_material' });
  });

  it('bara behov, bara fabrikens material, bara aktiva depåer — brådskande depå först', () => {
    const groups = composerSuggestion({
      supplier: eko,
      suppliers: [eko],
      forecastRows: [
        row({ depot_id: 'd1', run_out_day: '2026-11-01' }),
        row({ depot_id: 'd2', run_out_day: '2026-10-05' }),
        row({ depot_id: 'd1', material: 'PAROC', sacks_per_pallet: null }),
        row({ depot_id: 'd2', material: 'EKOVILLA', worst_deficit: 0 }),
        row({ depot_id: 'd3' }),
      ],
      depots: [...depots, depot('d3', { active: false })],
      today: TODAY,
    });
    expect(groups.map((g) => [g.depot_id, g.rows.map((r) => r.material)])).toEqual([
      ['d2', ['EKOVILLA']],
      ['d1', ['EKOVILLA']],
    ]);
  });
});

describe('composerFromOrder och addComposerRow', () => {
  const line = { depot_id: 'd1', depot_name: 'Gamla namnet', depot_location: 'Gamla vägen', material: 'EKOVILLA', sacks: 108, requested_on: '2026-10-01', sacks_per_pallet: 54 };

  it('ett sparat utkast får registrets aktuella namn och Plats, och prognosen för paret', () => {
    const [g] = composerFromOrder({ lines: [line] }, { forecastRows: [row({})], depots: [depot('d1', { name: 'Nytt', location: null })] });
    expect(g).toMatchObject({ depot_name: 'Nytt', location: null, requested_on: '2026-10-01' });
    expect(g.rows[0]).toMatchObject({ sacks: '108', reason: 'manual', sacks_per_pallet: 54 });
    expect(g.rows[0].forecast?.run_out_day).toBe('2026-10-10');
  });

  it('en raderad depå behåller det lagrade namnet', () => {
    expect(composerFromOrder({ lines: [line] }, { forecastRows: [], depots: [] })[0]).toMatchObject({ depot_name: 'Gamla namnet', location: 'Gamla vägen' });
  });

  it('lägger inte till ett par två gånger; en ny depå får ett eget datum', () => {
    const start: ComposerDepot[] = composerFromOrder({ lines: [line] }, { forecastRows: [], depots: [depot('d1')] });
    const ctx = { forecastRows: [row({ depot_id: 'd2', run_out_day: '2026-10-20' })], leadTimeDays: 7, today: TODAY };
    expect(addComposerRow(start, { depot: depot('d1'), material: 'EKOVILLA' }, ctx)).toBe(start);
    const added = addComposerRow(start, { depot: depot('d2'), material: 'EKOVILLA' }, ctx);
    expect(added[1]).toMatchObject({ depot_id: 'd2', requested_on: '2026-10-19' });
    expect(added[1].rows[0]).toMatchObject({ sacks: '0', reason: 'manual' });
  });
});

describe('säckfältet', () => {
  it('parseSacks: tomt = 0, bara heltal', () => {
    expect(parseSacks('')).toBe(0);
    expect(parseSacks(' 54 ')).toBe(54);
    expect(parseSacks('5,5')).toBeNull();
    expect(parseSacks('-54')).toBeNull();
  });

  it('stegar en pall — och från ett udda tal till närmaste hela pall åt det hållet', () => {
    expect(stepByPallet('0', 54, 1)).toBe('54');
    expect(stepByPallet('108', 54, 1)).toBe('162');
    expect(stepByPallet('108', 54, -1)).toBe('54');
    expect(stepByPallet('60', 54, 1)).toBe('108');
    expect(stepByPallet('60', 54, -1)).toBe('54');
    expect(stepByPallet('54', 54, -1)).toBe('0');
    expect(stepByPallet('0', 54, -1)).toBe('0');
  });

  it('palletNote', () => {
    expect(palletNote('216', 54)).toEqual({ kind: 'pallets', pallets: 4 });
    expect(palletNote('200', 54)).toEqual({ kind: 'not_whole', sacks_per_pallet: 54 });
    expect(palletNote('87', null)).toEqual({ kind: 'unknown' });
    expect(palletNote('', 54)).toEqual({ kind: 'none' });
    expect(palletNote('x', 54)).toEqual({ kind: 'invalid' });
  });
});

describe('raderna till Granska', () => {
  const depots: ComposerDepot[] = [
    {
      depot_id: 'd1',
      depot_name: 'D1',
      location: 'x',
      requested_on: '2026-10-01',
      rows: [
        { material: 'EKOVILLA', sacks: '108', sacks_per_pallet: 54, forecast: null, reason: 'manual' },
        { material: 'KNAUF SUPAFIL', sacks: '0', sacks_per_pallet: 24, forecast: null, reason: 'on_order' },
        { material: 'PAROC', sacks: '87', sacks_per_pallet: null, forecast: null, reason: 'manual' },
      ],
    },
  ];

  it('bara rader med säckar, med depåns datum', () => {
    expect(composerLines(depots)).toEqual([
      { depot_id: 'd1', material: 'EKOVILLA', sacks: 108, requested_on: '2026-10-01' },
      { depot_id: 'd1', material: 'PAROC', sacks: 87, requested_on: '2026-10-01' },
    ]);
  });

  it('totalen: pallarna blir okända när en rad saknar pallstorlek, inte tyst lägre', () => {
    expect(composerTotals(depots)).toEqual({ sacks: 195, pallets: null, lines: 2 });
    expect(composerTotals([{ ...depots[0], rows: depots[0].rows.slice(0, 2) }])).toEqual({ sacks: 108, pallets: 2, lines: 1 });
  });

  it('ogiltiga fält pekas ut', () => {
    expect(composerInvalidRows([{ ...depots[0], rows: [{ ...depots[0].rows[0], sacks: '1e3' }] }])).toEqual([{ depot_name: 'D1', material: 'EKOVILLA' }]);
  });

  it('ett orört utkast ser inte ändrat ut — raderna i annan ordning, tomma övrigt-rader och blanksteg i meddelandet', () => {
    const stored = storedDraftSnapshot({
      lines: [
        { depot_id: 'd1', depot_name: 'D1', depot_location: 'x', material: 'PAROC', sacks: 87, requested_on: '2026-10-01', sacks_per_pallet: null },
        { depot_id: 'd1', depot_name: 'D1', depot_location: 'x', material: 'EKOVILLA', sacks: 108, requested_on: '2026-10-01', sacks_per_pallet: 54 },
      ],
      other_lines: [{ text: 'Pallvagn', depot_id: null, depot_name: null }],
      message: 'Ring innan',
    });
    const local = draftSnapshot({ lines: composerLines(depots), other_lines: [{ text: ' Pallvagn ', depot_id: null }, { text: '', depot_id: 'd1' }], message: 'Ring innan  ' });
    expect(local).toBe(stored);
    expect(draftSnapshot({ lines: composerLines(depots), other_lines: [{ text: 'Pallvagn', depot_id: null }], message: 'Ring' })).not.toBe(stored);
  });
});

describe('supplierOverview', () => {
  const eko = supplier();
  const knauf = supplier({ id: 's-knauf', name: 'Knauf', materials: ['KNAUF SUPAFIL'] });
  const gammal = supplier({ id: 's-gammal', name: 'Avvecklad', active: false });

  it('aktiva leverantörer, de med behov först och tidigaste beställ-senast först; öppen order pekas ut', () => {
    const list = supplierOverview({
      suppliers: [knauf, eko, gammal],
      forecastRows: [
        row({ suggested_date: '2026-10-03' }),
        row({ depot_id: 'd2', suggested_date: '2026-09-30' }),
        row({ depot_id: 'd3', suggested_date: '2026-09-18' }),
      ],
      depots: [depot('d1'), depot('d2'), depot('d3', { active: false })],
      orders: [
        { id: 'o1', order_no: 14, supplier_id: 's-eko', status: 'draft' },
        { id: 'o0', order_no: 9, supplier_id: 's-knauf', status: 'sent' },
      ],
    });
    expect(list.map((s) => [s.supplier.id, s.needs, s.order_by, s.open_order?.order_no ?? null])).toEqual([
      ['s-eko', 2, '2026-09-30', 14],
      ['s-knauf', 0, null, null],
    ]);
  });

  it('inget beställ-senast när materialet har flera leverantörer', () => {
    const två = supplier({ id: 's-två', name: 'Två' });
    const [first] = supplierOverview({ suppliers: [eko, två], forecastRows: [row({})], depots: [depot('d1')], orders: [] });
    expect(first).toMatchObject({ needs: 1, order_by: null });
  });
});

describe('orderSection', () => {
  it('utkast och oklart utskick kräver åtgärd; väntar och delvis framme är på väg; resten historik', () => {
    expect(orderSection({ status: 'draft', delivery_state: null })).toBe('action');
    expect(orderSection({ status: 'sending', delivery_state: null })).toBe('action');
    expect(orderSection({ status: 'sent', delivery_state: 'waiting' })).toBe('on_the_way');
    expect(orderSection({ status: 'sent', delivery_state: 'partial' })).toBe('on_the_way');
    expect(orderSection({ status: 'sent', delivery_state: 'arrived' })).toBe('history');
    expect(orderSection({ status: 'sent', delivery_state: 'cancelled' })).toBe('history');
    expect(orderSection({ status: 'sent', delivery_state: 'none' })).toBe('history');
  });
});

describe('sendingPhase', () => {
  const started = Date.parse('2026-09-17T10:00:00Z');
  const iso = (ms: number) => new Date(ms).toISOString();

  it('väntar två minuter efter senaste försöket, räknat i sekunder uppåt', () => {
    const order = { attempt_started_at: iso(started), last_try_at: iso(started) };
    expect(sendingPhase(order, started + 1_000)).toEqual({ kind: 'wait', seconds: 119 });
    expect(sendingPhase(order, started + RETRY_WAIT_MS - 1)).toEqual({ kind: 'wait', seconds: 1 });
    expect(sendingPhase(order, started + RETRY_WAIT_MS)).toEqual({ kind: 'retry' });
  });

  it('klockan räknas från senaste försöket, inte från starten', () => {
    const order = { attempt_started_at: iso(started), last_try_at: iso(started + 600_000) };
    expect(sendingPhase(order, started + 600_000 + 30_000).kind).toBe('wait');
  });

  it('efter 23 h avgör en människa — exakt på gränsen också', () => {
    const order = { attempt_started_at: iso(started), last_try_at: iso(started) };
    expect(sendingPhase(order, started + RESOLVE_AFTER_MS - 1)).toEqual({ kind: 'retry' });
    expect(sendingPhase(order, started + RESOLVE_AFTER_MS)).toEqual({ kind: 'resolve' });
    expect(sendingPhase({ attempt_started_at: null, last_try_at: null }, started)).toEqual({ kind: 'resolve' });
  });
});

describe('draftErrorKind', () => {
  it('ett avslag från Resend är avvisat; ett oklart fel som står kvar efter "gick inte fram" är inte det', () => {
    expect(draftErrorKind({ send_error: 'Ogiltig adress', send_error_code: 'validation_error' })).toBe('rejected');
    expect(draftErrorKind({ send_error: 'Inget svar från Resend i tid', send_error_code: 'timeout' })).toBe('not_delivered');
    expect(draftErrorKind({ send_error: 'x', send_error_code: null })).toBe('not_delivered');
    expect(draftErrorKind({ send_error: null, send_error_code: 'validation_error' })).toBeNull();
  });
});

describe('sendResponseUnclear', () => {
  it('serverfel och oläsbara svar är oklara', () => {
    expect(sendResponseUnclear({ status: 500, ok: false, code: 'material_order_send_db_error' })).toBe(true);
    expect(sendResponseUnclear({ status: 504, ok: false, code: null })).toBe(true);
    expect(sendResponseUnclear({ status: 200, ok: false, code: null })).toBe(true);
  });

  it('ett besked med kod under 500 är klart, och 503 avstängt bevisar att inget påbörjades', () => {
    expect(sendResponseUnclear({ status: 409, ok: false, code: 'material_order_revision_changed' })).toBe(false);
    expect(sendResponseUnclear({ status: 422, ok: false, code: 'material_order_rejected' })).toBe(false);
    expect(sendResponseUnclear({ status: 503, ok: false, code: 'material_order_send_blocked' })).toBe(false);
  });
});

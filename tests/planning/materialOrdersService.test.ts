import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tjänstelagret för materialbeställningarnas utkast: Granska, Ändra och varningarna. Databaslagret är mockat;
// sammanställningen (composeOrder) och varningsreglerna är de riktiga.

vi.mock('@/lib/domains/planning/materialOrdersStore', () => ({
  insertDraft: vi.fn(),
  writeComposed: vi.fn(),
  deleteDraft: vi.fn(async () => ({ deleted: true, error: null })),
  findOpenOrderForSupplier: vi.fn(),
  getOrder: vi.fn(),
  listSentOrdersForSupplier: vi.fn(async () => ({ data: [], error: null })),
  expectedStatusesForOrders: vi.fn(async () => ({ data: new Map(), error: null })),
}));
vi.mock('@/lib/domains/planning/materialSuppliers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/planning/materialSuppliers')>();
  return { ...actual, getSupplier: vi.fn() };
});
vi.mock('@/lib/domains/planning/depots', () => ({ listAllDepots: vi.fn() }));
vi.mock('@/lib/domains/planning/depotStock', () => ({ getDepotStockWithForecast: vi.fn() }));

import {
  deleteDraft,
  expectedStatusesForOrders,
  findOpenOrderForSupplier,
  getOrder,
  insertDraft,
  listSentOrdersForSupplier,
  writeComposed,
} from '@/lib/domains/planning/materialOrdersStore';
import { getSupplier } from '@/lib/domains/planning/materialSuppliers';
import { listAllDepots } from '@/lib/domains/planning/depots';
import { getDepotStockWithForecast } from '@/lib/domains/planning/depotStock';
import { createDraft, updateDraft, warningsForOrder } from '@/lib/domains/planning/materialOrdersService';
import { composeOrder } from '@/lib/domains/planning/materialOrders';

const sb = { __client: 'session' } as never;
const TODAY = '2026-09-17';
const DEPOT = { id: 'd1', name: 'Sandviken Lager', location: 'Industrivägen 1', active: true };
const SUPPLIER = {
  id: 's1',
  name: 'Ekovilla Oy',
  email: 'fabrik@example.fi',
  contact_name: null,
  phone: null,
  materials: ['EKOVILLA'],
  lead_time_days: 7,
  note: null,
  active: true,
  order_email_language: 'sv' as const,
  order_email_subject: null,
  order_email_body: null,
};
const LINE = { depot_id: 'd1', material: 'EKOVILLA', sacks: 216, requested_on: '2026-10-01' };
const createInput = {
  supplierId: 's1',
  lines: [LINE],
  other_lines: [],
  message: null,
  actor: { id: 'u1', name: 'William' },
  today: TODAY,
  env: {},
};
const DRAFT = { id: 'o1', order_no: 14, revision: 1, status: 'draft', supplier_id: 's1' };

beforeEach(() => {
  vi.clearAllMocks();
  (getSupplier as any).mockResolvedValue({ data: SUPPLIER, error: null });
  (listAllDepots as any).mockResolvedValue({ data: [DEPOT], error: null });
  (insertDraft as any).mockResolvedValue({ data: DRAFT, error: null });
  (writeComposed as any).mockImplementation(async (_s: unknown, id: string, rev: number, composed: object) => ({ data: { ...DRAFT, ...composed, id, revision: rev + 1 }, error: null }));
  (getDepotStockWithForecast as any).mockResolvedValue({ data: [], forecast: { rows: [], excluded: [] }, error: null });
});

describe('createDraft', () => {
  it('skapar och skriver mailet med det riktiga ordernumret', async () => {
    const r = await createDraft(sb, createInput);
    expect(r.kind).toBe('created');
    const composed = (writeComposed as any).mock.calls[0][3];
    expect(composed.email_subject).toContain('#14');
    expect(composed.recipient_email).toBe('fabrik@example.fi');
  });

  it('ett ogiltigt underlag skriver ingenting — inget tomt utkast som spärrar fabriken', async () => {
    const r = await createDraft(sb, { ...createInput, lines: [{ ...LINE, requested_on: '2020-01-01' }] });
    expect(r.kind).toBe('invalid');
    expect(insertDraft).not.toHaveBeenCalled();
  });

  it('23505: den öppna ordern pekas ut', async () => {
    (insertDraft as any).mockResolvedValue({ data: null, error: { code: '23505', message: 'dup' } });
    (findOpenOrderForSupplier as any).mockResolvedValue({ data: { id: 'o-open', order_no: 12, status: 'draft' }, error: null });
    expect(await createDraft(sb, createInput)).toEqual({ kind: 'open_order_exists', order_id: 'o-open', order_no: 12, status: 'draft' });
  });

  it('ett annat insertfel är ett fel, inte en öppen order', async () => {
    (insertDraft as any).mockResolvedValue({ data: null, error: { code: '42501', message: 'rls' } });
    expect((await createDraft(sb, createInput)).kind).toBe('db_error');
    expect(findOpenOrderForSupplier).not.toHaveBeenCalled();
  });

  /** Ett tomt utkast hade spärrat fabriken ("en öppen order per leverantör") utan att gå att skicka. */
  it('faller andra steget slängs utkastet igen', async () => {
    (writeComposed as any).mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect((await createDraft(sb, createInput)).kind).toBe('db_error');
    expect(deleteDraft).toHaveBeenCalledWith(sb, 'o1');
  });
});

describe('updateDraft', () => {
  const stored = () => {
    const c = composeOrder({ supplier: SUPPLIER, depots: [DEPOT], lines: [LINE], other_lines: [], message: null, order_no: 14, composed_by_name: 'William', today: TODAY, env: {} });
    if (!c.ok) throw new Error('förutsättning');
    return { ...DRAFT, revision: 2, ...c.order };
  };
  const updateInput = { orderId: 'o1', revision: 2, lines: [LINE], other_lines: [], message: null, actorName: 'William', today: TODAY, env: {} };

  /** Granska igen utan ändring: databasen vägrar revision+1 utan innehåll — det hade blivit ett 500. */
  it('oförändrat: inget att skriva', async () => {
    (getOrder as any).mockResolvedValue({ data: stored(), error: null });
    const r = await updateDraft(sb, updateInput);
    expect(r.kind).toBe('updated');
    expect(writeComposed).not.toHaveBeenCalled();
  });

  it('ändrat: skrivs på revisionen läsaren såg', async () => {
    (getOrder as any).mockResolvedValue({ data: stored(), error: null });
    await updateDraft(sb, { ...updateInput, message: 'Ring innan' });
    expect(writeComposed).toHaveBeenCalledWith(sb, 'o1', 2, expect.objectContaining({ message: 'Ring innan' }));
  });

  it('fel revision, skickad order eller saknad order: ingen skrivning', async () => {
    (getOrder as any).mockResolvedValue({ data: { ...stored(), revision: 3 }, error: null });
    expect((await updateDraft(sb, updateInput)).kind).toBe('revision_changed');
    (getOrder as any).mockResolvedValue({ data: { ...stored(), status: 'sending' }, error: null });
    expect((await updateDraft(sb, updateInput)).kind).toBe('not_draft');
    (getOrder as any).mockResolvedValue({ data: null, error: null });
    expect((await updateDraft(sb, updateInput)).kind).toBe('not_found');
    expect(writeComposed).not.toHaveBeenCalled();
  });
});

describe('warningsForOrder', () => {
  const order = { id: 'o-ny', supplier_id: 's1', lines: [{ ...LINE, depot_name: 'Sandviken Lager', depot_location: 'x', sacks_per_pallet: 54 }] };
  const kinds = (w: { kind: string }[]) => w.map((x) => x.kind);

  it('en tidigare order till samma fabrik som väntar eller delvis kommit varnar — en framme eller den egna gör det inte', async () => {
    (listSentOrdersForSupplier as any).mockResolvedValue({
      data: [
        { id: 'o-väntar', order_no: 10 },
        { id: 'o-delvis', order_no: 11 },
        { id: 'o-framme', order_no: 12 },
        { id: 'o-ny', order_no: 13 },
      ],
      error: null,
    });
    (expectedStatusesForOrders as any).mockResolvedValue({
      data: new Map([
        ['o-väntar', [{ status: 'expected' }]],
        ['o-delvis', [{ status: 'arrived' }, { status: 'expected' }]],
        ['o-framme', [{ status: 'arrived' }]],
        ['o-ny', [{ status: 'expected' }]],
      ]),
      error: null,
    });
    const w = await warningsForOrder(sb, order, { lead_time_days: 7 }, TODAY);
    expect(w.filter((x) => x.kind === 'earlier_order_open').map((x) => (x as { order_no: number }).order_no)).toEqual([10, 11]);
    expect((listSentOrdersForSupplier as any).mock.calls[0][1]).toBe('s1');
  });

  /** Ett läsfel får inte se ut som "inga tidigare ordrar att varna om". */
  it('läsfel på tidigare ordrar blir en egen varning', async () => {
    (listSentOrdersForSupplier as any).mockResolvedValue({ data: [], error: { message: 'boom' } });
    expect(kinds(await warningsForOrder(sb, order, { lead_time_days: 7 }, TODAY))).toContain('earlier_orders_unknown');
    (listSentOrdersForSupplier as any).mockResolvedValue({ data: [{ id: 'o-x', order_no: 9 }], error: null });
    (expectedStatusesForOrders as any).mockResolvedValue({ data: new Map(), error: { message: 'boom' } });
    expect(kinds(await warningsForOrder(sb, order, { lead_time_days: 7 }, TODAY))).toContain('earlier_orders_unknown');
  });

  it('en prognos som kastar eller felar blir forecast_unavailable, inget hinder', async () => {
    (getDepotStockWithForecast as any).mockRejectedValue(new Error('boom'));
    expect(kinds(await warningsForOrder(sb, order, { lead_time_days: 7 }, TODAY))).toContain('forecast_unavailable');
    (getDepotStockWithForecast as any).mockResolvedValue({ data: [], forecast: null, error: { message: 'x' } });
    expect(kinds(await warningsForOrder(sb, order, { lead_time_days: 7 }, TODAY))).toContain('forecast_unavailable');
  });
});

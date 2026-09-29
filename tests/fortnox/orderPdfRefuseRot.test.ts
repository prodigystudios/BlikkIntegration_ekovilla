import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryAdmin } from '../portal/helpers/memoryAdmin';

/**
 * getFortnoxOrderPdf({ refuseRot: true }) (återförsäljarportalen, fas 7). Orderbekräftelsen på en ROT-order skriver ut
 * sökandens personnummer, och den ska aldrig till en butik. Provet görs på SAMMA läsning som renderingen använder
 * (requireOrderNumber → resolveOrderRotDetails, med offerten som reserv), före varje Fortnox-anrop. Utan valet ändras
 * ingenting för orderbekräftelsens andra vägar.
 */

const h = vi.hoisted(() => ({ admin: null as unknown, fortnoxGet: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => h.admin }));
vi.mock('@/lib/domains/fortnox/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/client')>();
  return { ...actual, fortnoxGet: h.fortnoxGet };
});

const { getFortnoxOrderPdf, OrderPdfRotRefusedError } = await import('@/lib/domains/fortnox/orders');
const { portalDocumentSources } = await import('@/lib/domains/portal/jobDocumentsStore');

const WO = 'wo-1';
function setup(workOrder: Record<string, unknown>, quote?: Record<string, unknown>) {
  const db = memoryAdmin({
    crm_work_orders: [{ id: WO, fortnox_order_number: '26', project_name: 'Rönnvägen 18', quote_id: null, customer_id: null, customer_snapshot: {}, ...workOrder }],
    crm_quotes: quote ? [{ id: 'quote-1', assigned_to: null, customer_snapshot: {}, ...quote }] : [],
  });
  h.admin = db.admin;
  return db;
}

beforeEach(() => {
  // Kommer anropet så långt som till Fortnox har spärren släppt igenom det.
  h.fortnoxGet.mockReset().mockRejectedValue(new Error('FORTNOX'));
});

describe('getFortnoxOrderPdf({ refuseRot })', () => {
  it('ROT på ordern: nej, före varje Fortnox-anrop', async () => {
    setup({ rot_details: { enabled: true } });
    await expect(getFortnoxOrderPdf(WO, { refuseRot: true })).rejects.toBeInstanceOf(OrderPdfRotRefusedError);
    expect(h.fortnoxGet).not.toHaveBeenCalled();
  });

  it('🧨 ROT via offerten (orderns egna tomma): nej, som renderingen ser det', async () => {
    setup({ rot_details: {}, quote_id: 'quote-1' }, { rot_details: { enabled: true } });
    await expect(getFortnoxOrderPdf(WO, { refuseRot: true })).rejects.toBeInstanceOf(OrderPdfRotRefusedError);
    expect(h.fortnoxGet).not.toHaveBeenCalled();
  });

  it('utan ROT går den vidare till renderingen', async () => {
    setup({ rot_details: {} });
    await expect(getFortnoxOrderPdf(WO, { refuseRot: true })).rejects.toThrow('FORTNOX');
    // Orderns egna uppgifter vinner över offertens.
    setup({ rot_details: { enabled: false }, quote_id: 'quote-1' }, { rot_details: { enabled: true } });
    await expect(getFortnoxOrderPdf(WO, { refuseRot: true })).rejects.toThrow('FORTNOX');
  });

  it('🧨 offerten går inte att läsa: stänger (500, görs om) i stället för att räkna det som "ingen ROT"', async () => {
    const db = setup({ rot_details: {}, quote_id: 'quote-1' }, { rot_details: { enabled: true } });
    db.failOn((c) => c.table === 'crm_quotes', { message: 'nere' });
    await expect(getFortnoxOrderPdf(WO, { refuseRot: true })).rejects.toMatchObject({ status: 500 });
    expect(h.fortnoxGet).not.toHaveBeenCalled();
    // Utan spärren är läsfelet som förut ("ingen offert") för orderbekräftelsens andra vägar.
    db.failOn((c) => c.table === 'crm_quotes', { message: 'nere' });
    await expect(getFortnoxOrderPdf(WO)).rejects.toThrow('FORTNOX');
  });

  it('utan valet: orderbekräftelsens andra vägar renderar ROT-ordrar som förut', async () => {
    setup({ rot_details: { enabled: true } });
    await expect(getFortnoxOrderPdf(WO)).rejects.toThrow('FORTNOX');
  });
});

describe('portalDocumentSources.renderOrderConfirmation', () => {
  it('ber alltid om refuseRot, och ett nej blir ett skäl som aldrig görs om', async () => {
    setup({ rot_details: { enabled: true } });
    const sources = portalDocumentSources(h.admin as never, {});
    expect(await sources.renderOrderConfirmation(WO)).toEqual({
      ok: false,
      permanent: true,
      error: 'Ordern har ROT påslagen. Orderbekräftelsen skickas inte till butiken.',
    });
    expect(h.fortnoxGet).not.toHaveBeenCalled();
  });

  it('Fortnox som inte svarar görs om; en order som saknas i Fortnox (409) görs inte om', async () => {
    setup({ rot_details: {} });
    const sources = portalDocumentSources(h.admin as never, {});
    expect(await sources.renderOrderConfirmation(WO)).toMatchObject({ ok: false, permanent: false });
    setup({ rot_details: {}, fortnox_order_number: null });
    expect(await sources.renderOrderConfirmation(WO)).toMatchObject({ ok: false, permanent: true });
  });
});

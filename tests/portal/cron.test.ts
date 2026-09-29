import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ett varv av portalens bakgrundsarbete (fas 4b): omräkning → meddelandena (fas 6) → utskick → (om något levererades)
// omräkning + utskick → dokumenten (fas 7), och ett utskick till om de köade något → butiksbeställningarnas notiser
// (fas 8), inom dokumentens startgräns → Fortnox-försöken sist, bara inom tidsgränsen. Ett steg som kastar stoppar inte
// nästa.

const calls: string[] = [];
const sync = vi.fn();
const dispatch = vi.fn();
const retry = vi.fn();
const sweep = vi.fn();
const documents = vi.fn();

vi.mock('@/lib/domains/portal/jobSync', () => ({ syncPortalJobs: (...a: unknown[]) => (calls.push('sync'), sync(...a)) }));
vi.mock('@/lib/domains/portal/outbox', () => ({ dispatchPortalOutbox: (...a: unknown[]) => (calls.push('dispatch'), dispatch(...a)) }));
vi.mock('@/lib/domains/portal/jobFortnoxRetry', () => ({ retryPortalFortnox: (...a: unknown[]) => (calls.push('fortnox'), retry(...a)) }));
vi.mock('@/lib/domains/portal/jobIntakeStore', () => ({ followUpPortalJob: vi.fn() }));
vi.mock('@/lib/domains/portal/jobMessagesStore', () => ({
  sweepPortalJobMessages: (...a: unknown[]) => (calls.push('messages'), sweep(...a)),
}));
const storeOrderNotices = vi.fn();
vi.mock('@/lib/domains/portal/storeOrdersStore', () => ({
  sweepStoreOrderNotices: (...a: unknown[]) => (calls.push('store-orders'), storeOrderNotices(...a)),
}));
const storeOrderFortnox = vi.fn();
vi.mock('@/lib/domains/portal/storeOrderActions', () => ({
  retryStoreOrderFortnox: (...a: unknown[]) => (calls.push('store-order-fortnox'), storeOrderFortnox(...a)),
  storeOrderFortnoxDeps: () => ({ real: true }),
}));
vi.mock('@/lib/domains/portal/jobDocumentsStore', () => ({
  sweepPortalJobDocuments: (...a: unknown[]) => (calls.push('documents'), documents(...a)),
  portalDocumentSources: () => ({ real: true }),
}));

const {
  runPortalCron,
  PORTAL_CRON_FORTNOX_START_BEFORE_MS,
  PORTAL_CRON_DOCUMENTS_START_BEFORE_MS,
  PORTAL_CRON_DOCUMENTS_DISPATCH_BUDGET_MS,
  PORTAL_CLICK_DOCUMENTS_START_BEFORE_MS,
  PORTAL_CLICK_STORE_ORDER_NOTICES_BUDGET_MS,
} = await import('@/lib/domains/portal/cron');

const SYNC = { jobs: 1, queued: 1, unchanged: 0, conflicts: 0, errors: 0 };
const SENT = { ran: true, claimed: 1, sent: 1, retried: 0, dead: 0, returned: 0, bookkeepingErrors: 0 };
const NOTHING = { ...SENT, claimed: 0, sent: 0 };
const RETRY = { due: 0, attempted: 0, gaveUp: 0, skipped: 0, errors: 0 };
const SWEEP = { queued: 1, notified: 0, errors: 0 };
const STORE_ORDER_NOTICES = { candidates: 1, sent: 1, failed: 0, noRecipient: 0, errors: 0, deferred: 0 };
const NO_DOCUMENTS = { created: 0, queued: 0, failed: 0, retried: 0, errors: 0 };
const QUEUED_DOCUMENT = { ...NO_DOCUMENTS, created: 1, queued: 1 };

beforeEach(() => {
  calls.length = 0;
  sync.mockReset().mockResolvedValue(SYNC);
  dispatch.mockReset().mockResolvedValue(SENT);
  retry.mockReset().mockResolvedValue(RETRY);
  sweep.mockReset().mockResolvedValue(SWEEP);
  storeOrderNotices.mockReset().mockResolvedValue(STORE_ORDER_NOTICES);
  documents.mockReset().mockResolvedValue(NO_DOCUMENTS);
  storeOrderFortnox.mockReset().mockResolvedValue(RETRY);
});

describe('runPortalCron', () => {
  it('levererades något: omräkning och utskick en gång till, Fortnox sist', async () => {
    const summary = await runPortalCron({} as never, { env: {} });
    expect(calls).toEqual(['sync', 'messages', 'dispatch', 'sync', 'dispatch', 'documents', 'store-orders', 'store-order-fortnox', 'fortnox']);
    expect(summary).toMatchObject({
      sync: SYNC,
      messages: SWEEP,
      storeOrderNotices: STORE_ORDER_NOTICES,
      dispatch: SENT,
      resync: SYNC,
      redispatch: SENT,
      documents: NO_DOCUMENTS,
      fortnox: RETRY,
    });
    expect(summary.documentsDispatch).toBeUndefined();
  });

  it('inget levererat: ingen extra runda', async () => {
    dispatch.mockResolvedValue(NOTHING);
    await runPortalCron({} as never, { env: {} });
    expect(calls).toEqual(['sync', 'messages', 'dispatch', 'documents', 'store-orders', 'store-order-fortnox', 'fortnox']);
  });

  it('integrationen av: omräkningen och Fortnox görs ändå, kön ligger kvar', async () => {
    dispatch.mockResolvedValue({ ran: false, reason: 'av' });
    const summary = await runPortalCron({} as never, { env: {} });
    expect(calls).toEqual(['sync', 'messages', 'dispatch', 'documents', 'store-orders', 'store-order-fortnox', 'fortnox']);
    expect(summary.dispatch).toEqual({ ran: false, reason: 'av' });
  });

  it('ett steg som kastar stoppar inte nästa', async () => {
    sync.mockRejectedValue(new Error('databasen svarar inte'));
    const summary = await runPortalCron({} as never, { env: {} });
    expect(summary.sync).toEqual({ error: 'databasen svarar inte' });
    expect(calls).toContain('dispatch');
    expect(calls).toContain('fortnox');
  });

  it('meddelandena städas med samma klocka, före utskicket (ett glömt svar skickas i samma varv); ett fel där stoppar inget', async () => {
    const now = () => new Date('2026-10-12T08:30:00.000Z');
    await runPortalCron({ admin: true } as never, { env: {}, now });
    expect(sweep.mock.calls[0][0]).toEqual({ admin: true });
    expect(sweep.mock.calls[0][1].now).toBe(now);
    sweep.mockRejectedValue(new Error('meddelandena svarar inte'));
    calls.length = 0;
    const summary = await runPortalCron({} as never, { env: {} });
    expect(summary.messages).toEqual({ error: 'meddelandena svarar inte' });
    expect(calls).toEqual(['sync', 'messages', 'dispatch', 'sync', 'dispatch', 'documents', 'store-orders', 'store-order-fortnox', 'fortnox']);
  });

  it('butiksbeställningarnas notiser görs om med samma klocka, efter dokumenten; ett fel där stoppar inget', async () => {
    const now = () => new Date('2026-10-12T08:30:00.000Z');
    await runPortalCron({ admin: true } as never, { env: {}, now });
    expect(storeOrderNotices.mock.calls[0][0]).toEqual({ admin: true });
    expect(storeOrderNotices.mock.calls[0][1].now).toBe(now);
    // Cron har notisernas egen budget; knapparna på portalsidan en kortare.
    expect(storeOrderNotices.mock.calls[0][1].budgetMs).toBeUndefined();
    await runPortalCron({} as never, { env: {}, fortnoxRetries: false });
    expect(storeOrderNotices.mock.calls[1][1].budgetMs).toBe(PORTAL_CLICK_STORE_ORDER_NOTICES_BUDGET_MS);
    storeOrderNotices.mockRejectedValue(new Error('beställningarna svarar inte'));
    calls.length = 0;
    const summary = await runPortalCron({} as never, { env: {} });
    expect(summary.storeOrderNotices).toEqual({ error: 'beställningarna svarar inte' });
    expect(calls).toEqual(['sync', 'messages', 'dispatch', 'sync', 'dispatch', 'documents', 'store-orders', 'store-order-fortnox', 'fortnox']);
  });

  it('knapparna på portalsidan (fortnoxRetries: false): inga Fortnox-försök', async () => {
    await runPortalCron({} as never, { env: {}, fortnoxRetries: false });
    // Dokumenten görs ändå: testmiljön har ingen cron, och "Skicka väntande nu" är enda vägen dit.
    expect(calls).toEqual(['sync', 'messages', 'dispatch', 'sync', 'dispatch', 'documents', 'store-orders']);
  });

  it('Fortnox-försöken får resten av tidsgränsen, och inga när den är slut', async () => {
    let t = 0;
    dispatch.mockImplementation(async () => {
      t += 10_000;
      return NOTHING;
    });
    await runPortalCron({} as never, { env: {}, now: () => new Date(t) });
    expect(retry.mock.calls[0][1].budgetMs).toBe(PORTAL_CRON_FORTNOX_START_BEFORE_MS - 10_000);

    calls.length = 0;
    dispatch.mockImplementation(async () => {
      t += PORTAL_CRON_FORTNOX_START_BEFORE_MS;
      return NOTHING;
    });
    await runPortalCron({} as never, { env: {}, now: () => new Date(t) });
    expect(calls).toEqual(['sync', 'messages', 'dispatch']);
  });

  it('butiksbeställningarnas Fortnox-försök före jobbens, ett per varv, med samma klocka och resten av gränsen', async () => {
    let t = 0;
    const now = () => new Date(t);
    dispatch.mockImplementation(async () => {
      t += 10_000;
      return NOTHING;
    });
    storeOrderFortnox.mockImplementation(async () => {
      t += 30_000;
      return RETRY;
    });
    const summary = await runPortalCron({ admin: true } as never, { env: {}, now });
    const [admin, options] = storeOrderFortnox.mock.calls[0];
    expect(admin).toEqual({ admin: true });
    expect(options).toMatchObject({ limit: 1, budgetMs: PORTAL_CRON_FORTNOX_START_BEFORE_MS - 10_000 });
    expect(options.deps.now).toBe(now);
    expect(summary.storeOrderFortnox).toEqual(RETRY);
    // Jobben får det som är kvar efter beställningarna.
    expect(retry.mock.calls[0][1].budgetMs).toBe(PORTAL_CRON_FORTNOX_START_BEFORE_MS - 40_000);
    expect(calls.slice(-2)).toEqual(['store-order-fortnox', 'fortnox']);
  });

  it('butiksbeställningarnas Fortnox-försök: aldrig från knapparna, och ett fel där stoppar inget', async () => {
    await runPortalCron({} as never, { env: {}, fortnoxRetries: false });
    expect(calls).not.toContain('store-order-fortnox');
    storeOrderFortnox.mockRejectedValueOnce(new Error('nere'));
    const summary = await runPortalCron({} as never, { env: {} });
    expect(summary.storeOrderFortnox).toEqual({ error: 'nere' });
    expect(summary.fortnox).toEqual(RETRY);
  });

  it('dokumenten köade något: ett utskick till, med kortare budget, före Fortnox', async () => {
    dispatch.mockResolvedValue(NOTHING);
    documents.mockResolvedValue(QUEUED_DOCUMENT);
    const now = () => new Date('2026-10-12T08:30:00.000Z');
    const summary = await runPortalCron({ admin: true } as never, { env: { A: '1' }, now });
    expect(calls).toEqual(['sync', 'messages', 'dispatch', 'documents', 'dispatch', 'store-orders', 'store-order-fortnox', 'fortnox']);
    expect(summary.documents).toEqual(QUEUED_DOCUMENT);
    expect(dispatch.mock.calls[1][1]).toMatchObject({ env: { A: '1' }, now, budgetMs: PORTAL_CRON_DOCUMENTS_DISPATCH_BUDGET_MS });
    // Samma klocka och de riktiga källorna (Fortnox, arkivet), om testet inte ger egna.
    expect(documents.mock.calls[0][0]).toEqual({ admin: true });
    expect(documents.mock.calls[0][1]).toMatchObject({ now, sources: { real: true } });
  });

  it('dokumenten får egna källor, och ett fel där stoppar inte Fortnox', async () => {
    const own = { renderOrderConfirmation: vi.fn(), readArchive: vi.fn() };
    documents.mockRejectedValue(new Error('arkivet svarar inte'));
    const summary = await runPortalCron({} as never, { env: {}, documentSources: own });
    expect(documents.mock.calls[0][1].sources).toBe(own);
    expect(summary.documents).toEqual({ error: 'arkivet svarar inte' });
    expect(calls.at(-1)).toBe('fortnox');
  });

  it('knapparna på portalsidan (180 s): dokumenten bara om varvet hunnit lite', async () => {
    let t = 0;
    dispatch.mockImplementation(async () => {
      t += PORTAL_CLICK_DOCUMENTS_START_BEFORE_MS / 2 - 1;
      return SENT;
    });
    await runPortalCron({} as never, { env: {}, now: () => new Date(t), fortnoxRetries: false });
    expect(calls).toEqual(['sync', 'messages', 'dispatch', 'sync', 'dispatch', 'documents', 'store-orders']);
    // Ett bygge per klick; cron bygger så många som standarden säger.
    expect(documents.mock.calls.at(-1)?.[1].builds).toBe(1);

    calls.length = 0;
    t = 0;
    dispatch.mockImplementation(async () => {
      t += PORTAL_CLICK_DOCUMENTS_START_BEFORE_MS / 2;
      return SENT;
    });
    await runPortalCron({} as never, { env: {}, now: () => new Date(t), fortnoxRetries: false });
    expect(calls).toEqual(['sync', 'messages', 'dispatch', 'sync', 'dispatch']);

    // Cron (300 s) har kvar sin gräns.
    calls.length = 0;
    t = 0;
    await runPortalCron({} as never, { env: {}, now: () => new Date(t) });
    expect(calls).toContain('documents');
    expect(documents.mock.calls.at(-1)?.[1].builds).toBeUndefined();
  });

  it('inga dokument när tiden gått: tre orderbekräftelser är nio Fortnox-anrop', async () => {
    let t = 0;
    dispatch.mockImplementation(async () => {
      t += PORTAL_CRON_DOCUMENTS_START_BEFORE_MS;
      return NOTHING;
    });
    const summary = await runPortalCron({} as never, { env: {}, now: () => new Date(t) });
    expect(calls).toEqual(['sync', 'messages', 'dispatch']);
    expect(summary.documents).toEqual(NO_DOCUMENTS);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NotificationInsert } from '@/lib/domains/notifications/types';
import { memoryAdmin } from './helpers/memoryAdmin';

// Meddelandena mot databasen (fas 6). Sessionen och service-rollen är samma minnesklient här; vem som får läsa och
// svara prövas mot en riktig databas i supabase/checks/portal_job_messages.sql. Det som skyddas:
//   - intaget: kantfallen (William 2026-09-28), en rad per messageId, och en krock som inte sväljs;
//   - notisen: till den som har ordern NU, annars reserven, en gång, och ett nytt försök när den föll;
//   - svaret: i eget namn, köat med kroppen ur den sparade raden, skickat direkt, och sparat också när kön inte svarar;
//   - kortet och cron.

const h = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock('@/lib/domains/portal/outbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/domains/portal/outbox')>()),
  dispatchPortalOutbox: h.dispatch,
}));

const { listPortalJobMessages, notifyPortalJobMessage, receivePortalJobMessage, sendPortalJobReply, sweepPortalJobMessages, PORTAL_JOB_MESSAGES_LIMIT } =
  await import('@/lib/domains/portal/jobMessagesStore');

const NOW = new Date('2026-10-12T08:30:00.000Z');
const WO = 'wo-1';
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

let ids = 0;
// Det databasen fyller i. sent_at i databasens egen form (mikrosekunder, +00:00).
const defaults = (table: string): Record<string, unknown> =>
  table === 'crm_portal_job_messages'
    ? { id: `m-${++ids}`, department: '', sent_at: '2026-10-12T08:30:00.123456+00:00', created_at: NOW.toISOString(), queued_at: null, notified_at: null }
    : {};

const job = (over: Record<string, unknown> = {}) => ({
  quote_id: 'q-1',
  store_name: 'K-Bygg Sandviken',
  assigned_to: 'u-seller',
  work_order_id: WO,
  work_order_created_at: '2026-10-01T10:00:00.000Z',
  ...over,
});
const workOrder = (over: Record<string, unknown> = {}) => ({ id: WO, assigned_to: 'u-seller', status: 'scheduled', ...over });

function db(initial: Record<string, Record<string, unknown>[]> = {}) {
  return memoryAdmin(
    {
      crm_portal_jobs: [job()],
      crm_work_orders: [workOrder()],
      crm_portal_settings: [{ id: true, fallback_user_id: 'u-reserve' }],
      ...initial,
    },
    { defaults },
  );
}

const MSG = {
  messageId: 'b9c1e0d2-3f4a-4b5c-8d6e-7f8091a2b3c4',
  authorName: 'Sara Ek',
  body: 'Hej från Gävle – vindsluckan sitter ute.',
  sentAt: '2026-09-27T12:00:00Z',
};

const fromStore = (over: Record<string, unknown> = {}) => ({
  id: 'm-in',
  quote_id: 'q-1',
  direction: 'from_store',
  message_id: MSG.messageId,
  author_name: 'Sara Ek',
  author_user_id: null,
  department: '',
  body: 'Hej från Gävle',
  sent_at: '2026-09-27T12:00:00+00:00',
  created_at: ago(5),
  queued_at: null,
  notified_at: null,
  ...over,
});

const REPLY_ID = 'c0ffee00-1111-4222-8333-444455556666';
const toStore = (over: Record<string, unknown> = {}) => ({
  id: 'm-out',
  quote_id: 'q-1',
  direction: 'to_store',
  message_id: REPLY_ID,
  author_name: 'Anna Berg',
  author_user_id: 'u-seller',
  department: 'Planering',
  body: 'Vi kommer tisdag.',
  sent_at: '2026-10-12T08:20:00.5+00:00',
  created_at: ago(10),
  queued_at: null,
  notified_at: null,
  ...over,
});

beforeEach(() => {
  ids = 0;
  h.dispatch.mockReset().mockResolvedValue({ ran: false, reason: 'av' });
});

// ------------------------------------------------------------------------------------------------------------ intaget

describe('receivePortalJobMessage', () => {
  it('okänt jobb: unknown_job, ingenting sparas', async () => {
    const { admin, tables } = db();
    expect(await receivePortalJobMessage(admin, 'q-okand', MSG)).toEqual({ kind: 'unknown_job' });
    expect(tables.crm_portal_job_messages ?? []).toHaveLength(0);
  });

  it('jobbet tas emot just nu (ingen arbetsorder än): not_ready; arbetsordern borttagen: work_order_removed', async () => {
    const notYet = db({ crm_portal_jobs: [job({ work_order_id: null, work_order_created_at: null })] });
    expect(await receivePortalJobMessage(notYet.admin, 'q-1', MSG)).toEqual({ kind: 'not_ready' });
    const removed = db({ crm_portal_jobs: [job({ work_order_id: null })] });
    expect(await receivePortalJobMessage(removed.admin, 'q-1', MSG)).toEqual({ kind: 'work_order_removed' });
    expect([...(notYet.tables.crm_portal_job_messages ?? []), ...(removed.tables.crm_portal_job_messages ?? [])]).toHaveLength(0);
  });

  it('sparas som butikens: riktning, id, namn, text, tiden i UTC; ingen avdelning och ingen svarare', async () => {
    const { admin, tables } = db();
    expect(await receivePortalJobMessage(admin, 'q-1', MSG)).toEqual({ kind: 'created', id: 'm-1' });
    expect(tables.crm_portal_job_messages).toHaveLength(1);
    expect(tables.crm_portal_job_messages[0]).toMatchObject({
      quote_id: 'q-1',
      direction: 'from_store',
      message_id: MSG.messageId,
      author_name: 'Sara Ek',
      body: MSG.body,
      sent_at: '2026-09-27T12:00:00.000Z',
      department: '',
    });
    expect(tables.crm_portal_job_messages[0].author_user_id ?? null).toBeNull();
  });

  it('en avbruten (eller utförd) order tar emot som vanligt', async () => {
    const { admin } = db({ crm_work_orders: [workOrder({ status: 'cancelled' })] });
    expect((await receivePortalJobMessage(admin, 'q-1', MSG)).kind).toBe('created');
  });

  it('samma messageId igen, med samma innehåll: existing med samma rad, ingen ny (också när databasen skriver tiden +00:00)', async () => {
    const { admin, tables } = db();
    await receivePortalJobMessage(admin, 'q-1', MSG);
    tables.crm_portal_job_messages[0].sent_at = '2026-09-27T12:00:00+00:00';
    expect(await receivePortalJobMessage(admin, 'q-1', MSG)).toEqual({ kind: 'existing', id: 'm-1' });
    expect(tables.crm_portal_job_messages).toHaveLength(1);
  });

  it('samma messageId med en annan text, ett annat namn, en annan tid eller ett annat jobb: conflict, raden orörd', async () => {
    const { admin, tables } = db({ crm_portal_jobs: [job(), job({ quote_id: 'q-2', work_order_id: 'wo-2', reserved_work_order_id: 'wo-2' })] });
    await receivePortalJobMessage(admin, 'q-1', MSG);
    for (const [quoteId, changed] of [
      ['q-1', { ...MSG, body: 'Något annat.' }],
      ['q-1', { ...MSG, authorName: 'Någon annan' }],
      ['q-1', { ...MSG, sentAt: '2026-09-27T12:00:01Z' }],
      ['q-2', MSG],
    ] as const) {
      expect(await receivePortalJobMessage(admin, quoteId, changed)).toEqual({ kind: 'conflict' });
    }
    expect(tables.crm_portal_job_messages).toHaveLength(1);
    expect(tables.crm_portal_job_messages[0].body).toBe(MSG.body);
  });

  it('samma id som ett av våra svar krockar inte: en nyckel per riktning', async () => {
    const { admin, tables } = db({ crm_portal_job_messages: [toStore({ message_id: MSG.messageId })] });
    expect((await receivePortalJobMessage(admin, 'q-1', MSG)).kind).toBe('created');
    expect(tables.crm_portal_job_messages).toHaveLength(2);
  });

  it('databasen nekar texten (en check): invalid, inget kast som hade blivit 500 och omförsök i två dygn', async () => {
    const { admin, failOn } = db();
    failOn((c) => c.table === 'crm_portal_job_messages' && c.op === 'upsert', { code: '23514', message: 'check' });
    expect(await receivePortalJobMessage(admin, 'q-1', MSG)).toEqual({ kind: 'invalid' });
  });
});

// ------------------------------------------------------------------------------------------------------------ notisen

function notifying(initial: Record<string, Record<string, unknown>[]> = {}) {
  const d = db({ crm_portal_job_messages: [fromStore()], ...initial });
  const sent: NotificationInsert[] = [];
  const deps = { notify: vi.fn(async (rows: NotificationInsert[]) => void sent.push(...rows)), now: () => NOW };
  return { ...d, sent, deps };
}

describe('notifyPortalJobMessage', () => {
  it('till arbetsorderns ansvarige, med butiken, namnet och början av texten, en gång', async () => {
    const { admin, tables, sent, deps } = notifying();
    expect(await notifyPortalJobMessage(admin, 'm-in', deps)).toBe('sent');
    expect(sent).toEqual([
      {
        recipient_user_id: 'u-seller',
        type: 'portal_job.message',
        title: 'Meddelande från K-Bygg Sandviken',
        body: 'Sara Ek: Hej från Gävle',
        href: '/crm/arbetsorder/wo-1',
        entity_type: 'work_order',
        entity_id: 'wo-1',
      },
    ]);
    expect(tables.crm_portal_job_messages[0].notified_at).toBe(NOW.toISOString());
    expect(await notifyPortalJobMessage(admin, 'm-in', deps)).toBe('already_sent');
    expect(sent).toHaveLength(1);
  });

  it('den som har ordern NU, inte den som fick jobbet', async () => {
    const { admin, sent, deps } = notifying({ crm_portal_jobs: [job({ assigned_to: 'u-gammal' })], crm_work_orders: [workOrder({ assigned_to: 'u-ny' })] });
    await notifyPortalJobMessage(admin, 'm-in', deps);
    expect(sent.map((n) => n.recipient_user_id)).toEqual(['u-ny']);
  });

  it('ordern saknar ansvarig: reserven', async () => {
    const { admin, sent, deps } = notifying({ crm_work_orders: [workOrder({ assigned_to: null })] });
    expect(await notifyPortalJobMessage(admin, 'm-in', deps)).toBe('sent');
    expect(sent.map((n) => n.recipient_user_id)).toEqual(['u-reserve']);
  });

  it('ingen ansvarig och ingen reserv: no_recipient, ingen notis', async () => {
    const { admin, sent, deps } = notifying({
      crm_work_orders: [workOrder({ assigned_to: null })],
      crm_portal_settings: [{ id: true, fallback_user_id: null }],
    });
    expect(await notifyPortalJobMessage(admin, 'm-in', deps)).toBe('no_recipient');
    expect(sent).toHaveLength(0);
  });

  it('ordern borttagen efter att meddelandet kom: no_work_order, ingen notis', async () => {
    const { admin, sent, deps } = notifying({ crm_portal_jobs: [job({ work_order_id: null })] });
    expect(await notifyPortalJobMessage(admin, 'm-in', deps)).toBe('no_work_order');
    expect(sent).toHaveLength(0);
  });

  it('utskicket faller: markeringen släpps och felet kastas; nästa försök skickar', async () => {
    const { admin, tables, sent, deps } = notifying();
    deps.notify.mockRejectedValueOnce(new Error('push nere'));
    await expect(notifyPortalJobMessage(admin, 'm-in', deps)).rejects.toThrow('push nere');
    expect(tables.crm_portal_job_messages[0].notified_at).toBeNull();
    expect(await notifyPortalJobMessage(admin, 'm-in', deps)).toBe('sent');
    expect(sent).toHaveLength(1);
  });

  it('ett av våra svar notiseras aldrig', async () => {
    const { admin, sent, deps } = notifying({ crm_portal_job_messages: [toStore()] });
    expect(await notifyPortalJobMessage(admin, 'm-out', deps)).toBe('already_sent');
    expect(sent).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------------------- svaret

const reply = (over: Record<string, unknown> = {}) => ({
  workOrderId: WO,
  messageId: REPLY_ID,
  body: 'Vi kommer tisdag.',
  department: 'Planering' as const,
  actor: { id: 'u-seller', name: 'Anna Berg' },
  ...over,
});
const send = (admin: never, over: Record<string, unknown> = {}) =>
  sendPortalJobReply(admin, admin, reply(over) as never, { env: { SOME: 'env' }, now: () => NOW });

describe('sendPortalJobReply', () => {
  it('ingen portalorder som sessionen ser: not_found, ingenting sparas eller köas', async () => {
    const { admin, tables } = db({ crm_portal_jobs: [] });
    expect(await send(admin)).toEqual({ kind: 'not_found' });
    expect(tables.crm_portal_job_messages ?? []).toHaveLength(0);
    expect(tables.portal_outbound_events ?? []).toHaveLength(0);
  });

  it('sparas i eget namn, köas med kroppen ur den SPARADE raden (databasens tid), bokförs och skickas direkt', async () => {
    const { admin, tables } = db();
    const result = await send(admin);
    expect(tables.crm_portal_job_messages).toHaveLength(1);
    expect(tables.crm_portal_job_messages[0]).toMatchObject({
      quote_id: 'q-1',
      direction: 'to_store',
      message_id: REPLY_ID,
      author_name: 'Anna Berg',
      author_user_id: 'u-seller',
      department: 'Planering',
      body: 'Vi kommer tisdag.',
      queued_at: NOW.toISOString(),
    });
    expect(tables.portal_outbound_events).toHaveLength(1);
    expect(tables.portal_outbound_events[0]).toMatchObject({
      idempotency_key: `job.message-${REPLY_ID}`,
      path: '/api/ekovilla/events',
      ordering_key: 'job:q-1',
      supersede_key: null,
      payload: {
        type: 'job.message',
        occurredAt: '2026-10-12T08:30:00.123Z',
        data: {
          quoteId: 'q-1',
          messageId: REPLY_ID,
          authorName: 'Anna Berg',
          department: 'Planering',
          body: 'Vi kommer tisdag.',
          sentAt: '2026-10-12T08:30:00.123Z',
        },
      },
    });
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatch.mock.calls[0][1]).toMatchObject({ env: { SOME: 'env' }, limit: 20, budgetMs: 5_000 });
    expect(result).toEqual({
      kind: 'sent',
      created: true,
      message: {
        id: 'm-1',
        direction: 'to_store',
        authorName: 'Anna Berg',
        department: 'Planering',
        body: 'Vi kommer tisdag.',
        sentAt: '2026-10-12T08:30:00.123Z',
        delivery: 'sending',
      },
    });
  });

  it('insert-raden bär aldrig sent_at, queued_at eller notified_at (sessionen har ingen grant på dem)', async () => {
    const { admin, calls } = db();
    await send(admin);
    const insert = calls.find((c) => c.table === 'crm_portal_job_messages' && c.op === 'upsert');
    expect(Object.keys(insert!.values as object).sort()).toEqual(
      ['author_name', 'author_user_id', 'body', 'department', 'direction', 'message_id', 'quote_id'],
    );
  });

  it('portalen hann svara: skickat', async () => {
    const { admin, tables } = db();
    h.dispatch.mockImplementation(async () => {
      tables.portal_outbound_events[0].status = 'sent';
      return { ran: true, claimed: 1, sent: 1, retried: 0, dead: 0, returned: 0, bookkeepingErrors: 0 };
    });
    expect(await send(admin)).toMatchObject({ kind: 'sent', message: { delivery: 'sent' } });
  });

  it('RLS nekar (varken ansvarig eller admin): forbidden, ingenting köat eller skickat', async () => {
    const { admin, tables, failOn } = db();
    failOn((c) => c.table === 'crm_portal_job_messages' && c.op === 'upsert', { code: '42501', message: 'new row violates row-level security policy' });
    expect(await send(admin)).toEqual({ kind: 'forbidden' });
    expect(tables.portal_outbound_events ?? []).toHaveLength(0);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('samma id två gånger (dubbelklick, omförsök): ett svar och en händelse; andra gången created false', async () => {
    const { admin, tables } = db();
    await send(admin);
    const again = await send(admin);
    expect(again).toMatchObject({ kind: 'sent', created: false, message: { id: 'm-1' } });
    expect(tables.crm_portal_job_messages).toHaveLength(1);
    expect(tables.portal_outbound_events).toHaveLength(1);
  });

  it('samma id med en annan text, avdelning eller svarare: conflict, det skickade orört', async () => {
    const { admin, tables } = db();
    await send(admin);
    for (const over of [{ body: 'Annat.' }, { department: 'Ekonomi' }, { actor: { id: 'u-admin', name: 'Admin' } }]) {
      expect(await send(admin, over)).toEqual({ kind: 'conflict' });
    }
    expect(tables.crm_portal_job_messages).toHaveLength(1);
    expect(tables.portal_outbound_events).toHaveLength(1);
  });

  it('kön svarar inte: svaret är sparat men inte bokfört som köat (cron tar det), och läget är "skickas"', async () => {
    const { admin, tables, failOn } = db();
    failOn((c) => c.table === 'portal_outbound_events' && c.op === 'upsert', { message: 'nere' });
    expect(await send(admin)).toMatchObject({ kind: 'sent', message: { delivery: 'sending' } });
    expect(tables.crm_portal_job_messages[0].queued_at).toBeNull();
  });

  it('utskicket kastar: svaret är ändå sparat och köat', async () => {
    const { admin, tables } = db();
    h.dispatch.mockRejectedValue(new Error('portalen nere'));
    expect((await send(admin)).kind).toBe('sent');
    expect(tables.portal_outbound_events).toHaveLength(1);
    expect(tables.crm_portal_job_messages[0].queued_at).toBe(NOW.toISOString());
  });

  it('utan namn i profilen: "Ekovilla"', async () => {
    const { admin, tables } = db();
    await send(admin, { actor: { id: 'u-seller', name: null } });
    expect(tables.crm_portal_job_messages[0].author_name).toBe('Ekovilla');
  });
});

// ------------------------------------------------------------------------------------------------------------- kortet

const SELLER = { userId: 'u-seller', canWrite: true, isAdmin: false };

describe('listPortalJobMessages', () => {
  it('ingen portalorder som sessionen ser: null', async () => {
    const { admin } = db({ crm_portal_jobs: [] });
    expect(await listPortalJobMessages(admin, WO, SELLER)).toBeNull();
  });

  it('äldst först; butikens utan läge, svaren med köns läge (skickat, kom inte fram, skickas, inte köat än)', async () => {
    const { admin } = db({
      crm_portal_job_messages: [
        toStore({ id: 'a', message_id: 'r-1', sent_at: '2026-10-12T08:02:00+00:00' }),
        fromStore({ id: 'b', sent_at: '2026-10-12T08:01:00+00:00' }),
        toStore({ id: 'c', message_id: 'r-2', sent_at: '2026-10-12T08:03:00+00:00' }),
        toStore({ id: 'd', message_id: 'r-3', sent_at: '2026-10-12T08:04:00+00:00' }),
        toStore({ id: 'e', message_id: 'r-4', sent_at: '2026-10-12T08:05:00+00:00' }),
        fromStore({ id: 'x', quote_id: 'q-annat', message_id: 'x', sent_at: '2026-10-12T08:00:00+00:00' }),
      ],
      portal_outbound_events: [
        { idempotency_key: 'job.message-r-1', status: 'sent', seq: 1 },
        { idempotency_key: 'job.message-r-2', status: 'dead', seq: 2 },
        { idempotency_key: 'job.message-r-3', status: 'pending', seq: 3 },
      ],
    });
    const view = await listPortalJobMessages(admin, WO, SELLER);
    expect(view!.storeName).toBe('K-Bygg Sandviken');
    expect(view!.messages.map((m) => [m.id, m.direction, m.delivery])).toEqual([
      ['b', 'from_store', null],
      ['a', 'to_store', 'sent'],
      ['c', 'to_store', 'failed'],
      ['d', 'to_store', 'sending'],
      ['e', 'to_store', 'sending'],
    ]);
    expect(view!.messages[0]).toMatchObject({ authorName: 'Sara Ek', department: '', sentAt: '2026-10-12T08:01:00.000Z' });
  });

  it(`bara de senaste ${PORTAL_JOB_MESSAGES_LIMIT}, äldst först`, async () => {
    const rows = Array.from({ length: PORTAL_JOB_MESSAGES_LIMIT + 1 }, (_, i) =>
      fromStore({ id: `m${String(i).padStart(4, '0')}`, message_id: `x${i}`, sent_at: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString() }),
    );
    const { admin } = db({ crm_portal_job_messages: rows });
    const view = await listPortalJobMessages(admin, WO, SELLER);
    expect(view!.messages).toHaveLength(PORTAL_JOB_MESSAGES_LIMIT);
    expect(view!.messages[0].id).toBe('m0001');
    expect(view!.messages.at(-1)!.id).toBe(`m${String(PORTAL_JOB_MESSAGES_LIMIT).padStart(4, '0')}`);
  });

  it('canReply: den som har ordern och admin, med skrivnyckeln; inte en annan säljare, inte utan skrivnyckeln', async () => {
    const { admin } = db();
    const canReply = async (viewer: typeof SELLER) => (await listPortalJobMessages(admin, WO, viewer))!.canReply;
    expect(await canReply(SELLER)).toBe(true);
    expect(await canReply({ userId: 'u-admin', canWrite: true, isAdmin: true })).toBe(true);
    expect(await canReply({ userId: 'u-annan', canWrite: true, isAdmin: false })).toBe(false);
    expect(await canReply({ userId: 'u-seller', canWrite: false, isAdmin: false })).toBe(false);
    expect(await canReply({ userId: 'u-admin', canWrite: false, isAdmin: true })).toBe(false);
  });
});

// --------------------------------------------------------------------------------------------------------------- cron

describe('sweepPortalJobMessages', () => {
  it('ett svar som inte köats köas (äldre än en minut, yngre än en vecka), med samma kropp som routen hade köat', async () => {
    const { admin, tables } = db({
      crm_portal_job_messages: [
        toStore({ id: 'gammal', message_id: 'r-gammal', created_at: ago(8 * 24 * 60) }),
        toStore({ id: 'nu', message_id: 'r-nu', created_at: ago(0.5) }),
        toStore({ id: 'glomd', message_id: 'r-glomd', created_at: ago(3) }),
        toStore({ id: 'koad', message_id: 'r-koad', created_at: ago(3), queued_at: ago(3) }),
      ],
    });
    const summary = await sweepPortalJobMessages(admin, { now: () => NOW, notifyDeps: { notify: vi.fn(), now: () => NOW } });
    expect(summary).toEqual({ queued: 1, notified: 0, errors: 0 });
    expect(tables.portal_outbound_events.map((e) => e.idempotency_key)).toEqual(['job.message-r-glomd']);
    expect((tables.portal_outbound_events[0].payload as any).data).toMatchObject({ messageId: 'r-glomd', sentAt: '2026-10-12T08:20:00.500Z' });
    expect(tables.crm_portal_job_messages.find((m) => m.id === 'glomd')!.queued_at).toBe(NOW.toISOString());
  });

  it('händelsen fanns redan (processen dog före bokföringen): samma händelse, bara bokförd', async () => {
    const first = db({ crm_portal_job_messages: [toStore({ created_at: ago(3) })] });
    await sweepPortalJobMessages(first.admin, { now: () => NOW, notifyDeps: { notify: vi.fn(), now: () => NOW } });
    const event = first.tables.portal_outbound_events[0];
    const { admin, tables } = db({ crm_portal_job_messages: [toStore({ created_at: ago(3) })], portal_outbound_events: [event] });
    expect(await sweepPortalJobMessages(admin, { now: () => NOW, notifyDeps: { notify: vi.fn(), now: () => NOW } })).toEqual({
      queued: 1,
      notified: 0,
      errors: 0,
    });
    expect(tables.portal_outbound_events).toHaveLength(1);
  });

  it('butikens meddelande utan notis notiseras (äldre än två minuter, yngre än ett dygn); ett fel stoppar inte nästa', async () => {
    const notify = vi.fn(async () => undefined);
    const { admin, tables, failOn } = db({
      crm_portal_job_messages: [
        fromStore({ id: 'nyss', message_id: 'a', created_at: ago(1) }),
        fromStore({ id: 'gardag', message_id: 'b', created_at: ago(25 * 60) }),
        fromStore({ id: 'faller', message_id: 'c', created_at: ago(4) }),
        fromStore({ id: 'glomd', message_id: 'd', created_at: ago(3) }),
      ],
    });
    failOn((c) => c.table === 'crm_portal_job_messages' && c.op === 'update' && c.filters.some(([, col, v]) => col === 'id' && v === 'faller'), { message: 'låst' });
    expect(await sweepPortalJobMessages(admin, { now: () => NOW, notifyDeps: { notify, now: () => NOW } })).toEqual({
      queued: 0,
      notified: 1,
      errors: 1,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(tables.crm_portal_job_messages.filter((m) => m.notified_at).map((m) => m.id)).toEqual(['glomd']);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NotificationInsert } from '@/lib/domains/notifications/types';

// The delivery helper does real I/O through the (mocked) service-role client and web-push module.
vi.mock('@/lib/webPush', () => ({
  isWebPushConfigured: vi.fn(() => true),
  sendWebPush: vi.fn(async () => {}),
}));

import { deliverNotifications } from '@/lib/domains/notifications/delivery';
import { isWebPushConfigured, sendWebPush } from '@/lib/webPush';

type DeviceRow = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

// Minimal chainable stand-in for the Supabase service-role client covering exactly the calls the
// delivery helper makes: notifications.insert().select(), subscriptions.select().in(),
// subscriptions.update().eq(), subscriptions.delete().eq().
function makeAdmin(subs: DeviceRow[] = []) {
  const calls = {
    inserted: null as NotificationInsert[] | null,
    lookupIds: null as string[] | null,
    deletes: [] as string[],
    updates: [] as Array<{ id: string; payload: Record<string, unknown> }>,
  };
  const admin: any = {
    from(table: string) {
      if (table === 'notifications') {
        return {
          insert(rows: NotificationInsert[]) {
            calls.inserted = rows;
            return { select: async () => ({ data: rows.map((_, i) => ({ id: `n${i}` })), error: null }) };
          },
        };
      }
      // dashboard_push_subscriptions
      return {
        select() {
          return {
            in(_col: string, ids: string[]) {
              calls.lookupIds = ids;
              return Promise.resolve({ data: subs.filter((s) => ids.includes(s.user_id)), error: null });
            },
          };
        },
        update(payload: Record<string, unknown>) {
          return {
            eq: (_c: string, id: string) => {
              calls.updates.push({ id, payload });
              return Promise.resolve({ error: null });
            },
          };
        },
        delete() {
          return {
            eq: (_c: string, id: string) => {
              calls.deletes.push(id);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { admin, calls };
}

const device = (id: string, user_id: string): DeviceRow => ({
  id,
  user_id,
  endpoint: `https://push.example/${id}`,
  p256dh: `p256-${id}`,
  auth: `auth-${id}`,
});

const row = (recipient: string, over: Partial<NotificationInsert> = {}): NotificationInsert => ({
  recipient_user_id: recipient,
  type: 'work_order.mention',
  title: 'Kalle nämnde dig',
  body: 'Arbetsorder #1042',
  href: '/crm/arbetsorder/wo1',
  entity_type: 'work_order',
  entity_id: 'wo1',
  ...over,
});

beforeEach(() => {
  vi.mocked(isWebPushConfigured).mockReturnValue(true);
  vi.mocked(sendWebPush).mockReset();
  vi.mocked(sendWebPush).mockResolvedValue(undefined as any);
});

describe('deliverNotifications', () => {
  it('inserts the rows and returns the insert result', async () => {
    const { admin, calls } = makeAdmin([]);
    const rows = [row('u1'), row('u2')];
    const result = await deliverNotifications(admin, rows);
    expect(calls.inserted).toEqual(rows);
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
  });

  it('skips push entirely when web push is not configured', async () => {
    vi.mocked(isWebPushConfigured).mockReturnValue(false);
    const { admin, calls } = makeAdmin([device('d1', 'u1')]);
    await deliverNotifications(admin, [row('u1')]);
    expect(calls.lookupIds).toBeNull(); // no subscription lookup
    expect(sendWebPush).not.toHaveBeenCalled();
  });

  it('pushes to each opted-in device with the row content mapped to the SW payload', async () => {
    const { admin } = makeAdmin([device('d1', 'u1')]);
    await deliverNotifications(admin, [row('u1')]);
    expect(sendWebPush).toHaveBeenCalledTimes(1);
    const [subscription, payload] = vi.mocked(sendWebPush).mock.calls[0];
    expect(subscription).toEqual({ endpoint: 'https://push.example/d1', keys: { p256dh: 'p256-d1', auth: 'auth-d1' } });
    expect(payload).toMatchObject({
      title: 'Kalle nämnde dig',
      body: 'Arbetsorder #1042',
      url: '/crm/arbetsorder/wo1',
      tag: 'work_order.mention:wo1',
    });
  });

  it('looks up devices once for the unique recipient set and fans out per device', async () => {
    const { admin, calls } = makeAdmin([device('d1', 'u1'), device('d2', 'u1'), device('d3', 'u2')]);
    await deliverNotifications(admin, [row('u1'), row('u2')]);
    expect(calls.lookupIds).toEqual(['u1', 'u2']);
    // u1 has 2 devices, u2 has 1 → 3 pushes total.
    expect(sendWebPush).toHaveBeenCalledTimes(3);
  });

  it('recipients without a device get the bell row but no push', async () => {
    const { admin } = makeAdmin([]); // nobody subscribed
    await deliverNotifications(admin, [row('u1')]);
    expect(sendWebPush).not.toHaveBeenCalled();
  });

  it('prunes a dead endpoint (410 Gone) and never throws', async () => {
    vi.mocked(sendWebPush).mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    const { admin, calls } = makeAdmin([device('d1', 'u1')]);
    await expect(deliverNotifications(admin, [row('u1')])).resolves.toBeDefined();
    expect(calls.deletes).toEqual(['d1']);
  });

  it('records a failure (non-404/410) without deleting the subscription', async () => {
    vi.mocked(sendWebPush).mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));
    const { admin, calls } = makeAdmin([device('d1', 'u1')]);
    await deliverNotifications(admin, [row('u1')]);
    expect(calls.deletes).toEqual([]);
    expect(calls.updates.some((u) => u.id === 'd1' && 'last_failure_at' in u.payload)).toBe(true);
  });
});

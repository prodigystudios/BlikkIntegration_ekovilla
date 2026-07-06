import { describe, it, expect } from 'vitest';
import { listNotificationsQuerySchema } from '@/lib/domains/notifications/schemas';
import { mapNotificationRow } from '@/lib/domains/notifications/mappers';
import { expandNotificationToRecipients } from '@/lib/domains/notifications/mutations';
import {
  buildFaultReportCreatedNotification,
  buildFaultReportUpdatedNotification,
  buildWorkOrderCommentMentionNotification,
} from '@/lib/domains/notifications/payload';
import type { NotificationRow } from '@/lib/domains/notifications/types';

describe('listNotificationsQuerySchema', () => {
  it('defaults: unreadOnly=false, limit=30', () => {
    const parsed = listNotificationsQuerySchema.parse({});
    expect(parsed.unreadOnly).toBe(false);
    expect(parsed.limit).toBe(30);
    expect(parsed.before).toBeUndefined();
  });

  it('coerces string unreadOnly + limit and clamps limit range', () => {
    expect(listNotificationsQuerySchema.parse({ unreadOnly: 'true', limit: '10' })).toMatchObject({ unreadOnly: true, limit: 10 });
    expect(() => listNotificationsQuerySchema.parse({ limit: '0' })).toThrow();
    expect(() => listNotificationsQuerySchema.parse({ limit: '999' })).toThrow();
  });

  it('rejects a non-ISO before cursor', () => {
    expect(() => listNotificationsQuerySchema.parse({ before: 'igår' })).toThrow();
  });
});

describe('mapNotificationRow', () => {
  const base: NotificationRow = {
    id: 'n1',
    recipient_user_id: 'u1',
    type: 'fault_report.created',
    title: 'Ny felanmälan',
    body: 'text',
    href: '/felanmalan?arende=r1',
    entity_type: 'fault_report',
    entity_id: 'r1',
    read_at: null,
    created_at: '2026-07-03T10:00:00.000Z',
  };

  it('derives read=false when read_at is null', () => {
    expect(mapNotificationRow(base).read).toBe(false);
  });

  it('derives read=true when read_at is set', () => {
    expect(mapNotificationRow({ ...base, read_at: '2026-07-03T11:00:00.000Z' }).read).toBe(true);
  });
});

describe('fault report notification payload builders', () => {
  const input = { reportId: 'r1', categoryLabel: 'Isoleringsmaskin', reporterName: 'Anna' };

  it('created: correct type, entity ref and href carrying the report id', () => {
    const n = buildFaultReportCreatedNotification(input);
    expect(n.type).toBe('fault_report.created');
    expect(n.entity_type).toBe('fault_report');
    expect(n.entity_id).toBe('r1');
    expect(n.href).toContain('r1');
    expect(n.href).toContain('scope=inbox');
    expect(n.title).toContain('Isoleringsmaskin');
  });

  it('updated: includes status label and points at the reporter view (no inbox scope)', () => {
    const n = buildFaultReportUpdatedNotification({ ...input, statusLabel: 'Pågår' });
    expect(n.type).toBe('fault_report.updated');
    expect(n.title).toContain('Pågår');
    expect(n.href).toContain('r1');
    expect(n.href).not.toContain('scope=inbox');
  });
});

describe('buildWorkOrderCommentMentionNotification', () => {
  it('links to the work order and carries the entity ref + order number', () => {
    const n = buildWorkOrderCommentMentionNotification({
      workOrderId: 'wo1',
      orderNumber: 'AO-1042',
      projectName: 'Villa Ek',
      commenterName: 'Kalle',
    });
    expect(n.type).toBe('work_order.mention');
    expect(n.entity_type).toBe('work_order');
    expect(n.entity_id).toBe('wo1');
    expect(n.href).toBe('/crm/arbetsorder/wo1');
    expect(n.title).toContain('Kalle');
    expect(n.body).toContain('AO-1042');
    expect(n.body).toContain('Villa Ek');
  });

  it('degrades gracefully when order number / project / commenter are missing', () => {
    const n = buildWorkOrderCommentMentionNotification({ workOrderId: 'wo2' });
    expect(n.href).toBe('/crm/arbetsorder/wo2');
    expect(n.title).toContain('Någon');
    expect(n.body).toContain('en arbetsorder');
  });

  it('routes the field audience to the open installer view (not the office-only /crm route)', () => {
    const n = buildWorkOrderCommentMentionNotification({ workOrderId: 'wo3', audience: 'field' });
    expect(n.href).toBe('/arbetsorder/wo3');
  });

  it('routes the crm audience to the CRM detail view', () => {
    const n = buildWorkOrderCommentMentionNotification({ workOrderId: 'wo4', audience: 'crm' });
    expect(n.href).toBe('/crm/arbetsorder/wo4');
  });
});

describe('expandNotificationToRecipients', () => {
  it('produces one insert per recipient carrying the content', () => {
    const content = buildFaultReportCreatedNotification({ reportId: 'r1', categoryLabel: 'Truck', reporterName: 'A' });
    const rows = expandNotificationToRecipients(content, ['a', 'b']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ recipient_user_id: 'a', type: 'fault_report.created', entity_id: 'r1' });
    expect(rows[1].recipient_user_id).toBe('b');
  });

  it('empty recipient list → no rows', () => {
    const content = buildFaultReportCreatedNotification({ reportId: 'r1', categoryLabel: 'Truck', reporterName: 'A' });
    expect(expandNotificationToRecipients(content, [])).toEqual([]);
  });
});

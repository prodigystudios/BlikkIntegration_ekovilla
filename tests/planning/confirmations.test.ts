import { describe, it, expect } from 'vitest';
import { summarizeConfirmations, describeSmsStatus } from '@/lib/domains/planning/confirmations';

describe('summarizeConfirmations', () => {
  it('returns an empty map for no rows', () => {
    expect(summarizeConfirmations([]).size).toBe(0);
  });

  it('keeps the latest email + latest sms per work order, regardless of input order', () => {
    const rows = [
      { work_order_id: 'wo1', channel: 'email', recipient: 'old@x.se', created_at: '2026-06-01T08:00:00Z' },
      { work_order_id: 'wo1', channel: 'sms', recipient: '+46700000001', created_at: '2026-06-02T08:00:00Z', status: 'delivered' },
      { work_order_id: 'wo1', channel: 'email', recipient: 'new@x.se', created_at: '2026-06-03T08:00:00Z' },
    ];
    const summary = summarizeConfirmations(rows).get('wo1');
    expect(summary).toEqual({
      email_sent_at: '2026-06-03T08:00:00Z',
      email_to: 'new@x.se',
      sms_sent_at: '2026-06-02T08:00:00Z',
      sms_to: '+46700000001',
      sms_status: 'delivered',
    });
  });

  it('summarises each work order independently', () => {
    const rows = [
      { work_order_id: 'wo1', channel: 'email', recipient: 'a@x.se', created_at: '2026-06-01T08:00:00Z' },
      { work_order_id: 'wo2', channel: 'sms', recipient: '+46700000002', created_at: '2026-06-01T08:00:00Z' },
    ];
    const map = summarizeConfirmations(rows);
    expect(map.get('wo1')?.email_to).toBe('a@x.se');
    expect(map.get('wo1')?.sms_sent_at).toBeNull();
    expect(map.get('wo2')?.sms_to).toBe('+46700000002');
    expect(map.get('wo2')?.email_sent_at).toBeNull();
  });

  it('captures the latest sms status (newest row wins)', () => {
    const rows = [
      { work_order_id: 'wo1', channel: 'sms', recipient: '+4670', created_at: '2026-06-01T08:00:00Z', status: 'queued' },
      { work_order_id: 'wo1', channel: 'sms', recipient: '+4670', created_at: '2026-06-01T09:00:00Z', status: 'delivered' },
    ];
    expect(summarizeConfirmations(rows).get('wo1')?.sms_status).toBe('delivered');
  });
});

describe('describeSmsStatus', () => {
  it('returns null when there is no status', () => {
    expect(describeSmsStatus(null)).toBeNull();
    expect(describeSmsStatus(undefined)).toBeNull();
    expect(describeSmsStatus('')).toBeNull();
  });
  it('marks delivered as ok', () => {
    expect(describeSmsStatus('delivered')).toEqual({ label: 'Levererat', tone: 'ok' });
  });
  it('marks failed + undelivered as fail (case-insensitive)', () => {
    expect(describeSmsStatus('failed')?.tone).toBe('fail');
    expect(describeSmsStatus('UNDELIVERED')?.tone).toBe('fail');
  });
  it('treats in-flight statuses as pending', () => {
    expect(describeSmsStatus('queued')?.tone).toBe('pending');
    expect(describeSmsStatus('sent')?.tone).toBe('pending');
  });
});

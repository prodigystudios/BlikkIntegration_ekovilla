import { describe, it, expect } from 'vitest';
import {
  quoteBoardColumn,
  isQuoteCardLocked,
  SALJTAVLA_COLUMNS,
} from '@/lib/domains/crm/quoteBoard';

describe('quoteBoardColumn', () => {
  it('maps each status 1:1 to its column', () => {
    expect(quoteBoardColumn({ status: 'draft' })).toBe('draft');
    expect(quoteBoardColumn({ status: 'sent' })).toBe('sent');
    expect(quoteBoardColumn({ status: 'follow_up' })).toBe('follow_up');
    expect(quoteBoardColumn({ status: 'won' })).toBe('won');
    expect(quoteBoardColumn({ status: 'lost' })).toBe('lost');
  });

  it('keeps a won quote in the won column even when it has a work order', () => {
    // Won offers read as won; the work order is shown via a badge, not a column move.
    expect(quoteBoardColumn({ status: 'won' })).toBe('won');
  });
});

describe('isQuoteCardLocked', () => {
  it('locks only a won quote that has a work order', () => {
    expect(isQuoteCardLocked({ status: 'won', work_order_id: 'wo-1' })).toBe(true);
    expect(isQuoteCardLocked({ status: 'won', work_order_id: null })).toBe(false);
    expect(isQuoteCardLocked({ status: 'draft', work_order_id: null })).toBe(false);
    // A non-won status with a stray work_order_id is not locked.
    expect(isQuoteCardLocked({ status: 'sent', work_order_id: 'wo-1' })).toBe(false);
  });
});

describe('board column config', () => {
  it('lists five columns in flow order', () => {
    expect(SALJTAVLA_COLUMNS).toEqual(['draft', 'sent', 'follow_up', 'won', 'lost']);
  });
});

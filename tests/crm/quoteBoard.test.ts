import { describe, it, expect } from 'vitest';
import {
  quoteBoardColumn,
  isQuoteCardLocked,
  SALJTAVLA_COLUMNS,
  SALJTAVLA_DROPPABLE_STATUSES,
} from '@/lib/domains/crm/quoteBoard';

describe('quoteBoardColumn', () => {
  it('maps each non-won status 1:1 to its column', () => {
    expect(quoteBoardColumn({ status: 'draft', work_order_id: null })).toBe('draft');
    expect(quoteBoardColumn({ status: 'sent', work_order_id: null })).toBe('sent');
    expect(quoteBoardColumn({ status: 'follow_up', work_order_id: null })).toBe('follow_up');
    expect(quoteBoardColumn({ status: 'lost', work_order_id: null })).toBe('lost');
  });

  it('keeps a won quote without a work order in the won column', () => {
    expect(quoteBoardColumn({ status: 'won', work_order_id: null })).toBe('won');
  });

  it('moves a won quote with a work order into the derived work_order column', () => {
    expect(quoteBoardColumn({ status: 'won', work_order_id: 'wo-1' })).toBe('work_order');
  });

  it('does not move a non-won quote that somehow has a work_order_id', () => {
    // Only won + work order is the downstream column; guard against mislabeling.
    expect(quoteBoardColumn({ status: 'sent', work_order_id: 'wo-1' })).toBe('sent');
  });
});

describe('isQuoteCardLocked', () => {
  it('locks only cards in the work_order column', () => {
    expect(isQuoteCardLocked({ status: 'won', work_order_id: 'wo-1' })).toBe(true);
    expect(isQuoteCardLocked({ status: 'won', work_order_id: null })).toBe(false);
    expect(isQuoteCardLocked({ status: 'draft', work_order_id: null })).toBe(false);
  });
});

describe('board column config', () => {
  it('lists six columns in flow order with work_order before lost', () => {
    expect(SALJTAVLA_COLUMNS).toEqual(['draft', 'sent', 'follow_up', 'won', 'work_order', 'lost']);
  });

  it('does not allow dropping onto the derived work_order column', () => {
    expect(SALJTAVLA_DROPPABLE_STATUSES).not.toContain('work_order');
    expect(SALJTAVLA_DROPPABLE_STATUSES).toEqual(['draft', 'sent', 'follow_up', 'won', 'lost']);
  });
});

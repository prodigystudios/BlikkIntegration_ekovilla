// Pure column-derivation logic for the Säljtavla (sales board). The board's
// columns follow a quote's own status, with one derived column: a won quote that
// has been converted to a work order moves downstream into "Arbetsorder" so the
// handoff to production is visible. Kept side-effect-free so it can be unit-tested
// and shared between the server and the board client.

export type QuoteBoardStatus = 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';

// The board columns, in display order. 'work_order' is derived (not a DB status).
export type SaljtavlaColumn = 'draft' | 'sent' | 'follow_up' | 'won' | 'work_order' | 'lost';

export const SALJTAVLA_COLUMNS: SaljtavlaColumn[] = [
  'draft',
  'sent',
  'follow_up',
  'won',
  'work_order',
  'lost',
];

// Columns a card can be dropped onto to change its status. 'work_order' is
// intentionally excluded: a work order is created from the quote's detail view,
// not by a drag gesture, and such cards are locked.
export const SALJTAVLA_DROPPABLE_STATUSES: QuoteBoardStatus[] = ['draft', 'sent', 'follow_up', 'won', 'lost'];

// Which board column a quote belongs in. A won quote with a linked work order is
// shown in the downstream 'work_order' column; everything else maps 1:1 to status.
export function quoteBoardColumn(quote: {
  status: QuoteBoardStatus;
  work_order_id: string | null;
}): SaljtavlaColumn {
  if (quote.status === 'won' && quote.work_order_id) return 'work_order';
  return quote.status;
}

// A card is locked (non-draggable) once it sits in the work_order column — the
// quote is already converted/locked and must not be dragged back to a sales status.
export function isQuoteCardLocked(quote: { status: QuoteBoardStatus; work_order_id: string | null }): boolean {
  return quoteBoardColumn(quote) === 'work_order';
}

// Pure column-derivation logic for the Säljtavla (sales board). The board's
// columns map 1:1 to a quote's own status. A won quote that's been converted to a
// work order stays in the "Vunnen" column (shown with an "Order #" badge) rather
// than moving to a separate column — won offers should read as won. Kept
// side-effect-free so it can be unit-tested and shared between server and client.

export type QuoteBoardStatus = 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';

// Board columns, in display order — identical to the quote statuses.
export type SaljtavlaColumn = QuoteBoardStatus;

export const SALJTAVLA_COLUMNS: SaljtavlaColumn[] = ['draft', 'sent', 'follow_up', 'won', 'lost'];

// Columns a card can be dropped onto to change its status (all of them).
export const SALJTAVLA_DROPPABLE_STATUSES: QuoteBoardStatus[] = ['draft', 'sent', 'follow_up', 'won', 'lost'];

// Which board column a quote belongs in — its status.
export function quoteBoardColumn(quote: { status: QuoteBoardStatus }): SaljtavlaColumn {
  return quote.status;
}

// A won quote that's been converted to a work order is locked in Fortnox and must
// not be dragged to another status. Such cards sit in the Vunnen column with an
// "Order #" badge and are non-draggable.
export function isQuoteCardLocked(quote: { status: QuoteBoardStatus; work_order_id: string | null }): boolean {
  return quote.status === 'won' && quote.work_order_id != null;
}

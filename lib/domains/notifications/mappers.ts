import type { NotificationRow, NotificationView } from './types';

// Row → view model. Derives the `read` boolean so the client doesn't reason about read_at.
export function mapNotificationRow(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    href: row.href,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    read: row.read_at != null,
    read_at: row.read_at,
    created_at: row.created_at,
  };
}

export function mapNotificationRows(rows: NotificationRow[] | null | undefined): NotificationView[] {
  return (rows || []).map(mapNotificationRow);
}

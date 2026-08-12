import {
  areaLabel,
  isClosedTicketStatus,
  kindLabel,
  statusLabel,
  toTicketArea,
  toTicketKind,
  toTicketStatus,
  type AppTicketRow,
  type AppTicketView,
} from './types';

export function mapTicketRow(row: AppTicketRow): AppTicketView {
  // Okänd kind ska aldrig kunna finnas (CHECK i DB) — men en rad från framtiden med en ny nyckel
  // ska visas som något, inte krascha listan. 'bug' är den försiktiga tolkningen: hellre en
  // felmärkt bugg i backloggen än ett bortglömt ärende.
  const kind = toTicketKind(row.kind) ?? 'bug';
  const area = toTicketArea(row.area);
  const status = toTicketStatus(row.status);

  return {
    id: row.id,
    reporter_id: row.reporter_id,
    reporter_name: row.reporter_name,
    kind,
    kind_label: kindLabel[kind],
    area,
    area_label: areaLabel[area],
    title: row.title,
    description: row.description,
    page_path: row.page_path,
    status,
    status_label: statusLabel[status],
    is_closed: isClosedTicketStatus(status),
    resolution: row.resolution,
    has_screenshot: !!(row.screenshot_bucket && row.screenshot_path),
    changelog_note: row.changelog_note,
    changelog_published_at: row.changelog_published_at,
    handled_at: row.handled_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapTicketRows(rows: AppTicketRow[] | null | undefined): AppTicketView[] {
  return (rows || []).map(mapTicketRow);
}

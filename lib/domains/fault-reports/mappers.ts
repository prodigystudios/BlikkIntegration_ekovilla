import {
  categoryLabel,
  statusLabel,
  toFaultCategory,
  toFaultStatus,
  type FaultReportRow,
  type FaultReportView,
  type FaultReportUpdateRow,
  type FaultReportUpdateView,
} from './types';

export function mapFaultReportRow(row: FaultReportRow): FaultReportView {
  const category = toFaultCategory(row.category) ?? 'maskiner';
  const status = toFaultStatus(row.status);
  return {
    id: row.id,
    reporter_id: row.reporter_id,
    reporter_name: row.reporter_name,
    category,
    category_label: categoryLabel[category],
    comment: row.comment,
    status,
    status_label: statusLabel[status],
    reply: row.reply,
    responder_name: row.responder_name,
    responded_at: row.responded_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapFaultReportRows(rows: FaultReportRow[] | null | undefined): FaultReportView[] {
  return (rows || []).map(mapFaultReportRow);
}

export function mapFaultReportUpdateRow(row: FaultReportUpdateRow): FaultReportUpdateView {
  const status = toFaultStatus(row.status);
  return {
    id: row.id,
    status,
    status_label: statusLabel[status],
    reply: row.reply,
    responder_name: row.responder_name,
    created_at: row.created_at,
  };
}

export function mapFaultReportUpdateRows(rows: FaultReportUpdateRow[] | null | undefined): FaultReportUpdateView[] {
  return (rows || []).map(mapFaultReportUpdateRow);
}

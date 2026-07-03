// Felanmälan domain types. DB stores stable English keys (text + CHECK); Swedish labels live
// here so the UI and notifications render consistently.

export const FAULT_CATEGORIES = ['truck', 'lager', 'lastbil', 'isoleringsmaskin', 'maskiner'] as const;
export type FaultCategory = (typeof FAULT_CATEGORIES)[number];

export const FAULT_STATUSES = ['new', 'in_progress', 'resolved'] as const;
export type FaultStatus = (typeof FAULT_STATUSES)[number];

export const categoryLabel: Record<FaultCategory, string> = {
  truck: 'Truck',
  lager: 'Lager',
  lastbil: 'Lastbil',
  isoleringsmaskin: 'Isoleringsmaskin',
  maskiner: 'Maskiner',
};

export const statusLabel: Record<FaultStatus, string> = {
  new: 'Ny',
  in_progress: 'Pågår',
  resolved: 'Åtgärdad',
};

export function toFaultCategory(value: unknown): FaultCategory | null {
  return FAULT_CATEGORIES.includes(value as FaultCategory) ? (value as FaultCategory) : null;
}

export function toFaultStatus(value: unknown): FaultStatus {
  return FAULT_STATUSES.includes(value as FaultStatus) ? (value as FaultStatus) : 'new';
}

export type FaultReportRow = {
  id: string;
  reporter_id: string | null;
  reporter_name: string;
  category: string;
  comment: string;
  status: string;
  reply: string | null;
  responder_id: string | null;
  responder_name: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};

// One append-only history entry (a supervisor status/reply at a point in time).
export type FaultReportUpdateRow = {
  id: string;
  report_id: string;
  status: string;
  reply: string | null;
  responder_id: string | null;
  responder_name: string;
  created_at: string;
};

export type FaultReportUpdateView = {
  id: string;
  status: FaultStatus;
  status_label: string;
  reply: string | null;
  responder_name: string;
  created_at: string;
};

export type FaultReportView = {
  id: string;
  reporter_id: string | null;
  reporter_name: string;
  category: FaultCategory;
  category_label: string;
  comment: string;
  status: FaultStatus;
  status_label: string;
  reply: string | null;
  responder_name: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};

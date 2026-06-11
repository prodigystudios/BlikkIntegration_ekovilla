// Domain types for the new CRM-first planning (Wave 7). Pure, no React/Next — these mirror
// the ops_* tables (supabase/sql/20260611_ops_planning_foundation.sql) and the backlog read
// model built from crm_work_orders.

// A CRM work order eligible to be scheduled, annotated for the planning backlog. The "what to
// schedule" comes entirely from the CRM (customer, address, sacks, desired date) — no Blikk.
export type SchedulableWorkOrder = {
  id: string;
  order_number: string;
  project_name: string;
  client_name: string;
  status: string;
  desired_installation_date: string | null;
  address: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  total_sacks: number;
  // How many ops_segments already cover this order (0 = not yet placed on the calendar).
  segment_count: number;
};

export type OpsTruck = {
  id: string;
  name: string;
  color: string | null;
  active: boolean;
};

// One scheduled placement of a work order on a truck across a day-range.
export type OpsSegment = {
  id: string;
  work_order_id: string;
  truck_id: string;
  start_day: string; // 'YYYY-MM-DD'
  end_day: string; // 'YYYY-MM-DD'
  sort_index: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined display fields from crm_work_orders (present on list/read responses).
  work_order?: {
    order_number: string;
    project_name: string;
    client_name: string;
    status: string;
  } | null;
};

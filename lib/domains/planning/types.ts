import type { JobDisplay } from './display';
import type { CrewMember } from './crew';

// Domain types for the new CRM-first planning (Wave 7). Pure, no React/Next — these mirror the
// ops_* tables and the read models built from crm_work_orders. JobDisplay (display.ts) holds the
// fields a job shows on a card (ref/customer/address/sacks/status/material), shared by the backlog
// and the scheduled segments so a job looks identical wherever it appears.

// A CRM work order eligible to be scheduled, annotated for the planning backlog.
export type SchedulableWorkOrder = JobDisplay & {
  id: string;
  desired_installation_date: string | null;
  contact_email: string | null;
  contact_phone: string | null;
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
  // Planner-set job type (Ekovilla/Vitull/Leverans/…) driving the card colour; null → fall back
  // to the material inferred from the work order. See lib/domains/planning/jobTypes.ts.
  job_type: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // The job's card data (null only if the related work order is unreadable, which shouldn't happen).
  job: JobDisplay | null;
  // Total sacks blown for this job across all its segments' reports (per-day sack reporting).
  sacks_reported: number;
  // The crew (besättning) assigned to this specific placement; shown as initials on the card.
  crew: CrewMember[];
};

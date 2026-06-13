import type { JobDisplay } from './display';
import type { CrewMember } from './crew';
import type { ConfirmationSummary } from './confirmations';

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
  // The work order's assignee (sales-responsible) user id; mapped to a name via the people list for
  // the backlog sales filter. null when unassigned.
  assigned_to: string | null;
  // How many ops_segments already cover this order (0 = not yet placed on the calendar).
  segment_count: number;
};

export type OpsTruck = {
  id: string;
  name: string;
  color: string | null;
  active: boolean;
  // The depot this truck draws sacks from (null = unassigned). See lib/domains/planning/depots.ts.
  depot_id: string | null;
};

export type OpsDepot = {
  id: string;
  name: string;
  location: string | null;
  active: boolean;
};

// One scheduled placement on a truck across a day-range. Normally a CRM work order, but may be a
// placeholder (work_order_id null) — a booked slot a sales rep blocks before the real order exists,
// carrying its own title/customer until a later slice links it to the work order.
export type OpsSegment = {
  id: string;
  work_order_id: string | null;
  truck_id: string;
  start_day: string; // 'YYYY-MM-DD'
  end_day: string; // 'YYYY-MM-DD'
  sort_index: number;
  // Planner-set job type (Ekovilla/Vitull/Leverans/…) driving the card colour; null → fall back
  // to the material inferred from the work order. See lib/domains/planning/jobTypes.ts.
  job_type: string | null;
  // Paused placement (customer postponed, material delayed, …): keeps its slot but is dimmed +
  // badged "Pausad" so it isn't treated as active.
  on_hold: boolean;
  created_by: string | null;
  // Display name of whoever placed the job on the calendar, snapshotted at placement time (profiles
  // are self-read-only). Drives the "inlagd av" badge. null for segments placed before this existed.
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  // Placeholder title/customer when this is a booked slot without a work order yet (else null).
  placeholder_title: string | null;
  placeholder_customer: string | null;
  // The job's card data (null for a placeholder, or if the related work order is unreadable).
  job: JobDisplay | null;
  // Total sacks blown for this job across all its segments' reports (per-day sack reporting).
  sacks_reported: number;
  // The crew (besättning) assigned to this specific placement; shown as initials on the card.
  crew: CrewMember[];
  // Whether the customer has been sent an order confirmation (per work order); drives the badge.
  confirmation: ConfirmationSummary;
};

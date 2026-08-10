import { workOrderRef, resolveJobAddress } from './display';

// Field cutover fas 1c — one feed, two worlds.
//
// During the drain, an installer's day can contain jobs from the legacy Blikk planning
// (get_my_jobs → planning_segments) and from the new CRM planning (get_my_crm_jobs → ops_segments
// → crm_work_orders). They are scheduled in different systems but they are the same person's week,
// so /mina-jobb shows them as one chronological list and tags each row with where it came from.
// The Blikk rows shrink toward zero on their own as planning moves into CRM — no migration, no
// cutover date.
//
// Pure: no I/O, no React. The RPC calls live in the page; this module only decides shape and order.

export type BlikkJobRow = {
  segment_id: string | number | null;
  project_id: string | number | null;
  project_name: string | null;
  customer: string | null;
  order_number: string | null;
  job_day: string | null;
  start_day: string | null;
  truck: string | null;
  job_type: string | null;
  bag_count: number | null;
};

export type CrmJobRow = {
  segment_id: string;
  work_order_id: string;
  order_number: string;
  fortnox_order_number: string | null;
  project_name: string | null;
  customer: string | null;
  job_day: string | null;
  start_day: string | null;
  end_day: string | null;
  truck: string | null;
  truck_color: string | null;
  job_type: string | null;
  status: string | null;
  work_address: Record<string, unknown> | null;
  customer_address: Record<string, unknown> | null;
};

export type MyJob = {
  // Stable React key. Segment + day, namespaced by source so a Blikk and a CRM segment can never
  // collide on a numeric/uuid id that happens to stringify the same.
  key: string;
  source: 'blikk' | 'crm';
  day: string;
  // How the business refers to the job: '#<fortnox>' when synced, else the internal order number.
  ref: string | null;
  projectName: string | null;
  customer: string | null;
  truck: string | null;
  truckColor: string | null;
  jobType: string | null;
  // CRM rows carry the work order status; Blikk rows have no equivalent.
  status: string | null;
  address: string | null;
  bagCount: number | null;
  // Exactly one of these is set, by source. workOrderId drives the link to /arbetsorder/<id>;
  // projectId keeps the legacy Blikk comment/time flow working on old rows.
  workOrderId: string | null;
  projectId: string | null;
};

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};

// A segment spans days; the feed is per day. Prefer the expanded job_day, fall back to the
// segment start so a row is never silently dropped just because the view shape changed.
const dayOf = (row: { job_day: string | null; start_day: string | null }): string | null =>
  str(row.job_day) ?? str(row.start_day);

function fromBlikk(row: BlikkJobRow): MyJob | null {
  const day = dayOf(row);
  if (!day) return null;
  const projectId = str(row.project_id);
  const orderNumber = str(row.order_number);
  return {
    key: `blikk:${str(row.segment_id) ?? projectId ?? 'x'}:${day}`,
    source: 'blikk',
    day,
    // Legacy rows only ever carry the Blikk order number, and the old card rendered it as '#nnn'.
    ref: orderNumber ? `#${orderNumber}` : null,
    projectName: str(row.project_name),
    customer: str(row.customer),
    truck: str(row.truck),
    truckColor: null,
    jobType: str(row.job_type),
    status: null,
    address: null,
    bagCount: typeof row.bag_count === 'number' ? row.bag_count : null,
    workOrderId: null,
    projectId,
  };
}

function fromCrm(row: CrmJobRow): MyJob | null {
  const day = dayOf(row);
  if (!day) return null;
  const { ref } = workOrderRef(row.fortnox_order_number, row.order_number);
  return {
    key: `crm:${row.segment_id}:${day}`,
    source: 'crm',
    day,
    ref,
    projectName: str(row.project_name),
    customer: str(row.customer),
    truck: str(row.truck),
    truckColor: str(row.truck_color),
    jobType: str(row.job_type),
    status: str(row.status),
    address: resolveJobAddress(row.work_address, row.customer_address),
    // Sacks are not in the v1 RPC (derived from line_items jsonb); the work order view has them.
    bagCount: null,
    workOrderId: row.work_order_id,
    projectId: null,
  };
}

// The dashboard's week schedule (components/dashboard/DashboardSchedule.tsx) is built around the
// legacy get_my_jobs row shape and renders it in ~500 lines of card markup. Rather than rework
// that, a CRM job is adapted INTO that shape so it renders through the same path — with a `source`
// marker so the three places that must behave differently can branch:
//   • the enrichment queries hit legacy tables by segment_id (a CRM uuid matches nothing)
//   • opening the card looks a Blikk project up BY ORDER NUMBER — which, given Fortnox numbers are
//     numeric like Blikk's, could pull up an unrelated project for a CRM job
//   • time reporting has no Blikk project to attach a CRM job to
export type ScheduleItem = {
  segment_id: string;
  project_id: string | null;
  project_name: string | null;
  customer: string | null;
  order_number: string | null;
  start_day: string | null;
  end_day: string | null;
  job_day: string | null;
  truck: string | null;
  job_type: string | null;
  bag_count: number | null;
  source: 'crm';
  work_order_id: string;
};

export function crmJobToScheduleItem(row: CrmJobRow): ScheduleItem {
  const { ref } = workOrderRef(row.fortnox_order_number, row.order_number);
  return {
    segment_id: row.segment_id,
    project_id: null,
    project_name: str(row.project_name),
    customer: str(row.customer),
    order_number: ref,
    start_day: str(row.start_day),
    end_day: str(row.end_day),
    job_day: dayOf(row),
    truck: str(row.truck),
    job_type: str(row.job_type),
    // Not in the v1 RPC (derived from line_items jsonb); the work order view has them.
    bag_count: null,
    source: 'crm',
    work_order_id: row.work_order_id,
  };
}

// Merge both feeds into one chronological list.
//
// Rows without a day are dropped (an unscheduled row is not a job in a day-ordered feed).
// Duplicates on the same key are collapsed, keeping the first occurrence — the same segment can
// arrive twice if a range query overlaps itself, and a doubled card reads as a doubled job.
export function mergeMyJobs(
  blikkJobs: BlikkJobRow[] | null | undefined,
  crmJobs: CrmJobRow[] | null | undefined,
): MyJob[] {
  const rows: MyJob[] = [
    ...(Array.isArray(blikkJobs) ? blikkJobs : []).map(fromBlikk).filter((j): j is MyJob => j !== null),
    ...(Array.isArray(crmJobs) ? crmJobs : []).map(fromCrm).filter((j): j is MyJob => j !== null),
  ];

  const seen = new Set<string>();
  const deduped = rows.filter((j) => (seen.has(j.key) ? false : (seen.add(j.key), true)));

  // Day first. Within a day, order is fully determined (day → ref → key) rather than left to the
  // arrival order of two independent RPCs, so the list doesn't reshuffle between loads.
  return deduped.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      (a.ref ?? '').localeCompare(b.ref ?? '') ||
      a.key.localeCompare(b.key),
  );
}

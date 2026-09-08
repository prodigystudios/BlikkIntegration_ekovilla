import { describe, it, expect } from 'vitest';
import { crmJobToScheduleItem, type CrmJobRow } from '@/lib/domains/planning/myJobs';

// The dashboard week schedule renders the legacy get_my_jobs row shape. A CRM job is adapted into
// that shape so it goes through the same card markup — these tests pin the field names the card
// reads, and the `source` marker the three legacy-only code paths branch on.

const crm = (over: Partial<CrmJobRow> = {}): CrmJobRow => ({
  segment_id: 'seg-c1',
  work_order_id: 'wo-1',
  order_number: 'AO-20260810-A1B2',
  fortnox_order_number: '5418',
  project_name: 'Vindsisolering',
  customer: 'Villa Ek',
  job_day: '2026-08-11',
  start_day: '2026-08-11',
  end_day: '2026-08-12',
  truck: 'Bil 2',
  truck_color: '#16a34a',
  job_type: 'Vitull',
  status: 'scheduled',
  work_address: {},
  customer_address: {},
  placeholder_title: null,
  work_description: null,
  ...over,
});

// En publicerad platshållare: bokad dag utan arbetsorder (service av maskiner, intern dag).
const placeholder = (over: Partial<CrmJobRow> = {}): CrmJobRow =>
  crm({
    work_order_id: null,
    order_number: null,
    fortnox_order_number: null,
    project_name: null,
    customer: null,
    status: null,
    placeholder_title: 'Service av blåsmaskin',
    work_description: 'Filterbyte och smörjning.',
    ...over,
  });

describe('crmJobToScheduleItem', () => {
  it('produces the fields the dashboard card reads', () => {
    expect(crmJobToScheduleItem(crm())).toEqual({
      segment_id: 'seg-c1',
      project_id: null,
      project_name: 'Vindsisolering',
      customer: 'Villa Ek',
      order_number: '#5418',
      start_day: '2026-08-11',
      end_day: '2026-08-12',
      job_day: '2026-08-11',
      truck: 'Bil 2',
      job_type: 'Vitull',
      bag_count: null,
      source: 'crm',
      work_order_id: 'wo-1',
      work_description: null,
    });
  });

  it('marks the row so the legacy-only paths can skip it', () => {
    // Without this the enrichment queries hit planning_* by a CRM uuid, the detail modal looks up
    // a Blikk project by order number, and the time button opens an empty form.
    expect(crmJobToScheduleItem(crm()).source).toBe('crm');
  });

  it('carries the work order id so the card can lead to the field view', () => {
    expect(crmJobToScheduleItem(crm()).work_order_id).toBe('wo-1');
  });

  it('leads with the Fortnox number, falling back to the internal order number', () => {
    expect(crmJobToScheduleItem(crm()).order_number).toBe('#5418');
    expect(crmJobToScheduleItem(crm({ fortnox_order_number: null })).order_number).toBe('AO-20260810-A1B2');
  });

  it('keeps project_id null — a CRM job has no Blikk project to report time against', () => {
    expect(crmJobToScheduleItem(crm()).project_id).toBeNull();
  });

  it('falls back to the segment start when the expanded day is missing', () => {
    expect(crmJobToScheduleItem(crm({ job_day: null })).job_day).toBe('2026-08-11');
  });

  // ── Publicerade platshållare ──────────────────────────────────────────────
  // De kommer ur samma RPC som riktiga jobb men saknar arbetsorder. Kortet i veckoschemat
  // navigerar till /arbetsorder/<id> och ritar en "Öppna order"-knapp, båda grindade på
  // work_order_id — så det fältet MÅSTE vara null här, annars får besättningen en knapp som
  // leder till /arbetsorder/null.
  it('lämnar work_order_id null på en platshållare, så kortets orderväg stängs', () => {
    expect(crmJobToScheduleItem(placeholder()).work_order_id).toBeNull();
  });

  it('använder platshållarens titel som rubrik', () => {
    expect(crmJobToScheduleItem(placeholder()).project_name).toBe('Service av blåsmaskin');
  });

  it('ger platshållaren inget ordernummer att visa', () => {
    // `workOrderRef(null, '')` svarar med tomma strängen, som hade ritat en tom separatorprick
    // efter kundnamnet i stället för att utebli.
    expect(crmJobToScheduleItem(placeholder()).order_number).toBeNull();
  });

  it('bär arbetsbeskrivningen vidare till kortet', () => {
    expect(crmJobToScheduleItem(placeholder()).work_description).toBe('Filterbyte och smörjning.');
  });
});

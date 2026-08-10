import { describe, it, expect } from 'vitest';
import { redactWorkOrderForField } from '@/lib/domains/crm/work-orders';

// The crew RLS policy lets an installer read their own work order, but RLS is row-level and cannot
// narrow columns — crmWorkOrderSelect carries personnummer and order economics. These tests are the
// column-level guard: a widened select or a careless spread must fail here, not in production.

const fullRow = () => ({
  id: 'wo-1',
  order_number: 'AO-20260810-A1B2',
  fortnox_order_number: '5418',
  project_name: 'Vindsisolering',
  client_name: 'Villa Ek',
  quote_type: 'private',
  status: 'scheduled',
  desired_installation_date: '2026-08-14',
  work_address: { street_address: 'Jobbvägen 1', city: 'Nacka' },
  internal_handoff: { work_scope: 'Vind', handoff_notes: 'Ring vid ankomst' },
  line_items: [{ article_name: 'Ekovilla', m2: '120', unit_price: '450' }],
  currency_code: 'SEK',
  vat_percent: 25,
  amount: 54000,
  pricing_summary: { subtotal: 43200, vat: 10800, total: 54000, rot_deduction: 12000 },
  customer_snapshot: {
    contact_name: 'Anna Ek',
    email: 'anna@example.se',
    phone: '070-1234567',
    personal_number: '19850101-1234',
    street_address: 'Kontoret 9',
    delivery_address: 'Leveransgatan 3',
  },
  rot_details: {
    enabled: true,
    rot_percent: 30,
    max_deduction: 50000,
    personal_number: '19850101-1234',
    property_designation: 'Nacka 1:23',
  },
});

describe('redactWorkOrderForField', () => {
  it('never lets personnummer reach the field view — from either place it is stored', () => {
    const redacted = redactWorkOrderForField(fullRow());
    expect(redacted.customer_snapshot).not.toHaveProperty('personal_number');
    expect(redacted.rot_details).not.toHaveProperty('personal_number');
    // Belt and braces: nothing anywhere in the payload.
    expect(JSON.stringify(redacted)).not.toContain('19850101-1234');
  });

  it('drops order economics the field view never renders', () => {
    const redacted = redactWorkOrderForField(fullRow());
    expect(redacted).not.toHaveProperty('pricing_summary');
    expect(redacted).not.toHaveProperty('amount');
  });

  it('drops the ROT property designation but keeps what the article totals need', () => {
    const redacted = redactWorkOrderForField(fullRow());
    expect(redacted.rot_details).not.toHaveProperty('property_designation');
    // computePricing reads exactly these three.
    expect(redacted.rot_details).toEqual({ enabled: true, rot_percent: 30, max_deduction: 50000 });
  });

  it('keeps the customer contact the crew needs to call ahead', () => {
    expect(redactWorkOrderForField(fullRow()).customer_snapshot).toEqual({
      contact_name: 'Anna Ek',
      email: 'anna@example.se',
      phone: '070-1234567',
    });
  });

  it('keeps line items including prices — a deliberate decision, not an oversight', () => {
    const redacted = redactWorkOrderForField(fullRow());
    expect(redacted.line_items).toEqual([{ article_name: 'Ekovilla', m2: '120', unit_price: '450' }]);
  });

  it('leaves the job information the field view is built around untouched', () => {
    const redacted = redactWorkOrderForField(fullRow());
    expect(redacted).toMatchObject({
      id: 'wo-1',
      order_number: 'AO-20260810-A1B2',
      fortnox_order_number: '5418',
      project_name: 'Vindsisolering',
      client_name: 'Villa Ek',
      status: 'scheduled',
      desired_installation_date: '2026-08-14',
      work_address: { street_address: 'Jobbvägen 1', city: 'Nacka' },
      internal_handoff: { work_scope: 'Vind', handoff_notes: 'Ring vid ankomst' },
      vat_percent: 25,
    });
  });

  it('tolerates missing snapshot/rot objects rather than throwing on a sparse row', () => {
    const redacted = redactWorkOrderForField({ id: 'wo-2', customer_snapshot: null, rot_details: null });
    expect(redacted.customer_snapshot).toEqual({ contact_name: null, email: null, phone: null });
    expect(redacted.rot_details).toEqual({ enabled: false, rot_percent: null, max_deduction: null });
  });
});

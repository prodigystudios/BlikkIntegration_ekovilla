import { describe, it, expect } from 'vitest';
import {
  evaluateWorkOrderReadiness,
  workOrderReadinessErrorCode,
  type ReadinessCustomerSource,
  type ReadinessQuoteSource,
} from '@/lib/domains/crm/workOrderReadiness';

// Spärren mellan offert och arbetsorder. Orderskapandet auto-pushar till Fortnox, så det här är
// sista stället en glömd uppgift är ett formulärfel i stället för ett bokföringsärende.
//
// Det som gör testerna värda något är FALLBACKEN till kundkortet: adress, telefon och org.nr går
// inte att redigera i offertformuläret, så en spärr som bara läste offertens snapshot hade
// blockerat säljaren även efter att hen gjort precis det spärren bad om.

const fullSnapshot = {
  customer_name: 'Anna Andersson',
  contact_name: 'Anna Andersson',
  personal_number: '198501011236',
  phone: '070-123 45 67',
  street_address: 'Storgatan 1',
  postal_code: '12345',
  city: 'Stockholm',
};

function quote(overrides: Partial<ReadinessQuoteSource> = {}): ReadinessQuoteSource {
  return {
    quote_type: 'private',
    customer_id: '11111111-1111-1111-1111-111111111111',
    customer_snapshot: { ...fullSnapshot },
    rot_details: { enabled: false },
    line_items: [{ article_name: 'Ekovilla', quantity: '10' }],
    internal_handoff: { desired_installation_date: '2026-09-01', handoff_notes: 'Vind, 400 mm' },
    ...overrides,
  };
}

const emptyCustomer: ReadinessCustomerSource = { email: null, phone: null, mobile: null, contacts: [] };

function fields(issues: Array<{ field: string }>) {
  return issues.map((i) => i.field);
}

describe('fullständighetskontroll offert → arbetsorder', () => {
  it('komplett privatoffert passerar utan fynd', () => {
    const result = evaluateWorkOrderReadiness(quote(), emptyCustomer);
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('okopplad offert spärras — utan customer_id får ordern ingen kund i Fortnox', () => {
    const result = evaluateWorkOrderReadiness(quote({ customer_id: null }), null);
    expect(fields(result.blockers)).toContain('customer_link');
    expect(result.ready).toBe(false);
  });

  it('personnummer hämtas från kundkortet när offertens snapshot saknar det', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, personal_number: null } }),
      { ...emptyCustomer, personal_number: '198501011236' },
    );
    expect(fields(result.blockers)).not.toContain('personal_number');
    expect(result.resolved.personalNumber).toBe('198501011236');
  });

  it('tio siffror spärrar — ROT dör tyst i Fortnox på ett ofullständigt nummer', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, personal_number: '8501011236' } }),
      emptyCustomer,
    );
    expect(fields(result.blockers)).toContain('personal_number');
  });

  it('företagskund utan org.nr spärras, privatkund berörs inte', () => {
    const business = evaluateWorkOrderReadiness(
      quote({ quote_type: 'business', customer_snapshot: { ...fullSnapshot, personal_number: null, organization_number: null } }),
      emptyCustomer,
    );
    expect(fields(business.blockers)).toContain('organization_number');

    const withOrgNr = evaluateWorkOrderReadiness(
      quote({ quote_type: 'business', customer_snapshot: { ...fullSnapshot, personal_number: null } }),
      { ...emptyCustomer, organization_number: '556677-8899' },
    );
    expect(fields(withOrgNr.blockers)).not.toContain('organization_number');
    expect(withOrgNr.resolved.organizationNumber).toBe('556677-8899');
  });

  it('halv adress spärras och meddelandet namnger de delar som saknas', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, postal_code: null, city: null } }),
      emptyCustomer,
    );
    const address = result.blockers.find((b) => b.field === 'work_address');
    expect(address?.message).toContain('postnummer och ort');
  });

  it('adressen faller tillbaka på kundkortets besöksadress när snapshoten är tom', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, street_address: null, postal_code: null, city: null } }),
      { ...emptyCustomer, visit_address: { street: 'Storgatan 1', postal_code: '12345', city: 'Stockholm' } },
    );
    expect(fields(result.blockers)).not.toContain('work_address');
    expect(result.resolved.workAddress.city).toBe('Stockholm');
  });

  it('en separat arbetsadress vinner över kundadressen och lånar inte dess ort', () => {
    const result = evaluateWorkOrderReadiness(
      quote({
        customer_snapshot: {
          ...fullSnapshot,
          delivery_address: 'Industrivägen 4',
          delivery_postal_code: '43210',
          delivery_city: 'Göteborg',
        },
      }),
      emptyCustomer,
    );
    expect(result.resolved.workAddress).toMatchObject({
      street_address: 'Industrivägen 4',
      postal_code: '43210',
      city: 'Göteborg',
    });
  });

  it('arbetsadress utan ort rättas i OFFERTEN, kundadress utan ort på KUNDKORTET', () => {
    const onQuote = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, delivery_address: 'Industrivägen 4' } }),
      emptyCustomer,
    );
    expect(onQuote.blockers.find((b) => b.field === 'work_address')?.fixAt).toBe('quote');

    const onCard = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, city: null } }),
      emptyCustomer,
    );
    expect(onCard.blockers.find((b) => b.field === 'work_address')?.fixAt).toBe('customer_card');
  });

  it('telefon: snapshot först, sedan slutkundens nummer, sedan kundkortet', () => {
    const noPhone = { ...fullSnapshot, phone: null };

    const blocked = evaluateWorkOrderReadiness(quote({ customer_snapshot: noPhone }), emptyCustomer);
    expect(fields(blocked.blockers)).toContain('contact_phone');

    const endContact = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...noPhone, end_contact_phone: '070-999 88 77' } }),
      emptyCustomer,
    );
    expect(endContact.resolved.phone).toBe('070-999 88 77');

    // Kontaktraden vinner över kortets nummer — samma regel som resolveCrmContact, så
    // arbetsordern och Fortnox-dokumenten pekar på samma person.
    const fromCard = evaluateWorkOrderReadiness(quote({ customer_snapshot: noPhone }), {
      ...emptyCustomer,
      phone: '08-111 222',
      contacts: [{ name: 'Anna', phone: '070-555 44 33', is_primary: true }],
    });
    expect(fromCard.resolved.phone).toBe('070-555 44 33');
  });

  it('ROT utan fastighetsbeteckning spärras — BRF org.nr räcker som alternativ', () => {
    const missing = evaluateWorkOrderReadiness(
      quote({ rot_details: { enabled: true, property_designation: null, brf_org_number: null } }),
      emptyCustomer,
    );
    expect(fields(missing.blockers)).toContain('rot_property');

    const brf = evaluateWorkOrderReadiness(
      quote({ rot_details: { enabled: true, brf_org_number: '769600-1234' } }),
      emptyCustomer,
    );
    expect(fields(brf.blockers)).not.toContain('rot_property');
  });

  it('tomma rader, saknat datum och saknad arbetsbeskrivning VARNAR men spärrar inte', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ line_items: [], internal_handoff: {} }),
      emptyCustomer,
    );
    expect(result.ready).toBe(true);
    expect(fields(result.warnings)).toEqual(['line_items', 'installation_date', 'handoff_notes']);
  });

  it('en rad utan innehåll räknas inte som en rad', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ line_items: [{ id: 'row-1', article_name: null, quantity: '', m2: '', unit_price: '' }] }),
      emptyCustomer,
    );
    expect(fields(result.warnings)).toContain('line_items');
  });
});

describe('felkoden som routen svarar med', () => {
  it('ensamt personnummer- eller ROT-fynd behåller sin kod så prompten fyrar', () => {
    expect(workOrderReadinessErrorCode([{ field: 'personal_number', label: '', message: '', fixAt: 'customer_card' }]))
      .toBe('crm_work_order_missing_personal_number');
    expect(workOrderReadinessErrorCode([{ field: 'rot_property', label: '', message: '', fixAt: 'quote' }]))
      .toBe('crm_work_order_missing_rot_property');
  });

  it('flera fynd ger listkoden — annars lagar prompten en sak och nästa fel dyker upp', () => {
    expect(
      workOrderReadinessErrorCode([
        { field: 'personal_number', label: '', message: '', fixAt: 'customer_card' },
        { field: 'contact_phone', label: '', message: '', fixAt: 'customer_card' },
      ]),
    ).toBe('crm_work_order_incomplete');
  });
});

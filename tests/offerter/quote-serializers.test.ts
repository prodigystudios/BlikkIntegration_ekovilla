import { describe, it, expect } from 'vitest';
import {
  getEffectiveCustomerName,
  buildCustomerSnapshot,
  buildRotDetails,
  buildInternalHandoff,
  type QuoteCustomerFields,
  type QuoteRotFields,
  type QuoteHandoffFields,
} from '@/app/crm/offerter/quoteSerializers';

function customer(overrides: Partial<QuoteCustomerFields> = {}): QuoteCustomerFields {
  return {
    quote_type: 'business',
    customer_name: 'Anna Svensson',
    company_name: 'Acme AB',
    organization_number: '556000-0000',
    personal_number: '900101-1234',
    contact_name: 'Anna',
    email: 'info@acme.se',
    phone: '08-123',
    street_address: 'Gatan 1',
    postal_code: '11122',
    city: 'Stockholm',
    visit_address: 'Besök 2',
    delivery_address: 'Leverans 3',
    invoice_address: 'Faktura 4',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getEffectiveCustomerName
// ---------------------------------------------------------------------------

describe('getEffectiveCustomerName', () => {
  it('business → företagsnamn', () => {
    expect(getEffectiveCustomerName({ quote_type: 'business', company_name: 'Acme AB', customer_name: 'X' })).toBe('Acme AB');
  });
  it('business utan företagsnamn → faller tillbaka på customer_name', () => {
    expect(getEffectiveCustomerName({ quote_type: 'business', company_name: '  ', customer_name: 'Kontakt' })).toBe('Kontakt');
  });
  it('private → personnamn', () => {
    expect(getEffectiveCustomerName({ quote_type: 'private', company_name: 'Acme AB', customer_name: 'Anna Svensson' })).toBe('Anna Svensson');
  });
});

// ---------------------------------------------------------------------------
// buildCustomerSnapshot — regression guard: no field silently dropped
// ---------------------------------------------------------------------------

describe('buildCustomerSnapshot', () => {
  it('business: företagsfält fyllda, privatfält null', () => {
    const snap = buildCustomerSnapshot(customer({ quote_type: 'business' }));
    expect(snap.company_name).toBe('Acme AB');
    expect(snap.organization_number).toBe('556000-0000');
    expect(snap.customer_name).toBe('Acme AB'); // effektivt namn
    expect(snap.personal_number).toBeNull();
  });

  it('private: personfält fyllda, företagsfält null', () => {
    const snap = buildCustomerSnapshot(customer({ quote_type: 'private' }));
    expect(snap.customer_name).toBe('Anna Svensson');
    expect(snap.personal_number).toBe('900101-1234');
    expect(snap.company_name).toBeNull();
    expect(snap.organization_number).toBeNull();
  });

  it('behåller alla kontakt- och adressfält', () => {
    const snap = buildCustomerSnapshot(customer());
    expect(snap.contact_name).toBe('Anna');
    expect(snap.email).toBe('info@acme.se');
    expect(snap.phone).toBe('08-123');
    expect(snap.street_address).toBe('Gatan 1');
    expect(snap.postal_code).toBe('11122');
    expect(snap.city).toBe('Stockholm');
    expect(snap.visit_address).toBe('Besök 2');
    expect(snap.delivery_address).toBe('Leverans 3');
    expect(snap.invoice_address).toBe('Faktura 4');
  });

  it('tomma strängar blir null', () => {
    const snap = buildCustomerSnapshot(customer({ email: '', phone: '', city: '' }));
    expect(snap.email).toBeNull();
    expect(snap.phone).toBeNull();
    expect(snap.city).toBeNull();
  });

  it('snapshot innehåller exakt de förväntade nycklarna', () => {
    const snap = buildCustomerSnapshot(customer());
    expect(Object.keys(snap).sort()).toEqual(
      [
        'city', 'company_name', 'contact_name', 'customer_name', 'delivery_address',
        'email', 'invoice_address', 'organization_number', 'personal_number', 'phone',
        'postal_code', 'street_address', 'visit_address',
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// buildRotDetails
// ---------------------------------------------------------------------------

function rot(overrides: Partial<QuoteRotFields> = {}): QuoteRotFields {
  return {
    quote_type: 'private',
    rot_enabled: true,
    rot_applicant_name: 'Anna',
    rot_personal_number: '900101-1234',
    rot_property_designation: 'Fastighet 1:2',
    rot_percent: '50',
    ...overrides,
  };
}

describe('buildRotDetails', () => {
  it('private + aktiverad → fält fyllda, procent parsad', () => {
    const r = buildRotDetails(rot());
    expect(r.enabled).toBe(true);
    expect(r.applicant_name).toBe('Anna');
    expect(r.property_designation).toBe('Fastighet 1:2');
    expect(r.rot_percent).toBe(50);
  });

  it('business → alltid avstängt även om rot_enabled', () => {
    const r = buildRotDetails(rot({ quote_type: 'business', rot_enabled: true }));
    expect(r.enabled).toBe(false);
    expect(r.applicant_name).toBeNull();
    expect(r.rot_percent).toBe(30);
  });

  it('private men inaktiverad → fält null, procent default 30', () => {
    const r = buildRotDetails(rot({ rot_enabled: false }));
    expect(r.enabled).toBe(false);
    expect(r.personal_number).toBeNull();
    expect(r.rot_percent).toBe(30);
  });

  it('tom procent → default 30', () => {
    expect(buildRotDetails(rot({ rot_percent: '' })).rot_percent).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// buildInternalHandoff
// ---------------------------------------------------------------------------

describe('buildInternalHandoff', () => {
  it('mappar fält, tomma blir null', () => {
    expect(buildInternalHandoff({ desired_installation_date: '2026-07-01', handoff_notes: '', work_scope: 'Tak' }))
      .toEqual({ desired_installation_date: '2026-07-01', handoff_notes: null, work_scope: 'Tak' });
  });
});

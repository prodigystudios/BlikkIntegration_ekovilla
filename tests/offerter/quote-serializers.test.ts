import { describe, it, expect } from 'vitest';
import {
  getEffectiveCustomerName,
  buildCustomerSnapshot,
  buildRotDetails,
  buildInternalHandoff,
  buildMeasurementLines,
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
    delivery_postal_code: '22233',
    delivery_city: 'Göteborg',
    invoice_address: 'Faktura 4',
    end_contact_name: '',
    end_contact_phone: '',
    end_contact_email: '',
    label: '',
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
    expect(snap.delivery_postal_code).toBe('22233');
    expect(snap.delivery_city).toBe('Göteborg');
    expect(snap.invoice_address).toBe('Faktura 4');
  });

  // Work/job address (arbetsadress) — only stored when it differs from the customer address.
  it('arbetsadress identisk med kundadressen → delivery_* nollas (trim/case-okänsligt)', () => {
    const snap = buildCustomerSnapshot(customer({
      street_address: 'Gatan 1', postal_code: '11122', city: 'Stockholm',
      delivery_address: 'gatan 1', delivery_postal_code: ' 11122 ', delivery_city: 'STOCKHOLM',
    }));
    expect(snap.delivery_address).toBeNull();
    expect(snap.delivery_postal_code).toBeNull();
    expect(snap.delivery_city).toBeNull();
    // Customer address itself is untouched.
    expect(snap.street_address).toBe('Gatan 1');
  });

  it('arbetsadress som skiljer sig → delivery_* behålls', () => {
    const snap = buildCustomerSnapshot(customer({
      street_address: 'Gatan 1', postal_code: '11122', city: 'Stockholm',
      delivery_address: 'Industrivägen 4', delivery_postal_code: '15242', delivery_city: 'Södertälje',
    }));
    expect(snap.delivery_address).toBe('Industrivägen 4');
    expect(snap.delivery_postal_code).toBe('15242');
    expect(snap.delivery_city).toBe('Södertälje');
  });

  it('gata är ankaret: ifylld ort men ingen gata → ingen separat arbetsadress lagras', () => {
    const snap = buildCustomerSnapshot(customer({
      street_address: 'Gatan 1', postal_code: '11122', city: 'Stockholm',
      delivery_address: '', delivery_postal_code: '', delivery_city: 'Göteborg',
    }));
    expect(snap.delivery_address).toBeNull();
    expect(snap.delivery_postal_code).toBeNull();
    expect(snap.delivery_city).toBeNull();
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
        'delivery_city', 'delivery_postal_code',
        'email', 'end_contact_email', 'end_contact_name', 'end_contact_phone',
        'invoice_address', 'label', 'organization_number', 'personal_number', 'phone',
        'postal_code', 'reverse_vat', 'street_address', 'visit_address',
      ].sort(),
    );
  });

  it('label (märkning): null när inget anges, trimmad text annars', () => {
    expect(buildCustomerSnapshot(customer()).label).toBeNull();
    expect(buildCustomerSnapshot(customer({ label: '  Projekt 42  ' })).label).toBe('Projekt 42');
  });

  it('end_contact_*: null när inget anges, speglar fälten annars', () => {
    expect(buildCustomerSnapshot(customer()).end_contact_name).toBeNull();
    const snap = buildCustomerSnapshot(customer({ end_contact_name: 'Fastighetsägaren', end_contact_phone: '070-1' }));
    expect(snap.end_contact_name).toBe('Fastighetsägaren');
    expect(snap.end_contact_phone).toBe('070-1');
    expect(snap.end_contact_email).toBeNull();
  });

  it('reverse_vat: null när inget anges, speglar opts annars', () => {
    expect(buildCustomerSnapshot(customer()).reverse_vat).toBeNull();
    expect(buildCustomerSnapshot(customer(), { reverseVat: true }).reverse_vat).toBe(true);
    expect(buildCustomerSnapshot(customer(), { reverseVat: false }).reverse_vat).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildRotDetails
// ---------------------------------------------------------------------------

function rot(overrides: Partial<QuoteRotFields> = {}): QuoteRotFields {
  return {
    quote_type: 'private',
    rot_enabled: true,
    rot_property_designation: 'Fastighet 1:2',
    rot_percent: '50',
    rot_max_deduction: '50000',
    rot_brf_org_number: '',
    // The ROT applicant is derived from the customer.
    customer_name: 'Anna Svensson',
    personal_number: '900101-1234',
    ...overrides,
  };
}

describe('buildRotDetails', () => {
  it('private + aktiverad → applicant härleds från kunden, procent parsad', () => {
    const r = buildRotDetails(rot());
    expect(r.enabled).toBe(true);
    expect(r.applicant_name).toBe('Anna Svensson');
    expect(r.personal_number).toBe('900101-1234');
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

  // Regression: Swedish comma/space decimals must parse (raw Number() → NaN would make the
  // server schema reject the whole quote save with a misleading error).
  it('komma/mellanslag i procent och maxavdrag parsas (inte NaN)', () => {
    const r = buildRotDetails(rot({ rot_percent: '33,5', rot_max_deduction: '50 000' }));
    expect(r.rot_percent).toBe(33.5);
    expect(r.max_deduction).toBe(50000);
  });

  it('buildMeasurementLines: m³-rader med mått → "Label – m² × mm", övriga ignoreras', () => {
    const lines = buildMeasurementLines([
      { pricing_mode: 'm3', construction: 'vagg', m2: '100', thickness_mm: '200' },
      { pricing_mode: 'm3', construction: 'snedtak', m2: '50', thickness_mm: '300', article_name: 'Snedtaksisolering' },
      { pricing_mode: 'm3', article_name: 'Vindsisolering', construction: '', m2: '80', thickness_mm: '400' },
      { pricing_mode: 'item', m2: '', thickness_mm: '', quantity: '5' } as never,
      { pricing_mode: 'm3', m2: '100', thickness_mm: '' }, // saknar tjocklek → hoppas över
    ]);
    expect(lines).toEqual([
      'Vägg – 100 m² × 200 mm',
      'Snedtak – 50 m² × 300 mm',
      'Vindsisolering – 80 m² × 400 mm',
    ]);
  });

  it('buildMeasurementLines: materialrubrik + säckantal + total', () => {
    // 100 m² × 200 mm = 20 m³ × 45 kg/m³ = 900 kg; Ekovilla 14 kg/säck → ceil(64.3)=65
    const lines = buildMeasurementLines([
      { pricing_mode: 'm3', construction: 'vagg', article_name: 'EKOVILLA cellulosa vägg', m2: '100', thickness_mm: '200', density: '45' },
    ]);
    expect(lines).toEqual([
      'EKOVILLA',
      'Vägg – 100 m² × 200 mm @ 45 kg/m³ – 65 säck',
      '',
      'Totalt: 65 säck',
    ]);
  });

  it('buildMeasurementLines: flera material → separata rubriker + summerad total', () => {
    const lines = buildMeasurementLines([
      { pricing_mode: 'm3', construction: 'vagg', article_name: 'EKOVILLA vägg', m2: '100', thickness_mm: '200', density: '45' },
      { pricing_mode: 'm3', construction: 'vind', article_name: 'PAROC vind', m2: '50', thickness_mm: '400', density: '30' },
    ]);
    expect(lines).toEqual([
      'EKOVILLA',
      'Vägg – 100 m² × 200 mm @ 45 kg/m³ – 65 säck',
      '',
      'PAROC',
      'Vind – 50 m² × 400 mm @ 30 kg/m³ – 40 säck',
      '',
      'Totalt: 105 säck',
    ]);
  });

  it('buildMeasurementLines: rubrik utan säck när densitet saknas; okänt material → ingen rubrik/säck', () => {
    expect(buildMeasurementLines([
      { pricing_mode: 'm3', construction: 'vagg', article_name: 'EKOVILLA cellulosa', m2: '100', thickness_mm: '200' },
    ])).toEqual(['EKOVILLA', 'Vägg – 100 m² × 200 mm']);
    expect(buildMeasurementLines([
      { pricing_mode: 'm3', construction: 'vagg', article_name: 'Glasull okänt', m2: '100', thickness_mm: '200', density: '45' },
    ])).toEqual(['Vägg – 100 m² × 200 mm']);
  });

  it('max_deduction och brf_org_number bevaras när aktiverad, defaultar/nullas annars', () => {
    const r = buildRotDetails(rot({ rot_max_deduction: '100000', rot_brf_org_number: '769600-1234' }));
    expect(r.max_deduction).toBe(100000);
    expect(r.brf_org_number).toBe('769600-1234');
    expect(buildRotDetails(rot({ rot_max_deduction: '' })).max_deduction).toBe(50000);
    expect(buildRotDetails(rot({ rot_enabled: false })).brf_org_number).toBeNull();
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

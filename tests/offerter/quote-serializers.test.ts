import { describe, it, expect } from 'vitest';
import {
  CUSTOMER_DERIVED_KEYS,
  mergeUntouchedCustomerFields,
  pickCustomerDerived,
  getEffectiveCustomerName,
  buildCustomerSnapshot,
  buildRotDetails,
  buildInternalHandoff,
  buildMeasurementLines,
  hasMeasurementBlock,
  replaceMeasurementBlock,
  stripLeadingMeasurementBlock,
  addDaysIso,
  daysBetweenIso,
  matchedValidityPreset,
  OFFER_VALIDITY_DAYS,
  OFFER_VALIDITY_PRESETS,
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Måttblocket fylls i AUTOMATISKT när en artikelrad får mått. Det gör de här
  // reglerna skarpa: automatiken kör på varje tangenttryckning i måttfälten, så en
  // trasig ersättning staplar dubbletter i stället för att synas en gång.
  // ─────────────────────────────────────────────────────────────────────────────

  describe('replaceMeasurementBlock', () => {
    const BLOCK = 'Vägg – 100 m² × 200 mm';
    const NEXT = 'Vägg – 120 m² × 200 mm';

    it('lägger blocket överst i en tom arbetsbeskrivning', () => {
      expect(replaceMeasurementBlock('', '', BLOCK)).toBe(BLOCK);
    });

    it('behåller säljarens egen text under blocket', () => {
      expect(replaceMeasurementBlock('Ring innan ankomst', '', BLOCK)).toBe(`${BLOCK}\n\nRing innan ankomst`);
    });

    it('BYTER UT föregående block i stället för att stapla dubbletter', () => {
      const first = replaceMeasurementBlock('Ring innan ankomst', '', BLOCK)!;
      const second = replaceMeasurementBlock(first, BLOCK, NEXT);
      expect(second).toBe(`${NEXT}\n\nRing innan ankomst`);
      // Det gamla måttet får inte ligga kvar någonstans i texten.
      expect(second).not.toContain('100 m²');
    });

    it('returnerar null när säljaren har redigerat blocket — texten är deras nu', () => {
      expect(replaceMeasurementBlock('Vägg – 90 m² × 200 mm', BLOCK, NEXT)).toBeNull();
    });

    // Regression: enbart `startsWith` matchade även här, och tillägget blev hängande kvar
    // som lös text när blocket byttes ut.
    it('returnerar null när säljaren skrivit till på blockets sista rad', () => {
      expect(replaceMeasurementBlock(`${BLOCK} (mätt på plats)`, BLOCK, NEXT)).toBeNull();
    });

    it('force skriver ändå — knappen är ett uttryckligt klick', () => {
      expect(replaceMeasurementBlock('Egen text', BLOCK, NEXT, { force: true })).toBe(`${NEXT}\n\nEgen text`);
    });

    // Knappen är ENDA vägen tillbaka när automatiken lämnat över ägarskapet, så den vägen
    // måste vara ren: staplas blocken bär arbetsbeskrivningen två uppsättningar mått, och
    // den inaktuella ligger kvar underst hela vägen ut till installatören.
    it('force staplar INTE ett nytt block ovanpå ett redigerat', () => {
      const edited = `Vägg – 90 m² × 200 mm (mätt på plats)\n\nRing innan ankomst`;
      const result = replaceMeasurementBlock(edited, BLOCK, NEXT, { force: true });
      expect(result).toBe(`${NEXT}\n\nRing innan ankomst`);
      expect(result).not.toContain('90 m²');
    });

    it('tomt nextBlock tar bort blocket men behåller säljarens text', () => {
      const withBlock = `${BLOCK}\n\nRing innan ankomst`;
      expect(replaceMeasurementBlock(withBlock, BLOCK, '')).toBe('Ring innan ankomst');
    });

    it('tomt nextBlock på en text som BARA var block ger tom sträng', () => {
      expect(replaceMeasurementBlock(BLOCK, BLOCK, '')).toBe('');
    });
  });

  describe('stripLeadingMeasurementBlock', () => {
    it('tar bort ett helt block med rubrik, mått och total', () => {
      const notes = 'EKOVILLA\nVägg – 100 m² × 200 mm @ 45 kg/m³ – 65 säck\n\nTotalt: 65 säck\n\nRing innan ankomst';
      expect(stripLeadingMeasurementBlock(notes)).toBe('Ring innan ankomst');
    });

    it('tar bort ett REDIGERAT block — det är hela poängen', () => {
      expect(stripLeadingMeasurementBlock('Vägg – 90 m² × 200 mm (mätt på plats)\n\nEgen text')).toBe('Egen text');
    });

    it('lämnar text utan block orörd', () => {
      expect(stripLeadingMeasurementBlock('Ring innan ankomst\nPorten är låst')).toBe('Ring innan ankomst\nPorten är låst');
    });

    it('äter inte säljarens text som råkar stå först', () => {
      const notes = 'Ring innan ankomst\n\nVägg – 100 m² × 200 mm';
      expect(stripLeadingMeasurementBlock(notes)).toBe(notes);
    });

    it('godtar bara en rubrik som följs av en måttrad', () => {
      // "Anteckning" följs inte av mått → ingen rubrik, inget block, texten står kvar.
      expect(stripLeadingMeasurementBlock('Anteckning\nRing innan')).toBe('Anteckning\nRing innan');
    });
  });

  describe('hasMeasurementBlock', () => {
    it('känner igen en måttrad', () => {
      expect(hasMeasurementBlock('Vägg – 100 m² × 200 mm')).toBe(true);
      expect(hasMeasurementBlock('EKOVILLA\nVind – 50 m² × 400 mm @ 30 kg/m³ – 40 säck')).toBe(true);
    });

    it('slår inte till på vanlig löptext', () => {
      expect(hasMeasurementBlock('Ring innan ankomst, 200 kvm vind')).toBe(false);
      expect(hasMeasurementBlock('')).toBe(false);
    });
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

describe('giltighetstid', () => {
  it('30 dagar är standard och finns som val i rullgardinen', () => {
    // Standarden får inte glida isär från valen — annars visar rullgardinen "Eget datum" på en
    // splitterny offert, vilket ser ut som att något är fel.
    expect(OFFER_VALIDITY_DAYS).toBe(30);
    expect(OFFER_VALIDITY_PRESETS).toContain(OFFER_VALIDITY_DAYS);
  });

  describe('addDaysIso', () => {
    it('lägger till dagar och håller sig till YYYY-MM-DD', () => {
      expect(addDaysIso('2026-08-13', 30)).toBe('2026-09-12');
      expect(addDaysIso('2026-08-13', 10)).toBe('2026-08-23');
    });

    it('går över månads- och årsskifte', () => {
      expect(addDaysIso('2026-12-20', 20)).toBe('2027-01-09');
      expect(addDaysIso('2028-02-20', 10)).toBe('2028-03-01'); // skottår
    });

    it('överlever sommartidsomställningen', () => {
      // Datumen tolkas kl. 12 just för det här: vid midnatt kan omställningen tippa över dygnet
      // och giltighetstiden bli en dag kort. Sverige ställer om sista söndagen i mars och oktober.
      expect(addDaysIso('2026-03-25', 10)).toBe('2026-04-04');
      expect(addDaysIso('2026-10-20', 15)).toBe('2026-11-04');
    });

    it('lämnar ett ogiltigt datum orört i stället för att svara NaN', () => {
      expect(addDaysIso('inte-ett-datum', 30)).toBe('inte-ett-datum');
    });
  });

  describe('daysBetweenIso', () => {
    it('räknar dagar mellan två datum', () => {
      expect(daysBetweenIso('2026-08-13', '2026-09-12')).toBe(30);
      expect(daysBetweenIso('2026-08-13', '2026-08-13')).toBe(0);
    });

    it('räknar rätt över sommartid', () => {
      expect(daysBetweenIso('2026-03-25', '2026-04-04')).toBe(10);
      expect(daysBetweenIso('2026-10-20', '2026-11-04')).toBe(15);
    });

    it('ger null när ett datum saknas eller är trasigt', () => {
      expect(daysBetweenIso('', '2026-09-12')).toBeNull();
      expect(daysBetweenIso('2026-08-13', '')).toBeNull();
      expect(daysBetweenIso('2026-08-13', 'skräp')).toBeNull();
    });
  });

  describe('matchedValidityPreset', () => {
    it('känner igen varje val i rullgardinen', () => {
      for (const days of OFFER_VALIDITY_PRESETS) {
        expect(matchedValidityPreset('2026-08-13', addDaysIso('2026-08-13', days))).toBe(days);
      }
    });

    it('ger null för ett datum som inte motsvarar något val — då visas "Eget datum"', () => {
      expect(matchedValidityPreset('2026-08-13', addDaysIso('2026-08-13', 37))).toBeNull();
      expect(matchedValidityPreset('2026-08-13', '2026-08-13')).toBeNull();
    });

    it('ger null när giltighetsdatumet saknas', () => {
      // Tomt fält får inte råka matcha ett val och visa fel giltighetstid.
      expect(matchedValidityPreset('2026-08-13', '')).toBeNull();
    });

    it('ger null för ett datum FÖRE offertdatumet', () => {
      expect(matchedValidityPreset('2026-08-13', '2026-08-01')).toBeNull();
    });
  });
});

describe('addDaysIso — ogiltigt dagantal', () => {
  it('lämnar datumet orört i stället för att kasta', () => {
    // setDate(NaN) gör datumet ogiltigt och toISOString kastar RangeError. Utan vakten hade en
    // anropare med ett härlett dagantal tagit ner hela formulärets rendering.
    expect(addDaysIso('2026-08-13', Number.NaN)).toBe('2026-08-13');
    expect(addDaysIso('2026-08-13', Number('custom'))).toBe('2026-08-13');
    expect(addDaysIso('2026-08-13', Infinity)).toBe('2026-08-13');
  });
});

describe('mergeUntouchedCustomerFields', () => {
  // What the card gave when the customer was picked.
  const applied = pickCustomerDerived({
    quote_type: 'business', vat_percent: '25', company_name: 'Byggarna AB',
    customer_name: 'Byggarna AB', organization_number: '556677-8899', personal_number: '',
    contact_name: 'Anna Andersson', phone: '0701234567', email: 'anna@byggarna.se',
    street_address: 'Storgatan 1', postal_code: '11122', city: 'Stockholm',
    delivery_address: '', delivery_postal_code: '', delivery_city: '',
  });

  it('pulls in omvänd skattskyldighet switched on while the seller was away', () => {
    // The case that made this necessary: without the merge vat_percent stayed at 25 while the
    // yellow notice (which reads the customer card) claimed 0 % — the quote saved the wrong VAT.
    const current = { ...applied };
    const next = { ...applied, vat_percent: '0' };
    expect(mergeUntouchedCustomerFields(current, applied, next).vat_percent).toBe('0');
  });

  it('keeps a reference the seller typed, even though the card says otherwise', () => {
    const current = { ...applied, contact_name: 'Platschef Bengt' };
    const next = { ...applied, contact_name: 'Anna Andersson' };
    expect(mergeUntouchedCustomerFields(current, applied, next).contact_name).toBe('Platschef Bengt');
  });

  it('does both at once — that is the whole point', () => {
    const current = { ...applied, contact_name: 'Platschef Bengt' };   // seller edited
    const next = { ...applied, vat_percent: '0', city: 'Göteborg' };   // card corrected
    const merged = mergeUntouchedCustomerFields(current, applied, next);
    expect(merged.contact_name).toBe('Platschef Bengt');
    expect(merged.vat_percent).toBe('0');
    expect(merged.city).toBe('Göteborg');
  });

  it('leaves an edited field alone even when the card changed it too', () => {
    const current = { ...applied, city: 'Uppsala' };   // seller's value
    const next = { ...applied, city: 'Göteborg' };     // card's new value
    expect(mergeUntouchedCustomerFields(current, applied, next).city).toBe('Uppsala');
  });

  it('treats clearing a prefilled field as an edit', () => {
    const current = { ...applied, phone: '' };
    const next = { ...applied, phone: '0709999999' };
    expect(mergeUntouchedCustomerFields(current, applied, next).phone).toBe('');
  });

  it('returns every key, so a spread onto the draft never drops a field', () => {
    const merged = mergeUntouchedCustomerFields({ ...applied }, applied, { ...applied });
    expect(Object.keys(merged).sort()).toEqual([...CUSTOMER_DERIVED_KEYS].sort());
  });
});

describe('pickCustomerDerived', () => {
  it('normalises missing/nullish fields to empty strings', () => {
    const picked = pickCustomerDerived({ contact_name: 'Anna', phone: null, email: undefined });
    expect(picked.contact_name).toBe('Anna');
    expect(picked.phone).toBe('');
    expect(picked.email).toBe('');
  });

  it('ignores draft fields that are not customer-derived', () => {
    // Passed as a variable, the way the form passes a whole QuoteDraft — an object literal would
    // trip TypeScript's excess-property check and hide what this is actually asserting.
    const draftLike = { project_name: 'Tak', contact_name: 'Anna' };
    const picked = pickCustomerDerived(draftLike);
    expect(Object.keys(picked)).not.toContain('project_name');
    expect(picked.contact_name).toBe('Anna');
  });
});

import { describe, it, expect, vi } from 'vitest';

// Modulen importerar getSupabaseAdmin på toppnivå. Rörs inte här, men måste finnas för importen.
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => null }));

import { mergeWorkOrderSnapshotOverrides, mergeWorkOrderRotDetails } from '@/lib/domains/crm/work-orders';

// Arbetsorderns customer_snapshot bär tre olika personer/värden som redigeras i samma formulär:
//
//   • your_reference — kundens formella referens. ENDA som når Fortnox (YourReference).
//   • contact        — kundkontakten: vem vi och installatörerna ringer.
//   • end_contact    — slutkunden på plats: en ANNAN person, utanför kundkortet.
//
// Plus allt annat kolumnen råkar bära (personnummer, org.nr, adresser, reverse_vat), som inte
// får försvinna för att någon rättade ett telefonnummer.

const BASE = {
  customer_name: 'Byggbolaget AB',
  personal_number: null,
  organization_number: '556677-8899',
  street_address: 'Industrivägen 4',
  postal_code: '152 42',
  city: 'Södertälje',
  reverse_vat: true,
  contact_name: 'Birgitta Ling',
  phone: '070-111 22 33',
  email: 'birgitta@byggbolaget.se',
  your_reference: 'Birgitta Ling',
};

describe('mergeWorkOrderSnapshotOverrides — det som inte rörs överlever', () => {
  it('en kontaktändring rör inte personnummer, org.nr, adress eller byggmoms', () => {
    const merged = mergeWorkOrderSnapshotOverrides(BASE, {
      contact: { contact_name: 'Ny Kontakt', phone: '070-999 88 77', email: 'ny@byggbolaget.se' },
    });

    expect(merged.organization_number).toBe('556677-8899');
    expect(merged.street_address).toBe('Industrivägen 4');
    expect(merged.postal_code).toBe('152 42');
    expect(merged.city).toBe('Södertälje');
    // 🧨 reverse_vat styr 0 %-regimen i Fortnox-pushen. Tappas den bort här faller ordern
    // tillbaka på 25 % moms för en byggmomskund, tyst.
    expect(merged.reverse_vat).toBe(true);
  });

  it('muterar inte snapshoten som skickades in', () => {
    const snapshot = { ...BASE };
    mergeWorkOrderSnapshotOverrides(snapshot, { contact: { contact_name: 'Ny', phone: null, email: null } });
    expect(snapshot.contact_name).toBe('Birgitta Ling');
  });

  it('tom snapshot går igenom utan att kasta', () => {
    expect(mergeWorkOrderSnapshotOverrides(null, { your_reference: 'Ref' })).toEqual({ your_reference: 'Ref' });
    expect(mergeWorkOrderSnapshotOverrides(undefined, {})).toEqual({});
  });
});

describe('mergeWorkOrderSnapshotOverrides — Er referens vs kundkontakt', () => {
  it('en kontaktändring skriver INTE om Er referens', () => {
    const merged = mergeWorkOrderSnapshotOverrides(BASE, {
      contact: { contact_name: 'Platschef Karl', phone: '070-555 44 33', email: null },
    });

    expect(merged.contact_name).toBe('Platschef Karl');
    expect(merged.phone).toBe('070-555 44 33');
    // Den här raden ÄR buggen uppdelningen finns för: rättar man ett telefonnummer får kundens
    // fakturareferens inte följa med, för den styr fakturan till rätt attestant.
    expect(merged.your_reference).toBe('Birgitta Ling');
  });

  it('äldre order utan your_reference: det gamla contact_name fryses som referens', () => {
    const legacy = { contact_name: 'Gammal Referens', phone: '070-000 00 00' };
    const merged = mergeWorkOrderSnapshotOverrides(legacy, {
      contact: { contact_name: 'Ny Kontakt', phone: null, email: null },
    });

    expect(merged.contact_name).toBe('Ny Kontakt');
    expect(merged.your_reference).toBe('Gammal Referens');
  });

  it('uttryckligen skickad referens vinner över frysningen', () => {
    const legacy = { contact_name: 'Gammal Referens' };
    const merged = mergeWorkOrderSnapshotOverrides(legacy, {
      contact: { contact_name: 'Ny Kontakt', phone: null, email: null },
      your_reference: 'Vald Referens',
    });

    expect(merged.your_reference).toBe('Vald Referens');
  });

  it('your_reference: null rensar, undefined rör inte', () => {
    expect(mergeWorkOrderSnapshotOverrides(BASE, { your_reference: null }).your_reference).toBeNull();
    // Utelämnad nyckel = "rör inte kolumnen". Skickade vi null här hade varje statusändring
    // rensat kundens fakturareferens.
    expect(mergeWorkOrderSnapshotOverrides(BASE, {}).your_reference).toBe('Birgitta Ling');
  });
});

describe('mergeWorkOrderSnapshotOverrides — märkningen', () => {
  it('sätts och rör inget annat', () => {
    const merged = mergeWorkOrderSnapshotOverrides(BASE, { label: 'Projekt 4711' });
    expect(merged.label).toBe('Projekt 4711');
    expect(merged.your_reference).toBe('Birgitta Ling');
    expect(merged.organization_number).toBe('556677-8899');
  });

  // ── Minnet av en tömning ────────────────────────────────────────────────────
  //
  // 🧨 Att TA BORT märkningen måste nå kundens dokument, och det kräver att Fortnox-headern
  // skickar `null` — ett utelämnat fält lämnar deras värde orört. Men "tom märkning" duger inte
  // som signal: buildCustomerSnapshot skriver alltid nyckeln, så tomt är normalläget för i stort
  // sett varje order. Bara ÖVERGÅNGEN betyder att en människa tog bort något, och bara den här
  // funktionen ser den.
  it('tömning av en satt märkning sätter label_cleared', () => {
    const merged = mergeWorkOrderSnapshotOverrides({ ...BASE, label: 'Projekt 4711' }, { label: null });
    expect(merged.label).toBeNull();
    expect(merged.label_cleared).toBe(true);
  });

  // 🧨 Utan det här skulle rensningen begäras på VARENDA order utan märkning — inklusive de vars
  // referensnummer någon satt för hand i Fortnox.
  it('spara med tom märkning på en order som aldrig haft någon sätter inget', () => {
    const merged = mergeWorkOrderSnapshotOverrides({ ...BASE, label: null }, { label: null });
    expect(merged.label_cleared).toBe(false);
  });

  // 🧨 TILLSTÅND, INTE ENGÅNGSSIGNAL. Går PUT:en inte fram måste nästa synk kunna ta om den —
  // annars stämplar nästa artikelredigering 'synced' medan Fortnox bär den gamla märkningen.
  it('minnet överlever en sparning som inte rör märkningen', () => {
    const cleared = { ...BASE, label: null, label_cleared: true };
    expect(mergeWorkOrderSnapshotOverrides(cleared, { your_reference: 'Ref' }).label_cleared).toBe(true);
    // …och en ny tom sparning håller det vid liv tills en märkning sätts igen.
    expect(mergeWorkOrderSnapshotOverrides(cleared, { label: null }).label_cleared).toBe(true);
  });

  it('ett nytt värde upphäver minnet', () => {
    const cleared = { ...BASE, label: null, label_cleared: true };
    const merged = mergeWorkOrderSnapshotOverrides(cleared, { label: 'Projekt 9000' });
    expect(merged.label).toBe('Projekt 9000');
    expect(merged.label_cleared).toBe(false);
  });

  it('utelämnad märkning rör varken värdet eller minnet', () => {
    const legacy = { customer_name: 'Gammal AB' };
    const merged = mergeWorkOrderSnapshotOverrides(legacy, { your_reference: 'Ref' });
    expect('label' in merged).toBe(false);
    expect('label_cleared' in merged).toBe(false);
    expect(mergeWorkOrderSnapshotOverrides({ ...BASE, label: 'P-1' }, {}).label).toBe('P-1');
  });
});

describe('mergeWorkOrderSnapshotOverrides — slutkunden på plats', () => {
  it('sätts utan att röra kundens kontakt', () => {
    const merged = mergeWorkOrderSnapshotOverrides(BASE, {
      end_contact: {
        end_contact_name: 'Fastighetsägaren Ulla',
        end_contact_phone: '070-333 22 11',
        end_contact_email: null,
      },
    });

    expect(merged.end_contact_name).toBe('Fastighetsägaren Ulla');
    expect(merged.end_contact_phone).toBe('070-333 22 11');
    expect(merged.end_contact_email).toBeNull();
    // Kundens kontakt är en ANNAN person och står kvar orörd.
    expect(merged.contact_name).toBe('Birgitta Ling');
    expect(merged.phone).toBe('070-111 22 33');
  });

  it('tomma fält RENSAR — annars går en felaktig slutkund inte att ta bort', () => {
    const withEnd = { ...BASE, end_contact_name: 'Fel Person', end_contact_phone: '070-000', end_contact_email: 'fel@x.se' };
    const merged = mergeWorkOrderSnapshotOverrides(withEnd, {
      end_contact: { end_contact_name: null, end_contact_phone: null, end_contact_email: null },
    });

    // 🧨 Det här är hela krysset i ordervyn. Skrev funktionen bara när det fanns ett värde skulle
    // toggeln vara enkelriktad, och slutkunden — som VINNER över kundkontakten i det
    // installatörerna ser — hade suttit fast på ordern för alltid.
    expect(merged.end_contact_name).toBeNull();
    expect(merged.end_contact_phone).toBeNull();
    expect(merged.end_contact_email).toBeNull();
  });

  it('utelämnat objekt rör inte en befintlig slutkund', () => {
    const withEnd = { ...BASE, end_contact_name: 'Ulla' };
    const merged = mergeWorkOrderSnapshotOverrides(withEnd, { contact: { contact_name: 'Ny', phone: null, email: null } });
    expect(merged.end_contact_name).toBe('Ulla');
  });
});

describe('mergeWorkOrderSnapshotOverrides — flera överlagringar i samma PATCH', () => {
  it('alla tre landar; ingen äter en annan', () => {
    // Formuläret sparar allt på en gång, så det här är NORMALFALLET — inte ett kantfall.
    const merged = mergeWorkOrderSnapshotOverrides(BASE, {
      contact: { contact_name: 'Platschef Karl', phone: '070-555 44 33', email: 'karl@bygg.se' },
      your_reference: 'Ekonomi Attest',
      end_contact: { end_contact_name: 'Ulla', end_contact_phone: '070-333 22 11', end_contact_email: null },
    });

    expect(merged.contact_name).toBe('Platschef Karl');
    expect(merged.phone).toBe('070-555 44 33');
    expect(merged.email).toBe('karl@bygg.se');
    expect(merged.your_reference).toBe('Ekonomi Attest');
    expect(merged.end_contact_name).toBe('Ulla');
    expect(merged.end_contact_phone).toBe('070-333 22 11');
    // …och grunden står kvar.
    expect(merged.organization_number).toBe('556677-8899');
    expect(merged.reverse_vat).toBe(true);
  });

  it('rensa slutkunden och byta kontakt samtidigt fungerar', () => {
    const withEnd = { ...BASE, end_contact_name: 'Fel Person', end_contact_phone: '070-000', end_contact_email: null };
    const merged = mergeWorkOrderSnapshotOverrides(withEnd, {
      contact: { contact_name: 'Rätt Kontakt', phone: '070-777 66 55', email: null },
      end_contact: { end_contact_name: null, end_contact_phone: null, end_contact_email: null },
    });

    expect(merged.contact_name).toBe('Rätt Kontakt');
    expect(merged.end_contact_name).toBeNull();
    expect(merged.end_contact_phone).toBeNull();
  });
});

// ── ROT-uppgifterna på arbetsordern ──────────────────────────────────────────
//
// Ordern äger dem (resolveOrderRotDetails): offerten är vad kunden bad om, ordern är sanningen om
// vad vi fakturerar — och offerten är låst så fort ordern finns.
describe('mergeWorkOrderRotDetails', () => {
  // 🧨 PERSONNUMRET FÅR ALDRIG FÖRSVINNA. Det redigeras inte här (det bor på kundkortet) och står
  // varken i klientens payload eller i Zod-schemat — så det kan bara överleva genom att kopieras
  // vidare. Ett tappat nummer dödar ROT-avdraget TYST i Fortnox.
  const CURRENT = {
    enabled: true,
    applicant_name: 'Anna Andersson',
    personal_number: '199001011234',
    property_designation: 'Haggården 6:3',
    rot_percent: 30,
    max_deduction: 50000,
    brf_org_number: null,
  };

  it('bevarar applicant_name och personal_number', () => {
    const merged = mergeWorkOrderRotDetails(CURRENT, { property_designation: 'Nytorp 1:12' });
    expect(merged.personal_number).toBe('199001011234');
    expect(merged.applicant_name).toBe('Anna Andersson');
    expect(merged.property_designation).toBe('Nytorp 1:12');
  });

  it('rör bara nycklar som faktiskt skickats', () => {
    // En sparning som bara ändrar procenten får inte nolla beteckningen.
    const merged = mergeWorkOrderRotDetails(CURRENT, { rot_percent: 50 });
    expect(merged.rot_percent).toBe(50);
    expect(merged.property_designation).toBe('Haggården 6:3');
    expect(merged.enabled).toBe(true);
  });

  it('null skriver — en tömd beteckning ska bli tömd', () => {
    const merged = mergeWorkOrderRotDetails(CURRENT, { property_designation: null });
    expect(merged.property_designation).toBeNull();
  });

  it('enabled: false skrivs, inte tolkat som "rör inte"', () => {
    expect(mergeWorkOrderRotDetails(CURRENT, { enabled: false }).enabled).toBe(false);
  });

  it('tom nuvarande går igenom utan att kasta', () => {
    expect(mergeWorkOrderRotDetails(null, { enabled: true })).toEqual({ enabled: true });
    expect(mergeWorkOrderRotDetails({}, {})).toEqual({});
  });

  it('muterar inte indatan', () => {
    const current = { ...CURRENT };
    mergeWorkOrderRotDetails(current, { rot_percent: 50 });
    expect(current.rot_percent).toBe(30);
  });
});

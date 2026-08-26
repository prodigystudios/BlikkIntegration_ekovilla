import { describe, it, expect, vi } from 'vitest';

// Modulen importerar getSupabaseAdmin på toppnivå. Rörs inte här, men måste finnas för importen.
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => null }));

import { mergeWorkOrderSnapshotOverrides } from '@/lib/domains/crm/work-orders';

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

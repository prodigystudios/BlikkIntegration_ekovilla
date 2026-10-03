import { describe, expect, it } from 'vitest';
import { fixPropertyDesignationTyping, normalizePropertyDesignation } from '@/lib/domains/crm/propertyDesignation';
import { createCrmQuoteSchema } from '@/app/api/crm/quotes/_lib';
import { updateCrmWorkOrderSchema } from '@/app/api/crm/work-orders/_lib';
import { buildTaxReductionPayload } from '@/lib/domains/fortnox/taxReductions';

// Fastighetsbeteckningen skrivs Block:Enhet. Fortnox API tar emot "3;15", men husarbetesfliken går
// sedan inte att spara (William, 2026-10-03) — felet syns först när ekonomi ska skicka begäran.
describe('fastighetsbeteckningen', () => {
  it('rättar semikolon till kolon medan man skriver, utan att röra mellanslagen', () => {
    expect(fixPropertyDesignationTyping('villa serum 3;15')).toBe('villa serum 3:15');
    expect(fixPropertyDesignationTyping('Haggården 6;3 ')).toBe('Haggården 6:3 ');
    expect(fixPropertyDesignationTyping('Haggården 6:3')).toBe('Haggården 6:3');
  });

  it('det som sparas: kolon, ihopslagna blanktecken, trimmat — tomt blir null', () => {
    expect(normalizePropertyDesignation('  villa  serum\t3;15 ')).toBe('villa serum 3:15');
    expect(normalizePropertyDesignation('Stockholm Ekudden 1:23')).toBe('Stockholm Ekudden 1:23');
    expect(normalizePropertyDesignation('   ')).toBeNull();
    expect(normalizePropertyDesignation(null)).toBeNull();
  });

  // Det som SPARAS ska vara rätt, oavsett vad klienten skickar — formulärets rättelse är bekvämlighet.
  it('offertens schema sparar beteckningen med kolon', () => {
    const parsed = createCrmQuoteSchema.safeParse({
      project_name: 'Vind', customer_name: 'Tolvan', quote_type: 'private', amount: 0, quote_date: '2026-10-03',
      rot_details: { enabled: true, property_designation: 'villa serum 3;15' },
    });
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    expect(parsed.success && parsed.data.rot_details?.property_designation).toBe('villa serum 3:15');
  });

  it('arbetsorderns schema sparar beteckningen med kolon — och tom är fortfarande tömbar', () => {
    const parsed = updateCrmWorkOrderSchema.safeParse({ status: 'scheduled', rot_details: { property_designation: 'Haggården 6;3' } });
    expect(parsed.success && parsed.data.rot_details?.property_designation).toBe('Haggården 6:3');
    const cleared = updateCrmWorkOrderSchema.safeParse({ status: 'scheduled', rot_details: { property_designation: '' } });
    expect(cleared.success && cleared.data.rot_details?.property_designation).toBeNull();
  });

  // En beteckning sparad före saneringen ska ändå nå skattereduktionsposten rätt.
  it('skattereduktionsposten får kolon även för en gammal beteckning med semikolon', () => {
    const { TaxReduction } = buildTaxReductionPayload('OFFER', '55', 100, { name: 'Tolvan', personalNumber: '19121212-1212' }, {
      propertyDesignation: 'villa serum 3;15', brfOrgNumber: null,
    });
    expect(TaxReduction.PropertyDesignation).toBe('villa serum 3:15');
  });
});

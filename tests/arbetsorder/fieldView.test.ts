import { describe, it, expect } from 'vitest';
import { callablePhone, fieldViewHeading } from '@/app/arbetsorder/fieldView';

// Fältvyns huvud: gatan som rubrik, projektnamnet bara när det säger något mer.

describe('fieldViewHeading', () => {
  it('gör gatan till rubrik och postnummer + ort till raden under', () => {
    const heading = fieldViewHeading('Vindsisolering', { street_address: 'Strandgatan 9', postal_code: '814 30', city: 'Skutskär' });
    expect(heading.title).toBe('Strandgatan 9');
    expect(heading.place).toBe('814 30, Skutskär');
    expect(heading.mapsQuery).toBe('Strandgatan 9, 814 30, Skutskär');
  });

  it('behåller projektnamnet som egen rad när det säger något gatan inte säger', () => {
    expect(fieldViewHeading('Strandgatan 9 – snedtak', { street_address: 'Strandgatan 9', city: 'Skutskär' }).project).toBe('Strandgatan 9 – snedtak');
    expect(fieldViewHeading('Vindsisolering', { street_address: 'Strandgatan 9' }).project).toBe('Vindsisolering');
  });

  it('släpper projektnamnet när det bara upprepar gatan', () => {
    expect(fieldViewHeading('Strandgatan 9, Skutskär', { street_address: 'Strandgatan 9', postal_code: '814 30', city: 'Skutskär' }).project).toBeNull();
    expect(fieldViewHeading('strandgatan 9', { street_address: 'Strandgatan 9' }).project).toBeNull();
  });

  it('gör projektnamnet till rubrik när gatan saknas, som innan', () => {
    const heading = fieldViewHeading('Vindsisolering Andersson', { street_address: '  ', postal_code: null, city: 'Skutskär' });
    expect(heading.title).toBe('Vindsisolering Andersson');
    // Namnet står redan som rubrik — inte en gång till under den.
    expect(heading.project).toBeNull();
    expect(heading.place).toBe('Skutskär');
    expect(heading.mapsQuery).toBe('Skutskär');
  });

  it('har ingen vägbeskrivning när adressen saknas helt', () => {
    const heading = fieldViewHeading('Vindsisolering', null);
    expect(heading.title).toBe('Vindsisolering');
    expect(heading.place).toBeNull();
    expect(heading.mapsQuery).toBeNull();
  });

  it('visar leveransadressen bara när den finns', () => {
    expect(fieldViewHeading('X', { street_address: 'Gatan 1', delivery_address: 'Lagret, Industrivägen 4' }).delivery).toBe('Lagret, Industrivägen 4');
    expect(fieldViewHeading('X', { street_address: 'Gatan 1', delivery_address: ' ' }).delivery).toBeNull();
  });
});

describe('callablePhone', () => {
  it('släpper igenom ett nummer med siffror', () => {
    expect(callablePhone('070-123 45 67')).toBe('070-123 45 67');
  });

  it('stoppar fritext utan siffror, som annars blir en tel:-länk som inte ringer', () => {
    expect(callablePhone('ring växeln')).toBeNull();
    expect(callablePhone('')).toBeNull();
    expect(callablePhone(null)).toBeNull();
  });
});

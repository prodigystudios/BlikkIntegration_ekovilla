import { describe, it, expect } from 'vitest';
import { canStepBackInApp, fieldViewHeading } from '@/app/arbetsorder/fieldView';

// Fältvyns huvud: gatan som rubrik, projektnamnet bara när det säger något mer.

describe('fieldViewHeading', () => {
  it('gör gatan till rubrik och postnummer + ort till raden under', () => {
    const heading = fieldViewHeading('Vindsisolering', { street_address: 'Strandgatan 9', postal_code: '814 30', city: 'Skutskär' });
    expect(heading.title).toBe('Strandgatan 9');
    // Mellanslag som på ett kuvert, inte komma.
    expect(heading.place).toBe('814 30 Skutskär');
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

describe('canStepBackInApp', () => {
  const origin = 'https://app.ekovilla.se';
  const here = `${origin}/arbetsorder/abc?segment=s1`;

  it('backar efter en navigering inom appen (dokumentet laddades på en annan adress)', () => {
    expect(canStepBackInApp({ origin, referrer: '', documentUrl: `${origin}/mina-jobb`, currentUrl: here })).toBe(true);
    expect(canStepBackInApp({ origin, referrer: 'https://mail.google.com/', documentUrl: `${origin}/`, currentUrl: here })).toBe(true);
  });

  it('backar efter en hård laddning från en av våra egna sidor (stoppkortets <a href>)', () => {
    expect(canStepBackInApp({ origin, referrer: `${origin}/`, documentUrl: here, currentUrl: here })).toBe(true);
  });

  it('backar inte ut ur appen — länk ur ett mejl, en notis, en ny flik', () => {
    expect(canStepBackInApp({ origin, referrer: 'https://mail.google.com/', documentUrl: here, currentUrl: here })).toBe(false);
    expect(canStepBackInApp({ origin, referrer: '', documentUrl: here, currentUrl: here })).toBe(false);
    expect(canStepBackInApp({ origin, referrer: '', documentUrl: null, currentUrl: here })).toBe(false);
  });

  it('backar aldrig till inloggningen, varken efter omladdningen eller en klientnavigering därifrån', () => {
    // Inloggningen laddar om hela sidan: föregående sida är /auth/sign-in.
    expect(canStepBackInApp({ origin, referrer: `${origin}/auth/sign-in?next=%2Farbetsorder%2Fabc`, documentUrl: here, currentUrl: here })).toBe(false);
    expect(canStepBackInApp({ origin, referrer: '', documentUrl: `${origin}/auth/sign-in`, currentUrl: here })).toBe(false);
  });

  it('räknar en flik- eller sökparameterändring på samma sida som samma dokument', () => {
    expect(canStepBackInApp({ origin, referrer: '', documentUrl: `${origin}/arbetsorder/abc`, currentUrl: here })).toBe(false);
  });

  it('klarar trasiga värden utan att kasta', () => {
    expect(canStepBackInApp({ origin, referrer: 'inte en adress', documentUrl: 'inte heller', currentUrl: here })).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { safeReturnTo, withReturnTo } from '@/app/crm/lib/returnTo';

// `returnTo` kommer från URL:en och är alltså användarstyrt. Spärren är det enda som står mellan
// en detaljvys tillbaka-knapp och en öppen vidarebefordran ut ur appen.

describe('safeReturnTo', () => {
  it('godtar app-interna CRM-sökvägar', () => {
    expect(safeReturnTo('/crm/planering')).toBe('/crm/planering');
    expect(safeReturnTo('/crm/saljtavla?quote_id=abc')).toBe('/crm/saljtavla?quote_id=abc');
    expect(safeReturnTo('/crm/arbetsorder/123')).toBe('/crm/arbetsorder/123');
  });

  it('avvisar absoluta adresser', () => {
    expect(safeReturnTo('https://evil.example/crm/')).toBeNull();
    expect(safeReturnTo('http://evil.example')).toBeNull();
  });

  // Webbläsaren behandlar dessa som EXTERNA trots att de börjar med snedstreck — det är den
  // klassiska vägen förbi en naiv "börjar med /"-kontroll.
  it('avvisar protokollrelativa adresser', () => {
    expect(safeReturnTo('//evil.example')).toBeNull();
    expect(safeReturnTo('/\\evil.example')).toBeNull();
  });

  it('avvisar app-interna sökvägar utanför CRM', () => {
    expect(safeReturnTo('/admin')).toBeNull();
    expect(safeReturnTo('/api/crm/quotes')).toBeNull();
    expect(safeReturnTo('/crmx/fake')).toBeNull();
  });

  it('avvisar tomt och saknat värde', () => {
    expect(safeReturnTo(null)).toBeNull();
    expect(safeReturnTo(undefined)).toBeNull();
    expect(safeReturnTo('')).toBeNull();
  });
});

describe('withReturnTo', () => {
  it('lägger på ? när länken saknar frågesträng', () => {
    expect(withReturnTo('/crm/arbetsorder/1', '/crm/planering'))
      .toBe('/crm/arbetsorder/1?returnTo=%2Fcrm%2Fplanering');
  });

  it('lägger på & när länken redan har en frågesträng', () => {
    expect(withReturnTo('/crm/offerter/1/redigera?x=1', '/crm/saljtavla'))
      .toBe('/crm/offerter/1/redigera?x=1&returnTo=%2Fcrm%2Fsaljtavla');
  });

  // Tavlans returnTo bär sitt eget quote_id — kodas det inte tolkas det som en parameter till
  // offertformuläret i stället, och kortet återöppnas aldrig.
  it('kodar frågesträngen i destinationen', () => {
    const url = withReturnTo('/crm/offerter/1/redigera', '/crm/saljtavla?quote_id=abc');
    expect(url).toBe('/crm/offerter/1/redigera?returnTo=%2Fcrm%2Fsaljtavla%3Fquote_id%3Dabc');
    expect(new URLSearchParams(url.split('?')[1]).get('returnTo')).toBe('/crm/saljtavla?quote_id=abc');
  });

  it('tur och retur genom safeReturnTo bevarar värdet', () => {
    const original = '/crm/saljtavla?quote_id=abc';
    const url = withReturnTo('/crm/offerter/1/redigera', original);
    const parsed = new URLSearchParams(url.split('?')[1]).get('returnTo');
    expect(safeReturnTo(parsed)).toBe(original);
  });
});

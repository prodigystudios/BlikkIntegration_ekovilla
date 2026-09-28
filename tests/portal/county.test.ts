import { describe, it, expect, vi } from 'vitest';
import { SWEDISH_COUNTIES } from '@/lib/domains/crm/routingRules';
import {
  COUNTY_BY_ISO,
  countyFromIso,
  countyFromName,
  countyFromNominatim,
  countyLookupUrl,
  lookupCounty,
} from '@/lib/domains/portal/county';

/**
 * Länet för steg 3 i fördelningen (fas 3a). Det som skyddas:
 *   - ISO-tabellen täcker exakt routingreglernas 21 län, ett till ett: ett län som saknas hade aldrig fått sina jobb;
 *   - frågan till Nominatim bär postnummer och ort, aldrig gatan (fas 0: en gatufråga träffade fel hus);
 *   - ett fel, en timeout eller ett konstigt svar ger null och aldrig ett kast, så att fördelningen går vidare.
 */

describe('ISO-tabellen', () => {
  it('täcker exakt routingreglernas län, ett till ett', () => {
    const counties = Object.values(COUNTY_BY_ISO);
    expect(new Set(counties)).toEqual(new Set(SWEDISH_COUNTIES));
    expect(counties).toHaveLength(SWEDISH_COUNTIES.length);
    for (const code of Object.keys(COUNTY_BY_ISO)) expect(code).toMatch(/^SE-[A-Z]{1,2}$/);
  });

  it('fas 0:s stickprov: Gävle är SE-X, Gävleborg', () => {
    expect(countyFromIso('SE-X')).toBe('Gävleborg');
    expect(countyFromIso(' se-ab ')).toBe('Stockholm');
    expect(countyFromIso('SE-Q')).toBeNull();
    expect(countyFromIso(undefined)).toBeNull();
  });
});

describe('countyFromName', () => {
  it.each([
    ['Gävleborgs län', 'Gävleborg'],
    ['Dalarnas län', 'Dalarna'],
    ['Skåne län', 'Skåne'],
    ['Västra Götalands län', 'Västra Götaland'],
    ['Örebro län', 'Örebro'],
    ['Stockholms län', 'Stockholm'],
    ['Gotlands län', 'Gotland'],
  ])('%s → %s', (name, county) => {
    expect(countyFromName(name)).toBe(county);
  });

  it.each(['Gävle kommun', 'Oslo', '', null, 42])('%s → null', (name) => {
    expect(countyFromName(name)).toBeNull();
  });
});

describe('countyFromNominatim', () => {
  const hit = (address: Record<string, unknown>) => [{ address }];

  it('ISO-koden först, namnet som reserv', () => {
    expect(countyFromNominatim(hit({ 'ISO3166-2-lvl4': 'SE-X', county: 'Gävleborgs län', country_code: 'se' }))).toBe('Gävleborg');
    expect(countyFromNominatim(hit({ county: 'Dalarnas län', country_code: 'se' }))).toBe('Dalarna');
    // En felaktig kod faller tillbaka på namnet.
    expect(countyFromNominatim(hit({ 'ISO3166-2-lvl4': 'SE-QQ', county: 'Skåne län' }))).toBe('Skåne');
  });

  it('ett svar utanför Sverige, utan träff eller utan adress ger null', () => {
    expect(countyFromNominatim(hit({ 'ISO3166-2-lvl4': 'NO-03', country_code: 'no' }))).toBeNull();
    // Ett svenskt länsnamn i ett danskt svar räknas inte.
    expect(countyFromNominatim(hit({ county: 'Skåne län', 'ISO3166-2-lvl4': 'SE-M', country_code: 'dk' }))).toBeNull();
    expect(countyFromNominatim([])).toBeNull();
    expect(countyFromNominatim({})).toBeNull();
    expect(countyFromNominatim([{}])).toBeNull();
    expect(countyFromNominatim(null)).toBeNull();
  });
});

describe('frågan', () => {
  it('postnummer och ort, bara Sverige, en träff, aldrig gatan', () => {
    const url = new URL(countyLookupUrl({ postalCode: ' 806 28 ', city: 'Gävle' }));
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(url.searchParams.get('postalcode')).toBe('806 28');
    expect(url.searchParams.get('city')).toBe('Gävle');
    expect(url.searchParams.get('countrycodes')).toBe('se');
    expect(url.searchParams.get('addressdetails')).toBe('1');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.has('street')).toBe(false);
    expect(url.searchParams.has('q')).toBe(false);
  });

  it('en tom del tas inte med', () => {
    const url = new URL(countyLookupUrl({ postalCode: '', city: 'Gävle' }));
    expect(url.searchParams.has('postalcode')).toBe(false);
  });
});

describe('lookupCounty', () => {
  const place = { postalCode: '806 28', city: 'Gävle' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it('frågar med appens User-Agent och ger länet', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      json([{ address: { 'ISO3166-2-lvl4': 'SE-X', country_code: 'se' } }]),
    );
    expect(await lookupCounty(place, { fetchImpl })).toBe('Gävleborg');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('postalcode=806+28');
    expect((init!.headers as Record<string, string>)['User-Agent']).toBe('Ekovilla-CRM/1.0');
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('utan postnummer och ort frågas ingenting', async () => {
    const fetchImpl = vi.fn();
    expect(await lookupCounty({ postalCode: ' ', city: '' }, { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['ett felsvar', async () => json({ error: 'upptagen' }, 503)],
    // Ett felsvar tolkas aldrig, också om kroppen ser ut som en träff.
    ['ett felsvar med en träff i kroppen', async () => json([{ address: { 'ISO3166-2-lvl4': 'SE-X' } }], 500)],
    ['ett nätfel', async () => Promise.reject(new TypeError('fetch failed'))],
    ['en timeout', async () => Promise.reject(new DOMException('timeout', 'TimeoutError'))],
    ['ogiltig JSON', async () => new Response('<html>', { status: 200 })],
  ])('%s ger null, aldrig ett kast', async (_label, impl) => {
    await expect(lookupCounty(place, { fetchImpl: vi.fn(impl) as never })).resolves.toBeNull();
  });

  it('avbryts efter tidsgränsen', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))),
    );
    const started = Date.now();
    expect(await lookupCounty(place, { fetchImpl, timeoutMs: 50 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

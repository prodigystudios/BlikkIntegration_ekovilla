import { SWEDISH_COUNTIES, type SwedishCounty } from '@/lib/domains/crm/routingRules';

/**
 * Länet där ett jobb från portalen utförs, för steg 3 i fördelningen (RESELLER_PORTAL_CRM_PLAN.md fas 3a):
 * säljaren för länet i `crm_routing_rules`. Ingenting i CRM:et tar i dag fram ett län ur en adress.
 *
 * Nominatim (OpenStreetMap), som `app/api/geocode` redan använder, frågat med POSTNUMMER OCH ORT, inte gatan: en
 * gatufråga träffade en annan husadress med ett annat postnummer, men postnummer och ort räcker för länet (fas 0).
 * Svaret har `ISO3166-2-lvl4` ("SE-X"), som översätts med en fast tabell till routingreglernas namn. Saknas det
 * prövas `county` ("Gävleborgs län").
 *
 * Ett fel, en timeout eller ett svar utan län ger null, aldrig ett kast: fördelningen går då vidare till reserven.
 */

/** Länskoderna i ISO 3166-2:SE → namnen i `SWEDISH_COUNTIES`. Prövat mot Nominatim 2026-09-27 (fas 0). */
export const COUNTY_BY_ISO: Readonly<Record<string, SwedishCounty>> = {
  'SE-AB': 'Stockholm',
  'SE-AC': 'Västerbotten',
  'SE-BD': 'Norrbotten',
  'SE-C': 'Uppsala',
  'SE-D': 'Södermanland',
  'SE-E': 'Östergötland',
  'SE-F': 'Jönköping',
  'SE-G': 'Kronoberg',
  'SE-H': 'Kalmar',
  'SE-I': 'Gotland',
  'SE-K': 'Blekinge',
  'SE-M': 'Skåne',
  'SE-N': 'Halland',
  'SE-O': 'Västra Götaland',
  'SE-S': 'Värmland',
  'SE-T': 'Örebro',
  'SE-U': 'Västmanland',
  'SE-W': 'Dalarna',
  'SE-X': 'Gävleborg',
  'SE-Y': 'Västernorrland',
  'SE-Z': 'Jämtland',
};

export const COUNTY_LOOKUP_TIMEOUT_MS = 3000;

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'Ekovilla-CRM/1.0';

function isCounty(value: string): value is SwedishCounty {
  return (SWEDISH_COUNTIES as readonly string[]).includes(value);
}

export function countyFromIso(code: unknown): SwedishCounty | null {
  return typeof code === 'string' ? (COUNTY_BY_ISO[code.trim().toUpperCase()] ?? null) : null;
}

/** "Gävleborgs län" → Gävleborg, "Dalarnas län" → Dalarna, "Skåne län" → Skåne. Annat → null. */
export function countyFromName(name: unknown): SwedishCounty | null {
  if (typeof name !== 'string') return null;
  const base = name.trim().replace(/\s+län$/i, '');
  if (isCounty(base)) return base;
  const withoutGenitive = base.replace(/s$/, '');
  return isCounty(withoutGenitive) ? withoutGenitive : null;
}

/** Länet i ett svar från Nominatim: ISO-koden först, sedan namnet. */
export function countyFromNominatim(body: unknown): SwedishCounty | null {
  const first = Array.isArray(body) ? body[0] : null;
  const address = first && typeof first === 'object' ? (first as { address?: Record<string, unknown> }).address : null;
  if (!address || typeof address !== 'object') return null;
  if (typeof address.country_code === 'string' && address.country_code.toLowerCase() !== 'se') return null;
  return countyFromIso(address['ISO3166-2-lvl4']) ?? countyFromName(address.county);
}

/** Adressen för frågan. Strukturerad: postnummer och ort, bara Sverige, en träff. */
export function countyLookupUrl(place: { postalCode: string; city: string }): string {
  const params = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    limit: '1',
    countrycodes: 'se',
  });
  if (place.postalCode.trim()) params.set('postalcode', place.postalCode.trim());
  if (place.city.trim()) params.set('city', place.city.trim());
  return `${NOMINATIM_SEARCH}?${params.toString()}`;
}

export async function lookupCounty(
  place: { postalCode: string; city: string },
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<SwedishCounty | null> {
  if (!place.postalCode.trim() && !place.city.trim()) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(countyLookupUrl(place), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? COUNTY_LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Ett spår när steg 3 hoppas över (t.ex. 429, Nominatims gräns är ett anrop i sekunden). Aldrig adressen.
      console.warn('[portal-county] Nominatim svarade', res.status);
      return null;
    }
    return countyFromNominatim(await res.json());
  } catch (e) {
    console.warn('[portal-county] länet gick inte att slå upp', e instanceof Error ? e.name : 'okänt fel');
    return null;
  }
}

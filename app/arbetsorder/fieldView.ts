import { joinAddress } from '@/app/crm/lib/format';
import { projectRepeatsAddress } from '@/lib/domains/planning/scheduleStops';

// Fältvyns huvud som rena funktioner: vad som blir rubrik och vilka rader som står under den.
// Ingen React, ingen I/O — komponenten ritar, reglerna bor här och testas för sig.

type WorkAddress = {
  street_address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  delivery_address?: string | null;
} | null | undefined;

export type FieldViewHeading = {
  /** H1. Gatuadressen, eller projektnamnet när ordern saknar gata. */
  title: string;
  /** Postnummer och ort, med mellanslag som på ett kuvert ("814 30 Skutskär"). null när båda saknas. */
  place: string | null;
  /** Projektnamnet som egen rad — bara när gatan är rubrik och namnet säger något mer. */
  project: string | null;
  /** Leveransadressen. Säckarna kan levereras någon annanstans än där man blåser. */
  delivery: string | null;
  /** Hela arbetsadressen för vägbeskrivningen. null = ingen adress att navigera till. */
  mapsQuery: string | null;
};

const clean = (value: string | null | undefined) => (value || '').trim() || null;

/**
 * Gatan som rubrik, eftersom det är den besättningen letar efter när de kör dit. Saknas gatan blir
 * projektnamnet rubrik, precis som innan.
 *
 * ⚠️ PROJEKTNAMNET FÅR INTE FÖRSVINNA bara för att gatan tog rubriken. Det bär ofta det enda som
 * skiljer två jobb på samma adress ("Strandgatan 9 – snedtak"). Det släpps bara när det upprepar
 * gatan — samma regel som startsidans stoppkort (projectRepeatsAddress), så de två ytorna aldrig
 * är oense om när namnet säger något.
 */
export function fieldViewHeading(projectName: string | null | undefined, address: WorkAddress): FieldViewHeading {
  const street = clean(address?.street_address);
  const postal = clean(address?.postal_code);
  const city = clean(address?.city);
  const place = [postal, city].filter(Boolean).join(' ') || null;
  const name = clean(projectName);
  // Kommaseparerad för kartsökningen och jämförelsen med projektnamnet — samma form som stoppkortet.
  const full = joinAddress([street, postal, city]);
  return {
    title: street ?? name ?? 'Arbetsorder',
    place,
    project: street && name && !projectRepeatsAddress(name, full) ? name : null,
    delivery: clean(address?.delivery_address),
    mapsQuery: full || null,
  };
}

/**
 * Kan "‹ Mitt schema" gå ETT STEG BAKÅT utan att lämna appen? Annars är länkens mål startsidan.
 *
 * Bakåt är bättre när det går: man landar där man var — schemat eller Mina jobb — med scrollen kvar.
 * Men `history.length > 1` säger bara att det finns historik, inte vems: en länk ur Gmail i en flik
 * med historik hade backat ut ur appen. Två fall räknas som säkra:
 *
 * 1. Man kom hit med en navigering INOM appen (en <Link>). Dokumentet laddades då på en annan adress
 *    än den man står på, så föregående post är appens egen.
 * 2. Sidan laddades hårt (stoppkortets <a href>) från en av våra egna sidor.
 *
 * ⚠️ INLOGGNINGEN RÄKNAS ALDRIG. Den laddar om hela sidan efter lyckad inloggning, så en länk öppnad
 * utloggad har /auth som föregående sida — och bakåt dit är fel i båda riktningar. Allt osäkert faller
 * till startsidan, där schemat står: ett falskt nej kostar bara scrollpositionen.
 */
export function canStepBackInApp(input: { origin: string; referrer: string; documentUrl: string | null; currentUrl: string }): boolean {
  const parse = (value: string | null) => {
    if (!value) return null;
    try { return new URL(value); } catch { return null; }
  };
  const loaded = parse(input.documentUrl);
  const current = parse(input.currentUrl);
  if (loaded && current && loaded.pathname !== current.pathname) {
    return !loaded.pathname.startsWith('/auth');
  }
  const referrer = parse(input.referrer);
  return !!referrer && referrer.origin === input.origin && !referrer.pathname.startsWith('/auth');
}

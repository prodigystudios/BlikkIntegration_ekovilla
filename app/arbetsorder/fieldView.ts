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
  /** Postnummer och ort. null när båda saknas. */
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
  const place = clean(joinAddress([address?.postal_code, address?.city]));
  const name = clean(projectName);
  const full = joinAddress([street, place]);
  return {
    title: street ?? name ?? 'Arbetsorder',
    place,
    project: street && name && !projectRepeatsAddress(name, full) ? name : null,
    delivery: clean(address?.delivery_address),
    mapsQuery: full || null,
  };
}

/**
 * Numret om det går att ringa, annars null.
 *
 * Telefonfälten är fritext. "Ring växeln" blir `tel:` utan siffror — en Ring-knapp som inte ringer
 * någonstans. Samma kontroll som stoppkortets stopCallLine.
 */
export function callablePhone(phone: string | null | undefined): string | null {
  return phone && /\d/.test(phone) ? phone : null;
}

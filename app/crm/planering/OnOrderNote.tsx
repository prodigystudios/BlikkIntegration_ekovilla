import { shortDayISO } from './planningDates';
import type { ShortfallCover } from '@/lib/domains/planning/depotForecast';

// "N säck på väg" för en rad i bristbanderollen och i prognoskortet. En komponent, två ställen: samma
// lass ska inte beskrivas på två sätt beroende på var man tittar.
//
// Reglerna (vad som är för sent, vad som väntas idag, vad som täcker) bor i describeShortfallCover och är
// testade där. Här väljs bara ord och färg.
export default function OnOrderNote({ cover }: { cover: ShortfallCover | null }) {
  if (!cover || cover.on_order === 0 || !cover.next_arrival) return null;
  return (
    <span>
      {' · '}
      {cover.on_order} säck på väg, väntas {shortDayISO(cover.next_arrival)}
      {cover.late?.all && <span className="font-semibold text-amber-700"> — kommer efter att depån tar slut</span>}
      {cover.late && !cover.late.all && (
        <span className="font-semibold text-amber-700">
          {' '}
          — varav {cover.late.sacks} säck först {shortDayISO(cover.late.first_day)}, efter att depån tar slut
        </span>
      )}
      {cover.due_today > 0 && (
        <span className="font-semibold text-amber-700">
          {' '}
          — {cover.due_today} säck väntas idag och räknas först när ankomsten är bekräftad
        </span>
      )}
      {cover.covered && <span> — täcker bristen</span>}
    </span>
  );
}

import { netAmount, type NetAmountRow } from './pricing';
import type { CrmQuoteStatus } from './quotes';

// Hit rate: vunna ÷ ALLA offerter. En egen, liten modul så att regeln finns på ETT ställe och kan
// användas både av rapportens nyckeltal (reportKpis.ts) och av säljartabellen (reports.ts) — de två
// importerar varandra annars i en cirkel.
//
// ⚠️ BYGGER BARA PÅ VUNNEN, som systemet sätter när en order skapas från offerten (Williams beslut
// 2026-10-07). Skickad, Förlorad och Utkast beror på säljaren, och hit rate drar inga slutsatser av dem.

const WON: CrmQuoteStatus = 'won';

function sumNet(rows: NetAmountRow[]): number {
  return rows.reduce((total, row) => total + netAmount(row), 0);
}

export type HitRateQuoteRow = NetAmountRow & { status: string | null };

export type HitRate = {
  /** Alla offerter i underlaget, oavsett status — utkast, skickade, förlorade och utgångna. */
  quotes: number;
  /** Offerter med status Vunnen. */
  won: number;
  /** Vunna av antalet, i procent. null när underlaget saknar offerter. */
  percent: number | null;
  quoteValue: number;
  wonValue: number;
  /** Vunnet av offertvärdet (netto), i procent. null när offertvärdet är 0. */
  valuePercent: number | null;
};

/**
 * Hit rate = vunna ÷ ALLA offerter, i antal och i kronor (netto).
 *
 * ⚠️ NÄMNAREN ÄR ALLA OFFERTER. Avfärdade varianter, prövade mot prod 2026-10-07:
 *   · "vunna av avgjorda" (vunna + förlorade) gav 95 %, eftersom nästan inga offerter markeras som
 *     förlorade — talet hade sagt ingenting,
 *   · "avgjort i perioden" blåses upp när antalet offerter växer,
 *   · en fast 30-dagarskohort blir tom för "Denna månad".
 *
 * Talet kan bli för lågt men aldrig för högt: 33 order har skapats utan koppling till en offert,
 * och hör en sådan till en öppen offert räknas den offerten inte som vunnen.
 */
export function buildHitRate(quotes: HitRateQuoteRow[]): HitRate {
  const won = quotes.filter((quote) => quote.status === WON);
  const quoteValue = sumNet(quotes);
  const wonValue = sumNet(won);
  return {
    quotes: quotes.length,
    won: won.length,
    percent: quotes.length > 0 ? (won.length / quotes.length) * 100 : null,
    quoteValue,
    wonValue,
    valuePercent: quoteValue > 0 ? (wonValue / quoteValue) * 100 : null,
  };
}

/**
 * Från vilken hit rate en säljares offerter troligen läggs in först när affären redan är klar — då
 * säger talet ingenting om hur säljaren säljer, och tabellen får en fotnot (spec 2026-10-07).
 */
export const LATE_ENTRY_HIT_RATE_PERCENT = 95;

/**
 * Ska säljarens hit rate få fotnoten? Jämför det AVRUNDADE talet, alltså det som står i tabellen:
 * 94,6 % visas som "95 %", och en 95 utan fotnot bredvid en 95 med hade sett ut som ett fel.
 */
export function suggestsLateEntry(hitRate: number | null): boolean {
  return hitRate != null && Math.round(hitRate) >= LATE_ENTRY_HIT_RATE_PERCENT;
}

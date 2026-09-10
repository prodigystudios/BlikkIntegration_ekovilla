// Sidindelad läsning, delad av planeringens lagerläsningar.
//
// ⚠️ PostgREST kapar ett svar vid projektets max-rows (mätt till 1000) UTAN att fela. En oskyddad
// select gör därför inte svaret ofullständigt — den gör det FEL, och åt olika håll beroende på
// vilken läsning som kapades: en kapad leveranslista sänker `delivered` och driver ÖVERbeställning,
// en kapad segmentlista sänker `planned` och tystar bristvarningen.

export type ReadError = { message: string } | null;

export const PAGE = 1000;

/**
 * Läser alla sidor av en fråga.
 *
 * Anroparen MÅSTE ge frågan en stabil och unik `.order()`. Utan den är det odefinierat vilka rader
 * som ligger på vilken sida, så rader kan både dubbleras och hoppas över mellan sidorna.
 *
 * Vid fel returneras INGA rader, inte de sidor som hann komma. Ett halvt underlag som ser komplett
 * ut är precis det felet som ska undvikas.
 */
export async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: ReadError }>,
): Promise<{ rows: T[]; error: ReadError }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { rows: [], error };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return { rows, error: null };
}

/**
 * Hur många id:n en `.in(...)` får bära per fråga.
 *
 * ⚠️ `.in()` LIGGER I URL:EN. En lista med tusentals uuid:n spränger querysträngen, och med
 * fail-closed-läsningar tar ett 414 ned hela lagervyn. 100 är samma tak som resten av repot
 * använder (app/crm/arbetsorder/useWorkOrderMargins.ts, app/api/crm/reports/route.ts) — håll det
 * gemensamt, ett eget tal här hade bara varit en till siffra att hålla reda på.
 */
export const IN_CHUNK = 100;

/** Delar en id-lista i portioner om IN_CHUNK. */
export function chunkIds(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(ids.slice(i, i + IN_CHUNK));
  return out;
}

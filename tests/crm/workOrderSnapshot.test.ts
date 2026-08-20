import { describe, it, expect } from 'vitest';
import { getWorkOrderReportedSacks, getWorkOrderSourceQuote } from '@/lib/domains/crm/work-orders';
import { makeSupabaseMock } from './helpers/supabase';

// Snabböversiktens två fakta på arbetsordern. Båda handlar om samma sak: att en siffra vi inte har
// inte får renderas som en siffra vi har.

describe('getWorkOrderReportedSacks', () => {
  const WO = 'wo-1';

  it('ger null när ingen rapport finns — inte 0', async () => {
    // Hela poängen. `0` påstår att inget material gick åt på jobbet; `null` säger att ingen
    // rapporterat. Rutan skriver ut det förra som "0 st" och det senare som "Ej rapporterat",
    // och i dag finns ingen väg att skriva en rapport alls — så varje order står på null.
    const supabase = makeSupabaseMock({ data: [], error: null });
    await expect(getWorkOrderReportedSacks(supabase as any, WO)).resolves.toBeNull();
  });

  it('ger 0 när någon faktiskt rapporterat noll säckar', async () => {
    // Skillnaden mot fallet ovan: här HAR någon svarat. `?? null` får inte svälja den nollan.
    const supabase = makeSupabaseMock({ data: [{ work_order_id: WO, sacks_blown: 0 }], error: null });
    await expect(getWorkOrderReportedSacks(supabase as any, WO)).resolves.toBe(0);
  });

  it('summerar rapporterna över orderns alla segment', async () => {
    const supabase = makeSupabaseMock({
      data: [
        { work_order_id: WO, sacks_blown: 12 },
        { work_order_id: WO, sacks_blown: 8 },
        // En annan orders rapport ska aldrig läcka in i den här summan.
        { work_order_id: 'wo-2', sacks_blown: 99 },
      ],
      error: null,
    });
    await expect(getWorkOrderReportedSacks(supabase as any, WO)).resolves.toBe(20);
  });

  it('läser numeriska strängar som tal — sacks_blown är numeric i Postgres', async () => {
    // numeric(10,2) kommer tillbaka som sträng över PostgREST. Utan Number() hade summan blivit
    // "128" av 1 + 28 i stället för 29.
    const supabase = makeSupabaseMock({
      data: [
        { work_order_id: WO, sacks_blown: '1' },
        { work_order_id: WO, sacks_blown: '28.00' },
      ],
      error: null,
    });
    await expect(getWorkOrderReportedSacks(supabase as any, WO)).resolves.toBe(29);
  });
});

describe('getWorkOrderSourceQuote', () => {
  it('returnerar offertens båda nummer så Källa kan visa en dokumentreferens', async () => {
    const supabase = makeSupabaseMock({
      data: { id: 'q-1', quote_number: 'OF-1024', fortnox_offer_number: '4711' },
      error: null,
    });
    await expect(getWorkOrderSourceQuote(supabase as any, 'q-1')).resolves.toEqual({
      id: 'q-1',
      quote_number: 'OF-1024',
      fortnox_offer_number: '4711',
    });
  });

  it('ger null när offerten inte går att läsa', async () => {
    // Raderad offert, eller en roll som inte får läsa den. Sidan faller då tillbaka på
    // documentRef(null, null) → "–", i stället för att krascha på en saknad rad.
    const supabase = makeSupabaseMock({ data: null, error: null });
    await expect(getWorkOrderSourceQuote(supabase as any, 'q-borta')).resolves.toBeNull();
  });
});

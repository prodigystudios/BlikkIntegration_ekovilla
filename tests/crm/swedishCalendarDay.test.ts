import { describe, it, expect } from 'vitest';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { buildWorkOrderNumber } from '@/lib/domains/crm/work-orders';
import { initialQuoteDates } from '@/app/crm/offerter/quoteSerializers';
import { getCurrentMonthStartDate, getCurrentWeekStartDate } from '@/lib/domains/crm/goals';

// Kalenderdatum i CRM ska vara den SVENSKA dagen, aldrig UTC-dygnet.
//
// Felet det vaktar mot, rapporterat i drift 2026-09-16: en order skapad strax efter midnatt
// daterades dagen innan, och offertdatumet gick vidare till Fortnox som OfferDate och trycktes som
// "Offertdatum" på kundens PDF — alltså ett datum som kunde ligga före förfrågan.
//
// 🕰️ Testerna skickar in ett EXPLICIT ögonblick i stället för att läsa klockan, och prövar båda
// sidorna av midnatt. Därför biter de i alla zoner: under `TZ=UTC` (CI och Vercel) hade ett test som
// läser `new Date()` inte kunnat skilja rätt från fel alls.

// 22:30Z den 15:e = 00:30 svensk tid den 16:e (sommartid, UTC+2).
const JUST_AFTER_SWEDISH_MIDNIGHT = new Date('2026-09-15T22:30:00Z');
// 21:30Z den 15:e = 23:30 svensk tid den 15:e — samma UTC-dygn, andra sidan om gränsen.
const JUST_BEFORE_SWEDISH_MIDNIGHT = new Date('2026-09-15T21:30:00Z');
// Vintertid (UTC+1): gränsen flyttar sig, så fönstret är 23:00–24:00 UTC.
const WINTER_JUST_AFTER_MIDNIGHT = new Date('2026-01-15T23:30:00Z');

describe('stockholmTodayISO', () => {
  it('🧨 ger den svenska dagen strax efter midnatt, inte UTC-dygnet', () => {
    expect(stockholmTodayISO(JUST_AFTER_SWEDISH_MIDNIGHT)).toBe('2026-09-16');
  });

  it('ger fortfarande gårdagen strax före midnatt', () => {
    expect(stockholmTodayISO(JUST_BEFORE_SWEDISH_MIDNIGHT)).toBe('2026-09-15');
  });

  it('följer med över sommartidsväxlingen — gränsen ligger inte fast i UTC', () => {
    expect(stockholmTodayISO(WINTER_JUST_AFTER_MIDNIGHT)).toBe('2026-01-16');
    // Samma klockslag på sommaren är redan nästa dag i Sverige.
    expect(stockholmTodayISO(new Date('2026-07-15T23:30:00Z'))).toBe('2026-07-16');
    // …medan 22:30Z bara är nästa dag på sommaren, inte på vintern.
    expect(stockholmTodayISO(new Date('2026-01-15T22:30:00Z'))).toBe('2026-01-15');
  });
});

describe('buildWorkOrderNumber', () => {
  it('🧨 stansar in den SVENSKA dagen i ordernumret', () => {
    // Numret står på följesedeln och i Fortnox och går aldrig att rätta i efterhand.
    expect(buildWorkOrderNumber('2ca7aa00-0000-4000-8000-000000000000', JUST_AFTER_SWEDISH_MIDNIGHT))
      .toBe('AO-20260916-2CA7AA');
  });

  it('behåller dagen före när klockan ännu inte passerat svensk midnatt', () => {
    expect(buildWorkOrderNumber('2ca7aa00-0000-4000-8000-000000000000', JUST_BEFORE_SWEDISH_MIDNIGHT))
      .toBe('AO-20260915-2CA7AA');
  });
});

describe('initialQuoteDates', () => {
  it('🧨 daterar offerten i svensk dag — den går vidare som OfferDate till kundens PDF', () => {
    expect(initialQuoteDates(JUST_AFTER_SWEDISH_MIDNIGHT).quote_date).toBe('2026-09-16');
  });

  it('räknar giltighetstiden från SAMMA dag som offertdatumet', () => {
    // Två klockavläsningar kunde hamna på var sin sida om midnatt och ge en dag för kort giltighet.
    const { quote_date, valid_until } = initialQuoteDates(JUST_AFTER_SWEDISH_MIDNIGHT);
    expect(quote_date).toBe('2026-09-16');
    expect(valid_until).toBe('2026-10-16');
  });
});

describe('målens periodnycklar', () => {
  it('🧨 månadsnyckeln pekar på rätt månad strax efter midnatt den 1:a', () => {
    // 22:30Z den 30 sep = 00:30 svensk tid den 1 okt. UTC-dygnet gav september, och ett sparat mål
    // hade då skrivit över septembers budget med oktobers siffror.
    expect(getCurrentMonthStartDate(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01');
    expect(getCurrentMonthStartDate(new Date('2026-09-30T21:30:00Z'))).toBe('2026-09-01');
  });

  it('veckonyckeln ger måndagen i den svenska veckan', () => {
    // 00:30 svensk tid måndag 21 sep — UTC-dygnet låg kvar på söndagen, alltså förra veckan.
    expect(getCurrentWeekStartDate(new Date('2026-09-20T22:30:00Z'))).toBe('2026-09-21');
    expect(getCurrentWeekStartDate(new Date('2026-09-20T21:30:00Z'))).toBe('2026-09-14');
  });
});

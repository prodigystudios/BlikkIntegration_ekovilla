import { describe, it, expect } from 'vitest';
import { ACTION_LIMIT, buildOverviewActions, staleCalls } from '@/app/crm/components/overview/overviewActions';

// Att agera på på CRM-översikten: vilka rader som syns, i vilken ordning, och varningen om en
// samtalslogg som legat stilla (flyttad hit ur kortet Senaste samtal 2026-10-05).

const NOW = Date.parse('2026-10-05T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const call = (user_id: string, days: number) => ({ user_id, call_at: daysAgo(days) });

const QUIET = { overdueTasks: 0, followUpCalls: 0, newProspects: 0, standaloneCalls: 0, quoteFollowUps: 0, staleCalls: null, seesWholeTeam: false };

describe('staleCalls', () => {
  it('tiger så länge något samtal är loggat de senaste sju dagarna', () => {
    expect(staleCalls({ callsLast7Days: 1, calls: [call('me', 9)], seesWholeTeam: false, userId: 'me', now: NOW })).toBeNull();
  });

  it('tiger när det inte finns några samtal alls att räkna dygn från', () => {
    expect(staleCalls({ callsLast7Days: 0, calls: [], seesWholeTeam: false, userId: 'me', now: NOW })).toBeNull();
  });

  it('räknar dygn från läsarens EGET senaste samtal, inte en kollegas', () => {
    const calls = [call('kollega', 8), call('me', 12)];
    expect(staleCalls({ callsLast7Days: 0, calls, seesWholeTeam: false, userId: 'me', now: NOW })).toEqual({ days: 12 });
  });

  it('räknar från lagets senaste samtal för den som ser hela laget', () => {
    const calls = [call('kollega', 8), call('me', 12)];
    expect(staleCalls({ callsLast7Days: 0, calls, seesWholeTeam: true, userId: 'me', now: NOW })).toEqual({ days: 8 });
  });

  // 🧨 Utlösaren är serverns räkning, inte listan: fem kollegarader får inte tysta påminnelsen.
  it('ljuder även när den egna raden fallit utanför de fem — utan att gissa dygnen', () => {
    const calls = [1, 2, 3, 4, 5].map(() => call('kollega', 9));
    expect(staleCalls({ callsLast7Days: 0, calls, seesWholeTeam: false, userId: 'me', now: NOW })).toEqual({ days: null });
  });
});

describe('buildOverviewActions', () => {
  it('inget att agera på ger en tom lista', () => {
    expect(buildOverviewActions(QUIET)).toEqual([]);
  });

  it('säger "du" till säljaren och "ingen" till den som ser hela laget', () => {
    expect(buildOverviewActions({ ...QUIET, staleCalls: { days: 9 } })[0].title).toBe('Du har inte loggat ett samtal på 9 dagar');
    expect(buildOverviewActions({ ...QUIET, staleCalls: { days: 9 }, seesWholeTeam: true })[0].title).toBe('Ingen har loggat ett samtal på 9 dagar');
    expect(buildOverviewActions({ ...QUIET, staleCalls: { days: null } })[0].title).toBe('Du har inte loggat ett samtal på över en vecka');
  });

  it('den stilla loggen leder till formuläret, inte bara till listan', () => {
    expect(buildOverviewActions({ ...QUIET, staleCalls: { days: 9 } })[0].href).toBe('/crm/samtal?log=1');
  });

  it('sena uppgifter först, sedan den stilla loggen, sedan uppföljningarna', () => {
    const titles = buildOverviewActions({ ...QUIET, overdueTasks: 2, staleCalls: { days: 9 }, quoteFollowUps: 1, newProspects: 3 }).map((action) => action.title);
    expect(titles).toEqual(['2 uppgifter är sena', 'Du har inte loggat ett samtal på 9 dagar', '1 offertläge väntar uppföljning']);
  });

  it(`visar högst ${ACTION_LIMIT} rader`, () => {
    const actions = buildOverviewActions({ ...QUIET, overdueTasks: 1, followUpCalls: 1, quoteFollowUps: 1, newProspects: 1, standaloneCalls: 1 });
    expect(actions).toHaveLength(ACTION_LIMIT);
    expect(actions.map((action) => action.title)).toEqual(['1 uppgift är sen', '1 samtal behöver nästa steg', '1 offertläge väntar uppföljning']);
  });
});

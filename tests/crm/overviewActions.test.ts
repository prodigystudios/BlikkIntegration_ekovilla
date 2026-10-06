import { describe, it, expect } from 'vitest';
import { buildOverviewActions, staleCalls } from '@/app/crm/components/overview/overviewActions';

// Att agera på på CRM-översikten: vilka rader som syns, i vilken ordning, och varningen om en
// samtalslogg som legat stilla (flyttad hit ur kortet Senaste samtal 2026-10-05).

const NOW = Date.parse('2026-10-05T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const QUIET = { overdueTasks: 0, todayTasks: 0, followUpCalls: 0, newProspects: 0, standaloneCalls: 0, quoteFollowUps: 0, staleCalls: null, seesWholeTeam: false };
const STILL = { callsLast7Days: 0, lastVisibleCallAt: daysAgo(8), lastOwnCallAt: daysAgo(12), seesWholeTeam: false, now: NOW };

describe('staleCalls', () => {
  it('tiger så länge något samtal är loggat de senaste sju dagarna', () => {
    expect(staleCalls({ ...STILL, callsLast7Days: 1 })).toBeNull();
  });

  // Annars hade den som aldrig ringer i tjänsten (konsult, en admin i ett tomt CRM) fått raden för evigt.
  it('tiger när läsaren inte ser något samtal alls', () => {
    expect(staleCalls({ ...STILL, lastVisibleCallAt: null, lastOwnCallAt: null })).toBeNull();
  });

  it('räknar dygn från läsarens EGET senaste samtal, inte en kollegas', () => {
    expect(staleCalls(STILL)).toEqual({ days: 12 });
  });

  it('räknar från lagets senaste samtal för den som ser hela laget', () => {
    expect(staleCalls({ ...STILL, seesWholeTeam: true })).toEqual({ days: 8 });
  });

  it('säljaren som aldrig loggat ett eget samtal får inga dygn', () => {
    expect(staleCalls({ ...STILL, lastOwnCallAt: null })).toEqual({ days: null });
  });
});

describe('buildOverviewActions', () => {
  it('inget att agera på ger en tom lista', () => {
    expect(buildOverviewActions(QUIET)).toEqual([]);
  });

  it('säger "du" till säljaren och "ingen" till den som ser hela laget', () => {
    expect(buildOverviewActions({ ...QUIET, staleCalls: { days: 9 } })[0].title).toBe('Du har inte loggat ett samtal på 9 dagar');
    expect(buildOverviewActions({ ...QUIET, staleCalls: { days: 9 }, seesWholeTeam: true })[0].title).toBe('Ingen har loggat ett samtal på 9 dagar');
    expect(buildOverviewActions({ ...QUIET, staleCalls: { days: null } })[0].title).toBe('Du har inte loggat något samtal ännu');
  });

  it('den stilla loggen leder till formuläret, inte bara till listan', () => {
    expect(buildOverviewActions({ ...QUIET, staleCalls: { days: 9 } })[0].href).toBe('/crm/samtal?log=1');
  });

  // Dagens uppgifter stod i kortet Öppna uppgifter. Utan raden syntes de först i morgon, som sena.
  it('visar uppgifter som förfaller i dag, böjt i singular', () => {
    expect(buildOverviewActions({ ...QUIET, todayTasks: 1 })[0].title).toBe('1 uppgift förfaller i dag');
    expect(buildOverviewActions({ ...QUIET, todayTasks: 3 })[0].title).toBe('3 uppgifter förfaller i dag');
  });

  it('det sena först, sedan dagens, sedan den stilla loggen, sedan uppföljningarna', () => {
    const titles = buildOverviewActions({ ...QUIET, quoteFollowUps: 1, staleCalls: { days: 9 }, todayTasks: 1, overdueTasks: 2 }).map((action) => action.title);
    expect(titles).toEqual(['2 uppgifter är sena', '1 uppgift förfaller i dag', 'Du har inte loggat ett samtal på 9 dagar', '1 offertläge väntar uppföljning']);
  });

  // Räknaren vid rubriken är radernas antal — en kapad lista hade gjort den till en lögn.
  it('visar alla rader, inget tak', () => {
    const actions = buildOverviewActions({ ...QUIET, overdueTasks: 1, todayTasks: 1, followUpCalls: 1, quoteFollowUps: 1, newProspects: 1, standaloneCalls: 1 });
    expect(actions).toHaveLength(6);
  });
});

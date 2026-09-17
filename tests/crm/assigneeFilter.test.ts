import { describe, it, expect } from 'vitest';
import { assigneeQueryParam, defaultAssigneeFilter, matchesAssignee, MINE } from '@/lib/domains/crm/assigneeFilter';

// Ansvarigfiltret delas av offertlistan, orderlistan och säljtavlan. Reglerna som prövas här är de
// två som inte syns när man läser en enskild lista: vad filtret STARTAR på, och vad sentinelen
// 'mine' blir på vägen till servern.

describe('defaultAssigneeFilter', () => {
  it('startar på den inloggades egna rader', () => {
    expect(defaultAssigneeFilter('user-1')).toEqual([MINE]);
  });

  it('🧨 faller tillbaka på ALLA när id:t är okänt, aldrig på mina', () => {
    // MINE med ett okänt id löser upp till tomt: säljtavlan (som filtrerar i klienten) hade blankats
    // helt, och listorna hade sett ut som ett register utan rader. "Vi vet inte vem du är" ska visa
    // allt, inte inget.
    expect(defaultAssigneeFilter(null)).toEqual([]);
  });
});

describe('assigneeQueryParam', () => {
  it('löser upp mina till det riktiga id:t', () => {
    expect(assigneeQueryParam([MINE], 'user-1')).toBe('user-1');
  });

  it('⛔ skickar ALDRIG sentinelen vidare till servern', () => {
    // Servern skulle då behöva avgöra vem "mine" är utifrån ett värde klienten skickat.
    expect(assigneeQueryParam([MINE, 'user-2'], 'user-1')).not.toContain(MINE);
    expect(assigneeQueryParam([MINE, 'user-2'], 'user-1')).toBe('user-1,user-2');
  });

  it('ger tomt — alltså inget filter, alltså alla — när id:t saknas', () => {
    expect(assigneeQueryParam([MINE], null)).toBe('');
    expect(assigneeQueryParam([], 'user-1')).toBe('');
  });
});

describe('matchesAssignee', () => {
  // Säljtavlans väg: samma värde, men prövat i klienten.
  it('tomt urval släpper igenom allt, även rader utan ansvarig', () => {
    expect(matchesAssignee(null, [], 'user-1')).toBe(true);
    expect(matchesAssignee('user-9', [], 'user-1')).toBe(true);
  });

  it('mina matchar bara den inloggade, och aldrig när id:t är okänt', () => {
    expect(matchesAssignee('user-1', [MINE], 'user-1')).toBe(true);
    expect(matchesAssignee('user-2', [MINE], 'user-1')).toBe(false);
    expect(matchesAssignee(null, [MINE], null)).toBe(false);
  });
});

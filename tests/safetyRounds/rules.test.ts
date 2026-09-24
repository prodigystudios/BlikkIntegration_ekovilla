import { describe, it, expect } from 'vitest';
import { isFollowUpOnlyPatch, leaderIdForName } from '@/lib/domains/safetyRounds/rules';

// Serverns regler, prövade utan en rutt runt sig.

describe('leaderIdForName', () => {
  const me = { id: 'user-1', name: 'Rolf Rondledare' };

  it('den inloggades eget namn (oavsett skiftläge och blanksteg) ger profilen', () => {
    expect(leaderIdForName('Rolf Rondledare', me)).toBe('user-1');
    expect(leaderIdForName('  rolf   RONDLEDARE ', me)).toBe('user-1');
  });

  it('ett annat namn, ett tömt fält eller en profil utan namn släpper kopplingen', () => {
    expect(leaderIdForName('Arne Arbetsledare', me)).toBeNull();
    expect(leaderIdForName(null, me)).toBeNull();
    expect(leaderIdForName('Rolf Rondledare', { id: 'user-1', name: null })).toBeNull();
    expect(leaderIdForName('Rolf Rondledare', { id: 'user-1' })).toBeNull();
  });
});

describe('isFollowUpOnlyPatch', () => {
  it('status, uppföljt datum, effekt och notering är uppföljning', () => {
    expect(isFollowUpOnlyPatch({ status: 'done', followed_up_on: '2026-10-01', effect: 'yes', cost_note: 'Räcke 1 200 kr' })).toBe(true);
  });

  it('allt annat — även blandat med uppföljning — är själva åtgärden', () => {
    expect(isFollowUpOnlyPatch({ action: 'Något annat' })).toBe(false);
    expect(isFollowUpOnlyPatch({ status: 'done', due_on: '2026-10-01' })).toBe(false);
    expect(isFollowUpOnlyPatch({ status: 'done', responsible_name: 'Ny person' })).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { formatPushWhen } from '@/lib/domains/notifications/pushWhen';

// Mötespåminnelsens "när". Byggs på servern (UTC) men ska läsas i svensk tid. Ögonblicken är UTC med
// exakt klockslag, så testet prövar samma sak i varje runtime-zon.
describe('formatPushWhen', () => {
  const morning = new Date('2026-10-09T06:00:00Z'); // 08.00 svensk tid

  it('klockslaget är svenskt: ett möte kl. 09 står som kl 09:00, inte 07:00', () => {
    expect(formatPushWhen('2026-10-09T07:00:00Z', morning)).toBe('idag kl 09:00');
  });

  it('vintertid: +1', () => {
    expect(formatPushWhen('2026-12-01T08:00:00Z', new Date('2026-12-01T06:00:00Z'))).toBe('idag kl 09:00');
  });

  it('ett möte kl. 00.30 i morgon är inte "idag", fast UTC-dygnet är detsamma', () => {
    const evening = new Date('2026-10-09T20:00:00Z'); // 22.00 svensk tid
    const when = formatPushWhen('2026-10-09T22:30:00Z', evening); // 00.30 den 10:e
    expect(when).not.toMatch(/^idag/);
    expect(when).toMatch(/^10 okt\.? kl 00:30$/);
  });

  it('en annan dag: dag och kortmånad', () => {
    expect(formatPushWhen('2026-10-12T12:30:00Z', morning)).toMatch(/^12 okt\.? kl 14:30$/);
  });

  it('tomt för saknat eller oläsligt värde', () => {
    expect(formatPushWhen(null, morning)).toBe('');
    expect(formatPushWhen('inte ett datum', morning)).toBe('');
  });
});

import { describe, it, expect } from 'vitest';
import { statusAfterScheduleChange } from '@/lib/domains/planning/scheduleStatus';

// Speglar triggern ops_segments_sync_work_order_status (20261006185916). Databasen gör bytet;
// tavlan visar det lokalt med den här funktionen.
describe('statusAfterScheduleChange', () => {
  it('Ej planerad blir Planerad när ordern läggs ut', () => {
    expect(statusAfterScheduleChange('draft', true)).toBe('scheduled');
  });

  it('Planerad blir Ej planerad när sista kortet tas bort', () => {
    expect(statusAfterScheduleChange('scheduled', false)).toBe('draft');
  });

  it('står kvar när läget redan stämmer', () => {
    expect(statusAfterScheduleChange('scheduled', true)).toBe('scheduled');
    expect(statusAfterScheduleChange('draft', false)).toBe('draft');
  });

  it.each(['in_progress', 'completed', 'partially_invoiced', 'invoiced', 'cancelled'])(
    'rör aldrig %s, varken vid utläggning eller avplanering',
    (status) => {
      expect(statusAfterScheduleChange(status, true)).toBe(status);
      expect(statusAfterScheduleChange(status, false)).toBe(status);
    },
  );
});

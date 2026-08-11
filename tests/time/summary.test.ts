import { describe, it, expect } from 'vitest';
import { buildDayRows, summarizePerson, type SummarizableEntry } from '@/lib/domains/time/summary';

// Underlaget byrån bad om: en rad per pass med datum, klockslag, arbetade timmar, frånvarotimmar
// med orsak och anteckning — plus månadssumma för arbetad tid och frånvaro.

const ANNA = 'anna-uuid';
const BJORN = 'bjorn-uuid';

const entry = (over: Partial<SummarizableEntry> = {}): SummarizableEntry => ({
  userId: ANNA,
  kind: 'work_order',
  workDate: '2026-08-11',
  startTime: '08:00',
  endTime: '18:00',
  breakMinutes: 60,
  ...over,
});

describe('buildDayRows', () => {
  it('ger en rad per pass med klockslagen kvar', () => {
    const rows = buildDayRows([entry()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: '2026-08-11', startTime: '08:00', endTime: '18:00', workMinutes: 540 });
  });

  // Två pass samma dag ger två rader med var sitt klockslagspar — byrån vill se när man jobbade,
  // och en hopslagen dagsrad hade dolt att det var två separata pass.
  it('slår inte ihop två pass samma dag', () => {
    const rows = buildDayRows([
      entry({ startTime: '06:00', endTime: '10:00', breakMinutes: 0 }),
      entry({ startTime: '13:00', endTime: '17:00', breakMinutes: 0 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.startTime)).toEqual(['06:00', '13:00']);
  });

  it('sorterar på datum och sedan starttid', () => {
    const rows = buildDayRows([
      entry({ workDate: '2026-08-12', startTime: '07:00' }),
      entry({ workDate: '2026-08-11', startTime: '13:00' }),
      entry({ workDate: '2026-08-11', startTime: '07:00' }),
    ]);
    expect(rows.map((row) => `${row.date} ${row.startTime}`)).toEqual([
      '2026-08-11 07:00', '2026-08-11 13:00', '2026-08-12 07:00',
    ]);
  });

  // Frånvaro får aldrig räknas som arbetad tid — det är två skilda kolumner i underlaget, och en
  // sjukdag som smyger in i arbetstiden blir för mycket lön.
  it('lägger frånvaro i frånvarokolumnen, aldrig i arbetad tid', () => {
    const rows = buildDayRows([
      entry({ kind: 'absence', startTime: null, endTime: null, minutesWorked: 480, absenceReason: 'VAB' }),
    ]);
    expect(rows[0].workMinutes).toBe(0);
    expect(rows[0].absenceMinutes).toBe(480);
    expect(rows[0].absenceReasons).toEqual(['VAB']);
  });

  it('bär med anteckningen', () => {
    expect(buildDayRows([entry({ note: 'Bytte slang på bilen' })])[0].note).toBe('Bytte slang på bilen');
  });
});

describe('summarizePerson', () => {
  const range = { from: '2026-08-01', to: '2026-08-31' };

  it('summerar arbetad tid och frånvaro för månaden', () => {
    const summary = summarizePerson(
      [
        entry({ workDate: '2026-08-11' }),
        entry({ workDate: '2026-08-12' }),
        entry({ workDate: '2026-08-13', kind: 'absence', startTime: null, endTime: null, minutesWorked: 480, absenceReason: 'Semester' }),
      ],
      range,
      ANNA,
    );
    expect(summary.workMinutes).toBe(1080); // 2 × 9 h
    expect(summary.absenceMinutes).toBe(480);
  });

  it('delar upp frånvaron per orsak, störst först', () => {
    const summary = summarizePerson(
      [
        entry({ workDate: '2026-08-03', kind: 'absence', startTime: null, endTime: null, minutesWorked: 240, absenceReason: 'VAB' }),
        entry({ workDate: '2026-08-04', kind: 'absence', startTime: null, endTime: null, minutesWorked: 480, absenceReason: 'Semester' }),
        entry({ workDate: '2026-08-05', kind: 'absence', startTime: null, endTime: null, minutesWorked: 240, absenceReason: 'VAB' }),
      ],
      range,
      ANNA,
    );
    expect(summary.absenceByReason).toEqual([
      { reason: 'Semester', minutes: 480 },
      { reason: 'VAB', minutes: 480 },
    ].sort((a, b) => b.minutes - a.minutes || a.reason.localeCompare(b.reason, 'sv')));
  });

  // Frånvaro utan orsak ska SYNAS, inte tyst försvinna ur uppdelningen — det är ett ifyllnadsfel
  // någon ska rätta innan lönen körs.
  it('visar frånvaro utan vald orsak i stället för att tappa den', () => {
    const summary = summarizePerson(
      [entry({ kind: 'absence', startTime: null, endTime: null, minutesWorked: 120, absenceReason: null })],
      range,
      ANNA,
    );
    expect(summary.absenceByReason).toEqual([{ reason: '(orsak saknas)', minutes: 120 }]);
    expect(summary.absenceMinutes).toBe(120);
  });

  it('räknar bara den efterfrågade personen', () => {
    const summary = summarizePerson([entry(), entry({ userId: BJORN })], range, ANNA);
    expect(summary.rows).toHaveLength(1);
    expect(summary.workMinutes).toBe(540);
  });

  it('utesluter rader utanför perioden', () => {
    const summary = summarizePerson(
      [entry({ workDate: '2026-07-31' }), entry({ workDate: '2026-08-11' }), entry({ workDate: '2026-09-01' })],
      range,
      ANNA,
    );
    expect(summary.rows.map((row) => row.date)).toEqual(['2026-08-11']);
  });

  it('ger en tom sammanställning för en person utan rader', () => {
    const summary = summarizePerson([], range, ANNA);
    expect(summary.rows).toEqual([]);
    expect(summary.workMinutes).toBe(0);
    expect(summary.absenceByReason).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { summarizeDay, summarizePerson, ORDINARY_MINUTES_PER_DAY, type SummarizableEntry } from '@/lib/domains/time/summary';

// Sammanställningen per person och dag. Varje fall motsvarar ett sätt att få fel lön.

const ANNA = 'anna-uuid';
const BJORN = 'bjorn-uuid';

const entry = (over: Partial<SummarizableEntry> = {}): SummarizableEntry => ({
  userId: ANNA,
  kind: 'work_order',
  workDate: '2026-08-11', // tisdag
  startTime: '07:00',
  endTime: '16:00',
  breakMinutes: 60,
  ...over,
});

describe('summarizeDay', () => {
  it('räknar ett vanligt dagpass som ordinarie tid', () => {
    const day = summarizeDay([entry()], '2026-08-11');
    expect(day.workMinutes).toBe(ORDINARY_MINUTES_PER_DAY);
    expect(day.ordinaryMinutes).toBe(ORDINARY_MINUTES_PER_DAY);
    expect(day.beyondOrdinaryMinutes).toBe(0);
  });

  // ⚠️ KÄRNFALLET. Räknas tröskeln per RAD i stället för per person och dag blir svaret 0 utöver
  // ordinarie, och två timmar försvinner ur underlaget.
  it('summerar dagens rader innan tröskeln — två 5-timmarsrader ger 2 h utöver ordinarie', () => {
    const day = summarizeDay(
      [
        entry({ startTime: '06:00', endTime: '11:00', breakMinutes: 0 }),
        entry({ startTime: '12:00', endTime: '17:00', breakMinutes: 0 }),
      ],
      '2026-08-11',
    );
    expect(day.workMinutes).toBe(600);
    expect(day.ordinaryMinutes).toBe(480);
    expect(day.beyondOrdinaryMinutes).toBe(120);
  });

  it('räknar interntid som arbetad tid', () => {
    const day = summarizeDay([entry({ kind: 'internal' })], '2026-08-11');
    expect(day.workMinutes).toBe(480);
    expect(day.absenceMinutes).toBe(0);
  });

  // Man blir inte övertidsberättigad av att vara sjuk. Frånvaro hålls utanför både tröskeln och
  // hinkarna — annars blir en sjukdag oskiljbar från en arbetsdag i underlaget.
  it('håller frånvaro utanför arbetad tid, tröskeln och hinkarna', () => {
    const day = summarizeDay(
      [
        entry({ kind: 'absence', startTime: '08:00', endTime: '16:00', breakMinutes: 0 }),
        entry({ startTime: '16:00', endTime: '20:00', breakMinutes: 0 }),
      ],
      '2026-08-11',
    );
    expect(day.absenceMinutes).toBe(480);
    expect(day.workMinutes).toBe(240);
    expect(day.beyondOrdinaryMinutes).toBe(0);
    expect(day.buckets.day).toBe(120);     // 16–18 av arbetspasset
    expect(day.buckets.evening).toBe(120); // 18–20
  });

  // Helg och röd dag har ingen ordinarie tid att överstiga — timmarna ligger redan i sin egen hink,
  // och att dessutom kalla dem "utöver ordinarie" vore att räkna samma timme två gånger.
  it('har ingen ordinarie tröskel på helg', () => {
    const day = summarizeDay([entry({ workDate: '2026-08-15', startTime: '08:00', endTime: '18:00', breakMinutes: 0 })], '2026-08-15');
    expect(day.workMinutes).toBe(600);
    expect(day.ordinaryMinutes).toBe(0);
    expect(day.beyondOrdinaryMinutes).toBe(600);
    expect(day.buckets.weekend).toBe(600);
  });

  it('har ingen ordinarie tröskel på röd dag', () => {
    const day = summarizeDay([entry({ workDate: '2026-01-06', startTime: '08:00', endTime: '12:00', breakMinutes: 0 })], '2026-01-06');
    expect(day.ordinaryMinutes).toBe(0);
    expect(day.buckets.holiday).toBe(240);
  });

  it('summerar mil och skiljer på det som ska till lön', () => {
    const day = summarizeDay(
      [
        entry({ travelKm: 12.5, travelToSalary: true }),
        entry({ travelKm: 4, travelToSalary: false }),
      ],
      '2026-08-11',
    );
    expect(day.travelKm).toBe(16.5);
    expect(day.travelKmToSalary).toBe(12.5);
  });

  it('ignorerar rader från andra dagar', () => {
    const day = summarizeDay([entry(), entry({ workDate: '2026-08-12' })], '2026-08-11');
    expect(day.workMinutes).toBe(480);
  });
});

describe('summarizePerson', () => {
  const range = { from: '2026-08-10', to: '2026-08-16' };

  it('summerar bara den efterfrågade personens rader', () => {
    const summary = summarizePerson([entry(), entry({ userId: BJORN })], range, ANNA);
    expect(summary.workMinutes).toBe(480);
    expect(summary.days).toHaveLength(1);
  });

  it('utesluter rader utanför perioden', () => {
    const summary = summarizePerson(
      [entry({ workDate: '2026-08-09' }), entry({ workDate: '2026-08-11' }), entry({ workDate: '2026-08-17' })],
      range,
      ANNA,
    );
    expect(summary.days.map((day) => day.date)).toEqual(['2026-08-11']);
  });

  // Tröskeln gäller per dag, inte per period: 8 h måndag och 10 h tisdag är 2 h utöver ordinarie —
  // inte 0 för att veckan råkar landa under 40.
  it('tillämpar tröskeln per dag, inte över hela perioden', () => {
    const summary = summarizePerson(
      [
        entry({ workDate: '2026-08-10', startTime: '08:00', endTime: '16:00', breakMinutes: 0 }),
        entry({ workDate: '2026-08-11', startTime: '07:00', endTime: '17:00', breakMinutes: 0 }),
      ],
      range,
      ANNA,
    );
    expect(summary.workMinutes).toBe(1080);
    expect(summary.beyondOrdinaryMinutes).toBe(120);
  });

  // Löneexporten vägrar köra när den här är > 0. Utan den flaggan hade gamla kontorsrader utan
  // klockslag tyst räknats som noll timmar.
  it('flaggar minuter utan klockslag som oklassificerade', () => {
    const summary = summarizePerson(
      [entry({ startTime: null, endTime: null, minutesWorked: 300 })],
      range,
      ANNA,
    );
    expect(summary.unclassifiedMinutes).toBe(300);
    expect(summary.workMinutes).toBe(300);
  });

  it('ger en tom sammanställning för en person utan rader', () => {
    const summary = summarizePerson([], range, ANNA);
    expect(summary.days).toEqual([]);
    expect(summary.workMinutes).toBe(0);
    expect(summary.unclassifiedMinutes).toBe(0);
  });
});

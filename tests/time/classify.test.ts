import { describe, it, expect } from 'vitest';
import { classifyShift, bucketFor, parseClock, TIME_BUCKETS, type ShiftInput } from '@/lib/domains/time/classify';
import { swedishHolidayKind } from '@/lib/domains/planning/holidays';

// Klassificeringen av arbetspass till redovisningshinkar. Varje fall här motsvarar ett sätt att få
// fel lön — det är därför de finns, och därför de är namngivna efter felet och inte efter funktionen.

const shift = (over: Partial<ShiftInput> = {}): ShiftInput => ({
  workDate: '2026-08-11', // en tisdag
  startTime: '07:00',
  endTime: '16:00',
  breakMinutes: 0,
  ...over,
});

function sumBuckets(buckets: Record<string, number>) {
  return TIME_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket], 0);
}

describe('parseClock', () => {
  it('läser både HH:MM och Postgres HH:MM:SS', () => {
    expect(parseClock('07:30')).toBe(450);
    expect(parseClock('07:30:00')).toBe(450);
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('23:59')).toBe(1439);
  });

  it('svarar null på skräp i stället för att gissa', () => {
    for (const value of [null, undefined, '', 'sju', '25:00', '07:99']) {
      expect(parseClock(value as any)).toBeNull();
    }
  });
});

describe('bucketFor — företräde mellan hinkarna', () => {
  // Hinkarna måste vara ömsesidigt uteslutande, annars kan en minut hamna i två och summan spricker.
  it('helg slår kväll: lördag 20:00 är weekend, inte evening', () => {
    expect(bucketFor('2026-08-15', 20 * 60)).toBe('weekend'); // lördag
    expect(bucketFor('2026-08-11', 20 * 60)).toBe('evening'); // tisdag
  });

  it('röd dag slår allt — även en vardag mitt i veckan', () => {
    expect(swedishHolidayKind('2026-01-06')).toBe('public'); // trettondedag jul, en tisdag
    expect(bucketFor('2026-01-06', 10 * 60)).toBe('holiday');
  });

  // Att jobba på julafton får inte se ut som en vanlig arbetsdag i underlaget. Att den INTE är en
  // lagstadgad röd dag syns separat, per dag, så byrån kan tillämpa sitt avtal.
  it('de-facto-afton hamnar också i holiday, men är märkt annorlunda', () => {
    expect(bucketFor('2026-12-24', 10 * 60)).toBe('holiday');
    expect(swedishHolidayKind('2026-12-24')).toBe('de_facto');
    expect(swedishHolidayKind('2026-12-25')).toBe('public');
  });

  it('natt är före 06:00 och från 23:00', () => {
    expect(bucketFor('2026-08-11', 5 * 60 + 59)).toBe('night');
    expect(bucketFor('2026-08-11', 6 * 60)).toBe('day');
    expect(bucketFor('2026-08-11', 22 * 60 + 59)).toBe('evening');
    expect(bucketFor('2026-08-11', 23 * 60)).toBe('night');
  });
});

describe('classifyShift', () => {
  it('räknar ett vanligt dagpass med rast', () => {
    const result = classifyShift(shift({ startTime: '07:00', endTime: '16:00', breakMinutes: 30 }));
    expect(result.totalMinutes).toBe(510); // 9 h minus 30 min
    expect(result.buckets.day).toBe(510);
    expect(result.perDay).toHaveLength(1);
  });

  // INVARIANT. Håller den inte kan underlaget summera till något annat än de timmar personen jobbat,
  // och då är varje siffra i det opålitlig.
  it('hinkarna summerar EXAKT till totalen — även när rasten inte går jämnt ut', () => {
    const cases: ShiftInput[] = [
      shift({ startTime: '07:00', endTime: '16:00', breakMinutes: 30 }),
      shift({ startTime: '16:00', endTime: '23:30', breakMinutes: 37 }),
      shift({ startTime: '22:00', endTime: '06:00', breakMinutes: 45 }),
      shift({ startTime: '05:13', endTime: '19:47', breakMinutes: 41 }),
      shift({ startTime: '00:00', endTime: '23:59', breakMinutes: 1 }),
      shift({ workDate: '2026-08-15', startTime: '06:00', endTime: '18:00', breakMinutes: 17 }),
    ];
    for (const input of cases) {
      const result = classifyShift(input);
      expect(sumBuckets(result.buckets)).toBe(result.totalMinutes);
      expect(result.perDay.reduce((sum, day) => sum + day.minutes, 0)).toBe(result.totalMinutes);
      for (const day of result.perDay) expect(sumBuckets(day.buckets)).toBe(day.minutes);
    }
  });

  it('delar upp ett kvällspass i dag och kväll', () => {
    const result = classifyShift(shift({ startTime: '14:00', endTime: '20:00', breakMinutes: 0 }));
    expect(result.buckets.day).toBe(4 * 60);      // 14–18
    expect(result.buckets.evening).toBe(2 * 60);  // 18–20
    expect(result.totalMinutes).toBe(6 * 60);
  });

  // Passet som går över midnatt måste ligga HELT i sin egen period — annars kan halva vara
  // attesterat och halva inte, och då får någon halv lön.
  it('lägger ett midnattspass helt på workDate, men visar dygnen i perDay', () => {
    const result = classifyShift({ workDate: '2026-03-31', startTime: '22:00', endTime: '06:00', breakMinutes: 0 });
    expect(result.totalMinutes).toBe(8 * 60);
    expect(result.perDay.map((day) => day.date)).toEqual(['2026-03-31', '2026-04-01']);
    expect(result.perDay[0].minutes).toBe(2 * 60); // 22–24 den 31:a
    expect(result.perDay[1].minutes).toBe(6 * 60); // 00–06 den 1:a
    // 22–23 är KVÄLL, inte natt: nattgränsen går 23:00. Resten (23–06) är natt.
    expect(result.buckets.evening).toBe(60);
    expect(result.buckets.night).toBe(7 * 60);
  });

  it('byter hink mitt i ett midnattspass in i helgen', () => {
    // Fredag 22:00 → lördag 06:00: en timme kväll, en timme natt, sex timmar helg.
    const result = classifyShift({ workDate: '2026-08-14', startTime: '22:00', endTime: '06:00', breakMinutes: 0 });
    expect(result.buckets.evening).toBe(60);
    expect(result.buckets.night).toBe(60);
    expect(result.buckets.weekend).toBe(6 * 60);
  });

  // Sommartid: väggklockan är sanningen (kolumnen är `time`, inte `timestamptz`). Ett pass
  // 22:00–06:00 är åtta timmar oavsett om natten hade 23 eller 25 timmar.
  it('påverkas inte av sommartidsomställningarna', () => {
    const spring = classifyShift({ workDate: '2026-03-28', startTime: '22:00', endTime: '06:00', breakMinutes: 0 });
    const autumn = classifyShift({ workDate: '2026-10-24', startTime: '22:00', endTime: '06:00', breakMinutes: 0 });
    const ordinary = classifyShift({ workDate: '2026-08-11', startTime: '22:00', endTime: '06:00', breakMinutes: 0 });
    expect(spring.totalMinutes).toBe(8 * 60);
    expect(autumn.totalMinutes).toBe(8 * 60);
    expect(ordinary.totalMinutes).toBe(8 * 60);
  });

  it('drar rasten proportionellt över hinkarna', () => {
    // 14:00–20:00 = 4 h dag + 2 h kväll. 60 min rast → 2/3 dag, 1/3 kväll.
    const result = classifyShift(shift({ startTime: '14:00', endTime: '20:00', breakMinutes: 60 }));
    expect(result.totalMinutes).toBe(5 * 60);
    expect(result.buckets.day).toBe(200);
    expect(result.buckets.evening).toBe(100);
  });

  it('klarar en rast som är längre än passet utan att bli negativ', () => {
    const result = classifyShift(shift({ startTime: '08:00', endTime: '09:00', breakMinutes: 120 }));
    expect(result.totalMinutes).toBe(0);
    expect(sumBuckets(result.buckets)).toBe(0);
  });

  // Gamla kontorsrader har bara datum och timmar. De ska INTE gissas in på dygnet — de blir synligt
  // oklassificerade, och löneexporten vägrar köra så länge hinken har minuter i sig.
  it('lägger rader utan klockslag i unclassified i stället för att gissa', () => {
    const result = classifyShift({ workDate: '2026-08-11', startTime: null, endTime: null, breakMinutes: 0, minutesWorked: 300 });
    expect(result.buckets.unclassified).toBe(300);
    expect(result.buckets.day).toBe(0);
    expect(result.totalMinutes).toBe(300);
  });

  it('ger noll, inte NaN, när varken klockslag eller minuter finns', () => {
    const result = classifyShift({ workDate: '2026-08-11', startTime: null, endTime: null, breakMinutes: 0 });
    expect(result.totalMinutes).toBe(0);
    expect(sumBuckets(result.buckets)).toBe(0);
  });
});

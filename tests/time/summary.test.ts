import { describe, it, expect } from 'vitest';
import {
  breakWasDeducted,
  buildDayRows,
  formatDaySpan,
  inPeriodSpan,
  reasonOrJobLabel,
  rowsByWeek,
  summarizePerson,
  weekAlignedRange,
  type SummarizableEntry,
} from '@/lib/domains/time/summary';

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

// `label` är inte en av byråns kolumner — den finns för kontorets egen granskning i attestens
// dagvy. Den ska aldrig hamna på en frånvarorad: frånvaro hör inte till ett jobb, och en etikett
// som följt med från formuläret hade sett ut som att någon arbetat på ordern under sin sjukdag.
describe('buildDayRows — vad tiden lades på', () => {
  it('bär arbetsorderns etikett på arbetad tid', () => {
    expect(buildDayRows([entry({ label: 'AO-1 · Villa Ek' })])[0].label).toBe('AO-1 · Villa Ek');
  });

  it('lämnar etiketten tom på frånvaro även om den skickas med', () => {
    const rows = buildDayRows([
      entry({ kind: 'absence', startTime: null, endTime: null, minutesWorked: 240, absenceReason: 'VAB', label: 'AO-1' }),
    ]);
    expect(rows[0].label).toBeNull();
    expect(rows[0].absenceReasons).toEqual(['VAB']);
  });
});

// Regression, och den dyraste sorten: rastavdraget måste följa med dagraden.
//
// Attestens rättelse skickar tillbaka rasten tillsammans med klockslagen, och servern räknar om
// minuterna ur alla tre. Tappas den här defaultar formuläret till noll, och en rättad 07:00–16:00
// med halvtimmes rast går från 510 till 540 minuter — trettio minuter tillagda på någons lön, tyst.
describe('buildDayRows — rasten', () => {
  it('bär rastavdraget vidare på arbetad tid', () => {
    const rows = buildDayRows([entry({ startTime: '07:00', endTime: '16:00', breakMinutes: 30 })]);
    expect(rows[0].breakMinutes).toBe(30);
    expect(rows[0].workMinutes).toBe(510);
  });

  it('nollar rasten på frånvaro — den anges i timmar och har inget pass att dra från', () => {
    const rows = buildDayRows([
      entry({ kind: 'absence', startTime: null, endTime: null, minutesWorked: 240, breakMinutes: 30 }),
    ]);
    expect(rows[0].breakMinutes).toBe(0);
    expect(rows[0].absenceMinutes).toBe(240);
  });
});

// Regression: sorten måste följa med dagraden. En internrad har arbetade minuter precis som en
// arbetsorderrad, så en rättelse som gissade sorten ur siffrorna öppnade internraden som
// "Arbetsorder" — och ett valt jobb föll då tyst bort medan UI:t sa att raden var rättad.
describe('buildDayRows — sorten', () => {
  it('bär radens kind, som inte går att härleda ur minuterna', () => {
    // Egna datum: buildDayRows sorterar på datum och starttid, och en frånvarorad utan klockslag
    // hamnar annars först — ordningen är inte poängen här, sorten är.
    const rows = buildDayRows([
      entry({ kind: 'work_order', workDate: '2026-08-11' }),
      entry({ kind: 'internal', workDate: '2026-08-12' }),
      entry({ kind: 'absence', workDate: '2026-08-13', startTime: null, endTime: null, minutesWorked: 240 }),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(['work_order', 'internal', 'absence']);
  });
});

// Attestens kontrollsiffra: bruttotiden ur klockslagen minus rasten ska bli arbetad tid. Den håller
// bara om summan räknar SAMMA rast som workedMinutes faktiskt drog av.
describe('rastavdraget som kontrollsiffra', () => {
  it('summerar månadens rast, och kontrollen går ihop', () => {
    const summary = summarizePerson(
      [
        entry({ workDate: '2026-08-11', startTime: '08:00', endTime: '18:00', breakMinutes: 60 }),
        entry({ workDate: '2026-08-12', startTime: '07:00', endTime: '16:00', breakMinutes: 30 }),
      ],
      { from: '2026-08-01', to: '2026-08-31' },
      ANNA,
    );
    expect(summary.breakMinutes).toBe(90);
    // 600 + 540 brutto − 90 rast = 1050.
    expect(summary.workMinutes).toBe(1050);
  });

  // ⚠️ Rader utan klockslag — de gamla kontorsraderna — får sina minuter ur minutes_worked, och
  // workedMinutes drar då ALDRIG av rasten. Räknas deras lagrade rast med i summan påstår
  // kontrollsiffran ett avdrag som inte skett, och en korrekt rad ser överrapporterad ut med en
  // timme. Den som "rättar" den skriver bort riktig tid.
  it('räknar inte rast på rader där den aldrig drogs av', () => {
    const summary = summarizePerson(
      [entry({ startTime: null, endTime: null, minutesWorked: 480, breakMinutes: 60 })],
      { from: '2026-08-01', to: '2026-08-31' },
      ANNA,
    );
    expect(summary.workMinutes).toBe(480);
    expect(summary.breakMinutes).toBe(0);
  });

  it('räknar inte frånvarons rast — den har inget pass att dra från', () => {
    const summary = summarizePerson(
      [entry({ kind: 'absence', startTime: null, endTime: null, minutesWorked: 240, breakMinutes: 30 })],
      { from: '2026-08-01', to: '2026-08-31' },
      ANNA,
    );
    expect(summary.breakMinutes).toBe(0);
  });
});

// Samma regel som attestens cell frågar per rad. Delad, så tabellen och summan aldrig kan säga
// olika saker om samma rast.
describe('breakWasDeducted', () => {
  it('är sann bara när det finns två klockslag att räkna emellan', () => {
    expect(breakWasDeducted({ kind: 'work_order', startTime: '08:00', endTime: '18:00' })).toBe(true);
    expect(breakWasDeducted({ kind: 'internal', startTime: '22:00', endTime: '06:00' })).toBe(true);
    expect(breakWasDeducted({ kind: 'work_order', startTime: null, endTime: null })).toBe(false);
    expect(breakWasDeducted({ kind: 'work_order', startTime: '08:00', endTime: null })).toBe(false);
    expect(breakWasDeducted({ kind: 'absence', startTime: '08:00', endTime: '18:00' })).toBe(false);
  });
});

// Kolumnen "Orsak / jobb". Finns som egen funktion därför att den ska svara RÄTT för en läsare som
// inte når arbetsordern — lönebyrån (rollen `ekonomi`) har ingen crm.workorder.read, embedden i
// listTimeEntries svarar då null, och ett tankstreck hade läst som "ingen uppgift finns" på en rad
// där det bevisligen finns ett jobb.
describe('reasonOrJobLabel', () => {
  it('frånvaroorsakerna vinner, och flera samma dag listas var för sig', () => {
    expect(reasonOrJobLabel({ kind: 'absence', absenceReasons: ['VAB'], label: null })).toBe('VAB');
    expect(reasonOrJobLabel({ kind: 'absence', absenceReasons: ['VAB', 'Semester'], label: null }))
      .toBe('VAB, Semester');
  });

  it('visar jobbets namn när det gick att hämta', () => {
    expect(reasonOrJobLabel({ kind: 'work_order', absenceReasons: [], label: '#12345 · Villa Ek' }))
      .toBe('#12345 · Villa Ek');
  });

  // Kärnfallet. Utan den här raden ser lönebyråns hela dagvy ut som saknad data.
  it('säger vilken SORT raden är när namnet inte gick att hämta — aldrig ett tankstreck', () => {
    expect(reasonOrJobLabel({ kind: 'work_order', absenceReasons: [], label: null })).toBe('Arbetsorder');
    expect(reasonOrJobLabel({ kind: 'internal', absenceReasons: [], label: null })).toBe('Internprojekt');
  });

  // Frånvaro utan orsak är det ENDA fallet där tankstrecket är sant: raden pekar inte på något jobb.
  it('lämnar tankstrecket kvar åt frånvaro utan orsak', () => {
    expect(reasonOrJobLabel({ kind: 'absence', absenceReasons: [], label: null })).toBe('—');
  });
});

// Veckosummorna (ekonomi 2026-10-14): övertiden räknas per vecka, och byrån drog linjer och räknade
// veckorna för hand. En vecka som går över ett månadsskifte summeras HELA — även grannmånadens dagar
// (Williams beslut) — med månadens del bredvid.
describe('veckorna', () => {
  const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };
  // Oktober 2026 börjar en torsdag: v. 40 = 28 sep–4 okt, v. 44 = 26 okt–1 nov.
  const day = (workDate: string, over: Partial<SummarizableEntry> = {}) =>
    entry({ workDate, startTime: '07:00', endTime: '16:00', breakMinutes: 60, ...over }); // 8 h

  it('hämtas för hela kantveckorna', () => {
    expect(weekAlignedRange(OCTOBER)).toEqual({ from: '2026-09-28', to: '2026-11-01' });
    // En månad som börjar en måndag och slutar en söndag behöver inget mer.
    expect(weekAlignedRange({ from: '2026-06-01', to: '2026-06-30' })).toEqual({ from: '2026-06-01', to: '2026-07-05' });
  });

  it('kantveckan summeras hela, med månadens del bredvid — dagraderna stannar i månaden', () => {
    const summary = summarizePerson(
      [day('2026-09-28'), day('2026-09-29'), day('2026-09-30'), day('2026-10-01'), day('2026-10-02')],
      OCTOBER,
      ANNA,
    );
    expect(summary.rows.map((row) => row.date)).toEqual(['2026-10-01', '2026-10-02']);
    expect(summary.workMinutes).toBe(960);
    expect(summary.weeks).toHaveLength(1);
    expect(summary.weeks[0]).toMatchObject({
      week: 40,
      from: '2026-09-28',
      to: '2026-10-04',
      crossesPeriod: true,
      total: { workMinutes: 2400, breakMinutes: 300 },
      inPeriod: { workMinutes: 960, breakMinutes: 120 },
    });
  });

  it('en hel vecka i månaden: total och månadens del är samma', () => {
    const summary = summarizePerson([day('2026-10-05'), day('2026-10-09', { kind: 'absence', startTime: null, endTime: null, minutesWorked: 480 })], OCTOBER, ANNA);
    expect(summary.weeks).toEqual([
      {
        week: 41,
        from: '2026-10-05',
        to: '2026-10-11',
        crossesPeriod: false,
        total: { workMinutes: 480, absenceMinutes: 480, breakMinutes: 60 },
        inPeriod: { workMinutes: 480, absenceMinutes: 480, breakMinutes: 60 },
      },
    ]);
  });

  it('månadens delar summerar till månadens totalrad', () => {
    const entries = [
      day('2026-09-30'), day('2026-10-01'), day('2026-10-07'), day('2026-10-14', { endTime: '18:30' }),
      day('2026-10-21', { kind: 'absence', startTime: null, endTime: null, minutesWorked: 240 }),
      day('2026-10-30'), day('2026-11-01'),
    ];
    const summary = summarizePerson(entries, OCTOBER, ANNA);
    const sum = (key: 'workMinutes' | 'absenceMinutes' | 'breakMinutes') => summary.weeks.reduce((acc, w) => acc + w.inPeriod[key], 0);
    expect(sum('workMinutes')).toBe(summary.workMinutes);
    expect(sum('absenceMinutes')).toBe(summary.absenceMinutes);
    expect(sum('breakMinutes')).toBe(summary.breakMinutes);
    expect(summary.weeks.map((w) => w.week)).toEqual([40, 41, 42, 43, 44]);
    // Sista veckan bär grannmånadens söndag.
    expect(summary.weeks.at(-1)).toMatchObject({ crossesPeriod: true, total: { workMinutes: 960 }, inPeriod: { workMinutes: 480 } });
  });

  it('bara veckor med en dagrad i perioden — grannmånadens tid ensam ger ingen vecka', () => {
    const summary = summarizePerson([day('2026-09-29'), day('2026-10-06')], OCTOBER, ANNA);
    expect(summary.weeks.map((w) => w.week)).toEqual([41]);
  });

  it('räknar bara personens egna rader', () => {
    const summary = summarizePerson([day('2026-10-01'), day('2026-09-30', { userId: BJORN })], OCTOBER, ANNA);
    expect(summary.weeks[0].total.workMinutes).toBe(480);
  });

  it('veckonumren över årsskiftet: v. 53 i december 2026, v. 1 börjar 29 december 2025', () => {
    const december = summarizePerson([day('2026-12-31'), day('2027-01-02')], { from: '2026-12-01', to: '2026-12-31' }, ANNA);
    expect(december.weeks[0]).toMatchObject({ week: 53, from: '2026-12-28', to: '2027-01-03', total: { workMinutes: 960 } });
    const january = summarizePerson([day('2025-12-30'), day('2026-01-02')], { from: '2026-01-01', to: '2026-01-31' }, ANNA);
    expect(january.weeks[0]).toMatchObject({ week: 1, from: '2025-12-29', total: { workMinutes: 960 }, inPeriod: { workMinutes: 480 } });
  });

  it('veckan över sommartidens slut (25 oktober 2026) är sju dagar som alla andra', () => {
    // Datumen är strängar och stegas i UTC (addDaysISO) — en vecka på 169 timmar finns inte här.
    const summary = summarizePerson([day('2026-10-19'), day('2026-10-25'), day('2026-10-26')], OCTOBER, ANNA);
    expect(summary.weeks.map((w) => [w.week, w.from, w.to, w.total.workMinutes])).toEqual([
      [43, '2026-10-19', '2026-10-25', 960],
      [44, '2026-10-26', '2026-11-01', 480],
    ]);
  });
});

describe('rowsByWeek', () => {
  const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };
  const day = (workDate: string) => entry({ workDate, startTime: '07:00', endTime: '16:00' });

  it('varje dagrad i exakt en vecka, i ordning', () => {
    const summary = summarizePerson([day('2026-10-01'), day('2026-10-02'), day('2026-10-05'), day('2026-10-12')], OCTOBER, ANNA);
    const groups = rowsByWeek(summary);
    expect(groups.map((g) => [g.week?.week, g.rows.map((r) => r.date)])).toEqual([
      [40, ['2026-10-01', '2026-10-02']],
      [41, ['2026-10-05']],
      [42, ['2026-10-12']],
    ]);
  });

  // Ett svar utan veckor (en server som ännu inte driftsatts när sidan laddats om) får aldrig tappa
  // en dagrad — de samlas i en grupp utan vecka.
  it('rader utan vecka försvinner inte', () => {
    const summary = summarizePerson([day('2026-10-01'), day('2026-10-05')], OCTOBER, ANNA);
    expect(rowsByWeek({ rows: summary.rows })).toEqual([{ week: null, rows: summary.rows }]);
    expect(rowsByWeek({ rows: summary.rows, weeks: summary.weeks.slice(1) }).flatMap((g) => g.rows)).toHaveLength(2);
  });
});

describe('formatDaySpan', () => {
  it('skriver månaden en gång inom en månad, två gånger över ett skifte', () => {
    expect(formatDaySpan('2026-10-05', '2026-10-11')).toBe('5–11 okt');
    expect(formatDaySpan('2026-09-28', '2026-10-04')).toBe('28 sep–4 okt');
    expect(formatDaySpan('2026-12-28', '2027-01-03')).toBe('28 dec–3 jan');
  });

  it('månadens del av en kantvecka', () => {
    const range = { from: '2026-10-01', to: '2026-10-31' };
    expect(inPeriodSpan({ from: '2026-09-28', to: '2026-10-04' }, range)).toBe('1–4 okt');
    expect(inPeriodSpan({ from: '2026-10-26', to: '2026-11-01' }, range)).toBe('26–31 okt');
  });
});

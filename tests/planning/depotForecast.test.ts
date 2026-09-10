import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { forecastDepotRunOut, rowsNeedingOrder, supplyKey } from '@/lib/domains/planning/depotForecast';
import { addDaysISO } from '@/lib/domains/planning/timezone';

// Den tidsfasade prognosen: NÄR tar depån slut, och hur mycket ska beställas.
//
// Varje regel här har en riktning som kostar pengar och en som ställer en bil utan material. Testen
// namnger vilken.

const SYD = 'depot-syd';
const NORR = 'depot-norr';
const EKO = 'EKOVILLA';
const KNAUF = 'KNAUF SUPAFIL';
const DEPOTS = [
  { id: SYD, name: 'Depå Syd' },
  { id: NORR, name: 'Depå Norr' },
];
const TODAY = '2026-09-14';

function run(over: Partial<Parameters<typeof forecastDepotRunOut>[0]> = {}) {
  return forecastDepotRunOut({
    depots: DEPOTS,
    opening: [],
    demand: [],
    inflow: [],
    today: TODAY,
    ...over,
  });
}
const rowFor = (f: ReturnType<typeof run>, depot = SYD, material = EKO) =>
  f.rows.find((r) => r.depot_id === depot && r.material === material)!;

describe('run-out-dagen', () => {
  it('hittar första dagen saldot går under noll', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 100 }],
      demand: [
        { depot_id: SYD, material: EKO, sacks: 40, day: '2026-09-15' },
        { depot_id: SYD, material: EKO, sacks: 80, day: '2026-09-17' },
      ],
    });
    const r = rowFor(f);
    expect(r.run_out_day).toBe('2026-09-17');
    expect(r.shortfall_at_run_out).toBe(20);
  });

  it('ger null när lagret räcker hela vägen', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 500 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 40, day: '2026-09-15' }],
    });
    const r = rowFor(f);
    expect(r.run_out_day).toBeNull();
    expect(r.worst_deficit).toBe(0);
    expect(r.suggested_sacks).toBe(0);
    expect(r.suggested_date).toBeNull();
  });

  it('exakt noll är inte slut — det räcker precis', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 40 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 40, day: '2026-09-15' }],
    });
    expect(rowFor(f).run_out_day).toBeNull();
  });

  it('en nyckel med rörelse men utan saldo börjar på noll', () => {
    const f = run({ demand: [{ depot_id: SYD, material: EKO, sacks: 10, day: '2026-09-15' }] });
    const r = rowFor(f);
    expect(r.opening).toBe(0);
    expect(r.run_out_day).toBe('2026-09-15');
  });
});

describe('suggested_sacks är STÖRSTA underskottet, inte det första', () => {
  /**
   * 🧨 Regeln hela beställningen hänger på. Beställer man det FÖRSTA underskottet räcker leveransen
   * till nästa jobb och sedan står bilen där ändå — och den andra beställningen hinner inte fram.
   */
  it('täcker den djupaste punkten över horisonten', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [
        { depot_id: SYD, material: EKO, sacks: 40, day: '2026-09-15' }, // -40
        { depot_id: SYD, material: EKO, sacks: 140, day: '2026-09-18' }, // -180
      ],
    });
    const r = rowFor(f);
    expect(r.shortfall_at_run_out).toBe(40); // vad som fattas den dag det tar slut
    expect(r.worst_deficit).toBe(180); // vad som måste beställas
    expect(r.suggested_sacks).toBe(180);
  });

  it('ett inflöde mitt i horisonten sänker inte det värsta som kommer efter', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [
        { depot_id: SYD, material: EKO, sacks: 40, day: '2026-09-15' },
        { depot_id: SYD, material: EKO, sacks: 100, day: '2026-09-20' },
      ],
      inflow: [{ depot_id: SYD, material: EKO, sacks: 40, day: '2026-09-16' }],
    });
    // -40 den 15:e, tillbaka till 0 den 16:e, -100 den 20:e.
    expect(rowFor(f).worst_deficit).toBe(100);
  });
});

describe('inflöde före förbrukning samma dag', () => {
  /**
   * ⚠️ En leverans på morgonen täcker dagens blåsning. I omvänd ordning rapporterar prognosen en
   * brist som aldrig inträffade och beställer material som redan står på depån.
   */
  it('en leverans samma dag som behovet täcker det', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 100, day: '2026-09-15' }],
      inflow: [{ depot_id: SYD, material: EKO, sacks: 100, day: '2026-09-15' }],
    });
    const r = rowFor(f);
    expect(r.run_out_day).toBeNull();
    expect(r.worst_deficit).toBe(0);
  });
});

describe('datum före idag', () => {
  /**
   * ⚠️ SPEGELVÄNDA REGLER, och det är avsiktligt. Läs dem parvis.
   */
  it('FÖRBRUKNING före idag viks in på idag — jobbet ska fortfarande blåsas', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 50 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 80, day: '2026-09-01' }],
    });
    const r = rowFor(f);
    // Kastades posten hade behovet underskattats — riktningen som ställer en bil utan material.
    expect(r.run_out_day).toBe(TODAY);
    expect(r.worst_deficit).toBe(30);
  });

  it('INFLÖDE före idag räknas INTE som anlänt — det är en försenad leverans', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 100, day: '2026-09-15' }],
      inflow: [{ depot_id: SYD, material: EKO, sacks: 100, day: '2026-09-01' }],
    });
    const r = rowFor(f);
    // Hade den vikts in på idag vore bristvarningen tyst på material som står kvar hos fabriken.
    expect(r.overdue_inflow).toBe(100);
    expect(r.worst_deficit).toBe(100);
    expect(r.run_out_day).toBe('2026-09-15');
  });

  it('ett inflöde PÅ idag räknas — det är inte försenat', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 100, day: TODAY }],
      inflow: [{ depot_id: SYD, material: EKO, sacks: 100, day: TODAY }],
    });
    const r = rowFor(f);
    expect(r.overdue_inflow).toBe(0);
    expect(r.run_out_day).toBeNull();
  });
});

describe('suggested_date backar ledtiden', () => {
  it('run_out minus ledtid', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 100, day: '2026-09-30' }],
      supply: new Map([[supplyKey(SYD, EKO), { leadTimeDays: 7, roundUpTo: 1 }]]),
    });
    expect(rowFor(f).suggested_date).toBe('2026-09-23');
  });

  it('aldrig före idag — en beställning kan inte skickas i går', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 100, day: '2026-09-15' }],
      supply: new Map([[supplyKey(SYD, EKO), { leadTimeDays: 30, roundUpTo: 1 }]]),
    });
    expect(rowFor(f).suggested_date).toBe(TODAY);
  });

  it('utan leverantörsuppgift: ingen ledtid, ingen avrundning', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 187, day: '2026-09-30' }],
    });
    const r = rowFor(f);
    expect(r.suggested_date).toBe('2026-09-30');
    expect(r.suggested_sacks).toBe(187);
  });

  it('avrundar upp till leverantörens pall — en gång, på totalen', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [
        { depot_id: SYD, material: EKO, sacks: 1, day: '2026-09-15' },
        { depot_id: SYD, material: EKO, sacks: 1, day: '2026-09-16' },
        { depot_id: SYD, material: EKO, sacks: 1, day: '2026-09-17' },
      ],
      supply: new Map([[supplyKey(SYD, EKO), { leadTimeDays: 0, roundUpTo: 24 }]]),
    });
    // Avrundat per dag hade det blivit 3 pallar = 72. Behovet är 3 säckar, alltså EN pall.
    expect(rowFor(f).worst_deficit).toBe(3);
    expect(rowFor(f).suggested_sacks).toBe(24);
  });
});

describe('depåer och material hålls isär', () => {
  it('samma material på två depåer räknas var för sig', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 100 }],
      demand: [
        { depot_id: SYD, material: EKO, sacks: 50, day: '2026-09-15' },
        { depot_id: NORR, material: EKO, sacks: 50, day: '2026-09-15' },
      ],
    });
    expect(rowFor(f, SYD).run_out_day).toBeNull(); // 100 - 50
    expect(rowFor(f, NORR).run_out_day).toBe('2026-09-15'); // 0 - 50
  });

  // 🧨 Materialkoderna innehåller både mellanslag och snedstreck, så en slarvig strängnyckel kan
  // slå ihop två celler. Ett hopslaget behov skickar dessutom beställningen till fel fabrik.
  it('två material på samma depå blandas inte ihop', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 100 }],
      demand: [
        { depot_id: SYD, material: EKO, sacks: 50, day: '2026-09-15' },
        { depot_id: SYD, material: KNAUF, sacks: 50, day: '2026-09-15' },
      ],
    });
    expect(rowFor(f, SYD, EKO).run_out_day).toBeNull();
    expect(rowFor(f, SYD, KNAUF).run_out_day).toBe('2026-09-15');
  });

  it('supplyKey håller isär material vars koder innehåller mellanslag och snedstreck', () => {
    expect(supplyKey(SYD, EKO)).not.toBe(supplyKey(SYD, KNAUF));
    expect(supplyKey(SYD, 'ISOCELL/ISECO')).not.toBe(supplyKey(SYD, 'ISOCELL'));
    // Nyckeln får inte gå att förfalska genom att flytta gränsen mellan fälten.
    expect(supplyKey('a', 'b c')).not.toBe(supplyKey('a b', 'c'));
  });
});

describe('excluded redovisas, sväljs aldrig', () => {
  it('bärs igenom till resultatet', () => {
    const f = run({ excluded: [{ work_order_id: 'wo-1', reason: 'no_depot' }] });
    expect(f.excluded).toEqual([{ work_order_id: 'wo-1', reason: 'no_depot' }]);
  });

  it('tom lista när allt kunde räknas', () => {
    expect(run().excluded).toEqual([]);
  });
});

describe('rowsNeedingOrder', () => {
  it('tar bara med rader med ett underskott, brådskande först', () => {
    const f = run({
      opening: [],
      demand: [
        { depot_id: NORR, material: EKO, sacks: 10, day: '2026-09-20' },
        { depot_id: SYD, material: EKO, sacks: 10, day: '2026-09-15' },
      ],
    });
    const need = rowsNeedingOrder(f);
    expect(need.map((r) => r.depot_id)).toEqual([SYD, NORR]);
  });

  it('utesluter rader som räcker', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 500 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 10, day: '2026-09-15' }],
    });
    expect(rowsNeedingOrder(f)).toEqual([]);
  });
});

/**
 * 🕰️ SOMMARTID — OCH VARFÖR DEN HÄR SVITEN SÄTTER SIN EGEN TIDSZON.
 *
 * ⚠️ ETT DST-TEST BITER BARA I EN DST-ZON. Under `TZ=UTC` — vilket CI och Vercel kör — är varje
 * dygn exakt 24 timmar, och den naiva varianten (lägg 86 400 000 ms på en LOKAL midnatt och läs
 * tillbaka lokala fält) beter sig då IDENTISKT med den korrekta. Verifierat, inte antaget: med den
 * naiva implementationen inlagd passerar hela den här filen 27/27 under TZ=UTC och failar 3 under
 * TZ=Europe/Stockholm.
 *
 * En vakt som är vilande i CI är ingen vakt. Därför sätter blocket sin egen zon i stället för att
 * hoppas att någon minns att köra `TZ=Europe/Stockholm npm test` för hand.
 *
 * ⚠️ ZONEN ÅTERSTÄLLS I afterAll. `process.env.TZ` är PROCESSGLOBAL, och en vitest-worker kör flera
 * testfiler efter varandra i samma process — utan återställningen hade nästa fil tyst mätt svensk
 * tid i stället för runnerns, vilket är precis den sortens dolda zonberoende det här testet finns
 * för att utrota.
 *
 * (Zonen sätts BARA här. Att pinna TZ globalt i vitest.config.ts vore en annan och mycket större
 * ändring — den skulle flytta grunden under alla 2800 testerna på en gång.)
 */
describe('addDaysISO över sommartidsväxlingarna', () => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Europe/Stockholm';
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('förutsättning: zonen ÄR en DST-zon just nu, annars prövar blocket ingenting', () => {
    // Utan den här raden kan hela blocket vara tomt utan att något syns — en sommartidszon som
    // inte längre har sommartid ser ut som ett godkänt test.
    const sommar = new Date(2026, 6, 1).getTimezoneOffset();
    const vinter = new Date(2026, 0, 1).getTimezoneOffset();
    expect(sommar).not.toBe(vinter);
  });

  it('passerar höstens växling (25/10 2026, dygnet är 25 timmar)', () => {
    expect(addDaysISO('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDaysISO('2026-10-25', 1)).toBe('2026-10-26');
    // Bakåt är det backningen av ledtiden som går över växlingen.
    expect(addDaysISO('2026-10-26', -1)).toBe('2026-10-25');
    expect(addDaysISO('2026-10-25', -1)).toBe('2026-10-24');
  });

  it('passerar vårens växling (29/3 2026, dygnet är 23 timmar)', () => {
    expect(addDaysISO('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDaysISO('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDaysISO('2026-03-30', -1)).toBe('2026-03-29');
  });

  it('en ledtid som spänner över växlingen backar rätt antal dygn', () => {
    // 7 dagar bakåt från 2026-10-28 passerar växlingen den 25:e.
    expect(addDaysISO('2026-10-28', -7)).toBe('2026-10-21');
  });

  it('n steg om en dag är samma sak som ett steg om n dagar', () => {
    let cur = '2026-10-20';
    for (let i = 0; i < 14; i++) cur = addDaysISO(cur, 1);
    expect(cur).toBe(addDaysISO('2026-10-20', 14));
    expect(cur).toBe('2026-11-03');
  });

  it('går över månads- och årsskifte', () => {
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysISO('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29'); // skottår
  });

  it('prognosen backar ledtiden korrekt över växlingen', () => {
    const f = run({
      today: '2026-10-01',
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 100, day: '2026-10-28' }],
      supply: new Map([[supplyKey(SYD, EKO), { leadTimeDays: 7, roundUpTo: 1 }]]),
    });
    expect(rowFor(f).suggested_date).toBe('2026-10-21');
  });
});

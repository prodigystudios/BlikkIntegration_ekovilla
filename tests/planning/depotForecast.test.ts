import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { describeSuggestion, forecastDepotRunOut, rowsNeedingOrder, supplyKey } from '@/lib/domains/planning/depotForecast';
import { addDaysISO } from '@/lib/domains/planning/timezone';
import { sacksPerPalletFor } from '@/lib/domains/crm/materials';

// Den tidsfasade prognosen: NÄR tar depån slut, och hur mycket ska beställas.
//
// Varje regel här har en riktning som kostar pengar och en som ställer en bil utan material. Testen
// namnger vilken.

const SYD = 'depot-syd';
const NORR = 'depot-norr';
const EKO = 'EKOVILLA';
const KNAUF = 'KNAUF SUPAFIL';
// Material med OKÄND pallstorlek — packningen är inte inrapporterad än.
const OKAND_PALL = 'PAROC';

// 🧨 HÄRLEDDA UR KATALOGEN, inte handskrivna. Ändras packningen i materials.ts ska testet räkna om
// sig, inte tyst pröva ett tal som inte längre gäller. Samma läxa som skiftlägestestet i
// materialSuppliers.test.ts.
const EKO_PALL = sacksPerPalletFor(EKO)!;
const KNAUF_PALL = sacksPerPalletFor(KNAUF)!;

describe('fixturernas förutsättningar', () => {
  it('katalogen bär de packningar testerna räknar på', () => {
    expect(EKO_PALL).toBeGreaterThan(0);
    expect(KNAUF_PALL).toBeGreaterThan(0);
    // Skiljer de sig inte prövar "per material"-testerna ingenting.
    expect(EKO_PALL).not.toBe(KNAUF_PALL);
    // Och det MÅSTE finnas ett material utan känd packning, annars är null-vägen otestad.
    expect(sacksPerPalletFor(OKAND_PALL)).toBeNull();
  });
});
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
    expect(r.worst_deficit).toBe(180); // det verkliga underskottet
    // …men beställningen sker i hela pallar: 180 / 54 = 3,33 -> 4 pallar.
    expect(r.suggested_sacks).toBe(4 * EKO_PALL);
    expect(r.suggested_pallets).toBe(4);
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
      supply: new Map([[supplyKey(SYD, EKO), { leadTimeDays: 7 }]]),
    });
    expect(rowFor(f).suggested_date).toBe('2026-09-23');
  });

  it('aldrig före idag — en beställning kan inte skickas i går', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 100, day: '2026-09-15' }],
      supply: new Map([[supplyKey(SYD, EKO), { leadTimeDays: 30 }]]),
    });
    expect(rowFor(f).suggested_date).toBe(TODAY);
  });

  /**
   * 🧨 UTAN KÄND LEDTID FINNS INGET DATUM ATT VISA — INTE run-out-dagen.
   *
   * Med ledtid 0 blir max(idag, runOut − 0) exakt lika med runOut, alltså "beställ senast den dag
   * depån är tom". Det är ett SENARE datum än det rätta och läses som en instruktion. Fallbacken
   * såg alltså ut som ett svar och pekade åt fel håll — den farliga riktningen.
   *
   * Vägen dit var inte teoretisk: leverantörsvillkoren var RLS-grindade hårdare än lagerrutten, så
   * för varje planerare som inte var admin kom noll rader tillbaka UTAN FEL.
   */
  it('utan leverantörsuppgift: INGET datum, och supply_known säger varför', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 187, day: '2026-09-30' }],
    });
    const r = rowFor(f);
    expect(r.supply_known).toBe(false);
    expect(r.suggested_date).toBeNull();
    // Antalet går fortfarande att räkna och avrundas till hel pall — pallstorleken hör till
    // MATERIALET och är känd även när leverantören inte är det. De två är skilda axlar.
    expect(r.suggested_sacks).toBe(4 * EKO_PALL); // 187 -> 216
    expect(r.sacks_per_pallet).toBe(EKO_PALL);
    expect(r.run_out_day).toBe('2026-09-30');
  });

  it('med leverantörsuppgift och ledtid 0 finns datumet — då BETYDER run-out-dagen något', () => {
    // Skillnaden mot testet ovan: här VET vi att ledtiden är noll ("levererar samma dag"), och då
    // är run-out-dagen ett riktigt svar. Okänt och noll är inte samma sak.
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 187, day: '2026-09-30' }],
      supply: new Map([[supplyKey(SYD, EKO), { leadTimeDays: 0 }]]),
    });
    const r = rowFor(f);
    expect(r.supply_known).toBe(true);
    expect(r.suggested_date).toBe('2026-09-30');
  });

  it('avrundar upp till hel pall — en gång, på totalen', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [
        { depot_id: SYD, material: EKO, sacks: 1, day: '2026-09-15' },
        { depot_id: SYD, material: EKO, sacks: 1, day: '2026-09-16' },
        { depot_id: SYD, material: EKO, sacks: 1, day: '2026-09-17' },
      ],
    });
    // Avrundat per dag hade det blivit TRE pallar. Behovet är 3 säckar, alltså EN pall.
    expect(rowFor(f).worst_deficit).toBe(3);
    expect(rowFor(f).suggested_sacks).toBe(EKO_PALL);
    expect(rowFor(f).suggested_pallets).toBe(1);
  });
});

describe('horisonten', () => {
  /**
   * 🧨 UTAN HORISONT BLIR suggested_sacks HELA RESTBEHOVET. worst_deficit är den djupaste punkten
   * över det som räknas, så ett jobb ett halvår fram drog upp DAGENS förslag till hela sitt
   * säckantal — daterat till den FÖRSTA run-outen. "Beställ 3 000 säck på tisdag."
   */
  it('ett jobb bortom horisonten styr inte dagens förslag', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [
        { depot_id: SYD, material: EKO, sacks: 100, day: '2026-09-20' },
        { depot_id: SYD, material: EKO, sacks: 3000, day: '2027-03-01' }, // ett halvår fram
      ],
      horizonDays: 90,
    });
    const r = rowFor(f);
    expect(r.worst_deficit).toBe(100);
    expect(r.suggested_sacks).toBe(2 * EKO_PALL); // 100 -> 108, två pallar
    // Men det tigs inte ihjäl — att veta att 3 000 säck är bokade längre fram avgör om man ska
    // passa på att beställa mer nu.
    expect(r.beyond_horizon).toBe(3000);
  });

  it('en händelse PÅ horisonten räknas med — gränsen är inklusive', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 100, day: '2026-10-14' }], // exakt +30
      horizonDays: 30,
    });
    expect(rowFor(f).worst_deficit).toBe(100);
    expect(rowFor(f).beyond_horizon).toBe(0);
  });

  it('ett inflöde bortom horisonten sänker inte dagens brist', () => {
    // Att räkna in det hade täckt en brist med material som kommer efter att den uppstått.
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 100, day: '2026-09-20' }],
      inflow: [{ depot_id: SYD, material: EKO, sacks: 100, day: '2027-03-01' }],
      horizonDays: 90,
    });
    expect(rowFor(f).worst_deficit).toBe(100);
  });

  it('defaultar till 90 dagar när ingen horisont anges', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [
        { depot_id: SYD, material: EKO, sacks: 10, day: '2026-11-01' }, // inom 90 dagar
        { depot_id: SYD, material: EKO, sacks: 5000, day: '2027-06-01' }, // långt bortom
      ],
    });
    expect(rowFor(f).worst_deficit).toBe(10);
    expect(rowFor(f).beyond_horizon).toBe(5000);
  });
});

describe('redan negativt ingångssaldo', () => {
  /**
   * 🧨 EN DEPÅ SOM REDAN STÅR PÅ MINUS TAR SLUT IDAG, INTE VID NÄSTA BOKADE JOBB.
   *
   * run_out sattes bara inne i händelseloopen, så ett negativt saldo daterades till nästa händelse
   * — kanske veckor bort. Samtidigt bröts invarianten rowsNeedingOrder sorterar på: worst_deficit
   * över noll men run_out_day null.
   */
  it('run-out är idag, inte nästa händelse', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: -50 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 10, day: '2026-10-20' }],
    });
    const r = rowFor(f);
    expect(r.run_out_day).toBe(TODAY);
    expect(r.shortfall_at_run_out).toBe(50);
    expect(r.worst_deficit).toBe(60);
  });

  it('negativt saldo UTAN några händelser ger ändå en run-out-dag', () => {
    const f = run({ opening: [{ depot_id: SYD, material: EKO, sacks: -50 }] });
    const r = rowFor(f);
    expect(r.worst_deficit).toBe(50);
    expect(r.run_out_day).toBe(TODAY);
  });

  // Invarianten som sorteringen i rowsNeedingOrder vilar på.
  it('varje rad med ett underskott har en run-out-dag', () => {
    const f = run({
      opening: [
        { depot_id: SYD, material: EKO, sacks: -50 },
        { depot_id: NORR, material: EKO, sacks: 0 },
      ],
      demand: [{ depot_id: NORR, material: EKO, sacks: 10, day: '2026-09-20' }],
    });
    for (const r of rowsNeedingOrder(f)) expect(r.run_out_day).not.toBeNull();
  });
});

describe('pallstorleken hör till MATERIALET, inte leverantören', () => {
  /**
   * 🧨 GÅR INTE ATT HÄRLEDA UR SÄCKVIKTEN. Ekovilla packar 54 säckar à 14 kg (756 kg/pall), Knauf
   * 24 à 15,5 kg (372 kg/pall) — en pall bär alltså varken ett givet antal eller en given vikt.
   * Talet är packningsfakta per material. (William 2026-09-11.)
   */
  it('samma behov ger olika antal för olika material', () => {
    const f = run({
      opening: [
        { depot_id: SYD, material: EKO, sacks: 0 },
        { depot_id: SYD, material: KNAUF, sacks: 0 },
      ],
      demand: [
        { depot_id: SYD, material: EKO, sacks: 100, day: '2026-09-20' },
        { depot_id: SYD, material: KNAUF, sacks: 100, day: '2026-09-20' },
      ],
    });
    const eko = rowFor(f, SYD, EKO);
    const knauf = rowFor(f, SYD, KNAUF);
    expect(eko.worst_deficit).toBe(100);
    expect(knauf.worst_deficit).toBe(100);
    // Samma underskott, olika beställning — det är hela poängen med att talet är per material.
    expect(eko.suggested_sacks).toBe(2 * EKO_PALL); // 108
    expect(knauf.suggested_sacks).toBe(5 * KNAUF_PALL); // 120
    expect(eko.suggested_sacks).not.toBe(knauf.suggested_sacks);
  });

  /**
   * ⚠️ OKÄND PACKNING FÅR INTE SE UT SOM "INGA PALLAR". Samma regel som supply_known för ledtiden:
   * hellre säga att vi inte vet än att föreslå ett säckantal fabriken inte kan leverera.
   */
  it('okänd pallstorlek avrundar inte, och säger det', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: OKAND_PALL, sacks: 0 }],
      demand: [{ depot_id: SYD, material: OKAND_PALL, sacks: 187, day: '2026-09-20' }],
    });
    const r = rowFor(f, SYD, OKAND_PALL);
    expect(r.sacks_per_pallet).toBeNull();
    expect(r.suggested_pallets).toBeNull();
    // Det råa underskottet, orört.
    expect(r.suggested_sacks).toBe(187);
  });

  it('ett exakt jämnt behov ger inte en extra pall', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 0 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 2 * EKO_PALL, day: '2026-09-20' }],
    });
    expect(rowFor(f).suggested_sacks).toBe(2 * EKO_PALL);
    expect(rowFor(f).suggested_pallets).toBe(2);
  });

  it('inget behov ger noll pallar, inte en', () => {
    const f = run({
      opening: [{ depot_id: SYD, material: EKO, sacks: 500 }],
      demand: [{ depot_id: SYD, material: EKO, sacks: 10, day: '2026-09-20' }],
    });
    expect(rowFor(f).suggested_sacks).toBe(0);
    expect(rowFor(f).suggested_pallets).toBe(0);
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
      supply: new Map([[supplyKey(SYD, EKO), { leadTimeDays: 7 }]]),
    });
    expect(rowFor(f).suggested_date).toBe('2026-10-21');
  });
});


// ---------------------------------------------------------------------------
// describeSuggestion — vad kortet SÄGER
// ---------------------------------------------------------------------------
//
// ⚠️ Reglerna satt förut inlagda i JSX:en och var därmed otestbara: vitest plockar bara upp
// .test.ts, kör i node utan DOM, och en .tsx-komponent når sviten inte alls. Utbruten hit är varje
// regel prövbar — och det är regler, inte formgivning: vilken enhet som visas, svensk numerus, och
// när det råa behovet ska stå bredvid det avrundade talet.

describe('describeSuggestion', () => {
  const row = (over: Partial<ReturnType<typeof rowFor>> = {}) =>
    ({
      depot_id: SYD,
      depot_name: 'Depå Syd',
      material: EKO,
      opening: 0,
      run_out_day: '2026-09-20',
      shortfall_at_run_out: 10,
      worst_deficit: 187,
      suggested_sacks: 4 * EKO_PALL,
      suggested_pallets: 4,
      sacks_per_pallet: EKO_PALL,
      supply_known: true,
      beyond_horizon: 0,
      overdue_inflow: 0,
      ...over,
    }) as ReturnType<typeof rowFor>;

  it('visar pallar som enhet, med säckantalet inom parentes', () => {
    const p = describeSuggestion(row());
    expect(p).toEqual({ kind: 'pallets', pallets: 4, unit: 'pallar', sacks: 216, deficit: 187 });
  });

  it('en pall heter "pall", inte "pallar"', () => {
    const p = describeSuggestion(row({ suggested_pallets: 1, suggested_sacks: EKO_PALL }));
    expect(p.kind === 'pallets' && p.unit).toBe('pall');
  });

  it('flera pallar heter "pallar"', () => {
    expect(describeSuggestion(row({ suggested_pallets: 2 })).kind === 'pallets').toBe(true);
    const p = describeSuggestion(row({ suggested_pallets: 2 }));
    expect(p.kind === 'pallets' && p.unit).toBe('pallar');
  });

  // "(216 säck, behovet är 216)" vore bara brus. Behovet skrivs ut bara när avrundningen FLYTTADE
  // talet — annars säger raden samma sak två gånger.
  it('utelämnar behovet när det redan är jämnt delbart', () => {
    const p = describeSuggestion(row({ worst_deficit: 4 * EKO_PALL }));
    expect(p.kind === 'pallets' && p.deficit).toBeNull();
  });

  it('skriver ut behovet när avrundningen flyttade talet', () => {
    const p = describeSuggestion(row({ worst_deficit: 187 }));
    expect(p.kind === 'pallets' && p.deficit).toBe(187);
  });

  /**
   * ⚠️ OKÄND PACKNING BYTER GREN, den visar inte "0 pallar". Ett säckantal utan pallstorlek är
   * inget man kan beställa, och kortet ska säga varför i stället för att se komplett ut.
   */
  it('okänd pallstorlek ger säckar och materialets namn', () => {
    const p = describeSuggestion(row({ sacks_per_pallet: null, suggested_pallets: null, suggested_sacks: 187, material: OKAND_PALL }));
    expect(p).toEqual({ kind: 'unknown_pallet', sacks: 187, material: OKAND_PALL });
  });

  // 🧨 Frågan är `=== null`, inte falsy: en nolla och en okänd packning får aldrig behandlas lika.
  it('noll pallar är ett svar, inte en okänd packning', () => {
    const p = describeSuggestion(row({ suggested_pallets: 0, suggested_sacks: 0, worst_deficit: 0 }));
    expect(p.kind).toBe('pallets');
    expect(p.kind === 'pallets' && p.unit).toBe('pallar');
  });
});

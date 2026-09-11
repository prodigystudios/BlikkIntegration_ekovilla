import { describe, it, expect } from 'vitest';
import { deliveriesAfterCounts, latestCounts, type DatedMovement, type StockCount } from '@/lib/domains/planning/stockCounts';
import { computeDepotBalances, consumptionAfterCounts } from '@/lib/domains/planning/depotStock';
import { stockCountSchema } from '@/app/api/crm/planering/_lib';
import { stockholmTodayISO, addDaysISO } from '@/lib/domains/planning/timezone';

// Avstämning av depålagret: "den här dagen stod det X säckar på depån".
//
// Två felklasser har redan bitit här, båda i den farliga riktningen (saldot för HÖGT, bristbanderollen
// tyst), och båda gick igenom en tidigare version av den här filen gröna:
//
//   1. Förbrukningen drogs genom ett DATUMFILTER. Säckrapporteringen har en supersede-regel —
//      egenkontrollen ersätter delrapporterna — så filtret dubbelräknade.
//   2. Rättelsen daterade egenkontrollen efter sin report_day. Men den report_day är jobbets FÖRSTA
//      dag (förifylld ur tidigaste segmentet), så varje pågående jobb hamnade "före räkningen".
//      Testfixturerna daterade egenkontrollen till räkningsdagen — något produktionen aldrig gör — och
//      dolde felet.
//
// Därför: fixturerna nedan daterar en egenkontroll SOM PRODUKTIONEN GÖR (report_day = jobbets första
// dag, created_at = när den skrevs), och balanceWith kör PRODUKTIONENS väg — inte en förenklad kopia.

const SYD = 'depot-syd';
const NORR = 'depot-norr';
const EKO = 'EKOVILLA';
const DEPOTS = [{ id: SYD, name: 'Syd' }];
const FLEET = new Map<string, string | null>([['truck-syd', SYD], ['truck-norr', NORR]]);

const count = (sacks: number, counted_on: string, over: Partial<StockCount> = {}): StockCount => ({
  depot_id: SYD,
  material: EKO,
  sacks,
  counted_on,
  ...over,
});
const delivery = (sacks: number, day: string, over: Partial<DatedMovement> = {}): DatedMovement => ({
  depot_id: SYD,
  material: EKO,
  sacks,
  day,
  ...over,
});

/**
 * En säckrapport som produktionen skriver den.
 *
 * ⚠️ En DELRAPPORT bär den faktiska arbetsdagen (förifylld med dagens datum). En EGENKONTROLL bär
 * jobbets FÖRSTA dag som report_day, oavsett när den skrivs — det är `created_at` som säger när.
 */
function partial(sacks: number, workDay: string, over: Record<string, unknown> = {}) {
  return {
    work_order_id: 'wo1',
    sacks_blown: sacks,
    kind: 'partial',
    material: EKO,
    report_day: workDay,
    created_at: `${workDay}T15:00:00Z`,
    segment: { truck_id: 'truck-syd' },
    ...over,
  };
}
function final(sacks: number, jobFirstDay: string, writtenOn: string, over: Record<string, unknown> = {}) {
  return {
    work_order_id: 'wo1',
    sacks_blown: sacks,
    kind: 'final',
    material: EKO,
    report_day: jobFirstDay, // ← som produktionen: installationDate = tidigaste segmentets start
    created_at: `${writtenOn}T15:00:00Z`,
    segment: { truck_id: 'truck-syd' },
    ...over,
  };
}

/** PRODUKTIONENS väg: senaste räkning -> leveranser och förbrukning avgränsade -> baslinje. */
function balanceWith(
  counts: StockCount[],
  deliveries: DatedMovement[],
  reports: Array<ReturnType<typeof partial>>,
) {
  const latest = latestCounts(counts);
  const rows = computeDepotBalances(
    DEPOTS,
    deliveriesAfterCounts(deliveries, latest),
    consumptionAfterCounts(reports, FLEET, latest),
    [],
    latest,
  );
  return rows[0].rows.find((r) => r.material === EKO)!;
}

describe('avstämning, inte justering', () => {
  /**
   * Måndag morgon räknas 400. I fredags blåstes 50, men rapporten skickas först på tisdag. En
   * justering hade dragit av de 50 en gång till — 350, fast det står 400 på depån.
   */
  it('en sen rapport för arbete före räkningen dras INTE av en gång till', () => {
    const r = balanceWith([count(400, '2026-09-14')], [], [partial(50, '2026-09-11')]);
    expect(r.balance).toBe(400);
  });

  it('förbrukning EFTER räkningen dras av som vanligt', () => {
    const r = balanceWith([count(400, '2026-09-14')], [], [partial(30, '2026-09-15')]);
    expect(r.balance).toBe(370);
  });

  it('en leverans efter räkningen läggs på', () => {
    const r = balanceWith([count(400, '2026-09-14')], [delivery(1296, '2026-09-16')], []);
    expect(r.balance).toBe(1696);
  });

  it('en leverans före räkningen läggs INTE på — den står redan på depån', () => {
    const r = balanceWith([count(400, '2026-09-14')], [delivery(1296, '2026-09-10')], []);
    expect(r.balance).toBe(400);
  });
});

describe('räkningsdagen — ASYMMETRISKT, så att ett fel alltid blir för lågt', () => {
  /**
   * Förbrukning PÅ räkningsdagen dras av (räknas som efter). Blåstes den i själva verket FÖRE räkningen
   * blir saldot för lågt — ofarligt.
   */
  it('förbrukning PÅ räkningsdagen dras av', () => {
    const r = balanceWith([count(400, '2026-09-14')], [], [partial(50, '2026-09-14')]);
    expect(r.balance).toBe(350);
  });

  /**
   * 🧨 En leverans PÅ räkningsdagen läggs INTE på (räknas som före). Kom den på morgonen innan man räknade
   * står den redan i antalet — att lägga på den igen gav ett för HÖGT saldo. En tidigare version gjorde
   * precis det och påstod "samma regel åt båda håll"; det testet stod här och var grönt.
   */
  it('en leverans PÅ räkningsdagen läggs INTE på — den kan redan finnas i antalet', () => {
    const r = balanceWith([count(400, '2026-09-14')], [delivery(1296, '2026-09-14')], []);
    expect(r.balance).toBe(400);
  });
});

describe('egenkontrollen — daterad som produktionen daterar den', () => {
  /**
   * 🧨 FALLET SOM TVÅ VERSIONER MISSADE.
   *
   * Jobbet startar fredag. Delrapport fredag 50. Räkning måndag morgon: 400. Egenkontrollen skrivs
   * TISDAG med 120 — men dess report_day är FREDAG, jobbets första dag, eftersom fältet förifylls så.
   *
   * Vid räkningen fanns bara delrapporten (50). Nu gäller egenkontrollen (120). Efter räkningen 70.
   * Den version som jämförde egenkontrollens report_day lade den "före räkningen", fick 120 − 120 = 0
   * och saldot 400 — 70 för högt.
   */
  it('en egenkontroll skriven efter räkningen drar av det som blåstes efter räkningen', () => {
    const r = balanceWith(
      [count(400, '2026-09-14')],
      [],
      [partial(50, '2026-09-11'), final(120, '2026-09-11', '2026-09-15')],
    );
    expect(r.balance).toBe(330);
  });

  /**
   * Saldot får inte HOPPA UPP när egenkontrollen sparas. Före egenkontrollen: delrapporterna efter
   * räkningen dras av. Efter: egenkontrollen minus delrapporterna före räkningen. Stämmer delrapporterna
   * med slutsiffran ska de två vara lika.
   */
  it('saldot står still när en egenkontroll som stämmer med delrapporterna kommer in', () => {
    const partials = [partial(50, '2026-09-11'), partial(70, '2026-09-15')];
    const innan = balanceWith([count(400, '2026-09-14')], [], partials);
    const efter = balanceWith(
      [count(400, '2026-09-14')],
      [],
      [...partials, final(120, '2026-09-11', '2026-09-16')],
    );
    expect(innan.balance).toBe(330);
    expect(efter.balance).toBe(innan.balance);
  });

  it('ett jobb vars egenkontroll skrevs FÖRE räkningen drar av noll efter den', () => {
    const r = balanceWith(
      [count(400, '2026-09-14')],
      [],
      [partial(50, '2026-09-10'), final(120, '2026-09-10', '2026-09-12')],
    );
    expect(r.balance).toBe(400);
  });

  it('en egenkontroll skriven PÅ räkningsdagen räknas som efter', () => {
    const r = balanceWith([count(400, '2026-09-14')], [], [final(120, '2026-09-10', '2026-09-14')]);
    expect(r.balance).toBe(280);
  });

  /**
   * created_at är en UTC-tidsstämpel, räkningen en svensk kalenderdag. En egenkontroll skriven 00:30
   * svensk tid (22:30 UTC dagen innan) hör till den SVENSKA dagen.
   */
  it('created_at tolkas som svensk kalenderdag, inte UTC', () => {
    // 2026-09-13T22:30Z = 2026-09-14 00:30 i Stockholm (sommartid, UTC+2) — alltså PÅ räkningsdagen.
    const r = balanceWith(
      [count(400, '2026-09-14')],
      [],
      [final(120, '2026-09-10', '2026-09-14', { created_at: '2026-09-13T22:30:00Z' })],
    );
    // I UTC hade den blivit 09-13, alltså "före räkningen", och dragit av noll -> 400.
    expect(r.balance).toBe(280);
  });

  it('utan räkning: hela summan efter supersede, precis som förut', () => {
    const r = balanceWith([], [], [partial(50, '2026-09-11'), final(120, '2026-09-11', '2026-09-15')]);
    expect(r.balance).toBe(-120);
  });
});

describe('golvet vid noll — per arbetsorder', () => {
  /**
   * Ett jobb vars delrapport ligger vid Syd före räkningen och vars egenkontroll hamnar på en bil vid
   * Norr efteråt: egenkontrollen flyttar hela attributionen, och Syd skulle få −50.
   */
  it('en depå får aldrig negativ förbrukning när ett jobb byter depå över räkningen', () => {
    const rows = consumptionAfterCounts(
      [
        partial(50, '2026-09-11'),
        final(120, '2026-09-11', '2026-09-15', { segment: { truck_id: 'truck-norr' } }),
      ],
      FLEET,
      latestCounts([count(400, '2026-09-14')]),
    );
    const syd = rows.find((r) => r.depot_id === SYD);
    // ⚠️ Syd-raden FINNS INTE i resultatet — hela jobbet attribueras till Norr i totalen, och Syd har
    // ingen annan förbrukning. Den tidigare versionen av testet skrev `?? 0` och godkände därmed
    // "raden saknas" som om den vore noll: testet kunde inte bli rött. Här står det uttryckligen.
    expect(syd).toBeUndefined();
    expect(rows.find((r) => r.depot_id === NORR)?.sacks).toBe(120);
  });

  /**
   * 🧨 DET SOM FAKTISKT KAN GÅ FEL: golvet på depåns SUMMA i stället för per jobb. Då äter det ena
   * jobbets negativa bidrag upp ett ANNAT jobbs verkliga förbrukning, och depån ser orörd ut.
   */
  /**
   * ⚠️ Scenariot MÅSTE ge jobb 1 Syd-nyckeln på BÅDA sidor. En tidigare version av testet lade hela
   * egenkontrollen på Norr — då finns Syd aldrig i jobbets totalsumma, det negativa bidraget uppstår
   * aldrig, och testet var grönt även med golvet flyttat till summan. Mutationstestet visade det.
   *
   * Det realistiska fallet är en egenkontroll i flera ETAPPER där en del av jobbet flyttade depå:
   *   wo1: delrapport Syd 50 före räkningen. Egenkontrollen: etapp Syd 20 + etapp Norr 100.
   *        Vid räkningen: Syd 50.  Nu: Syd 20.  Bidrag till Syd: 20 − 50 = −30.
   *   wo2: ett vanligt jobb vid Syd som blåser 50 efter räkningen.  Bidrag: +50.
   *
   *   per arbetsorder:  max(0, −30) + 50 = 50   ← rätt: wo2:s säckar gick åt
   *   golv på summan:   max(0, −30 + 50) = 20  ← 30 av wo2:s säckar försvann i wo1:s minus
   */
  it('ett jobbs negativa bidrag äter inte upp ett annat jobbs verkliga förbrukning', () => {
    const rows = consumptionAfterCounts(
      [
        partial(50, '2026-09-11'),
        final(20, '2026-09-11', '2026-09-15'),
        final(100, '2026-09-11', '2026-09-15', { segment: { truck_id: 'truck-norr' } }),
        partial(50, '2026-09-15', { work_order_id: 'wo2' }),
      ],
      FLEET,
      latestCounts([count(400, '2026-09-14')]),
    );
    expect(rows.find((r) => r.depot_id === SYD)?.sacks).toBe(50);
    expect(rows.find((r) => r.depot_id === NORR)?.sacks).toBe(100);
  });
});

describe('fantomsaldot försvinner', () => {
  it('en räkning ersätter ett negativt saldo helt', () => {
    const r = balanceWith([count(400, '2026-09-14')], [delivery(2000, '2026-08-01')], [partial(3100, '2026-08-20')]);
    expect(r.balance).toBe(400);
    expect(r.counted).toBe(400);
    expect(r.counted_on).toBe('2026-09-14');
  });

  it('kan rätta ett för HÖGT saldo — det som inte gick alls före avstämningarna', () => {
    const r = balanceWith([count(300, '2026-09-14')], [delivery(1000, '2026-09-01')], [partial(100, '2026-09-05')]);
    expect(r.balance).toBe(300);
  });
});

describe('senaste räkningen gäller', () => {
  it('den med högst räkningsdatum vinner', () => {
    const r = balanceWith([count(400, '2026-09-10'), count(250, '2026-09-14')], [], []);
    expect(r.balance).toBe(250);
    expect(r.counted_on).toBe('2026-09-14');
  });

  it('en efterhandsinmatad äldre räkning tar inte över från en nyare', () => {
    const r = balanceWith([count(250, '2026-09-14'), count(400, '2026-09-10')], [], []);
    expect(r.balance).toBe(250);
  });

  /** En felaktig räkning rättas med en ny, SAMMA dag — den senast inmatade måste vinna. */
  it('två räkningar samma dag: den senast inmatade vinner', () => {
    const r = balanceWith([count(400, '2026-09-14'), count(380, '2026-09-14')], [], []);
    expect(r.balance).toBe(380);
  });
});

describe('null är inte noll', () => {
  it('en räkning på noll är en baslinje på noll', () => {
    const r = balanceWith([count(0, '2026-09-14')], [delivery(500, '2026-09-01')], []);
    expect(r.balance).toBe(0);
    expect(r.counted).toBe(0);
  });

  it('utan räkning är counted null och saldot räknas över all tid som förut', () => {
    const r = balanceWith([], [delivery(500, '2026-09-01')], [partial(100, '2026-09-05')]);
    expect(r.counted).toBeNull();
    expect(r.counted_on).toBeNull();
    expect(r.balance).toBe(400);
  });

  it('en räkning utan några rörelser efteråt visar ändå sin rad', () => {
    expect(balanceWith([count(400, '2026-09-14')], [], []).balance).toBe(400);
  });
});

describe('räkningen gäller bara sin egen depå och sitt eget material', () => {
  it('rör inte ett annat material på samma depå', () => {
    const latest = latestCounts([count(400, '2026-09-14')]);
    const rows = computeDepotBalances(
      DEPOTS,
      deliveriesAfterCounts([delivery(500, '2026-09-01', { material: 'KNAUF SUPAFIL' })], latest),
      [],
      [],
      latest,
    )[0].rows;
    const knauf = rows.find((r) => r.material === 'KNAUF SUPAFIL')!;
    expect(knauf.balance).toBe(500);
    expect(knauf.counted).toBeNull();
  });

  it('rör inte samma material på en annan depå', () => {
    const latest = latestCounts([count(400, '2026-09-14')]);
    expect(deliveriesAfterCounts([delivery(500, '2026-09-01', { depot_id: NORR })], latest)).toHaveLength(1);
  });
});

describe('planerat behov', () => {
  it('shortfall räknas mot det avstämda saldot', () => {
    const latest = latestCounts([count(400, '2026-09-14')]);
    const r = computeDepotBalances(DEPOTS, [], [], [{ depot_id: SYD, material: EKO, sacks: 600 }], latest)[0].rows[0];
    expect(r.balance).toBe(400);
    expect(r.planned).toBe(600);
    expect(r.shortfall).toBe(200);
  });
});

describe('stockCountSchema', () => {
  const today = stockholmTodayISO();
  const base = { depot_id: '11111111-1111-4111-8111-111111111111', material: EKO, counted_sacks: 400, counted_on: today };

  it('godtar en räkning idag', () => {
    expect(stockCountSchema.safeParse(base).success).toBe(true);
  });

  it('godtar noll — en tom depå är ett svar', () => {
    expect(stockCountSchema.safeParse({ ...base, counted_sacks: 0 }).success).toBe(true);
  });

  it('avvisar ett negativt antal', () => {
    expect(stockCountSchema.safeParse({ ...base, counted_sacks: -1 }).success).toBe(false);
  });

  it('avvisar ett datum i framtiden', () => {
    expect(stockCountSchema.safeParse({ ...base, counted_on: addDaysISO(today, 1) }).success).toBe(false);
  });

  it('godtar ett passerat datum — en räkning får föras över i efterhand', () => {
    expect(stockCountSchema.safeParse({ ...base, counted_on: addDaysISO(today, -7) }).success).toBe(true);
  });

  it('avvisar ett material utanför katalogen', () => {
    expect(stockCountSchema.safeParse({ ...base, material: 'LÖSULL' }).success).toBe(false);
  });

  it('avvisar skräp i antalet i stället för att tolka det som noll', () => {
    for (const junk of [null, '', true, [], 'abc']) {
      expect(stockCountSchema.safeParse({ ...base, counted_sacks: junk }).success).toBe(false);
    }
  });
});

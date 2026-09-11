import { describe, it, expect } from 'vitest';
import { latestCounts, movementsAfterCounts, type DatedMovement, type StockCount } from '@/lib/domains/planning/stockCounts';
import { computeDepotBalances } from '@/lib/domains/planning/depotStock';
import { stockCountSchema } from '@/app/api/crm/planering/_lib';
import { stockholmTodayISO, addDaysISO } from '@/lib/domains/planning/timezone';

// Avstämning av depålagret: "den här dagen stod det X säckar på depån".
//
// Kärnfrågan är ETT scenario, och det är därför modellen är avstämning och inte justering: en rapport
// för arbete FÖRE räkningen som kommer in EFTER den. Med en justering dras de säckarna av två gånger.

const SYD = 'depot-syd';
const EKO = 'EKOVILLA';
const DEPOTS = [{ id: SYD, name: 'Syd' }];

const count = (sacks: number, counted_on: string, over: Partial<StockCount> = {}): StockCount => ({
  depot_id: SYD,
  material: EKO,
  sacks,
  counted_on,
  ...over,
});
const move = (sacks: number, day: string, over: Partial<DatedMovement> = {}): DatedMovement => ({
  depot_id: SYD,
  material: EKO,
  sacks,
  day,
  ...over,
});

/** Hela kedjan som lagerläsningen kör: senaste räkning -> stryk det som redan syns -> baslinje. */
function balanceWith(counts: StockCount[], delivered: DatedMovement[], consumed: DatedMovement[]) {
  const latest = latestCounts(counts);
  const rows = computeDepotBalances(
    DEPOTS,
    movementsAfterCounts(delivered, latest),
    movementsAfterCounts(consumed, latest),
    [],
    latest,
  );
  return rows[0].rows.find((r) => r.material === EKO)!;
}

describe('avstämning, inte justering', () => {
  /**
   * 🧨 SCENARIOT HELA MODELLEN ÄR BYGGD FÖR.
   *
   * Måndag morgon räknas 400. I fredags blåstes 50 säckar, men rapporten skickas först på tisdag.
   * En justering (skriv in skillnaden) hade dragit av de 50 en gång till när rapporten kom — 350,
   * fast det står 400 på depån. Här räknas saldot FRÅN räkningen, och fredagens 50 syns redan i de 400.
   */
  it('en sen rapport för arbete före räkningen dras INTE av en gång till', () => {
    const r = balanceWith(
      [count(400, '2026-09-14')], // måndag
      [],
      [move(50, '2026-09-11')], // fredagens arbete, rapporterat på tisdagen
    );
    expect(r.balance).toBe(400);
  });

  it('förbrukning EFTER räkningen dras av som vanligt', () => {
    const r = balanceWith([count(400, '2026-09-14')], [], [move(30, '2026-09-15')]);
    expect(r.balance).toBe(370);
  });

  it('en leverans efter räkningen läggs på', () => {
    const r = balanceWith([count(400, '2026-09-14')], [move(1296, '2026-09-16')], []);
    expect(r.balance).toBe(1696);
  });

  it('en leverans före räkningen läggs INTE på — den står redan på depån', () => {
    const r = balanceWith([count(400, '2026-09-14')], [move(1296, '2026-09-10')], []);
    expect(r.balance).toBe(400);
  });

  /**
   * ⚠️ RÄKNINGEN GÄLLER VID DAGENS BÖRJAN. Förbrukning på räkningsdagen dras av efteråt.
   *
   * Räknade man på morgonen innan en bil blåste 50 säckar är det rätt. Räknade man efter blir saldot
   * en dags förbrukning för LÅGT — det ofarliga hållet. Motsatt regel hade gjort det för HÖGT, och ett
   * för högt saldo tystar bristbanderollen.
   */
  it('förbrukning PÅ räkningsdagen dras av — räkningen gäller vid dagens början', () => {
    const r = balanceWith([count(400, '2026-09-14')], [], [move(50, '2026-09-14')]);
    expect(r.balance).toBe(350);
  });

  it('en leverans PÅ räkningsdagen läggs på — samma regel åt båda håll', () => {
    const r = balanceWith([count(400, '2026-09-14')], [move(100, '2026-09-14')], []);
    expect(r.balance).toBe(500);
  });
});

describe('fantomsaldot försvinner', () => {
  /**
   * Varför avstämningen behövs nu: Sandviken stod på −1100 för att ingående lager aldrig registrerats
   * (levererat 2000, förbrukat 3100). En enda räkning ska göra saldot rätt, oavsett vad som hänt före.
   */
  it('en räkning ersätter ett negativt saldo helt', () => {
    const r = balanceWith(
      [count(400, '2026-09-14')],
      [move(2000, '2026-08-01')],
      [move(3100, '2026-08-20')],
    );
    expect(r.balance).toBe(400);
    expect(r.counted).toBe(400);
    expect(r.counted_on).toBe('2026-09-14');
  });

  it('kan rätta ett för HÖGT saldo — det som inte gick alls före avstämningarna', () => {
    // Bokfört 900 (blåsta säckar som aldrig rapporterats), räknat 300.
    const r = balanceWith([count(300, '2026-09-14')], [move(1000, '2026-09-01')], [move(100, '2026-09-05')]);
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
    // Inmatningsordningen säger 14:e först, 10:e sist — men det är räkningsDAGEN som avgör.
    const r = balanceWith([count(250, '2026-09-14'), count(400, '2026-09-10')], [], []);
    expect(r.balance).toBe(250);
  });

  /**
   * 🧨 En felaktig räkning rättas med en ny, SAMMA dag. Då måste den senast inmatade vinna — med `>` i
   * stället för `>=` hade den första stått kvar och rättelsen varit verkningslös, tyst.
   */
  it('två räkningar samma dag: den senast inmatade vinner', () => {
    const r = balanceWith([count(400, '2026-09-14'), count(380, '2026-09-14')], [], []);
    expect(r.balance).toBe(380);
  });
});

describe('null är inte noll', () => {
  /**
   * ⚠️ En räkning på 0 är ett av de viktigaste svaren: depån är tom, och bristbanderollen ska tändas.
   * Den får aldrig behandlas som "ingen räkning".
   */
  it('en räkning på noll är en baslinje på noll', () => {
    const r = balanceWith([count(0, '2026-09-14')], [move(500, '2026-09-01')], []);
    expect(r.balance).toBe(0);
    expect(r.counted).toBe(0);
    expect(r.counted_on).toBe('2026-09-14');
  });

  it('utan räkning är counted null och saldot räknas över all tid som förut', () => {
    const r = balanceWith([], [move(500, '2026-09-01')], [move(100, '2026-09-05')]);
    expect(r.counted).toBeNull();
    expect(r.counted_on).toBeNull();
    expect(r.balance).toBe(400);
  });

  it('en räkning utan några rörelser efteråt visar ändå sin rad', () => {
    const r = balanceWith([count(400, '2026-09-14')], [], []);
    expect(r).toBeDefined();
    expect(r.balance).toBe(400);
  });
});

describe('räkningen gäller bara sin egen depå och sitt eget material', () => {
  it('rör inte ett annat material på samma depå', () => {
    const latest = latestCounts([count(400, '2026-09-14')]);
    const rows = computeDepotBalances(
      DEPOTS,
      movementsAfterCounts([move(500, '2026-09-01', { material: 'KNAUF SUPAFIL' })], latest),
      [],
      [],
      latest,
    )[0].rows;
    // Knauf har ingen räkning — dess leverans före 14:e ska stå kvar.
    expect(rows.find((r) => r.material === 'KNAUF SUPAFIL')!.balance).toBe(500);
    expect(rows.find((r) => r.material === 'KNAUF SUPAFIL')!.counted).toBeNull();
  });

  it('rör inte samma material på en annan depå', () => {
    const latest = latestCounts([count(400, '2026-09-14')]);
    const kept = movementsAfterCounts([move(500, '2026-09-01', { depot_id: 'depot-norr' })], latest);
    expect(kept).toHaveLength(1);
  });
});

describe('planerat behov påverkas inte av räkningen', () => {
  /**
   * Säckar som blåsts före räkningen är redan borta ur det räknade antalet OCH redan avdragna ur det
   * planerade behovet. De finns alltså varken i saldot eller i det som återstår — invarianten från
   * etapp 0 ("varje säck ur planned måste också ur balance") håller.
   */
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

  /**
   * 🧨 En framtidsdaterad räkning blir baslinje DIREKT och stryker all förbrukning före sitt datum —
   * saldot fryses på ett tal ingen har räknat. Samma felklass som den framtidsdaterade leveransen.
   */
  it('avvisar ett datum i framtiden', () => {
    const parsed = stockCountSchema.safeParse({ ...base, counted_on: addDaysISO(today, 1) });
    expect(parsed.success).toBe(false);
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

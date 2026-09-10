import { addDaysISO } from './timezone';
import { roundUpToMultiple } from './materialSuppliers';
import type { StockRow, DemandExclusion } from './depotStock';

// Tidsfasad prognos: NÄR tar depån slut, och hur mycket ska beställas.
//
// Dagens bristsiffra (`shortfall` i computeDepotBalances) är en totalsumma över alla öppna jobb. Den
// säger HUR MYCKET som fattas, aldrig NÄR — och en beställning behöver båda: ett antal och ett
// datum. Den här modulen är den andra halvan.
//
// Ren, utan sidoeffekter och utan databasanrop. Underlaget byggs av getDepotForecast i depotStock.
//
// ⚠️ SAMMA URVAL SOM SALDOT. Behovet kommer ur pickDemandSegments, alltså exakt de rader
// bristbanderollen räknar på. Skrivs urvalet en andra gång här driver de två isär tyst — banderollen
// larmar om en depå prognosen kallar försörjd, eller tvärtom, och ingendera felar.
//
// ⚠️ VANDRINGEN SKER I ISO-STRÄNGAR, aldrig i Date-objekt. 'YYYY-MM-DD' sorterar lexikografiskt =
// kronologiskt, och en sträng har ingen tidszon att tolka fel. Se addDaysISO om varför.

/** En daterad rörelse: behov (ut) eller inflöde (in) för en depå och ett material. */
export type ForecastEvent = StockRow & {
  /** 'YYYY-MM-DD'. */
  day: string;
};

export type DepotMaterialForecast = {
  depot_id: string;
  depot_name: string;
  material: string;
  /** Saldot idag: levererat − förbrukat. */
  opening: number;
  /** Första dagen saldot går under noll, eller null när det räcker horisonten ut. */
  run_out_day: string | null;
  /** Hur mycket som fattas den dag det tar slut. */
  shortfall_at_run_out: number;
  /**
   * STÖRSTA underskottet över hela horisonten — inte det första.
   *
   * 🧨 Det är skillnaden mellan att beställa rätt och att beställa två gånger. Två jobb kan ge −40
   * på tisdag och −180 på fredag; beställer man 40 räcker det till fredag och sedan står bilen där
   * ändå. Det är alltså den DJUPASTE punkten som ska täckas.
   */
  worst_deficit: number;
  /** worst_deficit avrundat upp till leverantörens beställningsstorlek. */
  suggested_sacks: number;
  /** Senaste dag beställningen kan skickas för att hinna fram: run_out − ledtid, aldrig före idag. */
  suggested_date: string | null;
  /**
   * Beställt material vars datum redan passerat utan att ha kvitterats.
   *
   * ⚠️ RÄKNAS INTE IN I SALDOT. En försenad leverans är inte en anländ leverans, och att låta den
   * täcka behovet vore att lita på ett datum som redan visat sig fel. Redovisas separat så att den
   * som beställer kan ringa fabriken i stället för att beställa en gång till.
   */
  overdue_inflow: number;
};

export type DepotForecast = {
  rows: DepotMaterialForecast[];
  /** Jobb vars behov inte kunde räknas fullt ut. Ska renderas, aldrig sväljas. */
  excluded: DemandExclusion[];
};

export type ForecastInput = {
  depots: { id: string; name: string }[];
  /** Saldo idag per depå och material (levererat − förbrukat). */
  opening: StockRow[];
  /** Planerat behov, daterat till det vinnande segmentets startdag. */
  demand: ForecastEvent[];
  /** Utestående beställningar, på sitt väntade datum. */
  inflow: ForecastEvent[];
  /** stockholmTodayISO(), aldrig new Date() i anroparen. */
  today: string;
  /** Per depå+material: ledtid och beställningsstorlek hos den leverantör som skulle få ordern. */
  supply?: Map<string, { leadTimeDays: number; roundUpTo: number }>;
  excluded?: DemandExclusion[];
};

/** Nyckel för supply-kartan. Exporterad så anroparen bygger den på exakt samma sätt. */
export function supplyKey(depotId: string, material: string): string {
  // U+0000 som avgränsare, inte mellanslag: materialkoderna innehåller BÅDE mellanslag
  // ('KNAUF SUPAFIL') och snedstreck ('ISOCELL/ISECO'). Ett tecken som inte kan förekomma i något av
  // fälten gör nyckeln entydig utan att man behöver resonera om det.
  return `${depotId}\u0000${material}`;
}

type Cell = {
  opening: number;
  /** dag -> { in, out } */
  byDay: Map<string, { inflow: number; demand: number }>;
  overdue: number;
};

export function forecastDepotRunOut(input: ForecastInput): DepotForecast {
  const depotName = new Map(input.depots.map((d) => [d.id, d.name]));

  // Nästlade kartor i stället för en sammanslagen strängnyckel — samma form som
  // computeDepotBalances, och ingen kodning att resonera om.
  const acc = new Map<string, Map<string, Cell>>();
  const ensure = (depotId: string, material: string): Cell => {
    let byMat = acc.get(depotId);
    if (!byMat) {
      byMat = new Map();
      acc.set(depotId, byMat);
    }
    let cell = byMat.get(material);
    if (!cell) {
      cell = { opening: 0, byDay: new Map(), overdue: 0 };
      byMat.set(material, cell);
    }
    return cell;
  };
  const day = (cell: Cell, d: string) => {
    let slot = cell.byDay.get(d);
    if (!slot) {
      slot = { inflow: 0, demand: 0 };
      cell.byDay.set(d, slot);
    }
    return slot;
  };

  // Saldot först. En nyckel med rörelse men utan saldo får 0 — samma regel som computeDepotBalances:
  // att aldrig ha haft en leverans är inte samma sak som att inte finnas.
  for (const r of input.opening) ensure(r.depot_id, r.material).opening += r.sacks;

  for (const e of input.demand) {
    if (!(e.sacks > 0)) continue;
    const cell = ensure(e.depot_id, e.material);
    // ⚠️ FÖRBRUKNING FÖRE IDAG BOKFÖRS PÅ IDAG, den slängs inte. Ett jobb som var bokat i förrgår
    // men inte rapporterats har inte dragit något ur lagret — säckarna ska fortfarande gå åt. Kastas
    // posten underskattas behovet, och underskattning är den riktning som ställer en bil utan
    // material.
    day(cell, e.day < input.today ? input.today : e.day).demand += e.sacks;
  }

  for (const e of input.inflow) {
    if (!(e.sacks > 0)) continue;
    const cell = ensure(e.depot_id, e.material);
    // ⚠️ SPEGELVÄNT MOT BEHOVET, med flit. Ett inflöde daterat före idag har INTE kommit — datumet
    // har passerat och ingen har kvitterat. Att vika in det på idag vore att anta att det dök upp,
    // och då slocknar bristvarningen på material som fortfarande står hos fabriken.
    if (e.day < input.today) cell.overdue += e.sacks;
    else day(cell, e.day).inflow += e.sacks;
  }

  const rows: DepotMaterialForecast[] = [];
  for (const d of input.depots) {
    const byMat = acc.get(d.id);
    if (!byMat) continue;
    for (const [material, cell] of [...byMat.entries()].sort((a, b) => a[0].localeCompare(b[0], 'sv'))) {
      // Bara dagar som HAR en händelse. Mellanliggande dagar ändrar ingenting, och att vandra dem
      // vore att göra horisontens längd till en prestandafråga.
      const days = [...cell.byDay.keys()].sort();

      let balance = cell.opening;
      let runOut: string | null = null;
      let shortfallAtRunOut = 0;
      let lowest = balance;

      for (const dayKey of days) {
        const slot = cell.byDay.get(dayKey)!;
        // ⚠️ INFLÖDE FÖRE FÖRBRUKNING SAMMA DAG. En leverans på morgonen täcker dagens blåsning; i
        // omvänd ordning rapporterar prognosen en brist som aldrig inträffade och beställer material
        // som redan står på depån.
        balance += slot.inflow;
        balance -= slot.demand;
        if (balance < lowest) lowest = balance;
        if (balance < 0 && runOut === null) {
          runOut = dayKey;
          shortfallAtRunOut = -balance;
        }
      }

      const worst = Math.max(0, -lowest);
      const supply = input.supply?.get(supplyKey(d.id, material));
      const leadTimeDays = supply?.leadTimeDays ?? 0;
      const roundUpTo = supply?.roundUpTo ?? 1;

      rows.push({
        depot_id: d.id,
        depot_name: depotName.get(d.id) ?? 'Okänd depå',
        material,
        opening: cell.opening,
        run_out_day: runOut,
        shortfall_at_run_out: shortfallAtRunOut,
        worst_deficit: worst,
        // Avrundas EN gång, på totalen. Se roundUpToMultiple om varför aldrig per delbehov.
        suggested_sacks: roundUpToMultiple(worst, roundUpTo),
        // Aldrig före idag: en beställning kan inte skickas i går. Räcker lagret finns ingen dag.
        suggested_date: runOut ? maxISO(input.today, addDaysISO(runOut, -leadTimeDays)) : null,
        overdue_inflow: cell.overdue,
      });
    }
  }

  return { rows, excluded: input.excluded ?? [] };
}

/** Senare av två ISO-datum. Lexikografisk jämförelse — 'YYYY-MM-DD' sorterar kronologiskt. */
function maxISO(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * Ren: raderna som faktiskt behöver beställas, brådskande först.
 *
 * ⚠️ `worst_deficit > 0`, inte `run_out_day !== null`. De sammanfaller idag, men villkoren betyder
 * olika saker: det ena är "saldot dyker under noll någon gång", det andra "det finns ett underskott
 * att täcka". Det är underskottet som ska beställas.
 */
export function rowsNeedingOrder(forecast: DepotForecast): DepotMaterialForecast[] {
  return forecast.rows
    .filter((r) => r.worst_deficit > 0)
    .sort((a, b) => {
      // Tidigast run-out först: det är den som brådskar. Null sist (kan inte inträffa här, men
      // sorteringen ska inte bero på det).
      const ad = a.run_out_day ?? '9999-12-31';
      const bd = b.run_out_day ?? '9999-12-31';
      return ad.localeCompare(bd) || b.worst_deficit - a.worst_deficit;
    });
}

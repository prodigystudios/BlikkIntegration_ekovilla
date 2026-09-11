import { addDaysISO } from './timezone';
import { roundUpToMultiple } from './materialSuppliers';
import { sacksPerPalletFor } from '@/lib/domains/crm/materials';
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
// ⛔ ETT FULLT LASS MODELLERAS INTE, och ska inte göra det. Antalet pallar på en bil varierar, och
// bilen kan dessutom ta med andra produkter — "fullt lass" är kapacitet, inte en beställningsenhet
// (Williams besked 2026-09-11). Att avgöra om bilen ska fyllas resten av vägen är ett mänskligt
// beslut; systemet vet inte vad mer som ska med. (Det fanns ett "test" som skulle vakta det här
// genom att matcha nyckelnamn mot /load|lass|truck/ — det bevisade ingenting och är borttaget. Att
// ett begrepp INTE finns går inte att enhetstesta; den här kommentaren är vakten.)
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
  /**
   * Vad som ska beställas: worst_deficit avrundat UPP till hel pall.
   *
   * När pallstorleken är okänd (sacks_per_pallet === null) sker ingen avrundning och talet är det
   * råa underskottet — men då säger UI:t att pallstorleken saknas, i stället för att presentera ett
   * säckantal fabriken inte kan leverera.
   */
  suggested_sacks: number;
  /** suggested_sacks uttryckt i hela pallar, eller null när pallstorleken är okänd. */
  suggested_pallets: number | null;
  /**
   * Säckar per pall för materialet, eller null när packningen inte är känd.
   *
   * ⚠️ null betyder "vi vet inte", inte "inga pallar". Samma regel som supply_known för ledtiden:
   * ett okänt värde får aldrig se ut som ett uträknat svar.
   */
  sacks_per_pallet: number | null;
  /**
   * Senaste dag beställningen kan skickas för att hinna fram: run_out − ledtid, aldrig före idag.
   *
   * ⚠️ null NÄR LEDTIDEN ÄR OKÄND (supply_known === false), inte run-out-dagen. Med ledtid 0 blir
   * uttrycket lika med run_out_day — alltså "beställ senast den dag depån är tom", vilket är ett
   * SENARE datum och läses som en instruktion. En okänd ledtid får inte se ut som ett svar.
   */
  suggested_date: string | null;
  /**
   * Fanns det en LEDTID för det här materialet? Gäller bara datumet.
   *
   * ⚠️ SÄGER INGENTING OM PALLSTORLEKEN. De två är skilda axlar: ledtiden kommer från leverantören,
   * packningen från materialet (sacks_per_pallet). En rad kan mycket väl ha känd pall och okänd
   * ledtid — då avrundas antalet men inget datum visas. Att läsa det här fältet som "vet vi allt?"
   * var sant i en tidigare modell och är det inte längre.
   *
   * false betyder antingen att ingen aktiv leverantör bär materialet, eller att FLERA gör det —
   * defaultSupplierForMaterial gissar aldrig mellan två fabriker. Åt båda hållen är svaret att
   * datumet inte går att räkna, och det ska UI:t säga rakt ut i stället för att visa ett tal som
   * ser räknat ut.
   */
  supply_known: boolean;
  /**
   * Behov som ligger BORTOM horisonten och därför inte räknats in.
   *
   * Redovisas, inte döljs: att veta att det finns 800 säck bokade längre fram är precis vad som
   * avgör om man ska passa på att beställa mer nu. Men de får inte styra dagens förslag.
   */
  beyond_horizon: number;
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
  /**
   * Hur långt fram prognosen räknar, i dagar från idag. Default 90.
   *
   * ⚠️ UTAN HORISONT BLIR suggested_sacks HELA RESTBEHOVET. worst_deficit är den djupaste punkten
   * över det som räknas, så ett jobb bokat ett halvår fram drog upp DAGENS förslag till hela sitt
   * säckantal — daterat till den FÖRSTA run-outen, alltså "beställ 3 000 säck på tisdag". Det är
   * den ofarliga riktningen (för mycket, för tidigt) men det gör förslaget obrukbart.
   *
   * 90 dagar är en FÖRSTA GISSNING och inte ett fattat beslut — den bör bekräftas mot hur långt
   * fram planeringen i praktiken är bindande. Händelser bortom horisonten redovisas i
   * beyond_horizon i stället för att tigas ihjäl.
   */
  horizonDays?: number;
  /**
   * Per depå+material: LEDTIDEN hos den leverantör som skulle få ordern.
   *
   * ⚠️ Pallstorleken ligger INTE här. Den hör till materialet (sacksPerPalletFor), inte till
   * fabriken — Ekovilla packar 54 säckar per pall och Knauf 24, oavsett vem som säljer.
   */
  supply?: Map<string, { leadTimeDays: number }>;
  excluded?: DemandExclusion[];
};

/** Nyckel för supply-kartan. Exporterad så anroparen bygger den på exakt samma sätt. */
export function supplyKey(depotId: string, material: string): string {
  // U+0000 som avgränsare, inte mellanslag: materialkoderna innehåller BÅDE mellanslag
  // ('KNAUF SUPAFIL') och snedstreck ('ISOCELL/ISECO'). Ett tecken som inte kan förekomma i något av
  // fälten gör nyckeln entydig utan att man behöver resonera om det.
  return `${depotId}\u0000${material}`;
}

/**
 * ⚠️ EN FÖRSTA GISSNING, INTE ETT FATTAT BESLUT. Bekräftas mot hur långt fram planeringen i
 * praktiken är bindande. Se horizonDays.
 */
export const DEFAULT_HORIZON_DAYS = 90;

type Cell = {
  opening: number;
  /** dag -> { in, out } */
  byDay: Map<string, { inflow: number; demand: number }>;
  overdue: number;
  beyond: number;
};

export function forecastDepotRunOut(input: ForecastInput): DepotForecast {
  const depotName = new Map(input.depots.map((d) => [d.id, d.name]));
  // Sista dagen som räknas. Inklusive: en händelse PÅ horisonten hör till det vi planerar för.
  const horizonEnd = addDaysISO(input.today, Math.max(0, input.horizonDays ?? DEFAULT_HORIZON_DAYS));

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
      cell = { opening: 0, byDay: new Map(), overdue: 0, beyond: 0 };
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
    if (e.day > horizonEnd) {
      // Bortom horisonten: redovisas, men styr inte dagens förslag. Se horizonDays.
      cell.beyond += e.sacks;
      continue;
    }
    day(cell, e.day < input.today ? input.today : e.day).demand += e.sacks;
  }

  for (const e of input.inflow) {
    if (!(e.sacks > 0)) continue;
    const cell = ensure(e.depot_id, e.material);
    // ⚠️ SPEGELVÄNT MOT BEHOVET, med flit. Ett inflöde daterat före idag har INTE kommit — datumet
    // har passerat och ingen har kvitterat. Att vika in det på idag vore att anta att det dök upp,
    // och då slocknar bristvarningen på material som fortfarande står hos fabriken.
    if (e.day < input.today) cell.overdue += e.sacks;
    // Ett inflöde bortom horisonten täcker inget av det vi räknar på. Att räkna in det hade sänkt
    // dagens brist med material som kommer efter att den redan uppstått — fel riktning.
    else if (e.day <= horizonEnd) day(cell, e.day).inflow += e.sacks;
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
      // ⚠️ ETT REDAN NEGATIVT SALDO TAR SLUT IDAG, INTE VID NÄSTA HÄNDELSE. Sattes run_out bara
      // inne i loopen fick en depå som redan står på minus sin run-out-dag daterad till nästa
      // bokade jobb — kanske veckor bort — trots att den är tom nu. Då bryts också invarianten som
      // rowsNeedingOrder sorterar på: worst_deficit > 0 utan run_out_day.
      let runOut: string | null = cell.opening < 0 ? input.today : null;
      let shortfallAtRunOut = cell.opening < 0 ? -cell.opening : 0;
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
      const supplyKnown = supply !== undefined;
      // Pallstorleken kommer ur MATERIALKATALOGEN, inte ur leverantören. null = okänd packning:
      // ingen avrundning, och UI:t skriver ut varför.
      const perPallet = sacksPerPalletFor(material);
      const suggested = perPallet ? roundUpToMultiple(worst, perPallet) : worst;

      rows.push({
        depot_id: d.id,
        depot_name: depotName.get(d.id) ?? 'Okänd depå',
        material,
        opening: cell.opening,
        run_out_day: runOut,
        shortfall_at_run_out: shortfallAtRunOut,
        worst_deficit: worst,
        // Avrundas EN gång, på totalen. Se roundUpToMultiple om varför aldrig per delbehov.
        suggested_sacks: suggested,
        suggested_pallets: perPallet ? suggested / perPallet : null,
        sacks_per_pallet: perPallet,
        // Aldrig före idag: en beställning kan inte skickas i går. Räcker lagret finns ingen dag —
        // och utan kända leveransvillkor finns ingen dag att räkna fram, se supply_known.
        suggested_date: runOut && supplyKnown ? maxISO(input.today, addDaysISO(runOut, -leadTimeDays)) : null,
        supply_known: supplyKnown,
        beyond_horizon: cell.beyond,
        overdue_inflow: cell.overdue,
      });
    }
  }

  return { rows, excluded: input.excluded ?? [] };
}

/**
 * Vad prognoskortet ska säga om EN rads beställning — som data, inte som färdig text.
 *
 * ⚠️ BOR HÄR OCH INTE I JSX:EN. Reglerna nedan (vilken enhet som visas, singular/plural, när
 * behovet ska skrivas ut bredvid det avrundade talet) är beslut, inte formgivning — och inlagda i
 * ForecastCard var de otestbara: vitest plockar bara upp .test.ts, kör i node utan DOM, och en
 * .tsx-komponent når sviten inte alls. Kortet mappar delarna till spans; färgerna hör dit, orden hit.
 */
export type SuggestionParts =
  | {
      kind: 'pallets';
      pallets: number;
      /** 'pall' eller 'pallar' — svenskan är en regel, inte en formgivningsfråga. */
      unit: 'pall' | 'pallar';
      sacks: number;
      /**
       * Det råa underskottet, men BARA när avrundningen faktiskt flyttade talet. Är behovet redan
       * jämnt delbart vore "(216 säck, behovet är 216)" bara brus.
       */
      deficit: number | null;
    }
  | {
      kind: 'unknown_pallet';
      sacks: number;
      material: string;
    };

export function describeSuggestion(row: DepotMaterialForecast): SuggestionParts {
  // ⚠️ null, inte 0, är frågan. sacks_per_pallet === 0 kan inte förekomma (katalogen vaktas), men
  // att fråga efter `!row.sacks_per_pallet` hade behandlat en okänd packning och en nolla lika.
  if (row.sacks_per_pallet === null || row.suggested_pallets === null) {
    return { kind: 'unknown_pallet', sacks: row.suggested_sacks, material: row.material };
  }
  return {
    kind: 'pallets',
    pallets: row.suggested_pallets,
    unit: row.suggested_pallets === 1 ? 'pall' : 'pallar',
    sacks: row.suggested_sacks,
    deficit: row.suggested_sacks !== row.worst_deficit ? row.worst_deficit : null,
  };
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

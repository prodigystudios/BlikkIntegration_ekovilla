import { describe, it, expect } from 'vitest';
import {
  applyReportedToDemand, attributePlannedDemand, computeDepotBalances, pickDemandSegments,
  reportedDemandByWorkOrder, type PlannedDemandSegment, type StockRow,
} from '@/lib/domains/planning/depotStock';
import { materialShortFromLineItems, MATERIAL_SHORTS } from '@/lib/domains/crm/materials';

describe('computeDepotBalances', () => {
  const depots = [
    { id: 'd1', name: 'Huvudlager' },
    { id: 'd2', name: 'Syd' },
  ];

  it('nets deliveries against consumption per depot + material', () => {
    const delivered: StockRow[] = [
      { depot_id: 'd1', material: 'EKOVILLA', sacks: 100 },
      { depot_id: 'd1', material: 'EKOVILLA', sacks: 50 }, // two deliveries, same material
      { depot_id: 'd1', material: 'PAROC', sacks: 40 },
    ];
    const consumed: StockRow[] = [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 30 }];

    const d1 = computeDepotBalances(depots, delivered, consumed).find((d) => d.depot_id === 'd1')!;
    const eko = d1.rows.find((r) => r.material === 'EKOVILLA')!;
    // Utan räkning: counted är null (inte 0) och saldot är levererat − förbrukat över all tid, precis
    // som före avstämningarna.
    expect(eko).toEqual({ material: 'EKOVILLA', delivered: 150, consumed: 30, counted: null, counted_on: null, balance: 120, planned: 0, shortfall: 0 });
    expect(d1.rows.find((r) => r.material === 'PAROC')!.balance).toBe(40);
    expect(d1.total_balance).toBe(160);
  });

  it('shows a material that has only consumption (negative balance)', () => {
    const d1 = computeDepotBalances(depots, [], [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 25 }]).find((d) => d.depot_id === 'd1')!;
    expect(d1.rows[0]).toEqual({ material: 'EKOVILLA', delivered: 0, consumed: 25, counted: null, counted_on: null, balance: -25, planned: 0, shortfall: 25 });
  });

  it('flags a shortfall when planned demand exceeds the balance', () => {
    const delivered: StockRow[] = [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 150 }];
    const planned: StockRow[] = [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 250 }];
    const eko = computeDepotBalances(depots, delivered, [], planned).find((d) => d.depot_id === 'd1')!.rows[0];
    expect(eko).toMatchObject({ material: 'EKOVILLA', balance: 150, planned: 250, shortfall: 100 });
  });

  it('no shortfall when the balance covers the planned demand', () => {
    const delivered: StockRow[] = [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 300 }];
    const planned: StockRow[] = [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 250 }];
    expect(computeDepotBalances(depots, delivered, [], planned)[0].rows[0].shortfall).toBe(0);
  });

  it('returns every depot, with empty rows when it has no movements', () => {
    const result = computeDepotBalances(depots, [{ depot_id: 'd1', material: 'PAROC', sacks: 10 }], []);
    expect(result.map((d) => d.depot_id)).toEqual(['d1', 'd2']);
    expect(result.find((d) => d.depot_id === 'd2')!.rows).toEqual([]);
    expect(result.find((d) => d.depot_id === 'd2')!.total_balance).toBe(0);
  });
});

describe('materialShortFromLineItems', () => {
  it('returns the short of the first recognised material', () => {
    const short = materialShortFromLineItems([{ article_name: 'Ekovilla Cellulosa Lösull' }]);
    expect(short).toBe('EKOVILLA');
    expect(MATERIAL_SHORTS).toContain(short);
  });
  it('returns null when no material is recognised', () => {
    expect(materialShortFromLineItems([{ article_name: 'Arbete' }])).toBeNull();
    expect(materialShortFromLineItems(null)).toBeNull();
  });
});

describe('attributePlannedDemand', () => {
  const seg = (over: Partial<PlannedDemandSegment> = {}): PlannedDemandSegment => ({
    work_order_id: 'wo1',
    depot_id: 'd1',
    status: 'scheduled',
    materials: [{ material: 'EKOVILLA', sacks: 40 }],
    ...over,
  });

  it('counts a work order once even when it spans several segments', () => {
    expect(attributePlannedDemand([seg(), seg(), seg()])).toEqual([
      { depot_id: 'd1', material: 'EKOVILLA', sacks: 40 },
    ]);
  });

  it('ger EN RAD PER MATERIAL — jobbet räknas en gång, materialen var för sig', () => {
    // 🧨 Regression: hela säckantalet lades på orderns FÖRSTA material, så det andra fick inget
    // planerat behov alls. Det syntes som ett oförklarligt negativt saldo på en depå som aldrig
    // sett en leverans av det materialet — och i materialbeställningen väljer materialet fabrik.
    const rows = attributePlannedDemand([
      seg({ materials: [{ material: 'EKOVILLA', sacks: 200 }, { material: 'KNAUF SUPAFIL', sacks: 80 }] }),
    ]);
    expect(rows).toEqual([
      { depot_id: 'd1', material: 'EKOVILLA', sacks: 200 },
      { depot_id: 'd1', material: 'KNAUF SUPAFIL', sacks: 80 },
    ]);
  });

  it('dedupen gäller jobbet, inte materialet — ett flersegmentsjobb dubblar inte sina material', () => {
    const two = { materials: [{ material: 'EKOVILLA', sacks: 200 }, { material: 'PAROC', sacks: 30 }] };
    expect(attributePlannedDemand([seg(two), seg(two)])).toHaveLength(2);
  });

  it('falls through to the next segment when the first truck has no depot', () => {
    // Regression: the work order used to be marked seen before the depot check, so a job whose
    // earliest segment sat on a depot-less truck vanished from planned demand entirely — taking
    // the shortfall warning with it.
    const rows = attributePlannedDemand([seg({ depot_id: null }), seg({ depot_id: 'd2' })]);
    expect(rows).toEqual([{ depot_id: 'd2', material: 'EKOVILLA', sacks: 40 }]);
  });

  it('still drops a work order that never resolves to a depot', () => {
    expect(attributePlannedDemand([seg({ depot_id: null }), seg({ depot_id: null })])).toEqual([]);
  });

  it('attributes to the first valid segment, so input order decides the depot', () => {
    const rows = attributePlannedDemand([seg({ depot_id: 'd2' }), seg({ depot_id: 'd1' })]);
    expect(rows).toEqual([{ depot_id: 'd2', material: 'EKOVILLA', sacks: 40 }]);
  });

  it('ignores closed work orders and rows with nothing to blow', () => {
    expect(attributePlannedDemand([seg({ status: 'completed' })])).toEqual([]);
    expect(attributePlannedDemand([seg({ status: null })])).toEqual([]);
    expect(attributePlannedDemand([seg({ materials: [{ material: 'EKOVILLA', sacks: 0 }] })])).toEqual([]);
    expect(attributePlannedDemand([seg({ materials: [] })])).toEqual([]);
    expect(attributePlannedDemand([seg({ work_order_id: null })])).toEqual([]);
  });

  it('ett material utan säckar faller bort, resten av ordern står kvar', () => {
    // Inte "hela jobbet försvinner": en rad utan densitet ger noll säckar för sitt material, men
    // säger ingenting om de andra materialen på samma order.
    const rows = attributePlannedDemand([
      seg({ materials: [{ material: 'EKOVILLA', sacks: 0 }, { material: 'PAROC', sacks: 30 }] }),
    ]);
    expect(rows).toEqual([{ depot_id: 'd1', material: 'PAROC', sacks: 30 }]);
  });

  it('keeps separate work orders apart', () => {
    const rows = attributePlannedDemand([
      seg(),
      seg({ work_order_id: 'wo2', depot_id: 'd2', materials: [{ material: 'EKOVILLA', sacks: 12 }] }),
    ]);
    expect(rows).toEqual([
      { depot_id: 'd1', material: 'EKOVILLA', sacks: 40 },
      { depot_id: 'd2', material: 'EKOVILLA', sacks: 12 },
    ]);
  });
});

describe('reportedDemandByWorkOrder', () => {
  // t1 hör till en depå, t0 gör det inte — samma två fall som förbrukningssidan skiljer på.
  const fleet = new Map<string, string | null>([['t1', 'd1'], ['t0', null]]);
  const rapport = (over: Record<string, unknown> = {}) => ({
    work_order_id: 'wo1',
    sacks_blown: 30,
    kind: 'partial',
    material: 'EKOVILLA',
    segment: { truck_id: 't1' },
    ...over,
  });

  it('summerar delrapporter per material', () => {
    const map = reportedDemandByWorkOrder([
      rapport(),
      rapport({ sacks_blown: 25 }),
      rapport({ material: 'PAROC', sacks_blown: 10 }),
    ], fleet);
    expect(map.get('wo1')!.hasFinal).toBe(false);
    expect([...map.get('wo1')!.byDepotMaterial.get('d1')!]).toEqual([['EKOVILLA', 55], ['PAROC', 10]]);
  });

  it('en final är jobbets sanning — delrapporterna adderas inte ovanpå', () => {
    // 30 + 25 delrapporterat, sista besöket 36 till, egenkontroll skriven på TOTALEN 91.
    // Naiv summering hade gett 146. Regeln bor i sackLedger; det här vaktar att den används.
    const map = reportedDemandByWorkOrder([
      rapport({ sacks_blown: 30 }),
      rapport({ sacks_blown: 25 }),
      rapport({ kind: 'final', sacks_blown: 91 }),
    ], fleet);
    expect(map.get('wo1')!.byDepotMaterial.get('d1')?.get('EKOVILLA')).toBe(91);
  });

  it('hasFinal läses ur de RÅA raderna, inte ur de effektiva', () => {
    const map = reportedDemandByWorkOrder([rapport(), rapport({ kind: 'final', sacks_blown: 91 })], fleet);
    expect(map.get('wo1')!.hasFinal).toBe(true);
  });

  it('faller tillbaka på orderns material för rader skrivna innan kolumnen fanns', () => {
    const map = reportedDemandByWorkOrder([
      rapport({ material: null, work_order: { line_items: [{ article_name: 'Ekovilla Cellulosa Lösull' }] } }),
    ], fleet);
    expect(map.get('wo1')!.byDepotMaterial.get('d1')?.get('EKOVILLA')).toBe(30);
  });

  it('en rad utan härledbart material lämnar jobbet känt men utan avdrag', () => {
    // "Vi vet att jobbet rapporterat" är inte "vi vet vad som drogs". Behovet ska då stå kvar
    // orört — överskatta hellre än att beställa för lite.
    const map = reportedDemandByWorkOrder([rapport({ material: null, work_order: { line_items: [] } })], fleet);
    expect(map.has('wo1')).toBe(true);
    expect(map.get('wo1')!.byDepotMaterial.size).toBe(0);
  });

  it('en rapport från en bil UTAN depå ger inget avdrag', () => {
    // 🧨 Invarianten som gör shortfall värd att lita på: varje säck som dras från `planned` måste
    // också ha dragits från `balance`. deriveConsumptionRows hoppar tyst över segment vars bil
    // saknar depot_id, så räknades avdraget här skulle behovet sjunka utan att saldot gjorde det —
    // och bristvarningen tystna på en depå som verkligen tömts.
    const map = reportedDemandByWorkOrder([rapport({ segment: { truck_id: 't0' } })], fleet);
    expect(map.get('wo1')!.byDepotMaterial.size).toBe(0);
  });

  it('en rapport utan segment ger inget avdrag', () => {
    const map = reportedDemandByWorkOrder([rapport({ segment: null })], fleet);
    expect(map.get('wo1')!.byDepotMaterial.size).toBe(0);
  });

  it('håller isär depåerna inom samma arbetsorder', () => {
    // Ett splittat jobb: samma order, två bilar, två depåer. Beloppen får inte slås ihop — det är
    // vad som gör att avdraget kan hållas per depå längre fram.
    const split = new Map<string, string | null>([['t1', 'd1'], ['t2', 'd2']]);
    const map = reportedDemandByWorkOrder(
      [rapport({ sacks_blown: 30 }), rapport({ segment: { truck_id: 't2' }, sacks_blown: 45 })],
      split,
    );
    expect(map.get('wo1')!.byDepotMaterial.get('d1')?.get('EKOVILLA')).toBe(30);
    expect(map.get('wo1')!.byDepotMaterial.get('d2')?.get('EKOVILLA')).toBe(45);
  });

  it('håller isär arbetsordrar', () => {
    const map = reportedDemandByWorkOrder([rapport(), rapport({ work_order_id: 'wo2', sacks_blown: 7 })], fleet);
    expect(map.get('wo1')!.byDepotMaterial.get('d1')?.get('EKOVILLA')).toBe(30);
    expect(map.get('wo2')!.byDepotMaterial.get('d1')?.get('EKOVILLA')).toBe(7);
  });
});

describe('applyReportedToDemand', () => {
  const seg = (over: Partial<PlannedDemandSegment> = {}): PlannedDemandSegment => ({
    work_order_id: 'wo1',
    depot_id: 'd1',
    status: 'in_progress',
    materials: [{ material: 'EKOVILLA', sacks: 564 }],
    ...over,
  });
  const reported = (over: Partial<{ hasFinal: boolean; byMaterial: Array<[string, number]>; depotId: string }> = {}) =>
    new Map([[
      'wo1',
      {
        hasFinal: over.hasFinal ?? false,
        byDepotMaterial: new Map([[over.depotId ?? 'd1', new Map(over.byMaterial ?? [])]]),
      },
    ]]);

  it('räknar ned mot planen när egenkontroll saknas', () => {
    const out = applyReportedToDemand([seg()], reported({ byMaterial: [['EKOVILLA', 300]] }));
    expect(out[0].materials).toEqual([{ material: 'EKOVILLA', sacks: 264 }]);
  });

  it('en ifylld egenkontroll betyder blåst färdigt — inget mer material behövs', () => {
    // ⚠️ Ordern säger 564, egenkontrollen 528. Skillnaden är att det gick åt mindre än beräknat,
    // inte att 36 säck återstår. Statusen sätts för hand och flyttas inte av egenkontrollen, så
    // jobbet ligger kvar som in_progress och hade annars fortsatt kräva material ur depån.
    //
    // ⚠️ MATERIALEN NOLLAS, DE RADERAS INTE. Formen bär en betydelse nedströms: en TOM lista läses
    // som "inget material gick att härleda" (pickDemandSegments -> excluded: no_material), och
    // varje färdigblåst jobb rapporterades då som ett fynd i prognoskortets "kunde inte räknas".
    // Materialet ÄR känt här; det är behovet som är slut. Assertionen prövar båda halvorna.
    const out = applyReportedToDemand([seg()], reported({ hasFinal: true, byMaterial: [['EKOVILLA', 528]] }));
    expect(out[0].materials).toEqual([{ material: 'EKOVILLA', sacks: 0 }]);
    // Det som faktiskt räknas: inget behov kvar. Attributionen filtrerar bort nollor.
    expect(attributePlannedDemand(out)).toEqual([]);
  });

  it('drar bara från det material som rapporterats', () => {
    const two = seg({ materials: [{ material: 'EKOVILLA', sacks: 200 }, { material: 'PAROC', sacks: 80 }] });
    const out = applyReportedToDemand([two], reported({ byMaterial: [['PAROC', 30]] }));
    expect(out[0].materials).toEqual([
      { material: 'EKOVILLA', sacks: 200 },
      { material: 'PAROC', sacks: 50 },
    ]);
  });

  it('går aldrig under noll när mer blåstes än planerat', () => {
    const out = applyReportedToDemand([seg()], reported({ byMaterial: [['EKOVILLA', 700]] }));
    expect(out[0].materials).toEqual([{ material: 'EKOVILLA', sacks: 0 }]);
  });

  it('lämnar en order utan rapportrader orörd — "ej rapporterat" är inte "noll blåsta"', () => {
    const out = applyReportedToDemand([seg()], new Map());
    expect(out[0].materials).toEqual([{ material: 'EKOVILLA', sacks: 564 }]);
  });

  it('säckar blåsta ur EN ANNAN depå krymper inte behovet här', () => {
    // 🧨 `shortfall` räknas per depå, så invarianten måste gälla per depå: en säck får bara dras
    // från `planned` vid den depå där den också drogs från `balance`. Ett jobb splittat på två
    // bilar vid olika depåer ("Kopiera till bil") är normalfallet — dras d2:s förbrukning från
    // d1:s behov blir d1:s brist för liten, alltså den farliga riktningen.
    const out = applyReportedToDemand([seg()], reported({ depotId: 'd2', byMaterial: [['EKOVILLA', 300]] }));
    expect(out[0].materials).toEqual([{ material: 'EKOVILLA', sacks: 564 }]);
  });
});

describe('urvalet när behovet redan är uppätet', () => {
  it('ett färdigblåst jobb skapar inget spökbehov på nästa depå', () => {
    // 🧨 Fallet: jobbet är splittat på två bilar vid olika depåer och HELA det har blåsts från dA.
    // Avdraget nollar dA:s segment, men "inget kvar att blåsa" fick tidigare samma behandling som
    // "den här bilen saknar depå" — alltså falla igenom till nästa segment, som aldrig fick något
    // avdrag. Resultatet blev ett fullt behov på dB och en rosa bristbanderoll på en depå där
    // ingenting är planerat.
    //
    // Genomfallningsregeln finns för DEPÅLÖSA segment ("vi vet inte, pröva nästa"). Ett segment MED
    // depå har redovisat jobbet — även när svaret är noll.
    const segments: PlannedDemandSegment[] = [
      { work_order_id: 'wo1', depot_id: 'dA', status: 'in_progress', materials: [{ material: 'EKOVILLA', sacks: 200 }] },
      { work_order_id: 'wo1', depot_id: 'dB', status: 'in_progress', materials: [{ material: 'EKOVILLA', sacks: 200 }] },
    ];
    const reported = new Map([
      ['wo1', { hasFinal: false, byDepotMaterial: new Map([['dA', new Map([['EKOVILLA', 200]])]]) }],
    ]);
    expect(attributePlannedDemand(applyReportedToDemand(segments, reported))).toEqual([]);
  });

  it('en egenkontroll stänger jobbet på alla depåer, inte bara den första', () => {
    const segments: PlannedDemandSegment[] = [
      { work_order_id: 'wo1', depot_id: 'dA', status: 'in_progress', materials: [{ material: 'EKOVILLA', sacks: 200 }] },
      { work_order_id: 'wo1', depot_id: 'dB', status: 'in_progress', materials: [{ material: 'EKOVILLA', sacks: 200 }] },
    ];
    const reported = new Map([['wo1', { hasFinal: true, byDepotMaterial: new Map() }]]);
    expect(attributePlannedDemand(applyReportedToDemand(segments, reported))).toEqual([]);
  });

  it('men ett DELVIS blåst jobb behåller sin återstod på samma depå', () => {
    const segments: PlannedDemandSegment[] = [
      { work_order_id: 'wo1', depot_id: 'dA', status: 'in_progress', materials: [{ material: 'EKOVILLA', sacks: 200 }] },
      { work_order_id: 'wo1', depot_id: 'dB', status: 'in_progress', materials: [{ material: 'EKOVILLA', sacks: 200 }] },
    ];
    const reported = new Map([
      ['wo1', { hasFinal: false, byDepotMaterial: new Map([['dA', new Map([['EKOVILLA', 60]])]]) }],
    ]);
    expect(attributePlannedDemand(applyReportedToDemand(segments, reported))).toEqual([
      { depot_id: 'dA', material: 'EKOVILLA', sacks: 140 },
    ]);
  });
});

describe('dubbelräkningen av blåsta säckar', () => {
  it('halvblåst order överskattar inte längre bristen', () => {
    // 🧨 Regressionen: `balance` sänktes av det blåsta (deriveConsumptionRows) medan `planned` stod
    // kvar på orderns HELA säckantal, så samma säckar räknades två gånger och shortfall blev 364
    // där svaret är 64. Överskattningen var exakt det blåsta antalet och växte under veckan — och
    // hade den siffran fyllt i en materialbeställning hade 300 säck beställts i onödan.
    const depots = [{ id: 'd1', name: 'Syd' }];
    const delivered: StockRow[] = [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 500 }];

    const fleet = new Map<string, string | null>([['t1', 'd1']]);
    const reports = [{ work_order_id: 'wo1', sacks_blown: 300, kind: 'partial', material: 'EKOVILLA', segment: { truck_id: 't1' } }];
    const consumed: StockRow[] = [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 300 }];

    const segments: PlannedDemandSegment[] = [
      { work_order_id: 'wo1', depot_id: 'd1', status: 'in_progress', materials: [{ material: 'EKOVILLA', sacks: 564 }] },
    ];
    const planned = attributePlannedDemand(applyReportedToDemand(segments, reportedDemandByWorkOrder(reports, fleet)));

    const row = computeDepotBalances(depots, delivered, consumed, planned)[0].rows[0];
    expect(row).toMatchObject({ balance: 200, planned: 264, shortfall: 64 });
  });
});


// ---------------------------------------------------------------------------
// pickDemandSegments — den funktion som håller saldot och prognosen samman
// ---------------------------------------------------------------------------
//
// 🧨 SAKNADE EGET TEST. attributePlannedDemand testades, men den kastar bort både datumet och
// excluded-listan — alltså precis de två saker prognosen är byggd av. Ett fel i dem hade varit
// osynligt för sviten.

describe('pickDemandSegments', () => {
  const s = (over: Partial<PlannedDemandSegment> = {}): PlannedDemandSegment => ({
    work_order_id: 'wo1',
    depot_id: 'd1',
    status: 'scheduled',
    materials: [{ material: 'EKOVILLA', sacks: 100 }],
    start_day: '2026-09-20',
    ...over,
  });

  it('väljer FÖRSTA segmentet med depå och räknar jobbet en gång', () => {
    const { picked } = pickDemandSegments([
      s({ depot_id: 'd1', start_day: '2026-09-20' }),
      s({ depot_id: 'd2', start_day: '2026-09-25' }),
    ]);
    expect(picked).toHaveLength(1);
    expect(picked[0]).toMatchObject({ depot_id: 'd1', start_day: '2026-09-20' });
  });

  // ⚠️ Att sakna depå säger ingenting om jobbet — pröva nästa segment. Markerades jobbet som sett
  // före depåkontrollen försvann behovet helt och banderollen teg.
  it('faller igenom till nästa segment när bilen saknar depå', () => {
    const { picked, excluded } = pickDemandSegments([s({ depot_id: null }), s({ depot_id: 'd2' })]);
    expect(picked).toHaveLength(1);
    expect(picked[0].depot_id).toBe('d2');
    expect(excluded).toEqual([]);
  });

  it('utesluter ett jobb vars ALLA segment saknar depå', () => {
    const { picked, excluded } = pickDemandSegments([s({ depot_id: null }), s({ depot_id: null })]);
    expect(picked).toEqual([]);
    expect(excluded).toEqual([{ work_order_id: 'wo1', reason: 'no_depot' }]);
  });

  it('utesluter en gång per jobb, inte en gång per segment', () => {
    const { excluded } = pickDemandSegments([
      s({ work_order_id: 'wo1', depot_id: null }),
      s({ work_order_id: 'wo1', depot_id: null }),
      s({ work_order_id: 'wo1', depot_id: null }),
    ]);
    expect(excluded).toHaveLength(1);
  });

  it('hoppar över stängda arbetsordrar helt — de är varken valda eller uteslutna', () => {
    const { picked, excluded } = pickDemandSegments([s({ status: 'invoiced', depot_id: null })]);
    expect(picked).toEqual([]);
    expect(excluded).toEqual([]);
  });

  it('bär startdagen vidare — den är hela grunden för prognosen', () => {
    const { picked } = pickDemandSegments([s({ start_day: '2026-10-05' })]);
    expect(picked[0].start_day).toBe('2026-10-05');
  });

  it('ett segment utan startdag räknas i saldot men redovisas som odaterat', () => {
    const { picked, excluded } = pickDemandSegments([s({ start_day: null })]);
    expect(picked).toHaveLength(1);
    expect(excluded).toEqual([{ work_order_id: 'wo1', reason: 'no_date' }]);
  });

  it('utan igenkänt material blir det no_material', () => {
    const { excluded } = pickDemandSegments([s({ materials: [] })]);
    expect(excluded).toEqual([{ work_order_id: 'wo1', reason: 'no_material' }]);
  });

  /**
   * 🧨 FÄRDIGBLÅST ÄR INTE SAMMA SAK SOM OKÄNT MATERIAL.
   *
   * applyReportedToDemand nollar materialen på ett jobb med egenkontroll. Frågade exkluderingen
   * efter `sacks > 0` blev varje färdigt jobb ett no_material-fynd, och kortet påstod att siffrorna
   * var för låga för jobb vars behov korrekt är noll. En lista med falsklarm blir inte läst.
   */
  it('ett färdigblåst jobb (material känt, noll kvar) är INTE uteslutet', () => {
    const { picked, excluded } = pickDemandSegments([s({ materials: [{ material: 'EKOVILLA', sacks: 0 }] })]);
    expect(picked).toHaveLength(1);
    expect(excluded).toEqual([]);
  });

  it('ett färdigblåst jobb utan startdag är inte heller uteslutet — det behöver ingen dag', () => {
    const { excluded } = pickDemandSegments([
      s({ start_day: null, materials: [{ material: 'EKOVILLA', sacks: 0 }] }),
    ]);
    expect(excluded).toEqual([]);
  });

  // Kopplingen tillbaka: attributePlannedDemand MÅSTE ge samma rader som pickDemandSegments väljer.
  // Glider de isär säger banderollen och prognosen olika saker om samma depå.
  it('attributePlannedDemand är exakt de valda raderna utan datum', () => {
    const segments = [s({ work_order_id: 'a' }), s({ work_order_id: 'b', depot_id: 'd2', materials: [{ material: 'PAROC', sacks: 40 }] })];
    const { picked } = pickDemandSegments(segments);
    expect(attributePlannedDemand(segments)).toEqual(
      picked.flatMap((p) => p.materials.filter((m) => m.sacks > 0).map((m) => ({ depot_id: p.depot_id, material: m.material, sacks: m.sacks }))),
    );
  });
});

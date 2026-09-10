import { describe, it, expect } from 'vitest';
import {
  applyReportedToDemand, attributePlannedDemand, computeDepotBalances, reportedDemandByWorkOrder,
  type PlannedDemandSegment, type StockRow,
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
    expect(eko).toEqual({ material: 'EKOVILLA', delivered: 150, consumed: 30, balance: 120, planned: 0, shortfall: 0 });
    expect(d1.rows.find((r) => r.material === 'PAROC')!.balance).toBe(40);
    expect(d1.total_balance).toBe(160);
  });

  it('shows a material that has only consumption (negative balance)', () => {
    const d1 = computeDepotBalances(depots, [], [{ depot_id: 'd1', material: 'EKOVILLA', sacks: 25 }]).find((d) => d.depot_id === 'd1')!;
    expect(d1.rows[0]).toEqual({ material: 'EKOVILLA', delivered: 0, consumed: 25, balance: -25, planned: 0, shortfall: 25 });
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
    const out = applyReportedToDemand([seg()], reported({ hasFinal: true, byMaterial: [['EKOVILLA', 528]] }));
    expect(out[0].materials).toEqual([]);
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

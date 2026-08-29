import { describe, it, expect } from 'vitest';
import {
  calculateAfterCalculation,
  type AfterCalculationInput,
  type AfterCalculationSackRow,
} from '@/lib/domains/crm/afterCalculation';

// Efterkalkylen är den enda siffran i CRM:et som säger om ett UTFÖRT jobb tjänade pengar. Ett fel
// här ser aldrig ut som ett fel — bara som ett jobb som var lönsammare än det var. Testerna nedan
// vaktar de fyra sätt det kan hända på:
//
//   1. supersede-regeln missas       → materialet dubbelräknas (30 + 25 + 91 = 146 i stället för 91)
//   2. man-timmar blandas med team   → arbetskostnaden blir dubbelt eller hälften
//   3. NULL-minuter faller inte tillbaka på hours → arbetskostnad 0 kr på ett jobb med timmar
//   4. "ej rapporterat" räknas som 0 → materialkostnad 0 kr, alltså maximal TB

const wo = 'wo-1';

const partial = (sacks: number, material: string | null = 'EKOVILLA'): AfterCalculationSackRow => ({
  work_order_id: wo,
  kind: 'partial',
  sacks_blown: sacks,
  material,
});
const final = (sacks: number, material: string | null = 'EKOVILLA'): AfterCalculationSackRow => ({
  work_order_id: wo,
  kind: 'final',
  sacks_blown: sacks,
  material,
});

// 100 kr/säck och 650 kr/man-timme gör varje förväntat tal räkningsbart i huvudet.
const base: AfterCalculationInput = {
  revenue: 100_000,
  sackRows: [],
  timeRows: [],
  costArticles: [{ material: 'EKOVILLA', articleNumber: '2410508', purchasePrice: 100 }],
  otherMaterialRows: [],
  laborCostPerHour: 650,
};

const calc = (over: Partial<AfterCalculationInput> = {}) => calculateAfterCalculation({ ...base, ...over });

describe('materialkostnaden', () => {
  it('säckar × inköpspris per säck — ingen densitet, ingen omräkning', () => {
    const result = calc({ sackRows: [final(91)] });
    expect(result.materialCost).toBe(9_100);
    expect(result.tb1).toBe(90_900);
  });

  it('supersede-regeln gäller: två delrapporter + en egenkontroll ger 91 säckar, inte 146', () => {
    const result = calc({ sackRows: [partial(30), partial(25), final(91)] });
    expect(result.materialCost).toBe(9_100);
  });

  it('utan egenkontroll summeras delrapporterna', () => {
    const result = calc({ sackRows: [partial(30), partial(25)] });
    expect(result.materialCost).toBe(5_500);
  });

  it('samma material på flera etapprader slås ihop till EN rad i uppställningen', () => {
    // Egenkontrollen skriver en final-rad per placering — samma material dyker upp flera gånger.
    const result = calc({ sackRows: [final(40), final(30), final(21)] });
    expect(result.materialLines).toHaveLength(1);
    expect(result.materialLines[0]).toMatchObject({ material: 'EKOVILLA', sacks: 91, cost: 9_100 });
  });

  it('två material prissätts var för sig', () => {
    const result = calc({
      sackRows: [final(50, 'EKOVILLA'), final(20, 'KNAUF SUPAFIL')],
      costArticles: [
        { material: 'EKOVILLA', articleNumber: '2410508', purchasePrice: 100 },
        { material: 'KNAUF SUPAFIL', articleNumber: '16443', purchasePrice: 200 },
      ],
    });
    expect(result.materialCost).toBe(5_000 + 4_000);
  });
});

describe('noll rapporterade säckar är ett svar, inte en avsaknad', () => {
  // Delrapportens schema tillåter 0 med flit: "vi var här, inget gick åt". Skillnaden mot att
  // inte rapportera alls är hela poängen — den ena är känd kostnad 0 kr, den andra okänd kostnad.
  it('en nollrapport ger materialkostnad 0 kr — och märker inte kalkylen som preliminär', () => {
    const result = calc({ sackRows: [final(0)], timeRows: [{ minutes_worked: 480 }] });
    expect(result.materialCost).toBe(0);
    expect(result.tb1).toBe(100_000);
    expect(result.gaps).toEqual([]);
    expect(result.isPreliminary).toBe(false);
  });

  it('nollrapporten kräver ingen kostnadsartikel — noll säckar kostar noll oavsett pris', () => {
    const result = calc({ sackRows: [final(0, 'PAROC')], timeRows: [{ minutes_worked: 480 }] });
    expect(result.materialCost).toBe(0);
    expect(result.gaps.map((g) => g.kind)).not.toContain('missing_cost_article');
  });

  it('nollrapporten syns som en rad — den försvinner inte ur uppställningen', () => {
    const result = calc({ sackRows: [final(0)] });
    expect(result.materialLines).toHaveLength(1);
    expect(result.materialLines[0]).toMatchObject({ material: 'EKOVILLA', sacks: 0, cost: 0 });
  });

  it('noll säckar utan material flaggas inte som oprissatta säckar', () => {
    const result = calc({ sackRows: [final(50, 'EKOVILLA'), final(0, null)] });
    expect(result.materialCost).toBe(5_000);
    expect(result.gaps.map((g) => g.kind)).not.toContain('sacks_without_material');
  });
});

describe('"ej rapporterat" är inte noll kronor', () => {
  it('jobb utan säckrapport ger materialkostnad null — aldrig 0 kr', () => {
    const result = calc({ sackRows: [] });
    expect(result.materialCost).toBeNull();
    expect(result.tb1).toBeNull();
    expect(result.gaps.map((g) => g.kind)).toContain('no_sack_reports');
  });

  it('kostnadsartikel saknas → materialet räknas inte in, och det SÄGS vilket material', () => {
    const result = calc({ sackRows: [final(50, 'PAROC')] });
    expect(result.materialCost).toBeNull();
    const gap = result.gaps.find((g) => g.kind === 'missing_cost_article');
    expect(gap).toBeDefined();
    expect(gap && 'materials' in gap ? gap.materials : []).toEqual(['PAROC']);
  });

  it('artikel utan inköpspris skiljs från artikel som saknas helt', () => {
    const result = calc({
      sackRows: [final(50, 'EKOVILLA')],
      costArticles: [{ material: 'EKOVILLA', articleNumber: '2410508', purchasePrice: null }],
    });
    expect(result.materialCost).toBeNull();
    expect(result.gaps.map((g) => g.kind)).toContain('missing_purchase_price');
    expect(result.gaps.map((g) => g.kind)).not.toContain('missing_cost_article');
  });

  it('rader utan material räknas i säckarna men prissätts inte — och det syns', () => {
    const result = calc({ sackRows: [final(50, 'EKOVILLA'), final(10, null)] });
    expect(result.materialCost).toBe(5_000);
    const gap = result.gaps.find((g) => g.kind === 'sacks_without_material');
    expect(gap && 'sacks' in gap ? gap.sacks : 0).toBe(10);
  });

  it('ett prissatt material räcker för en summa — de oprissatta drar inte ned den till null', () => {
    const result = calc({ sackRows: [final(50, 'EKOVILLA'), final(20, 'PAROC')] });
    expect(result.materialCost).toBe(5_000);
    expect(result.isPreliminary).toBe(true);
  });
});

describe('sålda rader utanför säckrapporten', () => {
  // Order #13, 2026-08-28: fyra paket EKOVILLA LEVY 30MM såldes för 2 309 kr med inköpspris
  // 499,89/pkt. Utan de här raderna blev TB2 +1 655 kr i stället för −345 kr — vinst i stället för
  // förlust, på ett kort som inte ens flaggade sig som preliminärt.
  const levy = { label: 'EKOVILLA LEVY 30MM', articleNumber: '2410528', quantity: 4, purchasePrice: 499.89, revenue: 2_309 };

  it('räknas in i materialkostnaden tillsammans med säckarna', () => {
    const result = calc({ sackRows: [final(43)], otherMaterialRows: [levy] });
    expect(result.materialCost).toBeCloseTo(4_300 + 1_999.56, 6);
  });

  it('order #13 genomräknad: TB2 vänder från vinst till förlust', () => {
    const result = calc({
      revenue: 16_028,
      sackRows: [final(43)],
      costArticles: [{ material: 'EKOVILLA', articleNumber: '2410508', purchasePrice: 92.4 }],
      otherMaterialRows: [levy, { label: 'Etableringskostnad', articleNumber: '1010', quantity: 1, purchasePrice: 0, revenue: 3_900 }],
      timeRows: [{ minutes_worked: 960 }],
    });
    expect(result.materialCost).toBeCloseTo(3_973.2 + 1_999.56, 6);
    expect(result.tb2).toBeLessThan(0);
    expect(result.tb2).toBeCloseTo(16_028 - 5_972.76 - 10_400, 6);
  });

  it('inköpspris 0 är ett SVAR — etableringsraden kostar noll och flaggas inte', () => {
    const result = calc({
      sackRows: [final(43)],
      timeRows: [{ minutes_worked: 480 }],
      otherMaterialRows: [{ label: 'Etableringskostnad', articleNumber: '1010', quantity: 1, purchasePrice: 0, revenue: 3_900 }],
    });
    expect(result.materialCost).toBe(4_300);
    expect(result.gaps).toEqual([]);
    expect(result.isPreliminary).toBe(false);
  });

  it('inköpspris null är OKUNSKAP — raden hålls utanför kostnaden och redovisas', () => {
    const result = calc({
      sackRows: [final(43)],
      timeRows: [{ minutes_worked: 480 }],
      otherMaterialRows: [{ label: 'Vindduk', articleNumber: '13310', quantity: 2, purchasePrice: null, revenue: 4_800 }],
    });
    // Oprissatt rad räknas ALDRIG som gratis — det är den farligt optimistiska riktningen.
    expect(result.materialCost).toBe(4_300);
    const gap = result.gaps.find((g) => g.kind === 'unpriced_rows');
    expect(gap && 'revenue' in gap ? gap.revenue : 0).toBe(4_800);
    expect(gap?.message).toContain('Vindduk');
  });

  it('en oprissatt rad ensam ger okänd materialkostnad, inte 0 kr', () => {
    const result = calc({
      sackRows: [],
      otherMaterialRows: [{ label: 'Vindduk', articleNumber: '13310', quantity: 2, purchasePrice: null, revenue: 4_800 }],
    });
    expect(result.materialCost).toBeNull();
  });
});

describe('arbetskostnaden', () => {
  it('MAN-timmar × satsen per person — inte team-timmar', () => {
    // Två personer, åtta timmar var. Man-timmar = 16, alltså 16 × 650 = 10 400 kr.
    // Team-timmarnas 8 × 1 300 ger samma tal — men bara när båda jobbade lika länge. Nästa test
    // är det som faktiskt skiljer modellerna åt.
    const result = calc({ timeRows: [{ minutes_worked: 480 }, { minutes_worked: 480 }] });
    expect(result.laborHours).toBe(16);
    expect(result.laborCost).toBe(10_400);
  });

  it('ojämnt fördelad tid: tre personer olika länge summeras per person', () => {
    // 480 + 300 + 120 = 900 minuter = 15 man-timmar → 9 750 kr. En team-timmesmodell hade behövt
    // veta hur många som var på plats samtidigt och hade svarat fel här.
    const result = calc({ timeRows: [{ minutes_worked: 480 }, { minutes_worked: 300 }, { minutes_worked: 120 }] });
    expect(result.laborHours).toBe(15);
    expect(result.laborCost).toBe(9_750);
  });

  it('NULL-minuter faller tillbaka på hours — annars blir kostnaden 0 kr på ett jobb med timmar', () => {
    const result = calc({ timeRows: [{ minutes_worked: null, hours: 8 }] });
    expect(result.laborHours).toBe(8);
    expect(result.laborCost).toBe(5_200);
  });

  it('hours som PostgREST-sträng räknas också', () => {
    // numeric kommer tillbaka som sträng ur PostgREST. Utan parseDecimal blir "7.5" NaN-mat.
    const result = calc({ timeRows: [{ minutes_worked: null, hours: '7.5' }] });
    expect(result.laborHours).toBe(7.5);
  });

  it('minuterna summeras rått och delas med 60 först på slutet', () => {
    // 20 rader à 25 minuter = 500 min = 8,333… h. Avrundning per rad hade gett ett annat tal.
    const rows = Array.from({ length: 20 }, () => ({ minutes_worked: 25 }));
    const result = calc({ timeRows: rows });
    expect(result.laborHours).toBeCloseTo(500 / 60, 10);
  });

  it('ingen rapporterad tid ger null, inte 0 kr', () => {
    const result = calc({ timeRows: [] });
    expect(result.laborHours).toBeNull();
    expect(result.laborCost).toBeNull();
    expect(result.gaps.map((g) => g.kind)).toContain('no_time');
  });

  it('utan satt timkostnad går TB2 inte att räkna — men TB1 står kvar', () => {
    const result = calc({ sackRows: [final(91)], timeRows: [{ minutes_worked: 480 }], laborCostPerHour: null });
    expect(result.tb1).toBe(90_900);
    expect(result.laborCost).toBeNull();
    expect(result.tb2).toBeNull();
    expect(result.gaps.map((g) => g.kind)).toContain('no_labor_rate');
  });
});

describe('TB och TG', () => {
  it('fullständigt jobb: TB1, TB2 och båda täckningsgraderna', () => {
    const result = calc({
      revenue: 100_000,
      sackRows: [final(91)],
      timeRows: [{ minutes_worked: 480 }, { minutes_worked: 480 }],
    });
    expect(result.materialCost).toBe(9_100);
    expect(result.laborCost).toBe(10_400);
    expect(result.tb1).toBe(90_900);
    expect(result.tb2).toBe(80_500);
    expect(result.tg1).toBeCloseTo(90.9, 10);
    expect(result.tg2).toBeCloseTo(80.5, 10);
    expect(result.isPreliminary).toBe(false);
    expect(result.gaps).toEqual([]);
  });

  it('utan intäkt går ingenting att räkna — och det sägs', () => {
    const result = calc({ revenue: null, sackRows: [final(91)], timeRows: [{ minutes_worked: 480 }] });
    expect(result.tb1).toBeNull();
    expect(result.tg1).toBeNull();
    expect(result.gaps.map((g) => g.kind)).toContain('no_revenue');
  });

  it('intäkt 0 räknas som ingen intäkt — TG blir inte division med noll', () => {
    const result = calc({ revenue: 0, sackRows: [final(91)] });
    expect(result.revenue).toBeNull();
    expect(result.tg1).toBeNull();
  });

  it('ett jobb kan gå med förlust — TB2 får vara negativ', () => {
    const result = calc({
      revenue: 10_000,
      sackRows: [final(50)],
      timeRows: [{ minutes_worked: 600 }, { minutes_worked: 600 }],
    });
    expect(result.tb1).toBe(5_000);
    expect(result.tb2).toBe(5_000 - 13_000);
    expect(result.tg2).toBeCloseTo(-80, 10);
  });
});

describe('materialCostIsPartial — skild från isPreliminary', () => {
  // Snabböversikten visar TB-procenten utanför kortets luckelista och behöver veta om just
  // MATERIALET är ofullständigt. Saknad tid gör inte TB1 osäkert — bara TB2 oräknelig.
  it('bara saknad tid: TB1 är exakt, alltså inte partiellt', () => {
    const result = calc({ sackRows: [final(91)], timeRows: [] });
    expect(result.isPreliminary).toBe(true);
    expect(result.materialCostIsPartial).toBe(false);
  });

  it('ett oprissatt material vid sidan av ett prissatt: TB1 är för högt', () => {
    const result = calc({ sackRows: [final(50, 'EKOVILLA'), final(20, 'PAROC')], timeRows: [{ minutes_worked: 480 }] });
    expect(result.materialCostIsPartial).toBe(true);
  });

  it('en oprissatt rad utanför säckrapporten räknas också som partiellt', () => {
    const result = calc({
      sackRows: [final(50)],
      timeRows: [{ minutes_worked: 480 }],
      otherMaterialRows: [{ label: 'Vindduk', articleNumber: '13310', quantity: 2, purchasePrice: null, revenue: 4_800 }],
    });
    expect(result.materialCostIsPartial).toBe(true);
  });

  it('inget prissatt alls ger null, inte "partiellt" — det finns ingen siffra att märka', () => {
    const result = calc({ sackRows: [final(20, 'PAROC')] });
    expect(result.materialCost).toBeNull();
    expect(result.materialCostIsPartial).toBe(false);
  });

  it('fullständigt underlag: varken preliminärt eller partiellt', () => {
    const result = calc({ sackRows: [final(91)], timeRows: [{ minutes_worked: 480 }] });
    expect(result.isPreliminary).toBe(false);
    expect(result.materialCostIsPartial).toBe(false);
  });
});

describe('preliminärmärkningen', () => {
  it('säger VAD som saknas, inte bara att något gör det', () => {
    const result = calc({ sackRows: [], timeRows: [] });
    const messages = result.gaps.map((g) => g.message);
    expect(messages.some((m) => m.includes('säckar'))).toBe(true);
    expect(messages.some((m) => m.includes('tid'))).toBe(true);
  });

  it('fullständigt underlag ger inga luckor', () => {
    const result = calc({ sackRows: [final(91)], timeRows: [{ minutes_worked: 480 }] });
    expect(result.isPreliminary).toBe(false);
  });
});

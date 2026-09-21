import { describe, it, expect } from 'vitest';
import {
  buildPreCalculationItems,
  collectPreCalculationArticleNumbers,
  isRotActive,
  type PreCalculationOrderRow,
} from '@/lib/domains/crm/preCalculationLoader';
import { isMarginLoss } from '@/lib/domains/crm/preCalculation';

// Förkalkylen på planeringstavlan bygger sin indata ur en SPARAD arbetsorder, medan offerten bygger
// samma indata ur formulärets utkast. Testerna nedan låser de tre ställen där de två kan glida isär
// utan att något ser trasigt ut — talet blir bara ett annat på tavlan än i offerten.

const lososull = (over: Record<string, unknown> = {}) => ({
  article_name: 'EKOVILLA cellulosa 0,038W/mK snedtak',
  article_number: '2410510',
  pricing_mode: 'm3',
  m2: '153',
  thickness_mm: '360',
  density: '54',
  unit_price: '560',
  ...over,
});

const paroc = (over: Record<string, unknown> = {}) => ({
  article_name: 'PAROC lösull vind',
  article_number: '9900001',
  pricing_mode: 'm3',
  m2: '100',
  thickness_mm: '400',
  density: '30',
  unit_price: '480',
  ...over,
});

const etablering = (over: Record<string, unknown> = {}) => ({
  article_name: 'Etableringskostnad',
  article_number: '1010',
  pricing_mode: 'item',
  quantity: '1',
  unit_price: '4500',
  ...over,
});

const order = (over: Partial<PreCalculationOrderRow> = {}): PreCalculationOrderRow => ({
  id: 'wo-1',
  line_items: [lososull(), etablering()],
  quote_type: 'business',
  rot_details: null,
  ...over,
});

describe('isRotActive', () => {
  it('privatkund med påslagen ROT är ROT-aktiv', () => {
    expect(isRotActive(order({ quote_type: 'private', rot_details: { enabled: true } }))).toBe(true);
  });

  // 🧨 MUTATIONSPRÖVAT: byts kontrollen mot `rot_details != null` blir det här fallet true, och
  // VARJE order blir ROT-aktiv — buildRotDetails skriver alltid ett objekt, även när ROT är av.
  // Då räknas varje `is_rot_work`-rad utan inköpspris som kostnadsfri arbetsrad i stället för att
  // lyftas ut, och TB1 blir för högt på order efter order.
  it('ett rot_details-objekt med enabled:false är INTE ROT — objektet finns alltid', () => {
    expect(isRotActive(order({ quote_type: 'private', rot_details: { enabled: false, rot_percent: 30 } }))).toBe(false);
  });

  it('företagsorder är aldrig ROT, även om flaggan råkat bli satt', () => {
    expect(isRotActive(order({ quote_type: 'business', rot_details: { enabled: true } }))).toBe(false);
  });
});

describe('collectPreCalculationArticleNumbers', () => {
  // 🧨 MUTATIONSPRÖVAT: läggs efterkalkylens `|| isBlownInsulationRow(item)` till i filtret faller
  // det här testet. Skillnaden mot efterkalkylens collectArticleNumbers är avsiktlig och bärande:
  // där prissätts lösullen uteslutande ur kostnadsartikeln, här är radens EGET artikelpris reserven
  // när materialet saknar kostnadsartikel. Bara EKOVILLA, KNAUF SUPAFIL och ROCKWOOL har en.
  it('tar med BLÅSTA raders artikelnummer — reserven för material utan kostnadsartikel', () => {
    const numbers = collectPreCalculationArticleNumbers([order({ line_items: [paroc()] })], []);
    expect(numbers).toContain('9900001');
  });

  it('tar med kostnadsartiklarna och orderns övriga rader', () => {
    const numbers = collectPreCalculationArticleNumbers(
      [order()],
      [{ material: 'EKOVILLA', article_number: '2410508', updated_at: null }],
    );
    expect(numbers).toEqual(expect.arrayContaining(['2410508', '2410510', '1010']));
  });

  it('avskrivna rader behöver inget pris', () => {
    const numbers = collectPreCalculationArticleNumbers(
      [order({ line_items: [etablering({ written_off: true })] })],
      [],
    );
    expect(numbers).not.toContain('1010');
  });

  it('samma artikel på flera ordrar frågas om EN gång', () => {
    const numbers = collectPreCalculationArticleNumbers([order({ id: 'a' }), order({ id: 'b' })], []);
    expect(numbers.filter((n) => n === '2410510')).toHaveLength(1);
  });
});

describe('buildPreCalculationItems', () => {
  // 🧨 MUTATIONSPRÖVAT: läggs `isBlownRow(...)` till som villkor på DEN HÄR raden faller testet.
  // Etableringen är en tjänst — den har ingen materialkostnad, och TB1 är efter material. Läses
  // nollan som okänt lyfts raden ut ur BÅDA leden, och talet mäter då bara isoleringsdelen: en
  // order med EKOVILLA 1 970 kr + etablering 3 500 kr visade 48,4 % i stället för 81,4 %.
  it('inköpspris 0 på en TJÄNSTERAD är gratis — det finns inget inköp', () => {
    const items = buildPreCalculationItems(order(), new Map([['1010', 0]]));
    expect(items.find((i) => i.article_number === '1010')?.purchasePrice).toBe(0);
  });

  // 🧨 MUTATIONSPRÖVAT: tas `isBlownRow(...)` bort blir lösull utan kostnadsartikel GRATIS.
  // ISOCELL (1001–1006) ligger i katalogen med pris 0 och saknar kostnadsartikel; används den blir
  // hela isoleringen kostnadsfri och ordern visar 100 % täckningsgrad. Samma felklass som i
  // augusti när 28 av 76 ordrar stod på TG1 100 %.
  it('inköpspris 0 på en BLÅST rad är okänt — lösull kostar alltid pengar', () => {
    const isocell = { ...lososull(), article_name: 'ISOCELL cellulosa vind', article_number: '1001' };
    const items = buildPreCalculationItems(order({ line_items: [isocell] }), new Map([['1001', 0]]));
    expect(items[0].purchasePrice).toBeNull();
  });

  it('artikel som saknas i cachen ger okänt pris, inte noll', () => {
    const items = buildPreCalculationItems(order(), new Map());
    expect(items.find((i) => i.article_number === '1010')?.purchasePrice).toBeNull();
  });

  it('ett positivt pris släpps igenom orört', () => {
    const items = buildPreCalculationItems(order(), new Map([['1010', 499.89]]));
    expect(items.find((i) => i.article_number === '1010')?.purchasePrice).toBeCloseTo(499.89, 5);
  });

  it('numeric som sträng ur PostgREST blir ett tal', () => {
    const items = buildPreCalculationItems(order(), new Map([['2410510', '307,50']]));
    expect(items.find((i) => i.article_number === '2410510')?.purchasePrice).toBeCloseTo(307.5, 5);
  });

  it('radens intäkt är totalen efter rabatt, inte à-priset', () => {
    const items = buildPreCalculationItems(
      order({ line_items: [etablering({ quantity: '2', unit_price: '1000', discount_percent: '10' })] }),
      new Map(),
    );
    expect(items[0].revenue).toBeCloseTo(1800, 5);
  });

  // 🧨 MUTATIONSPRÖVAT: tas `rotActive &&` bort blir isLabor true även på en företagsorder, och
  // raden räknas som intäkt utan materialkostnad i stället för att lyftas ut.
  it('is_rot_work räknas som arbetsrad BARA när ROT är aktivt på ordern', () => {
    const rotRow = etablering({ is_rot_work: true });
    const off = buildPreCalculationItems(order({ line_items: [rotRow] }), new Map());
    expect(off[0].isLabor).toBe(false);

    const on = buildPreCalculationItems(
      order({ line_items: [rotRow], quote_type: 'private', rot_details: { enabled: true } }),
      new Map(),
    );
    expect(on[0].isLabor).toBe(true);
  });

  it('avskrivna rader följer med orörda — kalkylen filtrerar dem själv', () => {
    const items = buildPreCalculationItems(order({ line_items: [lososull({ written_off: true })] }), new Map());
    expect(items).toHaveLength(1);
  });
});

describe('isMarginLoss', () => {
  // 🧨 MUTATIONSPRÖVAT: byts regeln mot `(percent ?? tb ?? 0) < 0` faller det här testet. Det är
  // det enda fall märket egentligen finns för — materialet bär, arbetet äter upp vinsten — och en
  // regel som stannar vid TG1 ritar just det jobbet neutralt.
  it('TG1 positiv men TB2 negativ ÄR en förlust', () => {
    expect(isMarginLoss(35.2, -5000)).toBe(true);
  });

  it('negativ TG1 är en förlust även när TB2 saknas', () => {
    expect(isMarginLoss(-4.1, null)).toBe(true);
  });

  it('båda positiva är ingen förlust', () => {
    expect(isMarginLoss(35.2, 48200)).toBe(false);
  });

  it('inga tal alls är ingen förlust — okänt är inte negativt', () => {
    expect(isMarginLoss(null, null)).toBe(false);
  });

  // Noll är varken vinst eller förlust; att färga den röd hade larmat om ett jobb som går jämnt upp.
  it('noll är inte en förlust', () => {
    expect(isMarginLoss(0, 0)).toBe(false);
  });
});

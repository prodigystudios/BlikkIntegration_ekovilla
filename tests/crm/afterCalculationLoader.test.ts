import { describe, it, expect } from 'vitest';
import {
  buildOrderInput,
  collectArticleNumbers,
  isBlownInsulationRow,
} from '@/lib/domains/crm/afterCalculationLoader';

// Regeln för VAD som räknas som material har varit fel två gånger, båda åt samma håll: kostnad som
// föll ur kalkylen och gjorde jobbet lönsammare än det var. Testerna nedan är skyddet.
//
//   1:a felet  materialet var bara säckarna — skivor och duk bidrog med intäkt och noll kostnad
//   2:a felet  filtret gick på VARUMÄRKET, och halva sortimentet heter EKOVILLA utan att blåsas

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

const levy = (over: Record<string, unknown> = {}) => ({
  article_name: 'EKOVILLA LEVY 30MM 9,8M2/PKT',
  article_number: '2410528',
  pricing_mode: 'item',
  quantity: '4',
  unit_price: '679',
  ...over,
});

describe('isBlownInsulationRow', () => {
  it('lösull såld per volym blåses — den räknas via säckrapporten', () => {
    expect(isBlownInsulationRow(lososull())).toBe(true);
  });

  it('EKOVILLA LEVY är styva skivor och blåses ALDRIG, trots varumärket i namnet', () => {
    expect(isBlownInsulationRow(levy())).toBe(false);
  });

  it('vindduk och ångbroms bär också varumärket utan att vara lösull', () => {
    expect(isBlownInsulationRow({ article_name: 'VINDSKYDDSDUK EKOVILLA X WIND SEAL 3,0X25M', pricing_mode: 'item' })).toBe(false);
    expect(isBlownInsulationRow({ article_name: 'ÅNGBROMS EKOVILLA SD5 PRO 3X25M FÖRVIKT', pricing_mode: 'item' })).toBe(false);
  });

  it('en tjänsterad utan material är inte lösull', () => {
    expect(isBlownInsulationRow({ article_name: 'Etableringskostnad', pricing_mode: 'item' })).toBe(false);
  });

  it('saknad pricing_mode betyder m³ — samma default som lineItemQuantity', () => {
    expect(isBlownInsulationRow({ article_name: 'Knauf Supafil vind' })).toBe(true);
  });

  // ⚠️ Artikelnamnet går att redigera, och ett namn som tappar varumärkesordet härleder inget
  // material längre (materialRenameEffect finns just för den redigeringen). Utan densiteten som
  // andra kännetecken hade en sådan rad klassats som tjänst: ingen väntad säckrapport, ingen
  // lucka, och en komplett-märkt TG på ett jobb där lösullen aldrig mättes.
  it('en omdöpt lösullsrad känns igen på densiteten, inte på varumärket', () => {
    expect(isBlownInsulationRow({ article_name: 'Lösull vind', pricing_mode: 'm3', density: '45' })).toBe(true);
  });

  it('sanering säljs också per m³ men bär ingen densitet — den är en tjänst', () => {
    expect(isBlownInsulationRow({ article_name: 'Sanering av befintlig isolering/m3', pricing_mode: 'm3' })).toBe(false);
    expect(isBlownInsulationRow({ article_name: 'Sanering av befintlig isolering/m3', pricing_mode: 'm3', density: '' })).toBe(false);
  });

  it('densitet på en styckprissatt rad gör den inte till lösull', () => {
    expect(isBlownInsulationRow({ article_name: 'Lösull i lösvikt', pricing_mode: 'item', density: '45' })).toBe(false);
  });
});

describe('buildOrderInput', () => {
  const priser = new Map<string, number | string | null | undefined>([
    ['2410528', 499.89],
    ['1010', 0],
  ]);

  it('intäkten är radernas delsumma, inte den sparade sammanställningen', () => {
    const order = { id: 'wo', vat_percent: 25, line_items: [lososull(), levy()] };
    const { revenue } = buildOrderInput(order, priser);
    // 55,08 m³ × 560 = 30 844,80 · 4 × 679 = 2 716
    expect(revenue).toBeCloseTo(55.08 * 560 + 4 * 679, 6);
  });

  it('skivraden hamnar bland de rader som kostar utanför säckrapporten', () => {
    const order = { id: 'wo', vat_percent: 25, line_items: [lososull(), levy()] };
    const { otherMaterialRows } = buildOrderInput(order, priser);
    expect(otherMaterialRows).toHaveLength(1);
    expect(otherMaterialRows[0]).toMatchObject({ articleNumber: '2410528', quantity: 4, purchasePrice: 499.89 });
  });

  it('lösullsraden hamnar INTE där — den skulle dubbelräknas mot säckarna', () => {
    const order = { id: 'wo', vat_percent: 25, line_items: [lososull()] };
    expect(buildOrderInput(order, priser).otherMaterialRows).toHaveLength(0);
  });

  it('inköpspris 0 bevaras som 0, inte som okänt', () => {
    const order = { id: 'wo', vat_percent: 25, line_items: [{ article_name: 'Etableringskostnad', article_number: '1010', pricing_mode: 'item', quantity: '1', unit_price: '4500' }] };
    expect(buildOrderInput(order, priser).otherMaterialRows[0].purchasePrice).toBe(0);
  });

  it('artikel som saknas i cachen ger null — okänt, inte gratis', () => {
    const order = { id: 'wo', vat_percent: 25, line_items: [{ article_name: 'Vindduk', article_number: '13310', pricing_mode: 'item', quantity: '2', unit_price: '2400' }] };
    expect(buildOrderInput(order, priser).otherMaterialRows[0].purchasePrice).toBeNull();
  });

  it('avskrivna rader är ute ur BÅDA leden — de utförs aldrig', () => {
    const order = { id: 'wo', vat_percent: 25, line_items: [levy({ written_off: true })] };
    const { revenue, otherMaterialRows } = buildOrderInput(order, priser);
    expect(revenue).toBe(0);
    expect(otherMaterialRows).toHaveLength(0);
  });

  it('tomma utkastrader syns inte i uppställningen', () => {
    const order = { id: 'wo', vat_percent: 25, line_items: [{ article_name: '', pricing_mode: 'item', quantity: '', unit_price: '' }] };
    expect(buildOrderInput(order, priser).otherMaterialRows).toHaveLength(0);
  });

  it('en rad utan artikelnummer får en läsbar etikett i stället för tomrum', () => {
    const order = { id: 'wo', vat_percent: 25, line_items: [{ article_name: '', article_number: '', pricing_mode: 'item', quantity: '1', unit_price: '500' }] };
    expect(buildOrderInput(order, priser).otherMaterialRows[0].label).toBe('Rad utan artikel');
  });
});

describe('collectArticleNumbers', () => {
  it('tar med både kostnadsartiklarna och ordrarnas egna rader, utan dubbletter', () => {
    const orders = [
      { id: 'a', vat_percent: 25, line_items: [levy(), lososull()] },
      { id: 'b', vat_percent: 25, line_items: [levy()] },
    ];
    const numbers = collectArticleNumbers(orders, [
      { material: 'EKOVILLA', article_number: '2410508', updated_at: null },
    ]);
    expect(numbers.sort()).toEqual(['2410508', '2410528']);
  });

  it('lösullsraderna behöver inget prisuppslag — de kostnadssätts via kostnadsartikeln', () => {
    const numbers = collectArticleNumbers([{ id: 'a', vat_percent: 25, line_items: [lososull()] }], []);
    expect(numbers).toEqual([]);
  });
});

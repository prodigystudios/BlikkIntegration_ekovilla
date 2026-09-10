import { describe, it, expect } from 'vitest';
import { buildDeliveryChipsByDay } from '@/lib/domains/planning/deliveryStrip';
import type { DepotDeliveryOnBoard } from '@/lib/domains/planning/depotStock';

// Vecka 2026-09-07 (måndag) — 2026-09-13 (söndag).
const WEEKDAYS = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
const FULL_WEEK = [...WEEKDAYS, '2026-09-12', '2026-09-13'];

const leverans = (over: Partial<DepotDeliveryOnBoard> = {}): DepotDeliveryOnBoard => ({
  id: 'lev1',
  depot_id: 'd1',
  depot_name: 'Syd',
  material: 'EKOVILLA',
  sacks: 180,
  delivered_on: '2026-09-09',
  note: null,
  ...over,
});

describe('buildDeliveryChipsByDay', () => {
  it('lägger en leverans på sin egen dag', () => {
    const map = buildDeliveryChipsByDay([leverans()], FULL_WEEK, WEEKDAYS);
    expect(map.get('2026-09-09')).toEqual([
      { id: 'lev1', depot_id: 'd1', depot_name: 'Syd', material: 'EKOVILLA', sacks: 180, delivered_on: '2026-09-09', folded: false },
    ]);
  });

  it('lämnar dagar utan leverans tomma', () => {
    const map = buildDeliveryChipsByDay([leverans()], FULL_WEEK, WEEKDAYS);
    expect(map.get('2026-09-07')).toBeUndefined();
    expect(map.size).toBe(1);
  });

  it('fäller in en lördagsleverans på närmaste synliga dag och märker den', () => {
    // 🧨 Helgen är dold som standard (showWeekend initieras false, och en blockerad localStorage ger
    // samma sak). Räknades remsan bara över de synliga dagarna försvann materialet spårlöst.
    const map = buildDeliveryChipsByDay([leverans({ delivered_on: '2026-09-12' })], FULL_WEEK, WEEKDAYS);
    expect(map.get('2026-09-11')).toMatchObject([{ delivered_on: '2026-09-12', folded: true }]);
  });

  it('fäller in söndagen på samma sätt', () => {
    const map = buildDeliveryChipsByDay([leverans({ delivered_on: '2026-09-13' })], FULL_WEEK, WEEKDAYS);
    expect(map.get('2026-09-11')).toMatchObject([{ delivered_on: '2026-09-13', folded: true }]);
  });

  it('fäller inte in något när helgen visas', () => {
    const map = buildDeliveryChipsByDay([leverans({ delivered_on: '2026-09-12' })], FULL_WEEK, FULL_WEEK);
    expect(map.get('2026-09-12')).toMatchObject([{ folded: false }]);
    expect(map.get('2026-09-11')).toBeUndefined();
  });

  it('släpper leveranser utanför VECKANS spann — de hör till ett annat bräde', () => {
    const map = buildDeliveryChipsByDay(
      [leverans({ delivered_on: '2026-09-06' }), leverans({ id: 'lev2', delivered_on: '2026-09-14' })],
      FULL_WEEK,
      WEEKDAYS,
    );
    expect(map.size).toBe(0);
  });

  it('håller stabil ordning inom en dag: depå, sedan material', () => {
    const map = buildDeliveryChipsByDay(
      [
        leverans({ id: 'c', depot_name: 'Syd', material: 'PAROC' }),
        leverans({ id: 'a', depot_name: 'Nord', material: 'EKOVILLA' }),
        leverans({ id: 'b', depot_name: 'Syd', material: 'EKOVILLA' }),
      ],
      FULL_WEEK,
      WEEKDAYS,
    );
    expect(map.get('2026-09-09')!.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('tål tomma indata', () => {
    expect(buildDeliveryChipsByDay([], FULL_WEEK, WEEKDAYS).size).toBe(0);
    expect(buildDeliveryChipsByDay([leverans()], FULL_WEEK, []).size).toBe(0);
  });

  it('fäller in helgen även när veckan spänner över sommartidsväxlingen', () => {
    // ⚠️ Det här testet vaktar VIKNINGEN över växlingshelgen, inte att aritmetiken är UTC-förankrad.
    // Den ankringen går inte att pröva: funktionen använder dagnumren bara till jämförelser och
    // avstånd, och Math.round sväljer både sommartidstimmen och en hel zonförskjutning. En lokalt
    // förankrad variant passerade alla fem zoner jag mutationstestade mot — påstå därför inget annat
    // i namnet. Se kommentaren vid isoToDayNumber.
    //
    // Sverige ställer om natten till söndag 25/10 2026; 26/10 är måndag.
    const oktoberVeckodagar = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
    const oktoberHelaVeckan = [...oktoberVeckodagar, '2026-10-24', '2026-10-25'];
    const map = buildDeliveryChipsByDay([leverans({ delivered_on: '2026-10-25' })], oktoberHelaVeckan, oktoberVeckodagar);
    expect(map.get('2026-10-23')).toMatchObject([{ delivered_on: '2026-10-25', folded: true }]);
  });
});

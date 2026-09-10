import { describe, it, expect } from 'vitest';
import {
  inferMaterialFromArticle,
  materialDemandFromLineItems,
  sacksFor,
  totalSacks,
  MATERIALS,
  MATERIAL_SHORTS,
} from '@/lib/domains/crm/materials';

describe('inferMaterialFromArticle', () => {
  it('resolves the material + bag weight from brand keywords in the article name', () => {
    expect(inferMaterialFromArticle('EKOVILLA cellulosa 0,038W/mK vägg')?.bagWeight).toBe(14);
    expect(inferMaterialFromArticle('Knauf Supafil Frame B0709')?.bagWeight).toBe(15.5);
    expect(inferMaterialFromArticle('supafil lösull')?.bagWeight).toBe(15.5);
    expect(inferMaterialFromArticle('Isocell cellulosa')?.bagWeight).toBe(12);
    expect(inferMaterialFromArticle('isEco lösull')?.bagWeight).toBe(12);
    expect(inferMaterialFromArticle('Hunton Nativo träfiber')?.bagWeight).toBe(14);
    expect(inferMaterialFromArticle('Nativo vind')?.bagWeight).toBe(14);
    expect(inferMaterialFromArticle('PAROC SHT 1 vind')?.bagWeight).toBe(15);
  });

  it('returns null for an unknown brand / empty input', () => {
    expect(inferMaterialFromArticle('Glasull okänt fabrikat')).toBeNull();
    expect(inferMaterialFromArticle('')).toBeNull();
    expect(inferMaterialFromArticle(null)).toBeNull();
  });

  it('the resolved key exists in MATERIALS', () => {
    const m = inferMaterialFromArticle('Ekovilla')!;
    expect(MATERIALS[m.key].bagWeight).toBe(m.bagWeight);
  });
});

describe('sacksFor', () => {
  it('rounds up to whole sacks: ceil(volume × density / bagWeight)', () => {
    // 20 m³ × 45 kg/m³ = 900 kg; / 14 = 64.3 → 65
    expect(sacksFor(20, 45, 14)).toBe(65);
    // exact multiple stays whole
    expect(sacksFor(10, 14, 14)).toBe(10);
  });

  it('returns 0 when any input is non-positive', () => {
    expect(sacksFor(0, 45, 14)).toBe(0);
    expect(sacksFor(20, 0, 14)).toBe(0);
    expect(sacksFor(20, 45, 0)).toBe(0);
  });
});

describe('materialDemandFromLineItems', () => {
  // 100 m² × 200 mm = 20 m³; × 45 kg/m³ = 900 kg.
  // Ekovilla 14 kg/säck → 65 säck. Knauf Supafil 15,5 kg/säck → 59 säck.
  const rad = (over: Record<string, unknown> = {}) => ({
    article_name: 'EKOVILLA cellulosa 0,038W/mK vind',
    pricing_mode: 'm3',
    m2: '100',
    thickness_mm: '200',
    density: '45',
    ...over,
  });

  it('ger en post per material', () => {
    expect(materialDemandFromLineItems([rad()])).toEqual([{ material: 'EKOVILLA', sacks: 65 }]);
  });

  it('håller isär två material på samma order', () => {
    // 🧨 Regression: materialShortFromLineItems + totalSacks i par gav "124 säck EKOVILLA" här, och
    // lämnade KNAUF SUPAFIL helt utan planerat behov. I materialbeställningen väljer materialet
    // dessutom vilken fabrik mailet går till.
    const rows = materialDemandFromLineItems([rad(), rad({ article_name: 'Knauf Supafil Frame B0709' })]);
    expect(rows).toEqual([
      { material: 'EKOVILLA', sacks: 65 },
      { material: 'KNAUF SUPAFIL', sacks: 59 },
    ]);
  });

  it('summerar flera rader av samma material till en post', () => {
    const rows = materialDemandFromLineItems([rad(), rad({ m2: '50' })]);
    expect(rows).toEqual([{ material: 'EKOVILLA', sacks: 65 + 33 }]);
  });

  it('summan är exakt totalSacks — posterna delar upp, de lägger inte till', () => {
    const items = [rad(), rad({ article_name: 'Knauf Supafil Frame B0709' }), rad({ article_name: 'Arbete' })];
    const sum = materialDemandFromLineItems(items).reduce((acc, r) => acc + r.sacks, 0);
    expect(sum).toBe(totalSacks(items as never));
  });

  it('utelämnar rader utan igenkänt material och rader utan densitet', () => {
    // En omdöpt artikel som tappat varumärkesordet härleder inget material — se materialRenameEffect.
    expect(materialDemandFromLineItems([rad({ article_name: 'Lösull vind' })])).toEqual([]);
    expect(materialDemandFromLineItems([rad({ density: '' })])).toEqual([]);
  });

  it('tål tomt och saknat underlag', () => {
    expect(materialDemandFromLineItems([])).toEqual([]);
    expect(materialDemandFromLineItems(null)).toEqual([]);
    expect(materialDemandFromLineItems(undefined)).toEqual([]);
  });

  it('varje material som returneras är en kanonisk kortkod', () => {
    // Identiteten måste stämma tecken för tecken mot ops_depot_deliveries.material, annars möts
    // leverans och behov aldrig och saldot står kvar för högt utan att något felar.
    for (const row of materialDemandFromLineItems([rad(), rad({ article_name: 'PAROC SHT 1 vind' })])) {
      expect(MATERIAL_SHORTS).toContain(row.material);
    }
  });
});

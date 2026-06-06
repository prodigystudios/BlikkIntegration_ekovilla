import { describe, it, expect } from 'vitest';
import { inferMaterialFromArticle, sacksFor, MATERIALS } from '@/lib/domains/crm/materials';

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

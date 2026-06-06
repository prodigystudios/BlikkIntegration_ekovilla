// Lösull materials: bag weight (kg/säck) and lambdavärde (W/m²K).
// Single source of truth shared by egenkontroll (manual select) and the quote form's
// sack calculation (material inferred from the article).
// `short` is the headline shown above the measurements in the work description.
export const MATERIALS: Record<string, { bagWeight: number; lambda: string; short: string }> = {
  'Ekovilla Cellulosa Lösull CE ETA-09/0081': { bagWeight: 14, lambda: '0.038', short: 'EKOVILLA' },
  'Knauf Supafil Frame Lösull B0709EPCR': { bagWeight: 15.5, lambda: '0.038', short: 'KNAUF SUPAFIL' },
  'Isocell/isEco cellulosa Lösull CE ETA-06/0076': { bagWeight: 12, lambda: '0.038', short: 'ISOCELL/ISECO' },
  'Hunton Nativo Träfiber Lösull DoP 02-04-01': { bagWeight: 14, lambda: '0.039', short: 'HUNTON NATIVO' },
  'PAROC SHT 1, Lösull vind 0809-CPR-1014': { bagWeight: 15, lambda: '0.041', short: 'PAROC' },
};

// Brand keywords → material key, for inferring the material (and its bag weight) from
// a Fortnox article name. Same name-based approach as inferConstructionFromArticle.
const MATERIAL_BRAND_PATTERNS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /ekovilla/i, key: 'Ekovilla Cellulosa Lösull CE ETA-09/0081' },
  { pattern: /knauf|supafil/i, key: 'Knauf Supafil Frame Lösull B0709EPCR' },
  { pattern: /isocell|is[eé]co/i, key: 'Isocell/isEco cellulosa Lösull CE ETA-06/0076' },
  { pattern: /hunton|nativo/i, key: 'Hunton Nativo Träfiber Lösull DoP 02-04-01' },
  { pattern: /paroc/i, key: 'PAROC SHT 1, Lösull vind 0809-CPR-1014' },
];

// Resolve the material (and its bag weight) from a Fortnox article name, or null when
// no known brand is recognised – in which case the sack count is simply skipped.
export function inferMaterialFromArticle(articleName: string | null | undefined): { key: string; bagWeight: number; short: string } | null {
  const name = articleName ?? '';
  for (const { pattern, key } of MATERIAL_BRAND_PATTERNS) {
    if (pattern.test(name)) return { key, bagWeight: MATERIALS[key].bagWeight, short: MATERIALS[key].short };
  }
  return null;
}

// Whole sacks needed: mass (volume × density) / bag weight, rounded UP – you order
// whole sacks. Returns 0 when any input is non-positive.
export function sacksFor(volumeM3: number, densityKgPerM3: number, bagWeightKg: number): number {
  if (!(volumeM3 > 0) || !(densityKgPerM3 > 0) || !(bagWeightKg > 0)) return 0;
  return Math.ceil((volumeM3 * densityKgPerM3) / bagWeightKg);
}

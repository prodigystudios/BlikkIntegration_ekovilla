// Pure calculations for the egenkontroll (self-inspection) form: installed
// density per etapp row, settlement thickness and parsing the Blikk project
// description back into rows. Extracted from the page so the maths (the
// safety-/quality-relevant numbers) are unit-testable. Material bag weight /
// lambda are passed in by the caller (from lib/domains/crm/materials.ts) so this
// module stays free of UI/material coupling.

import { parseDecimal } from '@/lib/shared/number';

export type EtappOpenRow = {
  etapp?: string;
  ytaM2?: string;
  bestalldTjocklek?: string; // ex sättningspåslag
  sattningsprocent?: string; // %
  installeradTjocklek?: string; // inkl sättningspåslag
  installeradDensitet?: string; // kg/m3
  antalSack?: string;
  lambdavarde?: string; // W/m2K
};

export type EtappClosedRow = {
  etapp?: string;
  ytaM2?: string;
  bestalldTjocklek?: string;
  uppmatTjocklek?: string;
  installeradDensitet?: string;
  antalSackKgPerSack?: string;
  lambdavarde?: string;
};

// kg/m³ = (bags × bagWeight) / (area_m² × thickness_m). Returns 0 on any
// missing/zero input (matches the original guard behaviour).
function density(area: string | undefined, thicknessMm: string | undefined, bags: string | undefined, bagWeight: number): number {
  if (!area || !thicknessMm || !bags || !bagWeight) return 0;
  // parseDecimal handles sv-SE comma decimals ("50,5" → 50.5); raw parseFloat would
  // truncate at the comma and silently corrupt density on this quality document.
  const a = parseDecimal(area);
  const t = parseDecimal(thicknessMm);
  const b = parseDecimal(bags);
  if (isNaN(a) || isNaN(t) || isNaN(b) || a === 0 || t === 0) return 0;
  return (b * bagWeight) / (a * (t / 1000));
}

export function calculateOpenRowDensity(row: EtappOpenRow, bagWeight: number): number {
  return density(row.ytaM2, row.bestalldTjocklek, row.antalSack, bagWeight);
}

export function calculateClosedRowDensity(row: EtappClosedRow, bagWeight: number): number {
  // Prefer measured thickness, fall back to ordered thickness.
  const thicknessSource = row.uppmatTjocklek && row.uppmatTjocklek.trim() !== '' ? row.uppmatTjocklek : row.bestalldTjocklek;
  return density(row.ytaM2, thicknessSource, row.antalSackKgPerSack, bagWeight);
}

// Round a density value for display; '' when not a positive number.
export function formatDensity(calc: number): string {
  return Number.isFinite(calc) && calc > 0 ? String(Math.round(calc * 100) / 100) : '';
}

// installeradTjocklek = beställd + beställd × sättningsprocent/100 (rounded). '' when invalid.
export function installedThickness(bestalld?: string, sattningsprocent?: string): string {
  // NaN fallback so empty/invalid input stays blank (Number.isFinite check below),
  // while sv-SE comma decimals ("12,5") parse correctly instead of truncating.
  const base = parseDecimal(bestalld, NaN);
  const perc = parseDecimal(sattningsprocent, NaN);
  const installed = Number.isFinite(base) && Number.isFinite(perc) ? base + base * (perc / 100) : NaN;
  return Number.isFinite(installed) && installed > 0 ? String(Math.round(installed)) : '';
}

// Parse a Blikk description like "Vind - 120 m² x 500 mm - 30 eko" into rows.
// Names starting with "vind" → open (loose-fill) rows; everything else → closed.
export function parseEtappRows(desc: string, lambda?: string): { open: EtappOpenRow[]; closed: EtappClosedRow[] } {
  const open: EtappOpenRow[] = [];
  const closed: EtappClosedRow[] = [];
  const re = /([A-Za-zÅÄÖåäö][A-Za-zÅÄÖåäö\s/()_-]*?)\s*-\s*(\d+[.,]?\d*)\s*m(?:2|²)\s*[x×]\s*(\d+[.,]?\d*)\s*mm\s*-\s*(\d+)\s*eko/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(desc)) !== null) {
    const rawName = (m[1] || '').trim();
    const nameNorm = rawName.toLowerCase();
    const areaStr = (m[2] || '').replace(',', '.');
    const thickStr = (m[3] || '').replace(',', '.');
    const sacksStr = (m[4] || '').trim();
    const area = isFinite(Number(areaStr)) ? String(Number(areaStr)) : '';
    const thickness = isFinite(Number(thickStr)) ? String(Number(thickStr)) : '';
    const sacks = /^\d+$/.test(sacksStr) ? sacksStr : '';
    const isVind = nameNorm === 'vind' || nameNorm.startsWith('vind');
    if (isVind) {
      open.push({ etapp: rawName, ytaM2: area, bestalldTjocklek: thickness, sattningsprocent: '', installeradTjocklek: '', antalSack: sacks, installeradDensitet: '', lambdavarde: lambda });
    } else {
      closed.push({ etapp: rawName, ytaM2: area, bestalldTjocklek: thickness, uppmatTjocklek: '', installeradDensitet: '', antalSackKgPerSack: sacks, lambdavarde: lambda });
    }
  }
  return { open, closed };
}

export function sumOpenBags(rows: EtappOpenRow[]): number {
  return rows.reduce((sum, r) => sum + (Number(r.antalSack) || 0), 0);
}

export function sumClosedBags(rows: EtappClosedRow[]): number {
  return rows.reduce((sum, r) => sum + (Number(r.antalSackKgPerSack) || 0), 0);
}

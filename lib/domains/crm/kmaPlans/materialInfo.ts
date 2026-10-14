// Materialfakta för KMA-planen — ren data, inga importer.
//
// Egen modul för att dialogen (en klientkomponent) ska kunna visa materialvalen utan att dra in
// materials.ts, som importerar efterkalkylens laddare (isBlownInsulationRow) och därmed hela
// kalkyl- och prisgrenen i webbläsarens bundle.
//
// ⚠️ CERTIFIKATEN MÅSTE STÅ I SIN MATERIALS-NYCKEL (lib/domains/crm/materials.ts) — ett test
// (tests/crm/kmaMaterials.test.ts) kräver det, så en omdöpt artikel fångas i stället för att glida
// isär tyst. Mallens "glasull CE09/0081" var Ekovillas ETA-nummer, felkopierat.

export type KmaMaterialKind = 'cellulosa' | 'glasull' | 'stenull' | 'trafiber';

export type KmaMaterialInfo = {
  kind: KmaMaterialKind;
  /** Varumärket i §3:s materialrad: "Endast godkänd cellulosaisolering (Ekovilla, …)". */
  brand: string;
  certificate: string;
};

/** Per materialkod (MATERIAL_SHORTS). Varje kod MÅSTE finnas här — ett test vaktar det. */
export const KMA_MATERIAL_INFO: Record<string, KmaMaterialInfo> = {
  EKOVILLA: { kind: 'cellulosa', brand: 'Ekovilla', certificate: 'CE ETA-09/0081' },
  'KNAUF SUPAFIL': {
    kind: 'glasull',
    brand: 'Knauf Supafil',
    certificate: 'B0709EPCR',
  },
  'ISOCELL/ISECO': {
    kind: 'cellulosa',
    brand: 'Isocell/isEco',
    certificate: 'CE ETA-06/0076',
  },
  'HUNTON NATIVO': {
    kind: 'trafiber',
    brand: 'Hunton Nativo',
    certificate: 'DoP 02-04-01',
  },
  PAROC: { kind: 'stenull', brand: 'PAROC SHT 1', certificate: '0809-CPR-1014' },
};

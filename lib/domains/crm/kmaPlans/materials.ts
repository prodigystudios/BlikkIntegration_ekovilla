import { isBlownInsulationRow } from '@/lib/domains/crm/afterCalculationLoader';
import { MATERIALS, MATERIAL_SHORTS, inferMaterialFromArticle } from '@/lib/domains/crm/materials';

import { KMA_A6_EKOVILLA_NOTE, KMA_ENV_SENTENCE_CELLULOSE, KMA_ENV_SENTENCE_KNAUF } from './template';

// Materialet i KMA-planen: vilken sorts isolering, vilket certifikat, och vilka meningar som
// därmed får stå i dokumentet.
//
// ⚠️ CERTIFIKATEN KOMMER UR MATERIALTABELLEN (lib/domains/crm/materials.ts), inte ur Word-mallen.
// Mallen skrev "Endast godkänd glasulls isolering CE09/0081" — CE09/0081 är Ekovillas ETA-nummer,
// felkopierat till glasullen. Ett certifikatnummer i en KMA-plan är ett påstående till beställaren;
// ett test (tests/crm/kmaMaterials.test.ts) kräver att varje nummer här står i sin MATERIALS-nyckel,
// så en omdöpt artikel i materialtabellen fångas i stället för att glida isär tyst.

export type KmaMaterialKind = 'cellulosa' | 'glasull' | 'stenull' | 'trafiber';

export type KmaMaterialInfo = {
  kind: KmaMaterialKind;
  /** Varumärket i §3:s materialrad: "Endast godkänd cellulosaisolering (Ekovilla, …)". */
  brand: string;
  /** Produktraden i egenkontrollmallen (bilaga 6). */
  product: string;
  certificate: string;
};

/** Per materialkod (MATERIAL_SHORTS). Varje kod MÅSTE finnas här — ett test vaktar det. */
export const KMA_MATERIAL_INFO: Record<string, KmaMaterialInfo> = {
  EKOVILLA: { kind: 'cellulosa', brand: 'Ekovilla', product: 'Ekovilla Cellulosaisolering Lösull', certificate: 'CE ETA-09/0081' },
  'KNAUF SUPAFIL': {
    kind: 'glasull',
    brand: 'Knauf Supafil',
    product: 'Knauf Supafil Frame Glasullsisolering Lösull',
    certificate: 'B0709EPCR',
  },
  'ISOCELL/ISECO': {
    kind: 'cellulosa',
    brand: 'Isocell/isEco',
    product: 'Isocell/isEco Cellulosaisolering Lösull',
    certificate: 'CE ETA-06/0076',
  },
  'HUNTON NATIVO': {
    kind: 'trafiber',
    brand: 'Hunton Nativo',
    product: 'Hunton Nativo Träfiberisolering Lösull',
    certificate: 'DoP 02-04-01',
  },
  PAROC: { kind: 'stenull', brand: 'PAROC SHT 1', product: 'PAROC SHT 1 Stenullsisolering Lösull', certificate: '0809-CPR-1014' },
};

const KIND_LABEL: Record<KmaMaterialKind, string> = {
  cellulosa: 'cellulosaisolering',
  glasull: 'glasullsisolering',
  stenull: 'stenullsisolering',
  trafiber: 'träfiberisolering',
};

/** Behåller bara kända koder, i katalogordning, utan dubbletter. */
export function normalizeKmaMaterials(materials: readonly string[]): string[] {
  const wanted = new Set(materials);
  return MATERIAL_SHORTS.filter((short) => wanted.has(short) && KMA_MATERIAL_INFO[short]);
}

/**
 * Orderns BLÅSTA material, ur artikelraderna. Samma två filter som efterkalkylen: raden måste
 * blåsas (isBlownInsulationRow — varumärket ensamt räcker inte, EKOVILLA LEVY är skivor) och får
 * inte vara avskriven.
 */
export function kmaMaterialsFromLineItems(lineItems: unknown): string[] {
  if (!Array.isArray(lineItems)) return [];
  const found: string[] = [];
  for (const raw of lineItems) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (item.written_off === true) continue;
    if (!isBlownInsulationRow(item)) continue;
    const material = inferMaterialFromArticle(item.article_name as string | null | undefined);
    if (material) found.push(material.short);
  }
  return normalizeKmaMaterials(found);
}

/**
 * §1: "… vid tilläggsisolering med cellulosaisolering (lösull)." Flera sorter räknas upp med "och".
 * Utan känt material står "lösullsisolering" — hellre allmänt än ett påstått material.
 */
export function kmaMaterialPhrase(materials: readonly string[]): string {
  const kinds = [...new Set(normalizeKmaMaterials(materials).map((m) => KMA_MATERIAL_INFO[m].kind))];
  if (kinds.length === 0) return 'lösullsisolering';
  const labels = kinds.map((kind) => KIND_LABEL[kind]);
  const joined = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} och ${labels[labels.length - 1]}`;
  return `${joined} (lösull)`;
}

/** §3 Materialhantering: en rad per material, med certifikatet ur materialtabellen. */
export function kmaMaterialHandlingLines(materials: readonly string[]): string[] {
  return normalizeKmaMaterials(materials).map((m) => {
    const info = KMA_MATERIAL_INFO[m];
    return `Endast godkänd ${KIND_LABEL[info.kind]} (${info.brand}, ${info.certificate})`;
  });
}

/**
 * §4 Miljöpolicy: bara de meningar som stämmer för orderns material. Cellulosameningen gäller all
 * cellulosa (återvunnet tidningspapper), Knaufmeningen bara Knauf. För trä- och stenull finns ingen
 * mening i bolagets texter — då står bara inledningen, hellre än en påhittad formulering.
 */
export function kmaEnvironmentSentences(materials: readonly string[]): string[] {
  const list = normalizeKmaMaterials(materials);
  const sentences: string[] = [];
  if (list.some((m) => KMA_MATERIAL_INFO[m].kind === 'cellulosa')) sentences.push(KMA_ENV_SENTENCE_CELLULOSE);
  if (list.includes('KNAUF SUPAFIL')) sentences.push(KMA_ENV_SENTENCE_KNAUF);
  return sentences;
}

/** Bilaga 6: produktnamn och certifikattext per material. */
export function kmaSelfCheckProducts(materials: readonly string[]): Array<{ product: string; text: string }> {
  return normalizeKmaMaterials(materials).map((m) => {
    const info = KMA_MATERIAL_INFO[m];
    // "för installation i öppna och slutna konstruktioner" är Ekovillas ETA-formulering — den
    // skrivs inte på andra material, där vi inte vet vad certifikatet omfattar.
    const text =
      m === 'EKOVILLA'
        ? `Produktcertifikat: ${info.certificate} för installation i öppna och slutna konstruktioner. ${KMA_A6_EKOVILLA_NOTE}`
        : `Produktcertifikat: ${info.certificate}`;
    return { product: info.product, text };
  });
}

/** Bilaga 6: takfotsnoten hör till cellulosa. */
export function kmaHasCellulose(materials: readonly string[]): boolean {
  return normalizeKmaMaterials(materials).some((m) => KMA_MATERIAL_INFO[m].kind === 'cellulosa');
}

/**
 * Bilaga 6: λ-värdet, med komma, när ordern har EXAKT ett material. Med flera vet blanketten inte
 * vilken etapp som blåses med vad — då lämnas rutan åt installatören.
 */
export function kmaLambda(materials: readonly string[]): string {
  const list = normalizeKmaMaterials(materials);
  if (list.length !== 1) return '';
  const entry = Object.values(MATERIALS).find((m) => m.short === list[0]);
  return entry ? entry.lambda.replace('.', ',') : '';
}

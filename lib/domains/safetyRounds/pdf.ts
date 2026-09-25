import { buildDocumentFilename } from '@/lib/domains/crm/documentEmail';
import { renderBlocksPdf, type PdfAssets } from '@/lib/pdf/blocks';

import type { SafetyRoundDocument } from './document';
import { safetyRoundOrderRef, type SafetyRound } from './types';

// Skyddsrondens protokoll som PDF. Ritningen bor i lib/pdf/blocks.ts (samma som KMA-planen); här
// finns bara dokumentets metadata och filnamnet.

/** Dokumentet och fotonas bytes (per ref, se SafetyRoundDocument.photoDownloads). */
export async function renderSafetyRoundPdf(
  doc: SafetyRoundDocument & { images?: ReadonlyMap<string, Uint8Array> },
  assets: PdfAssets = {},
): Promise<Uint8Array> {
  return renderBlocksPdf(doc, assets);
}

/**
 * Filnamnet: "Skyddsrond 6579 rond2 - Vindsbjalklag Hus AC.pdf". Samma ASCII-regel som orderns
 * andra dokument (buildDocumentFilename). Rondnumret står i namnet så att två ronder på samma order
 * inte skriver över varandra i Hämtade filer.
 */
export function safetyRoundFilename(round: Pick<SafetyRound, 'round_number' | 'project_name' | 'order_number' | 'fortnox_order_number'>): string {
  return buildDocumentFilename({
    kind: 'safety',
    ref: [safetyRoundOrderRef(round), `rond${round.round_number}`].filter(Boolean).join(' '),
    projectName: round.project_name,
  });
}

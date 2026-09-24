import { buildDocumentFilename } from '@/lib/domains/crm/documentEmail';
import { renderBlocksPdf, type PdfAssets } from '@/lib/pdf/blocks';

import type { KmaDocument } from './types';

// KMA-planen som PDF — ritar ett sparat dokument (document.ts), block för block.
//
// Ritningen bor i lib/pdf/blocks.ts (delas med skyddsronden). Renderaren BYGGER INGEN TEXT: allt
// som skrivs ut finns i dokumentet, och dokumentet sparas på varje revision; därför blir en
// omladdning samma innehåll som kunden fick.
//
// ⚠️ DATUM ÄR PLANENS, ALDRIG DAGENS. Metadatadatumen sätts till utgivningsdatumet och ingen text
// om utskriften ritas, så att en PDF-läsare inte säger "skapad i dag" om en plan från i våras.

export type KmaPdfAssets = PdfAssets;

export async function renderKmaPdf(doc: KmaDocument, assets: KmaPdfAssets = {}): Promise<Uint8Array> {
  // Ett dokument i en form den här renderaren inte känner ritas inte "så gott det går".
  if (doc.v !== 1 || doc.layout !== 1) throw new Error(`KMA-dokumentets version stöds inte (v${doc.v}, layout ${doc.layout}).`);

  return renderBlocksPdf(
    {
      sections: doc.sections,
      footer: doc.footer,
      running: doc.running,
      title: `KMA-plan ${doc.meta.projectNumber} – ${doc.meta.projectName}`,
      subject: `Revision ${doc.meta.revision}`,
      date: doc.meta.issuedOn,
    },
    assets,
  );
}

/**
 * Filnamnet: "KMA-plan 6579 rev2 - Vindsbjalklag Hus AC.pdf". Samma ASCII-regel som orderns andra
 * dokument (buildDocumentFilename) — å/ä/ö renderas olika per webbläsare och filsystem. Revisionen
 * står i namnet så att två revisioner inte skriver över varandra i Hämtade filer.
 */
export function kmaPlanFilename(meta: Pick<KmaDocument['meta'], 'projectNumber' | 'revision' | 'projectName'>): string {
  return buildDocumentFilename({
    kind: 'kma',
    ref: [meta.projectNumber, `rev${meta.revision}`].filter(Boolean).join(' '),
    projectName: meta.projectName,
  });
}

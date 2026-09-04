// Vilka offerter som renderas lokalt i stället för av Fortnox utskriftsmall — läget och beslutet,
// utan renderaren.
//
// EGEN MODUL MED FLIT. `offerPdf.ts` drar in pdf-lib (stora font- och kodningstabeller) och
// node:fs. `offers.ts` importeras av varje route som sparar en offert, så en statisk import av
// renderaren därifrån hade lagt PDF-motorn på offertsparningens kallstart utan att någon renderar
// något. Genom att lägga läget här kan `offers.ts` läsa det gratis och ladda renderaren dynamiskt
// först när en PDF faktiskt ska produceras.
//
// Se offerPdf.ts för bakgrunden: Fortnox utskriftsmall utelämnar skattereduktionen på offerter
// skapade via API:t, och vi är på väg mot en egen offert-PDF för allt.

/**
 * - `'rot'` – bara ROT-offerter (dagens läge: det är där Fortnox mall är trasig).
 * - `'all'` – alla offerter. Dit vi är på väg när den egna formgivningen är klar; byt hit och
 *   Fortnox utskriftsmall används inte längre någonstans.
 * - `'off'` – tillbaka till Fortnox för allt, om något behöver backas snabbt.
 */
export type OfferPdfMode = 'rot' | 'all' | 'off';

/** Ett värde att ändra, ingen kodändring runt omkring. */
export const OFFER_PDF_MODE: OfferPdfMode = 'all';

/**
 * VILKEN formgivning en lokalt renderad offert får. Skild från `OFFER_PDF_MODE`, som avgör VILKA
 * offerter vi renderar själva — två frågor som inte hör ihop.
 *
 * - `'design'` – Ekovillas egen mall med försättsblad, informationsblad och allmänna villkor.
 *   Live sedan 2026-09-04, godkänd av VD.
 * - `'fortnox-kopia'` – den handritade kopian av Fortnox utskriftsmall i `offerPdf.ts`. Byggd när
 *   ROT brann och Fortnox mall utelämnade skattereduktionen. Kvar som mellanläge: den renderar
 *   lokalt utan att dokumentet byter utseende.
 *
 * Behöver något backas snabbt finns tre steg, i ordning efter hur mycket de ändrar:
 *   1. `?mall=fortnox` på PDF-routen — enskild offert, ingen deploy, funkar direkt
 *   2. `OFFER_PDF_LAYOUT = 'fortnox-kopia'` — alla offerter, men fortfarande vår rendering
 *   3. `OFFER_PDF_MODE = 'off'` — allt tillbaka till Fortnox utskriftsmall
 */
export type OfferPdfLayout = 'design' | 'fortnox-kopia';

export const OFFER_PDF_LAYOUT: OfferPdfLayout = 'design';

/**
 * Ska den här offerten renderas lokalt?
 *
 * I `'rot'`-läget krävs BÅDA: att säljaren valt ROT i CRM och att Fortnox räknar dokumentet som ett
 * ROT-dokument. Två oberoende villkor, så en icke-ROT-offert aldrig kan glida in i den lokala
 * renderaren medan den bara ska täcka det trasiga fallet.
 */
export function shouldRenderLocally(
  mode: OfferPdfMode,
  rotSelected: boolean,
  taxReductionType: string | null | undefined,
): boolean {
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return rotSelected && taxReductionType === 'rot';
}

/**
 * Är det värt en Fortnox-rundtur alls? Speglar `shouldRenderLocally` men får bara läsa det vi vet
 * innan dokumentet hämtats — i `'rot'`-läget behöver en offert utan ROT aldrig hämtas. Det
 * egentliga beslutet tas av `shouldRenderLocally` när svaret finns.
 */
export function mayRenderLocally(mode: OfferPdfMode, rotSelected: boolean): boolean {
  if (mode === 'off') return false;
  return mode === 'all' || rotSelected;
}

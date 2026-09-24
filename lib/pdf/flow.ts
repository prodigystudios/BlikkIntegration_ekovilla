import type { PDFPage } from 'pdf-lib';

// Sidflödet för pdf-lib-renderarna: VAR nästa rad hamnar — sidan och baslinjen tillsammans.
//
// Bodde i lib/domains/time/payrollPdf.ts till 2026-09-24 och flyttades hit när KMA-planens
// renderare (lib/domains/crm/kmaPlans/pdf.ts) behövde samma brytning. Samma skäl som brandAssets.ts
// och text.ts flyttades: den andra användaren, inte en förmodad.
//
// ⚠️ SIDAN OCH BASLINJEN BOR I ETT OBJEKT, inte i två lokala variabler.
//
// Med `let page` hos anroparen och en hjälpare som tar `page` som argument ritar hjälparen vidare på
// den sida den FICK, även efter att `ensure` bytt till en ny — i löneunderlaget hade
// ersättningslistan hamnat osynlig ovanpå sidan före. Felklassen syns inte i en liten testfixtur,
// bara i ett dokument som råkar brytas på rätt ställe. Texten går dessutom fortfarande att
// extrahera, så ett test som bara letar efter strängen är grönt medan utskriften är oläslig.
// Läs därför alltid `flow.page` och `flow.y` på nytt efter `ensure`, och pröva SIDAN i testerna.

export type Flow = {
  page: PDFPage;
  y: number;
  /**
   * Vad som ritas överst på en FORTSÄTTNINGSSIDA, under sidhuvudet.
   *
   * ⚠️ Måste följa med det som faktiskt flödar. Tabellhuvudet låg först fast på varje ny sida, och
   * en månad vars ersättningslista bröt till sida två fick då "DATUM · KLOCKSLAG · RAST · ARBETAT"
   * över fyra utläggsrader — kolumnrubriker som inte beskrev något på sidan. `null` betyder att
   * sidan börjar tom under huvudet. Nollställ den när tabellen är slut.
   *
   * Får `top` (första baslinjen på fortsättningssidan) och kan returnera hur många punkter den
   * använde — då börjar flödet så långt under. En rubrik med fast plats (löneunderlaget) returnerar
   * inget; en tabellrubrik vars höjd beror på texten (KMA-planen) returnerar sin höjd.
   */
  continuation: ((page: PDFPage, top: number) => number | void) | null;
  /** Byter till en fortsättningssida när `height` punkter inte ryms ovanför `bottom`. */
  ensure(height: number): void;
  /**
   * Avsiktlig sidbrytning — ett nytt avsnitt, som en bilaga. Ritar INGET fortsättningshuvud: det
   * hör till något som flödar över en brytning, och här börjar något nytt.
   */
  breakPage(): void;
};

export type FlowOptions = {
  /** Sidan flödet börjar på — skapad av anroparen, med sitt sidhuvud redan ritat. */
  page: PDFPage;
  /** Första baslinjen på startsidan. */
  top: number;
  /** Första baslinjen på en fortsättningssida. */
  continuationTop: number;
  /** Ingen rad får gå under den här baslinjen — under den börjar foten. */
  bottom: number;
  /** Skapar en fortsättningssida, sidhuvudet inräknat. */
  newPage: () => PDFPage;
  continuation?: ((page: PDFPage, top: number) => number | void) | null;
};

export function createFlow(options: FlowOptions): Flow {
  const { newPage, continuationTop, bottom } = options;
  // Metoden läser objektet via closuren, inte via `this` — ett `const { ensure } = flow` hos en
  // anropare hade annars tappat sitt objekt utan att något kastar förrän sidan skulle brytas.
  const flow: Flow = {
    page: options.page,
    y: options.top,
    continuation: options.continuation ?? null,
    ensure(height: number) {
      if (flow.y - height >= bottom) return;
      flow.page = newPage();
      const used = flow.continuation?.(flow.page, continuationTop);
      flow.y = continuationTop - (typeof used === 'number' ? used : 0);
    },
    breakPage() {
      flow.page = newPage();
      flow.y = continuationTop;
    },
  };
  return flow;
}

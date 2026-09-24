import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Ekovillas typsnitt och logotyp, lästa från disk VID KÖRNING.
//
// Bodde i lib/domains/fortnox/documentPdfDesign.ts till 2026-09-21 och flyttades hit när
// löneunderlagets PDF (lib/domains/time/payrollPdf.ts) behövde samma två filer. Alternativet — att
// importera ur fortnox-domänen — hade dragit in hela offertrenderaren i löneroutens serverfunktion
// och pekat tid-domänen mot CRM:ets integrationslager för två filläsningar.
//
// documentPdfDesign.ts re-exporterar båda funktionerna, så dess anropare och tester är oförändrade.

const FONT_DIR = path.join(process.cwd(), 'public', 'brand', 'fonts');
// Logotypen bor bland varumärkesmaterialet, inte bland dokumenten — templates/ innehåller sådant
// som går ut till kund, och där ligger också underlag som är gitignorerat.
const LOGO_PATH = path.join(process.cwd(), 'public', 'brand', 'Ekovilla_logo_Figma.png');

/**
 * Open Sans, statiska instanser. Variabelfonten (`OpenSans-VariableFont_wdth,wght.ttf`) fungerar
 * INTE — fontkit kan inte bädda in den och dokumentet blir tomt utan att något kastar.
 */
export async function loadDesignFonts(): Promise<{ regular: Uint8Array; bold: Uint8Array }> {
  try {
    const [regular, bold] = await Promise.all([
      readFile(path.join(FONT_DIR, 'OpenSans-Regular.ttf')),
      readFile(path.join(FONT_DIR, 'OpenSans-Bold.ttf')),
    ]);
    return { regular: new Uint8Array(regular), bold: new Uint8Array(bold) };
  } catch (e) {
    // Slog i drift 2026-09-04 med ett naket ENOENT. Orsaken: Next spårar ett `path.join` med enbart
    // literaler, men INTE en väg som byggts genom en variabel — och `FONT_DIR` är en variabel, så
    // typsnitten följde aldrig med in i serverfunktionen. Lokalt märks inget; där finns filerna.
    // Lösningen bor i `experimental.outputFileTracingIncludes` i next.config.js — säg det rakt ut
    // här, så nästa gång någon lägger till en fil att läsa vid körning tar felsökningen minuter.
    //
    // ⚠️ Listan är PER ROUTE. Varje ny serverfunktion som renderar en PDF måste läggas till där;
    // att offertens route redan har typsnitten hjälper inte löneunderlagets.
    throw new Error(
      `Kunde inte läsa typsnitten i ${FONT_DIR}: ${e instanceof Error ? e.message : e}. ` +
      'Ligger filen under public/ måste den listas i outputFileTracingIncludes (next.config.js), ' +
      'annars saknas den i serverfunktionen trots att den finns i repot.',
    );
  }
}

/** Logotypen är valfri: saknas filen ritas dokumentet ändå. */
export async function loadDesignLogo(): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(LOGO_PATH));
  } catch {
    return null;
  }
}

// Isoleringslandslagets logotyp (JPEG), ur sidhuvudet i deras KMA-mall. KMA-planen står alltid på
// Isoleringslandslaget AB (lib/domains/crm/kmaPlans/), och mallens huvud bär båda bolagens loggor.
//
// ⚠️ Sökvägen byggs med ENBART LITERALER, som LOGO_PATH ovan — Next spårar bara en sådan. Routen
// som läser filen står ändå i outputFileTracingIncludes (next.config.js), eftersom listan är per
// route och spåraren inte är något att luta sig mot ensam.
const ISOLERINGSLANDSLAGET_LOGO_PATH = path.join(process.cwd(), 'public', 'brand', 'Isoleringslandslaget_logo.jpg');

/** Valfri, som Ekovillas: saknas filen ritas dokumentet utan den. */
export async function loadIsoleringslandslagetLogo(): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(ISOLERINGSLANDSLAGET_LOGO_PATH));
  } catch {
    return null;
  }
}

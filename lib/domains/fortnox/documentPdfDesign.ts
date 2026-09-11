// Egen formgivning av kunddokumentens PDF — Ekovillas mall, inte Fortnox.
//
// VAD DEN ÄR. `offerPdf.ts` ritar en KOPIA av Fortnox utskriftsmall, medvetet, så mottagaren inte
// skulle se att dokumentet bytte utseende mitt i en pågående offertdialog när ROT-offerterna
// snabbt behövde renderas lokalt. Den här modulen är den formgivning kopian alltid var tänkt att
// ersättas av. Måtten nedan är MÄTTA ur Figma-exporten i public/documents/templates/, inte
// uppskattade: text-, linje- och ytkoordinater lästa ur PDF:en och färgerna ur PNG:ens pixlar.
//
// TRE DOKUMENT, EN LAYOUT. Offert, orderbekräftelse och följesedel ritas av samma kod och skiljs åt
// av en `DocumentVariant` — rubrik, metablock, referensrader och om dokumentet bär belopp. Måtten,
// färgerna och kolumnerna är gemensamma med FLIT: de tre är samma brevpapper, och en kopia per
// dokumenttyp hade betytt tre ställen att mäta om nästa gång mallen ändras.
//
// ARBETSDELNINGEN ÄR OFÖRÄNDRAD. Datahämtningen bor kvar i `offers.ts` / `orders.ts` och beloppen
// ägs fortfarande av Fortnox — vi räknar ingenting om. Fakturan skapas sedan av Fortnox ur samma
// underlag, så ett dokument vi ritat själva kan aldrig visa ett annat belopp än det som faktureras.
// Den regeln överlever formgivningsbytet.
//
// ÅTERANVÄNDER de rena hjälparna ur `offerPdf.ts` (belopps- och antalsformatering, textradsregeln,
// momsunderlaget, ROT-provet) i stället för att kopiera dem. När kopian av Fortnox mall tas bort
// blir de hjälparna kvar; det är bara ritfunktionerna som försvinner.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, setCharacterSpacing, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';

import {
  formatAmount,
  formatQuantity,
  isRotDocument,
  isTextOnlyRow,
  summarizeVat,
  type FortnoxCompanySettingsResponse,
  type FortnoxOfferResponse,
  type FortnoxOfferRowResponse,
} from './offerPdf';

// ── Dokumentets form ─────────────────────────────────────────────────────────

/**
 * Dokumenthuvudet renderaren läser: allt utom det som heter olika saker på de olika
 * Fortnox-dokumenten (datumfälten och radlistan).
 *
 * `FortnoxOfferResponse` uppfyller typen strukturellt och skickas in som den är. En Fortnox-ORDER
 * normaliseras till den av `orderPdfDesign.ts` — där heter datumen `OrderDate`/`DeliveryDate` och
 * raderna bär `OrderedQuantity` i stället för `Quantity`.
 */
export type DesignDocumentHeader = Omit<FortnoxOfferResponse, 'OfferDate' | 'ExpireDate' | 'OfferRows'>;

/** En dokumentrad, normaliserad. Ordrarnas `OrderedQuantity` ligger i `Quantity` här. */
export type DesignDocumentRow = FortnoxOfferRowResponse;

export type DesignDocumentKind = 'offer' | 'order' | 'delivery';

/**
 * Det som skiljer de tre dokumenten åt. Allt annat — mått, färger, kolumnlägen, foten — är
 * gemensamt och bor i konstanterna nedan.
 */
export type DocumentVariant = {
  kind: DesignDocumentKind;
  /** Rubriken i huvudet. Versaler, spärrad 0,1 em. */
  title: string;
  /** Titelblockets rader, uppifrån och ned. Max tre — se `META_Y`. */
  meta: Array<[label: string, value: string]>;
  /** UPPDRAG-blockets rader. Rader utan värde hoppas över när de ritas. */
  references: Array<[label: string, value: string]>;
  /** Etiketten i den gröna rutan när dokumentet saknar skattereduktion. */
  totalLabel: string;
  /**
   * Bär dokumentet belopp? Falskt stänger av À-PRIS-, RABATT- och SUMMA-kolumnerna OCH hela
   * summeringen — följesedeln är ett leveransdokument, inte ett prisdokument.
   */
  showPrices: boolean;
  /** Ska ROT-blocket (sökande, fastighetsbeteckning) och ROT-förbehållet ritas? */
  showRot: boolean;
};

// ── Färger ───────────────────────────────────────────────────────────────────
//
// Lästa ur PNG-exportens pixlar. `GREEN_TABLE` är avsiktligt en ANNAN grön än `GREEN` — mallen
// använder två. Blanda inte ihop dem.

const hex = (value: string): RGB => {
  const n = parseInt(value.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const GREEN = hex('#00552d'); // rubriker, kundnamn, artikelbenämning, totalbelopp, foten
const GREEN_TABLE = hex('#184700'); // BARA tabellens kolumnrubriker
const INK = hex('#1e1e1e'); // värden
const MUTED = hex('#585858'); // etiketter och brödtext
const RULE = hex('#dbdbdb'); // linjer, 0,6 pt
const BOX = hex('#f1f5ef'); // totalrutans botten

// ── Mått ─────────────────────────────────────────────────────────────────────
//
// Allt i punkter med origo i nedre vänstra hörnet, precis som pdf-lib räknar. Värdena är hämtade
// ur Figma-exporten `Ekovilla-Offert-Standard-1-ingen-rot.pdf`; ROT-exportens avvikande värden är
// medvetet INTE använda (William 2026-09-03: originalet är normen för båda).

const PAGE_W = 595;
const PAGE_H = 842;
const M_LEFT = 45;
const M_RIGHT = 550;

// Huvudets vänsterkolumn (logotyp, tagline, kundblock) ligger på 52 — i linje med tabellens
// ARTIKEL NUMMER. Linjerna och foten står kvar på M_LEFT (45). Det är inte ett misstag utan
// revisionens uppställning: innehållet är indraget innanför linjerna.
const HEAD_LEFT_X = 52;

const LOGO_X = HEAD_LEFT_X;
const LOGO_TOP = 805;
const LOGO_W = 213;
const TAGLINE = 'Naturlig Isolering, Naturlig Kvalitet';
const TAGLINE_Y = 750;

const TITLE_X = 341;
const TITLE_Y = 783;
// Rubriken är spärrad i mallen: "OFFERT" mäter 75,7 pt där, men bara 66,5 pt satt tätt i samma
// Open Sans Bold. Skillnaden fördelad på de fem mellanrummen blir 0,1 em — Figmas letter-spacing.
const TITLE_TRACKING = 18 * 0.1;
const META_LABEL_X = 339;
const META_VALUE_R = 466;
const META_Y = [761, 745, 729]; // Offertnr, Offertdatum, Giltig t.o.m. — 16 pt delning

// Kund- och leveransblocket är nedskalat två punkter mot Figma-mallen (William 2026-09-04).
// Radavstånden är skalade med — enbart mindre text hade inte gett någon luft, eftersom baslinjerna
// är absoluta. Vinsten är 22 pt: blocket slutar på 634 i stället för 612, och tabellen behöver
// därför inte längre tryckas ned när det finns en leveransadress.
const SECTION_KUND_Y = 725;
const SECTION_UPPDRAG_Y = 696;
const SECTION_SIZE = 7; // KUND / LEVERANSADRESS (mallen: 9)
const CUSTOMER_NAME_Y = 710;
const CUSTOMER_NAME_SIZE = 8; // mallen: 10
const CUSTOMER_ADDRESS_Y = 698;
const CUSTOMER_ADDRESS_STEP = 11;
const CUSTOMER_ADDRESS_SIZE = 7; // mallen: 9
const CUSTOMER_META_GAP = 15; // sista adressraden → "Kundnr … · VAT …"
const CUSTOMER_META_SIZE = 6; // mallen: 8

// Leveransadressen står under kundblocket och ritas BARA när den skiljer sig från fakturaadressen.
// Samma adress två gånger är brus, och på ett lösulljobb är det just skillnaden som betyder något:
// arbetsplatsen är inte alltid den som får fakturan.
const DELIVERY_LABEL_GAP = 15; // kundraden → LEVERANSADRESS
const DELIVERY_FIRST_GAP = 12; // rubriken → första adressraden
const DELIVERY_STEP = 11;

// ROT-blocket följer samma trappa som leveransadressen och står sist i vänsterkolumnen.
const ROT_LABEL_GAP = 15;
const ROT_FIRST_GAP = 12;
const ROT_STEP = 11;

// ROT-förbehållet står till VÄNSTER om summeringen, i ytan som annars är tom. Det är ett villkor
// för priset, så det hör hemma bredvid beloppet det gäller — inte längst ned bland det finstilta.
//
// Blocket är BOTTENANKRAT mot fotens linje och hamnar därmed i höjd med totalbeloppet, oavsett om
// texten bryts till två eller tre rader. Ankrat i överkant hade det flutit uppåt från den gröna
// rutan och tappat kopplingen till priset.
const CLAUSE_X = HEAD_LEFT_X;
const CLAUSE_SIZE = 6;
const CLAUSE_STEP = 9;
const CLAUSE_LAST_BASELINE = 92; // sista raden, strax ovanför fotens linje på y=86
const ROT_CLAUSE =
  'Vi förbehåller oss rätten att fakturera återstående belopp, motsvarande skattereduktionen, ' +
  'om begäran från Skatteverket avslås.';

const REF_LABEL_X = 339;
const REF_VALUE_X = 425;
const REF_Y = 677;
const REF_STEP = 10;
const REF_SIZE = 6; // mallen: 8 — nedskalat i takt med kundblocket så de matchar

// Tabellhuvudet står stilla när blocken ovanför får plats, och trycks bara ned av ett block som
// vuxit (lång adress, ombruten referenstext). Annars hade tabellen hoppat i höjdled mellan två
// offerter som ser likadana ut.
const TABLE_HEAD_Y = 590.7;
const TABLE_HEAD_GAP = 26.3;
const ROW_FIRST_GAP = 20.7; // kolumnrubrikens baslinje → första radens baslinje
const ROW_NOTE_GAP = 12; // radens baslinje → första anmärkningsradens
const ROW_NOTE_STEP = 10; // ytterligare anmärkningsrader
const ROW_RULE_GAP = 8; // sista baslinjen → linjen, när raden saknar anmärkning
const ROW_RULE_GAP_NOTE = 4; // … när den har en
const ROW_NEXT_GAP = 15; // linjen → nästa rads baslinje
const ROW_SUMMARY_GAP = 20; // minsta luft mellan sista radlinjen och summeringens översta rad

const COL_ARTNR = 52;
const COL_NAME = 140;
const COL_QTY_R = 362;
const COL_UNIT = 376;
const COL_PRICE_R = 466;
// Rabattkolumnen ryms i luckan mellan À-PRIS och SUMMA utan att någon annan kolumn flyttar sig, så
// en offert UTAN rabatt ser exakt ut som mallen. Marginalerna är knappa och uppmätta: en rabatt på
// "12,5 %" (24,5 pt) lämnar 6,5 pt till à-priset och 5,3 pt till ett sexsiffrigt belopp i SUMMA.
// Flyttas kolumnen högerut krockar den med summan; vill du ha mer luft är det À-PRIS som ska vänster.
const COL_DISCOUNT_R = 497;
const COL_SUM_R = 543;
const COL_NAME_W = COL_QTY_R - 14 - COL_NAME;

// Summeringen är BOTTENANKRAD: den gröna rutan står stilla och raderna staplas uppåt, så foten
// aldrig flyttar sig mellan en offert med och utan moms.
const SUM_BOX_X0 = 297;
const SUM_BOX_X1 = 557;
const SUM_BOX_Y0 = 86;
const SUM_BOX_Y1 = 120;
const SUM_LABEL_X = 305;
const SUM_VALUE_R = 549;
const SUM_ROW_Y = 130; // nedersta raden; varje rad ovanför ligger SUM_ROW_STEP högre
const SUM_ROW_STEP = 18;
const SUM_DEDUCTION_RULE_GAP = 13; // avdragsradens baslinje → linjen ovanför den
const SUM_TOTAL_LABEL_X = 307;
const SUM_TOTAL_LABEL_Y = 99;
const SUM_TOTAL_VALUE_R = 547;
const SUM_TOTAL_VALUE_Y = 95.8;

const FOOTER_RULE_Y = 86;
const FOOTER_X = [45, 155, 250, 410];
const FOOTER_Y = [71, 59.5, 48];
const PAGE_NUMBER_Y = 30;

const FONT_DIR = path.join(process.cwd(), 'public', 'brand', 'fonts');
// Logotypen bor bland varumärkesmaterialet, inte bland dokumenten — templates/ innehåller sådant
// som går ut till kund, och där ligger också underlag som är gitignorerat.
const LOGO_PATH = path.join(process.cwd(), 'public', 'brand', 'Ekovilla_logo_Figma.png');

/**
 * Dröjsmålsräntan visas i huvudet men returneras inte av Fortnox — den bor här.
 *
 * Exporterad så orderbekräftelsen läser SAMMA värde. Två kopior hade tyst kunnat glida isär, och då
 * hade offerten och ordern på samma affär lovat olika ränta.
 */
export const LATE_INTEREST = '8%';

// ── Text ─────────────────────────────────────────────────────────────────────
//
// Open Sans är inbäddad, så WinAnsi-spärren i `pdfSafe` gäller inte här: tankstreck, typografiska
// citattecken och det RIKTIGA minustecknet i "−3 937,00" renderas som de är. Kvar behövs bara att
// styrtecken och udda blanksteg städas bort innan de når pdf-lib.

export function cleanText(input: unknown): string {
  return String(input ?? '')
    .replace(/\r\n?/g, '\n')
    // Tabb och blanksteg som inte bryter rad (NBSP, siffermellanslag) blir vanliga mellanslag.
    .replace(/[\t\u00a0\u2007\u202f]/g, ' ')
    // Styrtecken bort. Radbrytningen (\u000a) undantas — den bär mening i wrapLines.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .trimEnd();
}

/** Bryter text till rader som ryms inom `maxWidth`. Bevarar avsiktliga radbrytningar. */
export function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of cleanText(text).split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      for (const piece of splitLongWord(word, font, size, maxWidth)) {
        const candidate = current ? `${current} ${piece}` : piece;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          current = candidate;
        } else {
          if (current) lines.push(current);
          current = piece;
        }
      }
    }
    lines.push(current);
  }
  const filled = lines.filter((line) => line !== '');
  return filled.length > 0 ? filled : [''];
}

/**
 * Delar ett ord som ensamt är bredare än kolumnen.
 *
 * Utan den här skjuts ett långt obrutet ord ut som egen rad och SPILLER över kolumnkanten — en lång
 * artikelbenämning utan mellanslag skulle skrivas rakt över antals- och prissiffrorna. Radbrytning
 * mellan ord räcker inte när ordet i sig inte får plats.
 */
function splitLongWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];

  const pieces: string[] = [];
  let piece = '';
  for (const char of word) {
    if (piece && font.widthOfTextAtSize(piece + char, size) > maxWidth) {
      pieces.push(piece);
      piece = char;
    } else {
      piece += char;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

// ── Radgruppering ────────────────────────────────────────────────────────────

export type DocumentRowGroup = {
  /** Artikelraden. `null` för en textrad som inte har någon artikel över sig. */
  row: FortnoxOfferRowResponse | null;
  /** Textraderna som hör till artikeln — mallens grå underrad. */
  notes: string[];
};

/**
 * Slår ihop artikelraden med de textrader som följer direkt efter den.
 *
 * Mallen ritar mätningen och radtexten som en grå underrad INNE i artikelns radruta, ovanför
 * skiljelinjen — inte som en egen rad. Fortnox levererar dem däremot som separata rader utan
 * artikelnummer och belopp (se `isTextOnlyRow`), så grupperingen måste göras här. Utan den hamnar
 * en skiljelinje mellan artikeln och dess egen beskrivning.
 *
 * En textrad som kommer FÖRE varje artikel hör inte till någon rad och får en egen grupp — den
 * ritas då som en fristående anmärkning i benämningskolumnen i stället för att tyst försvinna.
 */
export function groupDocumentRows(rows: FortnoxOfferRowResponse[]): DocumentRowGroup[] {
  const groups: DocumentRowGroup[] = [];
  for (const row of rows) {
    if (isTextOnlyRow(row)) {
      const note = cleanText(row.Description).trim();
      if (!note) continue;
      const last = groups[groups.length - 1];
      if (last) last.notes.push(note);
      else groups.push({ row: null, notes: [note] });
      continue;
    }
    groups.push({ row, notes: [] });
  }
  return groups;
}

// ── Rabatt ───────────────────────────────────────────────────────────────────

/**
 * Radens rabatt som text, eller tom sträng när raden saknar rabatt.
 *
 * ⚠️ **Beloppet i SUMMA räknas ALDRIG om.** Fortnox `Total` är redan rabatterad — kolumnen är ren
 * upplysning om att rabatt getts. Att dra av procenten en gång till hade halverat raden.
 *
 * CRM:et skickar alltid `DiscountType: 'PERCENT'` (se offers.ts), men Fortnox standard är AMOUNT
 * och en rad kan ha redigerats där, så båda hanteras. Procenten skrivs svenskt och utan onödiga
 * decimaler: 25 → "25 %", 12,5 → "12,5 %".
 */
export function formatDiscount(row: FortnoxOfferRowResponse): string {
  const value = Number(row.Discount ?? 0);
  if (!Number.isFinite(value) || value === 0) return '';
  if ((row.DiscountType ?? '').toUpperCase() !== 'PERCENT') return formatAmount(value);

  const percent = formatAmount(value).replace(/,?0+$/, '');
  return `${percent} %`;
}

// ── ROT ──────────────────────────────────────────────────────────────────────

/** Prefixet `buildRotPropertyNote` sätter på fastighetsraden. Är kopplingen — ändras det ena måste det andra följa med. */
const PROPERTY_PREFIX = 'Fastighetsbeteckning:';

/** Den som söker ROT-avdraget. Kommer ur CRM:s `rot_details` — se `rotApplicantLines`. */
export type RotApplicant = { name?: string | null; personalNumber?: string | null };

/**
 * De som söker avdraget: ett namn per rad, med personnummer.
 *
 * 🧨 **UPPGIFTEN KOMMER UR CRM, INTE UR FORTNOX `/taxreductions`.** Mätt mot skarp data 2026-09-07:
 * det registret är TOMT för både ordrar och offerter i vårt Fortnox-konto — `@urlTaxReductionList`
 * på dokumenten pekar på exakt den frågan, och den ger noll poster. Den enda post som hittades i
 * hela genomgången var kopplad till en FAKTURA, och saknade dessutom personnummer. Registret fylls
 * tydligen först när avdraget rapporteras, alltså långt efter att kunden fått sitt dokument.
 *
 * Följden av att bygga på den källan: ROT-blocket ritades med rubrik och fastighetsbeteckning men
 * UTAN sökande, på varje skarp offert sedan 2026-09-04. Det syntes inte i tester, för fixturerna
 * matade in poster som Fortnox aldrig lämnar ifrån sig.
 *
 * ⚠️ **CRM bär EN sökande** (`rot_details.applicant_name` + `personal_number`), inte flera. Fortnox
 * hade i teorin kunnat lista paret som äger huset ihop; vår datamodell kan det inte. Funktionen tar
 * en lista ändå — layouten klarar flera rader — men i praktiken blir det en.
 *
 * ⚠️ **Beloppet står ALDRIG här.** En uppdelning mellan flera sökande vore vår gissning, och att
 * trycka en påhittad ROT-summa per person på ett kunddokument är precis vad modulens huvudregel
 * förbjuder. Totalen står i summeringen, en gång.
 *
 * Personnumret utelämnas när det saknas i stället för att skriva ett tomt parentespar, som Fortnox
 * gör ("Kim Wolke ()"). Numret krävs först när arbetsordern skapas.
 */
export function rotApplicantLines(applicants: RotApplicant[]): string[] {
  return applicants
    .map((applicant) => {
      const name = cleanText(applicant.name).trim();
      const ssn = cleanText(applicant.personalNumber).trim();
      return [name, ssn].filter(Boolean).join(' · ');
    })
    .filter(Boolean);
}

/**
 * Sökanden till ROT-blocket. Tom lista när ingenting går att fylla i — då ritas blocket med enbart
 * fastighetsbeteckningen, vilket är bättre än en rubrik utan innehåll.
 *
 * 🧨 **PERSONNUMRET KOMMER FRÅN KUNDKORTET FÖRST**, sedan dokumentets snapshot — exakt samma
 * ordning som `workOrderReadiness.ts` spärrar på, och medvetet INTE ur `rot_details`. Numret går
 * inte att redigera i offertformuläret, så kopiorna i snapshot och `rot_details` är aldrig ett
 * medvetet val för just det dokumentet; de är kortet som det såg ut när kunden valdes. Kortet är
 * dessutom det Fortnox läser (kundens `OrganisationNumber`).
 *
 * Det spelar roll just nu: rättningen 10 → 12 siffror pågår, och prompten i offertformuläret
 * PATCHar bara kortet medan offerten låses så fort ordern finns. Läste vi `rot_details` hade
 * dokumentet tryckt det gamla ogiltiga numret långt efter att kunden rättats.
 *
 * NAMNET tas däremot ur `rot_details.applicant_name` först — det är ROT-sektionens EGET fält, det
 * enda av de två säljaren faktiskt fyller i där, och sökanden behöver inte vara densamma som
 * kundkortets namn. Faller tillbaka på kundnamnet, som på en privat ROT-order är samma person.
 */
export function resolveRotApplicants(input: {
  rotDetails?: { applicant_name?: string | null; personal_number?: string | null } | null;
  /** `crm_customers.personal_number` — se `resolveCustomerPersonalNumber`. */
  cardPersonalNumber?: string | null;
  /** Dokumentets `customer_snapshot.personal_number`. Reserv, som i workOrderReadiness. */
  snapshotPersonalNumber?: string | null;
  /** Kundnamnet på Fortnox-dokumentet. Reserv när ROT-sektionens namnfält är tomt. */
  customerName?: string | null;
}): RotApplicant[] {
  const text = (value: unknown) => String(value ?? '').trim();

  const name = text(input.rotDetails?.applicant_name) || text(input.customerName);
  const personalNumber = text(input.cardPersonalNumber) || text(input.snapshotPersonalNumber);

  return name || personalNumber ? [{ name, personalNumber }] : [];
}

/**
 * Lyfter fastighetsbeteckningen ur radlistan och lämnar tillbaka resten av raderna.
 *
 * VARFÖR DEN LIGGER I RADERNA. Fortnox har inget API-fält för fastighetsbeteckningen — den måste
 * skrivas in för hand i husarbetesdialogen — så vi skickar den som en textrad sist i offerten
 * (`buildRotPropertyNote` + `appendFortnoxTextNote`). Renderaren hänger textrader på artikeln
 * ovanför, så oredigerat läser den som en beskrivning av sista artikelraden: "Etableringskostnad /
 * Fastighetsbeteckning: Huddinge Basvägen 2:14". Den hör hemma bland ROT-uppgifterna.
 *
 * ⚠️ **Raden kan vara DELAD med säljarens egen radtext.** `appendFortnoxTextNote` slår ihop noten
 * med en textrad som redan ligger sist (två blanksteg emellan) i stället för att lägga till en ny.
 * Därför delas beskrivningen vid prefixet — lyfts hela raden följer säljarens text med och
 * försvinner från sin artikel.
 */
export function extractRotPropertyNote(
  rows: FortnoxOfferRowResponse[],
): { note: string | null; rows: FortnoxOfferRowResponse[] } {
  const kept: FortnoxOfferRowResponse[] = [];
  let note: string | null = null;

  for (const row of rows) {
    const text = cleanText(row.Description);
    // Bara den FÖRSTA träffen lyfts. Skrev vi över `note` vid en andra rad skulle den första
    // försvinna ur dokumentet helt — varken kvar som rad eller utskriven i ROT-blocket.
    // Typen skrivs ut: `note` tilldelas nedan ur `text.slice(at)`, så utan annotering blir
    // slutledningen cirkulär (TS7022) och `at` faller tillbaka på `any`.
    const at: number = isTextOnlyRow(row) && note === null ? text.indexOf(PROPERTY_PREFIX) : -1;
    if (at < 0) {
      kept.push(row);
      continue;
    }
    note = text.slice(at).trim();
    const before = text.slice(0, at).trim();
    // Bara det säljaren själv skrev blir kvar som radtext; är raden tom efter delningen utgår den.
    if (before) kept.push({ ...row, Description: before });
  }

  return { note, rows: kept };
}

// ── Leveransadress ───────────────────────────────────────────────────────────

/**
 * Leveransadressens rader — tomma när den saknas ELLER är samma som fakturaadressen.
 *
 * Jämförelsen görs på HELA adressen, inte bara gatan. En leveransadress som skiljer sig först i
 * postorten ("Storgatan 1, Sandviken" vs "Storgatan 1, Gävle") är två olika platser, och att
 * jämföra enbart `Address1` hade dolt den — arbetslaget hade åkt till fel ort.
 */
export function deliveryAddressLines(offer: DesignDocumentHeader): string[] {
  const street = cleanText(offer.DeliveryAddress1).trim();
  if (!street) return [];

  const lines = [street, [offer.DeliveryZipCode, offer.DeliveryCity].filter(Boolean).join(' ').trim()]
    .filter(Boolean);
  const invoice = [
    cleanText(offer.Address1).trim(),
    [offer.ZipCode, offer.City].filter(Boolean).join(' ').trim(),
  ].filter(Boolean);

  const same = lines.join('|').toLowerCase() === invoice.join('|').toLowerCase();
  return same ? [] : lines;
}

// ── Summeringsblocket ────────────────────────────────────────────────────────

export type SummaryBlock = {
  /** Raderna ovanför den gröna rutan, uppifrån och ned. */
  rows: Array<{ label: string; value: string }>;
  /** ROT-avdraget, som står under en egen skiljelinje. `null` på ett dokument utan avdrag. */
  deduction: { label: string; value: string } | null;
  /** Den gröna rutans etikett och belopp. */
  total: { label: string; value: string };
};

/**
 * Bygger summeringen ur Fortnox egna tal. INGET räknas om.
 *
 * ⚠️ **Momsen delas aldrig upp när det finns flera skattesatser.** `summarizeVat` kan visa vilka
 * satser som förekommer, men beloppet per sats blir vår egen avrundning och summerar då inte
 * nödvändigtvis till Fortnox `TotalVAT`. Hellre en rad utan procentsats — "Moms" — än två rader
 * som tillsammans säger något annat än det som faktureras.
 *
 * ⚠️ **Öresavrundningen måste med när den finns.** Fortnox `Total` är `Net + TotalVAT + RoundOff`;
 * utelämnas raden går summeringen inte ihop på papperet och dokumentet ser felräknat ut.
 */
export function buildSummaryBlock(
  offer: DesignDocumentHeader,
  rows: DesignDocumentRow[],
  currency = 'SEK',
  totalLabel = 'TOTALT OFFERTVÄRDE',
): SummaryBlock {
  const vat = Number(offer.TotalVAT ?? 0);
  const roundOff = Number(offer.RoundOff ?? 0);
  const lines: Array<{ label: string; value: string }> = [
    { label: 'Summa exkl. moms', value: formatAmount(offer.Net) },
  ];

  if (vat !== 0) {
    const rates = summarizeVat(rows).filter((entry) => entry.rate > 0);
    const label = rates.length === 1 ? `Moms ${formatAmount(rates[0].rate).replace(',00', '')}%` : 'Moms';
    lines.push({ label, value: formatAmount(vat) });
  }
  if (roundOff !== 0) lines.push({ label: 'Öresavrundning', value: formatAmount(roundOff) });
  // "Totalt inkl. moms" står BARA på ett dokument som har moms — offerter med moms och
  // ROT-offerterna, som alltid bär moms (pushen släcker ROT vid omvänd skattskyldighet). "Summa
  // exkl. moms" står på alla. Williams regel 2026-09-11.
  //
  // 🧨 Styr ALDRIG raden på avrundningen. Den gjorde det, och varje offert med omvänd
  // skattskyldighet vars netto hade ören — rabattrader, m³-antal, mer än hälften av dem — fick
  // "Totalt inkl. moms" på ett dokument utan moms (offert 10200). Summeringen går ihop ändå:
  // avrundningsraden förklarar skillnaden mellan nettot och slutsumman i den gröna rutan.
  if (vat !== 0) lines.push({ label: 'Totalt inkl. moms', value: formatAmount(offer.Total) });

  // ⚠️ Avdragsraden styrs av BELOPPET, inte av att typen råkar vara 'rot'.
  //
  // `TotalToPay` från Fortnox är redan minskad med skattereduktionen, vilken sort den än är. Visade
  // vi raden bara för ROT skulle en offert med RUT eller grön teknik få en slutsumma som är lägre än
  // "Totalt inkl. moms" utan att något förklarar mellanskillnaden — ett kunddokument som synbart
  // inte går ihop. Procentsatsen skrivs bara ut för ROT, där vi vet att den är 30; för övriga sorter
  // står bara "Skattereduktion" hellre än en påhittad sats.
  const reduction = Math.abs(Number(offer.TaxReduction ?? 0));
  const isRot = (offer.TaxReductionType ?? '').toLowerCase() === 'rot';

  // Slutsumman kommer ur Fortnox `TotalToPay`. Saknas fältet finns två lägen:
  //
  //   utan avdrag → `Total` ÄR slutsumman. Reserven är exakt rätt, och utan den hade ett svar som
  //                 inte bär fältet gett "0,00" på ett dokument fullt av belopp.
  //   med avdrag  → `Total` är beloppet FÖRE avdraget. Skrivet under etiketten "ATT BETALA EFTER
  //                 AVDRAG" är det för högt; en nolla säger i stället att kunden inte ska betala
  //                 något. **Båda är trovärdiga och båda är fel** — och de står direkt under en
  //                 avdragsrad, så ingen läsare har anledning att misstänka dem.
  //
  // Mellanskillnaden räknar vi inte ut själva. Att Fortnox äger beloppen är hela skälet till att
  // dokumentet inte kan visa något annat än det som faktureras. Alltså kastar vi, precis som
  // resten av PDF-vägen gör där ett tyst fel annars hade nått kunden. `TotalToPay: 0` är ett
  // giltigt svar (helt bortdraget belopp) och skiljs därför från att fältet saknas.
  if (reduction > 0 && offer.TotalToPay == null) {
    throw new Error(
      `Fortnox svarade med en skattereduktion (${formatAmount(reduction)}) men utan TotalToPay på ` +
      `dokument ${offer.DocumentNumber ?? '(utan nummer)'}. Slutsumman går då inte att visa utan att ` +
      'vi räknar ut den själva, vilket den här renderaren aldrig gör.',
    );
  }

  return {
    rows: lines,
    deduction: reduction > 0
      ? {
          label: isRot ? 'ROT-avdrag 30% av arbetskostnaden' : 'Skattereduktion',
          value: `−${formatAmount(reduction)}`,
        }
      : null,
    total: {
      label: reduction > 0 ? 'ATT BETALA EFTER AVDRAG' : totalLabel,
      // Reserven gäller bara dokument utan avdrag — se kastet ovan.
      value: `${formatAmount(offer.TotalToPay ?? offer.Total)} ${currency}`,
    },
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** Fälten som är gemensamma för alla tre dokumenten. */
type SharedPdfDesignInput = {
  company: FortnoxCompanySettingsResponse;
  /**
   * Kundens momsregistreringsnummer. Står på kundraden i mallen men finns INTE på dokumentsvaret —
   * anroparen får hämta det (Fortnox kundpost eller `crm_customers.vat_number`). Saknas det skrivs
   * bara kundnumret; ett påhittat momsnummer på ett kunddokument vore värre än inget.
   */
  customerVatNumber?: string | null;
  /**
   * De som söker ROT-avdraget, ur CRM:s `rot_details` — se `rotApplicantLines` för varför Fortnox
   * `/taxreductions` inte duger.
   */
  rotApplicants?: RotApplicant[];
  logo?: Uint8Array | null;
  fonts?: { regular: Uint8Array; bold: Uint8Array } | null;
};

/** De råa ROT-uppgifterna en anropare har. Löses av `resolveRotApplicants`, inte av anroparen. */
export type RotApplicantSources = {
  rotDetails?: { applicant_name?: string | null; personal_number?: string | null } | null;
  /** `crm_customers.personal_number` — se `resolveCustomerPersonalNumber`. KORTET vinner. */
  cardPersonalNumber?: string | null;
  /** Dokumentets `customer_snapshot.personal_number`. */
  snapshotPersonalNumber?: string | null;
};

export type OfferPdfDesignInput = SharedPdfDesignInput & RotApplicantSources & {
  offer: FortnoxOfferResponse;
};

export type DocumentPdfDesignInput = SharedPdfDesignInput & {
  variant: DocumentVariant;
  header: DesignDocumentHeader;
  rows: DesignDocumentRow[];
  /**
   * Fastighetsbeteckningen när den INTE ligger som textrad i dokumentet.
   *
   * På en villaorder bär Fortnox-huvudets referensnummer beteckningen i stället för radlistan (se
   * `resolveRotReference`) — då finns ingen rad att lyfta, och utan det här fältet hade
   * ROT-blocket saknat den uppgift som avdraget vilar på. Offerten skickar aldrig fältet: där
   * ligger beteckningen alltid som textrad och plockas ur raderna.
   */
  rotPropertyNote?: string | null;
};

type Fonts = { regular: PDFFont; bold: PDFFont };

/**
 * Offerten — samma dokument som förut, uttryckt som en variant.
 *
 * Datumfälten och radlistan heter olika saker på offert och order, så mappningen sitter här och
 * inte i renderaren.
 */
export function offerVariant(offer: FortnoxOfferResponse): DocumentVariant {
  return {
    kind: 'offer',
    title: 'OFFERT',
    meta: [
      ['Offertnr', offer.DocumentNumber ?? ''],
      ['Offertdatum', offer.OfferDate ?? ''],
      ['Giltig t.o.m.', offer.ExpireDate ?? ''],
    ],
    references: [
      ['Er referens', offer.YourReference ?? ''],
      ['Ert referensnr', offer.YourReferenceNumber ?? ''],
      ['Vår referens', offer.OurReference ?? ''],
      ['Betalningsvillkor', offer.TermsOfPayment ? `${offer.TermsOfPayment} dagar` : ''],
      ['Dröjsmålsränta', LATE_INTEREST],
    ],
    totalLabel: 'TOTALT OFFERTVÄRDE',
    showPrices: true,
    showRot: true,
  };
}

export function renderOfferPdfDesign(input: OfferPdfDesignInput): Promise<Uint8Array> {
  const { offer, rotDetails, cardPersonalNumber, snapshotPersonalNumber, ...shared } = input;
  return renderDocumentPdfDesign({
    ...shared,
    variant: offerVariant(offer),
    header: offer,
    rows: Array.isArray(offer.OfferRows) ? offer.OfferRows : [],
    // Regeln bor i `resolveRotApplicants` och tillämpas HÄR, inte hos anroparen — så att
    // offertens och orderns vägar bevisligen delar den. Att bygga listan i `offers.ts` var precis
    // den sömmen där den ursprungliga buggen kunde gömma sig från testerna.
    rotApplicants: resolveRotApplicants({
      rotDetails,
      cardPersonalNumber,
      snapshotPersonalNumber,
      customerName: offer.CustomerName,
    }),
  });
}

export async function renderDocumentPdfDesign(input: DocumentPdfDesignInput): Promise<Uint8Array> {
  const { variant, header, company } = input;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const fontBytes = input.fonts ?? (await loadDesignFonts());
  const fonts: Fonts = {
    // `subset: true` bäddar bara in de tecken dokumentet faktiskt använder. Utan den växer varje
    // dokument med ~260 kB inbäddad Open Sans.
    regular: await doc.embedFont(fontBytes.regular, { subset: true }),
    bold: await doc.embedFont(fontBytes.bold, { subset: true }),
  };

  // Logotypen hämtas från disk när anroparen inte skickar in den — precis som typsnitten. Gjorde
  // den inte det blev dokumentet utan logotyp så fort någon anropade renderaren utan att veta att
  // just det fältet måste fyllas i, vilket är exakt vad som hände vid inkopplingen.
  // `null` betyder uttryckligen "ingen logotyp"; `undefined` betyder "hämta den åt mig".
  const logoBytes = input.logo === undefined ? await loadDesignLogo() : input.logo;
  let logo: PDFImage | null = null;
  if (logoBytes) {
    try {
      logo = await doc.embedPng(logoBytes);
    } catch (e) {
      // Hellre ett dokument utan logotyp än inget dokument alls — men tyst får det inte vara,
      // annars går en trasig fil obemärkt ut på varje offert och order.
      console.warn('[dokument-pdf] logotypen kunde inte bäddas in:', e instanceof Error ? e.message : e);
      logo = null;
    }
  }

  const allRows = input.rows;
  // Fastighetsbeteckningen plockas ur radlistan INNAN grupperingen, annars fastnar den som
  // beskrivning på sista artikeln.
  //
  // ⚠️ Bara på ett ROT-dokument som visar ROT. Raden kan ligga kvar efter att ROT tagits bort i
  // Fortnox — den glidningen varnar `offers.ts` redan för — och då finns inget ROT-block att lyfta
  // den till. Lyfte vi den ändå hade den försvunnit helt, eller gett en ensam "ROT-AVDRAG"-rubrik
  // på ett dokument utan avdrag. Är dokumentet inte ROT får raden vara kvar som den vanliga textrad
  // den är. Följesedeln (`showRot: false`) visar den av samma skäl som en vanlig textrad.
  const isRot = variant.showRot && isRotDocument(header);
  const { note: rowPropertyNote, rows } = isRot
    ? extractRotPropertyNote(allRows)
    : { note: null, rows: allRows };
  // Beteckningen kommer antingen ur raderna (offert, BRF-order) eller ur anroparen (villaorder,
  // där den bor i huvudets referensnummer). Aldrig ur båda — se `resolveRotReference`.
  const propertyNote = rowPropertyNote ?? (isRot ? input.rotPropertyNote ?? null : null);
  const applicants = isRot ? rotApplicantLines(input.rotApplicants ?? []) : [];
  const groups = groupDocumentRows(rows);
  const summary = variant.showPrices
    ? buildSummaryBlock(header, rows, header.Currency || 'SEK', variant.totalLabel)
    : null;
  const showDiscount = variant.showPrices && rows.some((row) => formatDiscount(row) !== '');
  const pages: PDFPage[] = [];

  const newPage = (): { page: PDFPage; y: number } => {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    // Sidorna är identiska: hela huvudet upprepas, inte bara en förkortad topp (William 2026-09-03).
    const headTop = drawPageChrome(page, fonts, variant, header, input.customerVatNumber, logo, applicants, propertyNote);
    // Foten hör till VARJE sida, inte bara den sista. William 2026-09-03: sidorna är identiska så
    // när som på priset. Ritades den bara sist saknade sida ett både företagsuppgifter och
    // avgränsande linje, medan ytan ändå reserverades.
    drawFooter(page, fonts, company);
    return { page, y: drawTableHead(page, fonts, headTop, variant, showDiscount) };
  };

  // Raderna stannar ovanför summeringen på VARJE sida, inte bara den sista.
  //
  // Alternativet — låta raderna fylla sidan och skjuta summeringen till en egen sida — ger samma
  // sidantal men en sista sida som är tom sånär som på totalbeloppet. Uppmätt: 40 rader blev
  // 20 + 20 + enbart summering. Med reservationen blir det 18 + 18 + 4 rader OCH summeringen, vilket
  // är det dokument en kund förväntar sig. Priset är ett par raders kapacitet per sida.
  //
  // Följesedeln har ingen summering och får därför använda ytan ned till fotens linje.
  const summaryTop = summary
    ? SUM_ROW_Y + Math.max(summary.rows.length + (summary.deduction ? 1 : 0) - 1, 0) * SUM_ROW_STEP
    : FOOTER_RULE_Y;
  const rowFloor = summaryTop + ROW_SUMMARY_GAP;

  let { page, y } = newPage();
  let drawnOnPage = 0;

  for (const group of groups) {
    const noteLines = group.notes.flatMap((note) => wrapLines(note, fonts.regular, 7.5, COL_NAME_W));
    const nameLines = group.row
      ? wrapLines(group.row.Description ?? '', fonts.regular, 8, COL_NAME_W)
      : [];
    const height = groupHeight(Boolean(group.row), nameLines.length, noteLines.length);

    // Sidbryt bara om sidan redan bär en rad. En ensam grupp som är högre än hela textytan (mycket
    // lång ombruten benämning) skulle annars begära ny sida i all oändlighet.
    if (drawnOnPage > 0 && y - height < rowFloor) {
      ({ page, y } = newPage());
      drawnOnPage = 0;
    }
    y = drawRowGroup(page, fonts, group, nameLines, noteLines, y, variant.showPrices);
    drawnOnPage++;
  }

  if (summary) {
    drawSummary(page, fonts, summary);
    if (summary.deduction) drawRotClause(page, fonts);
  }

  // Sidnumret kan sättas först när vi vet hur många sidor det blev, och utelämnas på ett ensidigt
  // dokument — "Sida 1 av 1" ser mest ut som ett misstag. Mallen har inget sidnummer alls.
  if (pages.length > 1) {
    for (const [i, p] of pages.entries()) {
      drawCentered(p, `Sida ${i + 1} av ${pages.length}`, PAGE_W / 2, PAGE_NUMBER_Y, fonts.regular, 8, MUTED);
    }
  }

  return doc.save();
}

/**
 * Höjden en radgrupp upptar, från sin baslinje till nästa grupps baslinje.
 *
 * MÅSTE följa `drawRowGroup` steg för steg — sidbrytningen mäter med den här och ritar med den
 * andra. Glider de isär bryter sidan på fel ställe och sista raden hamnar under foten.
 */
export function groupHeight(hasRow: boolean, nameLines: number, noteLines: number): number {
  const nameExtra = hasRow ? Math.max(nameLines - 1, 0) * ROW_NOTE_STEP : 0;
  // Anmärkningen hänger under sin artikel. Utan artikel ÄR den radens första text och ska inte
  // först knuffas ned ett radsteg.
  const noteOffset = noteLines > 0 && hasRow ? ROW_NOTE_GAP : 0;
  const noteExtra = noteLines > 0 ? (noteLines - 1) * ROW_NOTE_STEP : 0;
  const ruleGap = noteLines > 0 ? ROW_RULE_GAP_NOTE : ROW_RULE_GAP;
  return nameExtra + noteOffset + noteExtra + ruleGap + ROW_NEXT_GAP;
}

// ── Ritfunktioner ────────────────────────────────────────────────────────────

function draw(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color = INK) {
  page.drawText(cleanText(text), { x, y, size, font, color });
}

function drawRight(page: PDFPage, text: string, xRight: number, y: number, font: PDFFont, size: number, color = INK) {
  const safe = cleanText(text);
  page.drawText(safe, { x: xRight - font.widthOfTextAtSize(safe, size), y, size, font, color });
}

function drawCentered(page: PDFPage, text: string, xCenter: number, y: number, font: PDFFont, size: number, color = INK) {
  const safe = cleanText(text);
  page.drawText(safe, { x: xCenter - font.widthOfTextAtSize(safe, size) / 2, y, size, font, color });
}

/**
 * Linjen är en 0,6 pt hög yta CENTRERAD på `y`, inte en som börjar där.
 *
 * Så ritar Figma dem (uppmätt: radlinjen på y=554 ligger 553,7→554,3), och skillnaden är inte
 * kosmetisk — ritas de från `y` och uppåt hamnar varje linje i dokumentet en halv punkt fel mot
 * mallen, vilket syns som ojämn luft under raderna.
 */
function drawRule(page: PDFPage, x0: number, x1: number, y: number) {
  page.drawRectangle({ x: x0, y: y - 0.3, width: x1 - x0, height: 0.6, color: RULE });
}

/** Logotyp, titel, dokumentmeta, kund- och uppdragsblock. Returnerar blockens nedersta baslinje. */
function drawPageChrome(
  page: PDFPage,
  fonts: Fonts,
  variant: DocumentVariant,
  offer: DesignDocumentHeader,
  customerVatNumber: string | null | undefined,
  logo: PDFImage | null,
  applicants: string[],
  propertyNote: string | null,
): number {
  if (logo) {
    const height = (logo.height / logo.width) * LOGO_W;
    page.drawImage(logo, { x: LOGO_X, y: LOGO_TOP - height, width: LOGO_W, height });
  }
  draw(page, TAGLINE, HEAD_LEFT_X, TAGLINE_Y, fonts.bold, 10, GREEN);

  // Teckenavståndet är ett texttillstånd som lever kvar tills det nollställs — pdf-lib skriver
  // aldrig ut Tc självt, så det MÅSTE återställas efter rubriken. Annars ärver hela resten av
  // sidan spärrningen.
  //
  // Rubriken står på mallens x=341 och KLÄMS bara om den inte ryms. Uppmätt i Open Sans Bold 18 pt
  // med spärrningen: OFFERT 75,5 pt (slutar på 416,5), FÖLJESEDEL 120,2 och ORDERBEKRÄFTELSE
  // 207,5 — den sista slutar på 548,5 mot högermarginalen 550. Den ryms alltså, med 1,5 pt över.
  // Klämman finns för nästa rubrik: utan den spiller en längre text tyst ut ur sidan i stället för
  // att flytta sig vänsterut. Offerten rör sig inte, den har 133 pt marginal.
  const titleWidth = fonts.bold.widthOfTextAtSize(cleanText(variant.title), 18)
    + Math.max(variant.title.length - 1, 0) * TITLE_TRACKING;
  page.pushOperators(setCharacterSpacing(TITLE_TRACKING));
  draw(page, variant.title, Math.min(TITLE_X, M_RIGHT - titleWidth), TITLE_Y, fonts.bold, 18, GREEN);
  page.pushOperators(setCharacterSpacing(0));
  for (const [i, [label, value]] of variant.meta.entries()) {
    draw(page, label, META_LABEL_X, META_Y[i], fonts.regular, 7.5, MUTED);
    drawRight(page, value, META_VALUE_R, META_Y[i], fonts.regular, 7.5, INK);
  }

  draw(page, 'KUND', HEAD_LEFT_X, SECTION_KUND_Y, fonts.regular, SECTION_SIZE, MUTED);
  draw(page, 'UPPDRAG', REF_LABEL_X, SECTION_UPPDRAG_Y, fonts.regular, SECTION_SIZE, MUTED);

  // ── Kund ──
  draw(page, offer.CustomerName ?? '', HEAD_LEFT_X, CUSTOMER_NAME_Y, fonts.regular, CUSTOMER_NAME_SIZE, GREEN);
  // Landet utelämnas med flit (William 2026-09-03: "sverige behöver inte stå, det räcker med numret").
  const address = [
    offer.Address1 ?? '',
    offer.Address2 ?? '',
    [offer.ZipCode, offer.City].filter(Boolean).join(' '),
  ].filter((line) => line.trim());

  let addressY = CUSTOMER_ADDRESS_Y;
  for (const line of address) {
    draw(page, line, HEAD_LEFT_X, addressY, fonts.regular, CUSTOMER_ADDRESS_SIZE, MUTED);
    addressY -= CUSTOMER_ADDRESS_STEP;
  }
  const lastAddressY = addressY + CUSTOMER_ADDRESS_STEP;

  const vat = (customerVatNumber ?? '').trim();
  const identity = [
    offer.CustomerNumber ? `Kundnr ${offer.CustomerNumber}` : '',
    vat ? `VAT ${vat}` : '',
  ].filter(Boolean).join(' · ');
  const identityY = lastAddressY - CUSTOMER_META_GAP;
  if (identity) draw(page, identity, HEAD_LEFT_X, identityY, fonts.regular, CUSTOMER_META_SIZE, MUTED);

  // ── Leveransadress ──
  let leftBottom = identity ? identityY : lastAddressY;
  const delivery = deliveryAddressLines(offer);
  if (delivery.length > 0) {
    let deliveryY = leftBottom - DELIVERY_LABEL_GAP;
    draw(page, 'LEVERANSADRESS', HEAD_LEFT_X, deliveryY, fonts.regular, SECTION_SIZE, MUTED);
    deliveryY -= DELIVERY_FIRST_GAP;
    for (const line of delivery) {
      draw(page, line, HEAD_LEFT_X, deliveryY, fonts.regular, CUSTOMER_ADDRESS_SIZE, MUTED);
      deliveryY -= DELIVERY_STEP;
    }
    leftBottom = deliveryY + DELIVERY_STEP;
  }

  // ── ROT ──
  // Sökandena och fastighetsbeteckningen samlas i ETT block sist i vänsterkolumnen, i samma
  // uppställning som KUND och LEVERANSADRESS. Personnumret hamnar därmed på samma ställe oavsett om
  // det är en sökande eller två — och fastighetsbeteckningen står bland ROT-uppgifterna i stället
  // för som en beskrivning av sista artikelraden, som den annars gör.
  const rotLines = [...applicants, ...(propertyNote ? [propertyNote] : [])];
  if (rotLines.length > 0) {
    let rotY = leftBottom - ROT_LABEL_GAP;
    draw(page, 'ROT-AVDRAG', HEAD_LEFT_X, rotY, fonts.regular, SECTION_SIZE, MUTED);
    rotY -= ROT_FIRST_GAP;
    for (const line of rotLines) {
      draw(page, line, HEAD_LEFT_X, rotY, fonts.regular, CUSTOMER_ADDRESS_SIZE, MUTED);
      rotY -= ROT_STEP;
    }
    leftBottom = rotY + ROT_STEP;
  }

  // ── Uppdrag ──
  // Värdena BRYTS om de är för breda. "Ert referensnr" bär fri text (kundens egen märkning) och
  // den är regelmässigt längre än kolumnen — i Figma-mallen sticker den ut 3,7 pt utanför
  // högermarginalen. Radbrytningen puttar ned raderna under sig i stället.
  let refY = REF_Y;
  for (const [label, value] of variant.references) {
    if (!value.trim()) continue;
    draw(page, label, REF_LABEL_X, refY, fonts.regular, REF_SIZE, MUTED);
    for (const line of wrapLines(value, fonts.regular, REF_SIZE, M_RIGHT - REF_VALUE_X)) {
      draw(page, line, REF_VALUE_X, refY, fonts.regular, REF_SIZE, INK);
      refY -= REF_STEP;
    }
  }

  return Math.min(leftBottom, refY + REF_STEP);
}

/**
 * Tabellens kolumnrubrik. Returnerar första radens baslinje.
 *
 * `showDiscount` avgörs EN gång för hela dokumentet, inte per sida — annars hade en rabatt som råkar
 * ligga på sida två gett sida ett en RABATT-rubrik utan innehåll, och sida två en kolumn som inte
 * fanns i huvudet innan.
 */
function drawTableHead(
  page: PDFPage,
  fonts: Fonts,
  blocksBottom: number,
  variant: DocumentVariant,
  showDiscount: boolean,
): number {
  const y = Math.min(TABLE_HEAD_Y, blocksBottom - TABLE_HEAD_GAP);
  draw(page, 'ARTIKEL NUMMER', COL_ARTNR, y, fonts.regular, 7, GREEN_TABLE);
  draw(page, 'BENÄMNING', COL_NAME, y, fonts.regular, 7, GREEN_TABLE);
  drawRight(page, 'ANTAL', COL_QTY_R, y, fonts.regular, 7, GREEN_TABLE);
  draw(page, 'ENHET', COL_UNIT, y, fonts.regular, 7, GREEN_TABLE);
  // Priskolumnerna står kvar på sina uppmätta lägen även när de utgår — benämningen breddas INTE
  // på följesedeln. Kolumnerna är desamma på alla tre dokumenten, så en följesedel och en
  // orderbekräftelse av samma order går att lägga bredvid varandra och läsa rad för rad.
  if (variant.showPrices) {
    drawRight(page, 'À-PRIS', COL_PRICE_R, y, fonts.regular, 7, GREEN_TABLE);
    if (showDiscount) drawRight(page, 'RABATT', COL_DISCOUNT_R, y, fonts.regular, 7, GREEN_TABLE);
    drawRight(page, 'SUMMA', COL_SUM_R, y, fonts.regular, 7, GREEN_TABLE);
  }
  return y - ROW_FIRST_GAP;
}

/** En artikelrad med sina anmärkningsrader och skiljelinjen under. Returnerar nästa baslinje. */
function drawRowGroup(
  page: PDFPage,
  fonts: Fonts,
  group: DocumentRowGroup,
  nameLines: string[],
  noteLines: string[],
  top: number,
  showPrices: boolean,
): number {
  const row = group.row;
  let y = top;

  if (row) {
    if (row.ArticleNumber) draw(page, row.ArticleNumber, COL_ARTNR, y, fonts.regular, 8, MUTED);
    for (const [i, line] of nameLines.entries()) {
      draw(page, line, COL_NAME, y - i * ROW_NOTE_STEP, fonts.regular, 8, GREEN);
    }
    drawRight(page, formatQuantity(row.Quantity), COL_QTY_R, y, fonts.regular, 8, INK);
    if (row.Unit) draw(page, row.Unit, COL_UNIT, y, fonts.regular, 8, INK);
    if (showPrices) {
      drawRight(page, formatAmount(row.Price), COL_PRICE_R, y, fonts.regular, 8, INK);
      const discount = formatDiscount(row);
      if (discount) drawRight(page, discount, COL_DISCOUNT_R, y, fonts.regular, 8, INK);
      // Total från Fortnox är REDAN rabatterad — rabattkolumnen är upplysning, inte en uträkning.
      drawRight(page, formatAmount(row.Total), COL_SUM_R, y, fonts.regular, 8, INK);
    }
    y -= Math.max(nameLines.length - 1, 0) * ROW_NOTE_STEP;
  }

  if (noteLines.length > 0) {
    if (row) y -= ROW_NOTE_GAP;
    for (const [i, line] of noteLines.entries()) {
      draw(page, line, COL_NAME, y - i * ROW_NOTE_STEP, fonts.regular, 7.5, MUTED);
    }
    y -= (noteLines.length - 1) * ROW_NOTE_STEP + ROW_RULE_GAP_NOTE;
  } else {
    y -= ROW_RULE_GAP;
  }

  drawRule(page, M_LEFT, M_RIGHT, y);
  return y - ROW_NEXT_GAP;
}

/** Summeringen: raderna, avdraget under sin linje, och den gröna totalrutan. */
function drawSummary(page: PDFPage, fonts: Fonts, summary: SummaryBlock) {
  const lines = [...summary.rows, ...(summary.deduction ? [summary.deduction] : [])];
  // Nedersta raden ligger på SUM_ROW_Y och resten staplas uppåt, så rutan aldrig flyttar sig.
  for (const [i, line] of lines.entries()) {
    const y = SUM_ROW_Y + (lines.length - 1 - i) * SUM_ROW_STEP;
    draw(page, line.label, SUM_LABEL_X, y, fonts.regular, 10, MUTED);
    drawRight(page, line.value, SUM_VALUE_R, y, fonts.regular, 10, INK);
  }

  if (summary.deduction) drawRule(page, SUM_BOX_X0, SUM_BOX_X1, SUM_ROW_Y + SUM_DEDUCTION_RULE_GAP);

  page.drawRectangle({
    x: SUM_BOX_X0,
    y: SUM_BOX_Y0,
    width: SUM_BOX_X1 - SUM_BOX_X0,
    height: SUM_BOX_Y1 - SUM_BOX_Y0,
    color: BOX,
  });
  drawRule(page, SUM_BOX_X0, SUM_BOX_X1, SUM_BOX_Y1);
  draw(page, summary.total.label, SUM_TOTAL_LABEL_X, SUM_TOTAL_LABEL_Y, fonts.regular, 9, GREEN);
  drawRight(page, summary.total.value, SUM_TOTAL_VALUE_R, SUM_TOTAL_VALUE_Y, fonts.bold, 15.75, GREEN);
}

/**
 * ROT-förbehållet, i den tomma ytan till vänster om summeringen.
 *
 * Det är ett villkor för priset — avslår Skatteverket begäran fakturerar vi mellanskillnaden — så
 * det hör hemma bredvid beloppet det gäller, inte nedtryckt bland det finstilta.
 *
 * Blocket räknas NEDIFRÅN: sista raden landar strax ovanför fotens linje och resten staplas uppåt.
 * Därmed står texten i höjd med totalbeloppet vare sig den bryts till två eller tre rader.
 */
function drawRotClause(page: PDFPage, fonts: Fonts) {
  const width = SUM_BOX_X0 - 20 - CLAUSE_X;
  const lines = wrapLines(ROT_CLAUSE, fonts.regular, CLAUSE_SIZE, width);
  let y = CLAUSE_LAST_BASELINE + (lines.length - 1) * CLAUSE_STEP;
  for (const line of lines) {
    draw(page, line, CLAUSE_X, y, fonts.regular, CLAUSE_SIZE, MUTED);
    y -= CLAUSE_STEP;
  }
}

/** Företagsfoten — fyra kolumner à tre rader, utan etiketter. */
function drawFooter(page: PDFPage, fonts: Fonts, company: FortnoxCompanySettingsResponse) {
  drawRule(page, M_LEFT, M_RIGHT, FOOTER_RULE_Y);

  // Etiketten MÅSTE följa värdet som faktiskt valdes: ett plusgironummer efter ordet "Bankgiro" är
  // en betalningsuppgift som ser auktoritativ ut och är fel kontotyp.
  const giro = company.BG ? `Bankgiro ${company.BG}` : company.PG ? `Plusgiro ${company.PG}` : '';
  const columns: string[][] = [
    [company.Name ?? '', company.Address ?? '', [company.ZipCode, company.City].filter(Boolean).join(' ')],
    [company.Phone1 ?? '', company.Email ?? '', company.WWW ?? ''],
    [giro, company.IBAN ? `IBAN ${company.IBAN}` : '', company.BIC ? `BIC ${company.BIC}` : ''],
    [
      company.OrganizationNumber ? `Org.nr ${company.OrganizationNumber}` : '',
      company.VATNumber ? `Momsreg.nr ${company.VATNumber}` : '',
      'Godkänd för F-skatt',
    ],
  ];

  for (const [c, rows] of columns.entries()) {
    for (const [r, value] of rows.entries()) {
      if (!value.trim()) continue;
      // Företagsnamnet är fotens rubrik och bär den gröna färgen; resten är brödtext.
      draw(page, value, FOOTER_X[c], FOOTER_Y[r], fonts.regular, 8, c === 0 && r === 0 ? GREEN : MUTED);
    }
  }
}

// ── Filer ────────────────────────────────────────────────────────────────────

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
    throw new Error(
      `Kunde inte läsa typsnitten i ${FONT_DIR}: ${e instanceof Error ? e.message : e}. ` +
      'Ligger filen under public/ måste den listas i outputFileTracingIncludes (next.config.js), ' +
      'annars saknas den i serverfunktionen trots att den finns i repot.',
    );
  }
}

/** Logotypen är valfri: saknas filen ritas offerten ändå. */
export async function loadDesignLogo(): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(LOGO_PATH));
  } catch {
    return null;
  }
}

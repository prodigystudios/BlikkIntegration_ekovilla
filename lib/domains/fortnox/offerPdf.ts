// Egen rendering av offertens PDF. Börjar med ROT — men är avsedd att växa till att gälla allt.
//
// VARFÖR DEN KOM TILL NU. Fortnox utskriftsmall renderar inte skattereduktionen på en offert som
// skapats via API:t. Dokumentet blir en vanlig offert: ingen "Preliminär skattereduktion", ingen
// Skattered.-kolumn i foten, fel offertvärde. Öppnar man offerten i Fortnox och sparar om den i
// husarbete-fliken kommer rätt utskrift tillbaka — så räddades ROT-offerterna manuellt medan kunder
// väntade. Fortnox har bekräftat felet på sin sida (de får samma svar via API:t) och har ingen
// tidplan, så ROT kunde inte vänta.
//
// VART DET BÄR. Planen är att sluta använda Fortnox utskriftsmall helt och köra en egen offert-PDF
// med egen formgivning. Den designen är inte klar än, vilket är hela skälet till att Fortnox mall
// använts hittills. Det här är alltså inte en tillfällighet som ska raderas när Fortnox lagat sig —
// det är första biten av den egna PDF:en, tagen i drift tidigt för att ROT brann.
//
// DÄRFÖR: skilj på de två halvorna när du ändrar här.
//   • Datahämtningen och inkopplingen i routen är DEN BESTÅENDE delen. Den bär vidare oförändrad
//     när formgivningen byts.
//   • Layouten nedan är MEDVETET en kopia av Fortnox mall, så mottagaren inte ser att dokumentet
//     bytt avsändare mitt i en pågående offertdialog. Den är avsedd att ersättas av den nya
//     designen — lägg ingen möda på att förfina den här.
//
// SIFFRORNA ÄGS AV FORTNOX. Vi räknar ingenting om. Beloppen läses ur `GET /offers/{nr}` (`Net`,
// `TotalVAT`, `RoundOff`, `Total`, `TotalToPay`, `TaxReduction`), personen bakom avdraget ur
// `GET /taxreductions` och foten ur `GET /settings/company`. Det är poängen: fakturan skapas sedan
// av Fortnox ur samma underlag, så en offert vi ritat själva kan inte visa ett annat belopp än det
// som faktureras. Den regeln ska överleva designbytet — behåll Fortnox som beloppens källa.
//
// Orderbekräftelsen är inte med än. Byggstenarna här räcker till den när den ska in.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

// Läget och beslutet bor i offerPdfMode.ts — en modul UTAN pdf-lib, så offers.ts kan läsa dem
// utan att dra in PDF-motorn på offertsparningens kallstart. Re-exporteras här för anropare som
// ändå har renderaren laddad.
export { OFFER_PDF_MODE, mayRenderLocally, shouldRenderLocally, type OfferPdfMode } from './offerPdfMode';

/**
 * Bär dokumentet ett ROT-avdrag? Styr det som BARA hör hemma på ett ROT-dokument: förbehållet om
 * Skatteverket och Skattered.-kolumnen i summaraden. Viktigt när OFFER_PDF_MODE går till 'all' och
 * renderaren även möter vanliga företagsoffer.
 */
export function isRotDocument(offer: Pick<FortnoxOfferResponse, 'TaxReductionType' | 'TaxReduction'>): boolean {
  return offer.TaxReductionType === 'rot' && Number(offer.TaxReduction ?? 0) > 0;
}

// ── Fortnox-svarens form (bara fälten vi ritar) ──────────────────────────────

export type FortnoxOfferRowResponse = {
  ArticleNumber?: string | null;
  Description?: string | null;
  Quantity?: string | number | null;
  Unit?: string | null;
  Price?: number | null;
  Discount?: number | null;
  DiscountType?: string | null;
  Total?: number | null;
  VAT?: number | null;
};

export type FortnoxOfferResponse = {
  DocumentNumber?: string | null;
  OfferDate?: string | null;
  ExpireDate?: string | null;
  CustomerNumber?: string | null;
  CustomerName?: string | null;
  Address1?: string | null;
  Address2?: string | null;
  ZipCode?: string | null;
  City?: string | null;
  DeliveryAddress1?: string | null;
  DeliveryZipCode?: string | null;
  DeliveryCity?: string | null;
  OurReference?: string | null;
  YourReference?: string | null;
  YourReferenceNumber?: string | null;
  TermsOfPayment?: string | null;
  Currency?: string | null;
  Net?: number | null;
  TotalVAT?: number | null;
  RoundOff?: number | null;
  Total?: number | null;
  TotalToPay?: number | null;
  TaxReduction?: number | null;
  TaxReductionType?: string | null;
  OfferRows?: FortnoxOfferRowResponse[] | null;
};

export type FortnoxTaxReductionResponse = {
  CustomerName?: string | null;
  SocialSecurityNumber?: string | null;
  // Behövs för att kunna bevisa att posten hör till DET HÄR dokumentet — se belongsToOffer.
  ReferenceDocumentType?: string | null;
  ReferenceNumber?: number | string | null;
};

/**
 * Hör skattereduktionsposten till just den här offerten?
 *
 * `/taxreductions?filter=offers&referencenumber=N` filtrerar på serverns sida, men Fortnox numrerar
 * offerter, ordrar och fakturor i SKILDA serier — faktura 10008 och offert 10008 finns samtidigt i
 * det här bolaget. Skulle filtret tolkas fel eller ignoreras får vi tillbaka en annan kunds post,
 * och då trycks främmande namn OCH fullständigt personnummer på en offert som mejlas ut. Vi
 * kontrollerar därför i efterhand i stället för att lita på frågan.
 */
export function belongsToOffer(entry: FortnoxTaxReductionResponse, offerNumber: string): boolean {
  const type = (entry.ReferenceDocumentType ?? '').toUpperCase();
  if (type !== 'OFFER') return false;
  return String(entry.ReferenceNumber ?? '') === String(offerNumber);
}

export type FortnoxCompanySettingsResponse = {
  Name?: string | null;
  Address?: string | null;
  ZipCode?: string | null;
  City?: string | null;
  Country?: string | null;
  Phone1?: string | null;
  Email?: string | null;
  WWW?: string | null;
  BG?: string | null;
  PG?: string | null;
  IBAN?: string | null;
  BIC?: string | null;
  OrganizationNumber?: string | null;
  VATNumber?: string | null;
  Domicile?: string | null;
};

// ── Texter som INTE finns i Fortnox API ──────────────────────────────────────
//
// Fortnox exponerar inte utskriftsmallens fasta texter, så de måste bo här. Det är den enda
// verkliga dubbleringen i lösningen: ändrar någon texten i Fortnox ändras den inte här.
//
// ⚠️ Texten nedan speglar FORTNOX offertmall, inte kalkylatorns PDF. De är LIKA MEN INTE LIKA:
// `STANDARD_TEXT` i app/api/pdf/offert-kalkylator/[id]/route.ts inleds med ett fjärde stycke
// ("Betalningsvillkor: 10 dagar, alternativt finansiering via vår bankpartner SVEA BANK.") som
// Fortnox offert INTE har — betalningsvillkoret står där i referensblocket i stället. Kopiera
// alltså inte den ena till den andra utan att jämföra mot en riktig rendering; det här dokumentet
// ska vara omöjligt att skilja från den Fortnox-offert det ersätter.

const SALES_TEXT = [
  'Vi tackar för förtroendet och har härmed nöjet att offerera er följande lösullsentreprenad.',
  'EKOVILLA är Nordens största tillverkare och installatör av lösullsisolering och vår isolering har marknadens bästa tekniska egenskaper. Cellulosaisolering ger upp till 10dB bättre ljudisolering och har högre värmelagringskapacitet jämfört med mineralullsisolering. Materialet är CO2-negativt vilket betyder att det lagrar mer CO2 än det släpper ut vid tillverkning och installation. Lambdavärde mellan 0,035-0,038 W/mK beroende på konstruktion. Bästa brandklass för organiska byggmaterial Bs2,d0. Vi är medlemmar i Byggföretagen och följer kollektivavtal. Vi är också medlemmar i branschorganisationen Isolerarna och certifierade enligt vårt gemensamma kvalitetssystem Behörig Lösull.',
  'Garantier: Livstidsgaranti på isoleringsmaterialets tekniska egenskaper samt mot sättningar i slutna konstruktioner. 10 års garanti på utförandet.',
];

/** ROT-förbehållet. Står på varje ROT-offert Fortnox renderar. */
const ROT_CLAUSE =
  'Vi förbehåller oss rätten att fakturera återstående belopp, motsvarande skattereduktionen, om begäran från Skatteverket avslås.';

/** Fortnox visar dröjsmålsräntan i huvudet men returnerar den inte på offerten. */
const LATE_INTEREST = '8%';

const LOGO_PATH = path.join(process.cwd(), 'public', 'brand', 'Ekovilla_logo_Header.png');

// ── Rena hjälpare (enhetstestade) ────────────────────────────────────────────

/**
 * pdf-lib:s standardfonter kodar WinAnsi. Tecken utanför det intervallet får `drawText` att KASTA,
 * vilket skulle göra en offert med ett typografiskt citattecken till ett 500-svar. Vi översätter de
 * vanliga (tankstreck, typografiska citattecken, minustecken) och släpper resten hellre än att låta
 * dokumentet dö. `m²` och `å ä ö` ligger inom WinAnsi och överlever.
 */
export function pdfSafe(input: unknown): string {
  return String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/•/g, '*')
    .replace(/ /g, ' ')
    .replace(/…/g, '...')
    // Kvarvarande tecken utanför WinAnsi tas bort hellre än att kasta. Radbrytningen MÅSTE
    // undantas: wrapText delar på \n för att bevara avsiktliga brytningar, och tas tecknet
    // bort här klistras raderna ihop ("Rad ettRad två") i stället för att brytas.
    .replace(/[^\n\x20-\x7E -ÿ]/g, '');
}

/** Svenskt belopp: mellanslag som tusentalsavskiljare, komma som decimaltecken, alltid två decimaler. */
export function formatAmount(value: number | null | undefined): string {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  const fixed = Math.abs(n).toFixed(2);
  const [whole, decimals] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '-' : ''}${grouped},${decimals}`;
}

/** Antal renderas som Fortnox gör: två decimaler ("20,79", "1,00"). */
export function formatQuantity(value: string | number | null | undefined): string {
  const n = Number(value);
  return formatAmount(Number.isFinite(n) ? n : 0);
}

/**
 * En textrad: bara `Description`, inga belopp. Så skickar vi mätning/Radtext/ROT-noten, och så
 * returnerar Fortnox dem (Quantity "0", Price 0, Total 0, utan artikelnummer). De ska renderas som
 * en kommentarrad under artikeln — utan siffror i antal-/pris-/summakolumnerna.
 */
export function isTextOnlyRow(row: FortnoxOfferRowResponse): boolean {
  if (row.ArticleNumber) return false;
  const qty = Number(row.Quantity ?? 0);
  const price = Number(row.Price ?? 0);
  const total = Number(row.Total ?? 0);
  return (!Number.isFinite(qty) || qty === 0) && price === 0 && total === 0;
}

/**
 * Vem avdraget avser. Fortnox skriver ut ett tomt parentespar när personnumret saknas
 * ("Kim Wolke ()"). Vi utelämnar parentesen i stället — samma uppgifter, utan en artefakt som ser
 * ut som en bugg för kunden. Personnumret krävs först när arbetsordern skapas.
 */
function taxReductionWho(entry: FortnoxTaxReductionResponse): string {
  const name = (entry.CustomerName ?? '').trim();
  const ssn = (entry.SocialSecurityNumber ?? '').trim();
  return ssn ? `${name} (${ssn})` : name;
}

/**
 * Raderna under "Preliminär skattereduktion".
 *
 * ⚠️ **Beloppet delas ALDRIG ut per person.** Fortnox `/taxreductions` returnerar ingen
 * per-person-summa på en offert (`ApprovedAmount` är null tills Skatteverket svarat), så en
 * uppdelning hade varit vår gissning — och att dela lika är fel så fort avdraget inte är jämnt
 * fördelat mellan de sökande. Att trycka en påhittad ROT-summa per person på ett kunddokument är
 * precis vad modulens huvudregel förbjuder: Fortnox äger beloppen.
 *
 * Därför: en sökande → namnet och hela beloppet på samma rad (så Fortnox mall gör). Flera sökande →
 * ett namn per rad och totalen för sig, utan att påstå vem som får vad.
 */
export function buildTaxReductionLines(
  entries: FortnoxTaxReductionResponse[],
  total: number | null | undefined,
  currency = 'SEK',
): string[] {
  if (entries.length === 0) return [];
  const amount = `${formatAmount(total)} ${currency}`;
  if (entries.length === 1) return [`${taxReductionWho(entries[0])} - ${amount}`];
  return [...entries.map(taxReductionWho), `Totalt - ${amount}`];
}

/** Momsunderlag per skattesats, för raden "Moms 25% 6 966,95 (27 867,80)". */
export function summarizeVat(rows: FortnoxOfferRowResponse[]): Array<{ rate: number; base: number; vat: number }> {
  const byRate = new Map<number, number>();
  for (const row of rows) {
    if (isTextOnlyRow(row)) continue;
    const rate = Number(row.VAT ?? 0);
    const total = Number(row.Total ?? 0);
    if (!Number.isFinite(rate) || !Number.isFinite(total)) continue;
    byRate.set(rate, (byRate.get(rate) ?? 0) + total);
  }
  return [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, base]) => ({ rate, base, vat: Math.round(base * rate) / 100 }));
}

// ── Layout ───────────────────────────────────────────────────────────────────

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M_LEFT = 48;
const M_RIGHT = 547;

// Kolumnernas ankare. Antal/À-pris/Summa är HÖGERSTÄLLDA på sina x-värden.
const COL_ARTNR = M_LEFT;
const COL_NAME = 112;
const COL_QTY_R = 352;
const COL_UNIT = 372;
const COL_PRICE_R = 470;
const COL_SUM_R = M_RIGHT;

// Höjden botten-blocket (summarad + företagsfot) upptar. Innehållet bryter till ny sida
// innan det når hit, så foten aldrig krockar med raderna.
const BOTTOM_BLOCK_H = 165;
const CONTENT_BOTTOM = BOTTOM_BLOCK_H + 20;
// Baslinjen säljtextens SISTA rad landar på när blocket trycks ned mot summaradens linje
// (som ligger på BOTTOM_BLOCK_H + 26). Ger några punkters luft mellan texten och linjen.
const TEXT_BLOCK_BOTTOM = BOTTOM_BLOCK_H + 42;

const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.35, 0.35, 0.38);
const RULE = rgb(0.72, 0.72, 0.75);

type Fonts = { regular: PDFFont; bold: PDFFont };

function drawText(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color = INK) {
  page.drawText(pdfSafe(text), { x, y, size, font, color });
}

function drawRight(page: PDFPage, text: string, xRight: number, y: number, font: PDFFont, size: number, color = INK) {
  const safe = pdfSafe(text);
  page.drawText(safe, { x: xRight - font.widthOfTextAtSize(safe, size), y, size, font, color });
}

/**
 * Var säljtextblocket ska börja: nedtryckt mot summaradens linje, som i Fortnox mall.
 *
 * Luften hör hemma MELLAN artiklarna och texten, inte som ett hål mellan texten och summan. Flöt
 * blocket fritt satt brödtexten klistrad under sista artikeln med ett stort tomrum under sig.
 *
 * ⚠️ Flyttar bara NEDÅT. Ryms blocket inte där nere (lång text, eller rader som redan ätit upp
 * sidan) behålls det fria flödet och sidbrytningen sköter resten — annars hade texten kunnat
 * skjutas upp ÖVER de artikelrader den ska stå under.
 */
export function anchorTextBlockStart(currentY: number, blockHeight: number, gap = 22): number {
  const anchored = TEXT_BLOCK_BOTTOM + blockHeight;
  return anchored < currentY - gap ? anchored : currentY - gap;
}

/** Bryter text till rader som ryms inom `maxWidth`. Bevarar avsiktliga radbrytningar. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of pdfSafe(text).split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

export type OfferPdfInput = {
  offer: FortnoxOfferResponse;
  taxReductions: FortnoxTaxReductionResponse[];
  company: FortnoxCompanySettingsResponse;
  logo?: Uint8Array | null;
};

/**
 * Ritar offerten. Följer Fortnox utskriftsmalls disposition (huvud, kund, referensblock, radtabell,
 * skattereduktion, säljtext, summarad, företagsfot) så mottagaren inte ser att dokumentet bytt
 * avsändare mitt i en offertdialog.
 */
export async function renderOfferPdf(input: OfferPdfInput): Promise<Uint8Array> {
  const { offer, taxReductions, company } = input;
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  let logo: PDFImage | null = null;
  if (input.logo) {
    try {
      logo = await doc.embedPng(input.logo);
    } catch {
      logo = null; // Hellre en offert utan logotyp än inget dokument alls.
    }
  }

  const rows = Array.isArray(offer.OfferRows) ? offer.OfferRows : [];
  const currency = offer.Currency || 'SEK';
  const pages: PDFPage[] = [];

  const newPage = (): PDFPage => {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    return page;
  };

  let page = newPage();
  let y = drawHeader(page, fonts, offer, logo);

  // ── Radtabell ──
  const tableHeader = (p: PDFPage, top: number): number => {
    drawText(p, 'Artnr', COL_ARTNR, top, fonts.regular, 8.5, MUTED);
    drawText(p, 'Benämning', COL_NAME, top, fonts.regular, 8.5, MUTED);
    drawRight(p, 'Antal', COL_QTY_R, top, fonts.regular, 8.5, MUTED);
    drawText(p, 'Enhet', COL_UNIT, top, fonts.regular, 8.5, MUTED);
    drawRight(p, 'À-pris', COL_PRICE_R, top, fonts.regular, 8.5, MUTED);
    drawRight(p, 'Summa', COL_SUM_R, top, fonts.regular, 8.5, MUTED);
    p.drawLine({ start: { x: M_LEFT, y: top - 5 }, end: { x: M_RIGHT, y: top - 5 }, thickness: 0.6, color: RULE });
    return top - 18;
  };

  y = tableHeader(page, y);

  // `withTableHeader` styr om den nya sidan ska inledas med radtabellens kolumnrubrik. Bara
  // radloopen vill ha den — bryter säljtexten till en ny sida ska den sidan INTE öppna med
  // "Artnr / Benämning / Antal …" följt av enbart brödtext, vilket avslöjar att dokumentet inte
  // kommer från Fortnox mall.
  const ensureSpace = (needed: number, withTableHeader = false) => {
    if (y - needed >= CONTENT_BOTTOM) return;
    page = newPage();
    y = drawHeader(page, fonts, offer, logo, true);
    if (withTableHeader) y = tableHeader(page, y);
  };

  for (const row of rows) {
    const isText = isTextOnlyRow(row);
    const nameLines = wrapText(row.Description ?? '', fonts.regular, 9, COL_QTY_R - COL_NAME - 14);
    // En rabatterad rad ritar en extra upplysningsrad under sig — reservera för den också, annars
    // kan "Rabatt X %" hamna ovanpå summaraden längst ned.
    const hasDiscountLine = !isText && Number(row.Discount ?? 0) > 0 && row.DiscountType === 'PERCENT';
    ensureSpace(nameLines.length * 12 + (hasDiscountLine ? 16 : 4), true);

    for (const [i, line] of nameLines.entries()) {
      drawText(page, line, COL_NAME, y - i * 12, fonts.regular, 9, isText ? MUTED : INK);
    }

    if (!isText) {
      if (row.ArticleNumber) drawText(page, row.ArticleNumber, COL_ARTNR, y, fonts.regular, 9);
      drawRight(page, formatQuantity(row.Quantity), COL_QTY_R, y, fonts.regular, 9);
      if (row.Unit) drawText(page, row.Unit, COL_UNIT, y, fonts.regular, 9);
      drawRight(page, formatAmount(row.Price), COL_PRICE_R, y, fonts.regular, 9);
      drawRight(page, formatAmount(row.Total), COL_SUM_R, y, fonts.regular, 9);
      // Rabatten står som egen upplysning; Total från Fortnox är redan rabatterad.
      if (hasDiscountLine) {
        y -= nameLines.length * 12;
        drawText(page, `Rabatt ${formatAmount(row.Discount)} %`, COL_NAME, y, fonts.regular, 8, MUTED);
        y -= 12;
        continue;
      }
    }
    y -= nameLines.length * 12 + 2;
  }

  // ── Preliminär skattereduktion ──
  const reductionLines = Number(offer.TaxReduction ?? 0) > 0
    ? buildTaxReductionLines(taxReductions, offer.TaxReduction, currency)
    : [];
  if (reductionLines.length > 0) {
    ensureSpace(24 + reductionLines.length * 12);
    y -= 12;
    drawText(page, 'Preliminär skattereduktion', COL_NAME, y, fonts.regular, 9);
    y -= 12;
    for (const line of reductionLines) {
      drawText(page, line, COL_NAME, y, fonts.regular, 9);
      y -= 12;
    }
  }

  // ── Säljtext + ROT-förbehåll ──
  //
  // Blocket TRYCKS NED mot summaradens linje i stället för att flyta direkt efter sista artikeln.
  // Så gör Fortnox mall: luften hamnar mellan raderna och texten, inte som ett tomrum mellan texten
  // och summan. Flöt den fritt satt brödtexten klistrad under sista artikeln med ett stort hål under.
  //
  // ROT-förbehållet BARA på ett ROT-dokument — det är ett avtalsvillkor om Skatteverket, och när
  // OFFER_PDF_MODE går till 'all' renderas även rena företagsoffer här. De ska inte bära en mening
  // om ett avdrag som aldrig varit inblandat.
  const salesBlocks = SALES_TEXT.map((p) => wrapText(p, fonts.regular, 8.5, M_RIGHT - M_LEFT));
  const clauseLines = isRotDocument(offer) ? wrapText(ROT_CLAUSE, fonts.regular, 8.5, M_RIGHT - M_LEFT) : [];

  const blockHeight =
    salesBlocks.reduce((h, lines) => h + lines.length * 11 + 6, 0) +
    (clauseLines.length ? 4 + clauseLines.length * 11 : 0);

  y = anchorTextBlockStart(y, blockHeight);

  for (const lines of salesBlocks) {
    ensureSpace(lines.length * 11 + 8);
    for (const line of lines) {
      drawText(page, line, M_LEFT, y, fonts.regular, 8.5);
      y -= 11;
    }
    y -= 6;
  }

  if (clauseLines.length) ensureSpace(clauseLines.length * 11 + 8);
  y -= 4;
  for (const line of clauseLines) {
    drawText(page, line, M_LEFT, y, fonts.regular, 8.5);
    y -= 11;
  }

  // ── Botten: summarad + företagsfot, alltid på sista sidan ──
  drawTotals(page, fonts, offer, currency, rows);
  drawCompanyFooter(page, fonts, company);

  // Sidnumren kan först sättas när vi vet hur många sidor det blev.
  for (const [i, p] of pages.entries()) {
    drawRight(p, `Sida ${i + 1}(${pages.length})`, M_RIGHT, PAGE_H - 34, fonts.regular, 8.5, MUTED);
  }

  return doc.save();
}

/** Huvud: logotyp, titel, datum/nummer, kund- och leveransadress, referensblock. Returnerar y för tabellen. */
function drawHeader(
  page: PDFPage,
  fonts: Fonts,
  offer: FortnoxOfferResponse,
  logo: PDFImage | null,
  continuation = false,
): number {
  const top = PAGE_H - 40;

  if (logo) {
    const scale = Math.min(180 / logo.width, 46 / logo.height);
    page.drawImage(logo, {
      x: M_LEFT,
      y: top - logo.height * scale + 6,
      width: logo.width * scale,
      height: logo.height * scale,
    });
  }

  drawText(page, 'Offert', 300, top - 16, fonts.bold, 17);
  drawText(page, 'Offertdatum', 400, top - 42, fonts.regular, 9, MUTED);
  drawText(page, offer.OfferDate ?? '', 480, top - 42, fonts.regular, 9);
  drawText(page, 'Offertnr', 400, top - 55, fonts.regular, 9, MUTED);
  drawText(page, offer.DocumentNumber ?? '', 480, top - 55, fonts.regular, 9);

  if (continuation) return top - 90;

  // Kundens adress (fakturaadress) till höger; leveransadressen till vänster när den skiljer sig.
  let cy = top - 92;
  const customerLines = [
    offer.CustomerName ?? '',
    offer.Address1 ?? '',
    offer.Address2 ?? '',
    [offer.ZipCode, offer.City].filter(Boolean).join(' '),
  ].filter((l) => l.trim());
  // Hela kundblocket är fett, inte bara namnet — så renderar Fortnox mall det (verifierat på
  // offert 25 och 10006, där även gata och postort står i fetstil).
  for (const line of customerLines) {
    drawText(page, line, 330, cy, fonts.bold, 9);
    cy -= 12;
  }
  cy += customerLines.length * 12;

  const delivery = (offer.DeliveryAddress1 ?? '').trim();
  const sameAsInvoice = delivery.toLowerCase() === (offer.Address1 ?? '').trim().toLowerCase();
  if (delivery && !sameAsInvoice) {
    const deliveryLines = [
      'Leveransadress',
      delivery,
      [offer.DeliveryZipCode, offer.DeliveryCity].filter(Boolean).join(' '),
    ].filter((l) => l.trim());
    for (const [i, line] of deliveryLines.entries()) {
      drawText(page, line, M_LEFT, cy - i * 12, fonts.regular, 9, i === 0 ? MUTED : INK);
    }
  }

  cy -= Math.max(customerLines.length, 3) * 12 + 44;

  // Referensblocket: två kolumner, etikett + värde.
  const left: Array<[string, string]> = [
    ['Kundnr', offer.CustomerNumber ?? ''],
    ['Er referens', offer.YourReference ?? ''],
    ['Ert referensnr', offer.YourReferenceNumber ?? ''],
  ];
  const right: Array<[string, string]> = [
    ['Vår referens', offer.OurReference ?? ''],
    ['Betalningsvillkor', offer.TermsOfPayment ? `${offer.TermsOfPayment} dagar` : ''],
    ['Giltig tom', offer.ExpireDate ?? ''],
    ['Dröjsmålsränta', LATE_INTEREST],
  ];

  let row = 0;
  for (const [label, value] of left) {
    if (!value) continue;
    drawText(page, label, M_LEFT, cy - row * 13, fonts.regular, 9, MUTED);
    drawText(page, value, 130, cy - row * 13, fonts.regular, 9);
    row++;
  }
  row = 0;
  for (const [label, value] of right) {
    if (!value) continue;
    drawText(page, label, 330, cy - row * 13, fonts.regular, 9, MUTED);
    drawText(page, value, 425, cy - row * 13, fonts.regular, 9);
    row++;
  }

  return cy - Math.max(left.filter(([, v]) => v).length, right.filter(([, v]) => v).length) * 13 - 18;
}

/** Summaraden. Öresavrundning visas bara när den finns — så gör Fortnox mall också. */
function drawTotals(
  page: PDFPage,
  fonts: Fonts,
  offer: FortnoxOfferResponse,
  currency: string,
  rows: FortnoxOfferRowResponse[],
) {
  const y = BOTTOM_BLOCK_H;
  page.drawLine({ start: { x: M_LEFT, y: y + 26 }, end: { x: M_RIGHT, y: y + 26 }, thickness: 0.6, color: RULE });

  const roundOff = Number(offer.RoundOff ?? 0);
  const cells: Array<{ label: string; value: string; bold?: boolean }> = [
    { label: 'Exkl. moms', value: formatAmount(offer.Net) },
    { label: 'Moms', value: formatAmount(offer.TotalVAT) },
    ...(roundOff !== 0 ? [{ label: 'Öresavr', value: formatAmount(roundOff) }] : []),
    { label: 'Totalt', value: formatAmount(offer.Total) },
    // Skattered. bara när det finns ett avdrag — annars får varje företagsoffert en "0,00"-kolumn
    // om skattereduktion när OFFER_PDF_MODE står på 'all'.
    ...(isRotDocument(offer) ? [{ label: 'Skattered.', value: formatAmount(offer.TaxReduction) }] : []),
  ];

  // Etiketterna fördelas jämnt från vänster; offertvärdet högerställs sist och är det kunden läser.
  const step = (M_RIGHT - 110 - M_LEFT) / cells.length;
  for (const [i, cell] of cells.entries()) {
    const x = M_LEFT + i * step;
    drawText(page, cell.label, x, y + 14, fonts.regular, 8.5, MUTED);
    drawText(page, cell.value, x, y, fonts.regular, 9);
  }
  drawRight(page, 'Offertvärde', M_RIGHT, y + 14, fonts.bold, 8.5);
  drawRight(page, `${currency} ${formatAmount(offer.TotalToPay)}`, M_RIGHT, y - 2, fonts.bold, 12);

  const vatLines = summarizeVat(rows)
    .map((v) => `Moms ${formatAmount(v.rate).replace(',00', '')}% ${formatAmount(v.vat)} (${formatAmount(v.base)})`)
    .join('   ');
  if (vatLines) {
    page.drawLine({ start: { x: M_LEFT, y: y - 12 }, end: { x: M_RIGHT, y: y - 12 }, thickness: 0.6, color: RULE });
    drawText(page, vatLines, M_LEFT, y - 24, fonts.regular, 8.5, MUTED);
  }
}

/** Företagsfoten — fyra kolumner, samma uppgifter Fortnox mall skriver ut. */
function drawCompanyFooter(page: PDFPage, fonts: Fonts, company: FortnoxCompanySettingsResponse) {
  const columns: Array<{ x: number; rows: Array<[string, string]> }> = [
    {
      x: M_LEFT,
      rows: [
        ['Adress', company.Name ?? ''],
        ['', company.Address ?? ''],
        ['', [company.ZipCode, company.City].filter(Boolean).join(' ')],
        ['', company.Country ?? ''],
      ],
    },
    {
      x: 205,
      rows: [
        ['Telefon', company.Phone1 ?? ''],
        ['E-post', company.Email ?? ''],
        ['Webbadress', company.WWW ?? ''],
      ],
    },
    {
      // Etiketten MÅSTE följa värdet som faktiskt valdes. Ett plusgironummer under rubriken
      // "Bankgiro" är en betalningsuppgift som ser auktoritativ ut och är fel kontotyp.
      x: 355,
      rows: [
        company.BG
          ? (['Bankgiro', company.BG] as [string, string])
          : (['Plusgiro', company.PG ?? ''] as [string, string]),
        ['Säte', company.Domicile ?? ''],
      ],
    },
    {
      x: 448,
      rows: [
        ['Organisationsnr', company.OrganizationNumber ?? ''],
        ['Momsreg. nr', company.VATNumber ?? ''],
        ['', 'Godkänd för F-skatt'],
      ],
    },
  ];

  const iban = [company.IBAN ? `IBAN ${company.IBAN}` : '', company.BIC ? `BIC ${company.BIC}` : '']
    .filter(Boolean)
    .join('  ');
  if (iban) drawRight(page, iban, M_RIGHT, 104, fonts.regular, 8);

  for (const column of columns) {
    let cy = 88;
    for (const [label, value] of column.rows) {
      if (!value) continue;
      if (label) {
        drawText(page, label, column.x, cy, fonts.regular, 7.5, MUTED);
        cy -= 10;
      }
      drawText(page, value, column.x, cy, fonts.regular, 8);
      cy -= 11;
    }
  }
}

/** Logotypen är valfri: saknas filen ritas offerten ändå. */
export async function loadLogo(): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(LOGO_PATH));
  } catch {
    return null;
  }
}

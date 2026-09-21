import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';

import { loadDesignFonts, loadDesignLogo } from '@/lib/pdf/brandAssets';
import { cleanText, wrapLines } from '@/lib/pdf/text';

import { periodLabel, periodRange } from './approvals';
import {
  COMPENSATION_LABELS,
  COMPENSATION_UNITS,
  formatQuantity,
  isReceiptMissing,
  summarizeCompensations,
  type CompensationItem,
} from './compensations';
import { minutesToHours } from './hours';
import { breakWasDeducted, reasonOrJobLabel, type DayRow, type PersonPeriodSummary } from './summary';

// Månadens timmar som PDF — en anställd per avsnitt, utskriven ur attesten (/ekonomi).
//
// VARFÖR DEN FINNS. Lönebyrån bad (2026-09-21) om "en pdf per anställd med månadens timmar". Fram
// tills nu har underlaget bara funnits på skärmen: hon fällde ut en person i taget och läste av
// dagvyn. Det som lämnar den här appen till hennes externa lönesystem har därför varit en avskrift
// för hand, och en avskrift är precis den sortens steg som tappar en rad utan att någon märker det.
//
// FORMEN ÄR BYRÅNS EGEN BESTÄLLNING, kolumn för kolumn (TIME_AND_PAYROLL.md, 2026-08-11):
//
//   Datum | Klockslag start/slut | Antal arbetade timmar | Frånvarotimmar/Frånvaroorsak | Anteckning
//
// plus "en summering av total arbetad tid och frånvaro för månaden" och ersättningarna "med belopp
// och datum". Kolumnerna "Rast" och "Orsak / jobb" är våra egna tillägg och står kvar av samma skäl
// som på skärmen: rasten är kontrollsiffran (brutto − rast = arbetat) och jobbet är kontorets egen
// granskning sedan piloten blåstes av.
//
// ⚠️ DOKUMENTET RÄKNAR INGENTING SJÄLVT. Varje siffra kommer ur `summarizePerson` — samma funktion
// som ritar dagvyn. Det är hela poängen: en PDF som räknade om timmarna hade kunnat visa en annan
// summa än den skärmen attesterades på, och då är det utskriften som blir sanningen i lönekörningen.
// Lägg aldrig en uträkning här; lägg den i summary.ts och läs den härifrån.
//
// ⚠️ "ORSAK / JOBB" SÄGER INTE ALLTID VILKET JOBB, och det är RÄTT. Tidraderna embeddar
// crm_work_orders, vars SELECT-policy kräver crm.workorder.read. Når läsaren inte ordern svarar
// embedden null, och `reasonOrJobLabel` skriver då "Arbetsorder" i stället för ett tankstreck —
// ett "—" hade lästs som "ingen uppgift finns" i stället för som den gräns det är.
//
// Dokumentet visar alltså vad LÄSAREN får se, varken mer eller mindre. Lös aldrig en tom kolumn
// genom att rendera med en elevated klient; rätt svar är en behörighet, taget som ett beslut.
//
// ⚠️ Rollen `ekonomi` HAR crm.workorder.read sedan 2026-09-18
// (supabase/sql/20260918_ekonomi_work_order_read.sql), så lönebyråns utskrift bär i dag riktiga
// ordernamn — alltså kundnamn per arbetad timme. Det var ett medvetet val 2026-08-31 att INTE visa
// det, och beslutet som väger över gällde fakturaunderlaget, inte en utskrift som lämnar appen.
// Följden är känd och sedd; ska den snävas in är vägen att sluta embedda ordern i den här
// renderingen, inte att ta nyckeln ifrån henne.
//
// ⚠️ ATTESTSTATUSEN STÅR MEDVETET INTE I HUVUDET (Williams val 2026-09-21). Dokumentet är
// löneunderlaget, inte attestkvittot — statusen bor i vyn där den går att ändra.

// ── Form ─────────────────────────────────────────────────────────────────────
//
// Punkter med origo i nedre vänstra hörnet, som pdf-lib räknar. Måtten är satta för det här
// dokumentet och delar medvetet INGA konstanter med kunddokumenten: offerten är ett brevpapper med
// uppmätta Figma-koordinater, det här är en tabell som ska tåla trettio rader och en sidbrytning.

const PAGE_W = 595;
const PAGE_H = 842;
const M_LEFT = 45;
const M_RIGHT = 550;

const hex = (value: string): RGB => {
  const n = parseInt(value.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const GREEN = hex('#00552d'); // rubriker och namn
const GREEN_TABLE = hex('#184700'); // BARA kolumnrubrikerna, som i kunddokumenten
const INK = hex('#1e1e1e');
const MUTED = hex('#585858');
// Samma varningston som skärmens "saknas" och "Kvitto saknas" (amber-800). En uppgift som fattas
// ska se likadan ut i utskriften som i vyn den skrevs ut från.
const WARN = hex('#92400e');
const RULE = hex('#dbdbdb');
const BOX = hex('#f1f5ef');

const LOGO_X = M_LEFT;
const LOGO_TOP = 805;
const LOGO_W = 150;

const TITLE_Y = 792;
const TITLE_SIZE = 14;
const PERIOD_Y = 777;

const NAME_Y = 748;
const NAME_SIZE = 13;
const SUBTITLE_Y = 734;
const HEAD_RULE_Y = 726;

// Summeringsremsan står bara på personens FÖRSTA sida. Upprepad på varje sida hade den lästs som
// en delsumma för just den sidan — och en delsumma är precis vad den inte är.
const STRIP_LABEL_Y = 712;
const STRIP_VALUE_Y = 698;
const STRIP_RULE_Y = 688;
const STRIP_X = [M_LEFT, 160, 275, 390];

const TABLE_HEAD_Y = 674;
const TABLE_HEAD_RULE_Y = 667;
/** Första radens baslinje på personens första sida. */
const BODY_TOP_FIRST = 657;
/** Första radens baslinje på en fortsättningssida — remsan saknas, så tabellen börjar högre. */
const BODY_TOP_CONT = 700;
const TABLE_HEAD_Y_CONT = 717;
const TABLE_HEAD_RULE_Y_CONT = 710;

/** Ingen rad får gå under den här baslinjen — under den börjar foten. */
const BODY_BOTTOM = 80;

const ROW_SIZE = 7.5;
const LINE_STEP = 9.5;
/** Luft mellan sista raden i en tabellrad och nästa rads första baslinje. */
const ROW_GAP = 3.5;
/** Totalraden — baslinje plus den tjockare linjen över den. */
const TOTALS_HEIGHT = LINE_STEP + 10;

const LABEL_SIZE = 6;
const FOOTER_RULE_Y = 62;
const FOOTER_Y = 48;

/**
 * Kolumnerna. `x` är vänsterkanten, `w` bredden; `align: 'right'` mäter från `x + w`.
 *
 * Summan är exakt 505 pt (M_LEFT → M_RIGHT). Ändras en bredd måste en annan ge efter — annars
 * spiller den sista kolumnen ut ur sidan, tyst, eftersom pdf-lib inte klipper något.
 */
const COLUMNS = {
  date: { x: 45, w: 70 },
  clock: { x: 115, w: 62 },
  break: { x: 177, w: 36, align: 'right' as const },
  work: { x: 213, w: 44, align: 'right' as const },
  absence: { x: 257, w: 44, align: 'right' as const },
  // ⚠️ TIO PUNKTERS LUFT efter frånvarosiffran, inte fyra. Sifferkolumnerna är högerställda, så en
  // kort text står tätt intill nästa kolumns vänsterkant: en frånvarodag skrev "8,00 Semester" som
  // vore det ett värde, och en arbetsdags "—" klistrades fast i ordernumret. Gapet är det enda som
  // håller isär dem — pdf-lib ritar inga kolumnlinjer.
  reason: { x: 311, w: 108 },
  note: { x: 429, w: 121 },
};

/**
 * Taket för hur många rader en cell får brytas till.
 *
 * Anteckningsfältet är fritext utan längdgräns i databasen, och en enda klistrad bruttotext hade
 * annars kunnat äga flera sidor i någons löneunderlag. Sex rader rymmer ~170 tecken i den här
 * kolumnen — långt mer än en tidradsanteckning brukar vara — och det som kapas märks ut med ellips
 * i stället för att försvinna tyst.
 */
const MAX_CELL_LINES = 6;

// ── Rena hjälpare ────────────────────────────────────────────────────────────

/** Minuter → '168,00'. Samma avrundning och samma decimalkomma som attestvyn visar. */
export function formatHours(minutes: number): string {
  return minutesToHours(minutes).toFixed(2).replace('.', ',');
}

/** Kronor → '1 234,50'. Fast formatering, inte Intl: samma sträng oavsett var koden kör. */
export function formatAmount(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '0,00';
  const [whole, fraction] = Math.abs(amount).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${amount < 0 ? '−' : ''}${grouped},${fraction}`;
}

const WEEKDAYS = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/**
 * '2026-08-14' → 'fre 14 aug'.
 *
 * ⚠️ RÄKNAS UR UTC OCH INTE UR INTL. Två skäl, båda har kostat i det här repot: `toISOString` och
 * lokala getters gör dygnet till gårdagen i Europe/Stockholm mellan 00 och 02, och `Intl` ger olika
 * förkortningar beroende på vilken ICU-data körmiljön har — Vercels serverfunktion och en utvecklares
 * Mac behöver inte svara samma sak. Ett löneunderlag ska se likadant ut varje gång det skrivs ut.
 */
export function formatEntryDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} ${MONTHS[month - 1] ?? match[2]}`;
}

/**
 * Klockslagen som ett spann, eller beskedet att de saknas.
 *
 * Frånvaro har inga klockslag med flit — byrån vill ha frånvaro i TIMMAR — så där är tankstrecket
 * sant. På en arbetsrad är det tvärtom: klockslagen är obligatoriska sedan 2026-08-14, och en tom
 * ruta hade sett ut som en detalj i stället för som den gamla kontorsrad den är.
 */
export function formatClockRange(row: Pick<DayRow, 'startTime' | 'endTime' | 'kind'>): { text: string; missing: boolean } {
  if (row.kind === 'absence') return { text: '—', missing: false };
  const start = row.startTime?.slice(0, 5);
  const end = row.endTime?.slice(0, 5);
  if (!start || !end) return { text: 'saknas', missing: true };
  return { text: `${start}–${end}`, missing: false };
}

/**
 * Filnamnet. Ren ASCII — å/ä/ö renderas olika per webbläsare i Content-Disposition, och ett namn
 * som mottagaren inte kan spara är ett dokument som aldrig når lönesystemet.
 *
 * Samma regel och samma skäl som `buildDocumentFilename` i CRM:ets dokumentflöde. Den funktionen
 * återanvänds inte: den bygger kunddokumentens namn ur dokumenttyp och Fortnox-nummer, och en
 * delad signatur hade behövt bära två helt olika begrepp för att spara tio rader.
 */
export function payrollFilename(input: { periodStart: string; name?: string | null }): string {
  const period = input.periodStart.slice(0, 7);
  const person = (input.name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diakriter bort: å→a, ä→a, ö→o, é→e
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\/:*?"<>|#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return person ? `Loneunderlag ${period} - ${person}.pdf` : `Loneunderlag ${period}.pdf`;
}

// ── Indata ───────────────────────────────────────────────────────────────────

export type PayrollPerson = {
  userId: string;
  /** `profiles.full_name`. Null blir "(namn saknas)" — samma text som listan visar. */
  name: string | null;
  summary: PersonPeriodSummary;
  compensations: CompensationItem[];
};

export type PayrollPdfInput = {
  /** Månadens första dag, 'ÅÅÅÅ-MM-01'. */
  periodStart: string;
  /** En person = ett avsnitt som börjar på ny sida. Tom lista ger ett dokument med ett besked. */
  people: PayrollPerson[];
  /**
   * Utskriftsdatumet i foten, 'ÅÅÅÅ-MM-DD'.
   *
   * Skickas in i stället för att läsas ur klockan här: routen känner svensk tid (`stockholmTodayISO`),
   * och en renderare som anropar `new Date()` går inte att prova mot en förväntad byte-sekvens.
   */
  printedOn: string;
  fonts?: { regular: Uint8Array; bold: Uint8Array };
  /** `null` = rita utan logotyp, `undefined` = hämta den från disk. */
  logo?: Uint8Array | null;
};

type Fonts = { regular: PDFFont; bold: PDFFont };

/**
 * Var nästa rad hamnar — sidan och baslinjen tillsammans.
 *
 * `ensure(height)` byter till en ny sida när raden inte får plats, och eftersom både `page` och `y`
 * bor i samma objekt kan ingen ritfunktion råka behålla en gammal sidreferens över brytningen.
 */
type Flow = {
  page: PDFPage;
  y: number;
  /**
   * Vad som ritas överst på en FORTSÄTTNINGSSIDA, under sidhuvudet.
   *
   * ⚠️ Måste följa med det som faktiskt flödar. Tabellhuvudet låg först fast på varje ny sida, och
   * en månad vars ersättningslista bröt till sida två fick då "DATUM · KLOCKSLAG · RAST · ARBETAT"
   * över fyra utläggsrader — kolumnrubriker som inte beskrev något på sidan. `null` betyder att
   * sidan börjar tom under huvudet.
   */
  continuation: ((page: PDFPage) => void) | null;
  ensure(height: number): void;
};

// ── Ritning ──────────────────────────────────────────────────────────────────

function draw(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color: RGB) {
  const value = cleanText(text);
  if (!value) return;
  page.drawText(value, { x, y, size, font, color });
}

function drawRight(page: PDFPage, text: string, right: number, y: number, font: PDFFont, size: number, color: RGB) {
  const value = cleanText(text);
  if (!value) return;
  page.drawText(value, { x: right - font.widthOfTextAtSize(value, size), y, size, font, color });
}

function drawRule(page: PDFPage, y: number, color: RGB = RULE, thickness = 0.6) {
  page.drawLine({ start: { x: M_LEFT, y }, end: { x: M_RIGHT, y }, thickness, color });
}

/** Bryter en cell och kapar vid taket. Det kapade märks ut — tyst bortfall är det vi inte vill ha. */
function cellLines(text: string | null | undefined, font: PDFFont, width: number): string[] {
  if (!text) return [];
  const lines = wrapLines(text, font, ROW_SIZE, width);
  if (lines.length <= MAX_CELL_LINES) return lines;
  const kept = lines.slice(0, MAX_CELL_LINES);
  kept[MAX_CELL_LINES - 1] = `${kept[MAX_CELL_LINES - 1]} …`;
  return kept;
}

export async function renderPayrollPdf(input: PayrollPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const fontBytes = input.fonts ?? (await loadDesignFonts());
  const fonts: Fonts = {
    // `subset: true` bäddar bara in de tecken dokumentet faktiskt använder. Utan den växer varje
    // dokument med ~260 kB inbäddad Open Sans — och det här dokumentet kan skrivas ut tjugo gånger
    // i månaden.
    regular: await doc.embedFont(fontBytes.regular, { subset: true }),
    bold: await doc.embedFont(fontBytes.bold, { subset: true }),
  };

  const logoBytes = input.logo === undefined ? await loadDesignLogo() : input.logo;
  let logo: PDFImage | null = null;
  if (logoBytes) {
    try {
      logo = await doc.embedPng(logoBytes);
    } catch (e) {
      // Hellre ett underlag utan logotyp än inget underlag alls — men tyst får det inte vara.
      console.warn('[loneunderlag-pdf] logotypen kunde inte bäddas in:', e instanceof Error ? e.message : e);
      logo = null;
    }
  }

  const range = periodRange(input.periodStart);
  const label = periodLabel(input.periodStart);

  if (input.people.length === 0) {
    // Kan inträffa: filtret "Inget rapporterat" utan träffar, eller en månad före första anställningen.
    // Ett tomt dokument utan förklaring hade sett trasigt ut.
    const page = doc.addPage([PAGE_W, PAGE_H]);
    drawHead(page, fonts, logo, { title: 'LÖNEUNDERLAG', period: label, name: null, range, continued: false });
    draw(page, 'Ingen anställd att visa för perioden.', M_LEFT, BODY_TOP_FIRST, fonts.regular, 9, MUTED);
    drawFoot(page, fonts, { name: null, period: label, printedOn: input.printedOn, index: 1, total: 1 });
    return doc.save();
  }

  for (const person of input.people) {
    renderPerson(doc, fonts, logo, person, { label, range, printedOn: input.printedOn });
  }

  return doc.save();
}

function renderPerson(
  doc: PDFDocument,
  fonts: Fonts,
  logo: PDFImage | null,
  person: PayrollPerson,
  ctx: { label: string; range: { from: string; to: string }; printedOn: string },
) {
  const name = person.name || '(namn saknas)';
  const summary = person.summary;

  // Sidorna samlas för att sidnumret ("Sida 2 (3)") inte går att skriva förrän avsnittet är klart.
  //
  // ⚠️ Numret räknar personens EGNA sidor, inte dokumentets. Ett samlat utskrift för tjugo personer
  // delas nästan alltid upp igen — en bunt per anställd — och då måste varje bunt kunna kontrolleras
  // för sig. "Sida 2 (3)" svarar på frågan "har jag allt om Anna?"; ett löpande nummer gör det inte.
  const pages: PDFPage[] = [];

  const newPage = (continued: boolean): PDFPage => {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    drawHead(page, fonts, logo, { title: 'LÖNEUNDERLAG', period: ctx.label, name, range: ctx.range, continued });
    return page;
  };

  // ⚠️ SIDAN OCH BASLINJEN BOR I ETT OBJEKT, inte i två lokala variabler.
  //
  // Med `let page` i den här funktionen och en hjälpare som tar `page` som argument ritar hjälparen
  // vidare på den sida den FICK, även efter att `ensure` bytt till en ny — ersättningslistan hade
  // hamnat osynlig ovanpå sidan före. Felklassen syns inte i en liten testfixtur, bara i en månad
  // som råkar brytas på rätt ställe.
  const flow: Flow = {
    page: newPage(false),
    y: BODY_TOP_FIRST,
    continuation: (page) => drawTableHead(page, fonts, TABLE_HEAD_Y_CONT, TABLE_HEAD_RULE_Y_CONT),
    ensure(height: number) {
      if (this.y - height >= BODY_BOTTOM) return;
      this.page = newPage(true);
      this.continuation?.(this.page);
      this.y = BODY_TOP_CONT;
    },
  };
  drawSummaryStrip(flow.page, fonts, summary);
  drawTableHead(flow.page, fonts, TABLE_HEAD_Y, TABLE_HEAD_RULE_Y);

  if (summary.rows.length === 0 && person.compensations.length === 0) {
    draw(flow.page, `${name} har inte rapporterat något den här månaden.`, M_LEFT, flow.y, fonts.regular, 8, MUTED);
  }

  for (const [index, row] of summary.rows.entries()) {
    const reason = cellLines(reasonOrJobLabel(row), fonts.regular, COLUMNS.reason.w);
    const note = cellLines(row.note, fonts.regular, COLUMNS.note.w);
    const lines = Math.max(1, reason.length, note.length);
    const height = lines * LINE_STEP + ROW_GAP;
    // ⚠️ SISTA RADEN BÄR MED SIG TOTALRADEN in i platsprövningen.
    //
    // Totalraden är inte ett eget block utan tabellens sista rad, och den får aldrig bli ensam på
    // en sida: en sida med kolumnrubriker, ordet "Totalt" och inte en enda dag läser som en
    // DELSUMMA för just den sidan — och en delsumma är precis vad månadssumman inte är. Prövas de
    // var för sig ryms den sista dagen men inte summan, och då är brytningen redan gjord.
    flow.ensure(height + (index === summary.rows.length - 1 ? TOTALS_HEIGHT : 0));
    drawDayRow(flow.page, fonts, row, flow.y, reason, note);
    flow.y -= height;
  }

  if (summary.rows.length > 0) {
    // Ingen ensure här: raden fick sin plats reserverad tillsammans med tabellens sista dag ovan.
    const height = TOTALS_HEIGHT;
    const { page, y } = flow;
    page.drawLine({ start: { x: M_LEFT, y: y + 8 }, end: { x: M_RIGHT, y: y + 8 }, thickness: 1, color: MUTED });
    draw(page, 'Totalt', COLUMNS.date.x, y, fonts.bold, ROW_SIZE, INK);
    drawRight(
      page,
      summary.breakMinutes > 0 ? `${formatHours(summary.breakMinutes)} h` : '—',
      COLUMNS.break.x + COLUMNS.break.w,
      y,
      fonts.bold,
      ROW_SIZE,
      MUTED,
    );
    drawRight(page, `${formatHours(summary.workMinutes)} h`, COLUMNS.work.x + COLUMNS.work.w, y, fonts.bold, ROW_SIZE, INK);
    drawRight(
      page,
      summary.absenceMinutes > 0 ? `${formatHours(summary.absenceMinutes)} h` : '—',
      COLUMNS.absence.x + COLUMNS.absence.w,
      y,
      fonts.bold,
      ROW_SIZE,
      summary.absenceMinutes > 0 ? WARN : MUTED,
    );
    flow.y -= height;
  }

  // Tabellen är slut. Allt härefter är egna block, och en fortsättningssida ska INTE längre bära
  // kolumnrubriker som inte beskriver något på den.
  flow.continuation = null;

  // Frånvaro per orsak. Byrån behöver veta VILKEN ledighet, inte bara hur mycket — orsakerna har
  // olika lönesort, och summan säger ingenting om vilken som ska användas.
  if (summary.absenceByReason.length > 0) {
    const text = summary.absenceByReason
      .map((item) => `${item.reason}: ${formatHours(item.minutes)} h`)
      .join('   ·   ');
    const lines = wrapLines(text, fonts.regular, ROW_SIZE, M_RIGHT - M_LEFT);
    const height = 14 + lines.length * LINE_STEP + 6;
    flow.ensure(height);
    draw(flow.page, 'FRÅNVARO PER ORSAK', M_LEFT, flow.y, fonts.bold, LABEL_SIZE, GREEN_TABLE);
    let lineY = flow.y - 13;
    for (const line of lines) {
      draw(flow.page, line, M_LEFT, lineY, fonts.regular, ROW_SIZE, INK);
      lineY -= LINE_STEP;
    }
    flow.y -= height;
  }

  if (person.compensations.length > 0) {
    drawCompensations(flow, fonts, person.compensations);
  }

  for (const [index, pageRef] of pages.entries()) {
    drawFoot(pageRef, fonts, {
      name,
      period: ctx.label,
      printedOn: ctx.printedOn,
      index: index + 1,
      total: pages.length,
    });
  }
}

function drawHead(
  page: PDFPage,
  fonts: Fonts,
  logo: PDFImage | null,
  head: { title: string; period: string; name: string | null; range: { from: string; to: string }; continued: boolean },
) {
  if (logo) {
    const height = (logo.height / logo.width) * LOGO_W;
    page.drawImage(logo, { x: LOGO_X, y: LOGO_TOP - height, width: LOGO_W, height });
  }
  drawRight(page, head.title, M_RIGHT, TITLE_Y, fonts.bold, TITLE_SIZE, GREEN);
  drawRight(page, head.period, M_RIGHT, PERIOD_Y, fonts.regular, 9, MUTED);

  // Namnet upprepas på VARJE sida, inte bara den första. En utskrift delas i buntar per anställd,
  // och ett blad utan namn hamnar i fel hög utan att någon kan se det.
  if (head.name) {
    draw(page, head.name, M_LEFT, NAME_Y, fonts.bold, NAME_SIZE, GREEN);
    const suffix = head.continued ? ' · forts.' : '';
    draw(page, `Period ${head.range.from} – ${head.range.to}${suffix}`, M_LEFT, SUBTITLE_Y, fonts.regular, 7.5, MUTED);
  }
  drawRule(page, HEAD_RULE_Y);
}

function drawSummaryStrip(page: PDFPage, fonts: Fonts, summary: PersonPeriodSummary) {
  page.drawRectangle({
    x: M_LEFT,
    y: STRIP_VALUE_Y - 8,
    width: M_RIGHT - M_LEFT,
    height: 32,
    color: BOX,
  });

  const cells: Array<[string, string, RGB]> = [
    ['ARBETAD TID', `${formatHours(summary.workMinutes)} h`, INK],
    ['FRÅNVARO', summary.absenceMinutes > 0 ? `${formatHours(summary.absenceMinutes)} h` : '—', summary.absenceMinutes > 0 ? WARN : MUTED],
    // Kontrollsiffran: brutto ur klockslagen minus den här ska bli arbetad tid. Bara rast som
    // FAKTISKT drogs av räknas med — se breakWasDeducted. En rast som aldrig påverkade något hade
    // fått raden att se överrapporterad ut med en timme.
    ['RASTAVDRAG', summary.breakMinutes > 0 ? `${formatHours(summary.breakMinutes)} h` : '—', MUTED],
    ['RAPPORTERADE RADER', String(summary.rows.length), INK],
  ];

  for (const [index, [label, value, color]] of cells.entries()) {
    const x = STRIP_X[index] + 8;
    draw(page, label, x, STRIP_LABEL_Y, fonts.bold, LABEL_SIZE, GREEN_TABLE);
    draw(page, value, x, STRIP_VALUE_Y, fonts.bold, 11, color);
  }
  drawRule(page, STRIP_RULE_Y);
}

function drawTableHead(page: PDFPage, fonts: Fonts, y: number, ruleY: number) {
  draw(page, 'DATUM', COLUMNS.date.x, y, fonts.bold, LABEL_SIZE, GREEN_TABLE);
  draw(page, 'KLOCKSLAG', COLUMNS.clock.x, y, fonts.bold, LABEL_SIZE, GREEN_TABLE);
  drawRight(page, 'RAST', COLUMNS.break.x + COLUMNS.break.w, y, fonts.bold, LABEL_SIZE, GREEN_TABLE);
  drawRight(page, 'ARBETAT', COLUMNS.work.x + COLUMNS.work.w, y, fonts.bold, LABEL_SIZE, GREEN_TABLE);
  drawRight(page, 'FRÅNVARO', COLUMNS.absence.x + COLUMNS.absence.w, y, fonts.bold, LABEL_SIZE, GREEN_TABLE);
  draw(page, 'ORSAK / JOBB', COLUMNS.reason.x, y, fonts.bold, LABEL_SIZE, GREEN_TABLE);
  draw(page, 'ANTECKNING', COLUMNS.note.x, y, fonts.bold, LABEL_SIZE, GREEN_TABLE);
  drawRule(page, ruleY);
}

function drawDayRow(page: PDFPage, fonts: Fonts, row: DayRow, y: number, reason: string[], note: string[]) {
  draw(page, formatEntryDate(row.date), COLUMNS.date.x, y, fonts.regular, ROW_SIZE, INK);

  const clock = formatClockRange(row);
  draw(page, clock.text, COLUMNS.clock.x, y, fonts.regular, ROW_SIZE, clock.missing ? WARN : INK);

  // ⚠️ Rasten visas bara när den FAKTISKT drogs av. `workedMinutes` drar av den först när det finns
  // två klockslag att räkna emellan; saknas de faller den tillbaka på minutesWorked, och radens
  // lagrade rast har aldrig påverkat någonting. Att ändå trycka den hade fått en korrekt gammal
  // kontorsrad att se överrapporterad ut med en timme i ett dokument som ligger till grund för lön.
  drawRight(
    page,
    breakWasDeducted(row) && row.breakMinutes > 0 ? `${row.breakMinutes} min` : '—',
    COLUMNS.break.x + COLUMNS.break.w,
    y,
    fonts.regular,
    ROW_SIZE,
    MUTED,
  );
  drawRight(
    page,
    row.workMinutes > 0 ? formatHours(row.workMinutes) : '—',
    COLUMNS.work.x + COLUMNS.work.w,
    y,
    fonts.regular,
    ROW_SIZE,
    row.workMinutes > 0 ? INK : MUTED,
  );
  drawRight(
    page,
    row.absenceMinutes > 0 ? formatHours(row.absenceMinutes) : '—',
    COLUMNS.absence.x + COLUMNS.absence.w,
    y,
    fonts.regular,
    ROW_SIZE,
    row.absenceMinutes > 0 ? WARN : MUTED,
  );

  let lineY = y;
  for (const line of reason) {
    draw(page, line, COLUMNS.reason.x, lineY, fonts.regular, ROW_SIZE, INK);
    lineY -= LINE_STEP;
  }
  lineY = y;
  for (const line of note) {
    draw(page, line, COLUMNS.note.x, lineY, fonts.regular, ROW_SIZE, MUTED);
    lineY -= LINE_STEP;
  }
}

/**
 * Ersättningarna — traktamente, utlägg och milersättning.
 *
 * ⚠️ KRONOR SKRIVS BARA UT NÄR POSTEN BÄR NÅGRA, och villkoret är `> 0`, inte sorten. Traktamente
 * och milersättning ersätts med FASTA SATSER som byrån äger, så "0,00 kr" hade läst som ett
 * påstående om att resan var gratis — mitt i det underlag satsen ska tillämpas på. Rader från före
 * 2026-09-01 kan däremot bära ett riktigt belopp, och därför frågar vi beloppet och inte sorten.
 *
 * Antalen (mil, dagar) summeras per sort FÖRE listan: det är dem satserna räknas på, och byrån ska
 * slippa lägga ihop enskilda rader för hand.
 */
function drawCompensations(flow: Flow, fonts: Fonts, items: CompensationItem[]): void {
  const summaryLines = wrapLines(compensationSummaryText(items), fonts.bold, ROW_SIZE, M_RIGHT - M_LEFT);
  // ⚠️ POSTERNA BRYTS FÖRE platsprövningen, inte i loopen — reservationen måste veta hur hög den
  // FÖRSTA posten faktiskt är.
  //
  // Ett utlägg med en längre anteckning bryts till två eller tre rader, och en reservation som
  // antog en enradig post lät "ERSÄTTNINGAR" plus summeringen stå ensamma sist på sidan medan
  // listan började på nästa. En rubrik utan innehåll läser som att listan är tom, och den som
  // granskar går vidare utan att bläddra. Samma gäller summeringsraden: den kan också brytas.
  const rows = items.map((item) => ({
    item,
    // Bredden lämnar plats åt datumet till vänster och "Kvitto saknas" till höger.
    lines: cellLines(compensationText(item), fonts.regular, M_RIGHT - M_LEFT - 62 - 60),
  }));
  const rowHeight = (lineCount: number) => Math.max(1, lineCount) * LINE_STEP + 1.5;

  flow.ensure(13 + summaryLines.length * LINE_STEP + 4 + rowHeight(rows[0]?.lines.length ?? 1));
  draw(flow.page, 'ERSÄTTNINGAR', M_LEFT, flow.y, fonts.bold, LABEL_SIZE, GREEN_TABLE);
  flow.y -= 13;

  for (const line of summaryLines) {
    draw(flow.page, line, M_LEFT, flow.y, fonts.bold, ROW_SIZE, INK);
    flow.y -= LINE_STEP;
  }
  flow.y -= 4;

  // Bryter listan till en ny sida ska läsaren se VAD hon tittar på. Utan den här raden börjar sidan
  // med fyra datum och några belopp utan rubrik, mitt i ett dokument vars alla andra tal är timmar.
  flow.continuation = (page) =>
    draw(page, 'ERSÄTTNINGAR (forts.)', M_LEFT, TABLE_HEAD_Y_CONT, fonts.bold, LABEL_SIZE, GREEN_TABLE);

  for (const { item, lines } of rows) {
    const height = rowHeight(lines.length);
    flow.ensure(height);

    draw(flow.page, formatEntryDate(item.entry_date), M_LEFT, flow.y, fonts.regular, ROW_SIZE, MUTED);
    let lineY = flow.y;
    for (const line of lines) {
      draw(flow.page, line, M_LEFT + 62, lineY, fonts.regular, ROW_SIZE, INK);
      lineY -= LINE_STEP;
    }
    // Saknat kvitto står i utskriften av samma skäl som i panelen: efter attesten kan den anställde
    // inte längre koppla kvittot själv, så ett papper som fattas måste synas medan det går att be om.
    if (isReceiptMissing(item)) drawRight(flow.page, 'Kvitto saknas', M_RIGHT, flow.y, fonts.bold, ROW_SIZE, WARN);
    flow.y -= height;
  }
}

/** Summan per sort — antalen (mil, dagar) är det byråns fasta satser räknas på. */
function compensationSummaryText(items: CompensationItem[]): string {
  return summarizeCompensations(items)
    .map((total) => {
      const unit = COMPENSATION_UNITS[total.kind];
      const parts = [
        unit ? `${formatQuantity(total.quantity)} ${unit}` : null,
        total.amount > 0 ? `${formatAmount(total.amount)} kr` : null,
      ].filter(Boolean);
      return `${COMPENSATION_LABELS[total.kind]} ${parts.join(' · ')}`;
    })
    .join('   ·   ');
}

function compensationText(item: CompensationItem): string {
  const unit = COMPENSATION_UNITS[item.kind];
  const vatAmount = item.vat_amount == null ? null : Number(item.vat_amount);
  return [
    COMPENSATION_LABELS[item.kind] || item.kind,
    unit && item.quantity != null ? `${formatQuantity(item.quantity)} ${unit}` : null,
    Number(item.amount) > 0 ? `${formatAmount(item.amount)} kr` : null,
    // ⚠️ `!= null` och inte en sanningsprövning: 0 kr moms är ett svar (utlandsköp,
    // vidarefakturerat) och ska inte se ut som ett ouppgivet fält för den som bokför.
    vatAmount != null ? `varav moms ${formatAmount(vatAmount)} kr` : null,
    item.note || null,
  ].filter(Boolean).join(' · ');
}

function drawFoot(
  page: PDFPage,
  fonts: Fonts,
  foot: { name: string | null; period: string; printedOn: string; index: number; total: number },
) {
  page.drawLine({ start: { x: M_LEFT, y: FOOTER_RULE_Y }, end: { x: M_RIGHT, y: FOOTER_RULE_Y }, thickness: 0.6, color: RULE });
  const left = [foot.name, `Löneunderlag ${foot.period}`, `Utskrivet ${foot.printedOn}`].filter(Boolean).join(' · ');
  draw(page, left, M_LEFT, FOOTER_Y, fonts.regular, 6.5, MUTED);
  drawRight(page, `Sida ${foot.index} (${foot.total})`, M_RIGHT, FOOTER_Y, fonts.regular, 6.5, MUTED);
}

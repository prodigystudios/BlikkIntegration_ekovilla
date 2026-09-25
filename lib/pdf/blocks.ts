import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';

import { loadDesignFonts, loadDesignLogo, loadIsoleringslandslagetLogo } from '@/lib/pdf/brandAssets';
import { createFlow, type Flow } from '@/lib/pdf/flow';
import { cleanText, wrapLines } from '@/lib/pdf/text';

// Blockrenderaren — ritar ett dokument som redan är uppdelat i block (rubrik, stycke, lista,
// fält, tabell, signaturlinje), med Ekovillas och Isoleringslandslagets logotyper i huvudet.
//
// Född i KMA-planen (lib/domains/crm/kmaPlans/pdf.ts) och flyttad hit när skyddsronden blev dess
// andra användare. Renderaren BYGGER INGEN TEXT — allt som skrivs ut kommer från anroparens
// dokument. Här bor bara formen: typsnitt, avstånd, brytningar, sidhuvud och sidfot.
//
// BRYTREGLERNA, alla betalda i löneunderlaget först (lib/domains/time/payrollPdf.ts):
//   * Sidan och baslinjen bor i ETT objekt (lib/pdf/flow.ts) — läs flow.page efter varje ensure.
//   * En rubrik står aldrig ensam sist på en sida: den reserverar plats för början av det som följer.
//   * En tabellrad bryts aldrig; tabellhuvudet ritas om på fortsättningssidan och nollställs när
//     tabellen är slut, så en rubrik aldrig hamnar över något den inte beskriver.
//   * Ett avsnitt med `newPage` börjar på ny sida (breakPage — utan fortsättningshuvud).
//
// ⚠️ DATUM ÄR DOKUMENTETS, ALDRIG DAGENS. Metadatadatumen sätts till det datum anroparen ger, så
// att en PDF-läsare inte säger "skapad i dag" om ett dokument från i våras.

// ── Dokumentets form ─────────────────────────────────────────────────────────

export type PdfTableColumn = {
  head: string;
  /** Relativ bredd. Renderaren fördelar sidans bredd i proportion. */
  width: number;
};

export type PdfBlock =
  /** Dokumentets stora rubrik, med valfri underrubrik. */
  | { t: 'title'; text: string; sub?: string }
  /** Avsnittsrubrik: "1. Inledning och syfte", "Bilaga 1 – …". */
  | { t: 'h1'; text: string }
  /** Underrubrik i fetstil: "Kvalitetspolicy". */
  | { t: 'h2'; text: string }
  /** Mellanrubrik i brödtextens färg: "Ordning på arbetsplatsen" i bilaga 1. */
  | { t: 'h3'; text: string }
  /** Stycke. `lead` skrivs i fetstil först på raden ("Syfte:"). Radbrytningar i `text` bevaras. */
  | { t: 'p'; text: string; lead?: string }
  | { t: 'list'; items: string[] }
  /**
   * Etikett–värde-rader. `form` ritar dem som en BLANKETT: varje rad får en linje att skriva på, och
   * ett ifyllt värde står på sin linje (egenkontrollmallens huvud).
   */
  | { t: 'fields'; rows: Array<[string, string]>; form?: boolean }
  /**
   * Tabell. `minRows` fyller på med tomma rader (signaturlistor att skriva på), `rowMinHeight` ger
   * skrivutrymme i en blankett.
   */
  | { t: 'table'; columns: PdfTableColumn[]; rows: string[][]; minRows?: number; rowMinHeight?: number }
  /** En linje att skriva sin namnteckning på, med etiketten ovanför. */
  | { t: 'signature'; label: string }
  | { t: 'gap'; h: number }
  /**
   * Foton i ett rutnät, två per rad, med bildtext under varje. `ref` slås upp i renderarens
   * `images` (bytesen följer aldrig med i dokumentet). En rad bryts aldrig mitt i. Ett foto som
   * saknas i `images` ritas som en ruta som säger det — protokollet ska inte tappa en hänvisning tyst.
   * Används av skyddsronden; KMA-planens lagrade dokumentschema godtar inte blocket.
   */
  | { t: 'photos'; items: Array<{ ref: string; caption: string }> };

export type PdfSection = {
  key: string;
  /** Avsnittet börjar på en ny sida. */
  newPage: boolean;
  blocks: PdfBlock[];
};

/** Det foten skriver på varje sida. */
type PdfFooterText = {
  /** Mittraden: bolagsraden. */
  footer: string;
  /** Vänster: "KMA-plan · 6579 · Revision 2". Höger står alltid "Sida N (M)". */
  running: string;
};

// ── Form ─────────────────────────────────────────────────────────────────────

const PAGE_W = 595;
const PAGE_H = 842;
const M_LEFT = 50;
const M_RIGHT = 545;
const WIDTH = M_RIGHT - M_LEFT;

const HEADER_MID = 786;
const HEADER_RULE_Y = 761;
const EKOVILLA_LOGO_W = 112;
const PARTNER_LOGO_W = 150;

/** Första baslinjen på varje sida. */
const BODY_TOP = 738;
/** Ingen rad under den här baslinjen — under den börjar foten. */
const BODY_BOTTOM = 80;

const FOOT_RULE_Y = 62;
const FOOT_COMPANY_Y = 50;
const FOOT_RUNNING_Y = 38;

const TITLE_SIZE = 22;
const SUBTITLE_SIZE = 10.5;
const H1_SIZE = 12.5;
const H2_SIZE = 10;
const H3_SIZE = 9;
const BODY_SIZE = 9;
const BODY_LINE = 12.5;
const TABLE_SIZE = 8.5;
const TABLE_LINE = 11;
const HEAD_SIZE = 7.5;
const HEAD_LINE = 9.5;
const CELL_PAD = 4;
/** Taket per tabellcell — en cell högre än en sida hade aldrig kunnat ritas. Det kapade märks ut. */
const MAX_CELL_LINES = 14;
const BULLET_INDENT = 14;
/** Blankettrad: skrivutrymme ovanför linjen och luft under den mot nästa rad. */
const FORM_AIR_ABOVE = 9;
const FORM_AIR_BELOW = 7;
/** Luft ovanför en tabell. */
const TABLE_GAP_BEFORE = 2;

const hex = (value: string): RGB => {
  const n = parseInt(value.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

// Samma två gröna som kunddokumenten: #00552d överallt, #184700 bara i tabellrubrikerna.
const GREEN = hex('#00552d');
const GREEN_TABLE = hex('#184700');
const INK = hex('#1e1e1e');
const MUTED = hex('#585858');
const RULE = hex('#dbdbdb');
const BORDER = hex('#c9d3c4');
const BOX = hex('#f1f5ef');

type Fonts = { regular: PDFFont; bold: PDFFont };

export type PdfAssets = {
  fonts?: { regular: Uint8Array; bold: Uint8Array };
  /** `null` = rita utan, `undefined` = hämta från disk. */
  ekovillaLogo?: Uint8Array | null;
  partnerLogo?: Uint8Array | null;
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

function drawCentered(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color: RGB) {
  const value = cleanText(text);
  if (!value) return;
  page.drawText(value, { x: M_LEFT + (WIDTH - font.widthOfTextAtSize(value, size)) / 2, y, size, font, color });
}

function drawHeader(page: PDFPage, ekovilla: PDFImage | null, partner: PDFImage | null) {
  if (ekovilla) {
    const height = (ekovilla.height / ekovilla.width) * EKOVILLA_LOGO_W;
    page.drawImage(ekovilla, { x: M_LEFT, y: HEADER_MID - height / 2, width: EKOVILLA_LOGO_W, height });
  }
  if (partner) {
    const height = (partner.height / partner.width) * PARTNER_LOGO_W;
    page.drawImage(partner, { x: M_RIGHT - PARTNER_LOGO_W, y: HEADER_MID - height / 2, width: PARTNER_LOGO_W, height });
  }
  page.drawLine({ start: { x: M_LEFT, y: HEADER_RULE_Y }, end: { x: M_RIGHT, y: HEADER_RULE_Y }, thickness: 0.6, color: RULE });
}

function drawFooter(page: PDFPage, fonts: Fonts, doc: PdfFooterText, index: number, total: number) {
  page.drawLine({ start: { x: M_LEFT, y: FOOT_RULE_Y }, end: { x: M_RIGHT, y: FOOT_RULE_Y }, thickness: 0.6, color: RULE });
  drawCentered(page, doc.footer, FOOT_COMPANY_Y, fonts.bold, 7, MUTED);
  draw(page, doc.running, M_LEFT, FOOT_RUNNING_Y, fonts.regular, 6.5, MUTED);
  drawRight(page, `Sida ${index} (${total})`, M_RIGHT, FOOT_RUNNING_Y, fonts.regular, 6.5, MUTED);
}

/** Bryter och kapar. Det kapade märks ut — tyst bortfall är det vi inte vill ha. */
function capLines(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${kept[max - 1]} …`;
  return kept;
}

// ── Layout per block ─────────────────────────────────────────────────────────

type ParagraphLayout = { lead: string; leadWidth: number; lines: string[] };

/**
 * Ett stycke med en fetstilt inledning ("Syfte:") på samma rad som texten. Första raden får kortare
 * bredd, resten bryts över hela bredden — ett ord som inte ryms bredvid inledningen går ned.
 */
function layoutParagraph(block: Extract<PdfBlock, { t: 'p' }>, fonts: Fonts): ParagraphLayout {
  if (!block.lead) return { lead: '', leadWidth: 0, lines: wrapLines(block.text, fonts.regular, BODY_SIZE, WIDTH) };

  const lead = cleanText(block.lead);
  const leadWidth = fonts.bold.widthOfTextAtSize(`${lead} `, BODY_SIZE);
  const [firstParagraph = '', ...restParagraphs] = cleanText(block.text).split('\n');
  const words = firstParagraph.split(/\s+/).filter(Boolean);

  let first = '';
  let used = 0;
  for (const word of words) {
    const candidate = first ? `${first} ${word}` : word;
    if (fonts.regular.widthOfTextAtSize(candidate, BODY_SIZE) > WIDTH - leadWidth) break;
    first = candidate;
    used += 1;
  }
  const remainder = words.slice(used).join(' ');
  const restText = [remainder, ...restParagraphs].filter((part, index) => index > 0 || part !== '').join('\n');
  const rest = restText ? wrapLines(restText, fonts.regular, BODY_SIZE, WIDTH) : [];
  return { lead, leadWidth, lines: [first, ...rest] };
}

type TableLayout = {
  widths: number[];
  head: string[][];
  headHeight: number;
  rows: Array<{ cells: string[][]; height: number }>;
};

function layoutTable(block: Extract<PdfBlock, { t: 'table' }>, fonts: Fonts): TableLayout {
  const total = block.columns.reduce((sum, c) => sum + c.width, 0);
  const widths = block.columns.map((c) => (c.width / total) * WIDTH);

  const head = block.columns.map((c, i) => (c.head ? wrapLines(c.head, fonts.bold, HEAD_SIZE, widths[i] - 2 * CELL_PAD) : []));
  const headLines = Math.max(1, ...head.map((lines) => lines.length));
  const headHeight = 2 * CELL_PAD + HEAD_SIZE + (headLines - 1) * HEAD_LINE;

  const bodyRows = [...block.rows];
  while (bodyRows.length < (block.minRows ?? 0)) bodyRows.push(block.columns.map(() => ''));

  const rows = bodyRows.map((row) => {
    const cells = block.columns.map((_, i) => {
      const text = row[i] ?? '';
      return text ? capLines(wrapLines(text, fonts.regular, TABLE_SIZE, widths[i] - 2 * CELL_PAD), MAX_CELL_LINES) : [];
    });
    const lines = Math.max(1, ...cells.map((c) => c.length));
    const height = Math.max(2 * CELL_PAD + TABLE_SIZE + (lines - 1) * TABLE_LINE, block.rowMinHeight ?? 0);
    return { cells, height };
  });

  return { widths, head, headHeight, rows };
}

function drawCellGrid(page: PDFPage, top: number, height: number, widths: number[], fill?: RGB) {
  page.drawRectangle({
    x: M_LEFT,
    y: top - height,
    width: WIDTH,
    height,
    borderColor: BORDER,
    borderWidth: 0.5,
    ...(fill ? { color: fill } : {}),
  });
  let x = M_LEFT;
  for (const width of widths.slice(0, -1)) {
    x += width;
    page.drawLine({ start: { x, y: top }, end: { x, y: top - height }, thickness: 0.5, color: BORDER });
  }
}

function drawTableHead(page: PDFPage, fonts: Fonts, layout: TableLayout, top: number) {
  drawCellGrid(page, top, layout.headHeight, layout.widths, BOX);
  let x = M_LEFT;
  for (const [i, lines] of layout.head.entries()) {
    let y = top - CELL_PAD - HEAD_SIZE * 0.8;
    for (const line of lines) {
      draw(page, line, x + CELL_PAD, y, fonts.bold, HEAD_SIZE, GREEN_TABLE);
      y -= HEAD_LINE;
    }
    x += layout.widths[i];
  }
}

function fieldsLabelWidth(rows: Array<[string, string]>, fonts: Fonts): number {
  const widest = Math.max(0, ...rows.map(([label]) => fonts.bold.widthOfTextAtSize(cleanText(label), BODY_SIZE)));
  return Math.min(190, widest + 14);
}

type FieldRowLayout = { label: string[]; value: string[]; height: number };

function layoutFieldRow([label, value]: [string, string], labelWidth: number, fonts: Fonts, form: boolean): FieldRowLayout {
  const labelLines = wrapLines(label, fonts.bold, BODY_SIZE, labelWidth - 10);
  const valueLines = cleanText(value) ? wrapLines(value, fonts.regular, BODY_SIZE, WIDTH - labelWidth) : [];
  const lines = Math.max(labelLines.length, valueLines.length, 1);
  // En blankettrad har luft ovanför linjen för en penna, och luft under den mot nästa rad.
  const height = form ? lines * BODY_LINE + FORM_AIR_ABOVE + FORM_AIR_BELOW : lines * BODY_LINE + 2;
  return { label: labelLines, value: valueLines, height };
}

/**
 * Höjden på det första stycket av ett block — det en rubrik måste få sällskap av för att inte bli
 * stående ensam sist på sidan. En rubrik följd av en rubrik räknar in båda och det som följer dem.
 */
function leadingHeight(blocks: PdfBlock[], index: number, fonts: Fonts): number {
  const block = blocks[index];
  if (!block) return 0;
  switch (block.t) {
    case 'h1':
    case 'h2':
    case 'h3':
      // 🧨 Luften OVANFÖR nästa block räknas med. Utan den godkände "4. Miljöplan" platsen för sig,
      // underrubrik och stycke — och sedan tog underrubrikens egna 8 pt den över kanten, så
      // huvudrubriken stod ensam sist på sidan. Svepet i tests/crm/kmaPdf.test.ts fångade det (KMA-planen).
      return headingHeight(block, fonts) + gapBefore(blocks[index + 1]) + leadingHeight(blocks, index + 1, fonts);
    case 'p':
      return Math.min(2, layoutParagraph(block, fonts).lines.length) * BODY_LINE;
    case 'list': {
      const first = block.items[0];
      return first ? wrapLines(first, fonts.regular, BODY_SIZE, WIDTH - BULLET_INDENT).length * BODY_LINE : 0;
    }
    case 'fields': {
      const first = block.rows[0];
      return first ? layoutFieldRow(first, fieldsLabelWidth(block.rows, fonts), fonts, block.form === true).height : 0;
    }
    case 'table': {
      // Bara huvudet och första raden läggs ut — det är allt platsprövningen frågar om, och hela
      // tabellen läggs ändå ut när den ritas.
      const layout = layoutTable({ ...block, rows: block.rows.slice(0, 1), minRows: Math.min(block.minRows ?? 0, 1) }, fonts);
      return layout.headHeight + (layout.rows[0]?.height ?? 0);
    }
    case 'signature':
      return SIGNATURE_HEIGHT;
    case 'title':
      return TITLE_HEIGHT;
    case 'gap':
      return 0;
    case 'photos':
      return block.items.length > 0 ? PHOTO_ROW_ESTIMATE : 0;
  }
}

const TITLE_HEIGHT = 44;
const SIGNATURE_HEIGHT = 46;

/** Fotorutnätet: två per rad. En stående mobilbild skalas efter höjden, en liggande efter bredden. */
const PHOTO_GAP = 14;
const PHOTO_MAX_H = 230;
const PHOTO_MISSING_H = 120;
const PHOTO_CAPTION_SIZE = 8;
const PHOTO_CAPTION_LINE = 10;
const PHOTO_CAPTION_GAP = 4;
const PHOTO_ROW_GAP = 14;
/** Platsprövningen före bilderna är inbäddade: den högsta tänkbara raden. */
const PHOTO_ROW_ESTIMATE = PHOTO_MAX_H + PHOTO_CAPTION_GAP + 2 * PHOTO_CAPTION_LINE + PHOTO_ROW_GAP;

/** Rubrikernas form — EN källa för både platsprövningen och ritningen, så de aldrig räknar olika. */
const HEADING = {
  h1: { size: H1_SIZE, before: 14, after: 6, color: GREEN },
  h2: { size: H2_SIZE, before: 8, after: 3, color: GREEN },
  h3: { size: H3_SIZE, before: 5, after: 2, color: INK },
} as const;
const HEADING_LEADING = 3.5;

type HeadingBlock = Extract<PdfBlock, { t: 'h1' | 'h2' | 'h3' }>;

function headingLines(block: HeadingBlock, fonts: Fonts): string[] {
  return wrapLines(block.text, fonts.bold, HEADING[block.t].size, WIDTH);
}

function headingHeight(block: HeadingBlock, fonts: Fonts): number {
  const form = HEADING[block.t];
  return headingLines(block, fonts).length * (form.size + HEADING_LEADING) + form.after;
}

/** Luft ovanför en rubrik — men inte överst på en sida, där den bara hade flyttat ned texten. */
function spaceBefore(block: HeadingBlock, flow: Flow): number {
  return flow.y >= BODY_TOP - 0.01 ? 0 : HEADING[block.t].before;
}

/** Luften ett block lägger ovanför sig när det följer på något — samma tal som ritningen drar av. */
function gapBefore(block: PdfBlock | undefined): number {
  if (!block) return 0;
  if (block.t === 'h1' || block.t === 'h2' || block.t === 'h3') return HEADING[block.t].before;
  if (block.t === 'table') return TABLE_GAP_BEFORE;
  if (block.t === 'photos') return TABLE_GAP_BEFORE;
  return 0;
}

// ── Blocken ──────────────────────────────────────────────────────────────────

type EmbeddedImages = ReadonlyMap<string, PDFImage | null>;

function drawBlocks(blocks: PdfBlock[], fonts: Fonts, flow: Flow, images: EmbeddedImages) {
  for (const [index, block] of blocks.entries()) {
    switch (block.t) {
      case 'title': {
        flow.ensure(TITLE_HEIGHT);
        draw(flow.page, block.text, M_LEFT, flow.y - TITLE_SIZE * 0.8, fonts.bold, TITLE_SIZE, GREEN);
        if (block.sub) draw(flow.page, block.sub, M_LEFT, flow.y - TITLE_SIZE - 10, fonts.regular, SUBTITLE_SIZE, MUTED);
        flow.y -= TITLE_HEIGHT;
        break;
      }

      case 'h1':
      case 'h2':
      case 'h3': {
        const form = HEADING[block.t];
        const before = spaceBefore(block, flow);
        // Rubriken och början av det som följer prövas TILLSAMMANS. Prövas rubriken ensam ryms den,
        // och nästa block bryts till en ny sida — kvar står en rubrik över ingenting.
        flow.ensure(before + leadingHeight(blocks, index, fonts));
        // Bröt ensure sidan står vi överst, och där ska ingen luft läggas ovanför.
        if (flow.y < BODY_TOP - 0.01) flow.y -= before;
        for (const line of headingLines(block, fonts)) {
          draw(flow.page, line, M_LEFT, flow.y - form.size * 0.8, fonts.bold, form.size, form.color);
          flow.y -= form.size + HEADING_LEADING;
        }
        flow.y -= form.after;
        break;
      }

      case 'p': {
        const layout = layoutParagraph(block, fonts);
        // Minst två rader tillsammans (eller hela stycket om det är kortare) — en ensam första rad
        // sist på sidan läser som ett avbrutet dokument.
        flow.ensure(Math.min(2, layout.lines.length) * BODY_LINE);
        for (const [lineIndex, line] of layout.lines.entries()) {
          flow.ensure(BODY_LINE);
          const baseline = flow.y - BODY_SIZE * 0.8;
          if (lineIndex === 0 && layout.lead) {
            draw(flow.page, layout.lead, M_LEFT, baseline, fonts.bold, BODY_SIZE, INK);
            draw(flow.page, line, M_LEFT + layout.leadWidth, baseline, fonts.regular, BODY_SIZE, INK);
          } else {
            draw(flow.page, line, M_LEFT, baseline, fonts.regular, BODY_SIZE, INK);
          }
          flow.y -= BODY_LINE;
        }
        flow.y -= 5;
        break;
      }

      case 'list': {
        for (const item of block.items) {
          const lines = wrapLines(item, fonts.regular, BODY_SIZE, WIDTH - BULLET_INDENT);
          flow.ensure(Math.min(2, lines.length) * BODY_LINE);
          for (const [lineIndex, line] of lines.entries()) {
            flow.ensure(BODY_LINE);
            const baseline = flow.y - BODY_SIZE * 0.8;
            if (lineIndex === 0) draw(flow.page, '•', M_LEFT + 3, baseline, fonts.regular, BODY_SIZE, GREEN);
            draw(flow.page, line, M_LEFT + BULLET_INDENT, baseline, fonts.regular, BODY_SIZE, INK);
            flow.y -= BODY_LINE;
          }
          flow.y -= 1.5;
        }
        flow.y -= 4;
        break;
      }

      case 'fields': {
        const labelWidth = fieldsLabelWidth(block.rows, fonts);
        const form = block.form === true;
        for (const row of block.rows) {
          const layout = layoutFieldRow(row, labelWidth, fonts, form);
          // En rad hålls ihop: namn, telefon och e-post på en person ska inte delas av en sidbrytning.
          flow.ensure(layout.height);
          const top = flow.y;
          if (form) {
            // Blankett: etikett och värde står NERE på raden, linjen strax under deras baslinje — man
            // skriver på linjen, och ett förifyllt värde står där handstilen annars hade stått.
            const baseline = top - layout.height + FORM_AIR_BELOW;
            const bottomUp = (lines: string[], x: number, font: PDFFont) =>
              lines.forEach((line, i) => draw(flow.page, line, x, baseline + (lines.length - 1 - i) * BODY_LINE, font, BODY_SIZE, INK));
            bottomUp(layout.label, M_LEFT, fonts.bold);
            bottomUp(layout.value, M_LEFT + labelWidth, fonts.regular);
            flow.page.drawLine({
              start: { x: M_LEFT + labelWidth - 4, y: baseline - 2.5 },
              end: { x: M_RIGHT, y: baseline - 2.5 },
              thickness: 0.5,
              color: MUTED,
            });
          } else {
            layout.label.forEach((line, i) =>
              draw(flow.page, line, M_LEFT, top - BODY_SIZE * 0.8 - i * BODY_LINE, fonts.bold, BODY_SIZE, INK),
            );
            layout.value.forEach((line, i) =>
              draw(flow.page, line, M_LEFT + labelWidth, top - BODY_SIZE * 0.8 - i * BODY_LINE, fonts.regular, BODY_SIZE, INK),
            );
          }
          flow.y -= layout.height;
        }
        flow.y -= 6;
        break;
      }

      case 'table': {
        const layout = layoutTable(block, fonts);
        flow.y -= TABLE_GAP_BEFORE;
        // Huvudet får aldrig stå ensamt: det reserverar plats för första raden.
        flow.ensure(layout.headHeight + (layout.rows[0]?.height ?? 0));
        drawTableHead(flow.page, fonts, layout, flow.y);
        flow.y -= layout.headHeight;
        // Bryter tabellen följer huvudet med — och bara så länge tabellen flödar.
        flow.continuation = (page, top) => {
          drawTableHead(page, fonts, layout, top);
          return layout.headHeight;
        };
        for (const row of layout.rows) {
          flow.ensure(row.height);
          const top = flow.y;
          drawCellGrid(flow.page, top, row.height, layout.widths);
          let x = M_LEFT;
          for (const [i, lines] of row.cells.entries()) {
            let y = top - CELL_PAD - TABLE_SIZE * 0.8;
            for (const line of lines) {
              draw(flow.page, line, x + CELL_PAD, y, fonts.regular, TABLE_SIZE, INK);
              y -= TABLE_LINE;
            }
            x += layout.widths[i];
          }
          flow.y -= row.height;
        }
        flow.continuation = null;
        flow.y -= 8;
        break;
      }

      case 'signature': {
        flow.ensure(SIGNATURE_HEIGHT);
        draw(flow.page, block.label, M_LEFT, flow.y - BODY_SIZE * 0.8, fonts.bold, BODY_SIZE, INK);
        const lineY = flow.y - 34;
        flow.page.drawLine({ start: { x: M_LEFT, y: lineY }, end: { x: M_LEFT + 260, y: lineY }, thickness: 0.6, color: MUTED });
        flow.y -= SIGNATURE_HEIGHT;
        break;
      }

      case 'gap':
        flow.y -= block.h;
        break;

      case 'photos': {
        const cellW = (WIDTH - PHOTO_GAP) / 2;
        flow.y -= TABLE_GAP_BEFORE;
        for (let start = 0; start < block.items.length; start += 2) {
          const cells = block.items.slice(start, start + 2).map((item) => {
            const image = images.get(item.ref) ?? null;
            const scale = image ? Math.min(cellW / image.width, PHOTO_MAX_H / image.height) : 0;
            return {
              image,
              w: image ? image.width * scale : cellW,
              h: image ? image.height * scale : PHOTO_MISSING_H,
              caption: capLines(wrapLines(item.caption, fonts.regular, PHOTO_CAPTION_SIZE, cellW), 2),
            };
          });
          const rowH = Math.max(...cells.map((c) => c.h + PHOTO_CAPTION_GAP + c.caption.length * PHOTO_CAPTION_LINE)) + PHOTO_ROW_GAP;
          // Raden hålls ihop: ett foto och dess bildtext på olika sidor går inte att läsa ihop.
          flow.ensure(rowH);
          const top = flow.y;
          cells.forEach((cell, col) => {
            const x = M_LEFT + col * (cellW + PHOTO_GAP);
            if (cell.image) {
              flow.page.drawImage(cell.image, { x, y: top - cell.h, width: cell.w, height: cell.h });
            } else {
              flow.page.drawRectangle({ x, y: top - cell.h, width: cell.w, height: cell.h, borderColor: BORDER, borderWidth: 0.5, color: BOX });
              draw(flow.page, 'Fotot kunde inte hämtas.', x + CELL_PAD * 2, top - cell.h / 2, fonts.regular, BODY_SIZE, MUTED);
            }
            let y = top - cell.h - PHOTO_CAPTION_GAP - PHOTO_CAPTION_SIZE * 0.8;
            for (const line of cell.caption) {
              draw(flow.page, line, x, y, fonts.regular, PHOTO_CAPTION_SIZE, MUTED);
              y -= PHOTO_CAPTION_LINE;
            }
          });
          flow.y -= rowH;
        }
        break;
      }
    }
  }
}

/**
 * Bäddar in fotona som dokumentet hänvisar till, en gång per ref. JPEG och PNG känns igen på sina
 * första bytes, inte på ett påstående. Ett foto som inte går att bädda in blir null — rutnätet ritar
 * då en ruta som säger det, i stället för att hela PDF:en fallerar.
 */
async function embedPhotos(pdf: PDFDocument, sections: PdfSection[], bytes: ReadonlyMap<string, Uint8Array>): Promise<EmbeddedImages> {
  const embedded = new Map<string, PDFImage | null>();
  for (const section of sections) {
    for (const block of section.blocks) {
      if (block.t !== 'photos') continue;
      for (const { ref } of block.items) {
        if (embedded.has(ref)) continue;
        const data = bytes.get(ref);
        let image: PDFImage | null = null;
        try {
          if (data && data[0] === 0xff && data[1] === 0xd8) image = await pdf.embedJpg(data);
          else if (data && data[0] === 0x89 && data[1] === 0x50) image = await pdf.embedPng(data);
        } catch (e) {
          console.warn('[pdf] fotot kunde inte bäddas in:', ref, e instanceof Error ? e.message : e);
        }
        embedded.set(ref, image);
      }
    }
  }
  return embedded;
}

async function embedLogo(pdf: PDFDocument, bytes: Uint8Array | null, kind: 'png' | 'jpg'): Promise<PDFImage | null> {
  if (!bytes) return null;
  try {
    return kind === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  } catch (e) {
    // Hellre en plan utan logotyp än ingen plan alls — men tyst får det inte vara.
    console.warn('[pdf] logotypen kunde inte bäddas in:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** 'ÅÅÅÅ-MM-DD' → midnatt UTC. Date.UTC och inte `new Date(iso)`: samma svar i varje tidszon. */
function isoDateToUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export type RenderBlocksPdfInput = PdfFooterText & {
  sections: PdfSection[];
  /** PDF-metadata. */
  title: string;
  subject: string;
  /** 'ÅÅÅÅ-MM-DD' — skapelse- och ändringsdatum i metadatan. */
  date: string;
  /** Bytes till fotoblocken, per `ref`. */
  images?: ReadonlyMap<string, Uint8Array>;
};

export async function renderBlocksPdf(input: RenderBlocksPdfInput, assets: PdfAssets = {}): Promise<Uint8Array> {
  // updateMetadata: false — annars stämplar pdf-lib dagens datum som skapelse- och ändringsdatum.
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);

  const fontBytes = assets.fonts ?? (await loadDesignFonts());
  const fonts: Fonts = {
    // customName: utan den får det inbäddade typsnittet ett slumpat namnprefix vid varje rendering.
    regular: await pdf.embedFont(fontBytes.regular, { subset: true, customName: 'OpenSans-Regular' }),
    bold: await pdf.embedFont(fontBytes.bold, { subset: true, customName: 'OpenSans-Bold' }),
  };

  const ekovilla = await embedLogo(pdf, assets.ekovillaLogo === undefined ? await loadDesignLogo() : assets.ekovillaLogo, 'png');
  const partner = await embedLogo(
    pdf,
    assets.partnerLogo === undefined ? await loadIsoleringslandslagetLogo() : assets.partnerLogo,
    'jpg',
  );

  // Sidorna samlas: sidnumret ("Sida 2 (9)") går inte att skriva förrän allt är lagt.
  const pages: PDFPage[] = [];
  const newPage = () => {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    drawHeader(page, ekovilla, partner);
    return page;
  };

  const images = await embedPhotos(pdf, input.sections, input.images ?? new Map());

  const flow = createFlow({ page: newPage(), top: BODY_TOP, continuationTop: BODY_TOP, bottom: BODY_BOTTOM, newPage });
  for (const [index, section] of input.sections.entries()) {
    if (section.newPage && index > 0) flow.breakPage();
    drawBlocks(section.blocks, fonts, flow, images);
  }

  for (const [index, page] of pages.entries()) drawFooter(page, fonts, input, index + 1, pages.length);

  const date = isoDateToUtc(input.date);
  pdf.setTitle(input.title);
  pdf.setSubject(input.subject);
  pdf.setCreator('Ekovilla CRM');
  pdf.setProducer('Ekovilla CRM');
  pdf.setCreationDate(date);
  pdf.setModificationDate(date);

  return pdf.save();
}

import { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'fs/promises';
import path from 'path';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Branding = {
  primaryColor?: string;
  accentColor?: string;
};

type SectionRow = {
  label: string;
  value: string;
};

type TableColumn = {
  key: string;
  label: string;
  width: number;
  align?: 'left' | 'right';
};

type TablePreparedRow = {
  lines: string[][];
  height: number;
};

const generatePdfBodySchema = z.object({
  orderId: z.string().optional().default(''),
  projectNumber: z.string().optional().default(''),
  installerName: z.string().optional().default(''),
  workAddress: z.object({
    streetAddress: z.string().optional().default(''),
    postalCode: z.string().optional().default(''),
    city: z.string().optional().default(''),
  }).optional(),
  installationDate: z.string().optional().default(''),
  clientName: z.string().optional().default(''),
  materialUsed: z.string().optional().default(''),
  checks: z.record(z.string(), z.any()).optional(),
  etapperOpen: z.array(z.record(z.string(), z.any())).optional(),
  etapperClosed: z.array(z.record(z.string(), z.any())).optional(),
  beforeImageDataUrl: z.string().optional().nullable(),
  afterImageDataUrl: z.string().optional().nullable(),
  signature: z.string().optional().nullable(),
  signatureDateCity: z.string().optional().default(''),
  signatureTimestamp: z.string().optional().default(''),
  signatureTimeZone: z.string().optional().default(''),
  branding: z.object({
    primaryColor: z.string().optional(),
    accentColor: z.string().optional(),
  }).optional(),
}).passthrough();

const BRAND = {
  name: 'Ekovilla AB',
  orgNumber: '559341-9673',
  phone: '020 - 44 66 40',
  email: 'info@ekovilla.se',
  logoPath: path.join(process.cwd(), 'public', 'brand', 'Ekovilla_vit.png'),
  footerBadgePath: path.join(process.cwd(), 'public', 'brand', 'Behöriglösull-logga-blue.png'),
  faviconPath: path.join(process.cwd(), 'public', 'favicon-from-ico.png'),
} as const;

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 24;
const HEADER_HEIGHT = 64;
const FOOTER_HEIGHT = 28;
const SECTION_GAP = 10;
const SAFE_BOTTOM = PAGE_MARGIN + FOOTER_HEIGHT + 6;

function sanitizePdfText(input: unknown) {
  return String(input ?? '')
    .replace(/\u2212/g, '-')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '*')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

function hexToRgb(hex?: string) {
  const fallback = { r: 28 / 255, g: 130 / 255, b: 67 / 255 };
  if (!hex) return fallback;
  const normalized = hex.replace('#', '').trim();
  const value = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return fallback;
  const bigint = parseInt(value, 16);
  return {
    r: ((bigint >> 16) & 255) / 255,
    g: ((bigint >> 8) & 255) / 255,
    b: (bigint & 255) / 255,
  };
}

function toFileNamePart(input: string) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\-.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const parsedBody = generatePdfBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return new Response('Invalid request body', { status: 400 });
    }

    const body = parsedBody.data;
    const {
      orderId,
      projectNumber,
      installerName,
      workAddress: { streetAddress, postalCode, city } = { streetAddress: '', postalCode: '', city: '' },
      installationDate,
      clientName,
      materialUsed,
      checks = {} as any,
      etapperOpen = [] as Array<any>,
      etapperClosed = [] as Array<any>,
      beforeImageDataUrl,
      afterImageDataUrl,
      signature,
      signatureDateCity,
      signatureTimestamp,
      signatureTimeZone,
      branding = {} as Branding,
    } = body || {};

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const primary = hexToRgb(branding.primaryColor || '#1c8243');
    const accent = hexToRgb(branding.accentColor || '#8aa79b');
    const textColor = rgb(0.12, 0.12, 0.14);
    const mutedText = rgb(0.4, 0.45, 0.48);
    const borderColor = rgb(accent.r, accent.g, accent.b);
    const softBorder = rgb(
      Math.min(1, accent.r + 0.1),
      Math.min(1, accent.g + 0.1),
      Math.min(1, accent.b + 0.1)
    );
    const cardBg = rgb(0.985, 0.992, 0.988);
    const headerBg = rgb(primary.r, primary.g, primary.b);
    const contentWidth = PAGE_WIDTH - PAGE_MARGIN * 2;
    const printedOn = new Date().toISOString().slice(0, 10);

    let logoImage: any = null;
    let footerBadgeImage: any = null;
    let faviconImage: any = null;
    try {
      const logoBytes = await readFile(BRAND.logoPath);
      logoImage = await pdfDoc.embedPng(logoBytes);
    } catch {
      logoImage = null;
    }
    try {
      const footerBadgeBytes = await readFile(BRAND.footerBadgePath);
      footerBadgeImage = await pdfDoc.embedPng(footerBadgeBytes);
    } catch {
      footerBadgeImage = null;
    }
    try {
      const faviconBytes = await readFile(BRAND.faviconPath);
      faviconImage = await pdfDoc.embedPng(faviconBytes);
    } catch {
      faviconImage = null;
    }

    const pages: any[] = [];
    let page: any;
    let currentY = 0;

    const wrapText = (value: unknown, maxWidth: number, size: number, useBold = false): string[] => {
      const text = sanitizePdfText(value).trim();
      if (!text) return ['-'];
      const activeFont = useBold ? fontBold : font;
      const words = text.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let line = '';

      const breakLongWord = (word: string) => {
        const pieces: string[] = [];
        let buffer = '';
        for (const char of word) {
          const candidate = buffer + char;
          if ((activeFont as any).widthOfTextAtSize(candidate, size) <= maxWidth || !buffer) {
            buffer = candidate;
          } else {
            pieces.push(buffer);
            buffer = char;
          }
        }
        if (buffer) pieces.push(buffer);
        return pieces;
      };

      for (const word of words) {
        if ((activeFont as any).widthOfTextAtSize(word, size) > maxWidth) {
          if (line) {
            lines.push(line);
            line = '';
          }
          lines.push(...breakLongWord(word));
          continue;
        }

        const candidate = line ? `${line} ${word}` : word;
        if ((activeFont as any).widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
          line = candidate;
        } else {
          lines.push(line);
          line = word;
        }
      }

      if (line) lines.push(line);
      return lines.length ? lines : ['-'];
    };

    const measureLinesHeight = (lines: string[], size: number, lineGap = 3) => lines.length * size + Math.max(0, lines.length - 1) * lineGap;

    const drawLines = (
      targetPage: any,
      lines: string[],
      x: number,
      startY: number,
      size: number,
      color: any,
      useBold = false,
      lineGap = 3,
      align: 'left' | 'right' = 'left',
      boxWidth?: number
    ) => {
      const activeFont = useBold ? fontBold : font;
      let y = startY;
      for (const line of lines) {
        const width = (activeFont as any).widthOfTextAtSize(line, size);
        const drawX = align === 'right' && boxWidth ? x + boxWidth - width : x;
        targetPage.drawText(line, { x: drawX, y, size, font: activeFont, color });
        y -= size + lineGap;
      }
      return y;
    };

    const drawChip = (targetPage: any, text: string, x: number, yTop: number) => {
      const chipText = sanitizePdfText(text);
      if (!chipText) return 0;
      const fontSize = 8;
      const padX = 8;
      const padY = 4;
      const textWidth = (fontBold as any).widthOfTextAtSize(chipText, fontSize);
      const width = textWidth + padX * 2;
      const height = fontSize + padY * 2;
      const y = yTop - height;
      targetPage.drawRectangle({ x, y, width, height, color: rgb(1, 1, 1), opacity: 0.16 });
      targetPage.drawRectangle({ x, y, width, height, borderColor: rgb(1, 1, 1), borderWidth: 0.6, color: undefined as any, opacity: 0.35 });
      targetPage.drawText(chipText, { x: x + padX, y: y + padY + 1, size: fontSize, font: fontBold, color: rgb(1, 1, 1) });
      return width;
    };

    const drawPageHeading = (title: string) => {
      const headingLines = wrapText(title, contentWidth, 18, true);
      const top = currentY;
      drawLines(page, headingLines, PAGE_MARGIN, top - 18, 18, textColor, true, 3);
      currentY = top - measureLinesHeight(headingLines, 18, 3) - 8;
    };

    const createPage = () => {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pages.push(page);
      const headerTopY = PAGE_HEIGHT - HEADER_HEIGHT;
      page.drawRectangle({ x: 0, y: PAGE_HEIGHT - HEADER_HEIGHT, width: PAGE_WIDTH, height: HEADER_HEIGHT, color: headerBg });
      page.drawRectangle({ x: 0, y: PAGE_HEIGHT - HEADER_HEIGHT, width: PAGE_WIDTH, height: 6, color: rgb(accent.r, accent.g, accent.b), opacity: 0.35 });

      if (logoImage) {
        const maxH = 22;
        const maxW = 138;
        const scale = Math.min(maxW / logoImage.width, maxH / logoImage.height, 1);
        const width = logoImage.width * scale;
        const height = logoImage.height * scale;
        const logoY = headerTopY + ((HEADER_HEIGHT - 6 - height) / 2);
        page.drawImage(logoImage, { x: PAGE_MARGIN, y: logoY, width, height });
      }

      const chipFontSize = 8;
      const chipPadY = 4;
      const chipHeight = chipFontSize + chipPadY * 2;
      const chipY = headerTopY + ((HEADER_HEIGHT - 6 + chipHeight) / 2);
      if (installationDate) {
        const chipText = `Datum ${sanitizePdfText(installationDate)}`;
        const padX = 8;
        const textWidth = (fontBold as any).widthOfTextAtSize(chipText, chipFontSize);
        const width = textWidth + padX * 2;
        const rightX = PAGE_WIDTH - PAGE_MARGIN - width;
        drawChip(page, chipText, rightX, chipY);
      }

      currentY = PAGE_HEIGHT - HEADER_HEIGHT - 10;
      return page;
    };

    const ensureSpace = (needed: number) => {
      if (!page) createPage();
      if (currentY - needed < SAFE_BOTTOM) createPage();
    };

    const drawCardShell = (title: string, height: number) => {
      ensureSpace(height + SECTION_GAP);
      const top = currentY;
      const bottom = top - height;
      page.drawRectangle({ x: PAGE_MARGIN, y: bottom, width: contentWidth, height, color: cardBg });
      page.drawRectangle({ x: PAGE_MARGIN, y: bottom, width: contentWidth, height, borderColor, borderWidth: 1, color: undefined as any });
      page.drawRectangle({ x: PAGE_MARGIN, y: top - 36, width: contentWidth, height: 36, color: rgb(0.95, 0.975, 0.962) });
      page.drawText(sanitizePdfText(title), {
        x: PAGE_MARGIN + 14,
        y: top - 24,
        size: 12,
        font: fontBold,
        color: rgb(primary.r, primary.g, primary.b),
      });
      currentY = bottom - SECTION_GAP;
      return { top, bottom };
    };

    const drawSingleColumnCard = (title: string, rows: SectionRow[]) => {
      const titleArea = 48;
      const paddingX = 14;
      const labelSize = 8;
      const valueSize = 10;
      const rowGap = 16;
      const dividerGap = 8;
      const maxWidth = contentWidth - paddingX * 2;

      const measured = rows.map((row) => {
        const valueLines = wrapText(row.value || '-', maxWidth, valueSize);
        return {
          row,
          valueLines,
          contentHeight: labelSize + 6 + measureLinesHeight(valueLines, valueSize, 3),
        };
      });

      const height = titleArea + measured.reduce((sum, item, index) => {
        const dividerHeight = index < measured.length - 1 ? dividerGap + 1 + dividerGap : 0;
        return sum + item.contentHeight + rowGap + dividerHeight;
      }, 0) + 8;
      const { top } = drawCardShell(title, height);
      let cursorY = top - 52;

      measured.forEach((item, index) => {
        page.drawText(sanitizePdfText(item.row.label).toUpperCase(), {
          x: PAGE_MARGIN + paddingX,
          y: cursorY,
          size: labelSize,
          font: fontBold,
          color: mutedText,
        });
        cursorY -= labelSize + 5;
        drawLines(page, item.valueLines, PAGE_MARGIN + paddingX, cursorY, valueSize, textColor);
        cursorY -= measureLinesHeight(item.valueLines, valueSize, 3) + rowGap - valueSize;
        if (index < measured.length - 1) {
          cursorY -= dividerGap;
          page.drawRectangle({
            x: PAGE_MARGIN + paddingX,
            y: cursorY,
            width: maxWidth,
            height: 0.6,
            color: softBorder,
            opacity: 0.7,
          });
          cursorY -= dividerGap;
        }
      });
    };

    const drawTwoColumnCard = (title: string, leftRows: SectionRow[], rightRows: SectionRow[]) => {
      const titleArea = 48;
      const paddingX = 14;
      const labelSize = 8;
      const valueSize = 10;
      const rowGap = 16;
      const dividerGap = 8;
      const colGap = 16;
      const colWidth = (contentWidth - paddingX * 2 - colGap) / 2;

      const measureColumn = (rows: SectionRow[]) => rows.map((row) => {
        const valueLines = wrapText(row.value || '-', colWidth, valueSize);
        return {
          row,
          valueLines,
          contentHeight: labelSize + 6 + measureLinesHeight(valueLines, valueSize, 3),
        };
      });

      const leftMeasured = measureColumn(leftRows);
      const rightMeasured = measureColumn(rightRows);
      const height = titleArea + Math.max(
        leftMeasured.reduce((sum, item, index) => {
          const dividerHeight = index < leftMeasured.length - 1 ? dividerGap + 1 + dividerGap : 0;
          return sum + item.contentHeight + rowGap + dividerHeight;
        }, 0),
        rightMeasured.reduce((sum, item, index) => {
          const dividerHeight = index < rightMeasured.length - 1 ? dividerGap + 1 + dividerGap : 0;
          return sum + item.contentHeight + rowGap + dividerHeight;
        }, 0)
      ) + 8;
      const { top, bottom } = drawCardShell(title, height);

      page.drawRectangle({
        x: PAGE_MARGIN + paddingX + colWidth + (colGap / 2),
        y: bottom + 14,
        width: 0.6,
        height: top - 52 - (bottom + 14),
        color: softBorder,
        opacity: 0.55,
      });

      const drawColumn = (items: Array<{ row: SectionRow; valueLines: string[]; contentHeight: number }>, x: number) => {
        let cursorY = top - 52;
        items.forEach((item, index) => {
          page.drawText(sanitizePdfText(item.row.label).toUpperCase(), {
            x,
            y: cursorY,
            size: labelSize,
            font: fontBold,
            color: mutedText,
          });
          cursorY -= labelSize + 5;
          drawLines(page, item.valueLines, x, cursorY, valueSize, textColor);
          cursorY -= measureLinesHeight(item.valueLines, valueSize, 3) + rowGap - valueSize;
          if (index < items.length - 1) {
            cursorY -= dividerGap;
            page.drawRectangle({ x, y: cursorY, width: colWidth, height: 0.6, color: softBorder, opacity: 0.7 });
            cursorY -= dividerGap;
          }
        });
      };

      drawColumn(leftMeasured, PAGE_MARGIN + paddingX);
      drawColumn(rightMeasured, PAGE_MARGIN + paddingX + colWidth + colGap);
    };

    const drawAdaptiveCard = (title: string, rows: SectionRow[]) => {
      if (rows.length <= 4) {
        drawSingleColumnCard(title, rows);
        return;
      }
      const splitIndex = Math.ceil(rows.length / 2);
      drawTwoColumnCard(title, rows.slice(0, splitIndex), rows.slice(splitIndex));
    };

    const prepareTableRows = (rows: Array<Record<string, unknown>>, columns: TableColumn[], fontSize: number, cellPaddingX: number, cellPaddingY: number) => {
      return rows.map((row) => {
        const lines = columns.map((column) => wrapText(row[column.key] ?? '-', Math.max(10, column.width - cellPaddingX * 2), fontSize));
        const contentHeight = Math.max(...lines.map((entry) => measureLinesHeight(entry, fontSize, 2)));
        return {
          lines,
          height: Math.max(20, contentHeight + cellPaddingY * 2 + 2),
        } satisfies TablePreparedRow;
      });
    };

    const drawTableSection = (title: string, columns: TableColumn[], rawRows: Array<Record<string, unknown>>, emptyText: string) => {
      const titleArea = 48;
      const paddingX = 12;
      const cellFontSize = 8.5;
      const headerFontSize = 8;
      const cellPaddingX = 4;
      const cellPaddingY = 5;
      const maxTableWidth = contentWidth - paddingX * 2;
      const widthSum = columns.reduce((sum, column) => sum + column.width, 0) || 1;
      const scaledColumns = (() => {
        const scaled = columns.map((column) => ({
          ...column,
          width: Math.max(42, Math.floor((column.width / widthSum) * maxTableWidth)),
        }));
        const diff = maxTableWidth - scaled.reduce((sum, column) => sum + column.width, 0);
        scaled[scaled.length - 1].width += diff;
        return scaled;
      })();
      const headerLines = scaledColumns.map((column) => wrapText(column.label, Math.max(10, column.width - cellPaddingX * 2), headerFontSize, true));
      const headerHeight = Math.max(...headerLines.map((entry) => measureLinesHeight(entry, headerFontSize, 2))) + cellPaddingY * 2 + 2;
      const rows = rawRows.length
        ? prepareTableRows(rawRows, scaledColumns, cellFontSize, cellPaddingX, cellPaddingY)
        : prepareTableRows([{ [scaledColumns[0].key]: emptyText }], scaledColumns, cellFontSize, cellPaddingX, cellPaddingY);

      let rowIndex = 0;
      let continuation = false;
      while (rowIndex < rows.length) {
        const minHeight = titleArea + headerHeight + rows[rowIndex].height + 14;
        ensureSpace(minHeight + SECTION_GAP);

        let usedHeight = titleArea + headerHeight + 14;
        const startIndex = rowIndex;
        while (rowIndex < rows.length) {
          if (currentY - (usedHeight + rows[rowIndex].height) < SAFE_BOTTOM && rowIndex > startIndex) break;
          if (currentY - (usedHeight + rows[rowIndex].height) < SAFE_BOTTOM && rowIndex === startIndex) {
            createPage();
            usedHeight = titleArea + headerHeight + 14;
            continue;
          }
          usedHeight += rows[rowIndex].height;
          rowIndex += 1;
        }

        const { top, bottom } = drawCardShell(continuation ? `${title} (forts.)` : title, usedHeight);
        const innerX = PAGE_MARGIN + paddingX;
        const tableWidth = scaledColumns.reduce((sum, column) => sum + column.width, 0);
        let cursorY = top - 52;

        page.drawRectangle({ x: innerX, y: cursorY - headerHeight + 6, width: tableWidth, height: headerHeight, color: rgb(0.94, 0.967, 0.952) });

        let columnX = innerX;
        scaledColumns.forEach((column, index) => {
          drawLines(page, headerLines[index], columnX + cellPaddingX, cursorY - 10, headerFontSize, mutedText, true, 2, column.align || 'left', column.width - cellPaddingX * 2);
          columnX += column.width;
        });

        const headerBottom = cursorY - headerHeight + 6;
        page.drawRectangle({ x: innerX, y: headerBottom, width: tableWidth, height: 0.8, color: softBorder });
        cursorY = headerBottom - 6;

        for (let index = startIndex; index < rowIndex; index += 1) {
          const row = rows[index];
          const rowBottom = cursorY - row.height;
          if (index % 2 === 0) {
            page.drawRectangle({ x: innerX, y: rowBottom, width: tableWidth, height: row.height, color: rgb(1, 1, 1), opacity: 0.35 });
          }

          let cellX = innerX;
          scaledColumns.forEach((column, columnIndex) => {
            const isNumeric = column.align === 'right';
            drawLines(
              page,
              row.lines[columnIndex],
              cellX + cellPaddingX,
              cursorY - cellPaddingY - cellFontSize,
              cellFontSize,
              isNumeric ? rgb(0.08, 0.16, 0.11) : textColor,
              false,
              2,
              column.align || 'left',
              column.width - cellPaddingX * 2
            );
            cellX += column.width;
          });

          page.drawRectangle({ x: innerX, y: rowBottom, width: tableWidth, height: 0.5, color: softBorder, opacity: 0.6 });
          cursorY = rowBottom;
        }

        let separatorX = innerX;
        for (let index = 0; index < scaledColumns.length - 1; index += 1) {
          separatorX += scaledColumns[index].width;
          page.drawRectangle({ x: separatorX, y: bottom + 10, width: 0.5, height: top - 62 - (bottom + 10), color: softBorder, opacity: 0.45 });
        }

        continuation = true;
      }
    };

    const loadEmbeddedImage = async (dataUrl: string) => {
      const base64 = String(dataUrl || '').split(',')[1] || '';
      if (!base64) return null;
      const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
      if (/^data:image\/png/i.test(dataUrl)) return pdfDoc.embedPng(bytes);
      return (pdfDoc as any).embedJpg?.(bytes) || null;
    };

    const renderCheck = (entry: any) => {
      const ok = !!entry?.ok;
      const comment = sanitizePdfText(entry?.comment ?? '').trim();
      if (!ok && !comment) return null;
      if (ok && comment) return `OK - ${comment}`;
      if (ok) return 'OK';
      return comment || 'Ej markerad';
    };

    const controlRows = [
      { label: 'Takfotsventilation', value: renderCheck(checks?.takfotsventilation) },
      { label: 'Snickerier', value: renderCheck(checks?.snickerier) },
      { label: 'Tätskikt', value: renderCheck(checks?.tatskikt) },
      { label: 'Genomförningar', value: renderCheck(checks?.genomforningar) },
      { label: 'Grovstädning', value: renderCheck(checks?.grovstadning) },
      { label: 'Märkskylt', value: renderCheck(checks?.markskylt) },
    ].filter((row): row is { label: string; value: string } => Boolean(row.value));

    createPage();
    drawPageHeading('Egenkontroll');

    drawTwoColumnCard(
      'Projekt',
      [
        { label: 'Kund / beställare', value: sanitizePdfText(clientName || '-') },
        { label: 'Adress', value: [streetAddress, [postalCode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '-' },
        { label: 'Installationsdatum', value: sanitizePdfText(installationDate || '-') },
      ],
      [
        { label: 'Ansvarig installatör', value: sanitizePdfText(installerName || '-') },
        { label: 'Vårt ordernummer', value: sanitizePdfText(orderId || '-') },
        { label: 'Projektnummer', value: sanitizePdfText(projectNumber || '-') },
      ]
    );

    drawSingleColumnCard('Material', [
      { label: 'Använt material', value: sanitizePdfText(materialUsed || '-') },
    ]);

    if (controlRows.length) {
      drawAdaptiveCard('Kontroller', controlRows);
    }

    drawSingleColumnCard('Övriga kommentarer', [
      { label: 'Kommentar', value: sanitizePdfText(checks?.ovrigaKommentarer?.comment || '-') },
    ]);

    createPage();

    drawTableSection(
      'Etapper (öppet)',
      [
        { key: 'etapp', label: 'Etapp', width: 94 },
        { key: 'ytaM2', label: 'Yta m2', width: 46, align: 'right' },
        { key: 'bestalldTjocklek', label: 'Beställd tjocklek', width: 68, align: 'right' },
        { key: 'sattningsprocent', label: 'Sättningsprocent %', width: 54, align: 'right' },
        { key: 'installeradTjocklek', label: 'Installerad tjocklek', width: 62, align: 'right' },
        { key: 'antalSack', label: 'Antal säck', width: 50, align: 'right' },
        { key: 'installeradDensitet', label: 'Installerad densitet', width: 68, align: 'right' },
        { key: 'lambdavarde', label: 'Lambdavärde', width: 56, align: 'right' },
      ],
      (etapperOpen || []).filter((row: any) => Object.values(row || {}).some((value: any) => String(value ?? '').trim() !== '')),
      'Inga öppna etapper registrerade'
    );

    drawTableSection(
      'Etapper (slutet)',
      [
        { key: 'etapp', label: 'Etapp', width: 110 },
        { key: 'ytaM2', label: 'Yta m2', width: 48, align: 'right' },
        { key: 'bestalldTjocklek', label: 'Beställd tjocklek', width: 68, align: 'right' },
        { key: 'uppmatTjocklek', label: 'Uppmätt tjocklek', width: 68, align: 'right' },
        { key: 'antalSackKgPerSack', label: 'Antal säck', width: 50, align: 'right' },
        { key: 'installeradDensitet', label: 'Installerad densitet', width: 70, align: 'right' },
        { key: 'lambdavarde', label: 'Lambdavärde', width: 58, align: 'right' },
      ],
      (etapperClosed || []).filter((row: any) => Object.values(row || {}).some((value: any) => String(value ?? '').trim() !== '')),
      'Inga slutna etapper registrerade'
    );

    const signatureImage = signature ? await loadEmbeddedImage(String(signature)) : null;
    const signatureNote = (() => {
      const raw = sanitizePdfText(signatureTimestamp || '').trim();
      const tz = sanitizePdfText(signatureTimeZone || '').trim();
      if (!raw) return '';
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return `Signerad: ${raw}`;
      const pad = (value: number) => String(value).padStart(2, '0');
      try {
        if (tz) {
          const formatter = new Intl.DateTimeFormat('sv-SE', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });
          const parts = formatter.formatToParts(date).reduce((acc, part) => {
            acc[part.type] = part.value;
            return acc;
          }, {} as Record<string, string>);
          return `Signerad: ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${tz}`;
        }
      } catch {}
      return `Signerad: ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    })();

    const signatureHeight = 182;
    const { top: signatureTop } = drawCardShell('Signatur', signatureHeight);
    const labelX = PAGE_MARGIN + 14;
    const lineX = PAGE_MARGIN + 154;
    const lineWidth = contentWidth - 168;
    const lineColor = rgb(accent.r, accent.g, accent.b);
    const signatureRows = [
      { label: 'Datum och ort', value: sanitizePdfText(signatureDateCity || '-') },
      { label: 'Underskrift', value: '' },
      { label: 'Namnförtydligande', value: sanitizePdfText(String(installerName || '').toUpperCase() || '-') },
    ];

    let signatureCursorY = signatureTop - 58;
    signatureRows.forEach((row, index) => {
      page.drawText(row.label.toUpperCase(), { x: labelX, y: signatureCursorY, size: 8, font: fontBold, color: mutedText });
      const baseLineY = signatureCursorY - 8;
      page.drawRectangle({ x: lineX, y: baseLineY, width: lineWidth, height: 0.8, color: lineColor, opacity: 0.7 });
      if (index === 0 && row.value) {
        page.drawText(row.value, { x: lineX + 4, y: baseLineY + 4, size: 10, font, color: textColor });
      }
      if (index === 1 && signatureImage) {
        const maxW = lineWidth - 12;
        const maxH = 34;
        const scale = Math.min(maxW / signatureImage.width, maxH / signatureImage.height, 1);
        const width = signatureImage.width * scale;
        const height = signatureImage.height * scale;
        page.drawImage(signatureImage, { x: lineX + 2, y: baseLineY - height * 0.22, width, height });
      }
      if (index === 1 && signatureNote) {
        const noteWidth = (font as any).widthOfTextAtSize(signatureNote, 8);
        page.drawText(signatureNote, {
          x: lineX + lineWidth - noteWidth,
          y: baseLineY + 8,
          size: 8,
          font,
          color: mutedText,
        });
      }
      if (index === 2 && row.value) {
        page.drawText(row.value, { x: lineX + 4, y: baseLineY + 4, size: 10, font, color: textColor });
      }
      signatureCursorY -= index === 1 ? 52 : 36;
    });

    const imageEntries = [
      beforeImageDataUrl ? { title: 'Före', value: String(beforeImageDataUrl) } : null,
      afterImageDataUrl ? { title: 'Efter', value: String(afterImageDataUrl) } : null,
    ].filter(Boolean) as Array<{ title: string; value: string }>;

    if (imageEntries.length) {
      const imagePage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pages.push(imagePage);
      const imageHeaderTopY = PAGE_HEIGHT - HEADER_HEIGHT;
      imagePage.drawRectangle({ x: 0, y: PAGE_HEIGHT - HEADER_HEIGHT, width: PAGE_WIDTH, height: HEADER_HEIGHT, color: headerBg });
      imagePage.drawText('Projektbilder', { x: PAGE_MARGIN, y: PAGE_HEIGHT - 52, size: 18, font: fontBold, color: rgb(1, 1, 1) });
      if (logoImage) {
        const maxH = 22;
        const maxW = 138;
        const scale = Math.min(maxW / logoImage.width, maxH / logoImage.height, 1);
        const width = logoImage.width * scale;
        const height = logoImage.height * scale;
        const logoY = imageHeaderTopY + ((HEADER_HEIGHT - 6 - height) / 2);
        imagePage.drawImage(logoImage, { x: PAGE_MARGIN, y: logoY, width, height });
      }
      if (installationDate) {
        const chipText = `Datum ${sanitizePdfText(installationDate)}`;
        const fontSize = 8;
        const padX = 8;
        const textWidth = (fontBold as any).widthOfTextAtSize(chipText, fontSize);
        const chipWidth = textWidth + padX * 2;
        const chipHeight2 = fontSize + 8;
        const chipY = imageHeaderTopY + ((HEADER_HEIGHT - 6 + chipHeight2) / 2);
        drawChip(imagePage, chipText, PAGE_WIDTH - PAGE_MARGIN - chipWidth, chipY);
      }

      const slotGap = 18;
      const slotHeight = imageEntries.length === 1
        ? PAGE_HEIGHT - HEADER_HEIGHT - FOOTER_HEIGHT - PAGE_MARGIN * 2 - 36
        : (PAGE_HEIGHT - HEADER_HEIGHT - FOOTER_HEIGHT - PAGE_MARGIN * 2 - slotGap - 54) / 2;
      let slotTop = PAGE_HEIGHT - HEADER_HEIGHT - 20;
      for (const entry of imageEntries) {
        const embedded = await loadEmbeddedImage(entry.value);
        const titleY = slotTop - 14;
        imagePage.drawText(entry.title, { x: PAGE_MARGIN, y: titleY, size: 12, font: fontBold, color: textColor });
        const boxTop = titleY - 10;
        const boxBottom = boxTop - slotHeight;
        imagePage.drawRectangle({ x: PAGE_MARGIN, y: boxBottom, width: contentWidth, height: slotHeight, color: cardBg });
        imagePage.drawRectangle({ x: PAGE_MARGIN, y: boxBottom, width: contentWidth, height: slotHeight, borderColor, borderWidth: 1, color: undefined as any });

        if (embedded) {
          const availW = contentWidth - 18;
          const availH = slotHeight - 18;
          const scale = Math.min(availW / embedded.width, availH / embedded.height, 1);
          const width = embedded.width * scale;
          const height = embedded.height * scale;
          imagePage.drawImage(embedded, {
            x: PAGE_MARGIN + (contentWidth - width) / 2,
            y: boxBottom + (slotHeight - height) / 2,
            width,
            height,
          });
        }

        slotTop = boxBottom - slotGap;
      }
    }

    pages.forEach((entry, index) => {
      const pageNumber = index + 1;
      entry.drawRectangle({ x: PAGE_MARGIN, y: PAGE_MARGIN + 10, width: contentWidth, height: 0.6, color: softBorder, opacity: 0.75 });
      entry.drawText(`Genererad ${printedOn}`, {
        x: PAGE_MARGIN,
        y: PAGE_MARGIN - 1,
        size: 8,
        font,
        color: mutedText,
      });
      const pageLabel = `Sida ${pageNumber} / ${pages.length}`;
      const labelWidth = (font as any).widthOfTextAtSize(pageLabel, 8);
      entry.drawText(pageLabel, {
        x: PAGE_WIDTH - PAGE_MARGIN - labelWidth,
        y: PAGE_MARGIN - 1,
        size: 8,
        font,
        color: mutedText,
      });
      const footerLogoImage = faviconImage || logoImage;
      const footerTextX = PAGE_MARGIN;
      if (footerLogoImage || footerBadgeImage) {
        let rightGroupX = PAGE_WIDTH - PAGE_MARGIN;
        if (footerLogoImage) {
          const maxLogoWidth = faviconImage ? 16 : 36;
          const maxLogoHeight = 16;
          const scale = Math.min(maxLogoWidth / footerLogoImage.width, maxLogoHeight / footerLogoImage.height, 1);
          const logoWidth = footerLogoImage.width * scale;
          const logoHeight = footerLogoImage.height * scale;
          const logoX = rightGroupX - logoWidth;
          const logoY = PAGE_MARGIN + 15;
          entry.drawImage(footerLogoImage, {
            x: logoX,
            y: logoY,
            width: logoWidth,
            height: logoHeight,
          });
          rightGroupX = logoX - 10;
        }
        if (footerBadgeImage) {
          const maxBadgeWidth = 116;
          const maxBadgeHeight = 18;
          const scale = Math.min(maxBadgeWidth / footerBadgeImage.width, maxBadgeHeight / footerBadgeImage.height, 1);
          const badgeWidth = footerBadgeImage.width * scale;
          const badgeHeight = footerBadgeImage.height * scale;
          entry.drawImage(footerBadgeImage, {
            x: rightGroupX - badgeWidth,
            y: PAGE_MARGIN + 14,
            width: badgeWidth,
            height: badgeHeight,
          });
        }
      }
      entry.drawText(`${BRAND.phone}  |  ${BRAND.email}  |  Org.nr ${BRAND.orgNumber}`, {
        x: footerTextX,
        y: PAGE_MARGIN + 14,
        size: 7.5,
        font,
        color: mutedText,
      });
    });

    const outBytes = await pdfDoc.save();
    const arrayBuf = outBytes.buffer.slice(outBytes.byteOffset, outBytes.byteLength + outBytes.byteOffset);

    const clientPart = toFileNamePart(clientName || 'client');
    const orderPart = toFileNamePart((orderId || projectNumber || 'order') as string);
    const fileName = `Egenkontroll_${clientPart}_${orderPart}.pdf`;

    return new Response(arrayBuf as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
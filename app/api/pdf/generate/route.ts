import { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();
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
      // Optional styling/branding knobs
      branding = {} as {
        companyName?: string;
        primaryColor?: string; // hex like #0ea5e9
        accentColor?: string;  // hex like #94a3b8
      },
    } = body || {};

    // Helpers
    const hexToRgb = (hex?: string) => {
      if (!hex) return { r: 0, g: 0.4, b: 0.8 }; // default blue-ish
      const h = hex.replace('#', '');
      const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return { r: r / 255, g: g / 255, b: b / 255 };
    };

    const primary = hexToRgb(branding.primaryColor || '#0ea5e9'); // sky-500
    const accent = hexToRgb(branding.accentColor || '#94a3b8');   // slate-400

    // Create a styled 1-page PDF (A4)
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait in points
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let pageWidth = page.getWidth();
  let pageHeight = page.getHeight();
  const margin = 10;
  // Global layout constants to keep spacing consistent
  const HEADER_HEIGHT = 40; // small header bar
  const HEADER_GAP = 10;    // small gap below header before content
  const SECTION_GAP = 10;   // gap between sections/tables
  let contentWidth = pageWidth - margin * 2;

    const printedOn = new Date().toISOString().slice(0, 10);
    const company = branding.companyName || 'Isoleringslandslaget';

  const drawPageChrome = () => {
      // Header bar
      page.drawRectangle({ x: 0, y: pageHeight - HEADER_HEIGHT, width: pageWidth, height: HEADER_HEIGHT, color: rgb(primary.r, primary.g, primary.b) });
      // Header text (kept inside the bar)
      const title = 'Installations Protokoll';
      const titleSize = 16;
      const companySize = 9;
      // Position text inside the 40pt bar, anchored near the bottom for two-line layout
      page.drawText(title, { x: margin, y: pageHeight - 22, size: titleSize, color: rgb(1, 1, 1), font: fontBold });
      page.drawText(company, { x: margin, y: pageHeight - 34, size: companySize, color: rgb(1, 1, 1), font });
      // Footer
      page.drawText(`Generated: ${printedOn}`, { x: margin, y: margin - 2, size: 8, color: rgb(accent.r, accent.g, accent.b), font });
      // Left accent stripe (exclude header area)
      page.drawRectangle({ x: margin - 8, y: margin, width: 4, height: pageHeight - margin - HEADER_HEIGHT, color: rgb(accent.r, accent.g, accent.b) });
      // Starting Y just below header with a tight gap
      return pageHeight - HEADER_HEIGHT - HEADER_GAP;
    };

    const newPage = () => {
      page = pdfDoc.addPage([595.28, 841.89]);
      pageWidth = page.getWidth();
      pageHeight = page.getHeight();
      contentWidth = pageWidth - margin * 2;
      return drawPageChrome();
    };

    let currentY = drawPageChrome();

    const ensureSpace = (needed: number) => {
      const bottomSafe = margin + 30; // keep footer safe zone
      if (currentY - needed < bottomSafe) {
        currentY = newPage();
      }
    };

    // Shared helpers for table layout
    const wrapTextIntoLines = (
      text: string,
      size: number,
      maxWidth: number,
      useBold = false
    ) => {
      const f = useBold ? fontBold : font;
      const words = (text || '').split(/\s+/);
      const lines: string[] = [];
      let line = '';
      const breakLongWord = (word: string) => {
        // Break a single long word into chunks that fit maxWidth
        const parts: string[] = [];
        let buf = '';
        for (const ch of word) {
          const test = buf + ch;
          const w = (f as any).widthOfTextAtSize(test, size);
          if (w > maxWidth && buf) {
            parts.push(buf);
            buf = ch;
          } else {
            buf = test;
          }
        }
        if (buf) parts.push(buf);
        return parts;
      };
      for (const w of words) {
        const wWidth = (f as any).widthOfTextAtSize(w, size);
        // If the word itself is longer than the column and we're at line start, hard-break the word
        if (!line && wWidth > maxWidth) {
          const chunks = breakLongWord(w);
          for (const c of chunks) lines.push(c);
          continue;
        }
        const test = line ? line + ' ' + w : w;
        const width = (f as any).widthOfTextAtSize(test, size);
        if (width > maxWidth && line) {
          // Push current line and start a new one with w (breaking if necessary)
          lines.push(line);
          if ((f as any).widthOfTextAtSize(w, size) > maxWidth) {
            const chunks = breakLongWord(w);
            // First chunk becomes the new line; the rest go as complete lines
            line = chunks.shift() || '';
            for (const c of chunks) {
              if (line) {
                lines.push(line);
              }
              line = c;
            }
          } else {
            line = w;
          }
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      return lines;
    };

    const scaleToFit = (base: number[], target: number) => {
      const sum = base.reduce((a, b) => a + b, 0) || 1;
      const scale = target / sum;
      const scaled = base.map((w) => Math.floor(w * scale));
      // Adjust the last column so widths add up exactly to target (avoid rounding drift)
      const diff = target - scaled.reduce((a, b) => a + b, 0);
      scaled[scaled.length - 1] += diff;
      return scaled;
    };

    // Section card helper
  const drawSection = (titleText: string, rows: Array<{ label: string; value: string }>) => {
  const cardPadding = 14;
  const rowGap = 10;
  const labelSize = 8;
  const valueSize = 10;

      // Measure rows to get needed height
      const measureWrapped = (text: string, size: number) => {
        const maxWidth = contentWidth - cardPadding * 2;
        const words = (text || '').split(/\s+/);
        let lines = 0;
        let line = '';
        for (const w of words) {
          const test = line ? line + ' ' + w : w;
          const width = (font as any).widthOfTextAtSize(test, size);
          if (width > maxWidth && line) {
            lines++;
            line = w;
          } else {
            line = test;
          }
        }
        if (line) lines++;
        return { lines, height: lines * (size + 2) };
      };

      // Title
  const titleSize = 11;
      const titleHeight = titleSize + 8;
      let contentHeight = titleHeight + 6;
      for (const r of rows) {
        const vMeasure = measureWrapped(r.value || '-', valueSize);
        contentHeight += labelSize + 2 + vMeasure.height + rowGap;
      }
      contentHeight += cardPadding; // bottom padding

      // Paginate if needed
  ensureSpace(contentHeight + SECTION_GAP);

      const yTop = currentY;
      let yCursor = yTop - cardPadding;

      // Card background
      page.drawRectangle({
        x: margin,
        y: yTop - contentHeight,
        width: contentWidth,
        height: contentHeight,
        color: rgb(0.98, 0.99, 1),
        opacity: 1,
      });

      // Card border
      page.drawRectangle({
        x: margin,
        y: yTop - contentHeight,
        width: contentWidth,
        height: contentHeight,
        borderColor: rgb(accent.r, accent.g, accent.b),
        borderWidth: 1,
        color: undefined as any,
      });

      // Title text
      page.drawText(titleText, {
        x: margin + cardPadding,
        y: yTop - cardPadding - titleSize,
        size: titleSize,
        font: fontBold,
        color: rgb(0.12, 0.12, 0.14),
      });

      yCursor = yTop - cardPadding - titleHeight - 6;

      // Rows
      const drawWrapped = (text: string, x: number, y: number, size: number) => {
        const maxWidth = contentWidth - cardPadding * 2;
        const words = (text || '').split(/\s+/);
        let line = '';
        let yPtr = y;
        for (const w of words) {
          const test = line ? line + ' ' + w : w;
          const width = (font as any).widthOfTextAtSize(test, size);
          if (width > maxWidth && line) {
            page.drawText(line, { x, y: yPtr, size, font, color: rgb(0.12, 0.12, 0.14) });
            yPtr -= size + 2;
            line = w;
          } else {
            line = test;
          }
        }
        if (line) {
          page.drawText(line, { x, y: yPtr, size, font, color: rgb(0.12, 0.12, 0.14) });
          yPtr -= size + 2;
        }
        return yPtr;
      };

      for (const r of rows) {
        // Label (small caps style)
        page.drawText(r.label.toUpperCase(), {
          x: margin + cardPadding,
          y: yCursor,
          size: labelSize,
          font: fontBold,
          color: rgb(accent.r, accent.g, accent.b),
        });
        yCursor -= labelSize + 2;

        // Value (wrapped)
        yCursor = drawWrapped(r.value || '-', margin + cardPadding, yCursor, valueSize);
        yCursor -= rowGap;
      }

  currentY = yTop - contentHeight - SECTION_GAP; // advance cursor (tighter)
    };

    // Two-column section card helper (for 'Projekt')
    const drawSectionTwoCols = (
      titleText: string,
      leftRows: Array<{ label: string; value: string }>,
      rightRows: Array<{ label: string; value: string }>
    ) => {
      const cardPadding = 14;
      const rowGap = 10;
      const labelSize = 8;
      const valueSize = 10;
      const colGap = 14;
      const colWidth = (contentWidth - cardPadding * 2 - colGap) / 2;

      // Measure wrapped height for a value constrained to a column
      const measureWrappedCol = (text: string, size: number) => {
        const maxWidth = colWidth;
        const words = (text || '').split(/\s+/);
        let lines = 0;
        let line = '';
        for (const w of words) {
          const test = line ? line + ' ' + w : w;
          const width = (font as any).widthOfTextAtSize(test, size);
          if (width > maxWidth && line) {
            lines++;
            line = w;
          } else {
            line = test;
          }
        }
        if (line) lines++;
        return { lines, height: lines * (size + 2) };
      };

      // Title
      const titleSize = 11;
      const titleHeight = titleSize + 8;

      // Measure columns
      const measureCol = (rows: Array<{ label: string; value: string }>) => {
        let h = 0;
        for (const r of rows) {
          const v = measureWrappedCol(r.value || '-', valueSize);
          h += labelSize + 2 + v.height + rowGap;
        }
        return h;
      };
      const leftHeight = measureCol(leftRows);
      const rightHeight = measureCol(rightRows);
      const bodyHeight = Math.max(leftHeight, rightHeight);
      const contentHeight = titleHeight + 6 + bodyHeight + cardPadding; // include bottom padding

      // Paginate if needed
      ensureSpace(contentHeight + SECTION_GAP);

      const yTop = currentY;

      // Card background and border
      page.drawRectangle({
        x: margin,
        y: yTop - contentHeight,
        width: contentWidth,
        height: contentHeight,
        color: rgb(0.98, 0.99, 1),
        opacity: 1,
      });
      page.drawRectangle({
        x: margin,
        y: yTop - contentHeight,
        width: contentWidth,
        height: contentHeight,
        borderColor: rgb(accent.r, accent.g, accent.b),
        borderWidth: 1,
        color: undefined as any,
      });

      // Title text
      page.drawText(titleText, {
        x: margin + cardPadding,
        y: yTop - cardPadding - titleSize,
        size: titleSize,
        font: fontBold,
        color: rgb(0.12, 0.12, 0.14),
      });

      // Draw columns
      const drawWrappedCol = (text: string, x: number, y: number, size: number) => {
        const maxWidth = colWidth;
        const words = (text || '').split(/\s+/);
        let line = '';
        let yPtr = y;
        for (const w of words) {
          const test = line ? line + ' ' + w : w;
          const width = (font as any).widthOfTextAtSize(test, size);
          if (width > maxWidth && line) {
            page.drawText(line, { x, y: yPtr, size, font, color: rgb(0.12, 0.12, 0.14) });
            yPtr -= size + 2;
            line = w;
          } else {
            line = test;
          }
        }
        if (line) {
          page.drawText(line, { x, y: yPtr, size, font, color: rgb(0.12, 0.12, 0.14) });
          yPtr -= size + 2;
        }
        return yPtr;
      };

      const leftX = margin + cardPadding;
      const rightX = leftX + colWidth + colGap;
      let leftY = yTop - cardPadding - titleHeight - 6;
      let rightY = leftY;

      for (const r of leftRows) {
        // Label
        page.drawText(r.label.toUpperCase(), {
          x: leftX,
          y: leftY,
          size: labelSize,
          font: fontBold,
          color: rgb(accent.r, accent.g, accent.b),
        });
        leftY -= labelSize + 2;
        // Value
        leftY = drawWrappedCol(r.value || '-', leftX, leftY, valueSize);
        leftY -= rowGap;
      }

      for (const r of rightRows) {
        page.drawText(r.label.toUpperCase(), {
          x: rightX,
          y: rightY,
          size: labelSize,
          font: fontBold,
          color: rgb(accent.r, accent.g, accent.b),
        });
        rightY -= labelSize + 2;
        rightY = drawWrappedCol(r.value || '-', rightX, rightY, valueSize);
        rightY -= rowGap;
      }

      currentY = yTop - contentHeight - SECTION_GAP;
    };

  // Content sections
  // First section: requested fields + address, renamed to 'Projekt'
  drawSectionTwoCols(
    'Projekt',
    [
      { label: 'Installations datum', value: String(installationDate ?? '') },
      { label: 'Adress', value: String(streetAddress ?? '') },
      { label: 'Projekt nr', value: String(projectNumber ?? '') },
    ],
    [
      { label: 'Installatör', value: String(installerName ?? '') },
      { label: 'Kund/Beställare', value: String(clientName ?? '') },
    ]
  );

  // Installer section removed; included in 'Projekt' above

  drawSection('Material', [
      { label: 'Använd material', value: String(materialUsed ?? '') },
    ]);

    // Checks
    const renderCheck = (c: any) => {
      const ok = !!c?.ok;
      const comment = String(c?.comment ?? '').trim();
      const box = ok ? '[x]' : '[ ]';
      if (ok) return comment ? `${box} OK - ${comment}` : `${box} OK`;
      return comment ? `${box} ${comment}` : `${box}`;
    };
    const t1 = checks?.takfotsventilation || {};
    const t2 = checks?.snickerier || {};
    const t3 = checks?.tatskikt || {};
    const t4 = checks?.genomforningar || {};
    const t5 = checks?.grovstadning || {};
    const t6 = checks?.markskylt || {};
    const otherComments = String(checks?.ovrigaKommentarer?.comment ?? '').trim();
    drawSection('Kontroller', [
      { label: 'Takfotsventilation', value: renderCheck(t1) },
      { label: 'Snickerier', value: renderCheck(t2) },
      { label: 'Tätskikt', value: renderCheck(t3) },
      { label: 'Genomförningar', value: renderCheck(t4) },
      { label: 'Grovstädning', value: renderCheck(t5) },
      { label: 'Märkskylt', value: renderCheck(t6) },
      { label: 'Övriga kommentarer', value: otherComments || '-' },
    ]);

    // Etapper table
    const drawEtapperOpenTable = () => {
      const headers = [
  'Etapp (öppet)',
  'Yta m²',
  'Beställd tjocklek (ex sättningspåslag)',
  'Sättningspåslag %',
  'Installerad tjocklek (inkl sättningspåslag)',
  'Antal säck',
  'Installerad densitet kg/m³',
  'Lambdavärde W/m²K',
      ];
  const baseColWidths = [60, 50, 120, 80, 140, 100, 120, 120];
      const x0 = margin;
      const innerPadX = 12; // left/right padding within card
      const innerWidth = contentWidth - innerPadX * 2;
      const colWidths = scaleToFit(baseColWidths, innerWidth);
  const headerFontSize = 8;
      const lineGap = 2;
  const rowHeight = 14;
  const cellPad = 2;

      // Data
      const items = etapperOpen.filter((r: any) =>
        Object.values(r || {}).some((v: any) => String(v ?? '').trim() !== '')
      );

      // Measure header lines per column (wrapped to column width)
      const headerLines = headers.map((h, i) =>
        wrapTextIntoLines(h, headerFontSize, Math.max(4, colWidths[i] - 4), true)
      );
      const headerLinesCount = headerLines.reduce((m, lines) => Math.max(m, lines.length), 1);
      const headerHeight = headerLinesCount * (headerFontSize + lineGap);

      // Total card height: static top area (title + spacing) + header + rows + bottom padding
  const staticTop = 28; // tighter gap above headers
  const bottomPad = 14; // tighter bottom padding
      const rowsCount = Math.max(1, items.length);
      const height = staticTop + headerHeight + rowsCount * rowHeight + bottomPad;

      ensureSpace(height + 16);
      const yTop = currentY;

      // Card background and border
      page.drawRectangle({ x: x0, y: yTop - height, width: contentWidth, height, color: rgb(0.98, 0.99, 1) });
      page.drawRectangle({ x: x0, y: yTop - height, width: contentWidth, height, borderColor: rgb(accent.r, accent.g, accent.b), borderWidth: 1, color: undefined as any });

      // Title
      page.drawText('Etapper (öppet)', {
        x: x0 + innerPadX,
        y: yTop - 13,
        size: 10.5,
        font: fontBold,
        color: rgb(0.12, 0.12, 0.14),
      });

      // Column X positions
      const colXsOpen: number[] = [];
      {
        let acc = x0 + innerPadX;
        for (const w of colWidths) {
          colXsOpen.push(acc);
          acc += w;
        }
      }
      // Headers (wrapped) align: right for numeric columns, left for text
  const yHeaderTop = yTop - staticTop;
  const alignRightOpen = [false, false, false, false, false, false, false, false];
      headerLines.forEach((lines, i) => {
        let y = yHeaderTop;
        const colW = colWidths[i];
        const colX = colXsOpen[i];
        for (const ln of lines) {
          const w = (fontBold as any).widthOfTextAtSize(ln, headerFontSize);
          const x = alignRightOpen[i]
            ? colX + Math.max(cellPad, colW - cellPad - w)
            : colX + cellPad;
          page.drawText(ln, {
            x,
            y,
            size: headerFontSize,
            font: fontBold,
            color: rgb(accent.r, accent.g, accent.b),
          });
          y -= headerFontSize + lineGap;
        }
      });
      // Header bottom separator
      const headerBottomYOpen = yHeaderTop - headerHeight - 2;
      page.drawRectangle({ x: x0 + innerPadX, y: headerBottomYOpen, width: innerWidth, height: 0.5, color: rgb(accent.r, accent.g, accent.b), opacity: 0.3 });

      // Data rows with consistent row top/bottom and aligned separators
      const rows = items.length ? items : [{}];
      const vPad = Math.floor((rowHeight - 9) / 2);
      let rowTopYOpen = headerBottomYOpen - 4; // small gap after header
      rows.forEach((_r: any, _i: number) => {
        // draw row bottom line first for crisp alignment
        const rowBottomY = rowTopYOpen - rowHeight;
        page.drawRectangle({ x: x0 + innerPadX, y: rowBottomY, width: innerWidth, height: 0.5, color: rgb(accent.r, accent.g, accent.b), opacity: 0.15 });
        rowTopYOpen -= rowHeight;
      });
      // Now draw cell text over rows
      rowTopYOpen = headerBottomYOpen - 4;
      rows.forEach((r: any) => {
        const cells = [
          r.etapp ?? '',
          r.ytaM2 ?? '',
          r.bestalldTjocklek ?? '',
          r.sattningsprocent ?? '',
          r.installeradTjocklek ?? '',
          r.antalSack ?? '',
          r.installeradDensitet ?? '',
          r.lambdavarde ?? '',
        ];
        const textY = rowTopYOpen - vPad - 9; // baseline
        cells.forEach((c, i) => {
          const colW = colWidths[i];
          const colX = colXsOpen[i];
          const text = String(c);
          const w = (font as any).widthOfTextAtSize(text, 9);
          const x = alignRightOpen[i] ? colX + Math.max(cellPad, colW - cellPad - w) : colX + cellPad;
          page.drawText(text, { x, y: textY, size: 9, font, color: rgb(0.12, 0.12, 0.14) });
        });
        rowTopYOpen -= rowHeight;
      });
      // Column separators on column right edges
      const tableBottomYOpen = yTop - height + bottomPad + 2;
      for (let i = 0; i < colXsOpen.length - 1; i++) {
        const bx = colXsOpen[i] + colWidths[i];
        page.drawRectangle({ x: bx, y: tableBottomYOpen, width: 0.5, height: headerBottomYOpen - tableBottomYOpen, color: rgb(accent.r, accent.g, accent.b), opacity: 0.15 });
      }

  currentY = yTop - height - SECTION_GAP;
    };

    const drawEtapperClosedTable = () => {
      const headers = [
        'Etapp (slutet)',
        'Yta m²',
        'Beställd tjocklek',
        'Uppmät tjocklek',
        'Antal säck',
        'Installerad densitet kg/m³',
        'Lambdavärde W/m²K',
      ];
      const baseColWidths = [80, 60, 100, 100, 120, 120, 120];
      const x0 = margin;
      const innerPadX = 12;
      const innerWidth = contentWidth - innerPadX * 2;
      const colWidths = scaleToFit(baseColWidths, innerWidth);
      const headerFontSize = 8;
      const lineGap = 2;
      const rowHeight = 14;
      const cellPad = 2;

      const items = etapperClosed.filter((r: any) =>
        Object.values(r || {}).some((v: any) => String(v ?? '').trim() !== '')
      );

      const headerLines = headers.map((h, i) =>
        wrapTextIntoLines(h, headerFontSize, Math.max(4, colWidths[i] - 4), true)
      );
      const headerLinesCount = headerLines.reduce((m, lines) => Math.max(m, lines.length), 1);
      const headerHeight = headerLinesCount * (headerFontSize + lineGap);

      const staticTop = 28; // tighter to match open table
      const bottomPad = 14;
      const rowsCount = Math.max(1, items.length);
      const height = staticTop + headerHeight + rowsCount * rowHeight + bottomPad;

      ensureSpace(height + 16);
      const yTop = currentY;

      page.drawRectangle({ x: x0, y: yTop - height, width: contentWidth, height, color: rgb(0.98, 0.99, 1) });
      page.drawRectangle({ x: x0, y: yTop - height, width: contentWidth, height, borderColor: rgb(accent.r, accent.g, accent.b), borderWidth: 1, color: undefined as any });

      page.drawText('Etapper (slutet)', {
        x: x0 + innerPadX,
        y: yTop - 13,
        size: 10.5,
        font: fontBold,
        color: rgb(0.12, 0.12, 0.14),
      });

      // Column X positions
      const colXsClosed: number[] = [];
      {
        let acc = x0 + innerPadX;
        for (const w of colWidths) {
          colXsClosed.push(acc);
          acc += w;
        }
      }
      // Headers (align with cell alignment)
  const yHeaderTop = yTop - staticTop;
  const alignRightClosed = [false, false, false, false, false, false, false];
      headerLines.forEach((lines, i) => {
        let y = yHeaderTop;
        const colW = colWidths[i];
        const colX = colXsClosed[i];
        for (const ln of lines) {
          const w = (fontBold as any).widthOfTextAtSize(ln, headerFontSize);
          const x = alignRightClosed[i]
            ? colX + Math.max(cellPad, colW - cellPad - w)
            : colX + cellPad;
          page.drawText(ln, { x, y, size: headerFontSize, font: fontBold, color: rgb(accent.r, accent.g, accent.b) });
          y -= headerFontSize + lineGap;
        }
      });
      // Header bottom separator
      const headerBottomYClosed = yHeaderTop - headerHeight - 2;
      page.drawRectangle({ x: x0 + innerPadX, y: headerBottomYClosed, width: innerWidth, height: 0.5, color: rgb(accent.r, accent.g, accent.b), opacity: 0.3 });

      // Row lines
      const rowsClosed = items.length ? items : [{}];
      const vPadClosed = Math.floor((rowHeight - 9) / 2);
      let rowTopYClosed = headerBottomYClosed - 4;
      rowsClosed.forEach((_r: any) => {
        const rowBottomY = rowTopYClosed - rowHeight;
        page.drawRectangle({ x: x0 + innerPadX, y: rowBottomY, width: innerWidth, height: 0.5, color: rgb(accent.r, accent.g, accent.b), opacity: 0.15 });
        rowTopYClosed -= rowHeight;
      });
      // Cell text
      rowTopYClosed = headerBottomYClosed - 4;
      rowsClosed.forEach((r: any) => {
        const cells = [
          r.etapp ?? '',
          r.ytaM2 ?? '',
          r.bestalldTjocklek ?? '',
          r.uppmatTjocklek ?? '',
          r.antalSackKgPerSack ?? '',
          r.installeradDensitet ?? '',
          r.lambdavarde ?? '',
        ];
        const textY = rowTopYClosed - vPadClosed - 9;
        cells.forEach((c, i) => {
          const colW = colWidths[i];
          const colX = colXsClosed[i];
          const text = String(c);
          const w = (font as any).widthOfTextAtSize(text, 9);
          const x = alignRightClosed[i] ? colX + Math.max(cellPad, colW - cellPad - w) : colX + cellPad;
          page.drawText(text, { x, y: textY, size: 9, font, color: rgb(0.12, 0.12, 0.14) });
        });
        rowTopYClosed -= rowHeight;
      });
      // Column separators at column right edges
      const tableBottomYClosed = yTop - height + bottomPad + 2;
      for (let i = 0; i < colXsClosed.length - 1; i++) {
        const bx = colXsClosed[i] + colWidths[i];
        page.drawRectangle({ x: bx, y: tableBottomYClosed, width: 0.5, height: headerBottomYClosed - tableBottomYClosed, color: rgb(accent.r, accent.g, accent.b), opacity: 0.15 });
      }

      currentY = yTop - height - SECTION_GAP;
    };

    drawEtapperOpenTable();
    drawEtapperClosedTable();

    // Signature fields (always render): Datum & ort, Underskrift, Namnförtydligande
    {
      const signatureDataUrl = String((body && body.signature) || '');
      let sigImage: { width: number; height: number } | null = null;
      if (signatureDataUrl.startsWith('data:image/jpeg') || signatureDataUrl.startsWith('data:image/jpg')) {
        try {
          const jpgBase64 = signatureDataUrl.split(',')[1] || '';
          const jpgBytes = Buffer.from(jpgBase64, 'base64');
          sigImage = await (pdfDoc as any).embedJpg?.(jpgBytes);
        } catch {}
      } else if (signatureDataUrl.startsWith('data:image/png')) {
        try {
          const pngBase64 = signatureDataUrl.split(',')[1] || '';
          const pngBytes = Buffer.from(pngBase64, 'base64');
          sigImage = await (pdfDoc as any).embedPng(pngBytes);
        } catch {}
      }

      const title = 'Signatur';
      const titleSize = 11;
      const labelSize = 8;
      const valueSize = 10;
      const pad = 14;
      const labelColW = 140; // left column width for labels
      const lineGap = 10;
      const row1H = 26;
      const row2H = 26; // taller for signature image
      const row3H = 26;
      const titleHeight = titleSize + 8;
      const contentH = titleHeight + 6 + row1H + lineGap + row2H + lineGap + row3H;

      ensureSpace(contentH + SECTION_GAP);
      const yTop = currentY;

      // Title
      page.drawText(title, {
        x: margin + pad,
        y: yTop - pad - titleSize,
        size: titleSize,
        font: fontBold,
        color: rgb(0.12, 0.12, 0.14),
      });

      let y = yTop - pad - titleHeight - 6;
      const xLabel = margin + pad;
      const xLine = xLabel + labelColW + 8;
      const lineW = contentWidth - (xLine - margin) - pad;
      const lineColor = rgb(accent.r, accent.g, accent.b);

      const drawLine = (yLine: number) => {
        page.drawRectangle({ x: xLine, y: yLine, width: lineW, height: 0.7, color: lineColor, opacity: 0.5 });
      };

      // Row 1: Datum och ort (from explicit field)
      page.drawText('Datum och ort'.toUpperCase(), { x: xLabel, y, size: labelSize, font: fontBold, color: lineColor });
      const row1Base = y - (labelSize + 4);
      drawLine(row1Base);
      const dateCity = String(body?.signatureDateCity || '').trim();
      if (dateCity) {
        page.drawText(dateCity, { x: xLine + 4, y: row1Base - (valueSize - 14), size: valueSize, font, color: rgb(0.12, 0.12, 0.14) });
      }
      y = row1Base - row1H + lineGap;

      // Row 2: Underskrift (signature image if present)
      page.drawText('Underskrift'.toUpperCase(), { x: xLabel, y, size: labelSize, font: fontBold, color: lineColor });
      const row2Base = y - (labelSize + 4);
      drawLine(row2Base);
      if (sigImage) {
        const maxW = lineW;
        const maxH = 36; // previous generated layout cap
        const scale = Math.min(maxW / sigImage.width, maxH / sigImage.height, 1);
        const w = sigImage.width * scale;
        const h = sigImage.height * scale;
        const imgX = xLine;
  // Place the image overlapping the line slightly for a natural signed look
  const imgY = row2Base - h * 0.25;
        page.drawImage(sigImage as any, { x: imgX, y: imgY, width: w, height: h });
      }
      // Render a light right-aligned timestamp as a watermark-like note
      {
        const tsRaw = String(body?.signatureTimestamp || '').trim();
        const tz = String(body?.signatureTimeZone || '').trim();
        if (tsRaw) {
          const d = new Date(tsRaw);
          const valid = !isNaN(d.getTime());
          const pad = (n: number) => (n < 10 ? '0' + n : String(n));
          const formatWithTZ = (date: Date) => {
            try {
              if (tz) {
                const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                const parts = fmt.formatToParts(date).reduce((acc: any, p) => (acc[p.type] = p.value, acc), {} as any);
                return `Signed at: ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${tz}`;
              }
            } catch {}
            return `Signed at: ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
          };
          const stamp = valid ? formatWithTZ(d) : `Signed at: ${tsRaw}`;
          const noteSize = 8;
          const noteW = (font as any).widthOfTextAtSize(stamp, noteSize);
          const noteX = xLine + lineW - noteW;
          const noteY = row2Base + 10; // slightly above the line
          page.drawText(stamp, { x: noteX, y: noteY, size: noteSize, font, color: rgb(accent.r, accent.g, accent.b) });
        }
      }
      y = row2Base - row2H + lineGap;

      // Row 3: Namnförtydligande (installer name)
      page.drawText('Namnförtydligande'.toUpperCase(), { x: xLabel, y, size: labelSize, font: fontBold, color: lineColor });
      const row3Base = y - (labelSize + 4);
      drawLine(row3Base);
  const printedName = String(installerName || '').trim().toUpperCase();
      if (printedName) {
        page.drawText(printedName, { x: xLine + 4, y: row3Base - (valueSize - 14), size: valueSize, font, color: rgb(0.12, 0.12, 0.14) });
      }

      currentY = yTop - contentH - SECTION_GAP;
    }

  // Re-enable template overlay as the primary output. Keep generated layout as fallback only.
  let outBytes: Uint8Array;
  try {
    // Helpers for overlay
    const mm = (v: number) => (72 / 25.4) * v; // convert millimeters to PDF points
    // Try to read template from filesystem; if not available (e.g., serverless), fetch from public URL
    const templatePath = path.join(process.cwd(), 'public', 'templates', 'EgenKontrollMall.pdf');
    let templateData: Uint8Array | Buffer;
    try {
      templateData = await readFile(templatePath);
    } catch {
      const reqUrl = new URL(req.url);
      const origin = req.headers.get('origin') || `${reqUrl.protocol}//${reqUrl.host}`;
      const url = `${origin}/templates/EgenKontrollMall.pdf`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load template over HTTP: ${res.status}`);
      const ab = await res.arrayBuffer();
      templateData = new Uint8Array(ab);
    }
    const templateDoc = await (PDFDocument as any).load(templateData);
    const finalDoc = await PDFDocument.create();
    const pageCount = (templateDoc as any).getPageCount ? (templateDoc as any).getPageCount() : 1;
    const tmplIndices = Array.from({ length: pageCount }, (_, i) => i);
    const tmplPages = await (finalDoc as any).copyPages(templateDoc, tmplIndices);
    tmplPages.forEach((p: any) => finalDoc.addPage(p));

    // Fonts for overlay text
    const tFont = await finalDoc.embedFont(StandardFonts.Helvetica);
    const tBold = await finalDoc.embedFont(StandardFonts.HelveticaBold);
    const debug = !!(body && body.templateDebugOverlay?.true);
    const overlayOffsets = (body && (body as any).templateOverlayOffsets) || {};
    const getOffset = (key: string) => {
      const o = overlayOffsets[key] || {};
      const dxp = typeof o.dxMm === 'number' ? mm(o.dxMm) : 0;
      const dyp = typeof o.dyMm === 'number' ? mm(o.dyMm) : 0;
      return { dx: dxp, dy: dyp };
    };

    // Optional per-request tiny nudge adjustments for calibration
    const adj = (body && body.templateOverlayAdjust) || {}; // { dxMm?: number, dyMm?: number }
    const dx = typeof adj.dxMm === 'number' ? mm(adj.dxMm) : 0;
    const dy = typeof adj.dyMm === 'number' ? mm(adj.dyMm) : 0;

    // Page 1 overlay
    const tPage = (finalDoc as any).getPage(0);
    const tW = tPage.getWidth();
    const tH = tPage.getHeight();
    // yTop helper: provide Y in mm from top edge for easier reasoning
    const yTop = (mmFromTop: number) => tH - mmFromTop + dy;
    const mark = (x: number, y: number, label: string) => {
      if (!debug) return;
      // small crosshair and label for calibration
      const sz = 3;
      tPage.drawRectangle({ x: x - sz, y, width: sz * 2, height: 0.5, color: rgb(1, 0, 0), opacity: 0.7 });
      tPage.drawRectangle({ x, y: y - sz, width: 0.5, height: sz * 2, color: rgb(1, 0, 0), opacity: 0.7 });
      tPage.drawText(label, { x: x + 4, y: y + 2, size: 7, font: tFont, color: rgb(0.8, 0, 0) });
    };
    const drawLabelAt = (key: string, txt: string, x: number, y: number) => {
      const { dx, dy } = getOffset(key);
      const X = x + dx;
      const Y = y + dy;
      mark(X, Y, key);
      tPage.drawText(txt.toUpperCase(), { x: X, y: Y, size: labelSize, font: tBold, color: labelColor });
    };
    const drawValueAt = (key: string, txt: string, x: number, y: number) => {
      const { dx, dy } = getOffset(key);
      const X = x + dx;
      const Y = y + dy;
      mark(X, Y, key);
      tPage.drawText(txt, { x: X, y: Y, size: valueSize, font: tFont, color: textColor });
    };

    // Draw wrapped value within max width; returns total height used in points
    const drawWrappedValueAt = (key: string, txt: string, x: number, y: number, maxWidth: number): number => {
      const { dx, dy } = getOffset(key);
      const X = x + dx;
      const baseY = y + dy;

      const raw = String(txt || '').trim();

      const buildLines = (size: number): string[] => {
        const result: string[] = [];
        const pushOrSplitLongWord = (word: string) => {
          if ((tFont as any).widthOfTextAtSize(word, size) <= maxWidth) {
            result.push(word);
            return;
          }
          let chunk = '';
          for (const ch of word) {
            const test = chunk + ch;
            if ((tFont as any).widthOfTextAtSize(test, size) <= maxWidth) {
              chunk = test;
            } else {
              if (chunk) result.push(chunk);
              chunk = ch;
            }
          }
          if (chunk) result.push(chunk);
        };

        if (raw.length > 0) {
          const words = raw.split(/\s+/);
          let current = '';
          for (const w of words) {
            const test = current ? current + ' ' + w : w;
            if ((tFont as any).widthOfTextAtSize(test, size) <= maxWidth) {
              current = test;
            } else {
              if (current) result.push(current);
              if ((tFont as any).widthOfTextAtSize(w, size) > maxWidth) {
                pushOrSplitLongWord(w);
                current = '';
              } else {
                current = w;
              }
            }
          }
          if (current) result.push(current);
        }
        return result;
      };

      // Start with default size; if wrapping is needed, try a slightly smaller font
      let usedSize = valueSize;
      let lines = buildLines(usedSize);
      if (lines.length > 1) {
        const smaller = Math.max(7, valueSize - 2);
        const smallerLines = buildLines(smaller);
        if (smallerLines.length <= lines.length) {
          usedSize = smaller;
          lines = smallerLines;
        }
      }

      const lineH = usedSize + 2;
      const count = Math.max(1, lines.length);

      // Shift the block upward so wrapped text stays within the box
      const adjustedBaseY = baseY + (count - 1) * lineH;

      // Debug mark once at the first line baseline
      mark(X, adjustedBaseY, key);
      for (let i = 0; i < lines.length; i++) {
        const lineY = adjustedBaseY - (usedSize + 2) - i * lineH;
        tPage.drawText(lines[i], { x: X, y: lineY, size: usedSize, font: tFont, color: textColor });
      }
      return count * lineH;
    };

    // Coordinate map (in mm) — initial guesses; adjust with templateOverlayAdjust or we can tweak here
    const coords = {
      projekt: {
        leftX: mm(25) + dx,
        rightX: mm(142) + dx,
        topMm:  mm(28), // top of section from top edge
        gapMm:  mm(10),
  valueWidthMm: mm(55),
      },
      material: {
        x: mm(18) + dx,
        topMm: mm(38),
      },
      tables: {
        open: {
          x: mm(18) + dx,
          topMm: mm(165),
          rowHeightMm: mm(7.5),
          colPadMm: mm(1.5),
          // Widths tuned approximately to template columns; adjust with offsets if needed
          colWidthsMm: [mm(24), mm(15), mm(28), mm(20), mm(28), mm(20), mm(16), mm(28)],
          maxRows: 8,
        },
        closed: {
          x: mm(18) + dx,
          topMm: mm(201),
          rowHeightMm: mm(7.5),
          colPadMm: mm(1.5),
          colWidthsMm: [mm(24), mm(15), mm(28), mm(20), mm(28), mm(20), mm(28)],
          maxRows: 8,
        },
      },
      checks: {
        okX: mm(53) + dx,       // column for the checkbox mark ("X")
        commentX: mm(62) + dx,  // column for the comment text
        topMm: mm(87),
        lineGapMm: mm(8),
      },
      comments: {
        labelX: mm(35) + dx,
        valueX: mm(62) + dx,
        yTopMm: mm(135),
      },
      signature: {
        labelX: mm(25) + dx,
        lineX: mm(67) + dx,
        lineW: mm(100),
        dateCityTopMm: mm(237),
        signatureTopMm: mm(248),
        nameTopMm: mm(252),
        imgMaxW: mm(95),
        imgMaxH: mm(14),
      },
    } as const;

    const labelSize = 8;
    const valueSize = 10;
    const labelColor = rgb(accent.r, accent.g, accent.b);
    const textColor = rgb(0.12, 0.12, 0.14);

    // Draw a label/value helper aligned to baseline
    const drawLabel = (txt: string, x: number, y: number) => {
      tPage.drawText(txt.toUpperCase(), { x, y, size: labelSize, font: tBold, color: labelColor });
    };
    const drawValue = (txt: string, x: number, y: number) => {
      tPage.drawText(txt, { x, y, size: valueSize, font: tFont, color: textColor });
    };

    // Projekt: single column (stacked values) on right side
    {
      const p = coords.projekt;
      let y = yTop(p.topMm);
      const x = p.rightX; // move all project values to the right column

      drawValueAt('projekt.installationsdatum', String(installationDate || ''), x, y - (valueSize + 2));
      y -= p.gapMm;

       drawValueAt('projekt.installator', String(installerName || ''), x, y - (valueSize + 2));
      y -= p.gapMm;

       drawValueAt('projekt.kund', String(clientName || ''), x, y - (valueSize + 2));
      y -= p.gapMm;

      drawValueAt('projekt.projektnr', String(projectNumber || ''), x, y - (valueSize + 2));
      y -= p.gapMm;

      const fullAddr = [String(streetAddress || ''), [postalCode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const usedH = drawWrappedValueAt('projekt.adress', fullAddr, x, y, p.valueWidthMm);
  y -= p.gapMm + Math.max(0, usedH - (valueSize + 2));

    }

  // Material (simple value in left column area)
    {
      const m = coords.material;
      const y = yTop(m.topMm);
  drawValueAt('material.anvandmaterial', String(materialUsed || ''), m.x, y - (valueSize + 2));
    }

    // Etapper (öppet) table values overlay
    {
      const t = coords.tables.open;
      const tableOff = getOffset('tables.open');
      const x0 = t.x + tableOff.dx;
      let yRowTop = yTop(t.topMm) + tableOff.dy;
      const colXs: number[] = [];
      let acc = x0;
      for (const w of t.colWidthsMm) {
        colXs.push(acc);
        acc += w;
      }
      const items = (etapperOpen || []).filter((r: any) => Object.values(r || {}).some((v: any) => String(v ?? '').trim() !== ''));
      const rows = items.slice(0, t.maxRows);
      const vPad = 2; // points offset inside cell
      rows.forEach((r: any, rowIdx: number) => {
        // Order matches template: density before amount of bags, then lambda
        const cells = [
          r.etapp ?? '',
          r.ytaM2 ?? '',
          r.bestalldTjocklek ?? '',
          r.sattningsprocent ?? '',
          r.installeradTjocklek ?? '',
          r.installeradDensitet ?? '',
          r.antalSack ?? '',
          r.lambdavarde ?? '',
        ];
        const baseline = yRowTop - (t.rowHeightMm * 0.5);
        cells.forEach((c, i) => {
          const colX = colXs[i] + t.colPadMm;
          const cellKey = `tables.open.r${rowIdx + 1}.c${i + 1}`;
          const cellOff = getOffset(cellKey);
          const drawX = colX + cellOff.dx;
          const drawY = baseline - vPad + cellOff.dy;
          mark(drawX, baseline + cellOff.dy, cellKey);
          const text = String(c);
          if (text) {
            tPage.drawText(text, { x: drawX, y: drawY, size: 9, font: tFont, color: textColor });
          }
        });
        yRowTop -= t.rowHeightMm;
      });
    }

    // Etapper (slutet) table values overlay
    {
      const t = coords.tables.closed;
      const tableOff = getOffset('tables.closed');
      const x0 = t.x + tableOff.dx;
      let yRowTop = yTop(t.topMm) + tableOff.dy;
      const colXs: number[] = [];
      let acc = x0;
      for (const w of t.colWidthsMm) {
        colXs.push(acc);
        acc += w;
      }
      const items = (etapperClosed || []).filter((r: any) => Object.values(r || {}).some((v: any) => String(v ?? '').trim() !== ''));
      const rows = items.slice(0, t.maxRows);
      const vPad = 2;
      rows.forEach((r: any, rowIdx: number) => {
        const cells = [
          r.etapp ?? '',
          r.ytaM2 ?? '',
          r.bestalldTjocklek ?? '',
          r.uppmatTjocklek ?? '',
          r.installeradDensitet ?? '',
          r.antalSackKgPerSack ?? '',
          r.lambdavarde ?? '',
        ];
        const baseline = yRowTop - (t.rowHeightMm * 0.5);
        cells.forEach((c, i) => {
          const colX = colXs[i] + t.colPadMm;
          const cellKey = `tables.closed.r${rowIdx + 1}.c${i + 1}`;
          const cellOff = getOffset(cellKey);
          const drawX = colX + cellOff.dx;
          const drawY = baseline - vPad + cellOff.dy;
          mark(drawX, baseline + cellOff.dy, cellKey);
          const text = String(c);
          if (text) {
            tPage.drawText(text, { x: drawX, y: drawY, size: 9, font: tFont, color: textColor });
          }
        });
        yRowTop -= t.rowHeightMm;
      });
    }

    // Kontroller list
    {
      const c = coords.checks;
      const checksOffset = getOffset('checks.block');
      let y = yTop(c.topMm);
      // We split rendering: small mark at okX, and comment/value at commentX
      const writeCheck = (label: string, data: any) => {
        const ok = !!data?.ok;
        const comment = String(data?.comment ?? '').trim();
        const okX = c.okX + checksOffset.dx;
        const txtX = c.commentX + checksOffset.dx;
        const Y = y + checksOffset.dy;
        // Mark position crosshair for calibration
        mark(okX, Y, 'checks.' + label + '.ok');
        mark(txtX, Y, 'checks.' + label + '.txt');
        // Draw a simple 'X' in the checkbox column if ok
        if (ok) {
          tPage.drawText('X', { x: okX, y: Y, size: valueSize + 3, font: tBold, color: textColor });
        }
        // Draw comment text (or leave blank)
        if (comment) {
          tPage.drawText(comment, { x: txtX, y: Y, size: valueSize, font: tFont, color: textColor });
        }
        y -= c.lineGapMm;
      };
      writeCheck('Takfotsventilation', checks?.takfotsventilation);
      writeCheck('Snickerier', checks?.snickerier);
      writeCheck('Tätskikt', checks?.tatskikt);
      writeCheck('Genomförningar', checks?.genomforningar);
      writeCheck('Grovstädning', checks?.grovstadning);
      writeCheck('Märkskylt', checks?.markskylt);
    }

    // Övriga kommentarer
    {
      const oc = String(checks?.ovrigaKommentarer?.comment ?? '').trim();
      if (oc) {
        const c = coords.comments;
        const oValue = getOffset('comments.value');
        drawValueAt('comments.value', oc, c.valueX, yTop(c.yTopMm) + oValue.dy);
      }
    }

    // Signature block on template lines
    {
      const s = coords.signature;
      // Row 1: Datum och ort
      const dateCity = String(body?.signatureDateCity || '').trim();
      if (dateCity) {
        drawValueAt('signature.datecity', dateCity, s.lineX + 4, yTop(s.dateCityTopMm));
      }

      // Row 2: Underskrift + image
      const signatureDataUrl = String((body && body.signature) || '');
      try {
        let img: { width: number; height: number } | null = null;
        if (signatureDataUrl.startsWith('data:image/jpeg') || signatureDataUrl.startsWith('data:image/jpg')) {
          const base64 = signatureDataUrl.split(',')[1] || '';
          const bytes = Buffer.from(base64, 'base64');
          img = await (finalDoc as any).embedJpg?.(bytes);
        } else if (signatureDataUrl.startsWith('data:image/png')) {
          const base64 = signatureDataUrl.split(',')[1] || '';
          const bytes = Buffer.from(base64, 'base64');
          img = await (finalDoc as any).embedPng(bytes);
        }
        if (img) {
          const scale = Math.min(s.imgMaxW / img.width, s.imgMaxH / img.height, 1);
          const w = img.width * scale;
          const h = img.height * scale;
          const sigOff = getOffset('signature.image');
          const imgX = s.lineX + sigOff.dx;
          const imgY = (yTop(s.signatureTopMm) - h * 0.25) + sigOff.dy; // sit on the line
          tPage.drawImage(img as any, { x: imgX, y: imgY, width: w, height: h });
        }
      } catch {}
      // Optional right-aligned timestamp
      const tsRaw = String(body?.signatureTimestamp || '').trim();
      const tz = String(body?.signatureTimeZone || '').trim();
      if (tsRaw) {
        const d = new Date(tsRaw);
        const valid = !isNaN(d.getTime());
        const pad2 = (n: number) => (n < 10 ? '0' + n : String(n));
        const formatWithTZ = (date: Date) => {
          try {
            if (tz) {
              const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
              const parts = fmt.formatToParts(date).reduce((acc: any, p) => (acc[p.type] = p.value, acc), {} as any);
              return `Signed at: ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${tz}`;
            }
          } catch {}
          return `Signed at: ${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
        };
        const stamp = valid ? formatWithTZ(d) : `Signed at: ${tsRaw}`;
        const noteSize = 8;
  const noteW = (tFont as any).widthOfTextAtSize(stamp, noteSize);
  const noteOff = getOffset('signature.timestamp');
  const noteX = s.lineX + s.lineW - noteW + noteOff.dx;
  const noteY = yTop(s.signatureTopMm) + mm(3) + noteOff.dy;
  mark(noteX, noteY, 'signature.timestamp');
  tPage.drawText(stamp, { x: noteX, y: noteY, size: noteSize, font: tFont, color: labelColor });
      }

      // Row 3: Namnförtydligande
      const printedName = String(installerName || '').trim().toUpperCase();
      if (printedName) {
        drawValueAt('signature.name', printedName, s.lineX + 4, yTop(s.nameTopMm));
      }
    }

    // Optional photos page: add as page 2 if provided
    try {
      if (beforeImageDataUrl || afterImageDataUrl) {
        const photosPage = finalDoc.addPage([595.28, 841.89]); // A4
        const margin2 = 36;
        const maxW = photosPage.getWidth() - margin2 * 2;
        const slotH = (photosPage.getHeight() - margin2 * 3) / 2; // two vertical slots

        const embedAndDraw = async (dataUrl: string, x: number, y: number, w: number, h: number) => {
          const base64 = String(dataUrl || '').split(',')[1] || '';
          if (!base64) return;
          const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
          let img: any = null;
          if (/^data:image\/png/i.test(String(dataUrl))) img = await (finalDoc as any).embedPng(bytes);
          else img = await (finalDoc as any).embedJpg?.(bytes);
          if (!img) return;
          const dims = img.scale(1);
          const scale = Math.min(w / dims.width, h / dims.height);
          const drawW = dims.width * scale;
          const drawH = dims.height * scale;
          const dx = x + (w - drawW) / 2;
          const dy = y + (h - drawH) / 2;
          photosPage.drawImage(img, { x: dx, y: dy, width: drawW, height: drawH });
        };

        const labelColor2 = rgb(0.12, 0.12, 0.14);
        const titleSize2 = 12;

        let topTitleY = photosPage.getHeight() - margin2 - titleSize2;
        if (beforeImageDataUrl) {
          photosPage.drawText('Före', { x: margin2, y: topTitleY, size: titleSize2, font: tBold, color: labelColor2 });
          await embedAndDraw(beforeImageDataUrl, margin2, topTitleY - 6 - slotH, maxW, slotH - 12);
        }

        const bottomTitleY = margin2 + slotH + 12;
        if (afterImageDataUrl) {
          photosPage.drawText('Efter', { x: margin2, y: bottomTitleY, size: titleSize2, font: tBold, color: labelColor2 });
          await embedAndDraw(afterImageDataUrl, margin2, margin2, maxW, slotH - 12);
        }
      }
    } catch {}

    // NOTE: We do NOT append our generated pages here; template is the main output.
    outBytes = await finalDoc.save();
  } catch {
    // Fallback to the original generated layout if template/overlay fails
    outBytes = await pdfDoc.save();
  }
  const arrayBuf = outBytes.buffer.slice(outBytes.byteOffset, outBytes.byteLength + outBytes.byteOffset);

    // Build a safe filename: Egenkontroll_clientName_orderNumber.pdf
    const sanitize = (s: string) =>
      String(s || '')
        .normalize('NFKD')
        .replace(/[^\w\-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    const clientPart = sanitize(clientName || 'client');
    const orderPart = sanitize((orderId || projectNumber || 'order') as string);
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

import { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();
    const {
      type = 'private',
      customerName = '',
      companyName = '',
      email = '',
      phone = '',
      streetAddress = '',
      postalCode = '',
      city = '',
      // Back-compat single line fields
      material = '',
      quantity = 0,
      unitPrice = 0,
      // New multi-line items: [{ description, quantity, unitPrice }]
      lineItems = [] as Array<{ description: string; quantity: number; unitPrice: number }>,
      vatPercent = 25,
      validUntil = '',
      notes = '',
      totals = { subtotal: 0, vat: 0, total: 0 },
      branding = {} as { companyName?: string; primaryColor?: string; accentColor?: string },
    } = body || {};

    const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 36;
  const bottomBandHeight = 100; // reserve area for totals at page bottom
  const contentBottomY = margin + bottomBandHeight;
    let y = page.getHeight() - margin;
    const company = branding.companyName || 'Isoleringslandslaget';
    const primary = hexToRgb(branding.primaryColor || '#0ea5e9');
    const accent = hexToRgb(branding.accentColor || '#94a3b8');

    // Header
    page.drawRectangle({ x: 0, y: y - 30, width: page.getWidth(), height: 30, color: rgb(primary.r, primary.g, primary.b) });
    drawText(page, 'Offert', margin, y - 22, 16, fontBold, rgb(1, 1, 1));
    drawText(page, company, page.getWidth() - margin - 200, y - 22, 10, font, rgb(1, 1, 1));
    y -= 46;

    // Customer block
    const leftColX = margin;
    const rightColX = page.getWidth() / 2 + 10;
    const lineGap = 14;

    drawLabel(page, 'Kund', leftColX, y, fontBold, accent); y -= 10;
    if (type === 'private') {
      drawText(page, customerName || '-', leftColX, y, 11, font); y -= lineGap;
    } else {
      drawText(page, companyName || '-', leftColX, y, 11, font); y -= lineGap;
    }
    drawText(page, streetAddress || '-', leftColX, y, 10, font); y -= lineGap;
    drawText(page, `${postalCode || ''} ${city || ''}`.trim(), leftColX, y, 10, font); y -= lineGap;
    drawText(page, email || '-', leftColX, y, 10, font); y -= lineGap;
    drawText(page, phone || '-', leftColX, y, 10, font); y -= lineGap * 1.4;

    drawLabel(page, 'Giltig t.o.m.', rightColX, y + lineGap * 6.4, fontBold, accent);
    drawText(page, validUntil || '-', rightColX, y + lineGap * 5.4, 11, font);

  // Line items
    y -= 10;
    drawLabel(page, 'Specifikation', margin, y, fontBold, accent); y -= 12;
    const col1 = margin;              // Material
    const col2 = margin + 240;        // Antal
    const col3 = margin + 340;        // À-pris
    const col4 = margin + 440;        // Summa

    drawText(page, 'Beskrivning', col1, y, 10, fontBold);
    drawText(page, 'Antal', col2, y, 10, fontBold);
    drawText(page, 'À-pris', col3, y, 10, fontBold);
    drawText(page, 'Summa', col4, y, 10, fontBold);
    y -= 16;

    const rows: Array<{ description: string; quantity: number; unitPrice: number }> = Array.isArray(lineItems) && lineItems.length > 0
      ? lineItems
      : [{ description: material || '-', quantity: quantity || 0, unitPrice: unitPrice || 0 }];
    const originalItems: Array<any> = Array.isArray(body?.items) ? body.items : [];

    let subtotal = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const original = originalItems[i] || {};
      // Build optional detail row (e.g. "120 m² × 500 mm") for m3 pricing
      let detail: string | null = null;
      try {
        const pricing = (original?.pricing ?? '').toString();
        const m2Str = (original?.m2 ?? '').toString().trim();
        const thickStr = (original?.thicknessMm ?? '').toString().trim();
        if (pricing === 'm3' && m2Str && thickStr) {
          detail = `${m2Str} m² × ${thickStr} mm`;
        }
      } catch {}

      const rowHeight = detail ? 22 : 16; // ensure we don't draw into totals area
      if (y - rowHeight < contentBottomY) break;

      const rowSum = (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0);
      subtotal += rowSum;
      drawText(page, String(r.description || '-'), col1, y, 8, font);
      drawText(page, String(r.quantity || 0), col2, y, 8, font);
      drawText(page, formatCurrency(Number(r.unitPrice) || 0), col3, y, 8, font);
      drawText(page, formatCurrency(rowSum), col4, y, 8, font);
      if (detail) {
        drawText(page, detail, col1, y - 10, 7.5, font, rgb(0.35, 0.4, 0.45));
        y -= 22;
      } else {
        y -= 16;
      }
    }
    y -= 8;

    // Notes (render but do not overlap totals band)
    if (notes) {
      drawLabel(page, 'Anteckningar', margin, y, fontBold, accent); y -= 12;
      const wrapped = wrapText(notes, 10, font, page.getWidth() - margin * 2);
      for (const line of wrapped) {
        if (y - 12 < contentBottomY) break;
        drawText(page, line, margin, y, 10, font);
        y -= 12;
      }
    }

    // Totals (anchored at bottom band)
    subtotal = Number.isFinite(totals?.subtotal) ? totals.subtotal : subtotal;
    const vat = Number.isFinite(totals?.vat) ? totals.vat : subtotal * (vatPercent / 100);
    const total = Number.isFinite(totals?.total) ? totals.total : subtotal + vat;

    // separator above totals band
    page.drawRectangle({ x: margin, y: contentBottomY - 12, width: page.getWidth() - margin * 2, height: 0.6, color: rgb(0.85, 0.88, 0.9) });

    let ty = margin + 40;
    drawText(page, 'Delsumma:', col3, ty, 10, fontBold); drawText(page, formatCurrency(subtotal), col4, ty, 10, font); ty += 14;
    drawText(page, `Moms (${vatPercent}%):`, col3, ty, 10, fontBold); drawText(page, formatCurrency(vat), col4, ty, 10, font); ty += 16;
    drawText(page, 'Totalt:', col3, ty, 11, fontBold); drawText(page, formatCurrency(total), col4, ty, 11, fontBold);

    // Footer
    const today = new Date().toISOString().slice(0, 10);
    drawText(page, `Skapad: ${today}`, margin, margin - 4, 9, font, rgb(accent.r, accent.g, accent.b));

    const bytes = await pdfDoc.save();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="offert.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return new Response(e?.message || 'Failed to generate PDF', { status: 500 });
  }
}

function drawText(page: any, text: string, x: number, y: number, size: number, font: any, color = rgb(0.1, 0.12, 0.14)) {
  page.drawText(String(text ?? ''), { x, y, size, font, color });
}

function drawLabel(page: any, text: string, x: number, y: number, fontBold: any, accent: { r: number; g: number; b: number }) {
  page.drawText(text.toUpperCase(), { x, y, size: 9, font: fontBold, color: rgb(accent.r, accent.g, accent.b) });
}

function wrapText(text: string, size: number, font: any, maxWidth: number): string[] {
  const words = (text || '').split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    const width = font.widthOfTextAtSize(test, size);
    if (width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function formatCurrency(v: number) {
  const n = Number(v) || 0;
  return `${n.toFixed(2)} kr`;
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r: r / 255, g: g / 255, b: b / 255 };
}

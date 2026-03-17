import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { promises as fs } from 'fs';
import path from 'path';
import { computeOffertKalkylator, OFFERT_KALKYLATOR_DEFAULT_STATE } from '@/lib/offertKalkylator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BRAND = {
  name: 'Ekovilla AB',
  orgNumber: '559341-9673',
  phone: '020 – 44 66 40',
  email: 'info@ekovilla.se',
  logoPath: path.join(process.cwd(), 'public', 'brand', 'Ekovilla_logo_Header.png'),
} as const;

const TERMS_PDF_PATH = path.join(process.cwd(), 'public', 'documents', 'templates', 'allmanna-villkor-privat-2026.pdf');

const STANDARD_TEXT = `Betalningsvillkor: 10 dagar, alternativt finansiering via vår bankpartner SVEA BANK.

Vi tackar för förtroendet och har härmed nöjet att offerera er följande lösullsentreprenad.

EKOVILLA är Nordens största tillverkare och installatör av lösullsisolering och vår isolering har marknadens bästa tekniska egenskaper. Cellulosaisolering ger upp till 10dB bättre ljudisolering och har högre värmelagringskapacitet jämfört med mineralullsisolering. Materialet är CO2-negativt vilket betyder att det lagrar mer CO2 än det släpper ut vid tillverkning och installation. Lambdavärde mellan 0,035-0,038 W/mK beroende på konstruktion. Bästa brandklass för organiska byggmaterial Bs2,d0. Vi är medlemmar i Byggföretagen och följer kollektivavtal. Vi är också medlemmar i branschorganisationen Isolerarna och certifierade enligt vårt gemensamma kvalitetssystem Behörig Lösull.

Garantier: Livstidsgaranti på isoleringsmaterialets tekniska egenskaper samt mot sättningar i slutna konstruktioner. 10 års garanti på utförandet.`;

function pdfSafeText(input: string) {
  return String(input ?? '')
    .replace(/\u2212/g, '-') // minus sign
    .replace(/[\u2013\u2014]/g, '-') // en/em dash
    .replace(/\u2022/g, '*') // bullet
    .replace(/\u00A0/g, ' ') // nbsp
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

function formatKr(v: number) {
  const n = Number.isFinite(v) ? v : 0;
  return pdfSafeText(`${Math.round(n).toLocaleString('sv-SE')} kr`);
}

function wrapText(text: string, font: any, size: number, maxWidth: number) {
  const paragraphs = pdfSafeText(text || '').split(/\n\n+/);
  const lines: string[] = [];

  for (let p = 0; p < paragraphs.length; p++) {
    const para = paragraphs[p].trim();
    if (!para) {
      lines.push('');
      continue;
    }

    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      const width = font.widthOfTextAtSize(test, size);
      if (width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    if (p !== paragraphs.length - 1) lines.push('');
  }

  return lines;
}

function safeFilename(name: string) {
  return (name || 'offert')
    .replace(/[^a-z0-9\-_ ]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'offert';
}

function formatOffertNumber(year: any, seq: any) {
  const y = Number(year);
  const s = Number(seq);
  if (!Number.isFinite(y) || !Number.isFinite(s) || y <= 0 || s <= 0) return '';
  return `${y}-${String(Math.trunc(s)).padStart(5, '0')}`;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const id = String(params?.id || '').trim();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: item, error } = await supabase
      .from('offert_calculations')
      .select('id, offert_number_year, offert_number_seq, created_at, name, address, city, phone, quote_date, salesperson, salesperson_phone, next_meeting_date, status, payload, subtotal, total_before_rot, rot_amount, total_after_rot')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error) throw error;
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const payload = item.payload;
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'Offert saknar payload' }, { status: 400 });
    }

    const totals = computeOffertKalkylator({
      ...OFFERT_KALKYLATOR_DEFAULT_STATE,
      ...(typeof payload === 'object' ? payload : {}),
    } as any);

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let logoImage: any = null;
    try {
      const logoBytes = await fs.readFile(BRAND.logoPath);
      logoImage = await pdfDoc.embedPng(logoBytes);
    } catch {
      logoImage = null;
    }

    const pageSize: [number, number] = [595.28, 841.89]; // A4
    const margin = 40;
    const contentWidth = pageSize[0] - margin * 2;

    let page = pdfDoc.addPage(pageSize);
    let y = page.getHeight() - margin;

    const drawRightText = (text: string, yPos: number, size: number, fontToUse: any, color: any) => {
      const t = pdfSafeText(text);
      const w = fontToUse.widthOfTextAtSize(t, size);
      page.drawText(t, { x: page.getWidth() - margin - w, y: yPos, size, font: fontToUse, color });
    };

    const drawFooter = () => {
      const yFooter = margin - 16;
      const size = 9;

      // 4-column footer: Name | Orgnummer | Phone | Email
      const left = pdfSafeText(BRAND.name);
      const org = pdfSafeText(`Orgnummer: ${BRAND.orgNumber}`);
      const phone = pdfSafeText(BRAND.phone);
      const email = pdfSafeText(BRAND.email);

      const col2X = margin + contentWidth * 0.25;
      const col3X = margin + contentWidth * 0.60;
      const emailW = font.widthOfTextAtSize(email, size);

      page.drawText(left, { x: margin, y: yFooter, size, font, color: rgb(0.35, 0.4, 0.45) });
      page.drawText(org, { x: col2X, y: yFooter, size, font, color: rgb(0.35, 0.4, 0.45) });
      page.drawText(phone, { x: col3X, y: yFooter, size, font, color: rgb(0.35, 0.4, 0.45) });
      page.drawText(email, { x: page.getWidth() - margin - emailW, y: yFooter, size, font, color: rgb(0.35, 0.4, 0.45) });
    };

    const drawHeader = () => {
      const headerTop = page.getHeight() - margin;

      if (logoImage) {
        const maxW = 150;
        const maxH = 40;
        const scale = Math.min(maxW / logoImage.width, maxH / logoImage.height);
        const w = logoImage.width * scale;
        const h = logoImage.height * scale;
        page.drawImage(logoImage, {
          x: margin,
          y: headerTop - h + 6,
          width: w,
          height: h,
        });
      }

      drawRightText('OFFERT', headerTop - 18, 16, fontBold, rgb(0.06, 0.09, 0.12));

      // divider
      page.drawRectangle({ x: margin, y: headerTop - 62, width: page.getWidth() - margin * 2, height: 1, color: rgb(0.9, 0.92, 0.94) });

      y = headerTop - 78;

      drawFooter();
    };

    const newPage = () => {
      page = pdfDoc.addPage(pageSize);
      y = page.getHeight() - margin;
      drawHeader();
    };

    const ensureSpace = (neededHeight: number) => {
      if (y - neededHeight < margin + 40) newPage();
    };

    const drawLabelValue = (label: string, value: string) => {
      const labelW = 110;
      page.drawText(pdfSafeText(label), { x: margin, y, size: 10, font: fontBold, color: rgb(0.1, 0.12, 0.14) });
      page.drawText(pdfSafeText(value || '—'), { x: margin + labelW, y, size: 10, font, color: rgb(0.1, 0.12, 0.14) });
      y -= 14;
    };

    drawHeader();

    // Customer block
    ensureSpace(140);
    page.drawText('KUNDUPPGIFTER', { x: margin, y, size: 9, font: fontBold, color: rgb(0.35, 0.4, 0.45) });
    y -= 16;

    // Two-column layout for customer details (use full width)
    const colGap = 24;
    const colW = (contentWidth - colGap) / 2;
    const leftX = margin;
    const rightX = margin + colW + colGap;
    const labelW = 78;
    const rowH = 14;

    const leftRows = [
      { label: 'Namn:', value: String(item.name || '') },
      { label: 'Adress:', value: String(item.address || '') },
      { label: 'Stad:', value: String(item.city || '') },
    ];

    const offertNumber = formatOffertNumber((item as any).offert_number_year, (item as any).offert_number_seq);

    const rightRows = [
      ...(offertNumber ? [{ label: 'Offertnummer:', value: offertNumber }] : []),
      { label: 'Offertdatum:', value: String(item.quote_date || '') },
      ...(String(item.salesperson || '').trim() ? [{ label: 'Vår referens:', value: String(item.salesperson || '') }] : []),
      ...(String((item as any).salesperson_phone || '').trim() ? [{ label: 'Telefonnummer:', value: String((item as any).salesperson_phone || '') }] : []),
    ];

    const rows = Math.max(leftRows.length, rightRows.length);
    for (let i = 0; i < rows; i++) {
      const rowY = y - i * rowH;

      const l = leftRows[i];
      if (l) {
        page.drawText(pdfSafeText(l.label), { x: leftX, y: rowY, size: 10, font: fontBold, color: rgb(0.1, 0.12, 0.14) });
        page.drawText(pdfSafeText(l.value || '—'), {
          x: leftX + labelW,
          y: rowY,
          size: 10,
          font,
          color: rgb(0.1, 0.12, 0.14),
          maxWidth: colW - labelW,
        });
      }

      const r = rightRows[i];
      if (r) {
        page.drawText(pdfSafeText(r.label), { x: rightX, y: rowY, size: 10, font: fontBold, color: rgb(0.1, 0.12, 0.14) });
        page.drawText(pdfSafeText(r.value || '—'), {
          x: rightX + labelW,
          y: rowY,
          size: 10,
          font,
          color: rgb(0.1, 0.12, 0.14),
          maxWidth: colW - labelW,
        });
      }
    }

    y -= rows * rowH;

    y -= 6;
    page.drawRectangle({ x: margin, y, width: page.getWidth() - margin * 2, height: 1, color: rgb(0.9, 0.92, 0.94) });
    y -= 18;

    // Specification
    ensureSpace(120);
    page.drawText('BESTÄLLNING', { x: margin, y, size: 9, font: fontBold, color: rgb(0.35, 0.4, 0.45) });
    y -= 16;

    if (!totals.lines || totals.lines.length === 0) {
      page.drawText('Inga valda rader i kalkylen.', { x: margin, y, size: 10, font, color: rgb(0.1, 0.12, 0.14) });
      y -= 14;
    } else {
      const col1 = margin;
      const col2 = margin + contentWidth - 120;

      page.drawText('Beskrivning', { x: col1, y, size: 10, font: fontBold, color: rgb(0.1, 0.12, 0.14) });
      drawRightText('Antal', y, 10, fontBold, rgb(0.1, 0.12, 0.14));
      y -= 14;

      page.drawRectangle({ x: margin, y, width: page.getWidth() - margin * 2, height: 1, color: rgb(0.9, 0.92, 0.94) });
      y -= 12;

      for (const line of totals.lines) {
        ensureSpace(20);
        page.drawText(pdfSafeText(String(line.label)), { x: col1, y, size: 10, font, color: rgb(0.1, 0.12, 0.14), maxWidth: contentWidth - 140 });
        drawRightText(`${line.qty} ${line.unit}`, y, 10, font, rgb(0.1, 0.12, 0.14));
        y -= 14;
      }
    }

    y -= 10;

    // Anchor SUMMA + VILLKOR blocks to the bottom (above footer)
    const standardTextSize = 9;
    const standardTextLineH = 12;
    const textLines = wrapText(STANDARD_TEXT, font, standardTextSize, contentWidth);

    const totalBeforeRot = Number(totals.totalBeforeRot) || 0;
    const rotAmount = Number(totals.rotAmount) || 0;
    const totalAfterRot = Number(totals.totalAfterRot) || 0;

    const sumHeight = 16 + 16 + 16 + 18 + 16; // heading + rows + divider spacing
    let villkorLinesHeight = 0;
    for (const line of textLines) {
      villkorLinesHeight += line ? standardTextLineH : 8;
    }
    const villkorHeight = 16 + villkorLinesHeight; // heading + lines
    const bottomBlockHeight = sumHeight + villkorHeight;

    const bottomAnchorY = margin + 18; // keep clear of footer
    const maxBottomBlockHeight = page.getHeight() - margin - bottomAnchorY - 90; // keep clear of header area

    const drawBottomBlocksFlow = () => {
      // SUMMA
      page.drawText('SUMMA', { x: margin, y, size: 9, font: fontBold, color: rgb(0.35, 0.4, 0.45) });
      y -= 16;

      const tx = margin;
      page.drawText('Totalsumma (innan ROT)', { x: tx, y, size: 11, font: fontBold, color: rgb(0.1, 0.12, 0.14) });
      drawRightText(formatKr(totalBeforeRot), y, 11, fontBold, rgb(0.1, 0.12, 0.14));
      y -= 16;

      page.drawText('ROT', { x: tx, y, size: 10, font: fontBold, color: rgb(0.1, 0.12, 0.14) });
      drawRightText(`- ${formatKr(rotAmount)}`, y, 10, font, rgb(0.1, 0.12, 0.14));
      y -= 16;

      page.drawText('Totalsumma (efter ROT)', { x: tx, y, size: 12, font: fontBold, color: rgb(0.1, 0.12, 0.14) });
      drawRightText(formatKr(totalAfterRot), y, 12, fontBold, rgb(0.1, 0.12, 0.14));
      y -= 18;

      page.drawRectangle({ x: margin, y, width: page.getWidth() - margin * 2, height: 1, color: rgb(0.9, 0.92, 0.94) });
      y -= 16;

      // VILLKOR
      page.drawText('VILLKOR & INFORMATION', { x: margin, y, size: 9, font: fontBold, color: rgb(0.35, 0.4, 0.45) });
      y -= 16;

      for (const line of textLines) {
        if (!line) {
          y -= 8;
          continue;
        }
        page.drawText(pdfSafeText(line), { x: margin, y, size: standardTextSize, font, color: rgb(0.1, 0.12, 0.14) });
        y -= standardTextLineH;
      }
    };

    // If the bottom blocks are too tall to sensibly anchor on one page, fall back to flowing layout
    if (bottomBlockHeight > maxBottomBlockHeight) {
      ensureSpace(100);
      drawBottomBlocksFlow();
    } else {
      // If there isn't enough room above the anchor point, put bottom blocks on a fresh page
      if (y < bottomAnchorY + bottomBlockHeight + 12) newPage();

      // Position y so the blocks end just above the footer
      y = bottomAnchorY + bottomBlockHeight;
      drawBottomBlocksFlow();
    }

    // Append terms as page 2 (and any additional pages) from the bundled PDF.
    try {
      const termsBytes = await fs.readFile(TERMS_PDF_PATH);
      const termsDoc = await PDFDocument.load(termsBytes);
      const termsPages = await pdfDoc.copyPages(termsDoc, termsDoc.getPageIndices());
      for (const p of termsPages) pdfDoc.addPage(p);
    } catch {
      // Ignore missing/invalid terms PDF.
    }

    const bytes = await pdfDoc.save();

    // Return as stream to avoid BodyInit typing issues (ArrayBuffer vs SharedArrayBuffer).
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeFilename(item.name)}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to generate PDF' }, { status: 500 });
  }
}

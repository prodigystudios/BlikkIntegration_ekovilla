import ExcelJS from 'exceljs';
import type { OwnerBudget, OwnerMetrics, OwnerReport, OwnerSeller } from './reportOwnerExport';
import { UNASSIGNED_NAME } from './reportOwnerExport';
import type { StockStageKey } from './reportRevenue';
import type { WeekStock } from './orderStockHistory';

// Ägarnas veckorapport som Excel-arbetsbok. Modellen räknas i reportOwnerExport.ts; här ritas den.
//
// ⚠️ SUMMOR OCH KVOTER ÄR FORMLER, MED SITT VÄRDE FÖRBERÄKNAT. Formeln gör att arket räknar om sig om
// någon ändrar en siffra; det cachade värdet gör att förhandsvisningar (Quick Look, mejlklienter) som inte
// räknar själva ändå visar talen. Excel räknar om vid öppning (fullCalcOnLoad). Värdet och formeln måste
// alltså vara samma tal — testerna prövar det.
//
// Belopp är rådata (kronor, netto); talformaten ritar "1 234 kr", noll som "–" och andelar som "45 %".

const GREEN = 'FF1A3F26';
const ACCENT_SOFT = 'FFE9F1EB';
const SAGE = 'FFF1F5EE';
const WHITE = 'FFFFFFFF';
const BORDER = 'FFD9E2D5';
const MUTED = 'FF64748B';
const FONT = 'Arial';

const FMT_KR = '#,##0 "kr";-#,##0 "kr";"–"';
const FMT_COUNT = '#,##0;-#,##0;"–"';
const FMT_PERCENT = '0%';

const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONTHS_LONG = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

const STAGE_LABELS: Record<StockStageKey, string> = {
  draft: 'Ej planerad',
  scheduled: 'Planerad',
  in_progress: 'Pågår',
  partially_invoiced: 'Delfakturerad (det som återstår)',
  completed: 'Klar att fakturera',
};

function dayParts(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}
/** "9 oktober 2026" */
export function longDate(iso: string): string {
  const { year, month, day } = dayParts(iso);
  return `${day} ${MONTHS_LONG[month - 1]} ${year}`;
}
/** "29 jun–5 jul", "6–12 okt" */
export function shortSpan(from: string, to: string): string {
  const a = dayParts(from);
  const b = dayParts(to);
  if (from === to) return `${a.day} ${MONTHS_SHORT[a.month - 1]}`;
  return a.month === b.month
    ? `${a.day}–${b.day} ${MONTHS_SHORT[b.month - 1]}`
    : `${a.day} ${MONTHS_SHORT[a.month - 1]}–${b.day} ${MONTHS_SHORT[b.month - 1]}`;
}

/**
 * Filnamnet: "Forsaljningsrapport-2026-10-09.xlsx". ASCII, så att det överlever varje mejlklient.
 *
 * Datumet, inte veckan: runt nyår hör veckan till grannåret (30 dec 2025 ligger i v. 1 2026), och
 * "2025-v1" hade krockat med årets riktiga vecka 1. Datumet sorterar dessutom veckofilerna rätt.
 */
export function ownerReportFilename(report: Pick<OwnerReport, 'today'>): string {
  return `Forsaljningsrapport-${report.today}.xlsx`;
}

// ── Cellhjälpare ─────────────────────────────────────────────────────────────

type Cell = ExcelJS.Cell;
const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : '');

function font(cell: Cell, opts: Partial<ExcelJS.Font> = {}) {
  cell.font = { name: FONT, size: 10, ...opts };
}
function fill(cell: Cell, argb: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}
function bottomBorder(cell: Cell, style: ExcelJS.BorderStyle = 'thin', argb = BORDER) {
  cell.border = { ...cell.border, bottom: { style, color: { argb } } };
}
function topBorder(cell: Cell, style: ExcelJS.BorderStyle = 'medium', argb = GREEN) {
  cell.border = { ...cell.border, top: { style, color: { argb } } };
}
function formula(cell: Cell, expression: string, result: number | string) {
  cell.value = { formula: expression, result } as ExcelJS.CellFormulaValue;
}

/** En budgetsumma: tom när ingen budget finns, så att "ingen budget" aldrig läses som "budget 0 kr". */
function budgetSum(cell: Cell, terms: string, value: number) {
  formula(cell, `IF(SUM(${terms})>0,SUM(${terms}),"")`, value > 0 ? value : '');
}

function addSheet(workbook: ExcelJS.Workbook, name: string, frozen?: { xSplit: number; ySplit: number }) {
  return workbook.addWorksheet(name, {
    views: [frozen ? { state: 'frozen', ...frozen, showGridLines: false } : { showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    properties: { tabColor: { argb: GREEN } },
  });
}

function title(sheet: ExcelJS.Worksheet, text: string, lines: string[]) {
  const head = sheet.getCell(1, 1);
  head.value = text;
  font(head, { size: 16, bold: true, color: { argb: GREEN } });
  sheet.getRow(1).height = 26;
  lines.forEach((line, index) => {
    const cell = sheet.getCell(2 + index, 1);
    cell.value = line;
    font(cell, { color: { argb: MUTED } });
  });
}

function headerCell(cell: Cell, value: string, align: 'left' | 'right' = 'right') {
  cell.value = value;
  font(cell, { bold: true, color: { argb: WHITE } });
  fill(cell, GREEN);
  cell.alignment = { horizontal: align, vertical: 'middle' };
}

function sectionTitle(sheet: ExcelJS.Worksheet, row: number, text: string) {
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  font(cell, { size: 12, bold: true, color: { argb: GREEN } });
}

function note(sheet: ExcelJS.Worksheet, row: number, text: string, italic = false) {
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  font(cell, { italic, color: { argb: MUTED } });
}

const colLetter = (column: number) => {
  let n = column;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
const ref = (row: number, column: number) => `${colLetter(column)}${row}`;

// ── Sammanfattning ───────────────────────────────────────────────────────────

const SUMMARY_COLUMNS: Array<{ label: string; fmt: string }> = [
  { label: 'Offerter', fmt: FMT_COUNT },
  { label: 'Offertvärde', fmt: FMT_KR },
  { label: 'Vunna', fmt: FMT_COUNT },
  { label: 'Vunnet värde', fmt: FMT_KR },
  { label: 'Hit rate', fmt: FMT_PERCENT },
  { label: 'Hit rate kr', fmt: FMT_PERCENT },
  { label: 'Order', fmt: FMT_COUNT },
  { label: 'Ordervärde', fmt: FMT_KR },
  { label: 'Snittorder', fmt: FMT_KR },
  { label: 'Fakturerat', fmt: FMT_KR },
];

/** Raden i sammanfattningen: värden i B–E, H–I, K; kvoterna F, G, J som formler. */
function summaryRow(sheet: ExcelJS.Worksheet, row: number, m: OwnerMetrics, sums?: { first: number; last: number }) {
  const value = (column: number, n: number) => {
    const cell = sheet.getCell(row, column);
    if (sums) formula(cell, `SUM(${ref(sums.first, column)}:${ref(sums.last, column)})`, n);
    else cell.value = n;
  };
  value(2, m.quotes);
  value(3, m.quoteValue);
  value(4, m.won);
  value(5, m.wonValue);
  formula(sheet.getCell(row, 6), `IF(${ref(row, 2)}>0,${ref(row, 4)}/${ref(row, 2)},"")`, ratio(m.won, m.quotes));
  formula(sheet.getCell(row, 7), `IF(${ref(row, 3)}>0,${ref(row, 5)}/${ref(row, 3)},"")`, ratio(m.wonValue, m.quoteValue));
  value(8, m.orders);
  value(9, m.orderValue);
  formula(sheet.getCell(row, 10), `IF(${ref(row, 8)}>0,${ref(row, 9)}/${ref(row, 8)},"")`, ratio(m.orderValue, m.orders));
  value(11, m.invoicedValue);
  SUMMARY_COLUMNS.forEach((column, index) => { sheet.getCell(row, 2 + index).numFmt = column.fmt; });
}

function buildSummary(workbook: ExcelJS.Workbook, report: OwnerReport) {
  const sheet = addSheet(workbook, 'Sammanfattning');
  const first = report.weeks[0];
  const last = report.weeks.at(-1);
  const lines = [
    `Året hittills, t.o.m. ${longDate(report.today)}${last ? ` (v. ${last.week})` : ''}. Belopp exklusive moms; avbrutna order räknas inte.`,
  ];
  if (first && first.from > report.range.from) lines.push(`Första veckan med aktivitet i CRM:et är v. ${first.week} (${longDate(first.from)}); tidigare veckor är tomma.`);
  lines.push(`Skapad ${longDate(report.today)} ur Ekovilla CRM.`);
  title(sheet, `Försäljningsrapport ${report.year}`, lines);

  let row = lines.length + 3;
  sectionTitle(sheet, row, 'Per säljare, året hittills');
  row += 1;
  headerCell(sheet.getCell(row, 1), 'Säljare', 'left');
  SUMMARY_COLUMNS.forEach((column, index) => headerCell(sheet.getCell(row, 2 + index), column.label));
  row += 1;

  const firstSeller = row;
  report.sellers.forEach((seller, index) => {
    const name = sheet.getCell(row, 1);
    name.value = seller.name;
    font(name, { italic: seller.userId == null });
    summaryRow(sheet, row, seller.total);
    for (let column = 1; column <= 11; column++) {
      const cell = sheet.getCell(row, column);
      if (column > 1) font(cell, { italic: seller.userId == null });
      if (index % 2 === 0) fill(cell, SAGE);
      bottomBorder(cell);
    }
    row += 1;
  });
  sheet.getCell(row, 1).value = 'Hela företaget';
  summaryRow(sheet, row, report.totals.total, report.sellers.length ? { first: firstSeller, last: row - 1 } : undefined);
  for (let column = 1; column <= 11; column++) {
    const cell = sheet.getCell(row, column);
    font(cell, { bold: true });
    fill(cell, ACCENT_SOFT);
    topBorder(cell);
  }
  row += 1;
  if (report.totalPreliminary) {
    note(sheet, row, 'Hit rate är preliminär: offerter från de senaste 30 dagarna har inte hunnit avgöras, så talet stiger sannolikt.', true);
    row += 1;
  }

  // Orderstocken — läget nu.
  row += 1;
  sectionTitle(sheet, row, `Orderstock just nu (${longDate(report.today)})`);
  row += 1;
  if (!report.orderStock) {
    note(sheet, row, 'Orderstocken kunde inte läsas när filen skapades.');
    row += 1;
  } else {
    headerCell(sheet.getCell(row, 1), 'Läge', 'left');
    headerCell(sheet.getCell(row, 2), 'Order');
    headerCell(sheet.getCell(row, 3), 'Kvar att fakturera');
    row += 1;
    const firstStage = row;
    report.orderStock.stages.forEach((stage, index) => {
      sheet.getCell(row, 1).value = STAGE_LABELS[stage.key];
      sheet.getCell(row, 2).value = stage.count;
      sheet.getCell(row, 3).value = stage.value;
      sheet.getCell(row, 2).numFmt = FMT_COUNT;
      sheet.getCell(row, 3).numFmt = FMT_KR;
      for (let column = 1; column <= 3; column++) {
        const cell = sheet.getCell(row, column);
        font(cell);
        if (index % 2 === 0) fill(cell, SAGE);
        bottomBorder(cell);
      }
      row += 1;
    });
    sheet.getCell(row, 1).value = 'Totalt';
    formula(sheet.getCell(row, 2), `SUM(${ref(firstStage, 2)}:${ref(row - 1, 2)})`, report.orderStock.count);
    formula(sheet.getCell(row, 3), `SUM(${ref(firstStage, 3)}:${ref(row - 1, 3)})`, report.orderStock.value);
    sheet.getCell(row, 2).numFmt = FMT_COUNT;
    sheet.getCell(row, 3).numFmt = FMT_KR;
    for (let column = 1; column <= 3; column++) {
      const cell = sheet.getCell(row, column);
      font(cell, { bold: true });
      fill(cell, ACCENT_SOFT);
      topBorder(cell);
    }
    row += 1;
    const { weeks, basis } = report.orderStock;
    if (weeks != null && basis) {
      const month = dayParts(basis.from);
      note(sheet, row, `Räcker ungefär ${Math.round(weeks)} veckor i faktureringstakten från ${MONTHS_LONG[month.month - 1]} ${month.year}.`);
      row += 1;
    }
  }

  // Så räknas siffrorna.
  row += 1;
  sectionTitle(sheet, row, 'Så räknas siffrorna');
  row += 1;
  const notes = [
    'Offerter räknas på offertdatum, order på den dag de skapades och fakturerat på fakturans datum (en delfakturerad order per runda).',
    'Alla belopp är exklusive moms. Avbrutna order räknas inte.',
    'Hit rate = vunna offerter delat med alla offerter, även utkast, förlorade och utgångna. Vunnen sätts automatiskt när en order skapas från offerten.',
    'Orderstocken är det som återstår att fakturera på order som varken är avbrutna eller slutfakturerade.',
    'Budget = säljarnas månadsmål i CRM:et. Ingen budget satt = tom ruta, aldrig 0 %.',
  ];
  if (report.sellers.some((seller) => seller.userId == null)) {
    notes.push(`"${UNASSIGNED_NAME}" = offerter och order som inte har någon ansvarig säljare. De räknas med i Hela företaget.`);
  }
  for (const text of notes) {
    note(sheet, row, `• ${text}`);
    row += 1;
  }

  sheet.getColumn(1).width = 30;
  for (let column = 2; column <= 11; column++) sheet.getColumn(column).width = 14;
}

// ── Per vecka ────────────────────────────────────────────────────────────────

type MetricRow = { label: string; fmt: string; get: (m: OwnerMetrics) => number };
const SELLER_ROWS: MetricRow[] = [
  { label: 'Offerter', fmt: FMT_COUNT, get: (m) => m.quotes },
  { label: 'Offertvärde', fmt: FMT_KR, get: (m) => m.quoteValue },
  { label: 'Order', fmt: FMT_COUNT, get: (m) => m.orders },
  { label: 'Ordervärde', fmt: FMT_KR, get: (m) => m.orderValue },
  { label: 'Fakturerat', fmt: FMT_KR, get: (m) => m.invoicedValue },
];

const STOCK_STAGE_ORDER: StockStageKey[] = ['draft', 'scheduled', 'in_progress', 'partially_invoiced', 'completed'];
/** Rubriken, lägena, Totalt och Antal order. */
const STOCK_ROWS = STOCK_STAGE_ORDER.length + 3;

/**
 * Orderstocken vid veckans slut: ett läge per rad, Totalt (summan av lägena som formel) och Antal order.
 * En vecka räknad i efterhand har bara totalen — kursiv och grå, utan formel, eftersom lägena saknas.
 * Årskolumnen lämnas tom: en orderstock är ett läge, och veckornas lägen går inte att lägga ihop.
 */
function writeStockBlock(
  sheet: ExcelJS.Worksheet,
  stockWeeks: Array<WeekStock | null> | null,
  weeks: Array<{ to: string }>,
  at: { start: number; firstCol: number; totalCol: number },
) {
  // Rubriken på en egen rad: bredvid ett lägesnamn i kolumn B hade den klippts vid kolumn A:s kant.
  const firstStage = at.start + 1;
  const totalRow = firstStage + STOCK_STAGE_ORDER.length;
  const countRow = totalRow + 1;
  sheet.getCell(at.start, 1).value = stockWeeks ? 'Orderstock vid veckans slut' : 'Orderstock vid veckans slut — kunde inte läsas';
  STOCK_STAGE_ORDER.forEach((key, i) => { sheet.getCell(firstStage + i, 2).value = STAGE_LABELS[key]; });
  sheet.getCell(totalRow, 2).value = 'Totalt';
  sheet.getCell(countRow, 2).value = 'Antal order';

  (stockWeeks ?? []).forEach((week, index) => {
    const c = at.firstCol + index;
    if (!week) return;
    if (week.stages) {
      STOCK_STAGE_ORDER.forEach((key, i) => {
        sheet.getCell(firstStage + i, c).value = week.stages?.find((stage) => stage.key === key)?.value ?? 0;
      });
      formula(sheet.getCell(totalRow, c), `SUM(${ref(firstStage, c)}:${ref(totalRow - 1, c)})`, week.value);
      // Veckans senaste bild är inte från söndagen: jobbet sparade inget senare den veckan. Läget står kvar, men
      // med datumet, så att ingen läser fredagens stock som veckans slut.
      if (week.kind === 'snapshot' && week.day !== weeks[index]?.to) {
        sheet.getCell(totalRow, c).note = `Läget den ${longDate(week.day)} — inget sparades senare den veckan.`;
      }
    } else {
      sheet.getCell(totalRow, c).value = week.value;
    }
    sheet.getCell(countRow, c).value = week.count;
  });

  for (let row = at.start; row <= countRow; row++) {
    for (let column = 1; column <= at.totalCol; column++) {
      const cell = sheet.getCell(row, column);
      const week = column >= at.firstCol && column < at.totalCol ? stockWeeks?.[column - at.firstCol] : null;
      const reconstructed = week?.kind === 'reconstructed';
      font(cell, { bold: (column === 1 && row === at.start) || row === totalRow, italic: reconstructed, color: reconstructed ? { argb: MUTED } : undefined });
      if (column >= at.firstCol) cell.numFmt = row === countRow ? FMT_COUNT : FMT_KR;
      bottomBorder(cell, row === countRow ? 'medium' : 'thin', row === countRow ? GREEN : BORDER);
    }
  }
}

function buildWeekly(workbook: ExcelJS.Workbook, report: OwnerReport) {
  const sheet = addSheet(workbook, 'Per vecka', { xSplit: 2, ySplit: 7 });
  title(sheet, `Per vecka ${report.year}`, [
    'Offerter på offertdatum, order på skapandedag, fakturerat på fakturadag. Belopp exklusive moms.',
    'Kursiv hit rate = preliminär (veckans offerter är yngre än 30 dagar). * = veckan pågår.',
    'Orderstock = det som återstår att fakturera vid veckans slut (den pågående veckan: nu). Kursivt = beräknat i efterhand — bara totalen, med orderns nuvarande värde, och avbrutna order räknas inte.',
  ]);

  const weeks = report.weeks;
  const firstCol = 3;
  const lastWeekCol = firstCol + weeks.length - 1;
  const totalCol = lastWeekCol + 1;

  // Rubrikerna: veckonummer och datum.
  headerCell(sheet.getCell(6, 1), 'Säljare', 'left');
  headerCell(sheet.getCell(6, 2), '', 'left');
  headerCell(sheet.getCell(7, 1), '', 'left');
  headerCell(sheet.getCell(7, 2), '', 'left');
  weeks.forEach((week, index) => {
    headerCell(sheet.getCell(6, firstCol + index), `v. ${week.week}${week.current ? '*' : ''}`);
    headerCell(sheet.getCell(7, firstCol + index), shortSpan(week.from, week.to));
    font(sheet.getCell(7, firstCol + index), { size: 8, color: { argb: WHITE } });
  });
  headerCell(sheet.getCell(6, totalCol), 'Totalt');
  headerCell(sheet.getCell(7, totalCol), 'året');
  font(sheet.getCell(7, totalCol), { size: 8, color: { argb: WHITE } });

  // Hela företaget först: det ägarna läser först. Summorna pekar på säljarblocken nedanför. Sedan
  // orderstocken vid veckans slut, sedan säljarna.
  const companyRows = 10;
  const companyStart = 8;
  const stockStart = companyStart + companyRows + 1;
  const sellerStart = stockStart + STOCK_ROWS + 1;
  const sellerRow = (sellerIndex: number, metricIndex: number) => sellerStart + sellerIndex * SELLER_ROWS.length + metricIndex;
  const sumOfSellers = (metricIndex: number, column: number) =>
    report.sellers.length
      ? report.sellers.map((_, s) => ref(sellerRow(s, metricIndex), column)).join('+')
      : '0';

  const t = report.totals;
  type CompanyRow = { label: string; fmt: string; cell: (column: number, row: number, m: OwnerMetrics) => void };
  const r = (offset: number) => companyStart + offset;
  const company: CompanyRow[] = [
    { label: 'Offerter', fmt: FMT_COUNT, cell: (c, row, m) => formula(sheet.getCell(row, c), sumOfSellers(0, c), m.quotes) },
    { label: 'Offertvärde', fmt: FMT_KR, cell: (c, row, m) => formula(sheet.getCell(row, c), sumOfSellers(1, c), m.quoteValue) },
    { label: 'Vunna', fmt: FMT_COUNT, cell: (c, row, m) => { sheet.getCell(row, c).value = m.won; } },
    { label: 'Vunnet värde', fmt: FMT_KR, cell: (c, row, m) => { sheet.getCell(row, c).value = m.wonValue; } },
    { label: 'Hit rate', fmt: FMT_PERCENT, cell: (c, row, m) => formula(sheet.getCell(row, c), `IF(${ref(r(0), c)}>0,${ref(r(2), c)}/${ref(r(0), c)},"")`, ratio(m.won, m.quotes)) },
    { label: 'Hit rate kr', fmt: FMT_PERCENT, cell: (c, row, m) => formula(sheet.getCell(row, c), `IF(${ref(r(1), c)}>0,${ref(r(3), c)}/${ref(r(1), c)},"")`, ratio(m.wonValue, m.quoteValue)) },
    { label: 'Order', fmt: FMT_COUNT, cell: (c, row, m) => formula(sheet.getCell(row, c), sumOfSellers(2, c), m.orders) },
    { label: 'Ordervärde', fmt: FMT_KR, cell: (c, row, m) => formula(sheet.getCell(row, c), sumOfSellers(3, c), m.orderValue) },
    { label: 'Snittorder', fmt: FMT_KR, cell: (c, row, m) => formula(sheet.getCell(row, c), `IF(${ref(r(6), c)}>0,${ref(r(7), c)}/${ref(r(6), c)},"")`, ratio(m.orderValue, m.orders)) },
    { label: 'Fakturerat', fmt: FMT_KR, cell: (c, row, m) => formula(sheet.getCell(row, c), sumOfSellers(4, c), m.invoicedValue) },
  ];
  company.forEach((line, offset) => {
    const row = r(offset);
    const name = sheet.getCell(row, 1);
    if (offset === 0) name.value = 'Hela företaget';
    sheet.getCell(row, 2).value = line.label;
    weeks.forEach((_, index) => line.cell(firstCol + index, row, t.weeks[index]));
    line.cell(totalCol, row, t.total);
    for (let column = 1; column <= totalCol; column++) {
      const cell = sheet.getCell(row, column);
      const prelim = line.fmt === FMT_PERCENT && column >= firstCol && (column === totalCol ? report.totalPreliminary : weeks[column - firstCol]?.preliminary);
      font(cell, { bold: column === 1 || column === totalCol, italic: Boolean(prelim), color: prelim ? { argb: MUTED } : undefined });
      fill(cell, ACCENT_SOFT);
      if (column >= firstCol) cell.numFmt = line.fmt;
      bottomBorder(cell);
    }
  });
  for (let column = 1; column <= totalCol; column++) bottomBorder(sheet.getCell(r(companyRows - 1), column), 'medium', GREEN);

  writeStockBlock(sheet, report.stockWeeks, weeks, { start: stockStart, firstCol, totalCol });

  report.sellers.forEach((seller, s) => {
    SELLER_ROWS.forEach((line, metricIndex) => {
      const row = sellerRow(s, metricIndex);
      if (metricIndex === 0) sheet.getCell(row, 1).value = seller.name;
      sheet.getCell(row, 2).value = line.label;
      weeks.forEach((_, index) => { sheet.getCell(row, firstCol + index).value = line.get(seller.weeks[index]); });
      formula(sheet.getCell(row, totalCol), `SUM(${ref(row, firstCol)}:${ref(row, lastWeekCol)})`, line.get(seller.total));
      for (let column = 1; column <= totalCol; column++) {
        const cell = sheet.getCell(row, column);
        font(cell, { bold: (column === 1 && metricIndex === 0) || column === totalCol, italic: seller.userId == null });
        if (s % 2 === 0) fill(cell, SAGE);
        if (column >= firstCol) cell.numFmt = line.fmt;
        bottomBorder(cell, metricIndex === SELLER_ROWS.length - 1 ? 'medium' : 'thin', metricIndex === SELLER_ROWS.length - 1 ? GREEN : BORDER);
      }
    });
  });

  sheet.getColumn(1).width = 24;
  sheet.getColumn(2).width = 14;
  for (let column = firstCol; column <= totalCol; column++) sheet.getColumn(column).width = column === totalCol ? 15 : 12.5;
}

// ── Budget mot utfall ────────────────────────────────────────────────────────

type BudgetMeasure = { label: string; budget: (b: OwnerBudget) => number | null; actual: (m: OwnerMetrics) => number };
const BUDGET_MEASURES: BudgetMeasure[] = [
  { label: 'Ordervärde', budget: (b) => b.orderValue, actual: (m) => m.orderValue },
  { label: 'Offertvärde', budget: (b) => b.quoteValue, actual: (m) => m.quoteValue },
  { label: 'Fakturerat', budget: (b) => b.invoicedValue, actual: (m) => m.invoicedValue },
];

function buildBudget(workbook: ExcelJS.Workbook, report: OwnerReport) {
  const sheet = addSheet(workbook, 'Budget mot utfall', { xSplit: 2, ySplit: 5 });
  const current = report.months.find((month) => month.current);
  title(sheet, `Budget mot utfall ${report.year}`, [
    report.budgetUnavailable
      ? 'Budgeten kunde inte läsas när filen skapades — bara utfallet visas.'
      : 'Budget = säljarnas månadsmål i CRM:et. Tom ruta = ingen budget satt. Årets andel visas bara när varje månad har budget.',
    current
      ? `* = månaden pågår: utfallet t.o.m. ${longDate(report.today)} mot hela månadens budget. Belopp exklusive moms.`
      : 'Belopp exklusive moms.',
  ]);

  const months = report.months;
  const firstCol = 3;
  const lastMonthCol = firstCol + months.length - 1;
  const yearCol = lastMonthCol + 1;
  headerCell(sheet.getCell(5, 1), 'Säljare', 'left');
  headerCell(sheet.getCell(5, 2), '', 'left');
  months.forEach((month, index) => {
    const m = Number(month.period.slice(5, 7));
    headerCell(sheet.getCell(5, firstCol + index), `${MONTHS_SHORT[m - 1]}${month.current ? '*' : ''}`);
  });
  headerCell(sheet.getCell(5, yearCol), 'Året');

  // Hela företaget: budget och utfall summerar säljarblocken nedanför. Varje block har tre rader per mått
  // (budget, utfall, andel); "Utan säljare" bara utfall — mål sätts per person.
  const sellers = report.sellers;
  const blockRows = (seller: OwnerSeller) => (seller.userId == null ? BUDGET_MEASURES.length : BUDGET_MEASURES.length * 3);
  const companyStart = 6;
  const companyRows = BUDGET_MEASURES.length * 3;
  const starts: number[] = [];
  let next = companyStart + companyRows + 1;
  for (const seller of sellers) {
    starts.push(next);
    next += blockRows(seller);
  }
  /** Raden för ett mått i ett säljarblock. kind: 0 budget, 1 utfall, 2 andel. */
  const sellerLine = (s: number, measure: number, kind: 0 | 1 | 2) =>
    sellers[s].userId == null ? (kind === 1 ? starts[s] + measure : null) : starts[s] + measure * 3 + kind;

  const styleRow = (row: number, opts: { fmt: string; zebra: boolean; bold?: boolean; italic?: boolean; last?: boolean; company?: boolean }) => {
    for (let column = 1; column <= yearCol; column++) {
      const cell = sheet.getCell(row, column);
      font(cell, { bold: opts.bold || column === yearCol || (column === 1 && Boolean(cell.value)), italic: opts.italic, color: opts.fmt === FMT_PERCENT && column >= firstCol ? { argb: GREEN } : undefined });
      if (opts.company) fill(cell, ACCENT_SOFT);
      else if (opts.zebra) fill(cell, SAGE);
      if (column >= firstCol) cell.numFmt = opts.fmt;
      bottomBorder(cell, opts.last ? 'medium' : 'thin', opts.last ? GREEN : BORDER);
    }
  };

  /** Andelsraden: utfall ÷ budget per månad; året bara när varje månad har budget. */
  const shareRow = (row: number, budgetRow: number, actualRow: number, budgets: Array<number | null>, actuals: number[], yearBudget: number, yearActual: number) => {
    months.forEach((_, index) => {
      const c = firstCol + index;
      const budget = budgets[index];
      formula(sheet.getCell(row, c), `IF(N(${ref(budgetRow, c)})>0,${ref(actualRow, c)}/${ref(budgetRow, c)},"")`, budget != null && budget > 0 ? actuals[index] / budget : '');
    });
    const range = `${ref(budgetRow, firstCol)}:${ref(budgetRow, lastMonthCol)}`;
    const allMonths = budgets.every((budget) => budget != null && budget > 0);
    formula(
      sheet.getCell(row, yearCol),
      // COUNT, inte COUNTIF(">0"): en budgetruta är antingen ett tal över noll eller tom/"" (budgetSum), och
      // COUNT räknar bara tal i varje kalkylprogram — COUNTIF:s jämförelse mot text skiljer sig mellan dem.
      `IF(COUNT(${range})=${months.length},${ref(actualRow, yearCol)}/${ref(budgetRow, yearCol)},"")`,
      allMonths && yearBudget > 0 ? yearActual / yearBudget : '',
    );
  };

  // Hela företaget
  BUDGET_MEASURES.forEach((measure, mi) => {
    const budgetRow = companyStart + mi * 3;
    const actualRow = budgetRow + 1;
    const share = budgetRow + 2;
    const budgets = months.map((_, index) => {
      const values = sellers.map((seller) => (seller.budget ? measure.budget(seller.budget[index]) : null)).filter((v): v is number => v != null);
      return values.length ? values.reduce((a, b) => a + b, 0) : null;
    });
    const actuals = report.totals.months.map(measure.actual);
    if (mi === 0) sheet.getCell(budgetRow, 1).value = 'Hela företaget';
    sheet.getCell(budgetRow, 2).value = `${measure.label} – budget`;
    sheet.getCell(actualRow, 2).value = `${measure.label} – utfall`;
    sheet.getCell(share, 2).value = `${measure.label} – av budget`;
    months.forEach((_, index) => {
      const c = firstCol + index;
      const budgetRefs = sellers.map((__, s) => sellerLine(s, mi, 0)).filter((row): row is number => row != null).map((row) => ref(row, c));
      if (budgetRefs.length) budgetSum(sheet.getCell(budgetRow, c), budgetRefs.join(','), budgets[index] ?? 0);
      const actualRefs = sellers.map((__, s) => sellerLine(s, mi, 1)).filter((row): row is number => row != null).map((row) => ref(row, c));
      formula(sheet.getCell(actualRow, c), actualRefs.length ? actualRefs.join('+') : '0', actuals[index]);
    });
    const yearBudget = budgets.reduce<number>((a, b) => a + (b ?? 0), 0);
    const yearActual = actuals.reduce((a, b) => a + b, 0);
    budgetSum(sheet.getCell(budgetRow, yearCol), `${ref(budgetRow, firstCol)}:${ref(budgetRow, lastMonthCol)}`, yearBudget);
    formula(sheet.getCell(actualRow, yearCol), `SUM(${ref(actualRow, firstCol)}:${ref(actualRow, lastMonthCol)})`, yearActual);
    shareRow(share, budgetRow, actualRow, budgets, actuals, yearBudget, yearActual);
    styleRow(budgetRow, { fmt: FMT_KR, zebra: false, company: true });
    styleRow(actualRow, { fmt: FMT_KR, zebra: false, company: true });
    styleRow(share, { fmt: FMT_PERCENT, zebra: false, company: true, last: mi === BUDGET_MEASURES.length - 1 });
  });

  // Säljarna
  sellers.forEach((seller, s) => {
    const zebra = s % 2 === 0;
    BUDGET_MEASURES.forEach((measure, mi) => {
      const actualRow = sellerLine(s, mi, 1)!;
      const actuals = seller.months.map(measure.actual);
      const yearActual = actuals.reduce((a, b) => a + b, 0);
      const lastOfBlock = mi === BUDGET_MEASURES.length - 1;
      if (seller.userId == null) {
        if (mi === 0) sheet.getCell(actualRow, 1).value = seller.name;
        sheet.getCell(actualRow, 2).value = `${measure.label} – utfall`;
        actuals.forEach((value, index) => { sheet.getCell(actualRow, firstCol + index).value = value; });
        formula(sheet.getCell(actualRow, yearCol), `SUM(${ref(actualRow, firstCol)}:${ref(actualRow, lastMonthCol)})`, yearActual);
        styleRow(actualRow, { fmt: FMT_KR, zebra, italic: true, last: lastOfBlock });
        return;
      }
      const budgetRow = sellerLine(s, mi, 0)!;
      const share = sellerLine(s, mi, 2)!;
      const budgets = months.map((_, index) => (seller.budget ? measure.budget(seller.budget[index]) : null));
      if (mi === 0) sheet.getCell(budgetRow, 1).value = seller.name;
      sheet.getCell(budgetRow, 2).value = `${measure.label} – budget`;
      sheet.getCell(actualRow, 2).value = `${measure.label} – utfall`;
      sheet.getCell(share, 2).value = `${measure.label} – av budget`;
      budgets.forEach((budget, index) => { if (budget != null) sheet.getCell(budgetRow, firstCol + index).value = budget; });
      actuals.forEach((value, index) => { sheet.getCell(actualRow, firstCol + index).value = value; });
      const yearBudget = budgets.reduce<number>((a, b) => a + (b ?? 0), 0);
      budgetSum(sheet.getCell(budgetRow, yearCol), `${ref(budgetRow, firstCol)}:${ref(budgetRow, lastMonthCol)}`, yearBudget);
      formula(sheet.getCell(actualRow, yearCol), `SUM(${ref(actualRow, firstCol)}:${ref(actualRow, lastMonthCol)})`, yearActual);
      shareRow(share, budgetRow, actualRow, budgets, actuals, yearBudget, yearActual);
      styleRow(budgetRow, { fmt: FMT_KR, zebra });
      styleRow(actualRow, { fmt: FMT_KR, zebra });
      styleRow(share, { fmt: FMT_PERCENT, zebra, last: lastOfBlock });
    });
  });

  sheet.getColumn(1).width = 24;
  sheet.getColumn(2).width = 24;
  for (let column = firstCol; column <= yearCol; column++) sheet.getColumn(column).width = 13;
}

/** Arbetsboken. Separat från bufferten så att testerna kan läsa cellerna direkt. */
export function buildOwnerWorkbook(report: OwnerReport, createdAt: Date = new Date()): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ekovilla CRM';
  workbook.created = createdAt;
  workbook.modified = createdAt;
  workbook.calcProperties.fullCalcOnLoad = true;
  buildSummary(workbook, report);
  buildWeekly(workbook, report);
  buildBudget(workbook, report);
  return workbook;
}

export async function writeOwnerWorkbook(report: OwnerReport, createdAt?: Date): Promise<Buffer> {
  const buffer = await buildOwnerWorkbook(report, createdAt).xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

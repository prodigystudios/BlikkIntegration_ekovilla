import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildOwnerReport, type OwnerGoalRow } from '@/lib/domains/crm/reportOwnerExport';
import {
  buildOwnerWorkbook,
  longDate,
  ownerReportFilename,
  shortSpan,
  writeOwnerWorkbook,
} from '@/lib/domains/crm/reportOwnerWorkbook';
import type { ReportData, ReportOrderRow, ReportQuoteRow } from '@/lib/domains/crm/reports';

// Arbetsboken: summor och kvoter är formler MED förberäknat värde. Formeln gör arket levande, värdet gör
// att en förhandsvisning som inte räknar ändå visar talen — och de två måste vara samma tal.

const quote = (over: Partial<ReportQuoteRow>): ReportQuoteRow => ({
  amount: 10_000, vat_percent: 0, status: 'sent', quote_date: '2026-09-02', assigned_to: 'u1', customer_name: 'Kund', quote_type: 'business', ...over,
});
const order = (over: Partial<ReportOrderRow>): ReportOrderRow => ({
  id: 'o', amount: 20_000, vat_percent: 0, status: 'scheduled', created_at: '2026-09-02T09:00:00Z', fortnox_invoiced_at: null,
  partial_invoicing_started_at: null, assigned_to: 'u1', client_name: 'Kund', quote_type: 'business', customer_id: null,
  rot_enabled: null, customer: null, ...over,
});

const data: ReportData = {
  quotes: [
    quote({ status: 'won', quote_date: '2026-08-31', amount: 12_000 }),
    quote({ quote_date: '2026-09-02', assigned_to: 'u2', amount: 6_000 }),
    quote({ quote_date: '2026-10-06', assigned_to: null, amount: 3_000 }),
  ],
  orders: [
    order({ id: 'a', created_at: '2026-08-31T09:00:00Z', amount: 12_000, status: 'invoiced', fortnox_invoiced_at: '2026-09-10T09:00:00Z' }),
    order({ id: 'b', created_at: '2026-10-07T09:00:00Z', assigned_to: 'u2', amount: 30_000 }),
  ],
  invoiceRounds: [],
  calls: [],
  sellers: [{ id: 'u1', full_name: 'Anna Andersson' }, { id: 'u2', full_name: 'Björn Berg' }],
};
const goals: OwnerGoalRow[] = [
  { user_id: 'u1', period_start: '2026-09-01', quote_value_target: 50_000, order_value_target: 40_000, invoiced_value_target: 30_000 },
  { user_id: 'u1', period_start: '2026-10-01', quote_value_target: 50_000, order_value_target: 40_000, invoiced_value_target: 0 },
];
const report = buildOwnerReport({
  data,
  range: { from: '2026-01-01', to: '2026-10-09' },
  today: '2026-10-09',
  goals,
  orderStockRows: [{ status: 'scheduled', amount: 30_000, vat_percent: 0, invoice_rounds: [] }],
  basis: { range: { from: '2026-09-01', to: '2026-09-30' }, invoiced: 12_000 },
});
const workbook = buildOwnerWorkbook(report, new Date('2026-10-09T12:00:00Z'));

const formulaOf = (cell: ExcelJS.Cell) => (cell.value as ExcelJS.CellFormulaValue).formula;
// `cell.result`, inte `cell.value.result`: exceljs value-getter tappar falska resultat (0 och "") — filen
// skrivs ändå rätt, eftersom skrivaren läser modellen direkt.
const resultOf = (cell: ExcelJS.Cell) => cell.result;
function findRow(sheet: ExcelJS.Worksheet, column: number, text: string, from = 1): number {
  for (let r = from; r <= sheet.rowCount; r++) if (sheet.getCell(r, column).value === text) return r;
  throw new Error(`hittar inte "${text}"`);
}

describe('arbetsboken', () => {
  it('har tre flikar i läsordning och räknar om vid öppning', () => {
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Sammanfattning', 'Per vecka', 'Budget mot utfall']);
    expect(workbook.calcProperties.fullCalcOnLoad).toBe(true);
  });

  it('varje formel har ett förberäknat värde', () => {
    let formulas = 0;
    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) => row.eachCell((cell) => {
        const value = cell.value as ExcelJS.CellFormulaValue;
        if (value && typeof value === 'object' && 'formula' in value) {
          formulas++;
          expect(cell.result, `${sheet.name}!${cell.address}`).not.toBeUndefined();
        }
      }));
    }
    expect(formulas).toBeGreaterThan(50);
  });

  it('Sammanfattning: säljarna i namnordning, Utan säljare sist, Hela företaget summerar med formler', () => {
    const sheet = workbook.getWorksheet('Sammanfattning')!;
    const header = findRow(sheet, 1, 'Säljare');
    expect([1, 2, 3].map((i) => sheet.getCell(header + i, 1).value)).toEqual(['Anna Andersson', 'Björn Berg', 'Utan säljare']);
    const total = findRow(sheet, 1, 'Hela företaget');
    expect(formulaOf(sheet.getCell(total, 2))).toBe(`SUM(B${header + 1}:B${total - 1})`);
    expect(resultOf(sheet.getCell(total, 2))).toBe(3);
    expect(resultOf(sheet.getCell(total, 9))).toBe(42_000);
    // Hit rate = vunna ÷ offerter, som formel på raden.
    expect(formulaOf(sheet.getCell(header + 1, 6))).toBe(`IF(B${header + 1}>0,D${header + 1}/B${header + 1},"")`);
    expect(resultOf(sheet.getCell(header + 1, 6))).toBe(1);
    expect(resultOf(sheet.getCell(header + 2, 6))).toBe(0);
    expect(sheet.getCell(header + 1, 3).numFmt).toBe('#,##0 "kr";-#,##0 "kr";"–"');
    expect(sheet.getCell(header + 1, 6).numFmt).toBe('0%');
  });

  it('Sammanfattning: orderstocken just nu och en förklaring av Utan säljare', () => {
    const sheet = workbook.getWorksheet('Sammanfattning')!;
    const stage = findRow(sheet, 1, 'Planerad');
    expect(sheet.getCell(stage, 3).value).toBe(30_000);
    const total = findRow(sheet, 1, 'Totalt', stage);
    expect(resultOf(sheet.getCell(total, 3))).toBe(30_000);
    const texts: string[] = [];
    sheet.eachRow((row) => texts.push(String(row.getCell(1).value ?? '')));
    expect(texts.some((t) => t.includes('Utan säljare'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Räcker ungefär'))).toBe(true);
  });

  it('Per vecka: hela företaget först, med summor som pekar på säljarblocken', () => {
    const sheet = workbook.getWorksheet('Per vecka')!;
    expect(sheet.getCell(6, 3).value).toBe('v. 36'); // 31 aug–6 sep: första veckan med aktivitet
    expect(sheet.getCell(7, 3).value).toBe('31 aug–6 sep');
    const last = report.weeks.length + 2;
    expect(sheet.getCell(6, last).value).toBe('v. 41*');
    expect(sheet.getCell(6, last + 1).value).toBe('Totalt');

    expect(sheet.getCell(8, 1).value).toBe('Hela företaget');
    const anna = findRow(sheet, 1, 'Anna Andersson', 9);
    const bjorn = findRow(sheet, 1, 'Björn Berg', 9);
    const none = findRow(sheet, 1, 'Utan säljare', 9);
    expect(formulaOf(sheet.getCell(8, 3))).toBe(`C${anna}+C${bjorn}+C${none}`);
    // Säljarens totalkolumn summerar raden.
    expect(formulaOf(sheet.getCell(anna, last + 1))).toBe(`SUM(C${anna}:${sheet.getColumn(last).letter}${anna})`);
  });

  it('Per vecka: preliminär hit rate står kursivt, en mogen vecka gör det inte', () => {
    const sheet = workbook.getWorksheet('Per vecka')!;
    const hit = findRow(sheet, 2, 'Hit rate', 7);
    expect(sheet.getCell(hit, 3).font?.italic).toBe(false); // v. 36, slutar 6 sep: mogen
    expect(sheet.getCell(hit, report.weeks.length + 2).font?.italic).toBe(true); // v. 41
  });

  it('Budget mot utfall: ingen budget = tom ruta, aldrig 0 kr; året bara när varje månad har budget', () => {
    const sheet = workbook.getWorksheet('Budget mot utfall')!;
    const months = report.months.map((m) => m.period);
    expect(months).toEqual(['2026-08', '2026-09', '2026-10']);
    const anna = findRow(sheet, 1, 'Anna Andersson', 7);
    // Ordervärde – budget: ingen i augusti, 40 000 i september och oktober.
    expect(sheet.getCell(anna, 3).value).toBeNull();
    expect(sheet.getCell(anna, 4).value).toBe(40_000);
    // Fakturerat i oktober är 0 i målet = ingen budget.
    const invoicedBudget = findRow(sheet, 2, 'Fakturerat – budget', anna);
    expect(sheet.getCell(invoicedBudget, 5).value).toBeNull();
    // Andelen: tom utan budget, utfall ÷ budget med.
    expect(resultOf(sheet.getCell(anna + 2, 3))).toBe('');
    // September: Annas order skapades 31 augusti, så september har 0 kr ordervärde mot 40 000 i budget.
    expect(resultOf(sheet.getCell(anna + 2, 4))).toBe(0);
    expect(formulaOf(sheet.getCell(anna + 2, 4))).toBe(`IF(N(D${anna})>0,D${anna + 1}/D${anna},"")`);
    // Året: augusti saknar budget → ingen årsandel. COUNT, inte COUNTIF (se arbetsboken).
    expect(formulaOf(sheet.getCell(anna + 2, 6))).toBe('IF(COUNT(C' + anna + ':E' + anna + ')=3,F' + (anna + 1) + '/F' + anna + ',"")');
    expect(resultOf(sheet.getCell(anna + 2, 6))).toBe('');

    // Hela företagets budget summerar säljarnas och är tom där ingen har budget.
    const companyBudget = findRow(sheet, 2, 'Ordervärde – budget', 6);
    expect(formulaOf(sheet.getCell(companyBudget, 3))).toContain('IF(SUM(');
    expect(resultOf(sheet.getCell(companyBudget, 3))).toBe('');
    expect(resultOf(sheet.getCell(companyBudget, 4))).toBe(40_000);
    // Utan säljare har bara utfall — mål sätts per person.
    const none = findRow(sheet, 1, 'Utan säljare', 7);
    expect(sheet.getCell(none, 2).value).toBe('Ordervärde – utfall');
  });

  it('kan skrivas och läsas tillbaka', async () => {
    const buffer = await writeOwnerWorkbook(report, new Date('2026-10-09T12:00:00Z'));
    expect(buffer.subarray(0, 2).toString()).toBe('PK'); // xlsx är en zip
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(back.worksheets.map((s) => s.name)).toEqual(['Sammanfattning', 'Per vecka', 'Budget mot utfall']);
    expect(back.getWorksheet('Per vecka')!.views[0]).toMatchObject({ state: 'frozen', xSplit: 2, ySplit: 7 });
  });
});

describe('Per vecka — orderstocken vid veckans slut', () => {
  const stockReport = buildOwnerReport({
    data,
    range: { from: '2026-01-01', to: '2026-10-09' },
    today: '2026-10-09',
    goals,
    orderStockRows: [{ status: 'scheduled', amount: 30_000, vat_percent: 0, invoice_rounds: [] }],
    basis: null,
    stockHistory: {
      snapshots: [{ day: '2026-09-27', totalCount: 2, totalValue: 50_000, stages: [{ key: 'draft', count: 1, value: 20_000 }, { key: 'scheduled', count: 1, value: 30_000 }] }],
      firstSnapshotDay: '2026-09-27',
      reconstructOrders: [{ amount: 12_000, vat_percent: 0, status: 'scheduled', created_at: '2026-08-31T09:00:00Z', fortnox_invoiced_at: null, invoice_rounds: [] }],
    },
  });
  const sheet = buildOwnerWorkbook(stockReport).getWorksheet('Per vecka')!;
  const start = findRow(sheet, 1, 'Orderstock vid veckans slut', 8);
  const total = findRow(sheet, 2, 'Totalt', start);
  const count = findRow(sheet, 2, 'Antal order', start);
  const col = (week: number) => 3 + stockReport.weeks.findIndex((w) => w.week === week);

  it('står mellan hela företaget och säljarna, med lägena, Totalt och Antal order', () => {
    expect(start).toBeLessThan(findRow(sheet, 1, 'Anna Andersson', 9));
    expect([0, 1, 2, 3, 4].map((i) => sheet.getCell(start + i, 2).value)).toEqual(['Ej planerad', 'Planerad', 'Pågår', 'Delfakturerad (det som återstår)', 'Klar att fakturera']);
  });

  it('en vecka före den första bilden: bara totalen, kursiv och grå, utan formel', () => {
    const c = col(36); // 31 aug–6 sep, före bilden den 27 sep
    expect(sheet.getCell(total, c).value).toBe(12_000);
    expect(sheet.getCell(start, c).value).toBeNull();
    expect(sheet.getCell(total, c).font?.italic).toBe(true);
    expect(sheet.getCell(count, c).value).toBe(1);
  });

  it('en vecka med en bild: lägena och Totalt som summaformel', () => {
    const c = col(39); // 21–27 sep
    expect(sheet.getCell(start, c).value).toBe(20_000);
    expect(sheet.getCell(start + 1, c).value).toBe(30_000);
    expect(formulaOf(sheet.getCell(total, c))).toBe(`SUM(${sheet.getColumn(c).letter}${start}:${sheet.getColumn(c).letter}${total - 1})`);
    expect(resultOf(sheet.getCell(total, c))).toBe(50_000);
    expect(sheet.getCell(total, c).font?.italic).toBe(false);
  });

  it('den pågående veckan: läget nu', () => {
    const c = col(41);
    expect(resultOf(sheet.getCell(total, c))).toBe(30_000);
  });

  it('en lucka efter den första bilden står tom, och årskolumnen är tom', () => {
    expect(sheet.getCell(total, col(40)).value).toBeNull();
    expect(sheet.getCell(total, 3 + stockReport.weeks.length).value).toBeNull();
  });

  it('utan historik säger blocket att den inte kunde läsas', () => {
    const plain = buildOwnerWorkbook(report).getWorksheet('Per vecka')!;
    expect(findRow(plain, 1, 'Orderstock vid veckans slut — kunde inte läsas', 8)).toBeGreaterThan(8);
  });
});

describe('etiketter', () => {
  it('datum och veckospann på svenska', () => {
    expect(longDate('2026-10-09')).toBe('9 oktober 2026');
    expect(shortSpan('2026-07-27', '2026-08-02')).toBe('27 jul–2 aug');
    expect(shortSpan('2026-10-05', '2026-10-09')).toBe('5–9 okt');
    expect(shortSpan('2026-01-01', '2026-01-01')).toBe('1 jan');
  });

  it('filnamnet bär dagens datum, i ASCII — veckan hör runt nyår till grannåret', () => {
    expect(ownerReportFilename(report)).toBe('Forsaljningsrapport-2026-10-09.xlsx');
  });
});

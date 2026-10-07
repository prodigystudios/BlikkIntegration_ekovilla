import { monthBounds } from '@/lib/domains/crm/reportGoals';

// Rapportsidans flikar. Ren modul — ingen React, ingen klocka — så att reglerna för vilka flikar som
// syns och vad ?flik= får peka på kan prövas utan en webbläsare.
//
// En sida med sex flikar i stället för åtta sektioner på rad (spec 2026-10-07): varje flik svarar på
// en fråga. Ingenting försvinner, sektionerna byter bara plats.

export type ReportTabId = 'oversikt' | 'forsaljning' | 'omsattning' | 'produkt' | 'produktion' | 'tid';

export type ReportTab = { id: ReportTabId; label: string; question: string };

/** I sidans ordning. */
export const REPORT_TABS: ReportTab[] = [
  { id: 'oversikt', label: 'Översikt', question: 'Hur går det?' },
  { id: 'forsaljning', label: 'Försäljning', question: 'Hur säljer vi?' },
  { id: 'omsattning', label: 'Omsättning', question: 'Vad kommer in, vad ligger kvar?' },
  { id: 'produkt', label: 'Produkt & marknad', question: 'Vad säljer vi, och var?' },
  { id: 'produktion', label: 'Produktion', question: 'Planerat mot blåst' },
  { id: 'tid', label: 'Tid', question: 'Vart timmarna tog vägen' },
];

export const DEFAULT_REPORT_TAB: ReportTabId = 'oversikt';

/** URL-parametern, som ?vecka= på översikten. Förvalet skrivs aldrig ut. */
export const TAB_PARAM = 'flik';

/**
 * Flikarna läsaren ser.
 *
 * ⚠️ TID BARA NÄR RUTTEN LÄMNAT UT TIDEN (`time !== null`, alltså `time.entry.read.all` — i dag bara
 * admin). Fliken uteblir helt för andra, i stället för att stå där och säga att något döljs: en yta
 * som skyltar med vad den gömmer inbjuder till att någon ber om nyckeln utan att veta varför den finns.
 *
 * Produkt & marknad saknar innehåll tills det steget byggs, och en tom flik i drift hade bara varit
 * ett löfte. Den visas när `withProduct` sätts.
 */
export function visibleReportTabs(input: { hasTime: boolean; withProduct?: boolean }): ReportTab[] {
  return REPORT_TABS.filter((tab) => {
    if (tab.id === 'tid') return input.hasTime;
    if (tab.id === 'produkt') return Boolean(input.withProduct);
    return true;
  });
}

/**
 * ?flik= tillbaka till en flik läsaren faktiskt har — annars förvalet. En länk till Tid som öppnas av
 * en säljare landar alltså på Översikt, inte på en tom sida.
 */
export function resolveReportTab(value: string | null | undefined, visible: ReportTab[]): ReportTabId {
  const match = visible.find((tab) => tab.id === value);
  return match ? match.id : DEFAULT_REPORT_TAB;
}

const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function parts(day: string): { year: number; month: number; date: number } {
  const [year, month, date] = day.split('-').map(Number);
  return { year, month, date };
}

/**
 * Periodens etikett på ett kort: "sep", "1–7 okt", "29 sep–5 okt", "jan–okt 2026".
 *
 * Korten bär den för att skilja ett periodtal från en ögonblicksbild ("Nu") — två kort bredvid
 * varandra kan annars se ut att mäta samma sak. Året skrivs bara ut när perioden inte ligger i
 * `currentYear`. Ren strängaritmetik på ÅÅÅÅ-MM-DD: ingen tidszon kan flytta en dag.
 */
export function periodChipLabel(range: { from: string; to: string }, currentYear: number): string {
  const from = parts(range.from);
  const to = parts(range.to);
  if (!from.year || !to.year) return `${range.from}–${range.to}`;
  const year = (y: number) => (y === currentYear ? '' : ` ${y}`);
  const month = (m: number) => MONTHS_SHORT[m - 1] ?? '';

  const sameMonth = from.year === to.year && from.month === to.month;
  const wholeMonths = from.date === 1 && range.to === monthBounds(range.to.slice(0, 7)).to;

  if (sameMonth && wholeMonths) return `${month(from.month)}${year(from.year)}`;
  if (sameMonth) {
    return from.date === to.date
      ? `${from.date} ${month(from.month)}${year(from.year)}`
      : `${from.date}–${to.date} ${month(from.month)}${year(from.year)}`;
  }
  if (wholeMonths && from.year === to.year) return `${month(from.month)}–${month(to.month)}${year(to.year)}`;
  if (from.year === to.year) return `${from.date} ${month(from.month)}–${to.date} ${month(to.month)}${year(to.year)}`;
  return `${from.date} ${month(from.month)} ${from.year}–${to.date} ${month(to.month)} ${to.year}`;
}

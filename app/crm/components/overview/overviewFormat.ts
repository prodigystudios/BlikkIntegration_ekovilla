import { stockholmTodayISO } from '@/lib/domains/planning/timezone';

// Samma mening på båda ställena den behövs: bandet och statusbilden visar båda nettobelopp, och
// båda utelämnar avbrutna order — stockraderna genom sina statuslistor (OPEN_/TO_INVOICE_ i
// overviewSummary), veckoraden genom isDeadWorkOrder-vakten. Delad konstant så de inte glider isär.
export const MONEY_NOTE = 'Belopp exklusive moms. Avbrutna order räknas inte.';

export function formatCurrency(value: number | string, currencyCode: string) {
  const numeric = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(numeric)) return '–';
  try {
    return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currencyCode || 'SEK', maximumFractionDigits: 0 }).format(numeric);
  } catch {
    // Valutakoden valideras bara på längd (tre tecken). En kod Intl inte känner kastar RangeError,
    // och det mitt i renderingen fäller hela översikten — Säljcoachen kan plocka fram vilken gammal
    // offert som helst. Talet visas ändå, med koden som den står.
    return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(numeric)} ${currencyCode}`;
  }
}

const MONTHS_LONG = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

/** "25 september" — med år när det inte är läsarens: "3 mars 2025". Byggs ur strängen, ingen tidszon. */
export function formatQuoteDay(day: string, today: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const label = `${date} ${MONTHS_LONG[month - 1]}`;
  return day.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${year}`;
}

/**
 * Den svenska kalenderdagen en tidsstämpel faller på, ÅÅÅÅ-MM-DD — "–" när den inte går att läsa.
 * toISOString().slice(0, 10) hade gett gårdagen mellan 00 och 02 svensk tid. Ett ogiltigt datum får
 * Intl att kasta, och ett kast under renderingen släcker hela översikten.
 */
export function stockholmDateISO(timestamp: string | null | undefined): string {
  if (!timestamp) return '–';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '–' : stockholmTodayISO(date);
}

// Samma mening på båda ställena den behövs: bandet och statusbilden visar båda nettobelopp, och
// båda utelämnar avbrutna order — stockraderna genom sina statuslistor (OPEN_/TO_INVOICE_ i
// overviewSummary), veckoraden genom isDeadWorkOrder-vakten. Delad konstant så de inte glider isär.
export const MONEY_NOTE = 'Belopp exklusive moms. Avbrutna order räknas inte.';

export function formatCurrency(value: number | string, currencyCode: string) {
  const numeric = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(numeric)) return '–';
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currencyCode || 'SEK', maximumFractionDigits: 0 }).format(numeric);
}

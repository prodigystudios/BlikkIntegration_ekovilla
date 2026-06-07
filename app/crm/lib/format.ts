// Shared CRM formatters — single home so locale/rounding/format tweaks land in one
// place (previously duplicated across the work order list, detail, installer and tabs).

export function formatDate(value: string | null | undefined): string {
  if (!value) return '–';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '–' : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '–';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '–' : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatCurrency(value: number | string | null | undefined, currencyCode: string): string {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '0'));
  if (!Number.isFinite(numeric)) return '–';
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currencyCode || 'SEK', maximumFractionDigits: 0 }).format(numeric);
}

export function joinAddress(parts: Array<string | null | undefined>): string {
  return parts.filter((p) => p && p.trim()).join(', ');
}

// A work order is overdue when its desired date has passed and it isn't done/closed.
export function isWorkOrderOverdue(date: string | null | undefined, status: string): boolean {
  if (!date || status === 'completed' || status === 'invoiced' || status === 'cancelled') return false;
  const d = new Date(`${date}T23:59:59`);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

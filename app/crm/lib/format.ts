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

// Reference number to show for an offer/work order. Once synced to Fortnox we lead with
// the Fortnox DocumentNumber (short, e.g. "#5232", and what the customer sees on the PDF)
// — fall back to our internal OFF-/AO- number for unsynced/offline documents. The internal
// number (generated from the row UUID) and the UUID itself remain the stable join keys.
export function documentRef(
  fortnoxNumber: string | null | undefined,
  internalNumber: string | null | undefined,
): string {
  if (fortnoxNumber) return `#${fortnoxNumber}`;
  return internalNumber || '–';
}

// A work order is overdue when its desired date has passed and it isn't done/closed.
export function isWorkOrderOverdue(date: string | null | undefined, status: string): boolean {
  if (!date || status === 'completed' || status === 'invoiced' || status === 'cancelled') return false;
  const d = new Date(`${date}T23:59:59`);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

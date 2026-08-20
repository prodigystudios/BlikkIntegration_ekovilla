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

// Ett radantal: m³-volym eller styckantal, för visning bredvid à-priset.
//
// ⚠️ SAMMA REGEL PÅ ALLA YTOR, med flit. Offerten och arbetsordern formaterade förr var för sig —
// offerten på 2 decimaler, ordern på 3 — så en volym på 4,875 m³ stod som "4,88" på offerten och
// "4,875" på ordern. Skillnaden syns bara när ytan har en decimal (19,5 m²), vilket är varför den
// levde obemärkt tills någon skrev just det. Samma siffra på två skärmar ska se likadan ut.
//
// Två decimaler, alltså tio liter. Beloppen räknas på det exakta talet — det här är visning.
export function formatQuantity(value: number): string {
  return value.toLocaleString('sv-SE', { maximumFractionDigits: 2 });
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

// Säckantal: heltal utan decimalsvans, decimaler med svenskt komma. Kolumnen är numeric(10,2), så
// ett halvt säckantal är möjligt även om det är ovanligt.
export function formatSacks(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100).replace('.', ',');
}

// Säckinmatning från fältet → tal, eller null när rutan inte bär ett tal.
//
// ⚠️ NULL OCH INTE 0. `parseDecimal` faller tillbaka på 0, vilket i den här boken är ett PÅSTÅENDE
// ("vi var här, inget gick åt") och inte en avsaknad. Skrivs "abv" eller lämnas rutan tom ska
// sparningen blockeras, inte skriva en nollrad som fältet sedan inte kan rätta — huvudboken är
// append-only och besättningen har ingen raderingsrätt.
export function parseSackInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+([.,]\d{1,2})?$/.test(trimmed)) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

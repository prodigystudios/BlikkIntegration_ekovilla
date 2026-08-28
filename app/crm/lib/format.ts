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

// Samma två tal som documentRef, samma ordning — men RÅA. Den här är numret man SLÅR UPP med,
// inte numret man visar.
//
// 🧨 SKILLNADEN ÄR HELA POÄNGEN MED ATT DE STÅR BREDVID VARANDRA. documentRef sätter '#' framför
// Fortnox-numret, och uppslaget matchar exakt (`.eq` i lookupCrmWorkOrderByNumber) — '#6579' hittar
// ingenting. Ett rimligt `?orderId=${documentRef(...)}` ger alltså "Ordern hittades inte" på precis
// de ordrar som HAR hunnit synkas, alltså de flesta. Läser du den här filen för att bygga en länk
// eller ett API-anrop: det är den här funktionen, aldrig documentRef.
//
// Precedensen är inte fri: den speglar mapCrmWorkOrderToEgenkontrollProject, som svarar med samma
// val av nummer. Gick de isär skulle egenkontrollen slås upp på ett nummer och sedan skriva ett
// annat i sitt filnamn.
//
// null, inte '–' eller '': anroparen ska kunna se skillnad på "här är numret" och "det finns inget
// nummer att slå upp på" utan att jämföra mot en visningssträng. Utan nummer ska ingen länk
// renderas alls.
export function orderLookupRef(
  fortnoxNumber: string | null | undefined,
  internalNumber: string | null | undefined,
): string | null {
  const fortnox = String(fortnoxNumber ?? '').trim();
  if (fortnox) return fortnox;
  const internal = String(internalNumber ?? '').trim();
  return internal || null;
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

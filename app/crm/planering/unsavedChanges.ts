// Osparade ändringar i Administrera-flikarna (bilar, depåer, leverantörer, jobbtyper).
//
// Egen modul och inte en del av useEntityCrud.ts: reglerna här är rena och bär ett skydd som måste gå att pröva i
// test, och en 'use client'-hook ska inte behöva importeras för det. Samma skäl som placeholderForm.ts.
//
// 🧨 VARFÖR DET HÄR FINNS. Fälten skriver rakt in i listan vid varje tangenttryck (patchLocal), och det man skrivit
// låg kvar när man bytte flik — så det såg sparat ut fast Spara aldrig tryckts. En Plats som aldrig sparades fick
// beställningen nekad med "saknar Plats" medan fältet visade adressen (Williams QA 2026-09-17).

type WithId = { id: string };

/**
 * Raderna vars redigerbara fält skiljer sig från det senast sparade. Jämförs genom panelens `toPayload` — samma fält
 * som Spara skickar — så att fält som inte redigeras här (t.ex. leverantörens mall, som sparas för sig) aldrig
 * räknas som osparade.
 *
 * En rad utan sparat läge (ska inte hända: listan kommer från servern) räknas inte som ändrad.
 */
export function unsavedIds<T extends WithId>(items: T[], saved: Record<string, T>, toPayload: (item: T) => unknown): string[] {
  return items
    .filter((item) => {
      const base = saved[item.id];
      return base !== undefined && comparisonKey(toPayload(item)) !== comparisonKey(toPayload(base));
    })
    .map((item) => item.id);
}

/**
 * Jämförelsenyckeln — bara för frågan "är det ändrat?", aldrig för det som skickas.
 *
 * ⚠️ Skillnader som inte är ändringar får inte ge "Ej sparad" (granskningsfynd): att bocka ur och i ett material igen
 * ändrar ordningen i listan men inte vad fabriken levererar, och en tömd Plats är `null` i fältet men kan vara `''` i
 * databasen. Blanksteg runt texten trimmas av servern. Ett falskt "ej sparad" lär folk att strunta i märket.
 */
function comparisonKey(value: unknown): string {
  return JSON.stringify(normalized(value));
}

function normalized(value: unknown): unknown {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (Array.isArray(value)) {
    const items = value.map(normalized);
    // Bara listor av enkla värden sorteras — där är ordningen ingen uppgift (materialen). Objektlistor lämnas.
    return items.every((x) => x === null || typeof x !== 'object') ? [...items].sort((a, b) => String(a).localeCompare(String(b))) : items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalized(v)]));
  }
  return value;
}

/**
 * Listan med de angivna raderna tillbaka i sitt sparade läge — för Ångra, och när ändringarna kastas vid byte av flik.
 * Bara de raderna: en rad utan ändringar ska inte bytas ut mot ett äldre objekt.
 */
export function revertedItems<T extends WithId>(items: T[], saved: Record<string, T>, ids: string[]): T[] {
  const set = new Set(ids);
  return items.map((item) => (set.has(item.id) && saved[item.id] ? saved[item.id] : item));
}

/**
 * Listan efter en lyckad sparning. Servern kan ha normaliserat (t.ex. trimmat blanksteg), och då ska raden visa det
 * sparade — annars stod den kvar som "ej sparad" direkt efter Spara.
 *
 * ⚠️ BARA OM RADEN ÄR ORÖRD SEDAN KNAPPTRYCKET. Fälten är öppna medan sparningen pågår, och det som skrivits under
 * tiden får inte skrivas över av svaret — det är en ny, osparad ändring.
 */
export function itemsAfterSave<T extends WithId>(items: T[], sent: T, server: Partial<T> | null, toPayload: (item: T) => unknown): T[] {
  const sentPayload = JSON.stringify(toPayload(sent));
  return items.map((item) =>
    item.id === sent.id && JSON.stringify(toPayload(item)) === sentPayload ? ({ ...item, ...(server ?? {}) } as T) : item,
  );
}

/** Det sparade läget efter en lyckad sparning: det som skickades, med serverns svar ovanpå. */
export function savedAfterSave<T extends WithId>(saved: Record<string, T>, sent: T, server: Partial<T> | null): Record<string, T> {
  return { ...saved, [sent.id]: { ...sent, ...(server ?? {}) } as T };
}

/** "Sandviken Lager", "Sandviken och Borlänge", "Sandviken, Borlänge och 2 till". */
export function unsavedNamesText(names: string[]): string {
  const shown = names.map((n) => n.trim() || 'Namnlös');
  if (shown.length <= 1) return shown[0] ?? '';
  if (shown.length === 2) return `${shown[0]} och ${shown[1]}`;
  return `${shown[0]}, ${shown[1]} och ${shown.length - 2} till`;
}

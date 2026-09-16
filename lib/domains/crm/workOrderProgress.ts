// Framdrift på en arbetsorder — meter landgång, antal brandmattor, "Hus A".
//
// Rent och sidoeffektfritt; all I/O ligger hos anroparen. Fyra uppgifter:
//
//   1. Vilka moment som GÅR att rapportera på (ur orderns rader).
//   2. Serverns snapshot-regel för en inkommen rapport (resolveProgressEntry).
//   3. Grupperingen kontoret och fältet läser (per moment, sedan per plats).
//   4. Platsförslagen, så dag två träffar samma "Hus A" som dag ett.
//
// ── INGEN TOTAL ÖVER MOMENT, OCH DET ÄR EN REGEL ─────────────────────────────
// ⚠️ Säckkortet har en totalsumma i rubriken därför att ALLT det räknar är säckar. Här är det
// omöjligt: 45 m landgång + 3 st brandmatta är inget tal. Varje moment bär sin egen summa och sin
// egen enhet, och det finns med flit ingen funktion i den här filen som summerar över moment. En
// sådan hade sett rimlig ut vid anropsstället och tyst adderat meter till styck.
//
// ── INGEN SUPERSEDE, TILL SKILLNAD FRÅN SÄCKBOKEN ────────────────────────────
// Egenkontrollen frågar aldrig om landgång, så det finns ingen "final" som släcker dagsraderna.
// Raderna summeras rakt. Leta inte efter regeln här — den ska inte finnas, se migreringen
// 20260916_crm_work_order_progress_reports.sql.

import { parseDecimal } from '@/lib/shared/number';

// ── Momenten på ordern ───────────────────────────────────────────────────────

/** Bara det momentlistan behöver. Anroparna skickar in sina egna, bredare radtyper. */
export type ProgressLineItemSource = {
  id?: string | null;
  article_name?: string | null;
  line_note?: string | null;
  article_unit_name?: string | null;
  pricing_mode?: string | null;
  quantity?: string | null;
  written_off?: boolean | null;
};

export type ProgressWorkItem = {
  /** Orderradens id. Rapportraden bär det, så "45 av 120 m" går att räkna. */
  lineItemId: string;
  label: string;
  /** Enheten ur artikelregistret. null när raden saknar en. */
  unit: string | null;
  /**
   * Sålt antal. null när raden saknar ett positivt antal — då finns momentet men inte planen, och
   * kortet ska skriva "–" i stället för "45 av 0".
   */
  planned: number | null;
};

/**
 * Orderns rapporterbara moment: antals- och meterraderna.
 *
 * Splitten finns redan i huset (lineItemQuantity): `pricing_mode: 'item'` är antal/meter, allt
 * annat är en YTA som prissätts per m³ — och ytorna är säckrapportens område. Ett moment kan alltså
 * aldrig dubbelrapporteras i båda böckerna.
 *
 * ⚠️ `include_in_description` ANVÄNDS INTE SOM FILTER, trots att måttblockets `isExtraRow` gör
 * precis det. Den flaggan är ett VISNINGSVAL (ska raden stå i arbetsbeskrivningen) som defaultar
 * till false — vindduk utesluts t.ex. för att den lämnas till kunden i förväg. Som filter här hade
 * den dolt landgången för fältet så fort säljaren inte kryssat i den, och installatören hade
 * tvingats skriva fritext. Då flaggas momentet som "ej på ordern", alltså en avvikelse som inte
 * finns: exakt det falska beskedet.
 *
 * ⚠️ Etiketten byggs som `buildExtraRow` bygger den (article_name, annars line_note, blanksteg
 * plattade) så fältet ser SAMMA ord i framdriftskortet som i arbetsbeskrivningen. Två vokabulärer
 * för samma sak i samma vy är hur man bygger in en felöversättning.
 *
 * ⚠️ Men till skillnad från `buildExtraRow` hoppas rader med mängd 0 INTE över. Där är regeln rätt
 * ("en 0 st-rad är inget arbetsmoment" i en beskrivning); här hade den gjort ett sålt moment
 * orapporterbart och tvingat fram samma falska avvikelse som ovan. Raden kommer med, utan plan.
 */
export function progressWorkItemsFromLineItems(items: ProgressLineItemSource[]): ProgressWorkItem[] {
  const out: ProgressWorkItem[] = [];
  for (const item of items) {
    if ((item?.pricing_mode ?? 'm3') !== 'item') continue;
    // Avskriven rad: såld men aldrig utförd. Ska inte gå att rapportera framdrift på.
    if (item?.written_off === true) continue;
    const lineItemId = String(item?.id ?? '').trim();
    if (!lineItemId) continue;
    const label = String(item?.article_name || item?.line_note || '').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const planned = parseDecimal(item?.quantity);
    out.push({
      lineItemId,
      label,
      // Enheten skrivs ut RÅ. Måttblocket kräver ett enkelt token av sin enhet (EXTRAS_UNIT_RE)
      // eftersom den måste kunna känna igen sin egen utdata igen vid omgenerering; kortet har
      // ingen sådan rundtur, och "löpande meter" ur Fortnox enhetsregister ska synas som den är.
      unit: String(item?.article_unit_name ?? '').trim() || null,
      planned: Number.isFinite(planned) && planned > 0 ? planned : null,
    });
  }
  return out;
}

// ── Serverns snapshot-regel ──────────────────────────────────────────────────

/** Vad klienten skickar per moment i en submit. */
export type ProgressEntryInput = {
  line_item_id?: string | null;
  /** Bara för fritextmoment. Ignoreras när raden är kopplad — se resolveProgressEntry. */
  work_item?: string | null;
  quantity: number;
  /** Bara för fritextmoment. Ignoreras när raden är kopplad. */
  unit?: string | null;
  location?: string | null;
  note?: string | null;
};

/** Raden som faktiskt skrivs, efter att servern bestämt etikett och enhet. */
export type ResolvedProgressEntry = {
  line_item_id: string | null;
  work_item: string;
  quantity: number;
  unit: string | null;
  location: string | null;
  note: string | null;
};

export type ProgressEntryResolution =
  | { ok: true; entry: ResolvedProgressEntry }
  | { ok: false; reason: 'unknown_line_item' | 'missing_work_item' };

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').replace(/\s+/g, ' ').trim();
  return trimmed || null;
}

/**
 * En inkommen rapportrad → raden som skrivs.
 *
 * ⚠️ FÖR ETT KOPPLAT MOMENT KOMMER ETIKETT OCH ENHET UR ORDERRADEN, ALDRIG FRÅN KLIENTEN. Det är
 * inte hygien utan spärren bakom kontorets "45 av 120 m": tillåts klienten sätta enheten kan en
 * rapport säga "45 st" mot en rad som säljer 120 meter, och jämförelsen blir ett tal utan
 * betydelse. Samma sak med etiketten — en klient som skickade ett eget namn hade kunnat få en
 * orderrads historik att stå under fel rubrik.
 *
 * ⚠️ Ett okänt `line_item_id` AVVISAS i stället för att tolkas som ett fritextmoment. Raden kan ha
 * tagits bort ur ordern medan fältvyn stod öppen, och att då tyst spara den som "ej på ordern" hade
 * gjort en planerad rapport till en avvikelse. Anroparen ska ge besked och låta fältet hämta om.
 */
export function resolveProgressEntry(
  workItems: ProgressWorkItem[],
  entry: ProgressEntryInput,
): ProgressEntryResolution {
  const location = trimmedOrNull(entry.location);
  // Noteringen plattas INTE: den är skriven till nästa team och radbrytningar är dess egna.
  const note = String(entry.note ?? '').trim() || null;
  const lineItemId = String(entry.line_item_id ?? '').trim();

  if (lineItemId) {
    const known = workItems.find((item) => item.lineItemId === lineItemId);
    if (!known) return { ok: false, reason: 'unknown_line_item' };
    return {
      ok: true,
      entry: {
        line_item_id: known.lineItemId,
        work_item: known.label,
        quantity: entry.quantity,
        unit: known.unit,
        location,
        note,
      },
    };
  }

  const workItem = trimmedOrNull(entry.work_item);
  // Etiketten ÄR ett fritextmoments identitet — utan den är raden en siffra utan påstående, och
  // databasens CHECK avvisar den ändå (btrim(work_item) <> '').
  if (!workItem) return { ok: false, reason: 'missing_work_item' };
  return {
    ok: true,
    entry: { line_item_id: null, work_item: workItem, quantity: entry.quantity, unit: trimmedOrNull(entry.unit), location, note },
  };
}

// ── Grupperingen ─────────────────────────────────────────────────────────────

export const UNSPECIFIED_LOCATION_LABEL = 'Ingen plats angiven';

/** En rapportrad som klienten ser den. */
export type ProgressReportView = {
  id: string;
  report_day: string;
  line_item_id: string | null;
  work_item: string;
  quantity: number;
  unit: string | null;
  location: string | null;
  note: string | null;
  created_by_name: string;
  created_at: string;
  /** Avgörs av SERVERN, aldrig av klienten — samma skäl som SackReportView.can_delete. */
  can_delete: boolean;
};

export type ProgressLocationGroup = {
  label: string;
  total: number;
};

export type ProgressGroup<T> = {
  key: string;
  label: string;
  unit: string | null;
  /** Sålt antal ur orderraden. null för fritextmoment och för rader som lämnat ordern. */
  planned: number | null;
  reported: number;
  /**
   * Rapporterat men inte sålt — momentet saknar orderrad, eller raden finns inte längre.
   *
   * Det här ÄR avvikelsesignalen. Williams val 2026-09-16: den ska vara synlig på ordern, inte
   * skicka en notis och inte bära en egen livscykel.
   */
  notOnOrder: boolean;
  /** Rapporterat över det sålda antalet. Alltid false när `planned` är null. */
  overPlanned: boolean;
  /** Per plats, i bokstavsordning med de platslösa sist. */
  locations: ProgressLocationGroup[];
  items: T[];
};

/**
 * Platsens grupperingsnyckel. Radens egen text lämnas orörd.
 *
 * ⚠️ Normaliseringen sker HÄR och inte i databasen. "hus a", "Hus A" och " Hus  A " måste hamna i
 * samma hink när kontoret summerar per plats — men raden ska bära det installatören faktiskt skrev,
 * och en normaliserad lagring hade skrivit om hens text.
 */
export function normalizeLocationKey(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('sv');
}

/**
 * Rapportraderna grupperade per moment, och inuti varje moment per plats.
 *
 * ⚠️ NYCKLINGEN ÄR ASYMMETRISK MED FLIT:
 *
 *   * Ett KOPPLAT moment nycklas på `line_item_id`. Etikett och enhet läses ur ORDERNS rad, så
 *     kortet följer med när kontoret döper om artikeln — rapporterna står kvar under rätt rubrik.
 *   * Ett FRITEXTMOMENT nycklas på etikett OCH enhet. Skriver fältet "Landgång 45 m" en dag och
 *     "Landgång 3 st" en annan är summan 48 av ingenting; två grupper är det enda ärliga svaret.
 *   * En rad vars `line_item_id` inte längre finns på ordern behåller sin EGEN grupp (på id:t) i
 *     stället för att slås ihop med ett likanämnt fritextmoment. Det som en gång var sålt och det
 *     som aldrig var det ska inte läsas under en rubrik — då göms avvikelsen.
 *
 * Ordningen: orderns moment först, i radernas egen ordning på ordern (kortet läses som ordern),
 * därefter avvikelserna i bokstavsordning.
 */
export function groupProgressReports<T extends ProgressReportView>(
  rows: T[],
  workItems: ProgressWorkItem[],
): Array<ProgressGroup<T>> {
  const known = new Map(workItems.map((item) => [item.lineItemId, item]));
  const orderIndex = new Map(workItems.map((item, index) => [item.lineItemId, index]));

  const groups = new Map<string, ProgressGroup<T> & { sortIndex: number; locationKeys: Map<string, ProgressLocationGroup> }>();

  for (const row of rows) {
    const lineItemId = String(row.line_item_id ?? '').trim();
    const item = lineItemId ? known.get(lineItemId) : undefined;
    const label = item ? item.label : String(row.work_item ?? '').trim();
    const unit = item ? item.unit : (String(row.unit ?? '').trim() || null);
    const key = item
      ? `line:${lineItemId}`
      : lineItemId
        ? `gone:${lineItemId}`
        : `free:${normalizeLocationKey(label)}|${normalizeLocationKey(unit)}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label,
        unit,
        planned: item?.planned ?? null,
        reported: 0,
        notOnOrder: !item,
        overPlanned: false,
        locations: [],
        items: [],
        // Orderns moment sorteras på sin plats i ordern; allt annat läggs efter dem.
        sortIndex: item ? (orderIndex.get(lineItemId) ?? 0) : Number.MAX_SAFE_INTEGER,
        locationKeys: new Map(),
      };
      groups.set(key, group);
    }

    group.items.push(row);
    const quantity = Number(row.quantity);
    if (Number.isFinite(quantity)) group.reported += quantity;

    const locationKey = normalizeLocationKey(row.location);
    const existing = group.locationKeys.get(locationKey);
    if (existing) {
      if (Number.isFinite(quantity)) existing.total += quantity;
    } else {
      group.locationKeys.set(locationKey, {
        // Radens egen stavning vinner, och raderna kommer nyaste först — en rättad stavning är
        // alltså den som visas. Rent kosmetiskt: hinken är densamma oavsett.
        label: trimmedOrNull(row.location) ?? UNSPECIFIED_LOCATION_LABEL,
        total: Number.isFinite(quantity) ? quantity : 0,
      });
    }
  }

  const ordered = [...groups.values()].sort(
    (a, b) => a.sortIndex - b.sortIndex || a.label.localeCompare(b.label, 'sv'),
  );

  return ordered.map(({ sortIndex: _sortIndex, locationKeys, ...group }) => ({
    ...group,
    // Bokstavsordning, platslösa sist — samma konvention som säckarnas "Ospecificerad".
    locations: [...locationKeys.values()].sort((a, b) => {
      const aEmpty = a.label === UNSPECIFIED_LOCATION_LABEL;
      const bEmpty = b.label === UNSPECIFIED_LOCATION_LABEL;
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      return a.label.localeCompare(b.label, 'sv');
    }),
    overPlanned: group.planned != null && group.reported > group.planned,
  }));
}

/**
 * Platser som redan använts på ordern, nyaste först.
 *
 * Finns för chipsen i fältkortet: utan förslag skriver dag två "hus A" där dag ett skrev "Hus A",
 * och kontoret får två hinkar för ett hus. Normaliseringen fångar det ändå, men förslaget gör att
 * det inte uppstår.
 *
 * Anroparen kappar listan — hur många chips som ryms är en visningsfråga.
 */
export function progressLocationSuggestions(rows: Array<Pick<ProgressReportView, 'location'>>): string[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const label = trimmedOrNull(row.location);
    if (!label) continue;
    const key = normalizeLocationKey(label);
    if (!seen.has(key)) seen.set(key, label);
  }
  return [...seen.values()];
}

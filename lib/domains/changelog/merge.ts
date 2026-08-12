import {
  categoryFromTicketKind,
  categoryLabel,
  toChangelogCategory,
  type ChangelogEntryRow,
  type ChangelogItemView,
  type ChangelogTicketRow,
} from './types';

// Sammanslagningen av changeloggens två källor. Rent räknande, inget I/O — hela poängen är att
// reglerna nedan går att enhetstesta i stället för att bara existera inuti en route.

// En fritt skriven post blir en rad först när den är publicerad. Utkast filtreras bort här och inte
// i SQL, så adminvyn kan läsa samma funktion utan en andra fråga.
export function mapEntryToItem(row: ChangelogEntryRow): ChangelogItemView | null {
  if (!row.published_at) return null;
  const category = toChangelogCategory(row.category);
  return {
    id: row.id,
    source: 'entry',
    category,
    category_label: categoryLabel[category],
    title: row.title,
    body: row.body,
    published_at: row.published_at,
    reported_by: null,
  };
}

// Ett ärende blir en rad när BÅDE texten och publiceringstidpunkten finns. Kravet på texten är
// medvetet dubbelt: routen vägrar redan publicera utan den, men en rad utan titel skulle bli en tom
// punkt i listan — och en tom rad i en changelog är värre än ingen rad.
export function mapTicketToItem(row: ChangelogTicketRow): ChangelogItemView | null {
  if (!row.changelog_published_at) return null;
  const title = (row.changelog_note || '').trim();
  if (!title) return null;

  const category = categoryFromTicketKind(row.kind);
  return {
    id: row.id,
    source: 'ticket',
    category,
    category_label: categoryLabel[category],
    title,
    body: null,
    published_at: row.changelog_published_at,
    reported_by: row.reporter_name || null,
  };
}

// Nyast först. Tidsstämplarna kan kollidera (två poster publicerade i samma sparning), så id:t är
// andrasortering — utan den kan ordningen kastas om mellan två laddningar och listan "hoppa" utan
// att något ändrats.
export function mergeChangelog(
  entries: ChangelogEntryRow[] | null | undefined,
  tickets: ChangelogTicketRow[] | null | undefined,
): ChangelogItemView[] {
  const items = [
    ...(entries || []).map(mapEntryToItem),
    ...(tickets || []).map(mapTicketToItem),
  ].filter((item): item is ChangelogItemView => item !== null);

  return items.sort((a, b) => {
    if (a.published_at !== b.published_at) return a.published_at < b.published_at ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

// Grupperar på publiceringsdag. Nyckeln är ÅÅÅÅ-MM-DD; formateringen till svenska lämnas åt vyn.
export type ChangelogDayGroup = { day: string; items: ChangelogItemView[] };

// LOKALT datum, inte `published_at.slice(0, 10)`. Tidsstämpeln är UTC, så en post publicerad kvart
// över midnatt svensk tid ligger på föregående UTC-dygn — och hade visats under "gårdagen" för den
// som publicerade den några minuter tidigare. Samma resonemang som periodberäkningen i attestvyn:
// lokala getters, aldrig toISOString.
function localDayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function groupChangelogByDay(items: ChangelogItemView[]): ChangelogDayGroup[] {
  const groups: ChangelogDayGroup[] = [];
  for (const item of items) {
    const day = localDayKey(item.published_at);
    const last = groups[groups.length - 1];
    // Listan är redan sorterad, så en dag kan bara vara den senast påbörjade gruppen.
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

// Vad som tillkommit sedan användaren sist tittade. `lastSeen` är en ISO-tid ur localStorage; saknas
// den har användaren aldrig öppnat listan — och då är INGET nytt. Att visa hela historiken som
// "nytt" första gången vore en modal med trettio rader som ingen läser.
export function newSince(items: ChangelogItemView[], lastSeen: string | null): ChangelogItemView[] {
  if (!lastSeen) return [];
  return items.filter((item) => item.published_at > lastSeen);
}

// Tidsstämpeln att spara när listan visats: den nyaste posten, inte "nu". Klockan i webbläsaren kan
// gå fel, och `now` skulle då kunna hoppa över en post som publiceras strax efter.
export function latestPublishedAt(items: ChangelogItemView[]): string | null {
  return items.length > 0 ? items[0].published_at : null;
}

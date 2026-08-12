import { describe, it, expect } from 'vitest';
import {
  mapEntryToItem,
  mapTicketToItem,
  mergeChangelog,
  groupChangelogByDay,
  newSince,
  latestPublishedAt,
  publishedWithin,
  FIRST_VISIT_WINDOW_DAYS,
} from '@/lib/domains/changelog/merge';
import { buildEntryUpdatePatch, mapEntryToDraft } from '@/lib/domains/changelog/mutations';
import {
  createChangelogEntrySchema,
  updateChangelogEntrySchema,
  listChangelogQuerySchema,
} from '@/lib/domains/changelog/schemas';
import {
  CHANGELOG_CATEGORIES,
  categoryFromTicketKind,
  categoryLabel,
  type ChangelogEntryRow,
  type ChangelogTicketRow,
} from '@/lib/domains/changelog/types';
import { formatChangelogDay } from '@/app/_lib/changelogTokens';

const entry = (over: Partial<ChangelogEntryRow> = {}): ChangelogEntryRow => ({
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  category: 'improved',
  title: 'Snabbare kundsök',
  body: null,
  published_at: '2026-08-12T10:00:00.000Z',
  created_by: null,
  created_by_name: 'William',
  created_at: '2026-08-12T09:00:00.000Z',
  updated_at: '2026-08-12T09:00:00.000Z',
  ...over,
});

const ticket = (over: Partial<ChangelogTicketRow> = {}): ChangelogTicketRow => ({
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  kind: 'bug',
  changelog_note: 'Offerten sparar nu korrekt',
  changelog_published_at: '2026-08-12T12:00:00.000Z',
  reporter_name: 'Anna Installatör',
  ...over,
});

describe('mapEntryToItem', () => {
  it('mappar en publicerad post', () => {
    const item = mapEntryToItem(entry())!;
    expect(item.source).toBe('entry');
    expect(item.category).toBe('improved');
    expect(item.category_label).toBe(categoryLabel.improved);
    expect(item.reported_by).toBeNull();
  });

  // Utkast filtreras bort i mappningen, inte i SQL — så adminvyn kan läsa samma funktion.
  it('släpper igenom INGET utkast', () => {
    expect(mapEntryToItem(entry({ published_at: null }))).toBeNull();
  });

  it('faller tillbaka på en känd kategori för okänt värde', () => {
    expect(mapEntryToItem(entry({ category: 'breaking' }))!.category).toBe('improved');
  });
});

describe('mapTicketToItem', () => {
  // Kategorin härleds ur ärendets kind, så läsaren inte behöver veta att raden kom från ett ärende.
  it('en stängd bugg blir "Fixat", ett byggt önskemål blir "Nytt"', () => {
    expect(mapTicketToItem(ticket({ kind: 'bug' }))!.category).toBe('fixed');
    expect(mapTicketToItem(ticket({ kind: 'idea' }))!.category).toBe('new');
    expect(categoryFromTicketKind('bug')).toBe('fixed');
  });

  it('bär med rapportören — det är den som sluter loopen', () => {
    expect(mapTicketToItem(ticket())!.reported_by).toBe('Anna Installatör');
  });

  it('utesluter opublicerade ärenden', () => {
    expect(mapTicketToItem(ticket({ changelog_published_at: null }))).toBeNull();
  });

  // En rad utan titel blir en tom punkt i listan — värre än ingen rad alls.
  it('utesluter publicerade ärenden UTAN text', () => {
    expect(mapTicketToItem(ticket({ changelog_note: null }))).toBeNull();
    expect(mapTicketToItem(ticket({ changelog_note: '   ' }))).toBeNull();
  });

  it('trimmar texten', () => {
    expect(mapTicketToItem(ticket({ changelog_note: '  Fixat  ' }))!.title).toBe('Fixat');
  });
});

describe('mergeChangelog', () => {
  it('slår ihop båda källorna, nyast först', () => {
    const items = mergeChangelog(
      [entry({ published_at: '2026-08-10T10:00:00.000Z' }), entry({ id: 'aaaaaaaa-0000-4000-8000-000000000002', published_at: '2026-08-13T10:00:00.000Z' })],
      [ticket()],
    );
    expect(items.map((i) => i.published_at)).toEqual([
      '2026-08-13T10:00:00.000Z',
      '2026-08-12T12:00:00.000Z',
      '2026-08-10T10:00:00.000Z',
    ]);
    expect(items.map((i) => i.source)).toEqual(['entry', 'ticket', 'entry']);
  });

  it('hanterar null från båda källorna', () => {
    expect(mergeChangelog(null, null)).toEqual([]);
    expect(mergeChangelog(undefined, [ticket()])).toHaveLength(1);
  });

  it('filtrerar bort opublicerat ur båda källorna', () => {
    const items = mergeChangelog([entry({ published_at: null })], [ticket({ changelog_published_at: null })]);
    expect(items).toEqual([]);
  });

  // Utan andrasortering kan två poster med samma tidsstämpel byta plats mellan laddningar, och
  // listan "hoppar" utan att något ändrats.
  it('är deterministisk när tidsstämplarna kolliderar', () => {
    const a = entry({ id: 'aaaaaaaa-0000-4000-8000-000000000001', published_at: '2026-08-12T10:00:00.000Z' });
    const b = entry({ id: 'aaaaaaaa-0000-4000-8000-000000000002', published_at: '2026-08-12T10:00:00.000Z' });
    expect(mergeChangelog([a, b], []).map((i) => i.id)).toEqual(mergeChangelog([b, a], []).map((i) => i.id));
  });
});

describe('groupChangelogByDay', () => {
  // Tidsstämplarna ligger mitt på dagen med flit: då hamnar de på samma lokala datum oavsett vilken
  // tidszon testet körs i, och testet mäter grupperingen — inte maskinens inställningar.
  it('grupperar på publiceringsdag i ordning', () => {
    const items = mergeChangelog(
      [
        entry({ id: 'aaaaaaaa-0000-4000-8000-000000000001', published_at: '2026-08-12T14:00:00.000Z' }),
        entry({ id: 'aaaaaaaa-0000-4000-8000-000000000002', published_at: '2026-08-12T10:00:00.000Z' }),
        entry({ id: 'aaaaaaaa-0000-4000-8000-000000000003', published_at: '2026-08-09T10:00:00.000Z' }),
      ],
      [],
    );
    const groups = groupChangelogByDay(items);
    expect(groups.map((g) => g.day)).toEqual(['2026-08-12', '2026-08-09']);
    expect(groups[0].items).toHaveLength(2);
  });

  // Dygnsgränsen räknas LOKALT: en post publicerad kvart över midnatt svensk tid ligger på
  // föregående UTC-dygn, och skulle med en ren strängklippning hamna under "gårdagen".
  it('grupperar på lokal dag, inte på UTC-dygnet', () => {
    const midnightish = new Date(2026, 7, 12, 0, 15, 0); // 12 aug 00:15 lokal tid
    const items = mergeChangelog([entry({ published_at: midnightish.toISOString() })], []);
    expect(groupChangelogByDay(items)[0].day).toBe('2026-08-12');
  });

  it('ger en tom lista för inga poster', () => {
    expect(groupChangelogByDay([])).toEqual([]);
  });
});

describe('newSince', () => {
  const items = mergeChangelog(
    [
      entry({ id: 'aaaaaaaa-0000-4000-8000-000000000001', published_at: '2026-08-13T10:00:00.000Z' }),
      entry({ id: 'aaaaaaaa-0000-4000-8000-000000000002', published_at: '2026-08-11T10:00:00.000Z' }),
    ],
    [],
  );

  it('ger bara det som publicerats efter tidsstämpeln', () => {
    expect(newSince(items, '2026-08-12T00:00:00.000Z').map((i) => i.published_at)).toEqual(['2026-08-13T10:00:00.000Z']);
  });

  // Första besöket ska inte slå upp hela historiken som "nytt".
  it('ger INGET när användaren aldrig sett listan', () => {
    expect(newSince(items, null)).toEqual([]);
  });

  it('ger inget när allt redan setts', () => {
    expect(newSince(items, '2026-08-13T10:00:00.000Z')).toEqual([]);
  });

  it('latestPublishedAt tar nyaste posten, inte "nu"', () => {
    expect(latestPublishedAt(items)).toBe('2026-08-13T10:00:00.000Z');
    expect(latestPublishedAt([])).toBeNull();
  });
});

// Första besöket har inget "sedan sist" att jämföra mot — ingen har besökt listan innan den fanns.
// Regeln var först "stämpla tyst", vilket gjorde själva lanseringen osynlig: alla stämplades som
// om de sett listan, och ingen fick modalen förrän NÄSTA post publicerades.
describe('publishedWithin (första besöket)', () => {
  const now = new Date('2026-08-13T12:00:00.000Z');
  const items = mergeChangelog(
    [
      entry({ id: 'aaaaaaaa-0000-4000-8000-000000000001', published_at: '2026-08-12T10:00:00.000Z' }),
      entry({ id: 'aaaaaaaa-0000-4000-8000-000000000002', published_at: '2026-06-01T10:00:00.000Z' }),
    ],
    [],
  );

  it('tar med det som publicerats inom fönstret', () => {
    expect(publishedWithin(items, 14, now).map((i) => i.published_at)).toEqual(['2026-08-12T10:00:00.000Z']);
  });

  it('utesluter det som hunnit bli gammalt', () => {
    // En nyanställd om ett år ska inte mötas av hela historiken.
    expect(publishedWithin(items, 14, new Date('2027-08-13T12:00:00.000Z'))).toEqual([]);
  });

  // Lanseringsläget: allt skrevs samma dag, och alla ska se allt.
  it('tar med allt när posterna publicerats nyss', () => {
    const justPublished = mergeChangelog(
      [
        entry({ id: 'aaaaaaaa-0000-4000-8000-000000000003', published_at: '2026-08-13T09:00:00.000Z' }),
        entry({ id: 'aaaaaaaa-0000-4000-8000-000000000004', published_at: '2026-08-13T09:05:00.000Z' }),
      ],
      [],
    );
    expect(publishedWithin(justPublished, 14, now)).toHaveLength(2);
  });

  it('fönstret är 14 dagar', () => {
    expect(FIRST_VISIT_WINDOW_DAYS).toBe(14);
  });
});

describe('createChangelogEntrySchema', () => {
  it('kräver rubrik och giltig kategori', () => {
    expect(() => createChangelogEntrySchema.parse({ category: 'fixed', title: '  ' })).toThrow();
    expect(() => createChangelogEntrySchema.parse({ category: 'breaking', title: 'x' })).toThrow();
    for (const c of CHANGELOG_CATEGORIES) {
      expect(createChangelogEntrySchema.parse({ category: c, title: 'x' }).category).toBe(c);
    }
  });

  it('defaultar till utkast — publicering ska vara ett aktivt val', () => {
    expect(createChangelogEntrySchema.parse({ category: 'new', title: 'x' }).publish).toBe(false);
  });

  it('normaliserar blank body till null', () => {
    expect(createChangelogEntrySchema.parse({ category: 'new', title: 'x', body: '   ' }).body).toBeNull();
  });
});

describe('updateChangelogEntrySchema + listChangelogQuerySchema', () => {
  it('tillåter en tom uppdatering (routen avgör att inget skickades)', () => {
    expect(updateChangelogEntrySchema.parse({})).toEqual({});
  });

  it('defaultar listan till publicerat', () => {
    const parsed = listChangelogQuerySchema.parse({});
    expect(parsed.scope).toBe('published');
    expect(parsed.limit).toBe(100);
  });

  it('avvisar orimliga limits', () => {
    expect(() => listChangelogQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => listChangelogQuerySchema.parse({ limit: 5000 })).toThrow();
  });
});

describe('buildEntryUpdatePatch', () => {
  const now = '2026-08-13T10:00:00.000Z';

  it('skriver bara de fält klienten skickade', () => {
    const patch = buildEntryUpdatePatch({ title: 'Ny rubrik', body: 'text' }, ['title'], now, { published_at: null });
    expect(patch).toEqual({ updated_at: now, title: 'Ny rubrik' });
  });

  it('publicerar ett utkast med nuvarande tid', () => {
    const patch = buildEntryUpdatePatch({ publish: true }, ['publish'], now, { published_at: null });
    expect(patch.published_at).toBe(now);
  });

  // Annars flyttas en gammal post till toppen så fort man rättar ett stavfel, och läsaren ser en
  // två veckor gammal ändring presenterad som ny.
  it('BEHÅLLER tidsstämpeln på en redan publicerad post', () => {
    const patch = buildEntryUpdatePatch({ publish: true }, ['publish'], now, {
      published_at: '2026-08-01T08:00:00.000Z',
    });
    expect(patch.published_at).toBe('2026-08-01T08:00:00.000Z');
  });

  it('avpublicerar genom att nolla tidsstämpeln', () => {
    const patch = buildEntryUpdatePatch({ publish: false }, ['publish'], now, {
      published_at: '2026-08-01T08:00:00.000Z',
    });
    expect(patch.published_at).toBeNull();
  });

  it('ger bara updated_at när inget skickades', () => {
    expect(buildEntryUpdatePatch({}, [], now, { published_at: null })).toEqual({ updated_at: now });
  });
});

describe('mapEntryToDraft', () => {
  it('behåller publiceringsstatus så adminvyn kan skilja utkast från publicerat', () => {
    expect(mapEntryToDraft(entry()).published_at).toBe('2026-08-12T10:00:00.000Z');
    expect(mapEntryToDraft(entry({ published_at: null })).published_at).toBeNull();
  });
});

describe('formatChangelogDay', () => {
  it('utelämnar året för innevarande år', () => {
    expect(formatChangelogDay('2026-08-12', new Date('2026-11-01T00:00:00.000Z'))).toBe('12 augusti');
  });

  it('tar med året för ett annat år', () => {
    expect(formatChangelogDay('2025-08-12', new Date('2026-11-01T00:00:00.000Z'))).toContain('2025');
  });

  it('faller tillbaka på indata vid ogiltigt datum', () => {
    expect(formatChangelogDay('inte-ett-datum')).toBe('inte-ett-datum');
  });
});

import { describe, it, expect } from 'vitest';
import {
  groupProgressReports,
  normalizeLocationKey,
  progressLocationSuggestions,
  progressWorkItemsFromLineItems,
  resolveProgressEntry,
  UNSPECIFIED_LOCATION_LABEL,
  type ProgressReportView,
  type ProgressWorkItem,
} from '@/lib/domains/crm/workOrderProgress';

// Framdriftsrapporteringen — momentlistan, serverns snapshot-regel och grupperingen.
//
// Flera av testerna nedan låser fällor som kostade en felaktig avvikelse eller ett meningslöst tal
// om de brast. De är märkta med varför, så att ett fallerande test går att läsa som ett besked och
// inte som en gissning.

const ROW = (over: Partial<ProgressReportView> = {}): ProgressReportView => ({
  id: over.id ?? crypto.randomUUID(),
  report_day: '2026-09-16',
  line_item_id: null,
  work_item: 'Landgång',
  quantity: 10,
  unit: 'm',
  location: null,
  note: null,
  created_by_name: 'Erik',
  created_at: '2026-09-16T15:00:00Z',
  can_delete: false,
  ...over,
});

describe('progressWorkItemsFromLineItems', () => {
  it('tar antals- och meterrader men inte ytor', () => {
    const items = progressWorkItemsFromLineItems([
      { id: 'a', article_name: 'Landgång', pricing_mode: 'item', quantity: '120', article_unit_name: 'm' },
      { id: 'b', article_name: 'Ekovilla lösull', pricing_mode: 'm3', quantity: '', m2: '100' } as any,
      // Utan pricing_mode gäller husets default 'm3' — alltså en yta, alltså säckrapportens område.
      { id: 'c', article_name: 'Namnlös yta', quantity: '5' },
    ]);
    expect(items.map((i) => i.lineItemId)).toEqual(['a']);
    expect(items[0]).toMatchObject({ label: 'Landgång', unit: 'm', planned: 120 });
  });

  it('utesluter avskrivna rader', () => {
    const items = progressWorkItemsFromLineItems([
      { id: 'a', article_name: 'Landgång', pricing_mode: 'item', quantity: '120', written_off: true },
    ]);
    expect(items).toEqual([]);
  });

  // 🧨 FÄLLAN: måttblockets isExtraRow kräver include_in_description === true, och den flaggan
  // defaultar till false. Som filter här hade landgången försvunnit ur fältets lista så fort
  // säljaren inte kryssat i den — installatören hade skrivit fritext, och momentet flaggats som
  // "ej på ordern". En avvikelse som inte finns är värre än ingen avvikelse.
  it('tar med rader som INTE står i arbetsbeskrivningen', () => {
    const items = progressWorkItemsFromLineItems([
      { id: 'a', article_name: 'Landgång', pricing_mode: 'item', quantity: '120', include_in_description: false } as any,
    ]);
    expect(items.map((i) => i.label)).toEqual(['Landgång']);
  });

  // 🧨 SAMMA FELKLASS: buildExtraRow hoppar över rader med mängd 0 ("en 0 st-rad är inget
  // arbetsmoment" i en beskrivning). Här hade det gjort ett sålt moment orapporterbart.
  it('tar med en rad utan antal, men utan plan', () => {
    const items = progressWorkItemsFromLineItems([
      { id: 'a', article_name: 'Landgång', pricing_mode: 'item', quantity: '' },
      { id: 'b', article_name: 'Sarg', pricing_mode: 'item', quantity: '0' },
    ]);
    expect(items.map((i) => [i.label, i.planned])).toEqual([['Landgång', null], ['Sarg', null]]);
  });

  it('faller tillbaka på line_note och plattar blanksteg', () => {
    const items = progressWorkItemsFromLineItems([
      { id: 'a', article_name: null, line_note: '  Landgång   vid\ngavel ', pricing_mode: 'item', quantity: '30' },
    ]);
    expect(items[0].label).toBe('Landgång vid gavel');
  });

  it('behåller enheten rå, även när den inte är ett enkelt token', () => {
    // article_unit_name kommer ur Fortnox enhetsregister och kan vara vad som helst. Måttblocket
    // kräver ett enkelt token av sin enhet för att känna igen sin egen utdata; kortet har ingen
    // sådan rundtur och ska visa enheten som den är.
    const items = progressWorkItemsFromLineItems([
      { id: 'a', article_name: 'Landgång', pricing_mode: 'item', quantity: '120', article_unit_name: 'löpande meter' },
    ]);
    expect(items[0].unit).toBe('löpande meter');
  });

  it('hoppar över rader utan id eller utan namn', () => {
    const items = progressWorkItemsFromLineItems([
      { id: '', article_name: 'Landgång', pricing_mode: 'item', quantity: '1' },
      { id: 'b', article_name: '   ', line_note: '', pricing_mode: 'item', quantity: '1' },
    ]);
    expect(items).toEqual([]);
  });
});

describe('resolveProgressEntry', () => {
  const workItems: ProgressWorkItem[] = [
    { lineItemId: 'a', label: 'Landgång', unit: 'm', planned: 120 },
  ];

  // 🧨 SPÄRREN BAKOM "45 av 120 m". Tillåts klienten sätta enhet eller etikett kan en rapport säga
  // "45 st" mot en rad som säljer 120 meter, och kontorets jämförelse blir ett tal utan betydelse.
  it('tar etikett och enhet ur ORDERRADEN och ignorerar klientens', () => {
    const res = resolveProgressEntry(workItems, {
      line_item_id: 'a',
      work_item: 'Något helt annat',
      unit: 'st',
      quantity: 45,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entry).toMatchObject({ line_item_id: 'a', work_item: 'Landgång', unit: 'm', quantity: 45 });
  });

  // 🧨 Raden kan ha tagits bort ur ordern medan fältvyn stod öppen. Att tyst spara den som
  // fritextmoment hade gjort en PLANERAD rapport till en avvikelse.
  it('avvisar ett okänt line_item_id i stället för att tolka det som fritext', () => {
    // ⚠️ Etiketten och enheten MÅSTE skickas med här. Klienten skickar dem alltid, och utan dem i
    // provet hade en implementation som tyst faller tillbaka på fritext gett samma utfall som en
    // som avvisar — testet hade varit grönt och tomt. Mutationsprövningen fångade just det.
    const res = resolveProgressEntry(workItems, {
      line_item_id: 'borta',
      work_item: 'Landgång',
      unit: 'm',
      quantity: 45,
    });
    expect(res).toEqual({ ok: false, reason: 'unknown_line_item' });
  });

  it('accepterar ett fritextmoment och trimmar etiketten', () => {
    const res = resolveProgressEntry(workItems, { work_item: '  Extra   sarg ', unit: ' st ', quantity: 6 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entry).toMatchObject({ line_item_id: null, work_item: 'Extra sarg', unit: 'st' });
  });

  it('avvisar ett fritextmoment utan etikett', () => {
    expect(resolveProgressEntry(workItems, { work_item: '   ', quantity: 6 })).toEqual({
      ok: false,
      reason: 'missing_work_item',
    });
    expect(resolveProgressEntry(workItems, { quantity: 6 })).toEqual({
      ok: false,
      reason: 'missing_work_item',
    });
  });

  it('plattar platsen men behåller noteringens radbrytningar', () => {
    const res = resolveProgressEntry(workItems, {
      line_item_id: 'a',
      quantity: 1,
      location: '  Hus  A ',
      note: ' Dålig åtkomst\nnorra gaveln ',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entry.location).toBe('Hus A');
    expect(res.entry.note).toBe('Dålig åtkomst\nnorra gaveln');
  });

  it('gör tom plats och tom notering till null', () => {
    const res = resolveProgressEntry(workItems, { line_item_id: 'a', quantity: 1, location: '  ', note: '' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entry.location).toBeNull();
    expect(res.entry.note).toBeNull();
  });
});

describe('groupProgressReports', () => {
  const workItems: ProgressWorkItem[] = [
    { lineItemId: 'a', label: 'Landgång', unit: 'm', planned: 120 },
    { lineItemId: 'b', label: 'Brandmatta', unit: 'st', planned: 4 },
  ];

  it('summerar per moment och bär planen ur ordern', () => {
    const groups = groupProgressReports(
      [
        ROW({ line_item_id: 'a', quantity: 20 }),
        ROW({ line_item_id: 'a', quantity: 25 }),
      ],
      workItems,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ label: 'Landgång', unit: 'm', planned: 120, reported: 45, overPlanned: false, notOnOrder: false });
  });

  it('flaggar överdrag mot planen', () => {
    const groups = groupProgressReports([ROW({ line_item_id: 'b', quantity: 5 })], workItems);
    expect(groups[0]).toMatchObject({ planned: 4, reported: 5, overPlanned: true });
  });

  it('flaggar ett fritextmoment som ej på ordern, utan plan', () => {
    const groups = groupProgressReports([ROW({ work_item: 'Extra sarg', unit: 'st', quantity: 6 })], workItems);
    expect(groups[0]).toMatchObject({ label: 'Extra sarg', notOnOrder: true, planned: null, overPlanned: false });
  });

  // 🧨 Det som en gång var sålt och det som aldrig var det får inte läsas under en rubrik — då göms
  // avvikelsen. En rad vars orderrad tagits bort behåller alltså sin egen grupp.
  it('slår inte ihop en borttagen orderrad med ett likanämnt fritextmoment', () => {
    const groups = groupProgressReports(
      [
        ROW({ line_item_id: 'borta', work_item: 'Landgång', unit: 'm', quantity: 30 }),
        ROW({ work_item: 'Landgång', unit: 'm', quantity: 6 }),
      ],
      workItems,
    );
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.notOnOrder)).toBe(true);
    expect(groups.map((g) => g.reported).sort((x, y) => x - y)).toEqual([6, 30]);
  });

  // 🧨 45 m + 3 st är inget tal. Två grupper är det enda ärliga svaret.
  it('delar ett fritextmoment med olika enheter i två grupper', () => {
    const groups = groupProgressReports(
      [
        ROW({ work_item: 'Landgång', unit: 'm', quantity: 45 }),
        ROW({ work_item: 'Landgång', unit: 'st', quantity: 3 }),
      ],
      workItems,
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => [g.unit, g.reported]).sort()).toEqual([['m', 45], ['st', 3]]);
  });

  // Kopplade moment nycklas på id:t, så en omdöpt artikel inte splittar historiken.
  it('använder orderns nuvarande etikett för ett kopplat moment', () => {
    const groups = groupProgressReports(
      [ROW({ line_item_id: 'a', work_item: 'Gammalt artikelnamn', quantity: 10 })],
      workItems,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Landgång');
  });

  it('summerar per plats och lägger de platslösa sist', () => {
    const groups = groupProgressReports(
      [
        ROW({ line_item_id: 'a', quantity: 5, location: null }),
        ROW({ line_item_id: 'a', quantity: 20, location: 'Hus B' }),
        ROW({ line_item_id: 'a', quantity: 25, location: 'Hus A' }),
        // Samma hus, annan stavning — måste hamna i samma hink.
        ROW({ line_item_id: 'a', quantity: 10, location: ' hus  a ' }),
      ],
      workItems,
    );
    expect(groups[0].locations).toEqual([
      { label: 'Hus A', total: 35 },
      { label: 'Hus B', total: 20 },
      { label: UNSPECIFIED_LOCATION_LABEL, total: 5 },
    ]);
  });

  it('ordnar orderns moment som på ordern, avvikelserna sist', () => {
    const groups = groupProgressReports(
      [
        ROW({ work_item: 'Extra sarg', unit: 'st', quantity: 6 }),
        ROW({ line_item_id: 'b', quantity: 2 }),
        ROW({ line_item_id: 'a', quantity: 10 }),
      ],
      workItems,
    );
    expect(groups.map((g) => g.label)).toEqual(['Landgång', 'Brandmatta', 'Extra sarg']);
  });

  it('hoppar över en mängd som inte är ett tal utan att tappa raden', () => {
    const groups = groupProgressReports(
      [ROW({ line_item_id: 'a', quantity: Number.NaN }), ROW({ line_item_id: 'a', quantity: 10 })],
      workItems,
    );
    expect(groups[0].reported).toBe(10);
    expect(groups[0].items).toHaveLength(2);
  });
});

describe('platsnormalisering och förslag', () => {
  it('normaliserar skiftläge och blanksteg', () => {
    expect(normalizeLocationKey(' Hus  A ')).toBe('hus a');
    expect(normalizeLocationKey(null)).toBe('');
  });

  it('ger distinkta platser i radernas ordning, nyaste stavning först', () => {
    expect(
      progressLocationSuggestions([
        { location: 'Hus B' },
        { location: 'hus b' },
        { location: null },
        { location: ' Hus A ' },
      ]),
    ).toEqual(['Hus B', 'Hus A']);
  });
});

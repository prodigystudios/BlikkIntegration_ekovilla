import { describe, it, expect } from 'vitest';
import {
  groupProgressReports,
  normalizeLocationKey,
  progressLocationSuggestions,
  progressMeterRows,
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

  // 🧨 GRANSKNINGSFYND 2026-09-16. Avskrivna rader FILTRERADES först bort helt — och då tappade
  // grupperingen sitt uppslag: framdrift som rapporterats innan raden skrevs av blev en
  // "gone:"-grupp med badgen "Ej på ordern" plus kontorets varningsrad, och "45 av 120 m"
  // försvann. Raden ÄR på ordern. De kommer med, märkta; anroparen filtrerar för chipsen.
  it('tar med avskrivna rader men märker dem', () => {
    const items = progressWorkItemsFromLineItems([
      { id: 'a', article_name: 'Landgång', pricing_mode: 'item', quantity: '120', written_off: true },
      { id: 'b', article_name: 'Sarg', pricing_mode: 'item', quantity: '4' },
    ]);
    expect(items.map((i) => [i.lineItemId, i.writtenOff])).toEqual([['a', true], ['b', false]]);
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
    { lineItemId: 'a', label: 'Landgång', unit: 'm', planned: 120, writtenOff: false },
    { lineItemId: 'av', label: 'Avskriven landgång', unit: 'm', planned: 30, writtenOff: true },
  ];

  // Ny framdrift på en avskriven rad är en motsägelse, och skälet måste vara ett EGET: rådet som
  // hör till ett okänt id ("ladda om sidan") hjälper inte, för raden finns kvar.
  it('avvisar en avskriven rad med eget skäl', () => {
    expect(resolveProgressEntry(workItems, { line_item_id: 'av', quantity: 5 })).toEqual({
      ok: false,
      reason: 'written_off_line_item',
    });
  });

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
    { lineItemId: 'a', label: 'Landgång', unit: 'm', planned: 120, writtenOff: false },
    { lineItemId: 'b', label: 'Brandmatta', unit: 'st', planned: 4, writtenOff: false },
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

  // 🧨 GRANSKNINGSFYND 2026-09-16. En avskriven rad ska INTE läsas som "ej på ordern": den ligger
  // kvar på ordern med ett sålt antal, och kontorets amber-varning är till för arbete som aldrig
  // såldes. Blir de samma sak larmar kortet om en avvikelse som inte finns, och "45 av 120 m"
  // försvinner.
  it('skiljer en avskriven rad från ett moment utanför ordern', () => {
    const withWrittenOff: ProgressWorkItem[] = [
      ...workItems,
      { lineItemId: 'av', label: 'Avskriven landgång', unit: 'm', planned: 30, writtenOff: true },
    ];
    const groups = groupProgressReports([ROW({ line_item_id: 'av', quantity: 12 })], withWrittenOff);
    expect(groups[0]).toMatchObject({
      label: 'Avskriven landgång',
      planned: 30,
      reported: 12,
      notOnOrder: false,
      writtenOff: true,
    });
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

describe('progressMeterRows', () => {
  const workItems: ProgressWorkItem[] = [
    { lineItemId: 'a', label: 'Landgång', unit: 'm', planned: 120, writtenOff: false },
    { lineItemId: 'b', label: 'Brandmatta', unit: 'st', planned: 4, writtenOff: false },
    { lineItemId: 'c', label: 'Sarg', unit: 'm', planned: null, writtenOff: false },
  ];

  it('visar varje sålt moment i orderns ordning, även det som inget rapporterats på', () => {
    const groups = groupProgressReports([ROW({ line_item_id: 'b', quantity: 1 })], workItems);
    const rows = progressMeterRows(groups, workItems);
    expect(rows.map((r) => [r.label, r.reported, r.planned])).toEqual([
      ['Landgång', 0, 120],
      ['Brandmatta', 1, 4],
      ['Sarg', 0, null],
    ]);
    expect(rows[0].group).toBeNull();
    expect(rows[1].group?.items).toHaveLength(1);
  });

  it('räknar andelen mot det sålda, kapad vid 100, och ingen andel utan sålt antal', () => {
    const groups = groupProgressReports(
      [ROW({ line_item_id: 'a', quantity: 30 }), ROW({ line_item_id: 'b', quantity: 6 }), ROW({ line_item_id: 'c', quantity: 5 })],
      workItems,
    );
    const rows = progressMeterRows(groups, workItems);
    expect(rows.map((r) => r.percent)).toEqual([25, 100, null]);
  });

  // En avskriven rad ska aldrig byggas. En tom mätare för den hade sett ut som jobb kvar.
  it('visar inte en avskriven rad utan rapporter, men behåller den när det finns rapporter', () => {
    const withWrittenOff: ProgressWorkItem[] = [
      ...workItems,
      { lineItemId: 'av', label: 'Avskriven landgång', unit: 'm', planned: 30, writtenOff: true },
    ];
    expect(progressMeterRows([], withWrittenOff).map((r) => r.label)).not.toContain('Avskriven landgång');

    const groups = groupProgressReports([ROW({ line_item_id: 'av', quantity: 10 })], withWrittenOff);
    const row = progressMeterRows(groups, withWrittenOff).find((r) => r.label === 'Avskriven landgång');
    expect(row).toMatchObject({ reported: 10, planned: 30 });
    expect(row?.group?.writtenOff).toBe(true);
  });

  it('lägger avvikelserna efter orderns moment', () => {
    const groups = groupProgressReports(
      [ROW({ line_item_id: null, work_item: 'Extra sarg', quantity: 2, unit: 'm' }), ROW({ line_item_id: 'a', quantity: 5 })],
      workItems,
    );
    const rows = progressMeterRows(groups, workItems);
    expect(rows.map((r) => r.label)).toEqual(['Landgång', 'Brandmatta', 'Sarg', 'Extra sarg']);
    expect(rows[3]).toMatchObject({ planned: null, percent: null });
    expect(rows[3].group?.notOnOrder).toBe(true);
  });

  it('ger en tom lista när ordern varken har moment eller rapporter', () => {
    expect(progressMeterRows([], [])).toEqual([]);
  });
});

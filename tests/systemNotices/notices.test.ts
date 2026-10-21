import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  buildSystemNoticeUpdate,
  formatSystemNoticeEnd,
  isSystemNoticeActive,
  sortSystemNoticesForDisplay,
  systemNoticeDismissKey,
  systemNoticeEndProblem,
  toSystemNoticeView,
} from '@/lib/domains/systemNotices/notices';
import { createSystemNoticeSchema, updateSystemNoticeSchema } from '@/lib/domains/systemNotices/schemas';
import { SYSTEM_NOTICE_AREAS, SYSTEM_NOTICE_KINDS, type SystemNoticeRow, type SystemNoticeView } from '@/lib/domains/systemNotices/types';

function row(overrides: Partial<SystemNoticeRow> = {}): SystemNoticeRow {
  return {
    id: 'n1',
    kind: 'update',
    message: 'Vi uppdaterar offertflödet.',
    affected_areas: ['quotes'],
    starts_at: '2026-10-21T10:00:00.000Z',
    ends_at: null,
    created_by_name: 'William',
    created_at: '2026-10-21T10:00:00.000Z',
    updated_at: '2026-10-21T10:00:00.000Z',
    ...overrides,
  };
}

describe('toSystemNoticeView', () => {
  it('sätter etiketten ur sorten', () => {
    expect(toSystemNoticeView(row({ kind: 'disruption' }))).toMatchObject({ kind: 'disruption', kind_label: 'Driftstörning' });
  });

  // En rad ur en framtida version ska inte krascha bannern för alla inloggade.
  it('läser en okänd sort som information och tappar okända områden', () => {
    const view = toSystemNoticeView(row({ kind: 'nytt', affected_areas: ['quotes', 'okänt', 'crm'] }));
    expect(view.kind).toBe('info');
    expect(view.areas).toEqual(['quotes', 'crm']);
  });

  it('tål att områdena saknas', () => {
    expect(toSystemNoticeView(row({ affected_areas: null })).areas).toEqual([]);
  });
});

describe('isSystemNoticeActive', () => {
  const at = (iso: string) => new Date(iso);
  const notice = (starts_at: string, ends_at: string | null) => ({ starts_at, ends_at });

  it('är aktivt tills det slås av', () => {
    expect(isSystemNoticeActive(notice('2026-10-21T10:00:00Z', null), at('2027-01-01T00:00:00Z'))).toBe(true);
  });

  // 🧨 starts_at sätts av databasens klocka. Ligger webbläsarens (eller appserverns) klocka efter, hade en jämförelse
  // gömt ett nyss påslaget meddelande — det hände i provet mot den lokala databasen, 0,3 s isär.
  it('syns direkt även när läsarens klocka ligger efter databasens', () => {
    expect(isSystemNoticeActive(notice('2026-10-21T10:00:00.300Z', null), at('2026-10-21T10:00:00Z'))).toBe(true);
  });

  // Samma gräns som RLS-policyn (`ends_at > now()`): i sluttidens ögonblick är det slut.
  it('döljs när sluttiden nås, inte först efter den', () => {
    const n = notice('2026-10-21T10:00:00Z', '2026-10-21T16:00:00Z');
    expect(isSystemNoticeActive(n, at('2026-10-21T15:59:59Z'))).toBe(true);
    expect(isSystemNoticeActive(n, at('2026-10-21T16:00:00Z'))).toBe(false);
  });
});

describe('sortSystemNoticesForDisplay', () => {
  it('lägger störningen överst och annars det senast påslagna först', () => {
    const views = [
      toSystemNoticeView(row({ id: 'info', kind: 'info', starts_at: '2026-10-21T12:00:00Z' })),
      toSystemNoticeView(row({ id: 'gammal', kind: 'update', starts_at: '2026-10-21T08:00:00Z' })),
      toSystemNoticeView(row({ id: 'störning', kind: 'disruption', starts_at: '2026-10-21T07:00:00Z' })),
      toSystemNoticeView(row({ id: 'ny', kind: 'update', starts_at: '2026-10-21T11:00:00Z' })),
    ];
    expect(sortSystemNoticesForDisplay(views).map((v) => v.id)).toEqual(['störning', 'ny', 'gammal', 'info']);
  });
});

describe('systemNoticeDismissKey', () => {
  const base = toSystemNoticeView(row());
  const key = systemNoticeDismissKey(base);

  // "Stängbar tills det ändras": nytt innehåll ger en ny nyckel, och då syns meddelandet igen.
  it('byts när sort, text eller områden ändras', () => {
    expect(systemNoticeDismissKey({ ...base, message: 'Uppdateringen tar längre tid.' })).not.toBe(key);
    expect(systemNoticeDismissKey({ ...base, kind: 'disruption' })).not.toBe(key);
    expect(systemNoticeDismissKey({ ...base, areas: ['quotes', 'crm'] })).not.toBe(key);
  });

  // En sparning utan ändrat innehåll — en flyttad sluttid, eller "Spara" utan att röra något — ska inte ta tillbaka
  // bannern för alla som stängt den.
  it('står still när bara sluttiden eller tidsstämpeln ändras', () => {
    const moved: SystemNoticeView = { ...base, ends_at: '2026-10-21T18:00:00.000Z', updated_at: '2026-10-21T11:00:00.000Z' };
    expect(systemNoticeDismissKey(moved)).toBe(key);
  });

  it('skiljer två meddelanden med samma innehåll åt', () => {
    expect(systemNoticeDismissKey({ ...base, id: 'n2' })).not.toBe(key);
  });
});

// ⚠️ Explicita UTC-ögonblick, svensk tid i svaret. Fallet som skiljer zonerna åt är det sista: samma UTC-dag, olika
// svensk dag. Mutationsprövat under TZ=UTC (utan explicit zon blir sluttiden "22:30" utan datum).
describe('formatSystemNoticeEnd', () => {
  it('skriver bara klockslaget samma svenska dag', () => {
    expect(formatSystemNoticeEnd('2026-10-21T16:00:00Z', new Date('2026-10-21T08:00:00Z'))).toBe('18:00');
  });

  it('skriver datum och klockslag en annan dag', () => {
    expect(formatSystemNoticeEnd('2026-10-23T16:00:00Z', new Date('2026-10-21T08:00:00Z'))).toBe('23 okt. 18:00');
  });

  it('räknar dagen i svensk tid, inte i UTC', () => {
    // 21:30 UTC = 23:30 den 21:a i Sverige; 22:30 UTC = 00:30 den 22:a.
    expect(formatSystemNoticeEnd('2026-10-21T22:30:00Z', new Date('2026-10-21T21:30:00Z'))).toBe('22 okt. 00:30');
  });
});

describe('systemNoticeEndProblem', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  it('godtar ingen sluttid och en sluttid framåt', () => {
    expect(systemNoticeEndProblem(null, now)).toBeNull();
    expect(systemNoticeEndProblem('2026-10-21T10:01:00Z', now)).toBeNull();
  });

  // En passerad sluttid hade gjort meddelandet osynligt i samma ögonblick som det sparades.
  it('säger ifrån om en sluttid som redan passerat', () => {
    expect(systemNoticeEndProblem('2026-10-21T10:00:00Z', now)).toMatch(/passerat/);
    expect(systemNoticeEndProblem('2026-10-20T10:00:00Z', now)).toMatch(/passerat/);
  });
});

describe('buildSystemNoticeUpdate', () => {
  const now = '2026-10-21T12:00:00.000Z';

  it('skriver bara det som skickades, och alltid updated_at', () => {
    expect(buildSystemNoticeUpdate({ message: 'Ny text' }, now)).toEqual({ message: 'Ny text', updated_at: now });
  });

  it('slår av meddelandet genom att sätta sluttiden till nu', () => {
    expect(buildSystemNoticeUpdate({ end: true }, now)).toEqual({ ends_at: now, updated_at: now });
  });

  it('tar bort sluttiden när null skickas', () => {
    expect(buildSystemNoticeUpdate({ ends_at: null }, now)).toEqual({ ends_at: null, updated_at: now });
  });
});

describe('createSystemNoticeSchema', () => {
  it('trimmar texten och fyller i standardvärden', () => {
    const parsed = createSystemNoticeSchema.parse({ kind: 'info', message: '  Hej  ' });
    expect(parsed).toEqual({ kind: 'info', message: 'Hej', affected_areas: [], ends_at: null });
  });

  it('avvisar tom text, okänd sort och okänt område', () => {
    expect(createSystemNoticeSchema.safeParse({ kind: 'info', message: '   ' }).success).toBe(false);
    expect(createSystemNoticeSchema.safeParse({ kind: 'nytt', message: 'x' }).success).toBe(false);
    expect(createSystemNoticeSchema.safeParse({ kind: 'info', message: 'x', affected_areas: ['okänt'] }).success).toBe(false);
  });

  it('tar bort dubbletter och ordnar områdena som listan', () => {
    const parsed = createSystemNoticeSchema.parse({ kind: 'info', message: 'x', affected_areas: ['time', 'crm', 'time'] });
    expect(parsed.affected_areas).toEqual(['crm', 'time']);
  });

  it('kräver en sluttid i ISO 8601', () => {
    expect(createSystemNoticeSchema.safeParse({ kind: 'info', message: 'x', ends_at: '18:00' }).success).toBe(false);
    expect(createSystemNoticeSchema.safeParse({ kind: 'info', message: 'x', ends_at: '2026-10-21T16:00:00.000Z' }).success).toBe(true);
  });
});

describe('updateSystemNoticeSchema', () => {
  it('godtar bara end: true', () => {
    expect(updateSystemNoticeSchema.safeParse({ end: true }).success).toBe(true);
    expect(updateSystemNoticeSchema.safeParse({ end: false }).success).toBe(false);
  });
});

// 🧨 En nyckel som bara finns i types.ts avvisas av databasens CHECK när admin sparar — och tvärtom kan databasen
// släppa in något bannern inte har etikett för. Listorna ska vara samma.
describe('nycklarna mot migreringens CHECK-villkor', () => {
  const file = readdirSync('supabase/migrations').find((f) => f.endsWith('_app_system_notices.sql'));
  const sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
  const quoted = (fragment: string) => [...fragment.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  it('har samma områden', () => {
    const check = sql.match(/affected_areas <@ array\[([^\]]+)\]/);
    expect(check).not.toBeNull();
    expect(quoted(check![1])).toEqual([...SYSTEM_NOTICE_AREAS]);
  });

  it('har samma sorter', () => {
    const check = sql.match(/check \(kind in \(([^)]+)\)\)/);
    expect(check).not.toBeNull();
    expect(quoted(check![1])).toEqual([...SYSTEM_NOTICE_KINDS]);
  });
});

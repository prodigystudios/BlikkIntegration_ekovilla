import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTicketSchema,
  updateTicketSchema,
  listTicketsQuerySchema,
  validateScreenshot,
  SCREENSHOT_MAX_BYTES,
} from '@/lib/domains/support/schemas';
import { mapTicketRow, mapTicketRows } from '@/lib/domains/support/mappers';
import { buildTicketUpdatePatch, checkChangelogPublishable } from '@/lib/domains/support/mutations';
import { guessAreaFromPath } from '@/lib/domains/support/areas';
import { buildScreenshotPath, sanitizeScreenshotName } from '@/lib/domains/support/storage';
import { excludeReporter } from '@/lib/domains/support/recipients';
import {
  TICKET_AREAS,
  TICKET_KINDS,
  TICKET_STATUSES,
  areaLabel,
  isClosedTicketStatus,
  kindLabel,
  statusLabel,
  type AppTicketRow,
} from '@/lib/domains/support/types';
import { buildAppTicketCreatedNotification } from '@/lib/domains/notifications/payload';

const baseRow: AppTicketRow = {
  id: '11111111-1111-4111-8111-111111111111',
  reporter_id: '22222222-2222-4222-8222-222222222222',
  reporter_name: 'Anna Installatör',
  kind: 'bug',
  area: 'crm',
  title: 'Offerten sparar inte',
  description: 'Jag trycker Spara och inget händer.',
  page_path: '/crm/offerter',
  status: 'new',
  resolution: null,
  screenshot_bucket: null,
  screenshot_path: null,
  changelog_note: null,
  changelog_published_at: null,
  handled_by: null,
  handled_at: null,
  created_at: '2026-08-12T08:00:00.000Z',
  updated_at: '2026-08-12T08:00:00.000Z',
};

describe('createTicketSchema', () => {
  const valid = { kind: 'bug', area: 'crm', title: 'Rubrik', description: 'Beskrivning', page_path: '/crm' };

  it('accepterar varje kind och area', () => {
    for (const kind of TICKET_KINDS) {
      expect(createTicketSchema.parse({ ...valid, kind }).kind).toBe(kind);
    }
    for (const area of TICKET_AREAS) {
      expect(createTicketSchema.parse({ ...valid, area }).area).toBe(area);
    }
  });

  it('avvisar okänd kind och area', () => {
    expect(() => createTicketSchema.parse({ ...valid, kind: 'question' })).toThrow();
    expect(() => createTicketSchema.parse({ ...valid, area: 'fortnox' })).toThrow();
  });

  it('kräver rubrik och beskrivning, och trimmar dem', () => {
    expect(() => createTicketSchema.parse({ ...valid, title: '   ' })).toThrow();
    expect(() => createTicketSchema.parse({ ...valid, description: '' })).toThrow();
    const parsed = createTicketSchema.parse({ ...valid, title: '  Rubrik  ', description: '  Text  ' });
    expect(parsed.title).toBe('Rubrik');
    expect(parsed.description).toBe('Text');
  });

  it('avvisar en rubrik över 120 tecken', () => {
    expect(() => createTicketSchema.parse({ ...valid, title: 'a'.repeat(121) })).toThrow();
    expect(createTicketSchema.parse({ ...valid, title: 'a'.repeat(120) }).title).toHaveLength(120);
  });

  // page_path fylls av klienten men får aldrig bli en väg ut ur appen: skulle en vy göra den
  // klickbar vore en absolut URL en öppen redirect.
  it('släpper bara igenom app-interna sökvägar i page_path', () => {
    expect(createTicketSchema.parse({ ...valid, page_path: '/crm/arbetsorder/abc' }).page_path).toBe('/crm/arbetsorder/abc');
    expect(createTicketSchema.parse({ ...valid, page_path: 'https://evil.example/x' }).page_path).toBeNull();
    expect(createTicketSchema.parse({ ...valid, page_path: '//evil.example/x' }).page_path).toBeNull();
    expect(createTicketSchema.parse({ ...valid, page_path: 'crm/offerter' }).page_path).toBeNull();
    expect(createTicketSchema.parse({ ...valid, page_path: null }).page_path).toBeNull();
  });
});

describe('updateTicketSchema', () => {
  it('tillåter en tom uppdatering (routen avgör att inget skickades)', () => {
    expect(updateTicketSchema.parse({})).toEqual({});
  });

  it('normaliserar blanka texter till null och trimmar riktiga', () => {
    expect(updateTicketSchema.parse({ resolution: '   ' }).resolution).toBeNull();
    expect(updateTicketSchema.parse({ resolution: ' fixat ' }).resolution).toBe('fixat');
    expect(updateTicketSchema.parse({ changelog_note: '  ny sökruta  ' }).changelog_note).toBe('ny sökruta');
  });

  it('avvisar en okänd status', () => {
    expect(() => updateTicketSchema.parse({ status: 'closed' })).toThrow();
    for (const status of TICKET_STATUSES) {
      expect(updateTicketSchema.parse({ status }).status).toBe(status);
    }
  });
});

describe('listTicketsQuerySchema', () => {
  it('defaultar scope till mine och state till any', () => {
    const parsed = listTicketsQuerySchema.parse({});
    expect(parsed.scope).toBe('mine');
    expect(parsed.state).toBe('any');
  });

  it('avvisar okänd scope och state', () => {
    expect(() => listTicketsQuerySchema.parse({ scope: 'everyone' })).toThrow();
    expect(() => listTicketsQuerySchema.parse({ state: 'archived' })).toThrow();
  });
});

describe('validateScreenshot', () => {
  it('accepterar en vanlig bild', () => {
    expect(validateScreenshot({ size: 1024, type: 'image/png', name: 'skarm.png' })).toBeNull();
  });

  it('avvisar tom fil och för stor fil', () => {
    expect(validateScreenshot({ size: 0, type: 'image/png', name: 'x.png' })).toMatch(/tom/i);
    expect(validateScreenshot({ size: SCREENSHOT_MAX_BYTES + 1, type: 'image/png', name: 'x.png' })).toMatch(/stor/i);
  });

  it('avvisar icke-bilder', () => {
    expect(validateScreenshot({ size: 10, type: 'application/pdf', name: 'x.pdf' })).toMatch(/bildfiler/i);
  });

  // Vissa mobilbrowsers skickar tom content-type för HEIC.
  it('faller tillbaka på filändelsen när content-type saknas', () => {
    expect(validateScreenshot({ size: 10, type: '', name: 'IMG_0001.HEIC' })).toBeNull();
    expect(validateScreenshot({ size: 10, type: '', name: 'anteckning.txt' })).toMatch(/bildfiler/i);
  });
});

describe('mapTicketRow', () => {
  it('sätter svenska etiketter för kind, area och status', () => {
    const view = mapTicketRow(baseRow);
    expect(view.kind_label).toBe(kindLabel.bug);
    expect(view.area_label).toBe(areaLabel.crm);
    expect(view.status_label).toBe(statusLabel.new);
    expect(view.is_closed).toBe(false);
  });

  it('markerar klara och avvisade som stängda', () => {
    expect(mapTicketRow({ ...baseRow, status: 'done' }).is_closed).toBe(true);
    expect(mapTicketRow({ ...baseRow, status: 'declined' }).is_closed).toBe(true);
    expect(isClosedTicketStatus('in_progress')).toBe(false);
  });

  it('kräver BÅDE bucket och path för has_screenshot', () => {
    expect(mapTicketRow(baseRow).has_screenshot).toBe(false);
    expect(mapTicketRow({ ...baseRow, screenshot_bucket: 'pdfs' }).has_screenshot).toBe(false);
    expect(mapTicketRow({ ...baseRow, screenshot_bucket: 'pdfs', screenshot_path: 'Support/a.png' }).has_screenshot).toBe(true);
  });

  it('faller tillbaka på begripliga värden för okända nycklar i stället för att krascha', () => {
    const view = mapTicketRow({ ...baseRow, kind: 'nonsens', area: 'nonsens', status: 'nonsens' });
    expect(view.kind).toBe('bug');
    expect(view.area).toBe('other');
    expect(view.status).toBe('new');
  });

  it('mapTicketRows hanterar null', () => {
    expect(mapTicketRows(null)).toEqual([]);
    expect(mapTicketRows([baseRow])).toHaveLength(1);
  });
});

describe('buildTicketUpdatePatch', () => {
  const now = '2026-08-12T10:00:00.000Z';
  const actor = { id: '33333333-3333-4333-8333-333333333333' };

  it('skriver BARA de fält klienten skickade', () => {
    const patch = buildTicketUpdatePatch(
      { status: 'planned', resolution: 'svar', changelog_note: 'text' },
      ['status'],
      actor,
      now,
    );
    expect(patch).toEqual({ updated_at: now, status: 'planned', handled_by: actor.id, handled_at: now });
    expect(patch).not.toHaveProperty('resolution');
    expect(patch).not.toHaveProperty('changelog_note');
  });

  it('nollar ett fält som skickats som null', () => {
    const patch = buildTicketUpdatePatch({ resolution: null }, ['resolution'], actor, now);
    expect(patch.resolution).toBeNull();
  });

  it('stämplar handled_by/handled_at vid varje statusändring', () => {
    const patch = buildTicketUpdatePatch({ status: 'done' }, ['status'], actor, now);
    expect(patch.handled_by).toBe(actor.id);
    expect(patch.handled_at).toBe(now);
  });

  it('sätter och tar bort changelog-publiceringen', () => {
    expect(buildTicketUpdatePatch({ publish_to_changelog: true }, ['publish_to_changelog'], actor, now).changelog_published_at).toBe(now);
    expect(buildTicketUpdatePatch({ publish_to_changelog: false }, ['publish_to_changelog'], actor, now).changelog_published_at).toBeNull();
  });

  it('ger bara updated_at när inget skickades — routen tolkar det som tom sparning', () => {
    expect(buildTicketUpdatePatch({}, [], actor, now)).toEqual({ updated_at: now });
  });
});

describe('checkChangelogPublishable', () => {
  const current = { status: 'new', changelog_note: null as string | null };

  it('bryr sig inte om sparningar som inte publicerar', () => {
    expect(checkChangelogPublishable({ patch: { updated_at: 'x' }, current })).toBeNull();
    expect(checkChangelogPublishable({ patch: { changelog_published_at: null }, current })).toBeNull();
  });

  it('kräver att ärendet är klart', () => {
    const error = checkChangelogPublishable({
      patch: { changelog_published_at: 'nu', changelog_note: 'text' },
      current,
    });
    expect(error).toMatch(/klarmarkerat/i);
  });

  it('kräver en text att visa', () => {
    const error = checkChangelogPublishable({
      patch: { changelog_published_at: 'nu', status: 'done' },
      current,
    });
    expect(error).toMatch(/changelog-text/i);
  });

  // Status, text och publicering sätts ofta i EN sparning — då finns inget av det i DB ännu.
  it('godkänner när status och text sätts i samma sparning', () => {
    expect(
      checkChangelogPublishable({
        patch: { changelog_published_at: 'nu', status: 'done', changelog_note: 'Sökruta tillagd' },
        current,
      }),
    ).toBeNull();
  });

  it('godkänner när status och text redan står i ärendet', () => {
    expect(
      checkChangelogPublishable({
        patch: { changelog_published_at: 'nu' },
        current: { status: 'done', changelog_note: 'Sökruta tillagd' },
      }),
    ).toBeNull();
  });

  // Att tömma texten i samma sparning som man publicerar ska nekas — annars blir changelog-raden tom.
  it('nekar när texten nollas i samma sparning', () => {
    const error = checkChangelogPublishable({
      patch: { changelog_published_at: 'nu', changelog_note: null },
      current: { status: 'done', changelog_note: 'fanns förut' },
    });
    expect(error).toMatch(/changelog-text/i);
  });
});

describe('guessAreaFromPath', () => {
  it('väljer den mest specifika grenen först', () => {
    expect(guessAreaFromPath('/crm/planering')).toBe('planning');
    expect(guessAreaFromPath('/crm/korjournal')).toBe('korjournal');
    expect(guessAreaFromPath('/crm/dokument')).toBe('documents');
    expect(guessAreaFromPath('/crm/offerter/abc')).toBe('crm');
  });

  it('mappar fält-, egenkontroll- och tidytorna', () => {
    expect(guessAreaFromPath('/mina-jobb')).toBe('field');
    expect(guessAreaFromPath('/arbetsorder/abc')).toBe('field');
    expect(guessAreaFromPath('/egenkontroll')).toBe('self_check');
    expect(guessAreaFromPath('/archive')).toBe('self_check');
    expect(guessAreaFromPath('/tid')).toBe('time');
    expect(guessAreaFromPath('/tidrapport')).toBe('time');
    expect(guessAreaFromPath('/plannering')).toBe('planning');
  });

  it('faller tillbaka på other för okända sidor', () => {
    expect(guessAreaFromPath('/')).toBe('other');
    expect(guessAreaFromPath('/nyheter')).toBe('other');
    expect(guessAreaFromPath('')).toBe('other');
  });
});

describe('skärmbildens lagringsväg', () => {
  // Nyckeln blir ren ASCII: mellanslag → bindestreck, åäö och parenteser → _, ändelsen kvar.
  it('rensar filnamnet men behåller ändelsen', () => {
    expect(sanitizeScreenshotName('Skärm bild (1).png')).toBe('Sk_rm-bild-_1_.png');
    expect(sanitizeScreenshotName('../../etc/passwd')).toBe('.-.-etc-passwd');
    expect(sanitizeScreenshotName('')).toBe('skarmbild');
  });

  it('lägger allt under Support-prefixet med ett unikt id', () => {
    expect(buildScreenshotPath('bild.png', 'uid-1')).toBe('Support/uid-1-bild.png');
  });
});

describe('notismottagare', () => {
  it('utesluter rapportören ur sina egna notiser', () => {
    expect(excludeReporter(['a', 'b'], 'a')).toEqual(['b']);
    expect(excludeReporter(['a', 'b'], null)).toEqual(['a', 'b']);
  });
});

// Nycklarna finns på två ställen: TS-listorna och CHECK-villkoren i migrationen. Glider de isär
// blir felet TYST i utvecklingen och ett 500 i drift — formuläret erbjuder ett värde som databasen
// vägrar ta emot. Den här kontrollen är hela skyddet mot det.
describe('TS-nycklarna matchar CHECK-villkoren i migrationen', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/sql/20260812_app_tickets.sql'), 'utf8');

  function allowedValues(constraint: string): string[] {
    const start = sql.indexOf(constraint);
    expect(start, `hittade inte ${constraint} i migrationen`).toBeGreaterThan(-1);
    const match = sql.slice(start).match(/in \(([^)]*)\)/);
    expect(match, `kunde inte läsa in-listan för ${constraint}`).not.toBeNull();
    return [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }

  it('kind', () => {
    expect(allowedValues('app_tickets_kind_chk').sort()).toEqual([...TICKET_KINDS].sort());
  });

  it('status', () => {
    expect(allowedValues('app_tickets_status_chk').sort()).toEqual([...TICKET_STATUSES].sort());
  });

  it('area', () => {
    expect(allowedValues('app_tickets_area_chk').sort()).toEqual([...TICKET_AREAS].sort());
  });

  it('varje nyckel har en svensk etikett', () => {
    for (const kind of TICKET_KINDS) expect(kindLabel[kind]).toBeTruthy();
    for (const area of TICKET_AREAS) expect(areaLabel[area]).toBeTruthy();
    for (const status of TICKET_STATUSES) expect(statusLabel[status]).toBeTruthy();
  });
});

describe('buildAppTicketCreatedNotification', () => {
  it('djuplänkar till backlog-fliken med ärendet förvalt', () => {
    const content = buildAppTicketCreatedNotification({
      ticketId: baseRow.id,
      kindLabel: 'Bugg',
      areaLabel: 'CRM, offerter & ordrar',
      title: 'Offerten sparar inte',
      reporterName: 'Anna Installatör',
    });
    expect(content.type).toBe('app_ticket.created');
    expect(content.title).toBe('Bugg: Offerten sparar inte');
    expect(content.href).toBe(`/admin?tab=arenden&arende=${baseRow.id}`);
    expect(content.entity_type).toBe('app_ticket');
    expect(content.entity_id).toBe(baseRow.id);
  });
});

import { describe, it, expect } from 'vitest';
import {
  buildTaskStatusTogglePayload,
  buildTaskSubmitPayload,
  draftForNewTask,
  draftFromTask,
  initialDraft,
  toIsoDateTime,
  type TaskItem,
} from '@/app/crm/lib/taskForm';
import { createCrmTaskSchema } from '@/app/api/crm/tasks/_lib';

const QUOTE_ID = '11111111-1111-1111-1111-111111111111';
const SALJARE = '44444444-4444-4444-4444-444444444444';

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 't1',
    related_type: null,
    related_id: null,
    related_label: null,
    prospect_id: null,
    user_id: 'user-1',
    created_by: 'user-1',
    delegated: false,
    title: 'Ring kunden',
    details: null,
    status: 'open',
    priority: 'normal',
    due_date: null,
    remind_at: null,
    source: null,
    completed_at: null,
    created_at: '2026-08-31T08:00:00Z',
    updated_at: '2026-08-31T08:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mottagaren — regeln som gör delegeringen (och notisen) rätt
// ---------------------------------------------------------------------------

describe('buildTaskSubmitPayload — mottagaren', () => {
  it('skickar mottagaren när en admin skapar åt någon annan', () => {
    const draft = { ...initialDraft, title: 'Ring', user_id: SALJARE };
    const payload = buildTaskSubmitPayload(draft, { isEditing: false, canDelegate: true });
    expect(payload.user_id).toBe(SALJARE);
  });

  // 🧨 En befintlig uppgift flyttas inte mellan personer. Skickades fältet vid PATCH hade rutten
  // fått ett värde den ändå ignorerar — och läsaren av koden hade trott att den gör något.
  it('skickar ALDRIG mottagaren vid redigering', () => {
    const draft = { ...initialDraft, title: 'Ring', user_id: SALJARE };
    const payload = buildTaskSubmitPayload(draft, { isEditing: true, canDelegate: true });
    expect(payload.user_id).toBeUndefined();
  });

  // Klientens gren är inte säkerheten — authorizeTaskOwner i rutten är. Men UI:t ska inte skicka
  // ett värde som ändå kommer att nekas med 403.
  it('skickar inte mottagaren när användaren inte får delegera', () => {
    const draft = { ...initialDraft, title: 'Ring', user_id: SALJARE };
    const payload = buildTaskSubmitPayload(draft, { isEditing: false, canDelegate: false });
    expect(payload.user_id).toBeUndefined();
  });

  it('tom mottagare betyder mig själv, alltså inget fält alls', () => {
    const payload = buildTaskSubmitPayload({ ...initialDraft, title: 'Ring' }, { isEditing: false, canDelegate: true });
    expect(payload.user_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Nyttolasten mot det riktiga schemat
// ---------------------------------------------------------------------------

describe('buildTaskSubmitPayload — mot createCrmTaskSchema', () => {
  it('en uppgift med låst offertkoppling behåller kopplingen genom valideringen', () => {
    const draft = draftForNewTask({ type: 'crm_quote', id: QUOTE_ID, label: 'Vind (#OFF-1)' });
    const payload = buildTaskSubmitPayload({ ...draft, title: 'Ring kunden' }, { isEditing: false, canDelegate: false });
    const parsed = createCrmTaskSchema.safeParse(payload);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.related_type).toBe('crm_quote');
    expect(parsed.data.related_id).toBe(QUOTE_ID);
    expect(parsed.data.related_label).toBe('Vind (#OFF-1)');
  });

  // Påminnelsen skrivs som datetime-local ('2026-09-15T09:00') men schemat kräver ISO. Utan
  // konverteringen faller hela sparningen på en valideringsmiss i ett fält man knappt använder.
  it('påminnelsen konverteras till ISO som schemat accepterar', () => {
    const payload = buildTaskSubmitPayload(
      { ...initialDraft, title: 'Ring', remind_at: '2026-09-15T09:00' },
      { isEditing: false, canDelegate: false },
    );
    expect(payload.remind_at).toBe(toIsoDateTime('2026-09-15T09:00'));
    expect(createCrmTaskSchema.safeParse(payload).success).toBe(true);
  });

  it('tom påminnelse blir null, inte tom sträng', () => {
    const payload = buildTaskSubmitPayload({ ...initialDraft, title: 'Ring' }, { isEditing: false, canDelegate: false });
    expect(payload.remind_at).toBeNull();
    expect(createCrmTaskSchema.safeParse(payload).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Utkastet
// ---------------------------------------------------------------------------

describe('draftForNewTask', () => {
  it('utan låst koppling är utkastet tomt', () => {
    expect(draftForNewTask()).toEqual(initialDraft);
  });

  it('med låst koppling är den redan ifylld', () => {
    const draft = draftForNewTask({ type: 'crm_quote', id: QUOTE_ID, label: 'Vind (#OFF-1)' });
    expect(draft.related_type).toBe('crm_quote');
    expect(draft.related_id).toBe(QUOTE_ID);
    expect(draft.related_label).toBe('Vind (#OFF-1)');
    expect(draft.title).toBe('');
  });
});

describe('draftFromTask', () => {
  it('speglar raden', () => {
    const draft = draftFromTask(task({
      related_type: 'crm_quote', related_id: QUOTE_ID, related_label: 'Vind (#OFF-1)',
      details: 'Fråga om taket', priority: 'high', due_date: '2026-09-15', status: 'done',
    }));
    expect(draft.related_type).toBe('crm_quote');
    expect(draft.related_label).toBe('Vind (#OFF-1)');
    expect(draft.details).toBe('Fråga om taket');
    expect(draft.priority).toBe('high');
    expect(draft.due_date).toBe('2026-09-15');
    expect(draft.status).toBe('done');
  });

  // `cancelled` finns i tabellen men varken i formuläret eller i createCrmTaskSchema. Utan
  // klämningen öppnas en avbruten uppgift med tom statusruta och faller sedan på valideringen.
  it('klämmer cancelled till öppen, så uppgiften går att spara', () => {
    const draft = draftFromTask(task({ status: 'cancelled' }));
    expect(draft.status).toBe('open');
    const payload = buildTaskSubmitPayload(draft, { isEditing: true, canDelegate: false });
    expect(createCrmTaskSchema.safeParse(payload).success).toBe(true);
  });

  it('null-fält blir tomma strängar, inte "null"', () => {
    const draft = draftFromTask(task());
    expect(draft.details).toBe('');
    expect(draft.due_date).toBe('');
    expect(draft.source).toBe('');
    expect(draft.related_type).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Avbockningen — 🧨 den som gick sönder på påminnelsen
// ---------------------------------------------------------------------------

describe('buildTaskStatusTogglePayload', () => {
  // 🧨 PostgREST returnerar timestamptz MED OFFSET. zod 3:s z.string().datetime() accepterar bara
  // 'Z'. Att eka tillbaka värdet man fick gjorde alltså varje uppgift med påminnelse omöjlig att
  // bocka av: 400 från rutten, och kryssrutan studsade tillbaka.
  it('normaliserar en påminnelse med offset så schemat accepterar den', () => {
    const payload = buildTaskStatusTogglePayload(task({ remind_at: '2026-09-15T09:00:00+00:00' }), 'done');

    expect(payload.remind_at).toBe('2026-09-15T09:00:00.000Z');
    expect(createCrmTaskSchema.safeParse(payload).success).toBe(true);
  });

  // Beviset att testet ovan biter: så här såg nyttolasten ut före fixen.
  it('mutationstest: den råa offset-strängen AVVISAS av schemat', () => {
    const raw = { ...buildTaskStatusTogglePayload(task(), 'done'), remind_at: '2026-09-15T09:00:00+00:00' };
    expect(createCrmTaskSchema.safeParse(raw).success).toBe(false);
  });

  it('behåller resten av uppgiften oförändrad — utelämnat fält skrivs över med default', () => {
    const payload = buildTaskStatusTogglePayload(task({
      related_type: 'crm_quote', related_id: QUOTE_ID, related_label: 'Vind (#OFF-1)',
      details: 'Fråga om taket', priority: 'high', due_date: '2026-09-15', source: 'crm_quote',
    }), 'done');

    expect(payload).toMatchObject({
      related_type: 'crm_quote',
      related_id: QUOTE_ID,
      related_label: 'Vind (#OFF-1)',
      title: 'Ring kunden',
      details: 'Fråga om taket',
      priority: 'high',
      due_date: '2026-09-15',
      source: 'crm_quote',
      status: 'done',
    });
    expect(createCrmTaskSchema.safeParse(payload).success).toBe(true);
  });

  it('utan påminnelse blir det null', () => {
    expect(buildTaskStatusTogglePayload(task(), 'open').remind_at).toBeNull();
  });
});

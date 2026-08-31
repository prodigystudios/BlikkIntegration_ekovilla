// Ren logik bakom uppgiftsformuläret — typerna, utkastet och nyttolasten till API:t.
//
// Bor i en egen modul (utan "use client") därför att formuläret numera öppnas från två håll:
// uppgiftssidan och offertpanelens uppgiftskort. Reglerna om VAD som skickas — framför allt att
// mottagaren bara får sättas vid skapandet — får inte finnas i två kopior som kan driva isär.
// Enhetstestas i tests/crm/taskForm.test.ts.

export type CrmRelatedType = 'crm_prospect' | 'crm_customer' | 'crm_quote';

export const relatedTypeLabel: Record<CrmRelatedType, string> = {
  crm_prospect: 'Prospekt',
  crm_customer: 'Kund',
  crm_quote: 'Offert',
};

export type TaskItem = {
  id: string;
  related_type: CrmRelatedType | null;
  related_id: string | null;
  related_label: string | null;
  prospect_id: string | null;
  user_id: string;
  created_by: string | null;
  // Härleds i domänlagret: skaparen är inte den som ska göra uppgiften.
  delegated: boolean;
  title: string;
  details: string | null;
  status: 'open' | 'done' | 'cancelled';
  priority: 'low' | 'normal' | 'high';
  due_date: string | null;
  remind_at: string | null;
  source: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskDraft = {
  related_type: '' | CrmRelatedType;
  related_id: string;
  related_label: string;
  title: string;
  details: string;
  priority: TaskItem['priority'];
  due_date: string;
  remind_at: string;
  source: string;
  // Bara de två lägena formuläret erbjuder. `cancelled` finns i databasen men kan varken väljas
  // här eller accepteras av createCrmTaskSchema — se draftFromTask.
  status: 'open' | 'done';
  // Vem uppgiften ska ligga på. Tom sträng = jag själv. Sätts bara vid skapandet — en befintlig
  // uppgift flyttas inte mellan personer.
  user_id: string;
};

/** En koppling som är given av sammanhanget och inte ska gå att ändra i formuläret. */
export type LockedRelation = {
  type: CrmRelatedType;
  id: string;
  label: string;
};

export const initialDraft: TaskDraft = {
  related_type: '',
  related_id: '',
  related_label: '',
  title: '',
  details: '',
  priority: 'normal',
  due_date: '',
  remind_at: '',
  source: '',
  status: 'open',
  user_id: '',
};

export function toDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function toIsoDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** Ett tomt utkast, med en given koppling redan ifylld när sammanhanget bestämmer den. */
export function draftForNewTask(locked?: LockedRelation | null): TaskDraft {
  if (!locked) return initialDraft;
  return {
    ...initialDraft,
    related_type: locked.type,
    related_id: locked.id,
    related_label: locked.label,
  };
}

/** Utkastet som speglar en befintlig uppgift. */
export function draftFromTask(task: TaskItem): TaskDraft {
  return {
    related_type: task.related_type || '',
    related_id: task.related_id || '',
    related_label: task.related_label || '',
    title: task.title,
    details: task.details || '',
    priority: task.priority,
    due_date: task.due_date || '',
    remind_at: toDateTimeLocalValue(task.remind_at),
    source: task.source || '',
    // `cancelled` finns i tabellen men inte i formuläret och inte i createCrmTaskSchema. Utan den
    // här klämningen hade en avbruten uppgift öppnats med en tom statusruta och sedan fallit på
    // valideringen vid spara.
    status: task.status === 'done' ? 'done' : 'open',
    // Ägaren är låst efter skapandet — väljaren visas inte i redigeringsläget, och fältet skickas
    // inte med i PATCH:en. Bärs ändå med så draften speglar raden.
    user_id: task.user_id,
  };
}

/**
 * Nyttolasten till POST/PATCH /api/crm/tasks.
 *
 * 🧨 `user_id` skickas BARA när uppgiften skapas, och bara av någon som får delegera. En befintlig
 * uppgift flyttas inte mellan personer, och att skicka fältet vid PATCH hade gett rutten ett värde
 * den ändå ignorerar — bättre att inte påstå något. `undefined` försvinner ur JSON.stringify, och
 * schemat läser utelämnat user_id som "mig själv".
 */
export function buildTaskSubmitPayload(
  draft: TaskDraft,
  opts: { isEditing: boolean; canDelegate: boolean }
) {
  return {
    ...draft,
    remind_at: toIsoDateTime(draft.remind_at),
    user_id: !opts.isEditing && opts.canDelegate && draft.user_id ? draft.user_id : undefined,
  };
}

/**
 * Nyttolasten när man bara bockar av eller återöppnar en uppgift.
 *
 * PATCH-schemat är samma som vid skapandet, alltså HELA uppgiften — utelämnat fält skrivs över med
 * schemats default. Därför skickas allt tillbaka oförändrat utom statusen.
 *
 * 🧨 Utom `remind_at`, som MÅSTE normaliseras. PostgREST returnerar timestamptz med offset
 * (`2026-09-15T09:00:00+00:00`), och `z.string().datetime()` i zod 3 accepterar bara `Z` — en
 * offset avvisas. Att eka tillbaka värdet man fick gör alltså varje uppgift MED PÅMINNELSE omöjlig
 * att bocka av: rutten svarar 400 och kryssrutan studsar tillbaka. Verifierat mot det riktiga
 * schemat i tests/crm/taskForm.test.ts.
 */
export function buildTaskStatusTogglePayload(task: TaskItem, nextStatus: 'open' | 'done') {
  return {
    related_type: task.related_type,
    related_id: task.related_id,
    related_label: task.related_label,
    title: task.title,
    details: task.details,
    priority: task.priority,
    due_date: task.due_date,
    remind_at: toIsoDateTime(task.remind_at),
    source: task.source,
    status: nextStatus,
  };
}

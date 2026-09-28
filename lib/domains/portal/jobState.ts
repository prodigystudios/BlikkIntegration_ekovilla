import { stockholmTodayISO } from '@/lib/domains/planning/timezone';

/**
 * Vad butiken ska se av sitt jobb, härlett ur arbetsordern (RESELLER_PORTAL_CRM_PLAN.md fas 4b, "Status tillbaka").
 * Ren: utskicket (jobSync.ts) läser ordern och det senast köade läget, och köar det den här funktionen säger.
 *
 * Kontraktets händelser, i den ordning butiken ser dem:
 *   job.confirmed   Fortnox-ordern finns. ekovillaOrderNumber = Fortnox-numret (kontraktspunkt 6).
 *   job.scheduled   planerat datum (fas 4a). Skickas igen när datumen ändras, och med scheduledFor: null när inget
 *                   kort ligger kvar. scheduledUntil = slutdagen (kontraktspunkt 5).
 *   job.completed   arbetsordern har status "Fakturera" (completed) eller är fakturerad.
 *   job.invoiced    arbetsordern är helt fakturerad. partially_invoiced skickas inte.
 *   job.cancelled   arbetsordern är avbruten eller borttagen (tillägg till kontraktet, William 2026-09-28).
 *
 * Reglerna (William 2026-09-28):
 *   - BARA FRAMÅT. När Utförd eller Fakturerad köats skickas inget tidigare läge igen, och inga fler datum. En order
 *     som ångras från "Fakturera" till "Pågående" syns alltså som Utförd hos butiken.
 *   - Inget efter "bekräftad" köas förrän "bekräftad" är LEVERERAD. En uppgiven händelse håller inte kvar resten av
 *     jobbets kö (fas 1b), så annars hade butiken kunnat få "Planerad" för ett jobb den aldrig sett bekräftat.
 *   - "Avbruten" behöver ingen bekräftelse, och köas bara före Utförd. Efter den köas ingenting.
 */

export const PORTAL_EVENTS_PATH = '/api/ekovilla/events';

export type PortalJobEventType = 'job.confirmed' | 'job.scheduled' | 'job.completed' | 'job.invoiced' | 'job.cancelled';

/** Det senast köade läget, som det sparas i crm_portal_jobs.sync_state. */
export type PortalJobSyncState = {
  /** Idempotency-Key för den köade job.confirmed. Satt = bekräftad är köad. */
  confirmedKey?: string;
  /** Senast köade job.scheduled. `for: null` = "inte längre planerad". Saknas = aldrig köad. */
  scheduled?: { for: string | null; until: string | null };
  completed?: true;
  invoiced?: true;
  cancelled?: true;
};

export type PortalJobEventPayload = {
  type: PortalJobEventType;
  occurredAt: string;
  data: Record<string, string | null>;
};

export type PortalJobEvent = {
  idempotencyKey: string;
  payload: PortalJobEventPayload;
  /** En ny job.scheduled ersätter en äldre som ännu väntar i kön: bara det senaste datumet behöver fram. */
  supersedeKey: string | null;
};

export type PortalJobWorkOrder = {
  status: string;
  fortnoxOrderNumber: string | null;
  fortnoxOrderSyncedAt: string | null;
  plannedStartDay: string | null;
  plannedEndDay: string | null;
  fortnoxInvoicedAt: string | null;
};

/** Status i kön för den köade job.confirmed. 'missing' = ingen rad (ska inte hända). */
export type ConfirmedDelivery = 'sent' | 'pending' | 'dead' | 'missing';

export type DerivePortalJobInput = {
  quoteId: string;
  /** Arbetsordern har funnits (crm_portal_jobs.work_order_created_at). */
  workOrderCreated: boolean;
  /** null: ordern finns inte, alltså inte än eller inte längre. */
  workOrder: PortalJobWorkOrder | null;
  state: PortalJobSyncState;
  confirmedDelivery: ConfirmedDelivery;
  now: Date;
};

export type DerivePortalJobResult = {
  events: PortalJobEvent[];
  state: PortalJobSyncState;
  /** Räkna om jobbet igen utan en ny ändring: något väntar på att "bekräftad" levereras. */
  revisit: boolean;
};

export function portalJobOrderingKey(quoteId: string): string {
  return `job:${quoteId}`;
}

function event(type: PortalJobEventType, quoteId: string, now: Date, data: Record<string, string | null>): PortalJobEvent {
  const occurredAt = now.toISOString();
  return {
    // Kontraktets form: <event>-<id>-<tidpunkt>. Tidpunkten gör två job.scheduled för samma jobb till två nycklar,
    // också när datumen går X → Y → X; den sparas med händelsen innan den köas (jobSync.ts), så ett omförsök ger samma.
    idempotencyKey: `${type}-${quoteId}-${occurredAt}`,
    payload: { type, occurredAt, data: { quoteId, ...data } },
    supersedeKey: type === 'job.scheduled' ? `job.scheduled:${quoteId}` : null,
  };
}

function isoOrNow(value: string | null, now: Date): string {
  const at = value ? new Date(value) : null;
  return at && !Number.isNaN(at.getTime()) ? at.toISOString() : now.toISOString();
}

const sameScheduled = (a: PortalJobSyncState['scheduled'], b: { for: string | null; until: string | null }) =>
  a !== undefined && a.for === b.for && a.until === b.until;

export function derivePortalJobEvents(input: DerivePortalJobInput): DerivePortalJobResult {
  const { quoteId, workOrder, now } = input;
  const state: PortalJobSyncState = { ...input.state };
  const events: PortalJobEvent[] = [];
  const done = { events, state, revisit: false };

  if (state.cancelled || !input.workOrderCreated) return done;
  const finished = Boolean(state.completed || state.invoiced);

  // Avbruten eller borttagen: bara före Utförd, och sedan ingenting mer.
  if (!workOrder || workOrder.status === 'cancelled') {
    if (!finished) {
      events.push(event('job.cancelled', quoteId, now, { cancelledAt: now.toISOString() }));
      state.cancelled = true;
    }
    return done;
  }

  if (!state.confirmedKey) {
    if (!workOrder.fortnoxOrderNumber) return done;
    const confirmed = event('job.confirmed', quoteId, now, {
      ekovillaOrderNumber: workOrder.fortnoxOrderNumber,
      // Samma form som occurredAt (…Z): databasen skriver tiden som …+00:00.
      confirmedAt: isoOrNow(workOrder.fortnoxOrderSyncedAt, now),
    });
    events.push(confirmed);
    state.confirmedKey = confirmed.idempotencyKey;
    // Resten får vänta tills den är levererad.
    return { ...done, revisit: true };
  }
  if (input.confirmedDelivery === 'pending') return { ...done, revisit: true };
  // Uppgiven (eller borta): jobbet står still tills någon skickar om den på portalsidan, som markerar jobbet igen.
  if (input.confirmedDelivery !== 'sent') return done;

  if (state.invoiced) return done;

  const status = workOrder.status;
  if (status === 'completed' || status === 'invoiced') {
    // En fakturerad order är också utförd: butiken får båda, i ordning.
    if (!state.completed) {
      events.push(event('job.completed', quoteId, now, { completedAt: stockholmTodayISO(now) }));
      state.completed = true;
    }
    if (status === 'invoiced') {
      const invoicedAt = workOrder.fortnoxInvoicedAt ? new Date(workOrder.fortnoxInvoicedAt) : now;
      events.push(event('job.invoiced', quoteId, now, { invoicedAt: stockholmTodayISO(invoicedAt) }));
      state.invoiced = true;
    }
    return done;
  }

  // Bara framåt: efter Utförd inga fler datum, också om ordern ångrats tillbaka till Pågående.
  if (state.completed) return done;
  const current = { for: workOrder.plannedStartDay, until: workOrder.plannedStartDay ? workOrder.plannedEndDay : null };
  const neverScheduled = state.scheduled === undefined;
  if (neverScheduled ? current.for !== null : !sameScheduled(state.scheduled, current)) {
    events.push(event('job.scheduled', quoteId, now, { scheduledFor: current.for, scheduledUntil: current.until }));
    state.scheduled = current;
  }
  return done;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOrNull = (v: unknown): string | null => (typeof v === 'string' && DAY.test(v) ? v : null);

/** Läser sync_state ur databasen. Okända eller trasiga fält tas bort, så att härledningen alltid får rätt form. */
export function parsePortalJobSyncState(raw: unknown): PortalJobSyncState {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const state: PortalJobSyncState = {};
  if (typeof src.confirmedKey === 'string' && src.confirmedKey) state.confirmedKey = src.confirmedKey;
  if (src.scheduled && typeof src.scheduled === 'object') {
    const s = src.scheduled as Record<string, unknown>;
    state.scheduled = { for: dayOrNull(s.for), until: dayOrNull(s.until) };
  }
  if (src.completed === true) state.completed = true;
  if (src.invoiced === true) state.invoiced = true;
  if (src.cancelled === true) state.cancelled = true;
  return state;
}

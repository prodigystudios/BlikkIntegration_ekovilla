import { describe, it, expect } from 'vitest';
import {
  derivePortalJobEvents,
  parsePortalJobSyncState,
  type DerivePortalJobInput,
  type PortalJobSyncState,
  type PortalJobWorkOrder,
} from '@/lib/domains/portal/jobState';

// Vad butiken ser av sitt jobb (fas 4b). Reglerna: bara framåt, inget efter "bekräftad" förrän den är levererad,
// "avbruten" före Utförd och sedan ingenting (William 2026-09-28).

const NOW = new Date('2026-10-12T08:30:00.000Z');
const order = (over: Partial<PortalJobWorkOrder> = {}): PortalJobWorkOrder => ({
  status: 'draft',
  fortnoxOrderNumber: null,
  fortnoxOrderSyncedAt: null,
  plannedStartDay: null,
  plannedEndDay: null,
  fortnoxInvoicedAt: null,
  ...over,
});
const CONFIRMED: PortalJobSyncState = { confirmedKey: 'job.confirmed-q-1-2026-10-01T10:00:00.000Z' };

function run(over: Partial<DerivePortalJobInput>) {
  const result = derivePortalJobEvents({
    quoteId: 'q-1',
    workOrderCreated: true,
    workOrder: order(),
    state: {},
    confirmedDelivery: 'missing',
    now: NOW,
    ...over,
  });
  return { ...result, types: result.events.map((e) => e.payload.type) };
}

describe('derivePortalJobEvents: bekräftad', () => {
  it('ingenting innan Fortnox-ordern finns', () => {
    expect(run({}).types).toEqual([]);
  });

  it('Fortnox-ordern finns: job.confirmed med Fortnox-numret, och sedan väntar resten', () => {
    const r = run({ workOrder: order({ fortnoxOrderNumber: '26', fortnoxOrderSyncedAt: '2026-10-01T10:00:00.000Z', plannedStartDay: '2026-10-14', plannedEndDay: '2026-10-15' }) });
    expect(r.types).toEqual(['job.confirmed']);
    expect(r.events[0].payload.data).toEqual({ quoteId: 'q-1', ekovillaOrderNumber: '26', confirmedAt: '2026-10-01T10:00:00.000Z' });
    expect(r.state.confirmedKey).toBe(r.events[0].idempotencyKey);
    expect(r.revisit).toBe(true);
  });

  it('confirmedAt i samma form som occurredAt, också när databasen skriver +00:00; en trasig tid ger nu', () => {
    const r = run({ workOrder: order({ fortnoxOrderNumber: '26', fortnoxOrderSyncedAt: '2026-09-28T09:29:30.779+00:00' }) });
    expect(r.events[0].payload.data.confirmedAt).toBe('2026-09-28T09:29:30.779Z');
    const broken = run({ workOrder: order({ fortnoxOrderNumber: '26', fortnoxOrderSyncedAt: 'x' }) });
    expect(broken.events[0].payload.data.confirmedAt).toBe(NOW.toISOString());
  });

  it('nyckeln har kontraktets form <event>-<id>-<tidpunkt>, och kroppen type/occurredAt/data', () => {
    const r = run({ workOrder: order({ fortnoxOrderNumber: '26' }) });
    expect(r.events[0].idempotencyKey).toBe('job.confirmed-q-1-2026-10-12T08:30:00.000Z');
    expect(r.events[0].payload).toMatchObject({ type: 'job.confirmed', occurredAt: '2026-10-12T08:30:00.000Z' });
    expect(r.events[0].supersedeKey).toBeNull();
  });

  it('köad men inte levererad: ingenting nytt, räkna om senare', () => {
    const r = run({ state: CONFIRMED, confirmedDelivery: 'pending', workOrder: order({ fortnoxOrderNumber: '26', plannedStartDay: '2026-10-14', plannedEndDay: '2026-10-14' }) });
    expect(r.types).toEqual([]);
    expect(r.revisit).toBe(true);
  });

  it('uppgiven: jobbet står still och räknas inte om förrän någon skickar om den', () => {
    for (const delivery of ['dead', 'missing'] as const) {
      const r = run({ state: CONFIRMED, confirmedDelivery: delivery, workOrder: order({ fortnoxOrderNumber: '26', status: 'completed' }) });
      expect(r.types).toEqual([]);
      expect(r.revisit).toBe(false);
    }
  });
});

describe('derivePortalJobEvents: planerad', () => {
  const delivered = (wo: Partial<PortalJobWorkOrder>, state: PortalJobSyncState = CONFIRMED) =>
    run({ state, confirmedDelivery: 'sent', workOrder: order({ fortnoxOrderNumber: '26', ...wo }) });

  it('ett kort på schemat: job.scheduled med start- och slutdag', () => {
    const r = delivered({ plannedStartDay: '2026-10-14', plannedEndDay: '2026-10-16' });
    expect(r.types).toEqual(['job.scheduled']);
    expect(r.events[0].payload.data).toEqual({ quoteId: 'q-1', scheduledFor: '2026-10-14', scheduledUntil: '2026-10-16' });
    expect(r.events[0].supersedeKey).toBe('job.scheduled:q-1');
    expect(r.state.scheduled).toEqual({ for: '2026-10-14', until: '2026-10-16' });
    expect(r.revisit).toBe(false);
  });

  it('endagsjobb: samma dag i båda', () => {
    expect(delivered({ plannedStartDay: '2026-10-14', plannedEndDay: '2026-10-14' }).events[0].payload.data)
      .toMatchObject({ scheduledFor: '2026-10-14', scheduledUntil: '2026-10-14' });
  });

  it('samma datum som senast: ingenting', () => {
    const state = { ...CONFIRMED, scheduled: { for: '2026-10-14', until: '2026-10-16' } };
    expect(delivered({ plannedStartDay: '2026-10-14', plannedEndDay: '2026-10-16' }, state).types).toEqual([]);
  });

  it('flyttat (också bara slutdagen, en etapp till): job.scheduled igen', () => {
    const state = { ...CONFIRMED, scheduled: { for: '2026-10-14', until: '2026-10-16' } };
    expect(delivered({ plannedStartDay: '2026-10-20', plannedEndDay: '2026-10-21' }, state).types).toEqual(['job.scheduled']);
    const longer = delivered({ plannedStartDay: '2026-10-14', plannedEndDay: '2026-10-23' }, state);
    expect(longer.events[0].payload.data).toMatchObject({ scheduledFor: '2026-10-14', scheduledUntil: '2026-10-23' });
  });

  it('sista kortet borttaget eller pausat (datumen tomma): scheduledFor null, "inte längre planerad"', () => {
    const state = { ...CONFIRMED, scheduled: { for: '2026-10-14', until: '2026-10-16' } };
    const r = delivered({}, state);
    expect(r.types).toEqual(['job.scheduled']);
    expect(r.events[0].payload.data).toEqual({ quoteId: 'q-1', scheduledFor: null, scheduledUntil: null });
    expect(r.state.scheduled).toEqual({ for: null, until: null });
  });

  it('aldrig planerad och fortfarande utan datum: ingenting (inget "inte längre planerad" för ett jobb som aldrig var det)', () => {
    expect(delivered({}).types).toEqual([]);
  });

  it('X → Y → X ger tre händelser med tre nycklar', () => {
    const keys = new Set<string>();
    let state: PortalJobSyncState = CONFIRMED;
    const days = ['2026-10-14', '2026-10-20', '2026-10-14'];
    days.forEach((day, i) => {
      const r = derivePortalJobEvents({
        quoteId: 'q-1', workOrderCreated: true, state, confirmedDelivery: 'sent',
        workOrder: order({ fortnoxOrderNumber: '26', plannedStartDay: day, plannedEndDay: day }),
        now: new Date(NOW.getTime() + i * 60_000),
      });
      expect(r.events).toHaveLength(1);
      keys.add(r.events[0].idempotencyKey);
      state = r.state;
    });
    expect(keys.size).toBe(3);
  });

  it('status Pågående eller Delfakturerad: fortfarande bara datumen', () => {
    for (const status of ['in_progress', 'scheduled', 'draft']) {
      expect(delivered({ status, plannedStartDay: '2026-10-14', plannedEndDay: '2026-10-14' }).types).toEqual(['job.scheduled']);
    }
  });
});

describe('derivePortalJobEvents: utförd och fakturerad', () => {
  const delivered = (wo: Partial<PortalJobWorkOrder>, state: PortalJobSyncState = CONFIRMED) =>
    run({ state, confirmedDelivery: 'sent', workOrder: order({ fortnoxOrderNumber: '26', ...wo }) });

  it('"Fakturera" (completed): job.completed med den svenska dagen', () => {
    // 23:30 UTC den 12:e är redan den 13:e i Stockholm.
    const r = derivePortalJobEvents({
      quoteId: 'q-1', workOrderCreated: true, state: CONFIRMED, confirmedDelivery: 'sent',
      workOrder: order({ fortnoxOrderNumber: '26', status: 'completed' }), now: new Date('2026-10-12T23:30:00.000Z'),
    });
    expect(r.events.map((e) => e.payload.type)).toEqual(['job.completed']);
    expect(r.events[0].payload.data).toEqual({ quoteId: 'q-1', completedAt: '2026-10-13' });
  });

  it('utförd: inget job.scheduled med de sista datumen först', () => {
    const r = delivered({ status: 'completed', plannedStartDay: '2026-10-20', plannedEndDay: '2026-10-20' }, { ...CONFIRMED, scheduled: { for: '2026-10-14', until: '2026-10-14' } });
    expect(r.types).toEqual(['job.completed']);
  });

  it('fakturerad direkt: utförd och sedan fakturerad, med fakturadagen (svensk dag, inte i dag)', () => {
    // 22:15 UTC den 9:e är 00:15 den 10:e i Stockholm, och "nu" är den 12:e.
    const r = delivered({ status: 'invoiced', fortnoxInvoicedAt: '2026-10-09T22:15:00.000Z' });
    expect(r.types).toEqual(['job.completed', 'job.invoiced']);
    expect(r.events[1].payload.data).toEqual({ quoteId: 'q-1', invoicedAt: '2026-10-10' });
    expect(r.state).toMatchObject({ completed: true, invoiced: true });
  });

  it('utförd sedan tidigare, nu fakturerad: bara job.invoiced', () => {
    expect(delivered({ status: 'invoiced' }, { ...CONFIRMED, completed: true }).types).toEqual(['job.invoiced']);
  });

  it('delfakturerad har varit "Fakturera" (första rundan kräver det): utförd om den inte redan skickats, men inte fakturerad', () => {
    expect(delivered({ status: 'partially_invoiced' }).types).toEqual(['job.completed']);
    expect(delivered({ status: 'partially_invoiced' }, { ...CONFIRMED, completed: true }).types).toEqual([]);
  });

  it('utförd-dagen är aldrig senare än fakturadagen (en försenad omräkning)', () => {
    const r = delivered({ status: 'invoiced', fortnoxInvoicedAt: '2026-10-09T22:15:00.000Z' });
    expect(r.events[0].payload.data).toEqual({ quoteId: 'q-1', completedAt: '2026-10-10' });
    expect(r.events[1].payload.data).toEqual({ quoteId: 'q-1', invoicedAt: '2026-10-10' });
  });

  it('BARA FRAMÅT: tillbaka till Pågående efter Utförd skickar ingenting, inte heller nya datum', () => {
    const state = { ...CONFIRMED, scheduled: { for: '2026-10-14', until: '2026-10-14' }, completed: true as const };
    expect(delivered({ status: 'in_progress', plannedStartDay: '2026-10-20', plannedEndDay: '2026-10-20' }, state).types).toEqual([]);
    expect(delivered({ status: 'completed' }, { ...state, invoiced: true }).types).toEqual([]);
  });

  it('utförd men bekräftad inte levererad: väntar', () => {
    const r = run({ state: CONFIRMED, confirmedDelivery: 'pending', workOrder: order({ fortnoxOrderNumber: '26', status: 'completed' }) });
    expect(r.types).toEqual([]);
  });

  it('utförd innan Fortnox-ordern finns: ingenting förrän den är bekräftad', () => {
    expect(run({ workOrder: order({ status: 'completed' }) }).types).toEqual([]);
  });
});

describe('derivePortalJobEvents: avbruten', () => {
  it('status Avbruten: job.cancelled, också utan bekräftelse', () => {
    const r = run({ workOrder: order({ status: 'cancelled' }) });
    expect(r.types).toEqual(['job.cancelled']);
    expect(r.events[0].payload.data).toEqual({ quoteId: 'q-1', cancelledAt: '2026-10-12T08:30:00.000Z' });
    expect(r.state.cancelled).toBe(true);
  });

  it('arbetsordern borttagen (fanns, finns inte): job.cancelled', () => {
    expect(run({ workOrder: null, state: CONFIRMED, confirmedDelivery: 'pending' }).types).toEqual(['job.cancelled']);
  });

  it('arbetsordern har aldrig funnits: ingenting', () => {
    expect(run({ workOrderCreated: false, workOrder: null }).types).toEqual([]);
  });

  it('efter avbruten skickas ingenting, vad ordern än gör', () => {
    const r = run({ state: { ...CONFIRMED, cancelled: true }, confirmedDelivery: 'sent', workOrder: order({ fortnoxOrderNumber: '26', status: 'invoiced' }) });
    expect(r.types).toEqual([]);
  });

  it('BARA FRAMÅT: inte efter Utförd', () => {
    expect(run({ state: { ...CONFIRMED, completed: true }, confirmedDelivery: 'sent', workOrder: null }).types).toEqual([]);
  });
});

describe('parsePortalJobSyncState', () => {
  it('läser det sparade läget och tar bort det som inte har rätt form', () => {
    expect(parsePortalJobSyncState({
      confirmedKey: 'k', scheduled: { for: '2026-10-14', until: 'x' }, completed: true, invoiced: 'ja', extra: 1,
    })).toEqual({ confirmedKey: 'k', scheduled: { for: '2026-10-14', until: null }, completed: true });
  });

  it('tomt, null eller en lista blir ett tomt läge', () => {
    expect(parsePortalJobSyncState(null)).toEqual({});
    expect(parsePortalJobSyncState([])).toEqual({});
    expect(parsePortalJobSyncState({})).toEqual({});
  });
});

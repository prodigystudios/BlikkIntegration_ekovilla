import { describe, it, expect } from 'vitest';
import {
  composeCrmOverviewSummary,
  OPEN_WORK_ORDER_STATUSES,
  TO_INVOICE_WORK_ORDER_STATUSES,
  type CrmOverviewRows,
  type CrmOverviewWindow,
} from '@/lib/domains/crm/overviewSummary';

// CRM-översiktens siffror räknas på servern sedan 2026-08-17, för att listorna kapas innan
// webbläsaren ser dem (PostgREST svarar med max 1000 rader, CRM-rutterna kapar lägre) — en siffra
// räknad ur en kapad lista krymper tyst när tabellen växer. Det som testas här är den rena halvan:
// rader in, läsmodell ut. Ingen databas, inga mockar.

const WINDOW: CrmOverviewWindow = {
  today: '2026-08-17',      // en måndag
  since: '2026-08-10',      // rullande 7 dagar bakåt, inklusive
  weekStart: '2026-08-17',  // veckans måndag, inklusive
  weekEnd: '2026-08-24',    // nästa måndag, EXKLUSIVE
};

const ANNA = 'user-anna';
const BOSSE = 'user-bosse';

function rows(overrides: Partial<CrmOverviewRows> = {}): CrmOverviewRows {
  return {
    quoteStocks: [],
    quoteWindow: [],
    orderStocks: [],
    orderWindow: [],
    callWindow: [],
    openTasks: [],
    counts: {
      pipelineProspects: 0,
      newProspects: 0,
      quotedProspects: 0,
      qualifiedProspects: 0,
      followUpCalls: 0,
      standaloneCalls: 0,
    },
    truncated: [],
    ...overrides,
  };
}

describe('composeCrmOverviewSummary — lagren', () => {
  it('räknar och summerar aktiva offerter, och håller vunna och förlorade utanför', () => {
    const summary = composeCrmOverviewSummary(rows({
      quoteStocks: [
        { status: 'draft', amount: 10_000 },
        { status: 'sent', amount: '25000.50' },
        { status: 'follow_up', amount: 5_000 },
        // Frågan filtrerar redan på status, men den rena funktionen litar inte på det: den som
        // skickar in en vunnen offert ska inte kunna blåsa upp "aktivt offertvärde".
        { status: 'won', amount: 999_999 },
        { status: 'lost', amount: 888_888 },
      ],
    }), WINDOW);

    expect(summary.activeQuotes).toBe(3);
    expect(summary.activeQuoteValue).toBe(40_000.5);
    expect(summary.quoteFollowUps).toBe(1);
  });

  it('delar ordrarna i öppet arbete och faktureringssteget, och lämnar avslutade och avbrutna utanför', () => {
    const summary = composeCrmOverviewSummary(rows({
      orderStocks: [
        { status: 'draft', amount: 1_000 },
        { status: 'scheduled', amount: 2_000 },
        { status: 'ready', amount: 4_000 },        // pensionerad status, lever kvar i gamla rader
        { status: 'in_progress', amount: 8_000 },
        { status: 'completed', amount: 16_000 },
        { status: 'partially_invoiced', amount: 32_000 },
        { status: 'invoiced', amount: 64_000 },
        { status: 'cancelled', amount: 128_000 },
      ],
    }), WINDOW);

    expect(summary.openWorkOrders).toBe(4);
    expect(summary.openOrderValue).toBe(15_000);
    expect(summary.workOrdersToInvoice).toBe(2);
    expect(summary.toInvoiceOrderValue).toBe(48_000);
  });

  it('statusgrupperna kommer från orderbrädans egna definitioner', () => {
    // Grupperna får inte drifta ifrån brädans chip-filter — då hade en ny status kunnat falla ur
    // både "Öppna ordrar" och "Att fakturera" utan att någon märkte det.
    expect(OPEN_WORK_ORDER_STATUSES).toEqual(['draft', 'scheduled', 'ready', 'in_progress']);
    expect(TO_INVOICE_WORK_ORDER_STATUSES).toEqual(['completed', 'partially_invoiced']);
  });
});

describe('composeCrmOverviewSummary — fakturerat bucketas på fakturadatumet', () => {
  // Det här är felklassen PR #70 rättade i rapporten: ordrar hämtade och bucketade på created_at
  // dolde 371 323 kr av 450 101 kr i en månad, eftersom eftersläpningen order→faktura är ungefär
  // en månad. De två datumen är alltså inte utbytbara.
  it('räknar en gammal order som fakturerades i fönstret', () => {
    const summary = composeCrmOverviewSummary(rows({
      orderWindow: [
        { status: 'invoiced', amount: 100_000, created_at: '2026-06-01T08:00:00+00:00', fortnox_invoiced_at: '2026-08-14T09:00:00+00:00', assigned_to: ANNA },
      ],
    }), WINDOW);

    expect(summary.invoicedValueLast7Days).toBe(100_000);
    // Ordern skapades långt utanför fönstret, så ordervärdet ska INTE räknas.
    expect(summary.orderValueLast7Days).toBe(0);
  });

  it('räknar inte en order som skapades i fönstret men faktureras senare', () => {
    const summary = composeCrmOverviewSummary(rows({
      orderWindow: [
        { status: 'in_progress', amount: 70_000, created_at: '2026-08-12T08:00:00+00:00', fortnox_invoiced_at: null, assigned_to: ANNA },
      ],
    }), WINDOW);

    expect(summary.orderValueLast7Days).toBe(70_000);
    expect(summary.invoicedValueLast7Days).toBe(0);
  });

  it('kräver både statusen och stämpeln', () => {
    const summary = composeCrmOverviewSummary(rows({
      orderWindow: [
        // Status invoiced men ingen stämpel: en gammal rad från före kolumnen fanns. Ingen
        // created_at-fallback här — raden ska summera till topplistans fakturerat, och den
        // kräver stämpeln.
        { status: 'invoiced', amount: 50_000, created_at: '2026-08-12T08:00:00+00:00', fortnox_invoiced_at: null, assigned_to: ANNA },
        // Stämpel men inte fakturerad status: ska inte kunna hända, och räknas inte.
        { status: 'completed', amount: 60_000, created_at: '2026-06-01T08:00:00+00:00', fortnox_invoiced_at: '2026-08-13T08:00:00+00:00', assigned_to: ANNA },
      ],
    }), WINDOW);

    expect(summary.invoicedValueLast7Days).toBe(0);
  });

  it('tar med randdagen (since är inklusive) men inte dagen före', () => {
    const summary = composeCrmOverviewSummary(rows({
      orderWindow: [
        { status: 'draft', amount: 1_000, created_at: '2026-08-10T23:30:00+00:00', fortnox_invoiced_at: null, assigned_to: ANNA },
        { status: 'draft', amount: 2_000, created_at: '2026-08-09T23:30:00+00:00', fortnox_invoiced_at: null, assigned_to: ANNA },
      ],
    }), WINDOW);

    expect(summary.orderValueLast7Days).toBe(1_000);
  });
});

describe('composeCrmOverviewSummary — veckans utfall per säljare', () => {
  it('fördelar samtal, offerter, ordrar och fakturerat på rätt användare', () => {
    const summary = composeCrmOverviewSummary(rows({
      callWindow: [
        { user_id: ANNA, call_at: '2026-08-17T09:00:00+00:00' },
        { user_id: ANNA, call_at: '2026-08-18T09:00:00+00:00' },
        { user_id: BOSSE, call_at: '2026-08-19T09:00:00+00:00' },
      ],
      quoteWindow: [
        { amount: '12000', quote_date: '2026-08-17', assigned_to: ANNA },
        { amount: 8_000, quote_date: '2026-08-20', assigned_to: BOSSE },
      ],
      orderWindow: [
        { status: 'scheduled', amount: 40_000, created_at: '2026-08-18T10:00:00+00:00', fortnox_invoiced_at: null, assigned_to: ANNA },
        { status: 'invoiced', amount: 30_000, created_at: '2026-07-01T10:00:00+00:00', fortnox_invoiced_at: '2026-08-19T10:00:00+00:00', assigned_to: BOSSE },
      ],
    }), WINDOW);

    expect(summary.weekByUser[ANNA]).toEqual({
      calls: 2, quotes: 1, quoteValue: 12_000, orderCount: 1, orderValue: 40_000, invoicedValue: 0,
    });
    expect(summary.weekByUser[BOSSE]).toEqual({
      calls: 1, quotes: 1, quoteValue: 8_000, orderCount: 0, orderValue: 0, invoicedValue: 30_000,
    });
  });

  it('veckans slut är exklusive, och förra veckans rader hör inte hit', () => {
    const summary = composeCrmOverviewSummary(rows({
      callWindow: [
        { user_id: ANNA, call_at: '2026-08-24T08:00:00+00:00' }, // nästa måndag — utanför
        { user_id: ANNA, call_at: '2026-08-16T08:00:00+00:00' }, // söndagen före — utanför
        { user_id: ANNA, call_at: '2026-08-23T08:00:00+00:00' }, // veckans söndag — inne
      ],
    }), WINDOW);

    expect(summary.weekByUser[ANNA]).toMatchObject({ calls: 1 });
    // Samtalsfönstret är de rullande 7 dagarna, alltså vidare än veckan: söndagen den 16:e är kvar.
    expect(summary.callsLast7Days).toBe(3);
  });

  it('en order utan ansvarig hamnar inte på någon säljare', () => {
    const summary = composeCrmOverviewSummary(rows({
      orderWindow: [
        { status: 'scheduled', amount: 5_000, created_at: '2026-08-18T10:00:00+00:00', fortnox_invoiced_at: null, assigned_to: null },
      ],
    }), WINDOW);

    expect(summary.weekByUser).toEqual({});
    // Lagsiffran ska däremot inte tappa ordern bara för att ingen är utsedd.
    expect(summary.orderValueLast7Days).toBe(5_000);
  });
});

describe('composeCrmOverviewSummary — uppgifter och genomsläpp', () => {
  it('delar öppna uppgifter i sena, dagens och resten', () => {
    const summary = composeCrmOverviewSummary(rows({
      openTasks: [
        { due_at: '2026-08-10T12:00:00+00:00' }, // sen
        { due_at: '2026-08-16T12:00:00+00:00' }, // sen
        { due_at: '2026-08-17T12:00:00+00:00' }, // idag
        { due_at: '2026-08-20T12:00:00+00:00' }, // framåt
        { due_at: null },                        // ingen deadline
      ],
    }), WINDOW);

    expect(summary.openTasks).toBe(5);
    expect(summary.overdueTasks).toBe(2);
    expect(summary.todayTasks).toBe(1);
  });

  it('släpper igenom head-räkningarna och kapningsflaggan orörda', () => {
    const summary = composeCrmOverviewSummary(rows({
      counts: {
        pipelineProspects: 778, newProspects: 12, quotedProspects: 3, qualifiedProspects: 9,
        followUpCalls: 4, standaloneCalls: 2,
      },
      truncated: ['quote_window'],
    }), WINDOW);

    expect(summary.pipelineProspects).toBe(778);
    expect(summary.newProspects).toBe(12);
    expect(summary.quotedProspects).toBe(3);
    expect(summary.qualifiedProspects).toBe(9);
    expect(summary.followUpCalls).toBe(4);
    expect(summary.standaloneCalls).toBe(2);
    expect(summary.truncated).toEqual(['quote_window']);
  });

  it('tål belopp som strängar och skräp', () => {
    // Supabase svarar med numeric som sträng, och en tom kolumn som null.
    const summary = composeCrmOverviewSummary(rows({
      quoteStocks: [
        { status: 'draft', amount: '1234.56' },
        { status: 'sent', amount: 'inte ett tal' },
        { status: 'follow_up', amount: '' },
      ],
    }), WINDOW);

    expect(summary.activeQuotes).toBe(3);
    expect(summary.activeQuoteValue).toBe(1234.56);
  });
});

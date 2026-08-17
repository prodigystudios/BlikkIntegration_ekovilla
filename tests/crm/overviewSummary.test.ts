import { describe, it, expect } from 'vitest';
import {
  composeCrmOverviewSummary,
  OPEN_WORK_ORDER_STATUSES,
  TO_INVOICE_WORK_ORDER_STATUSES,
  ACTIVE_QUOTE_STATUSES,
  type CrmOverviewRows,
  type CrmOverviewWindow,
} from '@/lib/domains/crm/overviewSummary';

// CRM-översiktens siffror räknas på servern sedan 2026-08-17, för att listorna kapas innan
// webbläsaren ser dem (PostgREST svarar med max 1000 rader, CRM-rutterna kapar lägre) — en siffra
// räknad ur en kapad lista krymper tyst när tabellen växer. Det som testas här är den rena halvan:
// rader in, läsmodell ut. Ingen databas, inga mockar.
//
// TVÅ FÖNSTER, med flit:
//  · veckan — allt som mäts mot ett veckomål, för laget och per säljare i samma svep, så att
//    lagraden och topplistans rader för samma mått går att stämma av mot varandra.
//  · rullande 7 dagar — bara samtalen, för det är det enda talet vars etikett säger det
//    ("Samtal senaste 7 dagar").

const WINDOW: CrmOverviewWindow = {
  today: '2026-08-17',      // en måndag
  since: '2026-08-10',      // rullande 7 dagar bakåt, inklusive
  weekStart: '2026-08-17',  // veckans måndag, inklusive
  weekEnd: '2026-08-24',    // nästa måndag, EXKLUSIVE
};

const ANNA = 'user-anna';
const BOSSE = 'user-bosse';

function call(userId: string | null, callAt: string, extra: { outcome?: string; prospect_id?: string | null } = {}) {
  return {
    user_id: userId as string,
    call_at: callAt,
    outcome: extra.outcome ?? 'positive',
    // Not `?? 'p1'`: null is the value under test (a call without a prospect), and ?? would swallow it.
    prospect_id: 'prospect_id' in extra ? extra.prospect_id ?? null : 'p1',
  };
}

function rows(overrides: Partial<CrmOverviewRows> = {}): CrmOverviewRows {
  return {
    quoteStocks: [],
    quoteWindow: [],
    orderStocks: [],
    orderWindow: [],
    callWindow: [],
    openTasks: [],
    counts: { pipelineProspects: 0, newProspects: 0, quotedProspects: 0, qualifiedProspects: 0 },
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

  it('statusgrupperna kommer från vyernas egna definitioner, inte från kopior', () => {
    // Grupperna får inte drifta ifrån orderbrädans chip-filter och offertlistans flikar — då hade
    // en ny status kunnat falla ur översiktens lager utan att något test gick sönder.
    expect(OPEN_WORK_ORDER_STATUSES).toEqual(['draft', 'scheduled', 'ready', 'in_progress']);
    expect(TO_INVOICE_WORK_ORDER_STATUSES).toEqual(['completed', 'partially_invoiced']);
    expect(ACTIVE_QUOTE_STATUSES).toEqual(['draft', 'sent', 'follow_up']);
  });
});

describe('composeCrmOverviewSummary — fakturerat bucketas på fakturadatumet', () => {
  // Det här är felklassen PR #70 rättade i rapporten: ordrar bucketade på created_at dolde
  // 371 323 kr av 450 101 kr i en månad, eftersom eftersläpningen order→faktura är ungefär en
  // månad. De två datumen är alltså inte utbytbara.
  it('räknar en gammal order som fakturerades i veckan', () => {
    const summary = composeCrmOverviewSummary(rows({
      orderWindow: [
        { status: 'invoiced', amount: 100_000, created_at: '2026-06-01T08:00:00+00:00', fortnox_invoiced_at: '2026-08-19T09:00:00+00:00', assigned_to: ANNA },
      ],
    }), WINDOW);

    expect(summary.weekTeam.invoicedValue).toBe(100_000);
    // Ordern skapades långt utanför veckan, så ordervärdet ska INTE räknas.
    expect(summary.weekTeam.orderValue).toBe(0);
    expect(summary.weekTeam.orderCount).toBe(0);
  });

  it('räknar inte en order som skapades i veckan men faktureras senare', () => {
    const summary = composeCrmOverviewSummary(rows({
      orderWindow: [
        { status: 'in_progress', amount: 70_000, created_at: '2026-08-18T08:00:00+00:00', fortnox_invoiced_at: null, assigned_to: ANNA },
      ],
    }), WINDOW);

    expect(summary.weekTeam.orderValue).toBe(70_000);
    expect(summary.weekTeam.invoicedValue).toBe(0);
  });

  it('kräver både statusen och stämpeln', () => {
    const summary = composeCrmOverviewSummary(rows({
      orderWindow: [
        // Status invoiced men ingen stämpel: en gammal rad från före kolumnen fanns. Ingen
        // created_at-fallback här — raden ska summera till topplistans fakturerat, och den
        // kräver stämpeln.
        { status: 'invoiced', amount: 50_000, created_at: '2026-08-18T08:00:00+00:00', fortnox_invoiced_at: null, assigned_to: ANNA },
        // Stämpel men inte fakturerad status: ska inte kunna hända, och räknas inte.
        { status: 'completed', amount: 60_000, created_at: '2026-06-01T08:00:00+00:00', fortnox_invoiced_at: '2026-08-19T08:00:00+00:00', assigned_to: ANNA },
      ],
    }), WINDOW);

    expect(summary.weekTeam.invoicedValue).toBe(0);
  });

  it('veckans start är inklusive och dess slut exklusive', () => {
    const summary = composeCrmOverviewSummary(rows({
      orderWindow: [
        { status: 'draft', amount: 1_000, created_at: '2026-08-17T23:30:00+00:00', fortnox_invoiced_at: null, assigned_to: ANNA }, // måndag — inne
        { status: 'draft', amount: 2_000, created_at: '2026-08-16T23:30:00+00:00', fortnox_invoiced_at: null, assigned_to: ANNA }, // söndagen före — ute
        { status: 'draft', amount: 4_000, created_at: '2026-08-24T00:30:00+00:00', fortnox_invoiced_at: null, assigned_to: ANNA }, // nästa måndag — ute
      ],
    }), WINDOW);

    expect(summary.weekTeam.orderValue).toBe(1_000);
  });
});

describe('composeCrmOverviewSummary — laget och säljarna räknas i samma svep', () => {
  it('fördelar samtal, offerter, ordrar och fakturerat på rätt säljare — och summerar laget', () => {
    const summary = composeCrmOverviewSummary(rows({
      callWindow: [
        call(ANNA, '2026-08-17T09:00:00+00:00'),
        call(ANNA, '2026-08-18T09:00:00+00:00'),
        call(BOSSE, '2026-08-19T09:00:00+00:00'),
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
    // Lagraden MÅSTE vara summan av säljarraderna — statusbilden visar den ovanför topplistan.
    expect(summary.weekTeam).toEqual({
      calls: 3, quotes: 2, quoteValue: 20_000, orderCount: 1, orderValue: 40_000, invoicedValue: 30_000,
    });
  });

  it('en order utan ansvarig hör till laget men till ingen säljare', () => {
    const summary = composeCrmOverviewSummary(rows({
      orderWindow: [
        { status: 'scheduled', amount: 5_000, created_at: '2026-08-18T10:00:00+00:00', fortnox_invoiced_at: null, assigned_to: null },
      ],
    }), WINDOW);

    expect(summary.weekByUser).toEqual({});
    expect(summary.weekTeam.orderValue).toBe(5_000);
  });

  it('förra veckans rader hör inte till veckan, men kan ligga i samtalens 7 dagar', () => {
    const summary = composeCrmOverviewSummary(rows({
      callWindow: [
        call(ANNA, '2026-08-24T08:00:00+00:00'), // nästa måndag — utanför VECKAN (slutet är exklusive)
        call(ANNA, '2026-08-16T08:00:00+00:00'), // söndagen före — utanför veckan, inne i 7 dagar
        call(ANNA, '2026-08-23T08:00:00+00:00'), // veckans söndag — inne i båda
        call(ANNA, '2026-08-09T08:00:00+00:00'), // åtta dagar bak — utanför båda
      ],
    }), WINDOW);

    expect(summary.weekTeam.calls).toBe(1);
    // 3, inte 2: de rullande 7 dagarna har en undre gräns men INGEN övre, precis som klientkoden
    // hade före flytten. Ett samtal med framtidsdatum räknas alltså med. Det är inte en olycka som
    // ska tystas här — vill man ha ett tak är det en ändring av vad siffran betyder.
    expect(summary.callsLast7Days).toBe(3);
  });
});

describe('composeCrmOverviewSummary — samtalen som driver "Att agera på"', () => {
  it('räknar uppföljning och fristående samtal INOM fönstret, inte över all tid', () => {
    // `outcome` är ett permanent historiskt faktum utan kvitteringsflagga. Räknat över all tid
    // hade siffran bara vuxit, och ett samtal märkt "följ upp" i juni hade fortsatt kräva
    // uppmärksamhet i december.
    const summary = composeCrmOverviewSummary(rows({
      callWindow: [
        call(ANNA, '2026-08-15T09:00:00+00:00', { outcome: 'follow_up' }),
        call(ANNA, '2026-08-16T09:00:00+00:00', { outcome: 'follow_up', prospect_id: null }),
        call(ANNA, '2026-08-11T09:00:00+00:00', { outcome: 'positive', prospect_id: null }),
        // Utanför de rullande 7 dagarna — ska inte räknas alls.
        call(ANNA, '2026-06-01T09:00:00+00:00', { outcome: 'follow_up', prospect_id: null }),
      ],
    }), WINDOW);

    expect(summary.callsLast7Days).toBe(3);
    expect(summary.followUpCalls).toBe(2);
    expect(summary.standaloneCalls).toBe(2);
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
      counts: { pipelineProspects: 778, newProspects: 12, quotedProspects: 3, qualifiedProspects: 9 },
      truncated: ['quote_window'],
    }), WINDOW);

    expect(summary.pipelineProspects).toBe(778);
    expect(summary.newProspects).toBe(12);
    expect(summary.quotedProspects).toBe(3);
    expect(summary.qualifiedProspects).toBe(9);
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

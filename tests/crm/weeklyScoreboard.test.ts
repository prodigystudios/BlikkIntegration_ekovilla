import { describe, it, expect } from 'vitest';
import type { CrmGoal } from '@/lib/domains/crm/goals';
import type { CrmOverviewWeekActuals, CrmWeekActuals } from '@/lib/domains/crm/overviewSummary';
import {
  composeWeeklyScoreboard,
  fetchWeeklyScoreboard,
  scoreboardMonthStart,
} from '@/lib/domains/crm/weeklyScoreboard';

// Lagets veckotavla på CRM-översikten: veckans utfall per säljare mot veckomålen, för hela laget
// oavsett vem som läser. Det som prövas här är den rena halvan (budget och utfall in, tavla ut) och
// vilka frågor den orena halvan ställer. Att rutten använder admin-klienten — själva skälet till att
// tavlan finns — prövas i overviewScoreboard.route.test.ts.

const WEEK = { weekStart: '2026-09-28', weekEnd: '2026-10-05' };

const ANNA = 'user-anna';
const BOSSE = 'user-bosse';
const CILLA = 'user-cilla';

type Budget = Partial<{ calls: number; quotes: number; quoteValue: number; orderCount: number; orderValue: number; invoicedValue: number }>;

function goal(userId: string, name: string | null, budget: Budget): CrmGoal {
  return {
    id: `goal-${userId}`,
    user_id: userId,
    period_type: 'month',
    period_start: '2026-10-01',
    calls_target: budget.calls ?? 0,
    quotes_target: budget.quotes ?? 0,
    quote_value_target: budget.quoteValue ?? 0,
    order_count_target: budget.orderCount ?? 0,
    order_value_target: budget.orderValue ?? 0,
    invoiced_value_target: budget.invoicedValue ?? 0,
    created_by: 'user-admin',
    updated_by: 'user-admin',
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-01T08:00:00Z',
    user: name == null ? null : { id: userId, full_name: name, role: 'sales' },
  };
}

function week(patch: Partial<CrmOverviewWeekActuals> = {}): CrmOverviewWeekActuals {
  return { calls: 0, quotes: 0, quoteValue: 0, orderCount: 0, orderValue: 0, invoicedValue: 0, ...patch };
}

function actuals(weekByUser: Record<string, CrmOverviewWeekActuals>, weekTeam?: CrmOverviewWeekActuals): CrmWeekActuals {
  const team = weekTeam ?? Object.values(weekByUser).reduce((total, row) => week({
    calls: total.calls + row.calls,
    quotes: total.quotes + row.quotes,
    quoteValue: total.quoteValue + row.quoteValue,
    orderCount: total.orderCount + row.orderCount,
    orderValue: total.orderValue + row.orderValue,
    invoicedValue: total.invoicedValue + row.invoicedValue,
  }), week());
  return { weekTeam: team, weekByUser };
}

function board(goals: CrmGoal[], weekActuals: CrmWeekActuals) {
  return composeWeeklyScoreboard({ actuals: weekActuals, goals, truncated: [] }, WEEK);
}

describe('composeWeeklyScoreboard — veckomålen', () => {
  it('räknar om månadsbudgeten till vecka: antal avrundas, kronor lämnas exakta', () => {
    const [anna] = board([goal(ANNA, 'Anna', {
      calls: 40, quotes: 10, quoteValue: 2_000_000, orderCount: 2, orderValue: 1_000_001,
    })], actuals({})).sellers;

    expect(anna.metrics.calls.target).toBe(10);
    expect(anna.metrics.quotes.target).toBe(3);         // 2,5 → 3
    expect(anna.metrics.quoteValue.target).toBe(500_000);
    expect(anna.metrics.orderCount.target).toBe(1);     // 0,5 → 1
    expect(anna.metrics.orderValue.target).toBe(250_000.25);
  });

  it('ett mål som avrundas till noll per vecka är inget mål — och ger ingen stjärna', () => {
    const [anna] = board([goal(ANNA, 'Anna', { calls: 1, quotes: 8 })], actuals({ [ANNA]: week({ calls: 5 }) })).sellers;
    expect(anna.metrics.calls).toEqual({ done: 5, target: null, reached: false });
  });

  it('stjärnan kräver att utfallet når målet', () => {
    const goals = [goal(ANNA, 'Anna', { calls: 40 }), goal(BOSSE, 'Bosse', { calls: 40 })];
    const sellers = board(goals, actuals({ [ANNA]: week({ calls: 10 }), [BOSSE]: week({ calls: 9 }) })).sellers;
    expect(sellers.find((row) => row.userId === ANNA)?.metrics.calls.reached).toBe(true);
    expect(sellers.find((row) => row.userId === BOSSE)?.metrics.calls.reached).toBe(false);
  });

  it('ett kronmål nås på hela kronor — samma avrundning som tavlan visar', () => {
    // Budget 100 000 → 25 000 per vecka. 24 999,60 visas som "25 000 kr / 25 000 kr" och ska då ha stjärnan.
    const goals = [goal(ANNA, 'Anna', { orderValue: 100_000 }), goal(BOSSE, 'Bosse', { orderValue: 100_000 })];
    const sellers = board(goals, actuals({ [ANNA]: week({ orderValue: 24_999.6 }), [BOSSE]: week({ orderValue: 24_999.4 }) })).sellers;
    expect(sellers.find((row) => row.userId === ANNA)?.metrics.orderValue.reached).toBe(true);
    expect(sellers.find((row) => row.userId === BOSSE)?.metrics.orderValue.reached).toBe(false);
  });

  it('fakturerat mäts mot sin egen budget, i kronor utan avrundning', () => {
    const [anna] = board([goal(ANNA, 'Anna', { invoicedValue: 250_002 })], actuals({ [ANNA]: week({ invoicedValue: 62_500.5 }) })).sellers;
    expect(anna.metrics.invoicedValue).toEqual({ done: 62_500.5, target: 62_500.5, reached: true });
  });

  it('fakturerat utan budget har inget mål — och räknas inte in i snittet', () => {
    const [anna] = board([goal(ANNA, 'Anna', { calls: 40 })], actuals({ [ANNA]: week({ calls: 5, invoicedValue: 12_500 }) })).sellers;
    expect(anna.metrics.invoicedValue).toEqual({ done: 12_500, target: null, reached: false });
    expect(anna.progressScore).toBe(0.5);
  });

  it('en budget med bara fakturerat räcker för att stå på tavlan', () => {
    expect(board([goal(ANNA, 'Anna', { invoicedValue: 400_000 })], actuals({})).sellers.map((row) => row.userId)).toEqual([ANNA]);
  });
});

describe('composeWeeklyScoreboard — vilka som står på tavlan', () => {
  it('varje säljare får sitt eget utfall, även kollegornas samtal', () => {
    const goals = [goal(ANNA, 'Anna', { calls: 40 }), goal(BOSSE, 'Bosse', { calls: 40 })];
    const sellers = board(goals, actuals({ [ANNA]: week({ calls: 7 }), [BOSSE]: week({ calls: 4 }) })).sellers;
    expect(sellers.map((row) => [row.name, row.metrics.calls.done])).toEqual([['Anna', 7], ['Bosse', 4]]);
  });

  it('en säljare med budget men utan aktivitet står med nollor', () => {
    const [anna] = board([goal(ANNA, 'Anna', { quotes: 8 })], actuals({})).sellers;
    expect(anna.metrics.quotes).toEqual({ done: 0, target: 2, reached: false });
    expect(anna.progressScore).toBe(0);
  });

  it('en budget med bara nollor hör inte hemma på tavlan', () => {
    expect(board([goal(ANNA, 'Anna', {})], actuals({ [ANNA]: week({ calls: 3 }) })).sellers).toEqual([]);
  });

  it('den som saknar budget står inte på tavlan, men utfallet räknas i laget', () => {
    const result = board(
      [goal(ANNA, 'Anna', { calls: 40 })],
      actuals({ [ANNA]: week({ calls: 2 }), [CILLA]: week({ calls: 3 }) }),
    );
    expect(result.sellers.map((row) => row.userId)).toEqual([ANNA]);
    expect(result.team.calls.done).toBe(5);
  });

  it('en profil utan namn visas som okänd', () => {
    expect(board([goal(ANNA, null, { calls: 40 })], actuals({})).sellers[0].name).toBe('Okänd användare');
  });
});

describe('composeWeeklyScoreboard — laget', () => {
  it('lagets utfall är hela veckan, också rader utan ansvarig', () => {
    const result = board([goal(ANNA, 'Anna', { calls: 40 })], actuals({ [ANNA]: week({ calls: 2 }) }, week({ calls: 6 })));
    expect(result.team.calls.done).toBe(6);
  });

  it('lagets mål är budgetarna summerade FÖRE avrundningen, inte säljarnas avrundade mål', () => {
    // Två säljare med 2 samtal i månaden: var för sig 0,5 → 1 per vecka. Summerat först: 4 → 1.
    const result = board([goal(ANNA, 'Anna', { calls: 2 }), goal(BOSSE, 'Bosse', { calls: 2 })], actuals({}));
    expect(result.sellers.map((row) => row.metrics.calls.target)).toEqual([1, 1]);
    expect(result.team.calls.target).toBe(1);
  });

  it('lagets stjärna följer samma regel som säljarens', () => {
    const result = board([goal(ANNA, 'Anna', { orderValue: 400_000 })], actuals({}, week({ orderValue: 100_000 })));
    expect(result.team.orderValue).toEqual({ done: 100_000, target: 100_000, reached: true });
  });

  it('bär veckan och kapningsflaggan vidare', () => {
    const result = composeWeeklyScoreboard({ actuals: actuals({}), goals: [], truncated: ['call_window'] }, WEEK);
    expect(result).toMatchObject({ weekStart: '2026-09-28', weekEnd: '2026-10-05', truncated: ['call_window'], sellers: [] });
  });
});

describe('composeWeeklyScoreboard — ordningen', () => {
  it('rangordnar på snittet av utfall mot mål, sedan samtal, sedan namn', () => {
    const goals = [
      goal(ANNA, 'Anna', { calls: 40, quotes: 40 }),   // 10 + 10 per vecka
      goal(BOSSE, 'Bosse', { calls: 40 }),
      goal(CILLA, 'Cilla', { calls: 40 }),
    ];
    const sellers = board(goals, actuals({
      [ANNA]: week({ calls: 10, quotes: 0 }),  // (1 + 0) / 2 = 0,5
      [BOSSE]: week({ calls: 5 }),             // 0,5, färre samtal än Anna
      [CILLA]: week({ calls: 8 }),             // 0,8
    })).sellers;
    expect(sellers.map((row) => row.name)).toEqual(['Cilla', 'Anna', 'Bosse']);
  });

  it('vid lika snitt och lika samtal avgör namnet, i svensk ordning', () => {
    const goals = [goal(ANNA, 'Örjan', { calls: 40 }), goal(BOSSE, 'Åsa', { calls: 40 })];
    expect(board(goals, actuals({})).sellers.map((row) => row.name)).toEqual(['Åsa', 'Örjan']);
  });
});

describe('scoreboardMonthStart', () => {
  // Veckan 28 sep–4 okt har tre dagar i september och fyra i oktober. Samma svar vilken dag man tittar.
  it('en vecka som korsar ett månadsskifte mäts mot månaden med flest av veckans dagar', () => {
    expect(scoreboardMonthStart('2026-09-28')).toBe('2026-10-01');
    expect(scoreboardMonthStart('2026-08-31')).toBe('2026-09-01'); // 1 dag aug, 6 sep
    expect(scoreboardMonthStart('2026-10-26')).toBe('2026-10-01'); // 6 dagar okt, 1 nov
    expect(scoreboardMonthStart('2027-03-29')).toBe('2027-04-01'); // 3 dagar mars, 4 april
    expect(scoreboardMonthStart('2026-09-21')).toBe('2026-09-01'); // hela veckan i september
  });

  it('över ett årsskifte', () => {
    expect(scoreboardMonthStart('2026-12-28')).toBe('2026-12-01'); // 4 dagar dec, 3 jan
    expect(scoreboardMonthStart('2027-01-25')).toBe('2027-01-01'); // hela veckan i januari
  });
});

// En låtsasklient som svarar per tabell och minns varje filter, så att testet kan se VILKA frågor
// som ställs och inte bara att något svarade.
function fakeClient(tables: Record<string, unknown[]>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'or', 'gte', 'lt', 'lte', 'order', 'limit']) {
        chain[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve);
      return chain;
    },
  };
  return { client: client as any, calls };
}

describe('fetchWeeklyScoreboard — frågorna', () => {
  const WINDOW = { today: '2026-10-01', ...WEEK };

  it('läser samtalen från veckans måndag och budgeten för månaden med flest av veckans dagar', async () => {
    const { client, calls } = fakeClient({});
    // Måndagen 28 sep: dagen ligger i september, men veckan hör till oktober.
    await fetchWeeklyScoreboard(client, { ...WINDOW, today: '2026-09-28' });

    expect(calls).toContainEqual({ table: 'crm_calls', method: 'gte', args: ['call_at', '2026-09-28'] });
    expect(calls).toContainEqual({ table: 'crm_goals', method: 'eq', args: ['period_type', 'month'] });
    expect(calls).toContainEqual({ table: 'crm_goals', method: 'eq', args: ['period_start', '2026-10-01'] });
  });

  // Veckobytet på översikten läser äldre veckor. Utan övre gräns läste en vecka från mars varje rad
  // sedan mars, och förbi radtaket blev siffrorna tyst för låga.
  it('läser varje fönster bara inom veckan — båda gränserna', async () => {
    const { client, calls } = fakeClient({});
    await fetchWeeklyScoreboard(client, WINDOW);

    for (const [table, column] of [['crm_quotes', 'quote_date'], ['crm_work_order_invoices', 'created_at'], ['crm_calls', 'call_at']]) {
      expect(calls).toContainEqual({ table, method: 'gte', args: [column, '2026-09-28'] });
      expect(calls).toContainEqual({ table, method: 'lt', args: [column, '2026-10-05'] });
    }
    expect(calls).toContainEqual({
      table: 'crm_work_orders',
      method: 'or',
      args: ['and(created_at.gte.2026-09-28,created_at.lt.2026-10-05),and(fortnox_invoiced_at.gte.2026-09-28,fortnox_invoiced_at.lt.2026-10-05)'],
    });
  });

  it('filtrerar inte samtalen på läsaren — kollegornas samtal kommer med', async () => {
    const { client, calls } = fakeClient({
      crm_calls: [
        { user_id: ANNA, call_at: '2026-09-29T09:00:00Z', outcome: 'positive', prospect_id: 'p1' },
        { user_id: BOSSE, call_at: '2026-09-30T09:00:00Z', outcome: 'positive', prospect_id: 'p2' },
        { user_id: BOSSE, call_at: '2026-10-01T09:00:00Z', outcome: 'no_answer', prospect_id: null },
      ],
      crm_goals: [goal(ANNA, 'Anna', { calls: 40 }), goal(BOSSE, 'Bosse', { calls: 40 })],
    });
    const result = await fetchWeeklyScoreboard(client, WINDOW);

    expect(calls.filter((call) => call.table === 'crm_calls' && call.method === 'eq')).toEqual([]);
    expect(result.sellers.map((row) => [row.name, row.metrics.calls.done])).toEqual([['Bosse', 2], ['Anna', 1]]);
    expect(result.team.calls.done).toBe(3);
  });

  it('kastar när budgeten inte går att läsa, i stället för att visa en tavla utan mål', async () => {
    const { client } = fakeClient({});
    const failing = {
      from(table: string) {
        const chain = client.from(table);
        if (table === 'crm_goals') chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'db down' } }).then(resolve);
        return chain;
      },
    };
    await expect(fetchWeeklyScoreboard(failing as any, WINDOW)).rejects.toThrow('goals: db down');
  });
});

import { describe, it, expect } from 'vitest';
import { upsertCrmGoalsSchema } from '@/app/api/crm/goals/_lib';

// Månadsbudgetens schema. Fakturerat fick sin kolumn 2026-10-05 (veckotavlan på CRM-översikten), och
// fältet är valfritt med flit: en inställningssida som laddades före kolumnen skickar det inte, och
// då ska upserten lämna den sparade budgeten orörd. Ett standardvärde 0 hade nollat den tyst.

const USER = '00000000-0000-4000-8000-000000000002';

function body(goal: Record<string, unknown>) {
  return {
    period_type: 'month',
    period_start: '2026-10-01',
    goals: [{
      user_id: USER,
      calls_target: 40,
      quotes_target: 12,
      quote_value_target: 400000,
      order_count_target: 8,
      order_value_target: 800000,
      ...goal,
    }],
  };
}

describe('upsertCrmGoalsSchema — fakturerat', () => {
  it('tar emot en budget för fakturerat', () => {
    const parsed = upsertCrmGoalsSchema.parse(body({ invoiced_value_target: '250000.5' }));
    expect(parsed.goals[0].invoiced_value_target).toBe(250000.5);
  });

  it('lämnar fältet UTELÄMNAT när det inte skickas — inte 0', () => {
    const parsed = upsertCrmGoalsSchema.parse(body({}));
    expect('invoiced_value_target' in parsed.goals[0]).toBe(false);
    // Det som faktiskt når PostgREST: utan nyckeln i JSON rör upserten inte kolumnen.
    expect(JSON.parse(JSON.stringify(parsed.goals[0]))).not.toHaveProperty('invoiced_value_target');
  });

  it('avvisar en negativ budget, som de andra målen', () => {
    expect(upsertCrmGoalsSchema.safeParse(body({ invoiced_value_target: -1 })).success).toBe(false);
  });
});

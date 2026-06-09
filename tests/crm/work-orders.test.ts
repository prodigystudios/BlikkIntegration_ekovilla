import { describe, it, expect, vi } from 'vitest';
import { createCrmWorkOrderFromQuote } from '@/lib/domains/crm/work-orders';

// ---------------------------------------------------------------------------
// Supabase-mock
//
// createCrmWorkOrderFromQuote gör tre anrop i tur och ordning:
//   1. crm_quotes   .select().eq().single()           → hämtar offerten
//   2. crm_work_orders .insert(payload).select().single() → skapar ordern
//   3. crm_quotes   .update().eq().select().single()   → länkar tillbaka
// Mocken är en chainable builder per .from(table); .single() löser olika
// beroende på tabell + operation. insert-payloaden fångas så vi kan asserta
// fält-mappningen.
// ---------------------------------------------------------------------------

function makeSupabase(quote: Record<string, unknown>) {
  const captured: { insert: Record<string, any> | null } = { insert: null };

  const supabase = {
    from(table: string) {
      const state: { op: 'select' | 'insert' | 'update' } = { op: 'select' };
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        update: vi.fn(() => { state.op = 'update'; return builder; }),
        insert: vi.fn((payload: Record<string, any>) => { state.op = 'insert'; captured.insert = payload; return builder; }),
        single: vi.fn(() => {
          if (table === 'crm_quotes' && state.op === 'select') return Promise.resolve({ data: quote, error: null });
          if (table === 'crm_work_orders' && state.op === 'insert') return Promise.resolve({ data: { id: 'wo1', order_number: 'AO-TEST' }, error: null });
          if (table === 'crm_quotes' && state.op === 'update') return Promise.resolve({ data: { id: quote.id }, error: null });
          return Promise.resolve({ data: null, error: { message: `oväntat anrop: ${table}/${state.op}` } });
        }),
      };
      return builder;
    },
  };

  return { supabase, captured };
}

const MEASUREMENT_BLOCK = 'EKOVILLA\nVägg – 100 m² × 195 mm @ 52 kg/m³ – 73 säck\n\nTotalt: 73 säck';

function wonQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    prospect_id: null,
    customer_id: null,
    customer_name: 'Test AB',
    quote_type: 'business',
    customer_snapshot: { company_name: 'Test AB' },
    pricing_summary: {},
    line_items: [],
    rot_details: {},
    internal_handoff: { handoff_notes: MEASUREMENT_BLOCK, work_scope: null, desired_installation_date: null },
    project_name: 'Takisolering',
    description: null,
    amount: 45000,
    currency_code: 'SEK',
    vat_percent: 25,
    status: 'won',
    notes: null,
    created_by: 'user-1',
    assigned_to: 'user-1',
    work_order_id: null,
    work_order_number: null,
    ...overrides,
  };
}

describe('createCrmWorkOrderFromQuote — fält-mappning', () => {
  // Regression: måttblocket (internal_handoff.handoff_notes) får INTE läcka in i orderns
  // notes-kolumn. Annars dubbleras det i både "Överlämningsnotering" och "Interna
  // anteckningar" i ordervyn.
  it('kopierar handoff_notes till internal_handoff men ALDRIG till notes', async () => {
    const { supabase, captured } = makeSupabase(wonQuote());

    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');

    expect(result.error).toBeNull();
    expect(captured.insert).not.toBeNull();
    // handoff_notes bevaras i internal_handoff (visas som "Överlämningsnotering")
    expect(captured.insert!.internal_handoff.handoff_notes).toBe(MEASUREMENT_BLOCK);
    // notes ("Interna anteckningar") får inte vara måttblocket
    expect(captured.insert!.notes).not.toBe(MEASUREMENT_BLOCK);
    expect(captured.insert!.notes).toBeNull();
  });

  it('seedar notes från offertens egna notes när de finns', async () => {
    const { supabase, captured } = makeSupabase(wonQuote({ notes: 'Internt orderunderlag' }));

    await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');

    expect(captured.insert!.notes).toBe('Internt orderunderlag');
    expect(captured.insert!.internal_handoff.handoff_notes).toBe(MEASUREMENT_BLOCK);
  });

  it('faller tillbaka på description när notes saknas', async () => {
    const { supabase, captured } = makeSupabase(wonQuote({ notes: null, description: 'Offertbeskrivning' }));

    await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');

    expect(captured.insert!.notes).toBe('Offertbeskrivning');
  });
});

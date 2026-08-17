import { describe, it, expect, vi, beforeEach } from 'vitest';

// Domänlagret kring markCrmQuoteWon: att offertens ansvariga säljare också blir kundansvarig
// när offerten vinns. Konverteringen och kundskrivningen mockas — det som testas här är
// ORKESTRERINGEN, alltså vilken kund och vilken säljare som skickas vidare.
vi.mock('@/lib/domains/crm/customers', () => ({
  convertProspectToCustomer: vi.fn(),
  setAccountManagerIfUnset: vi.fn(),
}));

import { markCrmQuoteWon } from '@/lib/domains/crm/quotes';
import { convertProspectToCustomer, setAccountManagerIfUnset } from '@/lib/domains/crm/customers';

const mockConvert = vi.mocked(convertProspectToCustomer);
const mockSetAccountManager = vi.mocked(setAccountManagerIfUnset);

const SALJARE = 'saljare-1';
const CHEFEN = 'chef-1';
const KUND = 'kund-1';
const PROSPEKT = 'prospekt-1';

/**
 * markCrmQuoteWon rör crm_quotes två gånger: en select (getCrmQuoteStatus) och en update
 * (updateCrmQuote). Builder som svarar olika beroende på operation.
 */
function makeSupabase(quote: Record<string, unknown>, updateError: { code?: string; message: string } | null = null) {
  return {
    from() {
      const state: { op: 'select' | 'update' } = { op: 'select' };
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        update: vi.fn(() => { state.op = 'update'; return builder; }),
        single: vi.fn(() => (state.op === 'select'
          ? Promise.resolve({ data: quote, error: null })
          : Promise.resolve({ data: updateError ? null : { id: quote.id, status: 'won' }, error: updateError }))),
      };
      return builder;
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetAccountManager.mockResolvedValue({ changed: true, error: null });
});

describe('markCrmQuoteWon — offertens ansvariga blir kundansvarig', () => {
  it('sätter kundansvarig på den befintliga kunden när offerten redan pekar på en', async () => {
    const supabase = makeSupabase({ id: 'q1', status: 'sent', prospect_id: null, customer_id: KUND, assigned_to: SALJARE });

    const result = await markCrmQuoteWon(supabase, 'q1', CHEFEN, { status: 'won' } as any);

    expect(result.error).toBeNull();
    expect(mockSetAccountManager).toHaveBeenCalledWith(expect.anything(), KUND, SALJARE);
  });

  it('sätter kundansvarig på den nykonverterade kunden', async () => {
    mockConvert.mockResolvedValue({ customerId: KUND, error: null });
    const supabase = makeSupabase({ id: 'q1', status: 'sent', prospect_id: PROSPEKT, customer_id: null, assigned_to: SALJARE });

    const result = await markCrmQuoteWon(supabase, 'q1', CHEFEN, { status: 'won' } as any);

    expect(result.error).toBeNull();
    expect(mockConvert).toHaveBeenCalled();
    expect(mockSetAccountManager).toHaveBeenCalledWith(expect.anything(), KUND, SALJARE);
  });

  // Kärnfallet: chefen sätter ansvarig säljare OCH markerar vunnen i samma sparning. Läser
  // koden bara den lagrade raden får kunden den ansvariga som just byttes bort.
  it('använder den ansvariga som byts i samma sparning, inte den sparade', async () => {
    const supabase = makeSupabase({ id: 'q1', status: 'sent', prospect_id: null, customer_id: KUND, assigned_to: CHEFEN });

    await markCrmQuoteWon(supabase, 'q1', CHEFEN, { status: 'won', assigned_to: SALJARE } as any);

    expect(mockSetAccountManager).toHaveBeenCalledWith(expect.anything(), KUND, SALJARE);
  });

  // Prospekt och kund är samma rad i crm_customers — prospect_id duger som kund-id innan
  // customer_id hunnit sättas.
  it('faller tillbaka på prospect_id när customer_id saknas', async () => {
    const supabase = makeSupabase({ id: 'q1', status: 'sent', prospect_id: PROSPEKT, customer_id: null, assigned_to: SALJARE });
    mockConvert.mockResolvedValue({ customerId: PROSPEKT, error: null });

    await markCrmQuoteWon(supabase, 'q1', CHEFEN, { status: 'won' } as any);

    expect(mockSetAccountManager).toHaveBeenCalledWith(expect.anything(), PROSPEKT, SALJARE);
  });

  it('rör ingen kund när offerten varken har prospekt eller kund', async () => {
    const supabase = makeSupabase({ id: 'q1', status: 'sent', prospect_id: null, customer_id: null, assigned_to: SALJARE });

    await markCrmQuoteWon(supabase, 'q1', CHEFEN, { status: 'won' } as any);

    expect(mockSetAccountManager).not.toHaveBeenCalled();
  });

  // Bara vid ÖVERGÅNGEN. Att sätta kundansvarig till "— Ingen —" på kundkortet är ett uttryckt
  // val — en refill vid nästa sparning av en redan vunnen offert hade tagit tillbaka det.
  it('rör inte kundansvarig när offerten redan var vunnen', async () => {
    const supabase = makeSupabase({ id: 'q1', status: 'won', prospect_id: null, customer_id: KUND, assigned_to: SALJARE });

    const result = await markCrmQuoteWon(supabase, 'q1', CHEFEN, { status: 'won', notes: 'rättstavning' } as any);

    expect(result.error).toBeNull();
    expect(mockSetAccountManager).not.toHaveBeenCalled();
  });

  // Att offerten blir vunnen är den viktiga händelsen. Den får inte falla på att kundansvarig
  // inte gick att sätta — kunden går att rätta i efterhand, en tappad vinstmarkering syns inte.
  it('låter sparningen lyckas även när kundansvarig inte kunde sättas', async () => {
    mockSetAccountManager.mockResolvedValue({ changed: false, error: 'RLS' });
    const supabase = makeSupabase({ id: 'q1', status: 'sent', prospect_id: null, customer_id: KUND, assigned_to: SALJARE });

    const result = await markCrmQuoteWon(supabase, 'q1', CHEFEN, { status: 'won' } as any);

    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
  });

  // 0 rader = RLS nekade (offerten är någon annans). Koden måste behålla PGRST116 så rutten
  // kan svara 403/404 i stället för en rå 500.
  it('behåller PGRST116 så rutten kan skilja "inte din" från "borta"', async () => {
    const supabase = makeSupabase(
      { id: 'q1', status: 'won', prospect_id: null, customer_id: KUND, assigned_to: SALJARE },
      { code: 'PGRST116', message: 'no rows' },
    );

    const result = await markCrmQuoteWon(supabase, 'q1', CHEFEN, { status: 'won' } as any);

    expect(result.error?.code).toBe('PGRST116');
    expect(mockSetAccountManager).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listCrmQuotesWithFilters — radordningen
//
// Standardordningen är offertlistans arbetsordning: status stigande, alltså draft → follow_up →
// lost → sent → won. Den ordningen kapar bort vunna och skickade offerter FÖRST vid radtaket,
// vilket är precis de som pengarsiffrorna på översikten bygger på. Därför finns 'updated_desc'
// för de anropare som vill ha det senast rörda — och kapningen sker på servern, så ordningen
// kan inte lagas i webbläsaren.
// ---------------------------------------------------------------------------

import { listCrmQuotesWithFilters } from '@/lib/domains/crm/quotes';
import { makeSupabaseMock } from './helpers/supabase';

describe('listCrmQuotesWithFilters — radordningen', () => {
  it('sorterar som offertlistan som standard: status, närmaste uppföljning, senaste offertdatum', async () => {
    const supabase = makeSupabaseMock({ data: [], error: null });
    await listCrmQuotesWithFilters(supabase as any, {});
    expect((supabase._query.order as any).mock.calls).toEqual([
      ['status', { ascending: true }],
      ['follow_up_date', { ascending: true, nullsFirst: false }],
      ['quote_date', { ascending: false }],
    ]);
  });

  it('sort=updated_desc sorterar på senast rörd och rör inte statusordningen', async () => {
    const supabase = makeSupabaseMock({ data: [], error: null });
    await listCrmQuotesWithFilters(supabase as any, { sort: 'updated_desc' });
    expect((supabase._query.order as any).mock.calls).toEqual([['updated_at', { ascending: false }]]);
  });
});

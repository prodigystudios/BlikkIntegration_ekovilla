import { describe, it, expect, vi, beforeEach } from 'vitest';

// Vad ARBETSORDERN faktiskt skickar till Fortnox.
//
// Systerfil till partialInvoicePayload.test.ts, och den finns av exakt samma skäl: de rena
// funktionerna (resolveRotReference, orderReferenceNumberField) kan vara aldrig så rätt medan
// sömmen mot Fortnox tappar fältet. Fram till den här filen fanns INGET test som skickade en order
// — `...header` gick att lyfta ur POST /orders utan att ett enda test blev rött, alltså en order
// helt utan OurReference, YourReference, YourOrderNumber och leveransadress.
//
// Fältnamnen är externa (Fortnox API) och stavas därför ut ordagrant. `YourOrderNumber` bär
// "Ert referensnummer" — företagskundens MÄRKNING eller villans fastighetsbeteckning. Byter någon
// det mot ett fält som "låter rättare" ska det synas som ett rött test, inte som en tom ruta på
// kundens orderbekräftelse.

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

vi.mock('@/lib/domains/fortnox/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/client')>();
  return { ...actual, fortnoxGet: vi.fn(), fortnoxPost: vi.fn(), fortnoxPut: vi.fn() };
});

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxPost, fortnoxPut } from '@/lib/domains/fortnox/client';
import { pushWorkOrderToFortnox, syncWorkOrderHeaderToFortnox } from '@/lib/domains/fortnox/orders';

const WORK_ORDER_ID = 'wo-1';

// En standalone-arbetsorder (ingen offert — quote_id null) med företagskund, en prissatt rad och
// en märkning. Samma form som order AO-20260909-06D6B7, den som fältet tappades på i drift.
const baseRow = {
  id: WORK_ORDER_ID,
  quote_id: null as string | null,
  customer_id: 'cust-1',
  assigned_to: 'user-1',
  customer_snapshot: {
    reverse_vat: false,
    label: '58184',
    your_reference: 'Per Linderdahl',
    street_address: 'Stallgatan 18',
    postal_code: '81140',
    city: 'Sandviken',
  } as Record<string, unknown>,
  work_address: { street_address: 'Stallgatan 18', postal_code: '81140', city: 'Sandviken' },
  project_name: 'Beställning från Ekovilla Lager',
  client_name: 'C24 Byggkompaniet Sandviken',
  amount: 22431.75,
  vat_percent: 25,
  currency_code: 'SEK',
  line_items: [{ id: 'line-a', pricing_mode: 'item', unit_price: '100', quantity: '10' }],
  fortnox_order_number: null as string | null,
  rot_details: {} as Record<string, unknown> | null,
};

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'lt', 'order', 'limit'] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
    Promise.resolve(result).then(ok, err);
  return chain;
}

/**
 * Databasen som den såg ut FÖRE respektive EFTER att pushen claimades.
 *
 * ⚠️ MOCKEN ÄR ORDNINGSKÄNSLIG MED FLIT, inte anropsräknande. En mock som bara matade ut svar i tur
 * och ordning hade gett samma resultat oavsett om läsningen sker före eller efter claimen — alltså
 * inte kunnat fånga regressionen den finns för. Här avgör `claimed` vad en läsning ser, och claimen
 * markeras av `update()` (claimFortnoxPush stämplar 'pending' den vägen).
 */
function installSupabaseMock(opts: {
  beforeClaim: Record<string, unknown>;
  afterClaim?: Record<string, unknown>;
}) {
  // claimFortnoxPush vinner claimen på första försöket (update … .select('id') ger en rad).
  const workOrders = makeChain({ data: [{ id: WORK_ORDER_ID }], error: null });
  let claimed = false;
  workOrders.update = vi.fn(() => {
    claimed = true;
    return workOrders;
  });
  workOrders.single = vi.fn(async () => ({
    data: claimed ? (opts.afterClaim ?? opts.beforeClaim) : opts.beforeClaim,
    error: null,
  }));

  const customers = makeChain({ data: { fortnox_customer_id: '55' }, error: null });
  const profiles = makeChain({ data: { full_name: 'Anna Andersson' }, error: null });

  vi.mocked(getSupabaseAdmin).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'crm_customers') return customers;
      if (table === 'profiles') return profiles;
      return workOrders;
    }),
  } as unknown as ReturnType<typeof getSupabaseAdmin>);
}

/** Payloaden som skickades till POST /orders. */
function postedOrder(): Record<string, unknown> {
  const [path, body] = vi.mocked(fortnoxPost).mock.calls[0] as [string, { Order: Record<string, unknown> }];
  expect(path).toBe('/orders');
  return body.Order;
}

/** Payloaden som skickades till PUT /orders/{nr}. */
function puttedOrder(): Record<string, unknown> {
  const [, body] = vi.mocked(fortnoxPut).mock.calls[0] as [string, { Order: Record<string, unknown> }];
  return body.Order;
}

describe('pushWorkOrderToFortnox — orderhuvudet vid create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fortnoxPost).mockResolvedValue({ Order: { DocumentNumber: 131 } } as never);
    vi.mocked(fortnoxPut).mockResolvedValue({} as never);
  });

  // ⚖️ KÄRNAN. Företagskundens märkning ÄR "Ert referensnummer" på ordern.
  it('bär företagskundens märkning i YourOrderNumber', async () => {
    installSupabaseMock({ beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null }, afterClaim: baseRow });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    const order = postedOrder();
    expect(order.YourOrderNumber).toBe('58184');
    // Headern i stort ska följa med — hela `...header` har lyfts ur payloaden förr utan att synas.
    expect(order.YourReference).toBe('Per Linderdahl');
    expect(order.OurReference).toBe('Anna Andersson');
    expect(order.CustomerNumber).toBe('55');
  });

  // En order utan märkning ska inte få en påhittad, och nyckeln ska UTELÄMNAS — inte skickas som
  // tom sträng. Fortnox behåller sitt eget värde för ett fält vi inte skickar, vilket är rätt för
  // en order vi inte har någon åsikt om (se orderReferenceNumberField).
  it('utelämnar YourOrderNumber helt när märkningen saknas', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: { ...baseRow, customer_snapshot: { ...baseRow.customer_snapshot, label: null } },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect('YourOrderNumber' in postedOrder()).toBe(false);
  });

  // 🧨 RACET — regressionsskyddet för den bugg filen föddes ur.
  //
  // Underlaget måste läsas EFTER att pushen är claimad. Läses det före hinner en sparning som
  // landar under pushen (den tar sekunder: kundnummer, byggmoms och ansvarig slås upp mellan
  // läsningen och POST:en) skrivas till databasen utan att nå payloaden — och säljaren märker
  // ingenting, eftersom PATCH-vägens header-synk tyst hoppar över en order som ännu inte har
  // något ordernummer.
  //
  // Mätt i drift 2026-09-09 på Fortnox-order 131: märkningen stod i CRM, fältet var tomt hos
  // Fortnox på både ordern och fakturan ur den.
  //
  // Mutationsprövat: flyttas läsningen tillbaka till före claimen blir det här testet rött.
  it('läser underlaget EFTER claimen — en märkning som sparas under pushen kommer med', async () => {
    installSupabaseMock({
      // Så såg raden ut när pushen började — ingen märkning.
      beforeClaim: { ...baseRow, customer_snapshot: { ...baseRow.customer_snapshot, label: null } },
      // …och så här efter claimen: säljaren hann spara märkningen medan pushen pågick.
      afterClaim: { ...baseRow, customer_snapshot: { ...baseRow.customer_snapshot, label: 'SPARAD-UNDER-PUSHEN' } },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(postedOrder().YourOrderNumber).toBe('SPARAD-UNDER-PUSHEN');
  });

  // Idempotensen får inte offras för omläsningen: en order som redan ligger i Fortnox ska returnera
  // sitt nummer utan att vare sig claimas eller skapas på nytt.
  it('skapar ingen andra order när ordern redan finns i Fortnox', async () => {
    installSupabaseMock({ beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: '131' } });

    const result = await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(result).toEqual({ fortnox_order_number: '131' });
    expect(fortnoxPost).not.toHaveBeenCalled();
  });
});

describe('syncWorkOrderHeaderToFortnox — speglingen av en rättad märkning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fortnoxPut).mockResolvedValue({} as never);
  });

  const syncedRow = {
    ...baseRow,
    status: 'in_progress',
    fortnox_order_number: '131',
    fortnox_invoice_number: null as string | null,
  };

  it('skickar märkningen som YourOrderNumber på en öppen order', async () => {
    installSupabaseMock({ beforeClaim: syncedRow });

    await syncWorkOrderHeaderToFortnox(WORK_ORDER_ID);

    expect(puttedOrder().YourOrderNumber).toBe('58184');
  });

  // ⚠️ En FAKTURERAD order tar inte emot ändringar — vägen svarar null i stället för att kasta, så
  // en rättad kontaktuppgift inte stämplar ett stängt dokument som 'failed'.
  //
  // 🧨 Men null får ALDRIG läsas som "synkat" av anroparen: routen svarar då med ett besked om att
  // ändringen stannade i CRM. Se app/api/crm/work-orders/[id]/route.ts (invoicedInFortnox).
  it('rör inte Fortnox på en fakturerad order — och säger det genom att svara null', async () => {
    installSupabaseMock({ beforeClaim: { ...syncedRow, status: 'invoiced', fortnox_invoice_number: '2026' } });

    const result = await syncWorkOrderHeaderToFortnox(WORK_ORDER_ID);

    expect(result).toBeNull();
    expect(fortnoxPut).not.toHaveBeenCalled();
  });

  // Samma tystnad, andra orsaken: ordern finns inte i Fortnox än. Create-vägen bär märkningen i
  // stället, så det här är rätt — men det är också varför racet ovan kunde vara osynligt.
  it('rör inte Fortnox när ordern ännu inte finns där', async () => {
    installSupabaseMock({ beforeClaim: { ...syncedRow, fortnox_order_number: null } });

    const result = await syncWorkOrderHeaderToFortnox(WORK_ORDER_ID);

    expect(result).toBeNull();
    expect(fortnoxPut).not.toHaveBeenCalled();
  });
});

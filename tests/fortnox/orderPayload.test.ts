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
import { pushWorkOrderToFortnox, syncWorkOrderHeaderToFortnox, updateWorkOrderInFortnox } from '@/lib/domains/fortnox/orders';

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
  /** Raden som efterkontrollen efter pushen ser — "någon sparade medan vi skrev till Fortnox". */
  afterPush?: Record<string, unknown>;
}) {
  // claimFortnoxPush vinner claimen på första försöket (update … .select('id') ger en rad).
  const workOrders = makeChain({ data: [{ id: WORK_ORDER_ID }], error: null });

  // Tre faser, så testet kan skilja på VAR i pushen en läsning sker:
  //   'before' — före claimen (idempotenskollen)
  //   'build'  — efter claimen (raden huvudet byggs ur)
  //   'after'  — efter POST:en (efterkontrollens maybeSingle, och synken den kan dra igång)
  let phase: 'before' | 'build' | 'after' = 'before';
  const rowFor = () => (
    phase === 'before' ? opts.beforeClaim
      : phase === 'build' ? (opts.afterClaim ?? opts.beforeClaim)
        : (opts.afterPush ?? opts.afterClaim ?? opts.beforeClaim)
  );

  // Claimen är det första update:t — därefter är pushen vår.
  workOrders.update = vi.fn(() => {
    if (phase === 'before') phase = 'build';
    return workOrders;
  });
  workOrders.single = vi.fn(async () => ({ data: rowFor(), error: null }));
  // Bara efterkontrollen läser arbetsordern med maybeSingle (linkedQuote går mot crm_quotes).
  workOrders.maybeSingle = vi.fn(async () => {
    phase = 'after';
    return { data: opts.afterPush ?? opts.afterClaim ?? opts.beforeClaim, error: null };
  });

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

  // ⚖️ TITELN SOM TEXTRAD. Fortnox har inget fält för projektnamnet, och `Remarks` går inte att
  // använda: det bär Ekovillas villkorstext och kopieras INTE av createinvoice (uppmätt 2026-09-16).
  // Raderna kopieras däremot exakt (order 161→faktura 2051), så textraden är enda vägen till både
  // orderbekräftelsen och fakturan.
  //
  // 🧨 Märkningen står KVAR i YourOrderNumber — den upprepas bara i raden. Flyttades den DIT skulle
  // kundens ekonomiavdelning tappa fältet de matchar fakturan mot sin beställning på.
  it('lägger titel och märkning som textrad, utan att röra YourOrderNumber', async () => {
    installSupabaseMock({ beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null }, afterClaim: baseRow });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    const order = postedOrder();
    // Referensfältet är ORÖRT — märkningen, inte titeln.
    expect(order.YourOrderNumber).toBe('58184');

    const rows = order.OrderRows as Array<Record<string, unknown>>;
    const note = rows[rows.length - 1];
    expect(note.Description).toBe('Projekt: Beställning från Ekovilla Lager  Märkning: 58184');
    // Textraden får inte bli en prissatt artikelrad.
    expect(note.Price).toBe(0);
    expect(note.ArticleNumber ?? null).toBeNull();
  });

  // Utan märkning ska raden bara bära titeln — ingen tom "Märkning: ".
  it('bär bara titeln när märkning saknas', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: { ...baseRow, customer_snapshot: { ...baseRow.customer_snapshot, label: null } },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    const rows = postedOrder().OrderRows as Array<Record<string, unknown>>;
    expect(rows[rows.length - 1].Description).toBe('Projekt: Beställning från Ekovilla Lager');
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

    expect(result.fortnox_order_number).toBe('131');
    expect(fortnoxPost).not.toHaveBeenCalled();
    // Inget claimades och ingen status rördes — svaret ska vara rent.
    expect(result.mirrorFailed).toBeUndefined();
  });

  // 🧨 DUBBELORDERN. Idempotenskollen görs på en SMAL läsning före claimen; hinner en samtidig push
  // slutföra sig mellan den och claimen ser vi numret först i omläsningen. Prövas den inte OM går
  // vi vidare till standalone-grenen och POST:ar en andra order åt samma kund — den grenen har
  // ingen dedup hos Fortnox (createorder skyddas åtminstone av 2000499).
  it('POSTar ingen andra order när en samtidig push hann skapa den', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: { ...baseRow, fortnox_order_number: '131' },
    });

    const result = await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(result.fortnox_order_number).toBe('131');
    expect(fortnoxPost).not.toHaveBeenCalled();
    // Inget claimades och ingen status rördes — svaret ska vara rent.
    // ⚠️ Claimen hann stämpla 'pending' och grenen skriver ner den till 'not_synced'. Svaras det
    // grönt läser brickan "Ej synkad" och faktureringen är spärrad utan att något förklarar varför.
    expect(result.mirrorFailed).toBe(true);
  });

  // ⚖️ VAKTEN MOT RACET. Huvudet byggs ur en rad som lästes innan Fortnox svarat, och fönstret fram
  // till POST:en är sekunder brett (kundnummer, byggmoms, ansvarig). Att flytta läsningen stänger
  // inte det — efterkontrollen gör det: skiljer raden sig efteråt speglas huvudet om.
  it('speglar om huvudet när märkningen sparades medan pushen pågick', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      // Huvudet byggdes utan märkning …
      afterClaim: { ...baseRow, customer_snapshot: { ...baseRow.customer_snapshot, label: null } },
      // … men när POST:en var klar fanns den i databasen. Ordern har nu sitt nummer, så
      // header-synken kan skriva den.
      afterPush: {
        ...baseRow,
        status: 'in_progress',
        fortnox_order_number: '131',
        fortnox_invoice_number: null,
        customer_snapshot: { ...baseRow.customer_snapshot, label: 'SPARAD-UNDER-PUSHEN' },
      },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    // POST:en hann aldrig få märkningen …
    expect('YourOrderNumber' in postedOrder()).toBe(false);
    // … men den efterföljande header-PUT:en bär den.
    expect(fortnoxPut).toHaveBeenCalled();
    expect(puttedOrder().YourOrderNumber).toBe('SPARAD-UNDER-PUSHEN');
  });

  // ⚠️ ALLA FYRA INGÅNGARNA till huvudet måste bevakas, inte bara snapshot + adress. `assigned_to`
  // bär OurReference, och en ansvarig som byts mitt i pushen går just den tysta vägen: PATCH:en ser
  // ingen order i Fortnox än och svarar null, pushen bär det gamla namnet.
  it('speglar om huvudet när ansvarig byttes medan pushen pågick', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: baseRow,
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        assigned_to: 'user-2',
      },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(fortnoxPut).toHaveBeenCalled();
  });

  // 🧨 ROT MÅSTE GÅ DEN FULLA PUSHEN, inte header-synken. Uppgifterna delar sig i två halvor på
  // dokumentet: en villas beteckning blir headerns YourOrderNumber, men en BOSTADSRÄTTS blir en
  // TEXTRAD — och header-synken släpper medvetet radhalvan. En BRF-order vars uppgifter rättades
  // mitt i pushen hade alltså "reparerats" med en PUT utan något ROT, och stämplats 'synced'.
  //
  // Att PUT:en bär OrderRows är alltså hela skillnaden mellan de två vägarna, och därför det testet
  // mäter — inte bara att någon PUT skedde.
  it('går den FULLA pushen när ROT-uppgifterna ändrades medan pushen pågick', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: baseRow,
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        rot_details: { enabled: true, brf_org_number: '769600-1234' },
      },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(fortnoxPut).toHaveBeenCalled();
    // Header-synken skickar `{ Order: header }` UTAN rader. Den fulla pushen bär dem.
    expect(puttedOrder()).toHaveProperty('OrderRows');
  });

  // 🧨 ARTIKLARNA. Artikelvägen (updateWorkOrderInFortnox) CLAIMAR INTE, och create sparar
  // ordernumret FÖRE radskrivningen — så en artikelredigering i fönstret hittar ett nummer, PUT:ar
  // sina nya rader och stämplar 'synced', varpå creates egen radskrivning lägger tillbaka de gamla
  // och stämplar 'synced' igen. Fortnox och CRM håller då olika rader utan att något säger ifrån,
  // och createinvoice fakturerar de gamla.
  it('går den fulla pushen när artiklarna redigerades medan pushen pågick', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: baseRow,
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        line_items: [
          { id: 'line-a', pricing_mode: 'item', unit_price: '100', quantity: '10' },
          { id: 'line-b', pricing_mode: 'item', unit_price: '250', quantity: '4' },
        ],
      },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(fortnoxPut).toHaveBeenCalled();
    // Raderna måste med — en header-PUT hade lämnat Fortnox med de gamla artiklarna.
    expect(puttedOrder()).toHaveProperty('OrderRows');
  });

  // 🧨 TITELN ÄR EN RAD. Den står bara i textraden `Projekt: X` — aldrig i huvudet — så en titel
  // som rättades mitt i pushen hade "reparerats" med en header-PUT som inte bär den, och ordern
  // stämplats 'synced' med den gamla titeln kvar på orderbekräftelsen och fakturan.
  it('går den fulla pushen när titeln ändrades medan pushen pågick', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: baseRow,
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        project_name: 'SPARAD-UNDER-PUSHEN',
      },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(fortnoxPut).toHaveBeenCalled();
    const rows = puttedOrder().OrderRows as Array<Record<string, unknown>>;
    expect(rows[rows.length - 1].Description).toBe('Projekt: SPARAD-UNDER-PUSHEN  Märkning: 58184');
  });

  // …men blanktecken runt titeln är ingen ändring — buildOrderProjectNote trimmar dem ändå, och en
  // spurios rad-PUT är den farligaste skrivningen i hela pushen.
  it('reparerar inte för en titel som bara skiljer i blanktecken', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: baseRow,
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        project_name: `  ${baseRow.project_name}  `,
      },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(fortnoxPut).not.toHaveBeenCalled();
  });

  // 🧨 ETT MISSLYCKAT REPARATIONSFÖRSÖK MÅSTE NÅ ANROPAREN. Reparationen har då redan stämplat ner
  // synkstatusen — men svarade pushen ändå "skapad" visade routen en grön toast medan brickan läste
  // Misslyckad och faktureringen var spärrad utan att något förklarade varför. Precis den tysta
  // framgång hela ändringen finns för att ta bort, en nivå upp.
  it('bär upp att omspeglingen misslyckades i stället för att svara rent', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: { ...baseRow, customer_snapshot: { ...baseRow.customer_snapshot, label: null } },
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        customer_snapshot: { ...baseRow.customer_snapshot, label: 'SPARAD-UNDER-PUSHEN' },
      },
    });
    // Skapandet (POST) går igenom; det är den efterföljande reparations-PUT:en som faller.
    vi.mocked(fortnoxPut).mockRejectedValue(new Error('Fortnox 400') as never);

    const result = await pushWorkOrderToFortnox(WORK_ORDER_ID);

    // Ordern ÄR skapad — numret bärs tillbaka som vanligt (Fortnox svarar med ett tal; kolumnen
    // är text, så jämförelsen görs på strängen).
    expect(String(result.fortnox_order_number)).toBe('131');
    expect(result.mirrorFailed).toBe(true);
  });

  // ⚠️ `rot_percent` och `max_deduction` når ALDRIG Fortnox (se ROT_DOCUMENT_KEYS) — de läses bara
  // av vår egen preliminära "Att betala". En rättad procentsats mitt i pushen får därför inte dra
  // igång en full positionsbaserad rad-PUT för en ändring dokumentet inte ens har.
  it('reparerar inte för ROT-fält som aldrig når dokumentet', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: { ...baseRow, rot_details: { enabled: false, rot_percent: 30 } },
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        // Bara procenten och maxavdraget skiljer — dokumentet ser ingen skillnad.
        rot_details: { enabled: false, rot_percent: 50, max_deduction: 75000 },
      },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(fortnoxPut).not.toHaveBeenCalled();
  });

  // ⚠️ `customer_snapshot` bär telefon, e-post och slutkundens uppgifter — INGET av det når
  // Fortnox. Jämfördes hela kolumnen blev en rättad telefon på arbetsplatsen en "ändring", med en
  // header-PUT som kunde stämpla 'failed' och spärra faktureringen för ett fält dokumentet aldrig
  // burit. Se MIRRORED_SNAPSHOT_KEYS.
  it('reparerar inte för snapshot-fält som aldrig når dokumentet', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: baseRow,
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        customer_snapshot: {
          ...baseRow.customer_snapshot,
          // Bara sådant som stannar i CRM.
          phone: '070-000 00 00',
          email: 'ny@c24bygg.se',
          end_contact_name: 'Platschefen',
        },
      },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(fortnoxPut).not.toHaveBeenCalled();
  });

  // 🧨 EN RENSNING GÅR INTE ATT UTTRYCKA. buildOrderHeader utelämnar tomma värden och en Fortnox-PUT
  // rör bara fält den bär — så en tömd "Er referens" upptäcks, PUT:en går igenom, och Fortnox
  // behåller ändå sitt gamla värde. Rapporterades det som framgång bar kundens dokument kvar en
  // person som inte längre står på ordern, utan att något sa ifrån.
  it('rapporterar inte framgång för en rensning Fortnox behåller', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: baseRow,
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        // Er referens TÖMD medan pushen pågick (contact_name saknas, så fallbacken räddar inget).
        customer_snapshot: { ...baseRow.customer_snapshot, your_reference: null },
      },
    });

    const result = await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(fortnoxPut).toHaveBeenCalled();
    expect(result.mirrorFailed).toBe(true);
    // 🧨 FLAGGAN MÅSTE NÅ ANROPAREN. Droppades den i destruktureringen blev hela
    // "rätta fältet direkt i Fortnox"-grenen i routerna död kod, och säljaren fick rådet
    // "synka om" — som aldrig kan uttrycka en rensning.
    expect(result.mirrorNeedsManualFix).toBe(true);
  });

  // ⚠️ Tom sträng, blanktecken och null är SAMMA tomhet. En sparning som skriver '' där raden höll
  // null får inte kosta en header-PUT direkt efter att ordern stämplats 'synced' — en sådan PUT som
  // misslyckas stämplar 'failed' och spärrar faktureringen.
  it('reparerar inte för tom sträng där raden höll null', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: { ...baseRow, customer_snapshot: { ...baseRow.customer_snapshot, delivery_address: null } },
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        customer_snapshot: { ...baseRow.customer_snapshot, delivery_address: '   ' },
      },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(fortnoxPut).not.toHaveBeenCalled();
  });

  // 🧨 En TÖMD ARBETSADRESS går inte att uttrycka: buildOrderDeliveryFields returnerar {} och
  // PUT:en utelämnar DeliveryAddress1, så Fortnox behåller den gamla arbetsplatsen. Mäts genom att
  // bygga fältet före och efter — inte genom att gissa på kolumnen.
  it('rapporterar inte framgång när arbetsadressen tömdes under pushen', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: { ...baseRow, work_address: { street_address: 'Nygatan 3', postal_code: '81140', city: 'Sandviken' } },
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        work_address: { street_address: null, postal_code: null, city: null },
      },
    });

    const result = await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(result.mirrorFailed).toBe(true);
  });

  // 🧨 EN DELVIS RENSNING räknas också. Rensas bara ORTEN utelämnas DeliveryCity medan gata och
  // postnummer skickas — Fortnox behåller sin gamla ort och dokumentet får en halv adress från två
  // olika platser. Ett villkor på "blev hela blocket tomt" missar det.
  it('flaggar även när bara en del av arbetsadressen rensades', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: { ...baseRow, work_address: { street_address: 'Nygatan 3', postal_code: '81140', city: 'Sandviken' } },
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        work_address: { street_address: 'Nygatan 3', postal_code: '81140', city: null },
      },
    });

    const result = await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(result.mirrorNeedsManualFix).toBe(true);
  });

  // ⚠️ `include_in_description` styr bara VÅR arbetsbeskrivning — Fortnox ser den aldrig. En
  // ÖVRIGT-bock mitt i pushen får inte kosta en full positionsbaserad rad-PUT, den farligaste
  // skrivningen i filen.
  it('reparerar inte för radfält som stannar i CRM', async () => {
    const rows = (extra: Record<string, unknown>) => [{ id: 'line-a', pricing_mode: 'item', unit_price: '100', quantity: '10', ...extra }];
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: { ...baseRow, line_items: rows({ include_in_description: false }) },
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        line_items: rows({ include_in_description: true }),
      },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(fortnoxPut).not.toHaveBeenCalled();
  });

  // 🧨 `null` FRÅN HEADER-SYNKEN BETYDER ATT INGENTING SKICKADES — här för att ordern hann
  // faktureras (och stängas) medan pushen pågick. Läses "kastade inte" som framgång blir just de
  // fallen tysta: ändringen finns i CRM, Fortnox vet inget, och svaret är grönt.
  it('rapporterar inte framgång när header-synken inte skickade något', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: { ...baseRow, customer_snapshot: { ...baseRow.customer_snapshot, label: null } },
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        // Ordern hann helfaktureras → header-synken svarar null utan att skicka något.
        status: 'invoiced',
        fortnox_invoice_number: '2026',
        partial_invoicing_started_at: null,
        customer_snapshot: { ...baseRow.customer_snapshot, label: 'SPARAD-UNDER-PUSHEN' },
      },
    });

    const result = await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(fortnoxPut).not.toHaveBeenCalled();
    expect(result.mirrorFailed).toBe(true);
  });

  // …och ingen extra skrivning när ingenting ändrades. Annars hade varje orderskapande kostat en
  // PUT i onödan, på den enda väg som saknar dedup-skydd.
  it('speglar inte om huvudet när raden är oförändrad', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: baseRow,
      // ⚠️ SAMMA TRE RADER SOM TESTERNA OVAN, av samma skäl: utan ordernummer och öppen status
      // svarar header-synken null före varje PUT, och testet hade varit grönt vad efterkontrollen
      // än beslutade. Mutationsprövat — `if (false) return;` i vakten fäller det nu.
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
      },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(postedOrder().YourOrderNumber).toBe('58184');
    expect(fortnoxPut).not.toHaveBeenCalled();
  });

  // 🧨 `label_cleared` ÄR INTE KUNDDATA — det är synkens eget minne, och `clearReferenceMemory`
  // flippar det mitt i pushen. Räknades det som en ändring hade VARJE orderskapande på
  // offert→order-vägen kostat en onödig header-PUT, och en PUT som misslyckades hade stämplat
  // 'failed' över det 'synced' som skrevs ögonblicket innan.
  //
  // Samma sak för nyckelordningen: jsonb kommer tillbaka i sin ordning, en merge i sin.
  it('speglar inte om huvudet för synkens eget minne eller en omkastad nyckelordning', async () => {
    installSupabaseMock({
      beforeClaim: { id: WORK_ORDER_ID, fortnox_order_number: null },
      afterClaim: baseRow,
      afterPush: {
        ...baseRow,
        // ⚠️ Ordern MÅSTE bära sitt nummer och vara öppen här, annars svarar header-synken null och
        // testet hade varit grönt vad efterkontrollen än beslutade — alltså bevisat ingenting.
        // (Mutationsprövat: utan de här tre raderna överlever en borttagen label_cleared-filtrering.)
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        customer_snapshot: {
          // Andra nyckelordning, plus ett flippat label_cleared. Samma kunddata.
          city: 'Sandviken',
          label: '58184',
          label_cleared: true,
          postal_code: '81140',
          reverse_vat: false,
          street_address: 'Stallgatan 18',
          your_reference: 'Per Linderdahl',
        },
      },
    });

    await pushWorkOrderToFortnox(WORK_ORDER_ID);

    expect(fortnoxPut).not.toHaveBeenCalled();
  });
});

// Omsynkvägen — samma race som create, på den väg efterkontrollen först inte täckte.
describe('updateWorkOrderInFortnox — efterkontrollen på omsynken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fortnoxPut).mockResolvedValue({} as never);
  });

  // 🧨 Raden läses före PUT:en, och mellan dem ligger radbygget och hela Fortnox-anropet. En
  // översiktssparning som landar där skrivs till databasen medan PUT:en lägger tillbaka det GAMLA
  // huvudet — och stämplar 'synced'. Exakt felet på order 131, en väg bort.
  it('upptäcker en sparning som landade mitt i omsynken', async () => {
    installSupabaseMock({
      beforeClaim: { ...baseRow, fortnox_order_number: '131', status: 'in_progress', fortnox_invoice_number: null },
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        customer_snapshot: { ...baseRow.customer_snapshot, label: 'SPARAD-UNDER-OMSYNKEN' },
      },
    });

    const result = await updateWorkOrderInFortnox(WORK_ORDER_ID);

    expect(result.fortnox_order_number).toBe('131');
    // Reparationen körde och bar den nya märkningen.
    expect(vi.mocked(fortnoxPut).mock.calls.length).toBeGreaterThan(1);
  });

  // ⚠️ Efterkontrollen anropar SJÄLV den här vägen när raderna skiljer sig. Utan spärren blir det
  // en rekursion: push → kontroll → push → kontroll.
  // 🧨 REKURSIONEN. Efterkontrollen anropar SJÄLV den här vägen när raderna skiljer sig, och utan
  // spärren blir det push → kontroll → push → kontroll. Mocken ger ett nytt värde per läsning, så
  // en rekursion skulle synas som en växande kedja av PUT:ar i stället för de två som ska ske.
  it('loopar inte när efterkontrollen själv går den fulla pushen', async () => {
    let read = 0;
    const workOrders = makeChain({ data: [{ id: WORK_ORDER_ID }], error: null });
    const row = (label: string, rows: unknown) => ({
      ...baseRow, fortnox_order_number: '131', status: 'in_progress', fortnox_invoice_number: null,
      customer_snapshot: { ...baseRow.customer_snapshot, label }, line_items: rows,
    });
    const altRows = [{ id: 'line-a', pricing_mode: 'item', unit_price: '999', quantity: '1' }];
    workOrders.single = vi.fn(async () => ({ data: row('START', baseRow.line_items), error: null }));
    // Varje efterkontroll ser BÅDE nytt label och nya rader → rowsDiffer → full push igen.
    workOrders.maybeSingle = vi.fn(async () => {
      read += 1;
      return { data: row(`ÄNDRAD-${read}`, read <= 3 ? altRows : baseRow.line_items), error: null };
    });
    const customers = makeChain({ data: { fortnox_customer_id: '55' }, error: null });
    const profiles = makeChain({ data: { full_name: 'Anna Andersson' }, error: null });
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: vi.fn((t: string) => (t === 'crm_customers' ? customers : t === 'profiles' ? profiles : workOrders)),
    } as unknown as ReturnType<typeof getSupabaseAdmin>);

    await updateWorkOrderInFortnox(WORK_ORDER_ID);

    // Den egna PUT:en + EN reparationsrunda. Utan spärren kedjas de vidare.
    expect(vi.mocked(fortnoxPut).mock.calls.length).toBe(2);
  });

  it('kör ingen efterkontroll när den anropas FRÅN efterkontrollen', async () => {
    installSupabaseMock({
      beforeClaim: { ...baseRow, fortnox_order_number: '131', status: 'in_progress', fortnox_invoice_number: null },
      afterPush: {
        ...baseRow,
        fortnox_order_number: '131',
        status: 'in_progress',
        fortnox_invoice_number: null,
        customer_snapshot: { ...baseRow.customer_snapshot, label: 'ÄNDRAD' },
      },
    });

    await updateWorkOrderInFortnox(WORK_ORDER_ID, { recheckAfterPush: false });

    // Exakt EN PUT — ingen reparationsrunda.
    expect(vi.mocked(fortnoxPut).mock.calls.length).toBe(1);
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

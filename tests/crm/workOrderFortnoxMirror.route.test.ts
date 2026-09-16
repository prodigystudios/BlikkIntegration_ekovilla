import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, effectivePermissionsForRole } from './helpers/supabase';

// Speglingen av en redigerad arbetsorder mot Fortnox — och framför allt vad routen SÄGER när den
// inte gick fram.
//
// 🧨 Buggen filen föddes ur: `syncWorkOrderHeaderToFortnox` svarar `null` (inte ett fel) på ett
// fakturerat dokument, och routen läste det som "inget att rapportera". Svaret bar då
// `fortnox_error: null`, klienten visade grön "Arbetsorder sparad", och en märkning som aldrig
// nådde kundens order eller faktura såg sparad-och-synkad ut. Mätt i drift på Fortnox-order 131.
//
// Det som prövas här är alltså inte att synken fungerar — det gör tests/fortnox/orderPayload.test.ts
// — utan att TYSTNADEN är borta. Sparningen ska fortfarande landa; det är beskedet som ändrats.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

// ⚠️ `mergeWorkOrderSnapshotOverrides` behålls ÄKTA med flit. Det är regeln som avgör vad som
// faktiskt hamnar i snapshoten (och som armerar `label_cleared`); en mockad kopia hade gjort
// testet blint för just den sömmen.
vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return {
    ...actual,
    getCrmWorkOrder: vi.fn(),
    updateCrmWorkOrder: vi.fn(),
    listWorkOrderInvoiceRounds: vi.fn(),
    saveWorkOrderLineItems: vi.fn(),
  };
});

vi.mock('@/lib/domains/fortnox/orders', () => ({
  syncWorkOrderHeaderToFortnox: vi.fn(),
  updateWorkOrderInFortnox: vi.fn(),
}));

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { getCrmWorkOrder, updateCrmWorkOrder, saveWorkOrderLineItems } from '@/lib/domains/crm/work-orders';
import { syncWorkOrderHeaderToFortnox, updateWorkOrderInFortnox } from '@/lib/domains/fortnox/orders';

const { PATCH } = await import('@/app/api/crm/work-orders/[id]/route');
const { POST: pushPOST } = await import('@/app/api/crm/work-orders/[id]/fortnox/route');
const { PATCH: lineItemsPATCH } = await import('@/app/api/crm/work-orders/[id]/line-items/route');

const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const ctx = { params: { id: WORK_ORDER_ID } };

// En företagsorder som ligger i Fortnox. `invoiced`-fälten sätts per test.
const openOrder = {
  id: WORK_ORDER_ID,
  status: 'in_progress',
  quote_type: 'business',
  customer_snapshot: { label: 'GAMMAL', your_reference: 'Per Linderdahl' },
  // Nyckelordningen är PostgREST:s, inte Zod:s — se testet om oförändrade fält.
  work_address: { city: 'Sandviken', postal_code: '81140', street_address: 'Stallgatan 18' },
  rot_details: {},
  fortnox_order_number: '131',
  fortnox_invoice_number: null as string | null,
};

// ⚠️ `status` är OBLIGATORISKT i updateCrmWorkOrderSchema — klienten skickar alltid orderns
// nuvarande status vid varje sparning, och routen läser ett oförändrat värde som en no-op. Utan
// det faller varje PATCH på 400 och testet mäter valideringen i stället för speglingen.
function patchReq(payload: Record<string, unknown>) {
  return new Request(`http://localhost/api/crm/work-orders/${WORK_ORDER_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function install(current: Record<string, unknown>) {
  vi.mocked(getCrmWorkOrder).mockResolvedValue({ data: current, error: null } as never);
  vi.mocked(updateCrmWorkOrder).mockResolvedValue({ data: current, error: null } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(salesUser as never);
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole(salesUser.role));
  vi.mocked(syncWorkOrderHeaderToFortnox).mockResolvedValue({ fortnox_order_number: '131' } as never);
  vi.mocked(updateWorkOrderInFortnox).mockResolvedValue({ fortnox_order_number: '131' } as never);
});

describe('PATCH arbetsorder — speglingen mot Fortnox', () => {
  // ⚖️ KÄRNAN. En fakturerad order tar inte emot ändringar, och det ska SÄGAS — inte sväljas.
  it('säger ifrån när märkningen ändras på en fakturerad order', async () => {
    install({ ...openOrder, status: 'invoiced', fortnox_invoice_number: '2026' });

    const res = await PATCH(patchReq({ status: 'invoiced', label: '58184' }), ctx);
    const json = await res.json();

    // Sparningen landar som förut …
    expect(res.status).toBe(200);
    // … men svaret får inte låtsas att ändringen nådde Fortnox.
    expect(json.data.fortnox_error).toBeTruthy();
    expect(String(json.data.fortnox_error)).toContain('fakturerad');
    // Och ingen skrivning ska ens försökas — Fortnox avvisar den ändå.
    expect(syncWorkOrderHeaderToFortnox).not.toHaveBeenCalled();
    expect(updateWorkOrderInFortnox).not.toHaveBeenCalled();
  });

  // Samma sak när fakturanumret finns men statusen inte hunnit bli 'invoiced' — det är
  // `fortnox_invoice_number` som stänger dokumentet hos Fortnox, inte vår egen statuskolumn.
  it('säger ifrån även när bara fakturanumret är satt', async () => {
    install({ ...openOrder, status: 'completed', fortnox_invoice_number: '2026' });

    const json = await (await PATCH(patchReq({ status: 'completed', label: '58184' }), ctx)).json();

    expect(json.data.fortnox_error).toBeTruthy();
    expect(syncWorkOrderHeaderToFortnox).not.toHaveBeenCalled();
  });

  // Grinden får inte slå till på en ÖPPEN order — då vore märkningen omöjlig att spegla alls.
  it('speglar märkningen som vanligt på en öppen order', async () => {
    install(openOrder);

    const json = await (await PATCH(patchReq({ status: 'in_progress', label: '58184' }), ctx)).json();

    expect(syncWorkOrderHeaderToFortnox).toHaveBeenCalledWith(WORK_ORDER_ID);
    expect(json.data.fortnox_error).toBeNull();
  });

  // ⚠️ Och inte på en sparning som inte rör ett speglat fält. Annars hade varje statusändring på
  // en fakturerad order larmat om en synk som aldrig var aktuell.
  it('larmar inte när sparningen inte rör något Fortnox speglar', async () => {
    install({ ...openOrder, status: 'completed', fortnox_invoice_number: '2026' });

    const json = await (await PATCH(patchReq({ status: 'completed' }), ctx)).json();

    expect(json.data.fortnox_error).toBeNull();
    expect(syncWorkOrderHeaderToFortnox).not.toHaveBeenCalled();
  });

  // 🧨 GAPET MELLAN LARMET OCH PUSHEN. En DELfakturerad order är öppen hos Fortnox, så den ska
  // PUSHAS — inte larmas om. Med det gamla stängd-testet (`!fortnox_invoice_number`) föll den
  // mellan stolarna: invoicedInFortnox falskt (inget larm) OCH rotPush falskt (ingen push), så ett
  // rättat BRF org.nr sparades, rapporterades grönt och nådde aldrig ROT-textraden i Fortnox.
  it('pushar ROT-ändringen på en DELfakturerad order i stället för att tiga', async () => {
    install({
      ...openOrder,
      status: 'invoiced',
      fortnox_invoice_number: '2026',
      partial_invoicing_started_at: '2026-09-10T08:06:00Z',
      quote_type: 'private',
      rot_details: { enabled: true, brf_org_number: '769600-0000' },
    });

    const json = await (await PATCH(patchReq({
      status: 'invoiced',
      rot_details: { brf_org_number: '769600-1234' },
    }), ctx)).json();

    expect(updateWorkOrderInFortnox).toHaveBeenCalledWith(WORK_ORDER_ID);
    expect(json.data.fortnox_error).toBeNull();
  });

  // 🧨 ROT-GRENEN ÄR FJÄRDE ANROPAREN av updateWorkOrderInFortnox. Kastas svaret bort stämplas
  // raden 'failed' av en misslyckad omspegling medan routen svarar grönt — och faktureringen är
  // spärrad av assertOrderRowsSynced utan att något förklarar varför.
  //
  // ⚠️ Den här fixen rapporterades en gång som gjord utan att ha applicerats (fel indentering i
  // sökmönstret), och INGET test fångade det. Därför finns testet.
  it('bär upp mirrorFailed från ROT-pushen', async () => {
    install({ ...openOrder, quote_type: 'private', rot_details: { enabled: true, property_designation: 'Gläntan 1:14' } });
    vi.mocked(updateWorkOrderInFortnox).mockResolvedValue(
      { fortnox_order_number: '131', mirrorFailed: true } as never);

    const json = await (await PATCH(patchReq({
      status: 'in_progress',
      rot_details: { property_designation: 'Haggården 6:3' },
    }), ctx)).json();

    expect(updateWorkOrderInFortnox).toHaveBeenCalled();
    expect(json.data.fortnox_error).toBeTruthy();
  });

  // 🧨 En RENSNING kan header-synken inte uttrycka: buildOrderHeader utelämnar tomma värden, så
  // PUT:en lyckas medan Fortnox behåller sitt gamla värde. Rådet måste bli "rätta i Fortnox",
  // aldrig "synka om" — det senare rapporterar framgång lika tyst andra gången.
  it('säger att en tömd Er referens måste rättas i Fortnox', async () => {
    install(openOrder);

    const json = await (await PATCH(patchReq({
      status: 'in_progress',
      your_reference: null,
    }), ctx)).json();

    expect(syncWorkOrderHeaderToFortnox).toHaveBeenCalled();
    expect(String(json.data.fortnox_error)).toContain('direkt i Fortnox');
  });

  // 🧨 NÄRVARO ÄR INTE ÄNDRING. Ordervyn skickar `your_reference` vid VARJE sparning (och `label`
  // på varje företagsorder), så ett larm som gick på närvaro hade gett "nådde inte Fortnox" varje
  // gång någon rättade en anteckning på en fakturerad order — ett rött larm om ingenting.
  it('larmar inte när de speglade fälten skickas OFÖRÄNDRADE', async () => {
    install({ ...openOrder, status: 'invoiced', fortnox_invoice_number: '2026' });

    const json = await (await PATCH(patchReq({
      status: 'invoiced',
      // Exakt det som redan står i snapshoten — klienten skickar alltid med dem.
      your_reference: 'Per Linderdahl',
      label: 'GAMMAL',
      // 🧨 ADRESSEN SKICKAS ALLTID, och kommer tillbaka ur jsonb i en ANNAN nyckelordning än den
      // Zod bygger. En JSON.stringify-jämförelse är därför alltid "olika" — larmet gick på varje
      // sparning tills jämförelsen blev fält-för-fält. Nyckelordningen här är den riktiga radens.
      work_address: { street_address: 'Stallgatan 18', postal_code: '81140', city: 'Sandviken' },
      notes: 'en rättad anteckning',
    }), ctx)).json();

    expect(json.data.fortnox_error).toBeNull();
  });

  // 🧨 ROT-fälten står INTE i FORTNOX_MIRRORED_FIELDS — de går den fulla pushen, inte header-vägen.
  // En rättad fastighetsbeteckning ÄR villaorderns "Ert referensnummer", så utan att `rotChanged`
  // räknas med hade just den ändringen hoppat över hela blocket och rapporterats som ren framgång.
  it('säger ifrån när fastighetsbeteckningen ändras på en fakturerad order', async () => {
    install({
      ...openOrder,
      status: 'invoiced',
      fortnox_invoice_number: '2026',
      quote_type: 'private',
      rot_details: { enabled: true, property_designation: 'Gläntan 1:14' },
    });

    const json = await (await PATCH(patchReq({
      status: 'invoiced',
      rot_details: { property_designation: 'Haggården 6:3' },
    }), ctx)).json();

    expect(json.data.fortnox_error).toBeTruthy();
    expect(updateWorkOrderInFortnox).not.toHaveBeenCalled();
  });
});

// "Synka om" / "Försök igen" — den manuella pushen.
describe('POST arbetsorder/fortnox — omsynken', () => {
  // 🧨 SPÄRREN MÅSTE STÅ I ROUTEN, inte bara i ordervyn.
  //
  // Fortnox avvisar varje skrivning mot ett fakturerat dokument, så updateWorkOrderInFortnox kastar
  // och stämplar 'failed' — en order som stod 'synced' degraderas av ett anrop som aldrig kunde
  // lyckas, och en kvarstående 'failed' spärrar faktureringen via assertOrderRowsSynced.
  //
  // Knappen är dold i klienten (fortnoxClosed), men en flik som stod öppen när ordern fakturerades
  // någon annanstans har den kvar — och routen är nåbar direkt för var och en med
  // fortnox.workorder.push. Mätt i drift på order 131.
  it('nekar omsynk av en fakturerad order i stället för att stämpla den failed', async () => {
    install({ ...openOrder, status: 'invoiced', fortnox_invoice_number: '2026' });

    const res = await pushPOST(new Request('http://localhost/x', { method: 'POST' }), ctx);

    expect(res.status).toBe(409);
    expect(updateWorkOrderInFortnox).not.toHaveBeenCalled();
  });

  // 🧨 FAIL-CLOSED. Sväljs ett läsfel går omsynken vidare mot en order vi inte vet något om — är
  // den fakturerad stämplas den 'failed' av ett anrop som aldrig kunde lyckas, och med knappen nu
  // dold finns ingenting som förklarar var statusen kom ifrån. PATCH-vägen failar stängt på samma
  // läsning; den här gjorde det inte.
  it('failar STÄNGT när arbetsordern inte går att läsa', async () => {
    vi.mocked(getCrmWorkOrder).mockResolvedValue(
      { data: null, error: { message: 'timeout', code: '57014' } } as never);

    const res = await pushPOST(new Request('http://localhost/x', { method: 'POST' }), ctx);

    expect(res.status).toBe(503);
    expect(updateWorkOrderInFortnox).not.toHaveBeenCalled();
  });

  // 🧨 DELFAKTURERAD ÄR INTE STÄNGD. Model B POSTar fristående fakturor och rör aldrig
  // createinvoice, så Fortnox-ordern är öppen — men slutrundan sätter ändå fortnox_invoice_number.
  // Spärrade vi på det hade en delfakturerad order som fastnat på 'failed' blivit omöjlig att
  // reparera, och createPartialInvoice gatar medvetet INTE på synkstatusen.
  it('tillåter omsynk av en DELfakturerad order trots fakturanumret', async () => {
    install({
      ...openOrder,
      status: 'invoiced',
      fortnox_invoice_number: '2026',
      partial_invoicing_started_at: '2026-09-10T08:06:00Z',
    });

    const res = await pushPOST(new Request('http://localhost/x', { method: 'POST' }), ctx);

    expect(res.status).toBe(200);
    expect(updateWorkOrderInFortnox).toHaveBeenCalledWith(WORK_ORDER_ID);
  });

  // 🧨 Omsynken av en aldrig pushad order faller tillbaka på create, som kan svara `mirrorFailed`
  // — en sparning landade mitt i pushen och gick inte att spegla om. Kastades det bort svarade
  // routen `fortnox_error: null` (grön "synkad") medan raden den returnerar läser Misslyckad.
  it('bär upp mirrorFailed i stället för att svara rent', async () => {
    install(openOrder);
    vi.mocked(updateWorkOrderInFortnox).mockResolvedValue(
      { fortnox_order_number: '131', mirrorFailed: true } as never);

    const json = await (await pushPOST(new Request('http://localhost/x', { method: 'POST' }), ctx)).json();

    expect(json.data.fortnox_error).toBeTruthy();
  });

  // Och en ÖPPEN order ska fortfarande gå att synka om — spärren får inte ta knappen ifrån oss.
  it('synkar om en öppen order som vanligt', async () => {
    install(openOrder);

    const res = await pushPOST(new Request('http://localhost/x', { method: 'POST' }), ctx);

    expect(res.status).toBe(200);
    expect(updateWorkOrderInFortnox).toHaveBeenCalledWith(WORK_ORDER_ID);
  });
});


// Artikelvägen — den TREDJE anroparen av updateWorkOrderInFortnox.
describe('PATCH arbetsorder/line-items — speglingen', () => {
  // 🧨 Samma tysta framgång som offert- och omsynkvägen redan rättat: `mirrorFailed` når hit via
  // create-fallbacken (en order som aldrig pushats). Kastas resultatet bort svarar routen
  // `fortnox_error: null` på en order pushen just stämplat 'failed' — och den statusen spärrar
  // faktureringen via assertOrderRowsSynced, utan att något förklarar varför.
  it('bär upp mirrorFailed i stället för att svara rent', async () => {
    vi.mocked(saveWorkOrderLineItems).mockResolvedValue({ data: openOrder, error: null } as never);
    vi.mocked(getCrmWorkOrder).mockResolvedValue({ data: openOrder, error: null } as never);
    vi.mocked(updateWorkOrderInFortnox).mockResolvedValue(
      { fortnox_order_number: '131', mirrorFailed: true } as never);

    const req = new Request(`http://localhost/x`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ line_items: [] }),
    });
    const json = await (await lineItemsPATCH(req, ctx)).json();

    expect(json.data.fortnox_error).toBeTruthy();
  });
});

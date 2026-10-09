import { describe, it, expect, vi, beforeEach } from 'vitest';

// Kundbyte på en offert som redan finns i Fortnox.
//
// 🧨 Felet (rapporterat 2026-10-09, reproducerat i testbolaget, offert 65/66): offerten skapades på
// kund A, säljaren bytte till kund B i CRM. PUT:en skickade B:s kundnummer — och Fortnox bytte
// numret, men behöll A:s namn, adress, org.nr, telefon, e-post och betalningsvillkor. I Fortnox såg
// offerten alltså ut att fortfarande gälla A, och `createorder` förde det vidare till ordern.

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

vi.mock('@/lib/domains/fortnox/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/client')>();
  return { ...actual, fortnoxGet: vi.fn(), fortnoxPost: vi.fn(), fortnoxPut: vi.fn() };
});

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxGet, fortnoxPut } from '@/lib/domains/fortnox/client';
import { offerCustomerFieldsFromCard, pushQuoteToFortnox } from '@/lib/domains/fortnox/offers';

const cardB = {
  CustomerNumber: '2',
  Name: 'johansons bygg ab',
  Address1: 'byggvägen 32',
  Address2: null,
  ZipCode: '15160',
  City: 'södertälje',
  Country: 'Sverige',
  OrganisationNumber: '556103-4249',
  Phone1: '0843232421',
  Phone2: null,
  Email: '',
  EmailOffer: '',
  EmailOfferCC: '',
  EmailOfferBCC: '',
  TermsOfPayment: '30',
  YourReference: '',
  OurReference: '',
  DeliveryName: null,
  DeliveryAddress1: null,
  DeliveryAddress2: null,
  DeliveryZipCode: null,
  DeliveryCity: null,
  DeliveryCountry: null,
};

describe('offerCustomerFieldsFromCard', () => {
  it('ger kortets kunddel med Fortnox exakta fältnamn', () => {
    expect(offerCustomerFieldsFromCard(cardB)).toMatchObject({
      CustomerName: 'johansons bygg ab',
      Address1: 'byggvägen 32',
      ZipCode: '15160',
      City: 'södertälje',
      Country: 'Sverige',
      OrganisationNumber: '556103-4249',
      Phone1: '0843232421',
      TermsOfPayment: '30',
    });
  });

  // `''` lämnar det gamla värdet kvar på dokumentet (mätt) — den förra kundens uppgifter hade stått kvar.
  it('tomt på kortet blir null, aldrig tom sträng', () => {
    const fields = offerCustomerFieldsFromCard({ Name: 'ali husein', Address1: '', City: '   ', Phone1: null, TermsOfPayment: '' });
    expect(fields.Address1).toBeNull();
    expect(fields.City).toBeNull();
    expect(fields.Phone1).toBeNull();
    expect(fields.TermsOfPayment).toBeNull();
    expect(fields.DeliveryAddress1).toBeNull();
    expect(fields.YourReference).toBeNull();
    expect(Object.values(fields)).not.toContain('');
  });

  // `null` nekas (2005095) och `''` rensar inte — utan blanksteget stod förra kundens personnummer kvar.
  it('ett tomt org.nr skickas som blanksteg', () => {
    expect(offerCustomerFieldsFromCard({ Name: 'ali husein', OrganisationNumber: '' }).OrganisationNumber).toBe(' ');
    expect(offerCustomerFieldsFromCard({ Name: 'ali husein', OrganisationNumber: null }).OrganisationNumber).toBe(' ');
  });

  it('offertens e-post: kortets offertadress, annars den allmänna; kopiorna rensas när kortet saknar dem', () => {
    expect(offerCustomerFieldsFromCard({ Email: 'a@x.se', EmailOffer: 'offert@x.se' }).EmailInformation)
      .toEqual({ EmailAddressTo: 'offert@x.se', EmailAddressCC: null, EmailAddressBCC: null });
    expect(offerCustomerFieldsFromCard({ Email: 'a@x.se', EmailOffer: '' }).EmailInformation.EmailAddressTo).toBe('a@x.se');
    expect(offerCustomerFieldsFromCard({ Email: '', EmailOffer: '' }).EmailInformation.EmailAddressTo).toBeNull();
  });

  // Fortnox kräver ett namn; ett kort utan namn ska inte tömma dokumentets.
  it('utelämnar CustomerName när kortet saknar namn', () => {
    expect(offerCustomerFieldsFromCard({ Name: '' })).not.toHaveProperty('CustomerName');
  });

  // Gata från offerten och ort från kortet = en adress som inte finns. Hela blocket är offertens.
  it('med egen arbetsadress på offerten rensas kortets hela leveransblock', () => {
    const card = { ...cardB, DeliveryName: 'Lagret', DeliveryAddress1: 'Lagervägen 1', DeliveryZipCode: '15160', DeliveryCity: 'Södertälje' };
    expect(offerCustomerFieldsFromCard(card, { ownJobSite: true })).toMatchObject({
      DeliveryName: null, DeliveryAddress1: null, DeliveryAddress2: null, DeliveryZipCode: null, DeliveryCity: null, DeliveryCountry: null,
    });
    // Utan egen arbetsadress: kortets, som när Fortnox skapar offerten (mätt, offert 77).
    expect(offerCustomerFieldsFromCard(card)).toMatchObject({ DeliveryName: 'Lagret', DeliveryAddress1: 'Lagervägen 1', DeliveryCity: 'Södertälje' });
  });

  // Raderna bär egna priser — ett prislistebyte kunde räkna om dem.
  it('skickar varken prislista, valuta eller språk', () => {
    const fields = offerCustomerFieldsFromCard({ ...cardB, PriceList: '160', Currency: 'EUR' } as never);
    expect(fields).not.toHaveProperty('PriceList');
    expect(fields).not.toHaveProperty('Currency');
    expect(fields).not.toHaveProperty('Language');
  });
});

describe('pushQuoteToFortnox — kundbyte på en befintlig offert', () => {
  const quoteRow = {
    id: 'quote-1',
    project_name: 'Vindsisolering',
    description: null,
    amount: 1000,
    vat_percent: 25,
    quote_date: '2026-10-09',
    valid_until: '2026-11-08',
    notes: null,
    customer_id: 'cust-b',
    customer_name: 'johansons bygg ab',
    customer_source: { kind: 'fortnox', fortnox_customer_id: '2' },
    customer_snapshot: {
      reverse_vat: false,
      contact_name: 'Per Johansson',
      delivery_address: 'Arbetsvägen 7',
      delivery_postal_code: '15200',
      delivery_city: 'Strängnäs',
    },
    assigned_to: null,
    rot_details: null,
    line_items: [{ pricing_mode: 'item', article_name: 'Lösull', unit_price: '100', quantity: '10' }],
    fortnox_offer_number: '66',
  };

  function mockDatabase() {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'update', 'eq', 'neq', 'lt'] as const) chain[m] = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue({ data: quoteRow, error: null });
    // Push-claimen och slutstämplingen: en uppdaterad rad.
    chain.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
      Promise.resolve({ data: [{ id: 'quote-1' }], error: null }).then(ok, err);
    vi.mocked(getSupabaseAdmin).mockReturnValue({ from: vi.fn(() => chain) } as unknown as ReturnType<typeof getSupabaseAdmin>);
  }

  function mockFortnox(offerCustomerNumber: string | null, card: Record<string, unknown> = cardB) {
    vi.mocked(fortnoxGet).mockImplementation(async (path: string) => {
      if (path === '/offers/66') return { Offer: { CustomerNumber: offerCustomerNumber } } as never;
      if (path === '/customers/2') return { Customer: card } as never;
      throw new Error(`oväntat anrop ${path}`);
    });
    vi.mocked(fortnoxPut).mockResolvedValue({ Offer: { DocumentNumber: '66' } } as never);
  }

  function offerPutBody(): Record<string, unknown> {
    const call = vi.mocked(fortnoxPut).mock.calls.find(([path]) => path === '/offers/66');
    expect(call, 'ingen PUT till /offers/66').toBeDefined();
    return (call![1] as { Offer: Record<string, unknown> }).Offer;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabase();
  });

  it('bytt kund: PUT:en bär den nya kundens namn, adress och org.nr', async () => {
    mockFortnox('1');

    await pushQuoteToFortnox('quote-1');

    expect(fortnoxGet).toHaveBeenCalledWith('/customers/2');
    expect(offerPutBody()).toMatchObject({
      CustomerNumber: '2',
      CustomerName: 'johansons bygg ab',
      Address1: 'byggvägen 32',
      ZipCode: '15160',
      City: 'södertälje',
      OrganisationNumber: '556103-4249',
      Phone1: '0843232421',
      TermsOfPayment: '30',
    });
  });

  // Kortet fyller bara det vi INTE skickar — som när Fortnox skapar en offert. Arbetsadressen och
  // Er referens är offertens egna val och får aldrig skrivas över av kortets standardvärden.
  it('bytt kund: offertens egna fält vinner över kortets', async () => {
    mockFortnox('1', { ...cardB, DeliveryName: 'Lagret', DeliveryAddress1: 'Lagervägen 1', DeliveryZipCode: '15160', DeliveryCity: 'Södertälje' });

    await pushQuoteToFortnox('quote-1');

    expect(offerPutBody()).toMatchObject({
      YourReference: 'Per Johansson',
      DeliveryAddress1: 'Arbetsvägen 7',
      DeliveryZipCode: '15200',
      DeliveryCity: 'Strängnäs',
      // Offerten har egen arbetsadress → kortets leveransnamn får inte hamna ovanpå den.
      DeliveryName: null,
      DeliveryAddress2: null,
    });
  });

  // Postnummer och ort saknas på offertens arbetsadress: rensas, lånas aldrig ur kortet.
  it('bytt kund: arbetsadress utan postnummer får inte kortets postnummer och ort', async () => {
    quoteRow.customer_snapshot = { ...quoteRow.customer_snapshot, delivery_postal_code: '', delivery_city: '' };
    mockFortnox('1', { ...cardB, DeliveryAddress1: 'Lagervägen 1', DeliveryZipCode: '15160', DeliveryCity: 'Södertälje' });
    try {
      await pushQuoteToFortnox('quote-1');
    } finally {
      quoteRow.customer_snapshot = { ...quoteRow.customer_snapshot, delivery_postal_code: '15200', delivery_city: 'Strängnäs' };
    }

    expect(offerPutBody()).toMatchObject({ DeliveryAddress1: 'Arbetsvägen 7', DeliveryZipCode: null, DeliveryCity: null });
  });

  // Samma kund: inget får skrivas över — kunduppgifter rättade för hand i Fortnox står kvar.
  it('samma kund: kortet läses inte och PUT:en bär ingen kunddel', async () => {
    mockFortnox('2');

    await pushQuoteToFortnox('quote-1');

    expect(fortnoxGet).not.toHaveBeenCalledWith('/customers/2');
    const body = offerPutBody();
    expect(body.CustomerNumber).toBe('2');
    expect(body).not.toHaveProperty('CustomerName');
    expect(body).not.toHaveProperty('Address1');
    expect(body).not.toHaveProperty('OrganisationNumber');
  });

  // Fortnox svarar ibland med kundnumret som tal.
  it('jämför kundnumret som text', async () => {
    vi.mocked(fortnoxGet).mockImplementation(async (path: string) => {
      if (path === '/offers/66') return { Offer: { CustomerNumber: 2 } } as never;
      throw new Error(`oväntat anrop ${path}`);
    });
    vi.mocked(fortnoxPut).mockResolvedValue({ Offer: { DocumentNumber: '66' } } as never);

    await pushQuoteToFortnox('quote-1');

    expect(offerPutBody()).not.toHaveProperty('CustomerName');
  });

  // Ett svar utan kundnummer får inte läsas som ett byte — då skrevs kunddelen över på en offert
  // som aldrig bytt kund, även det som rättats för hand i Fortnox.
  it('ett svar utan kundnummer kastar i stället för att skriva över', async () => {
    mockFortnox(null);

    await expect(pushQuoteToFortnox('quote-1')).rejects.toThrow('utan kundnummer');
    expect(fortnoxPut).not.toHaveBeenCalled();
  });

  // Ett halvt byte — gammalt namn över den nya kundens uppgifter — är värre än inget.
  it('ett kort utan namn kastar i stället för att göra ett halvt byte', async () => {
    mockFortnox('1', { ...cardB, Name: '' });

    await expect(pushQuoteToFortnox('quote-1')).rejects.toThrow('saknar namn');
    expect(fortnoxPut).not.toHaveBeenCalled();
  });

  // Hellre 'failed' än en offert som tyst bär fel kund.
  it('går offerten inte att läsa skrivs den inte', async () => {
    vi.mocked(fortnoxGet).mockRejectedValue(new Error('timeout'));

    await expect(pushQuoteToFortnox('quote-1')).rejects.toThrow('timeout');
    expect(fortnoxPut).not.toHaveBeenCalled();
  });
});

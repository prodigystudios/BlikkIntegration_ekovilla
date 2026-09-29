import { describe, it, expect } from 'vitest';
import {
  FORTNOX_COMMENTS_MAX,
  FORTNOX_TEXT_ROW_MAX,
  buildStoreOrderFortnoxOrder,
  decideStoreOrderConfirm,
  pickStoreOrderFortnoxMatch,
  storeOrderComments,
  storeOrderFortnoxReference,
  storeOrderDocumentNote,
  storeOrderLineItems,
  type StoreOrderFortnoxInput,
  type StoreOrderRegisterArticle,
} from '@/lib/domains/portal/storeOrderFortnox';
import { storeOrderFreightFromRow, type StoreOrderBody } from '@/lib/domains/portal/storeOrders';
import { CONTRACT_STORE_ORDER } from './helpers/contractFixtures';

/**
 * Fortnox-ordern för en butiksbeställning (fas 8b). Det som skyddas:
 *   - butikens pris och antal, 25 % och kontot 3001 på varje rad, frakten som artikel 1050 med säljarens pris;
 *   - registrets benämning och enhetskod (portalen skickar enheten med gemener);
 *   - Fortnox gränser, uppmätta i testbolaget 2026-09-29: Er referens över 50 tecken nekar hela ordern, och det som
 *     kapas tyst (Ert ordernummer 30, textraden 255) kapas av oss, med det som inte ryms i textraden;
 *   - bekräftelsens krav i den ordning säljaren kan göra något åt dem.
 */

const body = (): StoreOrderBody => structuredClone(CONTRACT_STORE_ORDER) as StoreOrderBody;

const REGISTER = new Map<string, StoreOrderRegisterArticle>([
  ['13003', { article_number: '13003', description: 'EKOVILLA LEVY 70 MM (registret)', unit: 'PKT' }],
  ['1050', { article_number: '1050', description: 'FRAKT', unit: 'st' }],
]);

function order(overrides: Partial<StoreOrderFortnoxInput> = {}) {
  return buildStoreOrderFortnoxOrder({
    reference: 'crm-store-order:55555555-5555-4555-8555-555555555555',
    body: body(),
    freight: { mode: 'charged', price: 950 },
    customerNumber: '1043',
    organisationNumber: '556677-8899',
    ourReference: 'Anna Berg',
    register: REGISTER,
    orderDate: '2026-09-29',
    ...overrides,
  }).Order;
}

describe('storeOrderLineItems', () => {
  it('butikens rader med butikens pris och antal, registrets namn och enhet när artikeln finns där', () => {
    const items = storeOrderLineItems(body(), null, REGISTER);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ pricing_mode: 'item', article_number: '13003', article_name: 'EKOVILLA LEVY 70 MM (registret)', article_unit_name: 'PKT', unit_price: '335.3', quantity: '12' });
    // Inte i registret: portalens namn, men ingen enhet (portalens gemener är ingen kod Fortnox känner; Fortnox tar artikelns).
    expect(items[1]).toMatchObject({ article_number: '13102', article_name: 'ISOLERINGSSÅG EKOVILLA LEVY', article_unit_name: null, unit_price: '195.3', quantity: '2' });
  });

  it('frakten sist, som artikel 1050 med säljarens pris och antal 1; ingen rad för Ingen frakt', () => {
    const charged = storeOrderLineItems(body(), { mode: 'charged', price: 950.5 }, REGISTER);
    expect(charged).toHaveLength(3);
    expect(charged[2]).toMatchObject({ article_number: '1050', article_name: 'FRAKT', article_unit_name: 'st', unit_price: '950.5', quantity: '1' });
    expect(storeOrderLineItems(body(), { mode: 'none' }, REGISTER)).toHaveLength(2);
  });

  it('frakten utan artikeln i registret: "Frakt", utan enhet', () => {
    const items = storeOrderLineItems(body(), { mode: 'charged', price: 100 }, new Map());
    expect(items[2]).toMatchObject({ article_number: '1050', article_name: 'Frakt', article_unit_name: null });
  });
});

describe('buildStoreOrderFortnoxOrder', () => {
  it('huvudet: kunden, dagen, org.nr, vår och er referens, butikens referens och leveransen till butiken', () => {
    const o = order();
    expect(o).toMatchObject({
      CustomerNumber: '1043',
      OrderDate: '2026-09-29',
      // Märkningen som söks före varje POST: /orders har ingen dubblettspärr.
      ExternalInvoiceReference1: 'crm-store-order:55555555-5555-4555-8555-555555555555',
      OrganisationNumber: '556677-8899',
      OurReference: 'Anna Berg',
      YourReference: 'David Kron',
      YourOrderNumber: 'Inköp 4471',
      DeliveryAddress1: 'Verkstadsgatan 8',
      DeliveryZipCode: '802 91',
      DeliveryCity: 'Gävle',
    });
    // 🧨 Uttryckligen: annars fyller Fortnox i kundkortets leveransnamn och rad 2 (uppmätt). Tom sträng rensar inte, null gör.
    expect(o.DeliveryName).toBe('Norrbygg AB');
    expect(o).toHaveProperty('DeliveryAddress2', null);
    // Ingen VATType: Fortnox nekar den på dokumenten (2001399).
    expect(o).not.toHaveProperty('VATType');
    expect(o).not.toHaveProperty('Comments');
  });

  it('🧨 raderna: butikens pris, 25 % och kontot 3001 på varje rad, frakten med, och textraden sist', () => {
    const rows = order().OrderRows as Record<string, unknown>[];
    expect(rows.map((r) => [r.ArticleNumber, r.Price, r.OrderedQuantity, r.VAT, r.AccountNumber])).toEqual([
      ['13003', 335.3, 12, 25, 3001],
      ['13102', 195.3, 2, 25, 3001],
      ['1050', 950, 1, 25, 3001],
      [null, 0, 0, 25, 3001],
    ]);
    expect(rows[3].Description).toBe('Butiksbeställning B-2026-003  Leverans: Vecka 41  Mottagare: David Kron 070-234 56 78');
  });

  it('🧨 Er referens kapas vid 50 tecken (över det nekar Fortnox hela ordern), Ert ordernummer vid 30', () => {
    const b = body();
    b.delivery.contactName = 'A'.repeat(60);
    b.delivery.reference = 'R'.repeat(40);
    const o = order({ body: b, ourReference: 'O'.repeat(60) });
    expect(o.YourReference).toBe('A'.repeat(50));
    expect(o.OurReference).toBe('O'.repeat(50));
    expect(o.YourOrderNumber).toBe('R'.repeat(30));
  });

  it('🧨 leveransadressen kapas vid 60 tecken (Fortnox kapar tyst där), och hela står i textraden', () => {
    const b = body();
    b.delivery.address.street = 'Industrivägen 12, lastkaj 4, porten mot järnvägen, fråga i receptionen';
    const o = order({ body: b });
    expect(o.DeliveryAddress1).toBe(b.delivery.address.street.slice(0, 60).trimEnd());
    const rows = o.OrderRows as Record<string, unknown>[];
    expect(rows[rows.length - 1].Description).toContain(`Leveransadress: ${b.delivery.address.street}`);
  });

  it('🧨 ett tecken på gränsen delas aldrig: ingen ensam halva av ett emoji', () => {
    const b = body();
    b.delivery.contactName = `${'A'.repeat(49)}😀 Kron`;
    const ref = order({ body: b }).YourReference as string;
    expect(ref).toBe('A'.repeat(49));
    expect(/[\uD800-\uDFFF]/.test(ref)).toBe(false);
  });

  it('🧨 tankstreck i butikens fritext blir bindestreck: "—" i Er referens, adressen och Comments nekar ordern (uppmätt)', () => {
    const b = body();
    b.delivery.contactName = 'David — Kron';
    b.delivery.address.street = 'Gatan 1 — baksidan';
    b.delivery.reference = 'Inköp – 44';
    b.delivery.message = 'Ring innan — porten är låst';
    b.store.name = 'Norrbygg – Lager';
    const o = order({ body: b, ourReference: 'Anna – Berg' });
    expect(o).toMatchObject({
      YourReference: 'David - Kron',
      DeliveryAddress1: 'Gatan 1 - baksidan',
      YourOrderNumber: 'Inköp - 44',
      DeliveryName: 'Norrbygg - Lager',
      OurReference: 'Anna - Berg',
      Comments: 'Meddelande från butiken: Ring innan - porten är låst',
    });
    expect(JSON.stringify(o)).not.toMatch(/[\u2013\u2014]/);
  });

  it('tomma fält skickas inte: ingen referens, ingen mottagare, inget org.nr', () => {
    const b = body();
    b.delivery.contactName = '  ';
    b.delivery.reference = '';
    const o = order({ body: b, organisationNumber: null, ourReference: null });
    for (const key of ['YourReference', 'YourOrderNumber', 'OrganisationNumber', 'OurReference']) expect(o).not.toHaveProperty(key);
  });

  it('butikens meddelande som intern anteckning (Comments)', () => {
    const b = body();
    b.delivery.message = 'Ring innan.\nPorten är på baksidan.';
    expect(order({ body: b }).Comments).toBe('Meddelande från butiken: Ring innan.\nPorten är på baksidan.');
  });
});

describe('storeOrderDocumentNote', () => {
  it('bara det som finns', () => {
    const b = body();
    b.delivery.desiredPeriod = '';
    b.delivery.contactName = '';
    expect(storeOrderDocumentNote(b)).toBe('Butiksbeställning B-2026-003  Mottagare: 070-234 56 78');
  });

  it('🧨 det som inte rymdes i huvudet står först, så att kapningen vid 255 aldrig tar det', () => {
    const b = body();
    b.delivery.reference = 'R'.repeat(40);
    b.delivery.address.street = 'G'.repeat(70);
    b.delivery.desiredPeriod = 'V'.repeat(200);
    const note = storeOrderDocumentNote(b);
    expect(note.length).toBe(FORTNOX_TEXT_ROW_MAX);
    expect(note).toContain(`Butikens referens: ${'R'.repeat(40)}`);
    expect(note).toContain(`Leveransadress: ${'G'.repeat(70)}`);
  });

  it('en referens som inte ryms i Ert ordernummer står i textraden', () => {
    const b = body();
    b.delivery.reference = 'Projekt Norrby etapp 2, inköpsorder 99887766';
    expect(storeOrderDocumentNote(b)).toContain('Butikens referens: Projekt Norrby etapp 2, inköpsorder 99887766');
    b.delivery.reference = 'R'.repeat(30);
    expect(storeOrderDocumentNote(b)).not.toContain('Butikens referens');
  });

  it('🧨 högst 255 tecken: Fortnox kapar en textrad där, tyst', () => {
    const b = body();
    b.delivery.desiredPeriod = 'V'.repeat(200);
    b.delivery.contactName = 'N'.repeat(200);
    const note = storeOrderDocumentNote(b);
    expect(note.length).toBe(FORTNOX_TEXT_ROW_MAX);
    expect(note.startsWith('Butiksbeställning B-2026-003  Leverans: VVV')).toBe(true);
  });
});

describe('storeOrderComments', () => {
  it('inget meddelande: ingen anteckning', () => {
    expect(storeOrderComments(body())).toBeNull();
  });

  it('🧨 högst 1024 tecken (över det nekar Fortnox ordern), och det sägs var resten står', () => {
    const b = body();
    b.delivery.message = 'm'.repeat(4000);
    const comments = storeOrderComments(b)!;
    expect(comments.length).toBeLessThanOrEqual(FORTNOX_COMMENTS_MAX);
    expect(comments.endsWith('… (hela meddelandet står i CRM:et)')).toBe(true);
    b.delivery.message = 'm'.repeat(FORTNOX_COMMENTS_MAX - 'Meddelande från butiken: '.length);
    expect(storeOrderComments(b)).toBe(`Meddelande från butiken: ${b.delivery.message}`);
  });
});

describe('decideStoreOrderConfirm', () => {
  const AT = '2026-09-29T09:00:00.123456+00:00';
  const row = { status: 'received' as const, store_version: 3, freight_mode: 'charged', freight_set_at: AT, customer_id: 'kund' };
  const seen = { version: 3, freightSetAt: AT, customerId: 'kund' };
  const card = { fortnox_customer_id: '1043' };

  it('mottagen, som säljaren såg den, frakten beslutad och en kund i Fortnox: ja', () => {
    expect(decideStoreOrderConfirm(row, seen, card)).toEqual({ ok: true });
    expect(decideStoreOrderConfirm({ ...row, freight_mode: 'none' }, seen, card)).toEqual({ ok: true });
    // Samma ögonblick i en annan form (klienten skickar tillbaka det den fick).
    expect(decideStoreOrderConfirm(row, { ...seen, freightSetAt: '2026-09-29T11:00:00.123456+02:00' }, card)).toEqual({ ok: true });
  });

  it('nej, med skälet, i den ordning säljaren kan göra något åt det', () => {
    const no = (reason: string) => ({ ok: false, reason });
    expect(decideStoreOrderConfirm({ ...row, status: 'withdrawn' }, seen, card)).toEqual(no('not_received'));
    expect(decideStoreOrderConfirm({ ...row, status: 'confirmed' }, seen, card)).toEqual(no('not_received'));
    // Butiken ändrade efter att sidan lästes: läs om före allt annat.
    expect(decideStoreOrderConfirm({ ...row, freight_mode: null }, { ...seen, version: 2 }, card)).toEqual(no('changed'));
    expect(decideStoreOrderConfirm({ ...row, freight_mode: null }, seen, card)).toEqual(no('freight_missing'));
    expect(decideStoreOrderConfirm({ ...row, customer_id: null }, seen, null)).toEqual(no('customer_missing'));
    expect(decideStoreOrderConfirm(row, seen, null)).toEqual(no('customer_missing'));
    expect(decideStoreOrderConfirm(row, seen, { fortnox_customer_id: ' ' })).toEqual(no('customer_not_in_fortnox'));
  });

  it('🧨 frakten eller kunden ändrades av någon annan hos Ekovilla (versionen är butikens): nej', () => {
    const no = { ok: false, reason: 'changed_here' };
    expect(decideStoreOrderConfirm({ ...row, freight_set_at: '2026-09-29T09:05:00+00:00' }, seen, card)).toEqual(no);
    expect(decideStoreOrderConfirm({ ...row, customer_id: 'annan' }, seen, card)).toEqual(no);
  });
});

describe('märkningen', () => {
  it('beställningens id, fast form', () => {
    expect(storeOrderFortnoxReference('55555555-5555-4555-8555-555555555555')).toBe('crm-store-order:55555555-5555-4555-8555-555555555555');
  });

  it('🧨 Fortnox sökning matchar på början av värdet: bara en exakt träff räknas', () => {
    const ref = 'crm-store-order:55555555-5555-4555-8555-555555555555';
    expect(pickStoreOrderFortnoxMatch([{ DocumentNumber: 70, ExternalInvoiceReference1: `${ref}-annan` }], ref)).toBeNull();
    expect(pickStoreOrderFortnoxMatch([{ DocumentNumber: 70, ExternalInvoiceReference1: `${ref}-annan` }, { DocumentNumber: 71, ExternalInvoiceReference1: ref }], ref)).toBe('71');
    expect(pickStoreOrderFortnoxMatch([], ref)).toBeNull();
  });

  it('🧨 en makulerad order tas aldrig över: någon tog bort den med flit', () => {
    const ref = 'crm-store-order:55555555-5555-4555-8555-555555555555';
    expect(pickStoreOrderFortnoxMatch([{ DocumentNumber: 70, ExternalInvoiceReference1: ref, Cancelled: true }], ref)).toBeNull();
    expect(pickStoreOrderFortnoxMatch([{ DocumentNumber: 70, ExternalInvoiceReference1: ref, Cancelled: true }, { DocumentNumber: 72, ExternalInvoiceReference1: ref, Cancelled: false }], ref)).toBe('72');
  });
});

describe('storeOrderFreightFromRow', () => {
  it('numeric som sträng från PostgREST', () => {
    expect(storeOrderFreightFromRow({ freight_mode: 'charged', freight_price: '950.50' })).toEqual({ mode: 'charged', price: 950.5 });
    expect(storeOrderFreightFromRow({ freight_mode: 'none', freight_price: null })).toEqual({ mode: 'none' });
    expect(storeOrderFreightFromRow({ freight_mode: null, freight_price: null })).toBeNull();
  });
});

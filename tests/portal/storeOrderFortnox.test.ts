import { describe, it, expect } from 'vitest';
import {
  FORTNOX_COMMENTS_MAX,
  FORTNOX_TEXT_ROW_MAX,
  buildStoreOrderFortnoxOrder,
  decideStoreOrderConfirm,
  storeOrderComments,
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
    // Inte i registret: portalens namn och enhet.
    expect(items[1]).toMatchObject({ article_number: '13102', article_name: 'ISOLERINGSSÅG EKOVILLA LEVY', article_unit_name: 'st', unit_price: '195.3', quantity: '2' });
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
      OrganisationNumber: '556677-8899',
      OurReference: 'Anna Berg',
      YourReference: 'David Kron',
      YourOrderNumber: 'Inköp 4471',
      DeliveryAddress1: 'Verkstadsgatan 8',
      DeliveryZipCode: '802 91',
      DeliveryCity: 'Gävle',
    });
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
  const row = { status: 'received' as const, store_version: 3, freight_mode: 'charged', customer_id: 'kund' };
  const card = { fortnox_customer_id: '1043' };

  it('mottagen, samma version, frakten beslutad och en kund i Fortnox: ja', () => {
    expect(decideStoreOrderConfirm(row, 3, card)).toEqual({ ok: true });
    expect(decideStoreOrderConfirm({ ...row, freight_mode: 'none' }, 3, card)).toEqual({ ok: true });
  });

  it('nej, med skälet, i den ordning säljaren kan göra något åt det', () => {
    const no = (reason: string) => ({ ok: false, reason });
    expect(decideStoreOrderConfirm({ ...row, status: 'withdrawn' }, 3, card)).toEqual(no('not_received'));
    expect(decideStoreOrderConfirm({ ...row, status: 'confirmed' }, 3, card)).toEqual(no('not_received'));
    // Butiken ändrade efter att sidan lästes: läs om före allt annat.
    expect(decideStoreOrderConfirm({ ...row, freight_mode: null }, 2, card)).toEqual(no('changed'));
    expect(decideStoreOrderConfirm({ ...row, freight_mode: null }, 3, card)).toEqual(no('freight_missing'));
    expect(decideStoreOrderConfirm({ ...row, customer_id: null }, 3, null)).toEqual(no('customer_missing'));
    expect(decideStoreOrderConfirm(row, 3, null)).toEqual(no('customer_missing'));
    expect(decideStoreOrderConfirm(row, 3, { fortnox_customer_id: ' ' })).toEqual(no('customer_not_in_fortnox'));
  });
});

describe('storeOrderFreightFromRow', () => {
  it('numeric som sträng från PostgREST', () => {
    expect(storeOrderFreightFromRow({ freight_mode: 'charged', freight_price: '950.50' })).toEqual({ mode: 'charged', price: 950.5 });
    expect(storeOrderFreightFromRow({ freight_mode: 'none', freight_price: null })).toEqual({ mode: 'none' });
    expect(storeOrderFreightFromRow({ freight_mode: null, freight_price: null })).toBeNull();
  });
});

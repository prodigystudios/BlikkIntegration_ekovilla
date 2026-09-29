import { describe, it, expect } from 'vitest';
import { buildOrderRows } from '@/lib/domains/fortnox/orders';
import { buildOfferRows } from '@/lib/domains/fortnox/offers';
import { buildInvoiceRows } from '@/lib/domains/fortnox/partialInvoices';
import { fortnoxSalesAccount } from '@/lib/domains/fortnox/helpers';

// Kontot följer DOKUMENTETS moms, aldrig kundkortets. Fortnox väljer annars kontot ur kortet: en
// order med moms till en kund med omvänd skattskyldighet hamnade på 3231. Se fortnoxSalesAccount.

describe('fortnoxSalesAccount', () => {
  it('bokar en rad med moms på 3001, också till en kund vars kort har omvänd moms', () => {
    // Dokumentet bär 25 % → reverseVat är false för dokumentet, vad kortet än säger.
    expect(fortnoxSalesAccount(25, false)).toBe(3001);
  });

  it('bokar omvänd byggmoms på 3231', () => {
    expect(fortnoxSalesAccount(0, true)).toBe(3231);
  });

  it('bokar 0 % utan omvänd moms på 3004, som Fortnox själv gör för ett kort med vanlig moms', () => {
    expect(fortnoxSalesAccount(0, false)).toBe(3004);
  });

  it('bokar 12 % och 6 % på sina egna konton, inte på 25 %-kontot', () => {
    // Momsen är fritt inmatad på offerten (0–100).
    expect(fortnoxSalesAccount(12, false)).toBe(3002);
    expect(fortnoxSalesAccount(6, false)).toBe(3003);
  });

  it('bokar Etableringskostnad (1010) med moms på 3017, men omvänd byggmoms på 3231 som allt annat', () => {
    // William 2026-09-29.
    expect(fortnoxSalesAccount(25, false, '1010')).toBe(3017);
    expect(fortnoxSalesAccount(25, false, ' 1010 ')).toBe(3017);
    expect(fortnoxSalesAccount(0, true, '1010')).toBe(3231);
    expect(fortnoxSalesAccount(0, false, '1010')).toBe(3004);
  });

  it('ger andra artiklar och rader utan artikel 3001', () => {
    expect(fortnoxSalesAccount(25, false, '10100')).toBe(3001);
    expect(fortnoxSalesAccount(25, false, 'constructor')).toBe(3001);
    expect(fortnoxSalesAccount(25, false, null)).toBe(3001);
  });

  it('låter omvänd moms vinna: raderna går då ut med 0 % oavsett dokumentets procentsats', () => {
    expect(fortnoxSalesAccount(25, true)).toBe(3231);
  });
});

// ⚠️ VARJE rad, också text-, ROT- och notraderna: Fortnox uppdaterar raderna per position, och en rad
// utan fältet ärver kontot från raden som låg där förut (null ger konto 0). Uppmätt 2026-09-29.
const everyAccount = (rows: unknown[]) => rows.map((r) => (r as { AccountNumber?: unknown }).AccountNumber);

describe('buildOrderRows — kontot på varje rad', () => {
  const items = [
    // Artikelrad + Radtext → egen textrad.
    { pricing_mode: 'item', article_number: '13003', article_name: 'Levy', unit_price: '300', quantity: '2', line_note: 'Vind' },
    // ROT-utbrytning → en aggregerad "Arbetskostnad ROT"-rad sist.
    { pricing_mode: 'item', article_name: 'Lösull', unit_price: '200', quantity: '10', labor_cost: '80' },
  ];

  it('moms: artikel-, text-, ROT- och notraden bär alla 3001', () => {
    const rows = buildOrderRows(items as never, 25, true, false, 'Ordernamn');
    // artikel, Radtext, material, Arbetskostnad ROT, dokumentets textrad
    expect(rows).toHaveLength(5);
    expect(everyAccount(rows)).toEqual([3001, 3001, 3001, 3001, 3001]);
  });

  it('omvänd moms: varje rad bär 3231', () => {
    const rows = buildOrderRows(items as never, 0, false, true, 'Ordernamn');
    expect(rows).toHaveLength(4);
    expect(everyAccount(rows)).toEqual([3231, 3231, 3231, 3231]);
  });

  it('Etableringskostnaden får sitt eget konto, textraden under den 3001', () => {
    const rows = buildOrderRows([
      { pricing_mode: 'item', article_number: '1010', article_name: 'Etableringskostnad', unit_price: '2490', quantity: '1', line_note: 'Sandviken' },
      { pricing_mode: 'item', article_number: '13003', article_name: 'Levy', unit_price: '300', quantity: '2' },
    ] as never, 25, false, false);
    expect(everyAccount(rows)).toEqual([3017, 3001, 3001]);
    expect(everyAccount(buildOrderRows([{ pricing_mode: 'item', article_number: '1010', unit_price: '2490', quantity: '1' }] as never, 0, false, true))).toEqual([3231]);
  });

  it('skickar fältet med exakt Fortnox namn', () => {
    const rows = buildOrderRows(items as never, 25, false, false);
    expect(JSON.parse(JSON.stringify(rows))[0]).toMatchObject({ AccountNumber: 3001, VAT: 25 });
  });
});

describe('buildOfferRows — kontot på varje rad', () => {
  it('Etableringskostnaden får sitt eget konto', () => {
    const rows = buildOfferRows([{ pricing_mode: 'item', article_number: '1010', article_name: 'Etableringskostnad', unit_price: '2490', quantity: '1' }] as never, 25, false);
    expect(everyAccount(rows)).toEqual([3017]);
  });

  const items = [
    // m²/tjocklek + Radtext → en textrad under artikeln.
    { pricing_mode: 'm3', article_number: '13003', article_name: 'Levy', m2: '100', thickness_mm: '200', unit_price: '700', line_note: 'Vind' },
    { pricing_mode: 'item', article_name: 'Lösull', unit_price: '200', quantity: '10', labor_cost: '80' },
  ];

  it('moms: artikel-, mät-, ROT- och fastighetsraden bär alla 3001', () => {
    const rows = buildOfferRows(items as never, 25, true, false, 'Fastighetsbeteckning: Haggården 6:3');
    // artikel, mätrad, material, Arbetskostnad ROT, fastighetsnoten
    expect(rows).toHaveLength(5);
    expect(everyAccount(rows)).toEqual([3001, 3001, 3001, 3001, 3001]);
  });

  it('omvänd moms: varje rad bär 3231', () => {
    const rows = buildOfferRows(items as never, 0, false, true);
    expect(rows).toHaveLength(3);
    expect(everyAccount(rows)).toEqual([3231, 3231, 3231]);
  });
});

describe('buildInvoiceRows — kontot på varje rad', () => {
  const items = [
    { pricing_mode: 'item', article_number: '13003', article_name: 'Levy', unit_price: '300', quantity: '10' },
    { pricing_mode: 'item', article_name: 'Arbete', unit_price: '500', quantity: '4' },
  ];
  const request = new Map([['#0', 5], ['#1', 2]]);

  it('moms: artikelraderna och fastighetsnoten bär 3001', () => {
    const rows = buildInvoiceRows(items as never, request, 25, true, false, 'Fastighetsbeteckning: Haggården 6:3');
    expect(rows).toHaveLength(3);
    expect(everyAccount(rows)).toEqual([3001, 3001, 3001]);
  });

  it('omvänd moms: varje rad bär 3231', () => {
    const rows = buildInvoiceRows(items as never, request, 0, false, true);
    expect(everyAccount(rows)).toEqual([3231, 3231]);
  });

  it('Etableringskostnaden får sitt eget konto', () => {
    const rows = buildInvoiceRows([{ pricing_mode: 'item', article_number: '1010', article_name: 'Etableringskostnad', unit_price: '2490', quantity: '1' }] as never, new Map([['#0', 1]]), 25, false);
    expect(everyAccount(rows)).toEqual([3017]);
  });
});

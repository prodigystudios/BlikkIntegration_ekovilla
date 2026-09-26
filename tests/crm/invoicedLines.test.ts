import { describe, it, expect } from 'vitest';
import { invoicedFloorIssues, invoicedLineIds, invoicedOnLine } from '@/lib/domains/crm/invoicedLines';

// Vilka rader som redan står på en utställd faktura. Ordersidan låser dem i förväg; servern
// (validateLineItemEdit) läser samma matchning — de får inte kunna peka ut olika rader.
describe('invoicedLineIds', () => {
  const lines = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('pekar ut raderna som fakturerats, på id', () => {
    const rounds = [{ line_quantities: [{ line_id: 'b', index: 1, quantity: 2 }] }];
    expect([...invoicedLineIds(lines, rounds)]).toEqual(['b']);
  });

  // Rundor från före id-migreringen bär bara position.
  it('matchar en rundpost utan id på position', () => {
    const rounds = [{ line_quantities: [{ index: 2, quantity: 1 }] }];
    expect([...invoicedLineIds(lines, rounds)]).toEqual(['c']);
  });

  // En post med id får ALDRIG matcha på position — raden kan ha flyttats.
  it('matchar inte en id-post på position', () => {
    const rounds = [{ line_quantities: [{ line_id: 'x', index: 0, quantity: 5 }] }];
    expect(invoicedLineIds(lines, rounds).size).toBe(0);
  });

  it('räknar inte en runda med noll på raden som fakturerad', () => {
    const rounds = [{ line_quantities: [{ line_id: 'a', index: 0, quantity: 0 }] }];
    expect(invoicedLineIds(lines, rounds).size).toBe(0);
  });

  it('summerar över rundor', () => {
    const rounds = [
      { line_quantities: [{ line_id: 'a', index: 0, quantity: 1.5 }] },
      { line_quantities: [{ line_id: 'a', index: 0, quantity: 2 }] },
    ];
    expect(invoicedOnLine(rounds, 'a', 0)).toBe(3.5);
  });

  it('är tom utan rundor', () => {
    expect(invoicedLineIds(lines, []).size).toBe(0);
    expect(invoicedLineIds(lines, null).size).toBe(0);
  });
});

// Golvet för en fakturerad rad, visat i editorn FÖRE sparningen — samma ord som servern
// (validateLineItemEdit), som annars nekar hela sparningen med 409.
describe('invoicedFloorIssues', () => {
  const saved = [{ id: 'a', pricing_mode: 'item', quantity: '10' }, { id: 'b', pricing_mode: 'item', quantity: '5' }];
  const rounds = [{ line_quantities: [{ line_id: 'a', index: 0, quantity: 8 }] }];

  it('spärrar ett antal under det fakturerade', () => {
    expect(invoicedFloorIssues([{ ...saved[0], quantity: '7' }, saved[1]], saved, rounds))
      .toEqual(['Rad 1 är fakturerad med 8 och antalet kan inte sänkas under det.']);
  });

  // Ner TILL det fakturerade är hur ordern stängs.
  it('godtar antalet ner till det fakturerade', () => {
    expect(invoicedFloorIssues([{ ...saved[0], quantity: '8' }, saved[1]], saved, rounds)).toEqual([]);
  });

  // Prislägesbytet läste om 8 m³ som 0 st — samma golv fångar det.
  it('fångar ett prislägesbyte som nollar en fakturerad m³-rad', () => {
    const m3 = [{ id: 'a', pricing_mode: 'm3', m2: '40', thickness_mm: '200', quantity: '' }];
    expect(invoicedFloorIssues([{ ...m3[0], pricing_mode: 'item' }], m3, rounds)).toHaveLength(1);
  });

  it('numrerar raden på sin plats i utkastet', () => {
    expect(invoicedFloorIssues([saved[1], { ...saved[0], quantity: '1' }], saved, rounds)[0]).toMatch(/^Rad 2 /);
  });

  it('prövar ingenting utan rundor', () => {
    expect(invoicedFloorIssues([{ ...saved[0], quantity: '0' }], saved, [])).toEqual([]);
  });
});

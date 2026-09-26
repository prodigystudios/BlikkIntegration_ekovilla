import { describe, it, expect } from 'vitest';
import { invoicedLineIds, invoicedOnLine } from '@/lib/domains/crm/invoicedLines';

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

import { describe, it, expect, vi } from 'vitest';
import { resolveCustomerVatNumber } from '@/lib/domains/fortnox/helpers';
import { makeQueryChain } from '../crm/helpers/supabase';

type Row = { vat_number: string | null } | null;

/**
 * En klient som svarar olika beroende på vilken kolumn uppslaget filtrerar på — det är hela poängen
 * med funktionen: id först, Fortnox kundnummer som reserv.
 */
function clientFor(byId: Row, byFortnoxId: Row) {
  const calls: Array<{ column: string; value: string }> = [];
  const from = vi.fn(() => {
    const chain = makeQueryChain({ data: null, error: null });
    chain.eq = vi.fn((column: string, value: string) => {
      calls.push({ column, value });
      const data = column === 'id' ? byId : byFortnoxId;
      chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
      return chain;
    });
    return chain;
  });
  return { client: { from } as never, calls };
}

describe('resolveCustomerVatNumber', () => {
  it('läser momsnumret på kundens id — den riktiga kopplingen', async () => {
    const { client, calls } = clientFor({ vat_number: 'SE556948642501' }, null);
    expect(await resolveCustomerVatNumber(client, 'cust-1', '707906729')).toBe('SE556948642501');
    expect(calls).toEqual([{ column: 'id', value: 'cust-1' }]);
  });

  it('faller tillbaka på Fortnox kundnummer när offerten saknar customer_id', async () => {
    // Helt manuellt inskriven kund: offerten är länkad till Fortnox men inte till vårt kundregister.
    const { client, calls } = clientFor(null, { vat_number: 'SE556948642501' });
    expect(await resolveCustomerVatNumber(client, null, '707906729')).toBe('SE556948642501');
    expect(calls).toEqual([{ column: 'fortnox_customer_id', value: '707906729' }]);
  });

  it('provar Fortnox-numret även när kundraden finns men saknar momsnummer', async () => {
    const { client, calls } = clientFor({ vat_number: null }, { vat_number: 'SE556948642501' });
    expect(await resolveCustomerVatNumber(client, 'cust-1', '707906729')).toBe('SE556948642501');
    expect(calls.map((c) => c.column)).toEqual(['id', 'fortnox_customer_id']);
  });

  it('behandlar en kolumn med enbart blanksteg som tom — inte som ett momsnummer', async () => {
    const { client } = clientFor({ vat_number: '   ' }, null);
    expect(await resolveCustomerVatNumber(client, 'cust-1', null)).toBeNull();
  });

  it('ger null när numret saknas — en privatkund har aldrig ett, och vi hittar aldrig på ett', async () => {
    const { client } = clientFor(null, null);
    expect(await resolveCustomerVatNumber(client, 'cust-1', '707906729')).toBeNull();
  });

  it('rör inte databasen alls utan något att slå upp på', async () => {
    const { client, calls } = clientFor(null, null);
    expect(await resolveCustomerVatNumber(client, null, null)).toBeNull();
    expect(calls).toEqual([]);
  });
});

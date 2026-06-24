import { describe, it, expect } from 'vitest';
import { normalizeContacts } from '@/app/kontakt-lista/contacts';

describe('normalizeContacts', () => {
  it('hanterar nya formen ({ contacts, addresses })', () => {
    const res = normalizeContacts({
      contacts: [
        { id: '1', name: 'Anna', phone: '070', location: 'Syd', category: 'Sälj' },
        { id: '2', name: 'Bo', location: 'Nord', category: 'Sälj' },
      ],
      addresses: [{ id: 'd1', name: 'Depå Syd', address: 'Gatan 1' }],
    });
    expect(res.categories).toHaveLength(1);
    expect(res.categories[0].name).toBe('Sälj');
    expect(res.addresses).toEqual([{ id: 'd1', name: 'Depå Syd', address: 'Gatan 1' }]);
  });

  it('hanterar legacy grupperad form + Adresser', () => {
    const res = normalizeContacts({
      Support: [{ name: 'Cecilia', phone: '08', role: 'Support' }],
      Adresser: [{ name: 'Depå Nord', address: 'Vägen 2' }],
    });
    expect(res.categories.map((c) => c.name)).toContain('Support');
    expect(res.addresses[0].name).toBe('Depå Nord');
  });

  it('packar upp { data: ... }-wrappern', () => {
    const res = normalizeContacts({ data: { contacts: [{ id: '1', name: 'Anna', category: 'Sälj' }] } });
    expect(res.categories[0].people[0].name).toBe('Anna');
  });

  it('sorterar per område/roll, tie-break på namn; kategorier sv-alfabetiskt', () => {
    const res = normalizeContacts({
      contacts: [
        { id: '3', name: 'Östen', location: 'Syd', category: 'Sälj' },
        { id: '1', name: 'Anna', location: 'Nord', category: 'Sälj' },
        { id: '2', name: 'Bo', location: 'Nord', category: 'Sälj' },
        { id: '4', name: 'X', category: 'Admin' },
      ],
    });
    expect(res.categories.map((c) => c.name)).toEqual(['Admin', 'Sälj']);
    const salj = res.categories.find((c) => c.name === 'Sälj')!;
    // Nord före Syd; inom Nord: Anna före Bo
    expect(salj.people.map((p) => p.name)).toEqual(['Anna', 'Bo', 'Östen']);
  });

  it('tål tomt/ogiltigt', () => {
    expect(normalizeContacts(null)).toEqual({ categories: [], addresses: [] });
    expect(normalizeContacts({})).toEqual({ categories: [], addresses: [] });
  });
});

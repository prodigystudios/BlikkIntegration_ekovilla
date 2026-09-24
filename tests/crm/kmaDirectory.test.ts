import { describe, it, expect } from 'vitest';

import { dedupeDirectory, lookupDirectoryPhone, matchDirectory, type KmaDirectoryEntry } from '@/lib/domains/crm/kmaPlans/directory';
import { pickKmaDirectoryEntry } from '@/lib/domains/crm/kmaPlans/dialog';

// Kontaktlistan i KMA-dialogens namnfält: vilka som föreslås, i vilken ordning, och vad ett val
// skriver in. Listan i drift bär samma person under två kategorier (Johan Borres) — i förslagen
// hade hen stått två gånger.

const entry = (name: string, phone: string | null, role: string | null = null): KmaDirectoryEntry => ({ name, phone, role });

describe('dedupeDirectory', () => {
  it('samma namn och samma nummer är en person — rollen tas från raden som har en', () => {
    const list = dedupeDirectory([entry('Johan Borres', '070-290 06 05', 'Säljare / Ledning'), entry('Johan Borres', '070-290 06 05', null)]);
    expect(list).toEqual([entry('Johan Borres', '070-290 06 05', 'Säljare / Ledning')]);
  });

  it('rollen fylls i även när raden utan roll kommer först', () => {
    const list = dedupeDirectory([entry('Johan Borres', '0702900605'), entry('johan  borres', '070-290 06 05', 'Säljare')]);
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe('Säljare');
  });

  it('samma namn med OLIKA nummer är två personer', () => {
    expect(dedupeDirectory([entry('Johan Andersson', '070-1'), entry('Johan Andersson', '070-2')])).toHaveLength(2);
  });

  it('i namnordning, och rader utan namn faller bort', () => {
    const list = dedupeDirectory([entry('Örjan Ek', '1'), entry('Anna Berg', '2'), entry('  ', '3'), entry('Åsa Ek', '4')]);
    expect(list.map((e) => e.name)).toEqual(['Anna Berg', 'Åsa Ek', 'Örjan Ek']);
  });
});

describe('matchDirectory', () => {
  const people = dedupeDirectory([
    entry('Anna Berg', '1'),
    entry('Bertil Andersson', '2'),
    entry('Patrik Vall', '3'),
    entry('Kristina Bergström', '4'),
  ]);

  it('tom text ger hela listan', () => {
    expect(matchDirectory(people, '  ')).toHaveLength(4);
  });

  it('början av namnet först, sedan början av ett senare ord, sist vad som helst inuti', () => {
    // "ber": Bertil (namnets början) · Anna Berg, Kristina Bergström (ett senare ord) · ingen inuti.
    expect(matchDirectory(people, 'ber').map((e) => e.name)).toEqual(['Bertil Andersson', 'Anna Berg', 'Kristina Bergström']);
    // "rik": bara inuti ett ord — Patrik.
    expect(matchDirectory(people, 'rik').map((e) => e.name)).toEqual(['Patrik Vall']);
  });

  it('oberoende av skiftläge och extra blanksteg', () => {
    expect(matchDirectory(people, '  PATRIK   v').map((e) => e.name)).toEqual(['Patrik Vall']);
  });

  it('ingen träff ger en tom lista', () => {
    expect(matchDirectory(people, 'xyz')).toEqual([]);
  });
});

describe('pickKmaDirectoryEntry', () => {
  it('ett val skriver in namnet OCH just den postens nummer — även när namnet är tvetydigt', () => {
    const directory = [entry('Johan Andersson', '070-111 11 11'), entry('Johan Andersson', '070-222 22 22')];
    // En uppslagning på namnet svarar tomt för båda; valet vet vilken som menades.
    expect(lookupDirectoryPhone(directory, 'Johan Andersson')).toBe('');
    const row = { name: '', phone: '', email: '' };
    expect(pickKmaDirectoryEntry(row, directory[1], directory)).toEqual({ name: 'Johan Andersson', phone: '070-222 22 22', email: '' });
  });

  it('en annan person tömmer förra personens e-post', () => {
    const row = { name: 'Erik Lund', phone: '070-999', email: 'erik@example.se' };
    expect(pickKmaDirectoryEntry(row, entry('Patrik Vall', '070-694 31 30'), [])).toEqual({
      name: 'Patrik Vall',
      phone: '070-694 31 30',
      email: '',
    });
  });

  it('samma person igen behåller e-posten och får listans nummer', () => {
    const row = { name: 'Patrik Vall', phone: '', email: 'patrik@example.se' };
    expect(pickKmaDirectoryEntry(row, entry('Patrik Vall', '070-694 31 30'), [])).toEqual({
      name: 'Patrik Vall',
      phone: '070-694 31 30',
      email: 'patrik@example.se',
    });
  });

  it('en post utan nummer lämnar numret tomt, aldrig det förra', () => {
    const row = { name: 'Erik Lund', role: 'Installatör', phone: '070-999' };
    expect(pickKmaDirectoryEntry(row, entry('Ny Person', null), [])).toEqual({ name: 'Ny Person', role: 'Installatör', phone: '' });
  });
});

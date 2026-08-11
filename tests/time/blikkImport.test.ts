import { describe, it, expect } from 'vitest';
import { mapBlikkTimeCode, mapBlikkProject, splitForImport, type MappedReferenceRow } from '@/lib/domains/time/blikkImport';

// Engångsimporten av referensdata från Blikk. Mappningen testas för att Blikks fältnamn varierar
// mellan endpoints och tenants (samma skäl som lib/blikk.ts är full av alias) — och för att ett
// tyst fel här ger en tom eller felnamngiven lönesort, vilket märks först i lönekörningen.

describe('mapBlikkTimeCode', () => {
  it('mappar en normal tidkod', () => {
    expect(mapBlikkTimeCode({ id: 12, code: 'ARB', name: 'Arbetstid', billable: true, isActive: true })).toEqual({
      blikk_id: '12',
      code: 'ARB',
      name: 'Arbetstid',
      requires_note: false,
      is_active: true,
      billable: true,
    });
  });

  it('accepterar Blikks alternativa fältnamn', () => {
    const mapped = mapBlikkTimeCode({ Id: 7, Code: 'OB1', title: 'OB kväll', isBillable: false, active: false });
    expect(mapped).toMatchObject({ blikk_id: '7', code: 'OB1', name: 'OB kväll', billable: false, is_active: false });
  });

  it('hoppar över rader utan id eller namn', () => {
    // Utan id går raden inte att koppla tillbaka, och en omkörning skulle skapa en dubblett.
    expect(mapBlikkTimeCode({ name: 'Namnlös nyckel' })).toBeNull();
    // Utan namn är raden värdelös i en dropdown — hellre bort än importerad som "Tidkod 4711".
    expect(mapBlikkTimeCode({ id: 5 })).toBeNull();
    expect(mapBlikkTimeCode(null)).toBeNull();
  });

  // Regression: en saknad aktiv-flagga får INTE tolkas som inaktiv. En rad som tyst blir inaktiv
  // försvinner ur formuläret utan att någon får veta varför; en synlig rad för mycket rättas direkt.
  it('tolkar saknad aktiv-flagga som aktiv', () => {
    expect(mapBlikkTimeCode({ id: 1, name: 'Restid' })?.is_active).toBe(true);
  });

  it('lämnar billable som null när Blikk inte säger något', () => {
    expect(mapBlikkTimeCode({ id: 1, name: 'Restid' })?.billable).toBeNull();
  });

  it('trimmar blanksteg och behandlar tomma strängar som saknade', () => {
    const mapped = mapBlikkTimeCode({ id: 3, name: '  Semester  ', code: '   ' });
    expect(mapped?.name).toBe('Semester');
    expect(mapped?.code).toBeNull();
  });
});

describe('mapBlikkProject', () => {
  it('mappar internprojekt och bär över kommentarkravet', () => {
    expect(mapBlikkProject({ id: 900, name: 'Verkstad', isActive: true, commentRequiredWhenTimeReporting: true })).toEqual({
      blikk_id: '900',
      code: null,
      name: 'Verkstad',
      requires_note: true,
      is_active: true,
    });
  });

  it('ger ingen billable-kolumn — den finns bara på tidkoder', () => {
    expect(mapBlikkProject({ id: 1, name: 'Sjukfrånvaro' })).not.toHaveProperty('billable');
  });
});

describe('splitForImport', () => {
  const row = (id: string, name = `Rad ${id}`): MappedReferenceRow => ({
    blikk_id: id, code: null, name, requires_note: false, is_active: true,
  });

  it('delar upp i nya och befintliga', () => {
    const { toCreate, toUpdate } = splitForImport([row('1'), row('2'), row('3')], new Set(['2']));
    expect(toCreate.map((r) => r.blikk_id)).toEqual(['1', '3']);
    expect(toUpdate.map((r) => r.blikk_id)).toEqual(['2']);
  });

  // Regression: Blikk kan returnera samma rad två gånger över en sidgräns. Utan dedupliceringen
  // blir det ett unique-fel som stoppar hela importen halvvägs.
  it('deduplicerar samma blikk_id', () => {
    const { toCreate } = splitForImport([row('1', 'Först'), row('1', 'Igen')], new Set());
    expect(toCreate).toHaveLength(1);
    expect(toCreate[0].name).toBe('Först');
  });

  it('är tom när Blikk inte gav något', () => {
    expect(splitForImport([], new Set(['1']))).toEqual({ toCreate: [], toUpdate: [] });
  });
});

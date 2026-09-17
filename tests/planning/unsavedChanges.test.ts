import { describe, it, expect } from 'vitest';
import { itemsAfterSave, revertedItems, savedAfterSave, unsavedIds, unsavedNamesText } from '@/app/crm/planering/unsavedChanges';

// Administrera-flikarna skriver det man skriver rakt in i listan. Utan de här reglerna såg en osparad Plats sparad
// ut, och beställningen nekades "saknar Plats" medan fältet visade adressen (Williams QA 2026-09-17).

type Depot = { id: string; name: string; location: string | null; active: boolean; created_at?: string };
const toPayload = (d: Depot) => ({ name: d.name, location: d.location, active: d.active });

const saved: Record<string, Depot> = {
  d1: { id: 'd1', name: 'Sandviken Lager', location: null, active: true, created_at: '2026-01-01' },
  d2: { id: 'd2', name: 'Borlänge Lager', location: 'Väg 1', active: true, created_at: '2026-01-01' },
};

describe('unsavedIds', () => {
  it('en skriven men osparad Plats är en osparad ändring', () => {
    const items = [{ ...saved.d1, location: 'Industrivägen 1' }, saved.d2];
    expect(unsavedIds(items, saved, toPayload)).toEqual(['d1']);
  });

  it('bara fälten Spara skickar räknas — ett fält som sparas för sig gör inte raden osparad', () => {
    const items = [{ ...saved.d1, created_at: '2026-09-17' }, saved.d2];
    expect(unsavedIds(items, saved, toPayload)).toEqual([]);
  });

  it('tillbakaskrivet till det sparade är inte längre osparat', () => {
    const items = [{ ...saved.d1, location: 'x' }, saved.d2].map((d) => (d.id === 'd1' ? { ...d, location: null } : d));
    expect(unsavedIds(items, saved, toPayload)).toEqual([]);
  });

  it('skillnader som inte är ändringar: ordningen på materialen, tom Plats som null eller tom text, blanksteg runt', () => {
    type Supplier = { id: string; name: string; materials: string[]; note: string | null };
    const sup = (over: Partial<Supplier> = {}): Supplier => ({ id: 's1', name: 'Ekovilla', materials: ['EKOVILLA', 'PAROC'], note: '', ...over });
    const payload = (x: Supplier) => ({ name: x.name, materials: x.materials, note: x.note });
    const base = { s1: sup() };
    expect(unsavedIds([sup({ materials: ['PAROC', 'EKOVILLA'] })], base, payload)).toEqual([]);
    expect(unsavedIds([sup({ note: null })], base, payload)).toEqual([]);
    expect(unsavedIds([sup({ name: 'Ekovilla ' })], base, payload)).toEqual([]);
    // Men ett material mer eller mindre, och en ifylld notering, är ändringar.
    expect(unsavedIds([sup({ materials: ['EKOVILLA'] })], base, payload)).toEqual(['s1']);
    expect(unsavedIds([sup({ note: 'Ring' })], base, payload)).toEqual(['s1']);
  });

  it('en rad utan sparat läge räknas inte som ändrad', () => {
    expect(unsavedIds([{ id: 'ny', name: 'Ny', location: null, active: true }], saved, toPayload)).toEqual([]);
  });
});

describe('efter en lyckad sparning', () => {
  it('serverns normaliserade värde ersätter det skrivna, så raden inte står kvar som osparad', () => {
    const sent = { ...saved.d1, location: 'Industrivägen 1 ' };
    const server = { ...sent, location: 'Industrivägen 1' };
    const items = itemsAfterSave([sent, saved.d2], sent, server, toPayload);
    const nextSaved = savedAfterSave(saved, sent, server);
    expect(items[0].location).toBe('Industrivägen 1');
    expect(unsavedIds(items, nextSaved, toPayload)).toEqual([]);
  });

  it('det som skrevs medan sparningen pågick skrivs inte över — det är en ny osparad ändring', () => {
    const sent = { ...saved.d1, location: 'Industrivägen 1' };
    const typedMeanwhile = { ...sent, location: 'Industrivägen 12' };
    const items = itemsAfterSave([typedMeanwhile, saved.d2], sent, sent, toPayload);
    expect(items[0].location).toBe('Industrivägen 12');
    expect(unsavedIds(items, savedAfterSave(saved, sent, sent), toPayload)).toEqual(['d1']);
  });

  it('utan svar från servern blir det skickade det sparade läget', () => {
    const sent = { ...saved.d1, location: 'Väg 2' };
    expect(savedAfterSave(saved, sent, null).d1.location).toBe('Väg 2');
    expect(savedAfterSave(saved, sent, null).d2).toBe(saved.d2);
  });
});

describe('unsavedNamesText', () => {
  it('en, två och fler', () => {
    expect(unsavedNamesText(['Sandviken Lager'])).toBe('Sandviken Lager');
    expect(unsavedNamesText(['Sandviken', 'Borlänge'])).toBe('Sandviken och Borlänge');
    expect(unsavedNamesText(['A', 'B', 'C', 'D'])).toBe('A, B och 2 till');
    expect(unsavedNamesText([' '])).toBe('Namnlös');
    expect(unsavedNamesText([])).toBe('');
  });
});

describe('revertedItems', () => {
  it('bara de angivna raderna går tillbaka, och bara om det finns ett sparat läge', () => {
    const items = [
      { ...saved.d1, location: 'Osparad' },
      { ...saved.d2, location: 'Också osparad', created_at: 'lokalt' },
      { id: 'ny', name: 'Ny', location: null, active: true },
    ];
    const out = revertedItems(items, saved, ['d1', 'ny']);
    expect(out[0]).toBe(saved.d1);
    expect(out[1]).toBe(items[1]);
    expect(out[2]).toBe(items[2]);
  });
});

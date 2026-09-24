import { describe, it, expect } from 'vitest';

import { kmaCardAction, kmaFieldErrors, kmaMissingCrewCount, kmaSourceNote, mergeKmaCrew } from '@/lib/domains/crm/kmaPlans/dialog';
import { kmaFormSchema } from '@/lib/domains/crm/kmaPlans/schemas';

import { kmaForm } from './helpers/kmaFixtures';

// KMA-kortets och -dialogens logik — det som avgör vilka knappar som ritas och vad dialogen säger.

describe('kmaCardAction', () => {
  const base = { canEdit: true, canCreate: true, hasPlans: false, loadError: false };

  it('"Skapa" utan planer, "Revidera" med', () => {
    expect(kmaCardAction(base)).toBe('create');
    expect(kmaCardAction({ ...base, hasPlans: true })).toBe('revise');
  });

  it('ingen knapp i läsläget (ekonomins vy av samma sida)', () => {
    expect(kmaCardAction({ ...base, canEdit: false })).toBeNull();
    expect(kmaCardAction({ ...base, canEdit: false, hasPlans: true })).toBeNull();
  });

  it('ingen knapp när servern säger nej (skrivnyckeln saknas)', () => {
    expect(kmaCardAction({ ...base, canCreate: false })).toBeNull();
  });

  it('ingen knapp efter ett laddfel — vi vet inte om ordern redan har en plan', () => {
    expect(kmaCardAction({ ...base, loadError: true })).toBeNull();
  });
});

describe('kmaSourceNote', () => {
  const same = (iso: string) => iso;

  it('säger varifrån organisationen kom', () => {
    expect(kmaSourceNote({ kind: 'revision', revision: 2, issuedOn: '2026-09-20' }, same)).toBe(
      'Förifylld med revision 2 från 2026-09-20. Ändra det som är nytt.',
    );
    expect(kmaSourceNote({ kind: 'mine', projectName: 'Hus A', issuedOn: '2026-09-20', createdByName: 'Petra' }, same)).toContain(
      'din KMA-plan för Hus A (2026-09-20)',
    );
    expect(kmaSourceNote({ kind: 'company', projectName: 'Hus B', issuedOn: '2026-09-01', createdByName: 'Kalle' }, same)).toContain(
      'skapad av Kalle (2026-09-01)',
    );
    expect(kmaSourceNote({ kind: 'blank' }, same)).toContain('Första KMA-planen');
  });
});

describe('kmaFieldErrors', () => {
  it('felen nycklas på fältets sökväg, första meddelandet vinner', () => {
    const form = kmaForm();
    form.organisation.projectManager.name = '';
    form.project.materials = [];
    form.contacts[1].role = '';
    const parsed = kmaFormSchema.safeParse(form);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const errors = kmaFieldErrors(parsed.error);
    expect(errors['organisation.projectManager.name']).toBe('Ange KMA-ansvarig / projektledare');
    expect(errors['project.materials']).toBe('Välj minst ett material');
    expect(errors['contacts.1.role']).toBe('Roll saknas');
  });
});

describe('mergeKmaCrew', () => {
  const crew = {
    crewContacts: [
      { name: 'Lars Ledare', role: 'Ledande installatör', phone: '070-111 11 11' },
      { name: 'Nya Nisse', role: 'Installatör', phone: '' },
    ],
    crewSigners: [
      { name: 'Lars Ledare', role: 'Ledande installatör' },
      { name: 'Nya Nisse', role: 'Installatör' },
    ],
  };

  it('lägger till de som saknas och rör inte det som redan står där', () => {
    const form = kmaForm(); // har redan Lars Ledare (som kontakt och signerare) och Sara Säljare
    const merged = mergeKmaCrew(form, crew);
    expect(merged.contacts.map((c) => c.name)).toEqual(['Sara Säljare', 'Lars Ledare', 'Ida Installatör', 'Nya Nisse']);
    expect(merged.signers.ongoing.map((s) => s.name)).toEqual(['Lars Ledare', 'Ida Installatör', 'Nya Nisse']);
    // Handredigerade värden står kvar — Lars rad är den gamla, inte planeringens.
    expect(merged.contacts[1]).toEqual(form.contacts[1]);
  });

  it('matchar namn oavsett skiftläge och mellanslag', () => {
    const form = kmaForm();
    form.contacts = [{ name: '  nya   NISSE ', role: 'Installatör', phone: '' }];
    expect(mergeKmaCrew(form, crew).contacts.map((c) => c.name)).toEqual(['  nya   NISSE ', 'Lars Ledare']);
  });

  it('löpande signerare stannar vid mallens tio rader', () => {
    const form = kmaForm();
    form.signers.ongoing = Array.from({ length: 9 }, (_, i) => ({ name: `Person ${i}`, role: 'Installatör' }));
    expect(mergeKmaCrew(form, crew).signers.ongoing).toHaveLength(10);
  });

  it('antalet som saknas styr knappen', () => {
    expect(kmaMissingCrewCount(kmaForm(), crew.crewContacts)).toBe(1);
    expect(kmaMissingCrewCount(mergeKmaCrew(kmaForm(), crew), crew.crewContacts)).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';

import {
  buildKmaPrefill,
  kmaProjectNumber,
  kmaPropertyLine,
  lookupDirectoryPhone,
  type KmaDirectoryEntry,
  type KmaOrderSource,
  type KmaStoredPlanSource,
} from '@/lib/domains/crm/kmaPlans/prefill';
import type { WorkOrderCrewPerson } from '@/lib/domains/planning/workOrderCrew';

import { kmaForm } from './helpers/kmaFixtures';

// Förifyllnaden: vad dialogen öppnar med. Det som prövas är källornas ordning och de två reglerna
// som skyddar dokumentet som går till beställaren — telefonnummer bara vid entydig träff, och
// arbetsbeskrivningen (portkoder) läses aldrig.

const order = (overrides: Partial<KmaOrderSource> = {}): KmaOrderSource => ({
  project_name: 'Vindsbjälklag Hus A–C',
  client_name: 'Testfastigheter AB',
  order_number: 'AO-20260924-AB12CD',
  fortnox_order_number: '6579',
  work_address: { street_address: 'Testgatan 1', postal_code: '811 21', city: 'Sandviken' },
  customer_snapshot: {},
  rot_details: null,
  line_items: [{ article_name: 'EKOVILLA LÖSULL', pricing_mode: 'm3', m2: '100', thickness_mm: '300', density: '30' }],
  assignee: null,
  ...overrides,
});

const stored = (overrides: Partial<KmaStoredPlanSource> = {}): KmaStoredPlanSource => ({
  input: kmaForm(),
  project_name: 'Tidigare projekt',
  issued_on: '2026-09-01',
  created_by_name: 'Petra Projektledare',
  revision: 1,
  ...overrides,
});

const crewPerson = (name: string, leader = false): WorkOrderCrewPerson => ({ member_id: `id-${name}`, member_name: name, leader });

const directory: KmaDirectoryEntry[] = [
  { name: 'Lars Ledare', phone: '070-111 11 11', role: 'Installatör' },
  { name: 'Sara Säljare', phone: '070-222 22 22', role: 'Säljare' },
  { name: 'Petra Projektledare', phone: '070-999 99 99', role: 'Projektledare' },
  { name: 'Johan Andersson', phone: '070-333 33 33', role: null },
  { name: 'Johan Andersson', phone: '070-444 44 44', role: null },
];

const base = {
  crew: [] as WorkOrderCrewPerson[],
  directory,
  salesName: null,
  orderLatest: null,
  mineLatest: null,
  companyLatest: null,
};

describe('lookupDirectoryPhone', () => {
  it('exakt namn, oavsett skiftläge och mellanslag', () => {
    expect(lookupDirectoryPhone(directory, '  lars   LEDARE ')).toBe('070-111 11 11');
  });

  it('ett delnamn matchar INTE — hellre tomt än fel nummer', () => {
    expect(lookupDirectoryPhone(directory, 'Lars')).toBe('');
  });

  it('två personer med samma namn och olika nummer ger tomt', () => {
    expect(lookupDirectoryPhone(directory, 'Johan Andersson')).toBe('');
  });

  it('samma nummer två gånger, olika formaterat, är fortfarande entydigt', () => {
    const dup: KmaDirectoryEntry[] = [
      { name: 'Eva Ek', phone: '070-555 55 55', role: null },
      { name: 'Eva Ek', phone: '0705555555', role: null },
    ];
    expect(lookupDirectoryPhone(dup, 'Eva Ek')).toBe('070-555 55 55');
  });

  it('tomt namn ger tomt', () => {
    expect(lookupDirectoryPhone(directory, '   ')).toBe('');
  });
});

describe('kmaProjectNumber / kmaPropertyLine', () => {
  it('Fortnox-numret rått när ordern synkats, annars AO-numret — aldrig "#"', () => {
    expect(kmaProjectNumber({ fortnox_order_number: '6579', order_number: 'AO-X' })).toBe('6579');
    expect(kmaProjectNumber({ fortnox_order_number: null, order_number: 'AO-20260924-AB12CD' })).toBe('AO-20260924-AB12CD');
    expect(kmaProjectNumber({ fortnox_order_number: '#6579', order_number: 'AO-X' })).toBe('6579');
  });

  it('fastighetsbeteckningen först när den finns, sedan adressen', () => {
    // Adressen i planeringskortens format (resolveJobAddress) — samma reservordning som ordern själv.
    expect(kmaPropertyLine(order())).toBe('Testgatan 1, 811 21, Sandviken');
    expect(kmaPropertyLine(order({ rot_details: { property_designation: 'Hästen 1:23' } }))).toBe(
      'Hästen 1:23, Testgatan 1, 811 21, Sandviken',
    );
  });
});

describe('buildKmaPrefill — Revidera', () => {
  it('ordens senaste plan kopieras rakt av', () => {
    const saved = kmaForm({ extraRisks: [{ risk: 'Asbest', action: 'Provtagning' }] });
    const result = buildKmaPrefill({ ...base, order: order(), orderLatest: stored({ input: saved, revision: 2 }) });
    expect(result.form).toEqual(saved);
    expect(result.source).toEqual({ kind: 'revision', revision: 2, issuedOn: '2026-09-01' });
  });

  it('planeringens besättning erbjuds som förslag vid revidering', () => {
    const result = buildKmaPrefill({
      ...base,
      order: order(),
      crew: [crewPerson('Lars Ledare', true)],
      orderLatest: stored(),
    });
    expect(result.suggestions.crewSigners).toEqual([{ name: 'Lars Ledare', role: 'Ledande installatör' }]);
    expect(result.suggestions.crewContacts[0].phone).toBe('070-111 11 11');
  });

  it('en trasig sparad plan fäller inte dialogen — men det SYNS att förra revisionen inte gick att läsa', () => {
    const result = buildKmaPrefill({ ...base, order: order(), orderLatest: stored({ input: { v: 99 }, revision: 3 }) });
    expect(result.source).toEqual({ kind: 'blank' });
    expect(result.unreadableRevision).toBe(3);
    expect(result.form.project.projectNumber).toBe('6579');
  });

  it('en läsbar revision flaggas inte, och en ny order har ingen revision att flagga', () => {
    expect(buildKmaPrefill({ ...base, order: order(), orderLatest: stored() }).unreadableRevision).toBeNull();
    expect(buildKmaPrefill({ ...base, order: order() }).unreadableRevision).toBeNull();
  });
});

describe('buildKmaPrefill — ny plan', () => {
  it('projektfälten kommer ur ordern', () => {
    const { form } = buildKmaPrefill({ ...base, order: order() });
    expect(form.project).toEqual({
      projectName: 'Vindsbjälklag Hus A–C',
      customerName: 'Testfastigheter AB',
      projectNumber: '6579',
      properties: ['Testgatan 1, 811 21, Sandviken'],
      workType: 'tilläggsisolering',
      commitment: 'Tilläggsisolering / Isoleringsentreprenad',
      materials: ['EKOVILLA'],
    });
  });

  it('organisationsblocket ärvs ur MIN senaste plan före bolagets', () => {
    const mine = kmaForm();
    mine.organisation.siteRoundsBy = 'Min rondledare';
    const company = kmaForm();
    company.organisation.siteRoundsBy = 'Bolagets rondledare';
    const result = buildKmaPrefill({
      ...base,
      order: order(),
      mineLatest: stored({ input: mine, project_name: 'Mitt förra' }),
      companyLatest: stored({ input: company, project_name: 'Bolagets förra' }),
    });
    expect(result.form.organisation.siteRoundsBy).toBe('Min rondledare');
    expect(result.source).toMatchObject({ kind: 'mine', projectName: 'Mitt förra' });
  });

  it('bolagets senaste när jag aldrig skapat en (eller min är oläslig)', () => {
    const company = kmaForm();
    company.organisation.siteRoundsBy = 'Bolagets rondledare';
    const result = buildKmaPrefill({
      ...base,
      order: order(),
      mineLatest: stored({ input: { trasig: true } }),
      companyLatest: stored({ input: company, project_name: 'Bolagets förra', created_by_name: 'Kollega' }),
    });
    expect(result.form.organisation.siteRoundsBy).toBe('Bolagets rondledare');
    expect(result.source).toEqual({ kind: 'company', projectName: 'Bolagets förra', issuedOn: '2026-09-01', createdByName: 'Kollega' });
  });

  it('utan tidigare planer: tomma namn, mallens standardvärden', () => {
    const { form, source } = buildKmaPrefill({ ...base, order: order() });
    expect(source).toEqual({ kind: 'blank' });
    expect(form.organisation.projectManager).toEqual({ name: '', phone: '', email: '' });
    expect(form.organisation.deviationRecipient).toBe('Ansvarig projektledare i vårt interna arbetssystem');
    expect(form.selfCheckResponsible.thickness).toBe('Ledande installatör');
    expect(form.signers.verifying).toEqual([]);
  });

  it('ärvda nummer uppdateras ur Kontaktlistan vid entydig träff, annars står de kvar', () => {
    const mine = kmaForm();
    mine.organisation.projectManager = { name: 'Petra Projektledare', phone: '070-000 00 00', email: 'p@example.se' };
    mine.organisation.quality = { name: 'Johan Andersson', phone: '070-777 77 77', email: '' };
    const { form } = buildKmaPrefill({ ...base, order: order(), mineLatest: stored({ input: mine }) });
    expect(form.organisation.projectManager.phone).toBe('070-999 99 99');
    // Tvetydigt i Kontaktlistan → det ärvda numret står kvar, inget gissat.
    expect(form.organisation.quality.phone).toBe('070-777 77 77');
  });

  it('projektspecifika risker ärvs aldrig från en annan order', () => {
    const mine = kmaForm({ extraRisks: [{ risk: 'Asbest', action: 'Provtagning' }] });
    const { form } = buildKmaPrefill({ ...base, order: order(), mineLatest: stored({ input: mine }) });
    expect(form.extraRisks).toEqual([]);
  });

  it('säljaren och besättningen blir kontakter, besättningen också löpande signerare', () => {
    const { form } = buildKmaPrefill({
      ...base,
      order: order({ assignee: { full_name: 'Sara Säljare' } }),
      crew: [crewPerson('Lars Ledare', true), crewPerson('Okänd Montör')],
    });
    expect(form.contacts).toEqual([
      { name: 'Sara Säljare', role: 'Försäljningsansvarig', phone: '070-222 22 22' },
      { name: 'Lars Ledare', role: 'Ledande installatör', phone: '070-111 11 11' },
      { name: 'Okänd Montör', role: 'Installatör', phone: '' },
    ]);
    expect(form.signers.ongoing).toEqual([
      { name: 'Lars Ledare', role: 'Ledande installatör' },
      { name: 'Okänd Montör', role: 'Installatör' },
    ]);
  });

  it('säljarnamnet från sidan används när embedden är null (profiles är self-read)', () => {
    const { form } = buildKmaPrefill({ ...base, order: order({ assignee: null }), salesName: 'Sara Säljare' });
    expect(form.contacts[0]).toEqual({ name: 'Sara Säljare', role: 'Försäljningsansvarig', phone: '070-222 22 22' });
  });

  it('löpande signerare kapas vid mallens tio rader', () => {
    const crew = Array.from({ length: 12 }, (_, i) => crewPerson(`Montör ${String.fromCharCode(65 + i)}`));
    const { form } = buildKmaPrefill({ ...base, order: order(), crew });
    expect(form.signers.ongoing).toHaveLength(10);
    expect(form.contacts).toHaveLength(12);
  });

  it('kontakterna kapas vid schemats tak — annars kunde förifyllnaden inte sparas', () => {
    const crew = Array.from({ length: 40 }, (_, i) => crewPerson(`Montör ${i + 1}`));
    const { form } = buildKmaPrefill({ ...base, order: order({ assignee: { full_name: 'Sara Säljare' } }), crew });
    expect(form.contacts).toHaveLength(30);
    expect(form.contacts[0].name).toBe('Sara Säljare');
  });

  it('arbetsbeskrivningen läses aldrig — portkoden når inte förifyllnaden', () => {
    const leaky = {
      ...order(),
      internal_handoff: { handoff_notes: 'Portkod 1234', work_scope: 'Hemligt scope' },
      notes: 'Portkod 1234',
    } as unknown as KmaOrderSource;
    const result = buildKmaPrefill({ ...base, order: leaky });
    expect(JSON.stringify(result)).not.toContain('Portkod');
    expect(JSON.stringify(result)).not.toContain('Hemligt');
  });
});

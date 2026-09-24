import { describe, it, expect } from 'vitest';

import { buildKmaDocument, type KmaDocumentContext } from '@/lib/domains/crm/kmaPlans/document';
import { kmaFormSchema, parseStoredKmaDocument, parseStoredKmaInput } from '@/lib/domains/crm/kmaPlans/schemas';
import type { KmaBlock, KmaDocument } from '@/lib/domains/crm/kmaPlans/types';

import { kmaForm } from './helpers/kmaFixtures';

// KMA-planens dokument: vad som står var. Det som prövas är löftena till beställaren — rätt bolag,
// rätt material, rätt datum — och att dokumentet är en ren funktion av formuläret, eftersom det är
// det som sparas och renderas igen vid varje omladdning.

const CTX: KmaDocumentContext = { revision: 1, issuedOn: '2026-09-24', firstIssuedOn: '2026-09-24' };

const section = (doc: KmaDocument, key: string) => {
  const found = doc.sections.find((s) => s.key === key);
  if (!found) throw new Error(`avsnittet ${key} saknas`);
  return found;
};

/** All text i ett avsnitt, rubriker, stycken, fält och celler inräknade. */
const textOf = (blocks: KmaBlock[]) =>
  blocks
    .flatMap((b) => {
      switch (b.t) {
        case 'title':
          return [b.text, b.sub ?? ''];
        case 'h1':
        case 'h2':
        case 'h3':
          return [b.text];
        case 'p':
          return [b.lead ?? '', b.text];
        case 'list':
          return b.items;
        case 'fields':
          return b.rows.flat();
        case 'table':
          return [...b.columns.map((c) => c.head), ...b.rows.flat()];
        case 'signature':
          return [b.label];
        default:
          return [];
      }
    })
    .join('\n');

const fieldValue = (blocks: KmaBlock[], label: string) => {
  for (const b of blocks) {
    if (b.t !== 'fields') continue;
    const row = b.rows.find(([l]) => l === label);
    if (row) return row[1];
  }
  return undefined;
};

const tables = (blocks: KmaBlock[]) => blocks.filter((b): b is Extract<KmaBlock, { t: 'table' }> => b.t === 'table');

describe('buildKmaDocument — bolaget', () => {
  it('entreprenören är alltid Isoleringslandslaget AB 559022-5800', () => {
    const doc = buildKmaDocument(kmaForm(), CTX);
    expect(fieldValue(section(doc, 'main').blocks, 'Företag')).toBe('Isoleringslandslaget AB 559022-5800');
  });

  it('"Ekovilla se AB" står ingenstans — mallens bilagetabell sa det för bilaga 2–4', () => {
    const doc = buildKmaDocument(kmaForm(), CTX);
    expect(JSON.stringify(doc)).not.toContain('Ekovilla se AB');
    const appendixTable = tables(section(doc, 'main').blocks).find((t) => t.columns[0].head === 'Bilaga');
    for (const row of appendixTable!.rows.slice(1, 5)) expect(row[1]).toMatch(/– Isoleringslandslaget AB$/);
  });

  it('foten bär bolagsraden ur mallen', () => {
    expect(buildKmaDocument(kmaForm(), CTX).footer).toBe(
      'Ekovilla AB / Isoleringslandslaget AB - 020-44 66 40 - Info@ekovilla.se',
    );
  });
});

describe('buildKmaDocument — version och revision', () => {
  it('"Version 2.0" är mallens och står fast; revisionen står bredvid', () => {
    const main = section(buildKmaDocument(kmaForm(), CTX), 'main').blocks;
    expect(fieldValue(main, 'Version')).toBe('2.0');
    expect(fieldValue(main, 'Revision')).toBe('1');
  });

  it('en senare revision anger när planen upprättades', () => {
    const doc = buildKmaDocument(kmaForm(), { revision: 3, issuedOn: '2026-10-02', firstIssuedOn: '2026-09-24' });
    expect(fieldValue(section(doc, 'main').blocks, 'Revision')).toBe('3 (upprättad 2026-09-24)');
    expect(fieldValue(section(doc, 'main').blocks, 'Datum')).toBe('2026-10-02');
    expect(fieldValue(section(doc, 'a8').blocks, 'Upprättad/reviderad')).toBe('2026-09-24 / 2026-10-02');
    expect(doc.running).toBe('KMA-plan · 6579 · Revision 3');
  });

  it('inga andra datum än planens egna — inget utskriftsdatum', () => {
    // ⚠️ Datumen ligger i det FÖRFLUTNA med flit: ett av dem får aldrig kunna vara "i dag", annars är
    // testet blint för ett utskriftsdatum just den dag det körs (fixturen hade först dagens datum).
    const doc = buildKmaDocument(kmaForm(), { revision: 2, issuedOn: '2020-02-03', firstIssuedOn: '2020-01-15' });
    const dates = new Set(JSON.stringify(doc).match(/\d{4}-\d{2}-\d{2}/g));
    expect([...dates].sort()).toEqual(['2020-01-15', '2020-02-03']);
  });

  it('samma formulär ger samma dokument', () => {
    expect(buildKmaDocument(kmaForm(), CTX)).toEqual(buildKmaDocument(kmaForm(), CTX));
  });
});

describe('buildKmaDocument — materialet', () => {
  it('Knauf-order: ingen cellulosamening, Knaufs certifikat', () => {
    const form = kmaForm();
    form.project.materials = ['KNAUF SUPAFIL'];
    const main = textOf(section(buildKmaDocument(form, CTX), 'main').blocks);
    expect(main).toContain('vid tilläggsisolering med glasullsisolering (lösull).');
    expect(main).not.toContain('tidningspapper');
    expect(main).toContain('B0709EPCR');
    expect(main).not.toContain('09/0081');
  });

  it('Ekovilla-order: cellulosameningen, ingen Knaufmening i huvuddokumentet', () => {
    const main = textOf(section(buildKmaDocument(kmaForm(), CTX), 'main').blocks);
    expect(main).toContain('vid tilläggsisolering med cellulosaisolering (lösull).');
    expect(main).toContain('tidningspapper');
    expect(main).not.toContain('Knauf');
  });

  it('bilaga 6: asterisk och takfotsnot bara vid cellulosa, λ bara vid ett material', () => {
    const ekovilla = section(buildKmaDocument(kmaForm(), CTX), 'a6').blocks;
    expect(textOf(ekovilla)).toContain('Luftspalt*');
    expect(textOf(ekovilla)).toContain('takfotsventilation');
    expect(tables(ekovilla)[1].rows[0].at(-1)).toBe('0,038');

    const form = kmaForm();
    form.project.materials = ['KNAUF SUPAFIL', 'EKOVILLA'];
    const both = section(buildKmaDocument(form, CTX), 'a6').blocks;
    expect(tables(both)[1].rows[0].at(-1)).toBe('');

    form.project.materials = ['KNAUF SUPAFIL'];
    const knauf = textOf(section(buildKmaDocument(form, CTX), 'a6').blocks);
    expect(knauf).not.toContain('Luftspalt*');
    expect(knauf).not.toContain('takfotsventilation');
  });
});

describe('buildKmaDocument — projektets uppgifter', () => {
  it('projektledaren står i kontaktlistan, efter den fasta VD-raden', () => {
    const main = section(buildKmaDocument(kmaForm(), CTX), 'main').blocks;
    const contacts = tables(main).find((t) => t.columns[0].head === 'Namn')!;
    expect(contacts.rows[0]).toEqual(['Andreas Östlund', 'VD / Teknisk expert', '072-459 99 98']);
    expect(contacts.rows[1]).toEqual(['Petra Projektledare', 'Projektledare', '070-000 00 01']);
    expect(contacts.rows[2]).toEqual(['Sara Säljare', 'Försäljningsansvarig', '070-000 00 04']);
  });

  it('bilaga 7 har samma kontaktlista som §2', () => {
    const doc = buildKmaDocument(kmaForm(), CTX);
    const main = tables(section(doc, 'main').blocks).find((t) => t.columns[0].head === 'Namn')!;
    expect(tables(section(doc, 'a7').blocks)[0].rows).toEqual(main.rows);
  });

  it('extra risker hamnar i §5:s tabell och som Risk 5… i bilaga 1, med åtgärden i åtgärdsplanen', () => {
    const form = kmaForm({ extraRisks: [{ risk: 'Asbest i befintlig isolering', action: 'Provtagning före start' }] });
    const doc = buildKmaDocument(form, CTX);
    const riskTable = tables(section(doc, 'main').blocks).find((t) => t.columns[0].head === 'Risk')!;
    expect(riskTable.rows.at(-1)).toEqual(['Asbest i befintlig isolering', 'Provtagning före start']);
    const a1 = section(doc, 'a1').blocks;
    expect(fieldValue(a1, 'Risk 5:')).toBe('Asbest i befintlig isolering');
    expect(textOf(a1)).toContain('Provtagning före start');
  });

  it('bilaga 1: fastigheterna, och kvalitets- och arbetsmiljöansvarig med kontaktuppgifter', () => {
    const form = kmaForm();
    form.project.properties = ['Hus A, Testgatan 1', 'Hus B, Testgatan 3'];
    const a1 = section(buildKmaDocument(form, CTX), 'a1').blocks;
    expect(fieldValue(a1, 'Entreprenörens kvalitetsansvarig')).toBe('Kurt Kvalitet\n070-000 00 03\nkurt@example.se');
    const properties = a1.filter((b) => b.t === 'fields').flatMap((b) => (b.t === 'fields' ? b.rows : []));
    expect(properties.filter(([label]) => label === 'Fastighet:').map(([, v]) => v)).toEqual([
      'Hus A, Testgatan 1',
      'Hus B, Testgatan 3',
    ]);
  });

  it('bilaga 8: signerarna med dagens utgivningsdatum, tabellerna fylls ut till mallens storlek', () => {
    const a8 = section(buildKmaDocument(kmaForm(), CTX), 'a8').blocks;
    const [ongoing, verifying] = tables(a8);
    expect(ongoing.rows).toEqual([
      ['Lars Ledare', '', 'Ledande installatör', '2026-09-24'],
      ['Ida Installatör', '', 'Installatör', '2026-09-24'],
    ]);
    expect(ongoing.minRows).toBe(10);
    expect(verifying.minRows).toBe(7);
    expect(a8.at(-1)).toEqual({ t: 'signature', label: 'Namnteckning av behörig undertecknare:' });
  });

  it('bilagetabellens rad 1 är projektspecifik', () => {
    const main = section(buildKmaDocument(kmaForm(), CTX), 'main').blocks;
    const appendixTable = tables(main).find((t) => t.columns[0].head === 'Bilaga')!;
    expect(appendixTable.rows[0][2]).toBe('Projektspecifik för Vindsbjälklag Hus A–C');
    expect(appendixTable.rows).toHaveLength(8);
  });

  it('huvuddokument plus åtta bilagor, varje bilaga på ny sida', () => {
    const doc = buildKmaDocument(kmaForm(), CTX);
    expect(doc.sections.map((s) => s.key)).toEqual(['main', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']);
    expect(doc.sections[0].newPage).toBe(false);
    expect(doc.sections.slice(1).every((s) => s.newPage)).toBe(true);
  });
});

describe('schemas', () => {
  it('ALLT formuläret släpper igenom ger ett dokument som går att rendera', () => {
    // 🧨 Dokumentschemat hade 2000 tecken per cell medan bilaga 8:s projektcell (kund + projekt +
    // tio fastigheter) kan bli ~2 420: planen sparades, men PDF:en svarade med ett fel för alltid.
    // Här byggs dokumentet ur ett MAXIMALT formulär — varje fält vid sitt tak, varje lista full.
    const max = (n: number) => 'x'.repeat(n);
    const form = kmaFormSchema.parse({
      v: 1,
      project: {
        projectName: max(200),
        customerName: max(200),
        projectNumber: max(60),
        properties: Array.from({ length: 10 }, () => max(200)),
        workType: max(120),
        commitment: max(200),
        materials: ['EKOVILLA', 'KNAUF SUPAFIL', 'ISOCELL/ISECO', 'HUNTON NATIVO', 'PAROC'],
      },
      organisation: {
        // E-posten exakt vid taket: 149 + '@example.se' = 160 tecken.
        projectManager: { name: max(120), phone: max(40), email: `${'a'.repeat(149)}@example.se` },
        workEnvironment: { name: max(120), phone: max(40), email: '' },
        environment: { name: max(120), phone: max(40), email: '' },
        quality: { name: max(120), phone: max(40), email: '' },
        siteRoundsBy: max(120),
        deviationRecipient: max(200),
      },
      selfCheckResponsible: {
        incomingMaterial: max(80),
        density: max(80),
        thickness: max(80),
        airGaps: max(80),
        finalInspection: max(80),
      },
      contacts: Array.from({ length: 30 }, () => ({ name: max(120), role: max(80), phone: max(40) })),
      signers: {
        ongoing: Array.from({ length: 10 }, () => ({ name: max(120), role: max(80) })),
        verifying: Array.from({ length: 7 }, () => ({ name: max(120), role: max(80) })),
      },
      extraRisks: Array.from({ length: 10 }, () => ({ risk: max(300), action: max(400) })),
    });
    const doc = buildKmaDocument(form, { revision: 99, issuedOn: '2026-09-24', firstIssuedOn: '2026-01-01' });
    expect(parseStoredKmaDocument(doc)).not.toBeNull();
  });

  it('ett byggt dokument klarar dokumentschemat (det som prövas före rendering)', () => {
    expect(parseStoredKmaDocument(buildKmaDocument(kmaForm(), CTX))).not.toBeNull();
  });

  it('ett trasigt eller okänt dokument avvisas i stället för att renderas fel', () => {
    const doc = buildKmaDocument(kmaForm(), CTX) as unknown as Record<string, unknown>;
    expect(parseStoredKmaDocument({ ...doc, layout: 2 })).toBeNull();
    expect(parseStoredKmaDocument({ ...doc, sections: [] })).toBeNull();
    expect(parseStoredKmaDocument(null)).toBeNull();
  });

  it('formuläret: okända nycklar filtreras bort — bolaget kommer aldrig ur kroppen', () => {
    const parsed = kmaFormSchema.parse({ ...kmaForm(), company: { name: 'Annat AB' } });
    expect(parsed).not.toHaveProperty('company');
  });

  it('formuläret: tomma fastighetsrader filtreras, men minst en krävs', () => {
    const form = kmaForm();
    form.project.properties = ['', 'Testgatan 1', '  '];
    expect(kmaFormSchema.parse(form).project.properties).toEqual(['Testgatan 1']);
    form.project.properties = [''];
    expect(kmaFormSchema.safeParse(form).success).toBe(false);
  });

  it('formuläret: minst ett känt material', () => {
    const form = kmaForm();
    form.project.materials = [];
    expect(kmaFormSchema.safeParse(form).success).toBe(false);
    form.project.materials = ['ROCKWOOL'];
    expect(kmaFormSchema.safeParse(form).success).toBe(false);
  });

  it('formuläret: e-post får vara tom men inte trasig', () => {
    const form = kmaForm();
    form.organisation.environment.email = 'inte-en-adress';
    expect(kmaFormSchema.safeParse(form).success).toBe(false);
  });

  it('formuläret: högst tio löpande signerare, som mallens tabell', () => {
    const form = kmaForm();
    form.signers.ongoing = Array.from({ length: 11 }, (_, i) => ({ name: `Person ${i}`, role: 'Installatör' }));
    expect(kmaFormSchema.safeParse(form).success).toBe(false);
  });

  it('en sparad input med okänd version ger null (förifyllnaden går vidare)', () => {
    expect(parseStoredKmaInput({ ...kmaForm(), v: 2 })).toBeNull();
    expect(parseStoredKmaInput(kmaForm())).not.toBeNull();
  });
});

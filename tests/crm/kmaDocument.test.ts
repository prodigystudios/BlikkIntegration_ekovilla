import { describe, it, expect } from 'vitest';

import { buildKmaDocument, type KmaDocumentContext } from '@/lib/domains/crm/kmaPlans/document';
import { kmaFormSchema, parseStoredKmaDocument, parseStoredKmaInput } from '@/lib/domains/crm/kmaPlans/schemas';
import type { KmaBlock, KmaDocument } from '@/lib/domains/crm/kmaPlans/types';
import {
  EGENKONTROLL_CHECKS,
  EGENKONTROLL_CLOSED_STAGE_COLUMNS,
  EGENKONTROLL_MAX_STAGE_ROWS,
  EGENKONTROLL_OPEN_STAGE_COLUMNS,
  EGENKONTROLL_SECTIONS,
} from '@/lib/domains/egenkontroll/template';

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
  it('raden Företag bär entreprenören först och Ekovilla under, båda med org.nr', () => {
    const doc = buildKmaDocument(kmaForm(), CTX);
    // William 2026-10-20. Skiftlägeskänsligt med flit: stavningen är bolagets egen, som i bilaga 5.
    expect(fieldValue(section(doc, 'main').blocks, 'Företag')).toBe('Isoleringslandslaget AB 559022-5800\nEKOVILLA se AB 559341-9673');
  });

  // William 2026-10-20: "Betalningsplan- 25e varje månad", överst bland projektets fakta.
  it('betalningsplanen står under Projektnummer', () => {
    const blocks = section(buildKmaDocument(kmaForm(), CTX), 'main').blocks;
    expect(fieldValue(blocks, 'Betalningsplan')).toBe('25:e varje månad');
    const head = blocks.find((b): b is Extract<KmaBlock, { t: 'fields' }> => b.t === 'fields');
    const labels = head!.rows.map(([label]) => label);
    expect(labels.indexOf('Betalningsplan')).toBe(labels.indexOf('Projektnummer') + 1);
  });

  it('entreprenören i planens texter är alltid Isoleringslandslaget AB', () => {
    const blocks = section(buildKmaDocument(kmaForm(), CTX), 'main').blocks;
    const intro = blocks.find((b): b is Extract<KmaBlock, { t: 'p' }> => b.t === 'p' && /^Denna KMA-plan beskriver hur/.test(b.text));
    expect(intro?.text).toMatch(/^Denna KMA-plan beskriver hur Isoleringslandslaget AB arbetar/);
  });

  it('"Ekovilla se AB" står bara på raden Företag och i policyn — mallens bilagetabell sa det för bilaga 2–4', () => {
    const doc = buildKmaDocument(kmaForm(), CTX);
    // Skiftlägesokänsligt: bilaga 5 (VD:s policy, ordagrann) räknar upp "EKOVILLA se AB" bland koncernens
    // bolag, och med en skiftlägeskänslig jämförelse hade vakten varit grön av en slump. Policyn undantas,
    // och raden Företag bär bolaget sedan 2026-10-20 (Williams beslut). Ingen annan del av planen får nämna det.
    expect(JSON.stringify(section(doc, 'a5'))).toMatch(/ekovilla se ab/i);
    const outsidePolicy = JSON.stringify({ ...doc, sections: doc.sections.filter((s) => s.key !== 'a5') });
    expect(outsidePolicy.match(/ekovilla se ab/gi)).toHaveLength(1);
    const appendixTable = tables(section(doc, 'main').blocks).find((t) => t.columns[0].head === 'Bilaga');
    for (const row of appendixTable!.rows.slice(1, 4)) expect(row[1]).toMatch(/– Isoleringslandslaget AB$/);
    // Bilaga 5 är koncernens policy, inte Isoleringslandslagets egen.
    expect(appendixTable!.rows[4][1]).toBe('Kvalitets- och miljöpolicy – Ekovilla Sverige');
  });

  it('foten bär bolagsraden ur mallen', () => {
    expect(buildKmaDocument(kmaForm(), CTX).footer).toBe(
      'Ekovilla AB / Isoleringslandslaget AB - 020-44 66 40 - Info@ekovilla.se',
    );
  });
});

describe('buildKmaDocument — version och revision', () => {
  it('"Version 2.2" är mallens och står fast; revisionen står bredvid', () => {
    const main = section(buildKmaDocument(kmaForm(), CTX), 'main').blocks;
    expect(fieldValue(main, 'Version')).toBe('2.2');
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
});

describe('buildKmaDocument — avvikelsemottagaren', () => {
  it('en mottagare som redan slutar med punkt ger ingen dubbelpunkt mitt i stycket', () => {
    const form = kmaForm();
    form.organisation.deviationRecipient = 'Projektledare Anna Svensson.';
    const main = textOf(section(buildKmaDocument(form, CTX), 'main').blocks);
    expect(main).toContain('Alla avvikelser rapporteras till Projektledare Anna Svensson. Avvikelser från');
    expect(main).not.toContain('..');
  });
});

describe('buildKmaDocument — Ekovilla Sveriges kvalitets- och miljöpolicy', () => {
  // VD:s policy (fastställd 2 februari 2026) ersatte gamla bilaga 5, som kallade glasull från Knauf
  // för vår huvudprodukt och lovade en WWF-gåva VD inte står bakom.
  it('bilaga 5 är policyn, med VD:s datum och underskrift', () => {
    const a5 = section(buildKmaDocument(kmaForm(), CTX), 'a5').blocks;
    expect(a5[0]).toEqual({ t: 'h1', text: 'Bilaga 5 – Kvalitets- och miljöpolicy – Ekovilla Sverige' });
    expect(fieldValue(a5, 'Fastställd')).toBe('2 februari 2026');
    expect(fieldValue(a5, 'Ort och datum')).toBe('Sandviken den 2 februari 2026');
    const h2 = a5.flatMap((b) => (b.t === 'h2' ? [b.text] : []));
    expect(h2.slice(0, 8).map((h) => h.split('.')[0])).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(textOf(a5)).toContain('RIV-2024-PROJ-75');
  });

  it('gamla miljöledningstexten är borta överallt — ingen Knauf-huvudprodukt, ingen WWF', () => {
    for (const materials of [['EKOVILLA'], ['KNAUF SUPAFIL']]) {
      const form = kmaForm();
      form.project.materials = materials;
      const json = JSON.stringify(buildKmaDocument(form, CTX));
      for (const old of ['huvudprodukt', 'WWF', '10 % av vår vinst', 'Miljöledningssystem', 'ger inget spill']) expect(json).not.toContain(old);
    }
  });

  it('huvuddokumentet bär policyns åtaganden: regelverk, ansvar, kvalitetsmål, BAS-U', () => {
    const main = textOf(section(buildKmaDocument(kmaForm(), CTX), 'main').blocks);
    for (const expected of [
      'AFS 2023:13',
      'AB 04, ABT 06 eller ABU 07 enligt avtal',
      'Entreprenadchef ansvarar',
      'Kvalitetsmål',
      'minst 95 % leveranssäkerhet',
      'ID06 Kompetensdatabas',
      'BAS-U',
      'säkerhetsdatablad',
      'fossilfria drivmedel',
    ])
      expect(main).toContain(expected);
  });

  it('Ekovillas EPD- och λ-mening bara när ordern har EKOVILLA', () => {
    const knauf = kmaForm();
    knauf.project.materials = ['KNAUF SUPAFIL'];
    expect(textOf(section(buildKmaDocument(kmaForm(), CTX), 'main').blocks)).toContain('0,038 W/mK');
    expect(textOf(section(buildKmaDocument(knauf, CTX), 'main').blocks)).not.toContain('0,038 W/mK');
  });
});

describe('buildKmaDocument — bilaga 6 är egenkontrollen, tom', () => {
  // Bilagan byggdes först efter en äldre Word-mall och visade en egenkontroll som inte används
  // (Luftspalt, produktcertifikat, platschefens signatur). Nu är den egenkontrollens egen blankett,
  // på två sidor som egenkontrollen: etapperna och signaturen börjar på en egen.
  const a6 = (doc: KmaDocument) => [...section(doc, 'a6').blocks, ...section(doc, 'a6-etapper').blocks];

  it('etapperna och signaturen börjar på ny sida, båda etapptabellerna på samma', () => {
    const etapper = section(buildKmaDocument(kmaForm(), CTX), 'a6-etapper');
    expect(etapper.newPage).toBe(true);
    // Sidan som fylls i och skrivs under ska gå att känna igen även lös.
    expect(etapper.blocks[0]).toEqual({ t: 'h1', text: 'Bilaga 6 – Egenkontrollmall (forts.)' });
    expect(etapper.blocks.flatMap((b) => (b.t === 'h2' ? [b.text] : []))).toEqual(['Etapper (öppet)', 'Etapper (slutet)', 'Signatur']);
  });

  it('samma kort, fält, kontroller och kolumner som egenkontrollens PDF', () => {
    const blocks = a6(buildKmaDocument(kmaForm(), CTX));
    const h2 = blocks.flatMap((b) => (b.t === 'h2' ? [b.text] : []));
    expect(h2).toEqual(['Projekt', 'Material', 'Kontroller', 'Övriga kommentarer', 'Etapper (öppet)', 'Etapper (slutet)', 'Signatur']);
    expect(h2).toEqual(Object.values(EGENKONTROLL_SECTIONS));

    const labels = blocks.flatMap((b) => (b.t === 'fields' ? b.rows.map(([label]) => label) : []));
    expect(labels).toEqual([
      'Kund / beställare',
      'Adress',
      'Installationsdatum',
      'Ansvarig installatör',
      'Vårt ordernummer',
      'Projektnummer',
      'Använt material',
      'Datum och ort',
      'Underskrift',
      'Namnförtydligande',
    ]);

    const [checks, comments, open, closed] = tables(blocks);
    expect(checks.rows.map(([label]) => label)).toEqual(EGENKONTROLL_CHECKS.map((c) => c.label));
    expect(checks.rows[0][0]).toBe('Takfotsventilation');
    expect(comments.columns.map((c) => c.head)).toEqual(['Kommentar']);
    expect(open.columns.map((c) => c.head)).toEqual(EGENKONTROLL_OPEN_STAGE_COLUMNS.map((c) => c.label));
    expect(closed.columns.map((c) => c.head)).toEqual(EGENKONTROLL_CLOSED_STAGE_COLUMNS.map((c) => c.label));

    const text = textOf(blocks);
    for (const old of ['Luftspalt', 'Produktcertifikat', 'Isolerentreprenör', 'Platschef', 'Vi tackar']) expect(text).not.toContain(old);
  });

  it('inget förifylls: varje fält och varje ruta att skriva i är tom', () => {
    const blocks = a6(buildKmaDocument(kmaForm(), CTX));
    for (const block of blocks) if (block.t === 'fields') for (const [, value] of block.rows) expect(value).toBe('');

    const [checks, comments, open, closed] = tables(blocks);
    expect(checks.rows.flatMap((row) => row.slice(1)).every((cell) => cell === '')).toBe(true);
    expect(comments.rows).toEqual([['']]);
    // Lika många rader som formuläret tar — mallen ska rymma det appen släpper igenom.
    for (const stage of [open, closed]) {
      expect(stage.rows).toEqual([]);
      expect(stage.minRows).toBe(EGENKONTROLL_MAX_STAGE_ROWS);
    }
  });

  it('bilagan är densamma vilken order det än gäller', () => {
    const other = kmaForm();
    other.project.customerName = 'Annan Kund AB';
    other.project.projectNumber = '9999';
    other.project.properties = ['Annanvägen 2'];
    other.project.materials = ['KNAUF SUPAFIL', 'EKOVILLA'];
    expect(a6(buildKmaDocument(other, CTX))).toEqual(a6(buildKmaDocument(kmaForm(), CTX)));
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
    // Bilaga 6 är två avsnitt — egenkontrollens två sidor.
    expect(doc.sections.map((s) => s.key)).toEqual(['main', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a6-etapper', 'a7', 'a8']);
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

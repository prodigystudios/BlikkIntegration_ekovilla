import {
  EGENKONTROLL_CHECKS,
  EGENKONTROLL_CLOSED_STAGE_COLUMNS,
  EGENKONTROLL_COMMENT_FIELD,
  EGENKONTROLL_MATERIAL_FIELD,
  EGENKONTROLL_MAX_STAGE_ROWS,
  EGENKONTROLL_OPEN_STAGE_COLUMNS,
  EGENKONTROLL_PROJECT_FIELDS,
  EGENKONTROLL_SECTIONS,
  EGENKONTROLL_SIGNATURE_FIELDS,
  type EgenkontrollClosedStageKey,
  type EgenkontrollOpenStageKey,
} from '@/lib/domains/egenkontroll/template';

import { kmaEnvironmentSentences, kmaMaterialHandlingLines, kmaMaterialPhrase } from './materials';
import {
  KMA_A1_ACTION_PLAN,
  KMA_A1_RESIDUALS,
  KMA_A1_RISK_INTRO,
  KMA_A1_RISKS,
  KMA_A1_RULES,
  KMA_A2_PARAGRAPHS,
  KMA_A2_POINTS,
  KMA_A3_INTRO,
  KMA_A3_POINTS,
  KMA_A4_CONTENTS,
  KMA_A4_INTRO,
  KMA_A4_OUTRO,
  KMA_A5_META,
  KMA_A5_POLICY,
  KMA_A5_SIGNED,
  KMA_A5_TAGLINE,
  KMA_A8_CONFIRM,
  KMA_A8_ONGOING_ROWS,
  KMA_A8_SIGNATURE,
  KMA_A8_SUBTITLE,
  KMA_A8_VERIFYING_ROWS,
  KMA_APPENDICES,
  KMA_CEO_CONTACT,
  KMA_COMPANY,
  KMA_DEVIATION_ESCALATION,
  KMA_EMERGENCY,
  KMA_ENV_ACTIONS,
  KMA_ENV_ASPECTS,
  KMA_ENV_COMMITMENTS,
  KMA_ENV_GOALS,
  KMA_ENV_POLICY,
  KMA_FOLLOW_UP_FINAL,
  KMA_FOLLOW_UP_START,
  KMA_FOOTER,
  KMA_MATERIAL_APPROVAL_RULES,
  KMA_POLICY_RESPONSIBILITY,
  KMA_PPE,
  KMA_PURPOSE,
  KMA_QUALITY_GOALS,
  KMA_QUALITY_MEASURES,
  KMA_QUALITY_POLICY,
  KMA_RISKS,
  KMA_SELF_CHECK_NOTE,
  KMA_SELF_CHECK_POINTS,
  KMA_SITE_RULES,
  KMA_STANDARDS,
  KMA_STANDARDS_INTRO,
  KMA_STORAGE_RULE,
  KMA_SUBTITLE,
  KMA_TEMPLATE_VERSION,
  KMA_TITLE,
  KMA_WORK_ENV_POLICY,
} from './template';
import type { KmaBlock, KmaDocument, KmaFormValues, KmaPerson, KmaSection } from './types';

// Formulär → hela dokumentet: huvuddokumentet och bilaga 1–8, varje bilaga på ny sida.
//
// Ren och deterministisk: samma formulär och samma revision ger samma dokument, byte för byte i
// JSON. Här står VAD som skrivs var — renderaren (pdf.ts) vet bara hur block ritas.
//
// ⚠️ INGET UTSKRIFTSDATUM. Dokumentet bär bara utgivningsdatumen, som är fakta om planen. Ett
// "utskrivet i dag" hade gjort varje omladdning till ett annat dokument än det kunden fick.

export type KmaDocumentContext = {
  revision: number;
  /** Den här revisionens utgivningsdatum (ÅÅÅÅ-MM-DD). */
  issuedOn: string;
  /** Revision 1:s datum — "Upprättad". Samma som issuedOn på revision 1. */
  firstIssuedOn: string;
};

const APPENDIX_SHORT: Record<number, string> = Object.fromEntries(
  KMA_APPENDICES.map((a) => [a.no, a.title.replace(/ – Isoleringslandslaget AB$/, '')]),
);

const appendixHeading = (no: number) => `Bilaga ${no} – ${APPENDIX_SHORT[no]}`;

const personLines = (person: KmaPerson) => [person.name, person.phone, person.email].filter(Boolean).join('\n');

function contactRows(form: KmaFormValues): string[][] {
  return [
    [KMA_CEO_CONTACT.name, KMA_CEO_CONTACT.role, KMA_CEO_CONTACT.phone],
    [form.organisation.projectManager.name, 'Projektledare', form.organisation.projectManager.phone],
    ...form.contacts.map((c) => [c.name, c.role, c.phone]),
  ];
}

const CONTACT_COLUMNS = [
  { head: 'Namn', width: 3 },
  { head: 'Roll', width: 3 },
  { head: 'Telefon', width: 2 },
];

function mainSection(form: KmaFormValues, ctx: KmaDocumentContext): KmaSection {
  const { project, organisation } = form;
  const revisionText = ctx.revision === 1 ? '1' : `${ctx.revision} (upprättad ${ctx.firstIssuedOn})`;

  const blocks: KmaBlock[] = [
    { t: 'title', text: KMA_TITLE, sub: KMA_SUBTITLE },
    {
      t: 'fields',
      rows: [
        ['Företag', `${KMA_COMPANY.name} ${KMA_COMPANY.orgNumber}`],
        ['Projektnamn', project.projectName],
        ['Kund', project.customerName],
        ['Projektnummer', project.projectNumber],
        ['Datum', ctx.issuedOn],
        ['Version', KMA_TEMPLATE_VERSION],
        ['Revision', revisionText],
      ],
    },

    { t: 'h1', text: '1. Inledning och syfte' },
    {
      t: 'p',
      text:
        `Denna KMA-plan beskriver hur ${KMA_COMPANY.name} arbetar med Kvalitet, Miljö och Arbetsmiljö ` +
        `vid ${project.workType} med ${kmaMaterialPhrase(project.materials)}.`,
    },
    { t: 'p', text: KMA_STANDARDS_INTRO },
    { t: 'list', items: [...KMA_STANDARDS] },
    { t: 'p', lead: 'Syfte:', text: KMA_PURPOSE },

    { t: 'h1', text: '2. Organisation och ansvar' },
    {
      t: 'fields',
      rows: [
        ['KMA-ansvarig / Projektledare', organisation.projectManager.name],
        ['Arbetsmiljöansvarig', organisation.workEnvironment.name],
        ['Miljöansvarig', organisation.environment.name],
        ['Kvalitetsansvarig', organisation.quality.name],
      ],
    },
    { t: 'p', text: KMA_POLICY_RESPONSIBILITY },
    { t: 'h2', text: 'Kontaktlista' },
    { t: 'table', columns: CONTACT_COLUMNS, rows: contactRows(form) },

    { t: 'h1', text: '3. Kvalitetsplan' },
    { t: 'h2', text: 'Kvalitetspolicy' },
    { t: 'p', text: KMA_QUALITY_POLICY },
    { t: 'h2', text: 'Så säkrar vi kvaliteten' },
    { t: 'list', items: [...KMA_QUALITY_MEASURES] },
    { t: 'h2', text: 'Kvalitetsmål' },
    { t: 'list', items: [...KMA_QUALITY_GOALS] },
    { t: 'h2', text: 'Materialhantering' },
    { t: 'list', items: [...kmaMaterialHandlingLines(project.materials), ...KMA_MATERIAL_APPROVAL_RULES, KMA_STORAGE_RULE] },
    { t: 'h2', text: 'Egenkontroller (se även Bilaga 6 – Egenkontrollmall)' },
    {
      t: 'table',
      columns: [
        { head: 'Kontrollpunkt', width: 3 },
        { head: 'Frekvens', width: 3 },
        { head: 'Ansvarig', width: 2.5 },
      ],
      rows: KMA_SELF_CHECK_POINTS.map((point) => [point.point, point.frequency, form.selfCheckResponsible[point.key]]),
    },
    { t: 'p', text: KMA_SELF_CHECK_NOTE },
    { t: 'h2', text: 'Avvikelsehantering' },
    // Mottagaren är fritext ur dialogen; en egen slutpunkt hade gett ".." mitt i stycket.
    {
      t: 'p',
      text: `Alla avvikelser rapporteras till ${organisation.deviationRecipient.replace(/[.\s]+$/, '')}. ${KMA_DEVIATION_ESCALATION}`,
    },

    { t: 'h1', text: '4. Miljöplan' },
    { t: 'h2', text: 'Miljöpolicy' },
    { t: 'p', text: [KMA_ENV_POLICY, ...kmaEnvironmentSentences(project.materials)].join(' ') },
    { t: 'h2', text: 'Våra åtaganden' },
    { t: 'list', items: [...KMA_ENV_COMMITMENTS] },
    { t: 'h2', text: 'Betydande miljöaspekter' },
    { t: 'list', items: [...KMA_ENV_ASPECTS] },
    { t: 'h2', text: 'Miljömål' },
    { t: 'list', items: [...KMA_ENV_GOALS] },
    { t: 'h2', text: 'Åtgärder' },
    { t: 'list', items: [...KMA_ENV_ACTIONS] },

    { t: 'h1', text: '5. Arbetsmiljöplan' },
    { t: 'h2', text: 'Arbetsmiljöpolicy' },
    { t: 'p', text: KMA_WORK_ENV_POLICY },
    { t: 'h2', text: 'Regler på arbetsplatsen' },
    { t: 'list', items: [...KMA_SITE_RULES] },
    { t: 'h2', text: 'Personlig skyddsutrustning' },
    { t: 'list', items: [...KMA_PPE] },
    { t: 'h2', text: 'Riskanalys' },
    {
      t: 'table',
      columns: [
        { head: 'Risk', width: 1 },
        { head: 'Åtgärd', width: 1 },
      ],
      rows: [...KMA_RISKS, ...form.extraRisks].map((r) => [r.risk, r.action]),
    },
    { t: 'p', lead: 'Beredskap vid olycka', text: KMA_EMERGENCY },

    { t: 'h1', text: '6. Uppföljning och revision' },
    {
      t: 'list',
      items: [KMA_FOLLOW_UP_START, `Arbetsplatsronder utförs av ${organisation.siteRoundsBy}`, KMA_FOLLOW_UP_FINAL],
    },
    { t: 'h2', text: 'Bilagor' },
    {
      t: 'table',
      columns: [
        { head: 'Bilaga', width: 0.9 },
        { head: 'Dokument', width: 4.2 },
        { head: 'Kommentar', width: 3.6 },
      ],
      rows: KMA_APPENDICES.map((a) => [String(a.no), a.title, a.comment ?? `Projektspecifik för ${project.projectName}`]),
    },

    { t: 'h2', text: 'Godkännande' },
    {
      t: 'fields',
      rows: [
        ['Projektledare / KMA-ansvarig', organisation.projectManager.name],
        ['Datum', ctx.issuedOn],
      ],
    },
  ];

  return { key: 'main', newPage: false, blocks };
}

function appendix1(form: KmaFormValues, ctx: KmaDocumentContext): KmaSection {
  const { project, organisation } = form;
  const riskCount = KMA_A1_RISKS.length;
  return {
    key: 'a1',
    newPage: true,
    blocks: [
      { t: 'h1', text: appendixHeading(1) },
      {
        t: 'fields',
        rows: [
          ['Projektnummer', project.projectNumber],
          ['Kund', project.customerName],
          ['Projektnamn', project.projectName],
          ['Datum', ctx.issuedOn],
        ],
      },
      { t: 'h2', text: 'Arbetsmiljöorganisation' },
      {
        t: 'fields',
        rows: [
          ['Entreprenörens kvalitetsansvarig', personLines(organisation.quality)],
          ['Uppgift om arbetsmiljöansvarig', personLines(organisation.workEnvironment)],
        ],
      },
      { t: 'h2', text: 'Regler på arbetsplatsen' },
      ...KMA_A1_RULES.flatMap((rule): KmaBlock[] => [
        { t: 'h3', text: rule.title },
        { t: 'p', text: rule.text },
      ]),
      { t: 'h2', text: 'Riskanalys' },
      { t: 'p', text: KMA_A1_RISK_INTRO },
      { t: 'h3', text: 'Identifiering:' },
      {
        t: 'fields',
        rows: [
          ...KMA_A1_RISKS.map((risk, index): [string, string] => [`Risk ${index + 1}:`, risk]),
          ...form.extraRisks.map((extra, index): [string, string] => [`Risk ${riskCount + index + 1}:`, extra.risk]),
        ],
      },
      { t: 'h3', text: 'Åtgärdsplan:' },
      ...[...KMA_A1_ACTION_PLAN, ...form.extraRisks.map((extra) => extra.action)].map(
        (text): KmaBlock => ({ t: 'p', text }),
      ),
      { t: 'h2', text: 'Plan för restprodukter' },
      { t: 'p', text: KMA_A1_RESIDUALS.join('\n') },
      { t: 'h2', text: 'Fastigheter som skall isoleras' },
      { t: 'fields', rows: project.properties.map((property): [string, string] => ['Fastighet:', property]) },
    ],
  };
}

// Bilaga 6 är egenkontrollen vi använder — samma kort, fält, kontroller och kolumner som
// egenkontrollens PDF, ur samma källa (lib/domains/egenkontroll/template.ts) — tom, som mall att
// skriva i. Inget förifylls (Williams beslut 2026-10-14).
//
// TVÅ AVSNITT, som egenkontrollens två sidor: projekt, material och kontroller på den första,
// etapperna och signaturen på den andra. Utan brytningen hamnade de två etapptabellerna på var sin
// sida — och en tabell som inte ryms delas efter en rad. Andra sidan bär bilagans rubrik: det är den
// som fylls i och skrivs under, och den ska gå att känna igen även lös.
//
// Bredderna är bilagans egna: KMA-sidan har ett annat typsnitt än egenkontrollens PDF. De slås upp
// per kolumnnyckel, så en ny kolumn i egenkontrollen stoppar typkontrollen tills den fått en bredd
// här — i stället för att bilagan tyst halkar efter igen.
const A6_OPEN_WIDTHS: Record<EgenkontrollOpenStageKey, number> = {
  etapp: 1.2,
  ytaM2: 0.8,
  bestalldTjocklek: 1.1,
  sattningsprocent: 1.5,
  installeradTjocklek: 1.15,
  antalSack: 0.95,
  installeradDensitet: 1.15,
  lambdavarde: 1.2,
};

const A6_CLOSED_WIDTHS: Record<EgenkontrollClosedStageKey, number> = {
  etapp: 1.4,
  ytaM2: 0.9,
  bestalldTjocklek: 1.2,
  uppmatTjocklek: 1.2,
  antalSackKgPerSack: 0.9,
  installeradDensitet: 1.2,
  lambdavarde: 1.1,
};

function appendix6(): KmaSection[] {
  const blankFields = (labels: readonly string[]): KmaBlock => ({
    t: 'fields',
    form: true,
    rows: labels.map((label): [string, string] => [label, '']),
  });
  const stageTable = <K extends string>(columns: ReadonlyArray<{ key: K; label: string }>, widths: Record<K, number>): KmaBlock => ({
    t: 'table',
    columns: columns.map((column) => ({ head: column.label, width: widths[column.key] })),
    rows: [],
    minRows: EGENKONTROLL_MAX_STAGE_ROWS,
    rowMinHeight: 18,
  });

  return [
    {
      key: 'a6',
      newPage: true,
      blocks: [
        { t: 'h1', text: appendixHeading(6) },
        { t: 'h2', text: EGENKONTROLL_SECTIONS.project },
        blankFields(Object.values(EGENKONTROLL_PROJECT_FIELDS)),
        { t: 'h2', text: EGENKONTROLL_SECTIONS.material },
        blankFields([EGENKONTROLL_MATERIAL_FIELD]),
        { t: 'h2', text: EGENKONTROLL_SECTIONS.checks },
        {
          t: 'table',
          columns: [
            { head: 'Kontroll', width: 3 },
            { head: 'OK', width: 1 },
            { head: 'Kommentar', width: 5 },
          ],
          rows: EGENKONTROLL_CHECKS.map((check) => [check.label, '', '']),
          rowMinHeight: 16,
        },
        { t: 'h2', text: EGENKONTROLL_SECTIONS.comments },
        { t: 'table', columns: [{ head: EGENKONTROLL_COMMENT_FIELD, width: 1 }], rows: [['']], rowMinHeight: 48 },
      ],
    },
    {
      key: 'a6-etapper',
      newPage: true,
      blocks: [
        { t: 'h1', text: `${appendixHeading(6)} (forts.)` },
        { t: 'h2', text: EGENKONTROLL_SECTIONS.openStages },
        stageTable(EGENKONTROLL_OPEN_STAGE_COLUMNS, A6_OPEN_WIDTHS),
        { t: 'h2', text: EGENKONTROLL_SECTIONS.closedStages },
        stageTable(EGENKONTROLL_CLOSED_STAGE_COLUMNS, A6_CLOSED_WIDTHS),
        { t: 'h2', text: EGENKONTROLL_SECTIONS.signature },
        blankFields(Object.values(EGENKONTROLL_SIGNATURE_FIELDS)),
      ],
    },
  ];
}

// Bilaga 5 är Ekovilla Sveriges kvalitets- och miljöpolicy, ordagrant (template.ts). Policyns egna
// avsnittsrubriker blir h2, dess underrubriker (3.1 …) h3.
function appendix5(): KmaSection {
  const blocks: KmaBlock[] = [
    { t: 'h1', text: appendixHeading(5) },
    { t: 'p', text: KMA_A5_TAGLINE },
    { t: 'fields', rows: KMA_A5_META.map(([label, value]): [string, string] => [label, value]) },
  ];
  for (const part of KMA_A5_POLICY) {
    if ('h2' in part) blocks.push({ t: 'h2', text: part.h2 });
    else if ('h3' in part) blocks.push({ t: 'h3', text: part.h3 });
    else if ('p' in part) blocks.push({ t: 'p', text: part.p });
    else if ('list' in part) blocks.push({ t: 'list', items: [...part.list] });
    else
      blocks.push({
        t: 'table',
        columns: [
          { head: 'Uppgift', width: 1 },
          { head: 'Fakta i registret', width: 1.6 },
        ],
        rows: part.table.map(([label, value]) => [label, value]),
      });
  }
  blocks.push({ t: 'h2', text: 'Underskrift' });
  blocks.push({ t: 'fields', rows: KMA_A5_SIGNED.map(([label, value]): [string, string] => [label, value]) });
  return { key: 'a5', newPage: true, blocks };
}

function appendix8(form: KmaFormValues, ctx: KmaDocumentContext): KmaSection {
  const { project } = form;
  const signerRows = (rows: KmaFormValues['signers']['ongoing']) => rows.map((s) => [s.name, '', s.role, ctx.issuedOn]);
  const signerColumns = (head: string) => [
    { head, width: 4 },
    { head: 'Signatur', width: 3 },
    { head: 'Roll', width: 2.5 },
    { head: 'Datum', width: 1.7 },
  ];
  return {
    key: 'a8',
    newPage: true,
    blocks: [
      { t: 'h1', text: appendixHeading(8) },
      { t: 'p', lead: 'Kvalitetssäkring:', text: KMA_A8_SUBTITLE },
      {
        t: 'fields',
        rows: [
          ['Projekt', [project.customerName, project.projectName, project.properties.join(', ')].filter(Boolean).join('\n')],
          ['Åtagande', project.commitment],
          ['Upprättad/reviderad', ctx.revision === 1 ? ctx.issuedOn : `${ctx.firstIssuedOn} / ${ctx.issuedOn}`],
        ],
      },
      {
        t: 'table',
        columns: signerColumns('Behöriga att signera löpande egenkontroll'),
        rows: signerRows(form.signers.ongoing),
        minRows: KMA_A8_ONGOING_ROWS,
        rowMinHeight: 18,
      },
      {
        t: 'table',
        columns: signerColumns('Behöriga att signera verifierande egenkontroll'),
        rows: signerRows(form.signers.verifying),
        minRows: KMA_A8_VERIFYING_ROWS,
        rowMinHeight: 18,
      },
      { t: 'p', text: KMA_A8_CONFIRM },
      { t: 'signature', label: KMA_A8_SIGNATURE },
    ],
  };
}

export function buildKmaDocument(form: KmaFormValues, ctx: KmaDocumentContext): KmaDocument {
  const { project } = form;
  const sections: KmaSection[] = [
    mainSection(form, ctx),
    appendix1(form, ctx),
    {
      key: 'a2',
      newPage: true,
      blocks: [
        { t: 'h1', text: appendixHeading(2) },
        ...KMA_A2_PARAGRAPHS.map((text): KmaBlock => ({ t: 'p', text })),
        { t: 'list', items: [...KMA_A2_POINTS] },
      ],
    },
    {
      key: 'a3',
      newPage: true,
      blocks: [
        { t: 'h1', text: appendixHeading(3) },
        { t: 'p', text: KMA_A3_INTRO },
        { t: 'list', items: [...KMA_A3_POINTS] },
      ],
    },
    {
      key: 'a4',
      newPage: true,
      blocks: [
        { t: 'h1', text: appendixHeading(4) },
        { t: 'p', text: KMA_A4_INTRO },
        { t: 'list', items: [...KMA_A4_CONTENTS] },
        ...KMA_A4_OUTRO.map((text): KmaBlock => ({ t: 'p', text })),
      ],
    },
    appendix5(),
    ...appendix6(),
    {
      key: 'a7',
      newPage: true,
      blocks: [
        { t: 'h1', text: appendixHeading(7) },
        { t: 'p', text: `Kontaktlista ${KMA_COMPANY.name}` },
        { t: 'table', columns: CONTACT_COLUMNS, rows: contactRows(form) },
      ],
    },
    appendix8(form, ctx),
  ];

  return {
    v: 1,
    layout: 1,
    meta: {
      projectName: project.projectName,
      projectNumber: project.projectNumber,
      revision: ctx.revision,
      issuedOn: ctx.issuedOn,
      firstIssuedOn: ctx.firstIssuedOn,
    },
    footer: KMA_FOOTER,
    running: `KMA-plan · ${project.projectNumber} · Revision ${ctx.revision}`,
    sections,
  };
}

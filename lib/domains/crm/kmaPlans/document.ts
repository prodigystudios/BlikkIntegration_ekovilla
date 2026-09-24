import {
  kmaEnvironmentSentences,
  kmaHasCellulose,
  kmaLambda,
  kmaMaterialHandlingLines,
  kmaMaterialPhrase,
  kmaSelfCheckProducts,
} from './materials';
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
  KMA_A5_ACTION_PLAN,
  KMA_A5_ACTION_PLAN_TEXT,
  KMA_A5_GOALS_EXAMPLES,
  KMA_A5_GOALS_EXAMPLES_INTRO,
  KMA_A5_GOALS_MOTTO,
  KMA_A5_GOALS_TEXT,
  KMA_A5_INVESTIGATION,
  KMA_A5_POLICY,
  KMA_A5_RESPONSIBILITY,
  KMA_A6_CHECKLIST,
  KMA_A6_THANKS,
  KMA_A6_VENTILATION_NOTE,
  KMA_A8_CONFIRM,
  KMA_A8_ONGOING_ROWS,
  KMA_A8_SIGNATURE,
  KMA_A8_SUBTITLE,
  KMA_A8_VERIFYING_ROWS,
  KMA_APPENDICES,
  KMA_CEO_CONTACT,
  KMA_COMPANY,
  KMA_EMERGENCY,
  KMA_ENV_ACTIONS,
  KMA_ENV_ASPECTS,
  KMA_ENV_GOALS,
  KMA_ENV_POLICY,
  KMA_FOLLOW_UP_FINAL,
  KMA_FOLLOW_UP_START,
  KMA_FOOTER,
  KMA_PPE,
  KMA_PURPOSE,
  KMA_QUALITY_POLICY,
  KMA_RISKS,
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
    { t: 'h2', text: 'Kontaktlista' },
    { t: 'table', columns: CONTACT_COLUMNS, rows: contactRows(form) },

    { t: 'h1', text: '3. Kvalitetsplan' },
    { t: 'h2', text: 'Kvalitetspolicy' },
    { t: 'p', text: KMA_QUALITY_POLICY },
    { t: 'h2', text: 'Materialhantering' },
    { t: 'list', items: [...kmaMaterialHandlingLines(project.materials), KMA_STORAGE_RULE] },
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
    { t: 'h2', text: 'Avvikelsehantering' },
    { t: 'p', text: `Alla avvikelser rapporteras till ${organisation.deviationRecipient}.` },

    { t: 'h1', text: '4. Miljöplan' },
    { t: 'h2', text: 'Miljöpolicy' },
    { t: 'p', text: [KMA_ENV_POLICY, ...kmaEnvironmentSentences(project.materials)].join(' ') },
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

function appendix6(form: KmaFormValues): KmaSection {
  const { project } = form;
  const cellulose = kmaHasCellulose(project.materials);
  const lambda = kmaLambda(project.materials);
  const blank = (columns: number) => Array.from({ length: columns }, () => '');
  const withLambda = (columns: number) => [...blank(columns - 1), lambda];

  return {
    key: 'a6',
    newPage: true,
    blocks: [
      { t: 'h1', text: appendixHeading(6) },
      {
        t: 'fields',
        form: true,
        rows: [
          ['Utförandedatum', ''],
          ['Isolerentreprenör', KMA_COMPANY.name],
          ['Ansvarig installatör', ''],
          ['Beställare', project.customerName],
          ['Objekt', project.properties.join(', ')],
        ],
      },
      { t: 'h2', text: 'EGENKONTROLL' },
      ...kmaSelfCheckProducts(project.materials).flatMap((entry): KmaBlock[] => [
        { t: 'h3', text: entry.product },
        { t: 'p', text: entry.text },
      ]),
      {
        t: 'table',
        columns: [
          { head: 'Checklista', width: 3 },
          { head: 'OK', width: 1 },
          { head: 'Kommentar', width: 5 },
        ],
        // Asterisken hör ihop med takfotsnoten och står bara när noten gör det.
        rows: KMA_A6_CHECKLIST.map((item) => [item === 'Luftspalt' && cellulose ? 'Luftspalt*' : item, '', '']),
        rowMinHeight: 16,
      },
      ...(cellulose ? [{ t: 'p', text: KMA_A6_VENTILATION_NOTE } as KmaBlock] : []),
      {
        t: 'table',
        columns: [
          { head: 'Etapp (öppet)', width: 1.4 },
          { head: 'Yta m²', width: 1 },
          { head: 'Beställd tjocklek ex. sättningspåslag', width: 1.3 },
          // Uttrycklig brytning efter bindestrecket: kolumnen är för smal för ordet, och utan den
          // delades det mitt i ("Sättningspås / lag").
          { head: 'Sättnings-\npåslag %', width: 1.1 },
          { head: 'Installerad tjocklek inkl. sättningspåslag', width: 1.3 },
          { head: 'Installerad densitet kg/m³', width: 1.2 },
          { head: 'Antal säck', width: 0.9 },
          { head: 'Lambda-\nvärde W/m²K', width: 1.1 },
        ],
        rows: [withLambda(8), withLambda(8)],
        rowMinHeight: 18,
      },
      {
        t: 'table',
        columns: [
          { head: 'Etapp (slutet)', width: 1.4 },
          { head: 'Yta m²', width: 1 },
          { head: 'Beställd tjocklek', width: 1.2 },
          { head: 'Uppmätt tjocklek', width: 1.2 },
          { head: 'Installerad densitet kg/m³', width: 1.2 },
          { head: 'Antal säck', width: 0.9 },
          { head: 'Lambdavärde W/m²K', width: 1.1 },
        ],
        rows: [withLambda(7), withLambda(7)],
        rowMinHeight: 18,
      },
      { t: 'p', text: KMA_A6_THANKS },
      {
        t: 'table',
        columns: [
          { head: '', width: 2 },
          { head: 'Installatör', width: 3 },
          { head: 'Platschef/Beställare', width: 3 },
        ],
        rows: [
          ['Namnteckning:', '', ''],
          ['Namnförtydligande:', '', ''],
        ],
        rowMinHeight: 24,
      },
    ],
  };
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
    {
      key: 'a5',
      newPage: true,
      blocks: [
        { t: 'h1', text: appendixHeading(5) },
        { t: 'h2', text: 'Miljöutredning' },
        { t: 'p', text: KMA_A5_INVESTIGATION },
        { t: 'h2', text: 'Miljöpolicy' },
        ...KMA_A5_POLICY.map((text): KmaBlock => ({ t: 'p', text })),
        { t: 'h2', text: 'Miljömål' },
        { t: 'p', text: KMA_A5_GOALS_MOTTO },
        { t: 'p', text: KMA_A5_GOALS_TEXT },
        { t: 'p', text: KMA_A5_GOALS_EXAMPLES_INTRO },
        { t: 'list', items: [...KMA_A5_GOALS_EXAMPLES] },
        { t: 'h2', text: 'Handlingsplan' },
        { t: 'p', text: KMA_A5_ACTION_PLAN_TEXT },
        { t: 'list', items: [...KMA_A5_ACTION_PLAN] },
        { t: 'h2', text: 'Ansvar för miljö' },
        { t: 'p', text: KMA_A5_RESPONSIBILITY.join('\n') },
      ],
    },
    appendix6(form),
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

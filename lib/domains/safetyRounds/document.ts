import type { PdfBlock, PdfSection } from '@/lib/pdf/blocks';
import { KMA_FOOTER } from '@/lib/domains/crm/kmaPlans/template';

import { describeItem, effectiveDetails, summarizeItems } from './completion';
import { groupItemsByCategory } from './form';
import { formatPhotoRefs, photoNumbersByItem, selectPhotosForPdf } from './photoRules';
import {
  ACTION_EFFECT_LABELS,
  ACTION_STATUS_LABELS,
  ITEM_STATUS_LABELS,
  PARTICIPANT_ROLE_LABELS,
  RISK_LABELS,
  TO_ACTION_PLAN_LABELS,
  safetyRoundOrderRef,
  type RiskLevel,
  type SafetyRoundBundle,
  type SafetyRoundItem,
} from './types';

// Skyddsrondens protokoll som block — det lib/pdf/blocks.ts ritar. Ren modul.
//
// Till skillnad från KMA-planen sparas INGET dokument: protokollet byggs ur tabellerna vid varje
// utskrift. Det går för att en slutförd rond är låst i databasen (rondinfo, deltagare, punkter och
// själva åtgärderna). Det enda som rör sig efteråt är handlingsplanens UPPFÖLJNING — status, datum,
// effekt — och den ska visa läget när protokollet skrivs ut. Därför står utskriftsdagen i foten.
//
// Rubrikerna och texterna är Excel-mallens ("Skyddsrond_mall_arbetsplats.xlsx").

export type SafetyRoundDocument = {
  sections: PdfSection[];
  footer: string;
  running: string;
  title: string;
  subject: string;
  /** Utskriftsdagen — metadatans datum. */
  date: string;
  /**
   * Fotona som ska bäddas in: `ref` är fotoblockets nyckel, `path` den lilla variantens sökväg.
   * PDF-routen hämtar exakt de här — urvalet (budgeten) görs här, en gång.
   */
  photoDownloads: Array<{ ref: string; path: string }>;
};

const dash = (value: string | null | undefined) => (value && value.trim() ? value.trim() : '–');
const riskText = (risk: RiskLevel | null) => (risk ? RISK_LABELS[risk] : '–');
const yesNo = (value: boolean | null) => (value === null ? '–' : value ? 'Ja' : 'Nej');
const clock = (value: string | null) => (value ? value.slice(0, 5) : '–');

/**
 * Beskrivning, "åtgärdat på plats", kommentar och fotonumren. Detaljerna bara när de gäller
 * (effectiveDetails); fotona alltid — mallen har Foto-nr på varje rad, oavsett status.
 */
function observation(item: SafetyRoundItem, photoNumbers: readonly number[]): string {
  const details = effectiveDetails(item);
  return [
    details.description?.trim(),
    details.fixed_on_site === true ? 'Åtgärdat på plats.' : null,
    item.comment?.trim() ? `Kommentar: ${item.comment.trim()}` : null,
    formatPhotoRefs(photoNumbers) || null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildSafetyRoundDocument(bundle: SafetyRoundBundle, ctx: { printedOn: string }): SafetyRoundDocument {
  const { round, participants, items, actions } = bundle;
  const orderRef = safetyRoundOrderRef(round);
  const summary = summarizeItems(items);
  const draft = round.status !== 'completed';
  const itemById = new Map(items.map((item) => [item.id, item]));
  const photosByItem = photoNumbersByItem(bundle.photos);

  // ── 1. Rondinfo och deltagare ──────────────────────────────────────────────
  const info: PdfBlock[] = [
    {
      t: 'title',
      text: 'Skyddsrond – ute på arbetsplats',
      sub: [`Rond ${round.round_number}`, round.held_on, draft ? 'UTKAST – ronden är inte slutförd' : null]
        .filter(Boolean)
        .join(' · '),
    },
    {
      t: 'fields',
      rows: [
        ['Projekt', dash(round.project_name)],
        ['Arbetsorder', dash(orderRef)],
        ['Projekt / adress', dash(round.site_address)],
        ['Objekt / husnr', dash(round.object_label)],
        ['Datum', round.held_on],
        ['Klockslag', clock(round.held_at)],
        ['Beställare / byggherre', dash(round.client_label)],
        ['Entreprenadmoment', dash(round.contract_step)],
        ['Arbetsgivare', dash(round.employer)],
        ['Typ av arbete', dash(round.work_type)],
        ['Väder / förhållanden', dash(round.weather)],
        ['Rondledare (chef)', dash(round.leader_name)],
        ['Skyddsombud', dash(round.safety_rep_name)],
        ['Nästa rond senast', dash(round.next_round_due)],
        ['Uppföljning av förra ronden', yesNo(round.previous_followed_up)],
      ],
    },
    { t: 'h2', text: 'Deltagare' },
    {
      t: 'table',
      columns: [
        { head: 'Namn', width: 24 },
        { head: 'Roll', width: 18 },
        { head: 'Företag', width: 18 },
        { head: 'Närvarande', width: 11 },
        { head: 'Signatur / initialer', width: 13 },
        { head: 'Kommentar', width: 16 },
      ],
      rows: participants.map((p) => [
        p.name,
        PARTICIPANT_ROLE_LABELS[p.role],
        p.company ?? '',
        p.present ? 'Ja' : 'Nej',
        p.initials ?? '',
        p.comment ?? '',
      ]),
      minRows: 2,
    },
    { t: 'h2', text: 'Summering' },
    {
      t: 'fields',
      rows: [
        ['OK / Delvis / Brist', `${summary.ok} / ${summary.partial} / ${summary.defect}`],
        ['Ej relevant', String(summary.na)],
        ...(summary.unassessed > 0 ? ([['Ej bedömda', String(summary.unassessed)]] as Array<[string, string]>) : []),
        ['Hög + Allvarlig', String(summary.highOrSevere)],
        ['Till handlingsplan', String(summary.toActionPlan)],
      ],
    },
  ];

  // ── 2. Checklistan ─────────────────────────────────────────────────────────
  const checklist: PdfBlock[] = [{ t: 'h1', text: 'Checklista' }];
  for (const group of groupItemsByCategory(items)) {
    checklist.push({ t: 'h2', text: `${group.code}. ${group.label}` });
    checklist.push({
      t: 'table',
      columns: [
        // Status och Risknivå är breda nog för sina längsta värden ("Ej relevant", "Allvarlig") på
        // EN rad — ett statusord som bryts mitt i läses som två.
        { head: 'Nr', width: 5 },
        { head: 'Kontrollpunkt', width: 31 },
        { head: 'Status', width: 11 },
        { head: 'Risknivå', width: 10 },
        { head: 'Beskrivning av brist / observation', width: 29 },
        { head: 'Till handlingsplan', width: 14 },
      ],
      rows: group.items.map((item) => {
        const details = effectiveDetails(item);
        return [
          item.number != null ? String(item.number) : '',
          item.text,
          item.status ? ITEM_STATUS_LABELS[item.status] : '–',
          riskText(details.risk),
          observation(item, photosByItem.get(item.id) ?? []),
          details.to_action_plan ? TO_ACTION_PLAN_LABELS[details.to_action_plan] : '',
        ];
      }),
    });
  }

  // ── 3. Handlingsplanen ─────────────────────────────────────────────────────
  const openActions = actions.filter((a) => a.status !== 'done' && a.status !== 'written_off');
  const plan: PdfBlock[] = [
    { t: 'h1', text: 'Handlingsplan – riskåtgärder' },
    {
      t: 'p',
      text:
        'Varje brist som inte åtgärdas omedelbart ska ha åtgärd, ansvarig person och datum. Det är lagkrav '
        + '(AFS 2023:1 §13), inte pappersarbete för pappersarbetets skull.',
    },
    {
      t: 'table',
      columns: [
        // "Klart senast" rymmer ett helt ISO-datum på en rad, och "Risknivå" sin rubrik.
        { head: 'ID', width: 4 },
        { head: 'Risk / brist', width: 22 },
        { head: 'Risknivå', width: 10 },
        { head: 'Åtgärd', width: 22 },
        { head: 'Ansvarig', width: 13 },
        { head: 'Klart senast', width: 12 },
        { head: 'Status / uppföljning', width: 17 },
      ],
      rows: actions.map((action, index) => {
        const item = action.item_id ? itemById.get(action.item_id) : undefined;
        const refs = item ? formatPhotoRefs(photosByItem.get(item.id) ?? []) : '';
        const finding = [item ? `${describeItem(item)}: ${action.finding}` : action.finding, refs].filter(Boolean).join('\n');
        const followUp = [
          ACTION_STATUS_LABELS[action.status],
          action.followed_up_on ? `Uppföljt ${action.followed_up_on}` : null,
          action.effect ? `Effekt OK? ${ACTION_EFFECT_LABELS[action.effect]}` : null,
          action.cost_note?.trim() || null,
        ]
          .filter(Boolean)
          .join('\n');
        return [
          String(index + 1),
          finding,
          riskText(action.risk),
          action.action ?? '',
          action.responsible_name ?? '',
          action.due_on ?? '',
          followUp,
        ];
      }),
      minRows: actions.length === 0 ? 1 : 0,
    },
    {
      t: 'fields',
      rows: [
        ['Öppna åtgärder (ej Klar/Avskriven)', String(openActions.length)],
        ['Varav Hög/Allvarlig öppna', String(openActions.filter((a) => a.risk === 'high' || a.risk === 'severe').length)],
      ],
    },
    { t: 'gap', h: 10 },
    { t: 'signature', label: 'Rondledare' },
    { t: 'signature', label: 'Skyddsombud' },
  ];

  // ── 4. Fotona ──────────────────────────────────────────────────────────────
  // Den lilla varianten, i nummerordning, så många som ryms inom PDF-budgeten. Resten sägs rakt ut —
  // ett protokoll som tyst tappar Foto 14 hänvisar till något som inte finns.
  const { embed, omitted } = selectPhotosForPdf(bundle.photos);
  const photoBlocks: PdfBlock[] = [];
  if (bundle.photos.length > 0) {
    photoBlocks.push({ t: 'h1', text: 'Foton' });
    if (omitted.length > 0) {
      photoBlocks.push({
        t: 'p',
        text: `${formatPhotoRefs(omitted.map((p) => p.photo_no))} ryms inte i PDF:en. ${omitted.length === 1 ? 'Det finns' : 'De finns'} i ronden i appen.`,
      });
    }
    photoBlocks.push({
      t: 'photos',
      items: embed.map((photo) => {
        const item = itemById.get(photo.item_id);
        const where = item ? (item.number != null ? `${describeItem(item)}: ${item.text}` : item.text) : '';
        return { ref: photo.id, caption: [`Foto ${photo.photo_no}`, where].filter(Boolean).join(' – ') };
      }),
    });
  }

  return {
    sections: [
      { key: 'info', newPage: false, blocks: info },
      { key: 'checklist', newPage: true, blocks: checklist },
      { key: 'plan', newPage: true, blocks: plan },
      ...(photoBlocks.length > 0 ? [{ key: 'photos', newPage: true, blocks: photoBlocks }] : []),
    ],
    photoDownloads: embed.map((photo) => ({ ref: photo.id, path: photo.print_path })),
    footer: KMA_FOOTER,
    running: ['Skyddsrond', orderRef || null, `Rond ${round.round_number}`, `Utskriven ${ctx.printedOn}`]
      .filter(Boolean)
      .join(' · '),
    title: [`Skyddsrond${orderRef ? ` ${orderRef}` : ''}`, round.project_name].join(' – '),
    subject: `Rond ${round.round_number}, ${round.held_on}`,
    date: ctx.printedOn,
  };
}

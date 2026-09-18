import { describe, it, expect } from 'vitest';
import { mapWorkOrderJob, scopeForSegment, type WorkOrderJobRow } from '@/lib/domains/planning/display';
import {
  backlogItemsForStatus,
  expandWorkOrderToBacklogItems,
  PARTIALLY_INVOICED,
  SCHEDULABLE_WORK_ORDER_STATUSES,
} from '@/lib/domains/planning/backlog';
import type { WorkOrderStage } from '@/lib/domains/crm/workOrderStages';

// Läsmodellerna när en order är uppdelad i etapper.
//
// Det som vaktas här är två saker: att en order UTAN etapper beter sig exakt som förut, och att en
// order MED etapper delas upp utan att något tal tappas eller dubbelräknas.

// 300 m2 x 200 mm = 60 m3 Ekovilla. 180 m2 x 300 mm = 54 m3 Knauf.
const ORDER: WorkOrderJobRow & { id: string; desired_installation_date: null; assigned_to: null } = {
  id: 'wo-1',
  order_number: 'AO-1',
  fortnox_order_number: null,
  project_name: 'Villa Andersson',
  client_name: 'Andersson',
  status: 'scheduled',
  customer_snapshot: {},
  work_address: {},
  desired_installation_date: null,
  assigned_to: null,
  line_items: [
    { id: 'r-wall', pricing_mode: 'm3', m2: '300', thickness_mm: '200', unit_price: '1200', density: '38', article_name: 'Ekovilla lösull' },
    { id: 'r-roof', pricing_mode: 'm3', m2: '180', thickness_mm: '300', unit_price: '1200', density: '38', article_name: 'Knauf Supafil' },
  ],
};

const stage = (id: string, n: number, title: string, lines: Array<[string, number]>): WorkOrderStage => ({
  id,
  stage_number: n,
  title,
  line_quantities: lines.map(([line_id, quantity]) => ({ line_id, quantity })),
});

describe('mapWorkOrderJob med scope', () => {
  // Bakåtkompatibiliteten: anropet utan scope får inte ha ändrats för de dryga hundra ordrar som
  // saknar etapper.
  it('utan scope räknar den hela ordern, precis som förut', () => {
    const job = mapWorkOrderJob(ORDER);
    expect(job.revenue).toBe((60 + 54) * 1200);
    expect(job.stage).toBeNull();
    expect(job.order_total_sacks).toBe(job.total_sacks);
  });

  it('en etapp bär bara sina egna rader', () => {
    const wall = stage('s1', 1, 'Vägg', [['r-wall', 60]]);
    const job = mapWorkOrderJob(ORDER, { kind: 'stage', stage: wall, siblings: [wall] });
    expect(job.revenue).toBe(60 * 1200);
    expect(job.stage).toEqual({ id: 's1', number: 1, title: 'Vägg' });
  });

  // 🧨 Läses materialet ur hela ordern visar etapp 2 etapp 1:s material, och planeraren beställer
  // fel säckar till fel vecka.
  it('MATERIALET följer scopet, inte ordern', () => {
    const wall = stage('s1', 1, 'Vägg', [['r-wall', 60]]);
    const roof = stage('s2', 2, 'Snedtak', [['r-roof', 54]]);
    const stages = [wall, roof];
    expect(mapWorkOrderJob(ORDER, { kind: 'stage', stage: wall, siblings: stages }).material).toBe('Ekovilla');
    expect(mapWorkOrderJob(ORDER, { kind: 'stage', stage: roof, siblings: stages }).material).toBe('Knauf Supafil');
    // Hela ordern svarar med det FÖRSTA kända materialet — alltså väggens. Det är precis därför
    // snedtaksetappen inte får läsa den.
    expect(mapWorkOrderJob(ORDER).material).toBe('Ekovilla');
  });

  // ⛔ Säckrapporteringen är per ARBETSORDER. Mäts framdriften mot etappens tal säger etapp 2
  // "kvar 0 / 120" så fort etapp 1 är färdigblåst.
  it('order_total_sacks är HELA orderns, även på ett etappkort', () => {
    const wall = stage('s1', 1, 'Vägg', [['r-wall', 60]]);
    const job = mapWorkOrderJob(ORDER, { kind: 'stage', stage: wall, siblings: [wall] });
    expect(job.total_sacks).toBeLessThan(job.order_total_sacks);
    expect(job.order_total_sacks).toBe(mapWorkOrderJob(ORDER).total_sacks);
  });
});

describe('scopeForSegment', () => {
  const wall = stage('s1', 1, 'Vägg', [['r-wall', 60]]);

  it('utan etapper på ordern är allt whole', () => {
    expect(scopeForSegment(null, [])).toEqual({ kind: 'whole' });
    expect(scopeForSegment('s1', null)).toEqual({ kind: 'whole' });
  });

  it('null stage_id på en uppdelad order betyder resten', () => {
    expect(scopeForSegment(null, [wall])).toEqual({ kind: 'rest', stages: [wall] });
  });

  // Etappen kan ha raderats mellan två läsningar. Kortet ska rita något, och resten är det
  // ärligaste svaret när etappen är borta.
  it('en okänd etapp faller tillbaka på resten i stället för att kasta', () => {
    expect(scopeForSegment('borttagen', [wall])).toEqual({ kind: 'rest', stages: [wall] });
  });
});

describe('expandWorkOrderToBacklogItems', () => {
  const noCount = () => 0;

  it('utan etapper blir det EXAKT en post, som förut', () => {
    const items = expandWorkOrderToBacklogItems(ORDER, noCount);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'wo-1:rest', id: 'wo-1', stage_id: null });
    expect(items[0].revenue).toBe((60 + 54) * 1200);
  });

  it('en post per etapp plus resten', () => {
    const rows = { ...ORDER, crm_work_order_stages: [stage('s2', 2, 'Snedtak', [['r-roof', 54]]), stage('s1', 1, 'Vägg', [['r-wall', 30]])] };
    const items = expandWorkOrderToBacklogItems(rows, noCount);
    // Etappordning, inte inläsningsordning.
    expect(items.map((i) => i.stage?.number ?? null)).toEqual([1, 2, null]);
    expect(items.map((i) => i.key)).toEqual(['wo-1:s1', 'wo-1:s2', 'wo-1:rest']);
    // Summan över posterna är hela ordern — inget tappat, inget dubbelräknat.
    expect(items.reduce((s, i) => s + i.revenue, 0)).toBeCloseTo((60 + 54) * 1200, 6);
  });

  it('ingen rest-post när etapperna tagit hela ordern', () => {
    const rows = { ...ORDER, crm_work_order_stages: [stage('s1', 1, 'Vägg', [['r-wall', 60]]), stage('s2', 2, 'Snedtak', [['r-roof', 54]])] };
    const items = expandWorkOrderToBacklogItems(rows, noCount);
    expect(items.map((i) => i.key)).toEqual(['wo-1:s1', 'wo-1:s2']);
  });

  // En etapp som krympt till noll (dess enda rad blev avskriven) ska INTE försvinna — det ser ut
  // som dataförlust för den som skapade den.
  it('en tom etapp visas kvar', () => {
    const written = { ...ORDER, line_items: [{ ...(ORDER.line_items as any[])[0], written_off: true }, (ORDER.line_items as any[])[1]] };
    const rows = { ...written, crm_work_order_stages: [stage('s1', 1, 'Vägg', [['r-wall', 60]])] };
    const items = expandWorkOrderToBacklogItems(rows, noCount);
    expect(items.map((i) => i.key)).toEqual(['wo-1:s1', 'wo-1:rest']);
    expect(items[0].revenue).toBe(0);
  });

  it('räknar placeringar PER ETAPP, inte per order', () => {
    const rows = { ...ORDER, crm_work_order_stages: [stage('s1', 1, 'Vägg', [['r-wall', 30]])] };
    const items = expandWorkOrderToBacklogItems(rows, (stageId) => (stageId === 's1' ? 2 : 0));
    expect(items.find((i) => i.stage_id === 's1')?.segment_count).toBe(2);
    // Resten är fortfarande oplanerad — att väggen är utlagd säger ingenting om snedtaket.
    expect(items.find((i) => i.stage_id === null)?.segment_count).toBe(0);
  });
});

describe('delfakturerade ordrar i backloggen', () => {
  // Fel 3 i diagnosen: faktureras etapp 1 försvann HELA ordern ur backloggen innan snedtaket
  // hunnit planeras. Statusen betyder "förbi installationen som helhet" — sant för en odelad
  // order, falskt för en uppdelad.
  it('konstanten utvidgas INTE — den läses av insights och depåprognosen', () => {
    expect([...SCHEDULABLE_WORK_ORDER_STATUSES]).toEqual(['draft', 'scheduled', 'in_progress']);
    expect(PARTIALLY_INVOICED).toBe('partially_invoiced');
    expect(SCHEDULABLE_WORK_ORDER_STATUSES as readonly string[]).not.toContain(PARTIALLY_INVOICED);
  });

  const wall = stage('s1', 1, 'Vägg', [['r-wall', 30]]);
  const items = (segs: number) => expandWorkOrderToBacklogItems({ ...ORDER, crm_work_order_stages: [wall] }, () => segs);

  it('en schemaläggningsbar order passerar orörd', () => {
    const all = items(0);
    expect(backlogItemsForStatus('scheduled', [wall], all)).toBe(all);
  });

  // 🧨 QA-FYNDET 2026-09-18: order #98 — delfakturerad, noll placeringar, noll säckar, INGA etapper
  // — dök upp i "Att planera". Backloggen gick från 63 till 64 poster utan att något nytt fanns att
  // boka. En odelad order har ingen etapp 2 att vänta på.
  it('en ODELAD delfakturerad order släpps INTE in', () => {
    const undivided = expandWorkOrderToBacklogItems(ORDER, () => 0);
    expect(backlogItemsForStatus(PARTIALLY_INVOICED, [], undivided)).toEqual([]);
  });

  it('en UPPDELAD delfakturerad order släpper in sina oplanerade etapper', () => {
    expect(backlogItemsForStatus(PARTIALLY_INVOICED, [wall], items(0)).length).toBeGreaterThan(0);
  });

  it('men inte etapper som redan är utplacerade', () => {
    expect(backlogItemsForStatus(PARTIALLY_INVOICED, [wall], items(2))).toEqual([]);
  });
});

describe('rest-scopet märks ut', () => {
  const wall = stage('s1', 1, 'Vägg', [['r-wall', 30]]);

  // 🧨 William 2026-09-18, första skarpa uppdelningen: "står fortfarande fullt säckantal på det".
  // Säckbadgen visar HELA orderns tal (säckboken är per arbetsorder), så utan en egen märkning var
  // jobbets 797 det enda synliga talet på ett kort som bar 447. Etappkortet hade sitt chip och gick
  // fritt; rest-kortet log.
  it('resten av en UPPDELAD order är markerad', () => {
    const job = mapWorkOrderJob(ORDER, { kind: 'rest', stages: [wall] });
    expect(job.is_rest).toBe(true);
    expect(job.stage).toBeNull();
    expect(job.total_sacks).toBeLessThan(job.order_total_sacks);
  });

  // ⚠️ En order UTAN etapper är inte "resten" av något — då hade varje vanligt kort fått ett chip.
  it('en odelad order är INTE markerad', () => {
    expect(mapWorkOrderJob(ORDER).is_rest).toBe(false);
    expect(mapWorkOrderJob(ORDER, { kind: 'rest', stages: [] }).is_rest).toBe(false);
  });

  it('ett etappkort är inte heller markerat — det har sitt eget chip', () => {
    expect(mapWorkOrderJob(ORDER, { kind: 'stage', stage: wall, siblings: [wall] }).is_rest).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { buildScheduleFacts, isScheduleJobDone } from '@/lib/domains/planning/scheduleFacts';
import { listSegmentsByIds } from '@/lib/domains/planning/schedule';
import { scheduleFactKey } from '@/lib/domains/planning/scheduleStops';
import type { OpsSegment } from '@/lib/domains/planning/types';
import type { JobDisplay } from '@/lib/domains/planning/display';
import type { CrewSources } from '@/lib/domains/planning/workOrderCrew';

// Startsidans fakta för CRM-jobben: säckar, material, rapporterat, team och klart — per placering och
// dag. Varje tal kommer från planeringstavlans läsmodell; det som prövas här är sammanställningen och
// de två reglerna modulen äger: när ett jobb är klart, och att teamet är DAGENS.

const job = (over: Partial<JobDisplay> = {}): JobDisplay => ({
  ref: '#77',
  is_fortnox_ref: true,
  project_name: 'Vind',
  client_name: 'Kund AB',
  status: 'scheduled',
  address: null,
  total_sacks: 120,
  material: 'Ekovilla',
  revenue: 0,
  stage: null,
  is_rest: false,
  order_total_sacks: 120,
  ...over,
});

const segment = (over: Partial<OpsSegment> = {}): OpsSegment => ({
  id: 'seg-1',
  work_order_id: 'wo-1',
  stage_id: null,
  truck_id: 'bil-1',
  start_day: '2026-10-22',
  end_day: '2026-10-22',
  sort_index: 0,
  job_type: null,
  on_hold: false,
  created_by: null,
  created_by_name: null,
  created_at: '',
  updated_at: '',
  placeholder_title: null,
  placeholder_customer: null,
  field_visible: false,
  work_description: null,
  job: job(),
  sacks_reported: 0,
  sacks_final: false,
  crew: [],
  confirmation: {} as OpsSegment['confirmation'],
  ...over,
});

const noCrew: CrewSources = { segmentCrew: new Map(), weekly: [], defaults: [] };
const row = (segment_id = 'seg-1', job_day: string | null = '2026-10-22') => ({ segment_id, job_day });
const factOf = (facts: ReturnType<typeof buildScheduleFacts>, seg = 'seg-1', day = '2026-10-22') => facts[scheduleFactKey(seg, day)];

describe('isScheduleJobDone', () => {
  it('är klart när ordern är klar eller fakturerad', () => {
    expect(isScheduleJobDone('completed', false)).toBe(true);
    expect(isScheduleJobDone('invoiced', false)).toBe(true);
  });

  it('är INTE klart på en delfakturerad order — delfakturering används på jobb som pågår', () => {
    expect(isScheduleJobDone('partially_invoiced', false)).toBe(false);
  });

  it('är klart när slutrapporten är inskickad, före kontorets statusbyte', () => {
    expect(isScheduleJobDone('in_progress', true)).toBe(true);
  });

  it('är inte klart annars', () => {
    expect(isScheduleJobDone('scheduled', false)).toBe(false);
    expect(isScheduleJobDone(null, false)).toBe(false);
  });
});

describe('buildScheduleFacts', () => {
  it('bär placeringens säckar, material och orderns rapporterade säckar', () => {
    const facts = buildScheduleFacts([row()], [segment({ sacks_reported: 45 })], noCrew);
    expect(factOf(facts)).toEqual({
      plannedSacks: 120,
      orderSacks: null,
      staged: false,
      material: 'Ekovilla',
      reported: 45,
      done: false,
      crew: [],
    });
  });

  it('säger ingenting om säckar som inte finns — inga nollor', () => {
    expect(factOf(buildScheduleFacts([row()], [segment({ job: job({ total_sacks: 0 }) })], noCrew)).plannedSacks).toBeNull();
  });

  it('skiljer etappens säckar från orderns på en uppdelad order', () => {
    const stage = { id: 'st-1', number: 1, title: 'Vinden' };
    const facts = buildScheduleFacts([row()], [segment({ job: job({ total_sacks: 120, order_total_sacks: 300, stage }) })], noCrew);
    expect(factOf(facts)).toMatchObject({ plannedSacks: 120, orderSacks: 300, staged: true });
  });

  it('räknar resten av en uppdelad order som uppdelad', () => {
    const facts = buildScheduleFacts([row()], [segment({ job: job({ is_rest: true, order_total_sacks: 300 }) })], noCrew);
    expect(factOf(facts)).toMatchObject({ staged: true, orderSacks: 300 });
  });

  it('är klart när ordern är klar eller slutrapporten finns', () => {
    expect(factOf(buildScheduleFacts([row()], [segment({ job: job({ status: 'completed' }) })], noCrew)).done).toBe(true);
    expect(factOf(buildScheduleFacts([row()], [segment({ sacks_final: true })], noCrew)).done).toBe(true);
  });

  it('en platshållare har inga säckar och är aldrig klar, men har sitt team', () => {
    const sources: CrewSources = { ...noCrew, segmentCrew: new Map([['seg-1', [{ id: 'c1', member_id: 'u1', member_name: 'Anna' }]]]) };
    const facts = buildScheduleFacts([row()], [segment({ work_order_id: null, job: null, sacks_final: true })], sources);
    expect(factOf(facts)).toMatchObject({ plannedSacks: null, material: null, done: false, crew: ['Anna'] });
  });

  it('har en rad per dag för samma placering', () => {
    const seg = segment({ start_day: '2026-10-21', end_day: '2026-10-22' });
    const facts = buildScheduleFacts([row('seg-1', '2026-10-21'), row('seg-1', '2026-10-22')], [seg], noCrew);
    expect(Object.keys(facts).sort()).toEqual([scheduleFactKey('seg-1', '2026-10-21'), scheduleFactKey('seg-1', '2026-10-22')]);
  });

  it('svarar inte för placeringar som inte gick att läsa, eller rader utan dag', () => {
    const facts = buildScheduleFacts([row('seg-okänd'), row('seg-1', null)], [segment()], noCrew);
    expect(facts).toEqual({});
  });

  // ── Teamet PER PLACERING OCH DAG ─────────────────────────────────────────
  // 🧨 Fredag–måndag-jobbet: två ISO-veckor, två besättningar. Löst över hela placeringens spann
  // hade fredagen fått måndagens folk och tvärtom — samma fel som "förra veckans lag fick nästa
  // veckas jobb" i feeden (myCrmJobsFeedSql.test.ts).
  describe('team', () => {
    const friToMon = segment({ start_day: '2026-10-23', end_day: '2026-10-26' });
    const week = (member_name: string, start_day: string, end_day: string, role: 'leader' | 'member' = 'member') => ({
      id: `tc-${member_name}`, truck_id: 'bil-1', member_id: `u-${member_name}`, member_name, start_day, end_day, role,
    });
    const sources: CrewSources = {
      segmentCrew: new Map(),
      weekly: [week('Fredagsfolk', '2026-10-19', '2026-10-25'), week('Måndagsfolk', '2026-10-26', '2026-11-01')],
      defaults: [{ id: 'd1', truck_id: 'bil-1', member_id: 'u-std', member_name: 'Standardteam', role: 'member' }],
    };

    it('ger varje dag sin veckas besättning', () => {
      const facts = buildScheduleFacts([row('seg-1', '2026-10-23'), row('seg-1', '2026-10-26')], [friToMon], sources);
      expect(factOf(facts, 'seg-1', '2026-10-23').crew).toEqual(['Fredagsfolk']);
      expect(factOf(facts, 'seg-1', '2026-10-26').crew).toEqual(['Måndagsfolk']);
    });

    it('tar bilens standardteam bara den vecka som saknar egen besättning', () => {
      const onlyFirstWeek: CrewSources = { ...sources, weekly: [sources.weekly[0]] };
      const facts = buildScheduleFacts([row('seg-1', '2026-10-23'), row('seg-1', '2026-10-26')], [friToMon], onlyFirstWeek);
      expect(factOf(facts, 'seg-1', '2026-10-23').crew).toEqual(['Fredagsfolk']);
      expect(factOf(facts, 'seg-1', '2026-10-26').crew).toEqual(['Standardteam']);
    });

    it('lägger placeringens egen besättning till varje dag, ledaren först', () => {
      const withExtra: CrewSources = {
        ...sources,
        weekly: [week('Ledaren', '2026-10-19', '2026-10-25', 'leader'), sources.weekly[0]],
        segmentCrew: new Map([['seg-1', [{ id: 'c1', member_id: 'u-extra', member_name: 'Extra' }]]]),
      };
      const facts = buildScheduleFacts([row('seg-1', '2026-10-23')], [friToMon], withExtra);
      expect(factOf(facts, 'seg-1', '2026-10-23').crew).toEqual(['Ledaren', 'Extra', 'Fredagsfolk']);
    });

    it('lämnar teamet tomt när besättningen inte gick att läsa', () => {
      expect(factOf(buildScheduleFacts([row()], [segment()], null)).crew).toEqual([]);
    });
  });
});

// Läsmodellen bakom fakta: samma mapSegment och säckbok som tavlan, för bestämda placeringar.

describe('listSegmentsByIds', () => {
  const rawSegment = {
    id: 'seg-1', work_order_id: 'wo-1', stage_id: null, truck_id: 'bil-1', start_day: '2026-10-22', end_day: '2026-10-22',
    sort_index: 0, job_type: null, on_hold: false, created_by: null, created_by_name: null, placeholder_title: null,
    placeholder_customer: null, field_visible: false, work_description: null, created_at: '', updated_at: '',
    work_order: {
      order_number: 'AO-1', fortnox_order_number: '77', project_name: 'Vind', client_name: 'Kund AB', status: 'in_progress',
      customer_snapshot: {}, work_address: null, line_items: [], crm_work_order_stages: [],
    },
  };

  function fake() {
    const asked: Record<string, string[]> = {};
    const client = {
      from(table: string) {
        const builder: any = {
          select: () => builder,
          order: () => builder,
          in: (_col: string, ids: string[]) => {
            asked[table] = ids;
            if (table === 'ops_segments') return builder;
            if (table === 'ops_segment_reports') {
              // Delrapporter på 30 + 25 och en egenkontroll på 91: svaret är 91, aldrig 146.
              return Promise.resolve({
                data: [
                  { work_order_id: 'wo-1', sacks_blown: 30, kind: 'partial' },
                  { work_order_id: 'wo-1', sacks_blown: 25, kind: 'partial' },
                  { work_order_id: 'wo-1', sacks_blown: 91, kind: 'final' },
                ],
                error: null,
              });
            }
            return Promise.resolve({ data: [], error: null });
          },
          then: (resolve: (v: unknown) => void) => resolve({ data: [rawSegment], error: null }),
        };
        return builder;
      },
    } as any;
    return { client, asked };
  }

  it('läser bara de givna placeringarna, med säckbokens regel', async () => {
    const { client, asked } = fake();
    const { data, error } = await listSegmentsByIds(client, ['seg-1']);
    expect(error).toBeNull();
    expect(asked.ops_segments).toEqual(['seg-1']);
    expect(data[0]).toMatchObject({ id: 'seg-1', sacks_reported: 91, sacks_final: true });
    expect(data[0].job).toMatchObject({ ref: '#77', status: 'in_progress' });
  });

  it('läser ingenting utan id:n', async () => {
    const { client, asked } = fake();
    expect(await listSegmentsByIds(client, [])).toEqual({ data: [], error: null });
    expect(asked).toEqual({});
  });
});

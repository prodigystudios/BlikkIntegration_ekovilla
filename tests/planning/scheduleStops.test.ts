import { describe, it, expect } from 'vitest';
import { crmJobToScheduleItem, type CrmJobRow } from '@/lib/domains/planning/myJobs';
import {
  countScheduleRowsOnDay,
  groupScheduleStops,
  isSchedulePlaceholder,
  mapsSearchHref,
  nextOpenStopIndex,
  reportedProgress,
  projectRepeatsAddress,
  scheduleDayLabel,
  scheduleRowRef,
  scheduleStopMeta,
  stopCallLine,
  workdayPosition,
  workOrderHref,
} from '@/lib/domains/planning/scheduleStops';

// Startsidans arbetsschema som en rutt: dag → lastbil → stopp. Siffran på kortet är montörens plats
// på bilens dag och ska vara samma som planeringstavlans "Jobb 1 av 2".

const DAY = '2026-10-22';

const crm = (over: Partial<CrmJobRow> = {}) =>
  crmJobToScheduleItem({
    segment_id: 'seg-x',
    work_order_id: 'wo-x',
    order_number: 'AO-1',
    fortnox_order_number: null,
    project_name: 'Vindsisolering',
    customer: 'Villa Ek',
    job_day: DAY,
    start_day: DAY,
    end_day: DAY,
    truck: 'Bil 1',
    truck_color: null,
    job_type: 'ekovilla',
    status: 'scheduled',
    work_address: null,
    customer_address: null,
    placeholder_title: null,
    work_description: null,
    sort_index: 0,
    ...over,
  });

type Legacy = { truck: string | null; order_number: string; project_name: string; job_day: string | null; start_day: string | null; sort_index: number | null };
const legacy = (over: Partial<Legacy>): Legacy => ({ truck: 'Bil 1', order_number: '150', project_name: 'Gammalt', job_day: DAY, start_day: DAY, sort_index: null, ...over });

// Som startsidans getSortIndex för de gamla raderna.
const legacySort = (row: object) => {
  const v = (row as { sort_index?: number | null }).sort_index;
  return typeof v === 'number' ? v : null;
};

const label = (row: object) => ('segment_id' in row ? String((row as { segment_id: string }).segment_id) : `legacy:${(row as Legacy).order_number}`);
const route = (rows: Array<ReturnType<typeof crm> | Legacy>, onlyDay: string | null = DAY) =>
  groupScheduleStops(rows, legacySort, onlyDay).map((d) => ({
    day: d.day,
    trucks: d.trucks.map((t) => ({ truck: t.truck, stops: t.stops.map((s) => `${label(s.row)}=${s.stop ?? '-'}/${s.of}`) })),
  }));

describe('groupScheduleStops', () => {
  it('numrerar bilens stopp i planerarens ordning, inte i ordernumrets', () => {
    // Ordernumren pekar åt andra hållet — sorterat på dem hade AO-1 blivit stopp 1.
    const a = crm({ segment_id: 'seg-a', order_number: 'AO-1', sort_index: 1 });
    const b = crm({ segment_id: 'seg-b', order_number: 'AO-2', sort_index: 0 });
    expect(route([a, b])).toEqual([{ day: DAY, trucks: [{ truck: 'Bil 1', stops: ['seg-b=1/2', 'seg-a=2/2'] }] }]);
  });

  it('ger varje bil sin egen rutt', () => {
    const bil2 = crm({ segment_id: 'seg-2', truck: 'Bil 2', sort_index: 0 });
    const bil1a = crm({ segment_id: 'seg-1a', truck: 'Bil 1', sort_index: 0 });
    const bil1b = crm({ segment_id: 'seg-1b', truck: 'Bil 1', sort_index: 1 });
    expect(route([bil2, bil1b, bil1a])[0].trucks).toEqual([
      { truck: 'Bil 1', stops: ['seg-1a=1/2', 'seg-1b=2/2'] },
      { truck: 'Bil 2', stops: ['seg-2=1/1'] },
    ]);
  });

  it('lägger jobben utan lastbil SIST och utan siffra, fast jämförelsen sorterar tom bil först', () => {
    const loose = crm({ segment_id: 'seg-loose', truck: null, sort_index: 0 });
    const onTruck = crm({ segment_id: 'seg-bil', truck: 'Bil 1', sort_index: 5 });
    expect(route([loose, onTruck])[0].trucks).toEqual([
      { truck: 'Bil 1', stops: ['seg-bil=1/1'] },
      { truck: null, stops: ['seg-loose=-/1'] },
    ]);
  });

  it('räknar en bil med bara blanksteg i namnet som utan lastbil', () => {
    // En gammal rad, för den kommer orörd ur feeden — crmJobToScheduleItem trimmar redan bilen till null.
    const blank = legacy({ truck: '  ', order_number: 'blank' });
    expect(route([blank])[0].trucks).toEqual([{ truck: null, stops: ['legacy:blank=-/1'] }]);
  });

  it('lägger samma bil med och utan blanksteg på slutet i EN rutt', () => {
    // Den gamla raden kommer otrimmad ur feeden, CRM-raden trimmad.
    const old = legacy({ truck: 'Bil 1 ', order_number: 'gammal' });
    const job = crm({ segment_id: 'seg-a', truck: 'Bil 1' });
    expect(route([old, job])[0].trucks).toEqual([{ truck: 'Bil 1', stops: ['legacy:gammal=1/2', 'seg-a=2/2'] }]);
  });

  it('räknar platshållaren som ett stopp, som planeringstavlan gör', () => {
    const job = crm({ segment_id: 'seg-job', sort_index: 0 });
    const service = crm({ segment_id: 'seg-service', work_order_id: null, placeholder_title: 'Service', project_name: null, sort_index: 1 });
    expect(route([service, job])[0].trucks[0].stops).toEqual(['seg-job=1/2', 'seg-service=2/2']);
  });

  it('numrerar över båda källorna på samma bil, de gamla raderna först', () => {
    const crmJob = crm({ segment_id: 'seg-a', sort_index: 0 });
    const old = legacy({ sort_index: 3 });
    expect(route([crmJob, old])[0].trucks[0].stops).toEqual(['legacy:150=1/2', 'seg-a=2/2']);
  });

  it('visar bara den valda dagens utbredda rader', () => {
    const today = crm({ segment_id: 'seg-today' });
    const tomorrow = crm({ segment_id: 'seg-tomorrow', job_day: '2026-10-23', start_day: '2026-10-23', end_day: '2026-10-23' });
    expect(route([today, tomorrow])).toEqual([{ day: DAY, trucks: [{ truck: 'Bil 1', stops: ['seg-today=1/1'] }] }]);
    expect(route([tomorrow], DAY)).toEqual([]);
  });

  it('räknar dagens position per dag — ett flerdagarsjobb kan vara stopp 2 i dag och stopp 1 i morgon', () => {
    // Fortsätter från i går (startdagen avgör vid lika tal) och står därför först i dag.
    const continuing = crm({ segment_id: 'seg-long', start_day: '2026-10-21', end_day: '2026-10-23', sort_index: 0 });
    const todayOnly = crm({ segment_id: 'seg-short', sort_index: 0 });
    const longTomorrow = crm({ segment_id: 'seg-long', job_day: '2026-10-23', start_day: '2026-10-21', end_day: '2026-10-23', sort_index: 0 });
    expect(route([todayOnly, continuing, longTomorrow], null)).toEqual([
      { day: DAY, trucks: [{ truck: 'Bil 1', stops: ['seg-long=1/2', 'seg-short=2/2'] }] },
      { day: '2026-10-23', trucks: [{ truck: 'Bil 1', stops: ['seg-long=1/1'] }] },
    ]);
  });

  it('grupperar hela veckan per dag i datumordning och tappar ingen rad', () => {
    const fri = legacy({ order_number: 'fre', job_day: '2026-10-23', start_day: '2026-10-23' });
    const thu = legacy({ order_number: 'tor', job_day: DAY, start_day: DAY });
    // En rad utan utbredd dag hamnar på sin startdag, en utan någon dag alls under 'okänd'.
    const noJobDay = legacy({ order_number: 'start', job_day: null, start_day: '2026-10-20' });
    const noDay = legacy({ order_number: 'ingen', job_day: null, start_day: null });
    const days = groupScheduleStops([fri, noDay, thu, noJobDay], legacySort, null);
    expect(days.map((d) => [d.day, d.count])).toEqual([['2026-10-20', 1], [DAY, 1], ['2026-10-23', 1], ['okänd', 1]]);
  });

  it('räknar dagknappen på samma urval som dagen visar', () => {
    // En gammal rad kan sakna utbredd dag (crmJobToScheduleItem fyller i den från startdagen, den
    // gamla feeden gör det inte). Den visas inte under en vald dag — då får knappen inte räkna den.
    const rows = [crm({ segment_id: 'a' }), legacy({ job_day: null, start_day: DAY }), crm({ segment_id: 'c', job_day: '2026-10-23' })];
    expect(countScheduleRowsOnDay(rows, DAY)).toBe(1);
    expect(groupScheduleStops(rows, legacySort, DAY)[0].count).toBe(1);
  });
});

describe('isSchedulePlaceholder', () => {
  it('är en CRM-placering utan arbetsorder', () => {
    expect(isSchedulePlaceholder(crm({ work_order_id: null }))).toBe(true);
    expect(isSchedulePlaceholder(crm())).toBe(false);
  });

  it('gäller aldrig en gammal rad, som saknar arbetsorder men har sin detaljmodal', () => {
    expect(isSchedulePlaceholder({ work_order_id: null })).toBe(false);
  });
});

describe('workOrderHref', () => {
  it('leder ett CRM-jobb till fältvyn, scopat till placeringen', () => {
    expect(workOrderHref(crm({ segment_id: 'seg 1', work_order_id: 'wo-1' }))).toBe('/arbetsorder/wo-1?segment=seg%201');
  });

  it('visar helheten när segmentet saknas', () => {
    expect(workOrderHref({ source: 'crm', work_order_id: 'wo-1', segment_id: null })).toBe('/arbetsorder/wo-1');
  });

  it('har ingen länk för en platshållare', () => {
    expect(workOrderHref(crm({ work_order_id: null }))).toBeNull();
  });

  it('grindar på källan: en äldre rad leder aldrig till /arbetsorder, ens med ett id', () => {
    expect(workOrderHref({ work_order_id: 'wo-1', segment_id: 'seg-1' })).toBeNull();
  });
});

describe('scheduleRowRef', () => {
  it('använder CRM-radens färdiga referens', () => {
    expect(scheduleRowRef(crm({ fortnox_order_number: '5418' }))).toBe('#5418');
    expect(scheduleRowRef(crm({ fortnox_order_number: null, order_number: 'AO-RT-013' }))).toBe('AO-RT-013');
  });

  it("skriver en gammal Blikk-rads nummer med '#', som det gamla kortet", () => {
    expect(scheduleRowRef({ order_number: 77 })).toBe('#77');
  });

  it('har ingen referens för en platshållare', () => {
    expect(scheduleRowRef(crm({ work_order_id: null, order_number: null }))).toBeNull();
    expect(scheduleRowRef({ order_number: '  ' })).toBeNull();
  });
});

describe('scheduleStopMeta', () => {
  const service = crm({ work_order_id: null, order_number: null, customer: null, placeholder_title: 'Service' });

  it('skriver platsen och referensen när bilen har flera jobb', () => {
    expect(scheduleStopMeta(crm({ fortnox_order_number: '77' }), 2, 3)).toEqual(['Stopp 2 av 3', '#77']);
  });

  it('skriver ingen plats för ett ensamt jobb, som tavlan', () => {
    expect(scheduleStopMeta(crm({ order_number: 'AO-1' }), 1, 1)).toEqual(['AO-1']);
    expect(scheduleStopMeta(crm({ order_number: 'AO-1' }), null, 2)).toEqual(['AO-1']);
  });

  it('kallar en ensam platshållare utan kund för en intern heldag', () => {
    expect(scheduleStopMeta(service, 1, 1)).toEqual(['Heldag', 'Intern']);
  });

  it('numrerar en platshållare som delar dag, utan referens', () => {
    expect(scheduleStopMeta(service, 3, 3)).toEqual(['Stopp 3 av 3', 'Intern']);
  });

  it('kallar inte en platshållare med kund för intern', () => {
    expect(scheduleStopMeta(crm({ work_order_id: null, order_number: null, customer: 'Bygg AB' }), 1, 1)).toEqual(['Heldag']);
  });

  it("skriver en gammal rads nummer med '#'", () => {
    expect(scheduleStopMeta(legacy({ order_number: '812' }), 1, 2)).toEqual(['Stopp 1 av 2', '#812']);
  });
});

describe('workdayPosition', () => {
  it('räknar jobbets arbetsdagar', () => {
    // Mån–ons.
    expect(workdayPosition('2026-10-20', '2026-10-19', '2026-10-21')).toEqual({ day: 2, of: 3 });
  });

  it('hoppar över helgen: fre–mån är två arbetsdagar', () => {
    expect(workdayPosition('2026-10-26', '2026-10-23', '2026-10-26')).toEqual({ day: 2, of: 2 });
  });

  it('hoppar över röda dagar', () => {
    // Kristi himmelsfärd 14 maj 2026 (tors). Ons–fre är två arbetsdagar.
    expect(workdayPosition('2026-05-15', '2026-05-13', '2026-05-15')).toEqual({ day: 2, of: 2 });
  });

  it('ger ingen etikett på en dag som själv inte är en arbetsdag', () => {
    // Feeden ger en rad per kalenderdag, så lördagen i ett fre–mån-jobb har en egen rad.
    expect(workdayPosition('2026-10-24', '2026-10-23', '2026-10-26')).toBeNull();
    expect(workdayPosition('2026-05-14', '2026-05-13', '2026-05-15')).toBeNull();
  });

  it('ger ingen etikett när jobbet bara har en arbetsdag', () => {
    expect(workdayPosition(DAY, DAY, DAY)).toBeNull();
    // Fre–sön spänner över tre kalenderdagar men är en dags arbete.
    expect(workdayPosition('2026-10-23', '2026-10-23', '2026-10-25')).toBeNull();
  });

  it('ger ingen etikett utan datum', () => {
    expect(workdayPosition(null, DAY, '2026-10-23')).toBeNull();
    expect(workdayPosition(DAY, null, '2026-10-23')).toBeNull();
  });
});

describe('scheduleDayLabel', () => {
  it('skriver dagen som lastbilsrubriken gör', () => {
    expect(scheduleDayLabel('2026-10-22')).toBe('Torsdag 22 oktober');
    expect(scheduleDayLabel('2026-10-22', 'short')).toBe('Tor 22 okt');
  });

  it('läser veckodagen ur datumet, inte ur klockan', () => {
    // Måndag och söndag är listans två ändar — ett fel i förskjutningen syns här först.
    expect(scheduleDayLabel('2026-10-19')).toBe('Måndag 19 oktober');
    expect(scheduleDayLabel('2026-10-25')).toBe('Söndag 25 oktober');
    expect(scheduleDayLabel('2027-01-01', 'short')).toBe('Fre 1 jan');
  });

  it('skriver ett okänt datum som okänt', () => {
    expect(scheduleDayLabel('okänd')).toBe('Okänt datum');
  });
});

describe('projectRepeatsAddress', () => {
  it('känner igen ett projekt som heter efter gatan', () => {
    expect(projectRepeatsAddress('Strandgatan 9, Skutskär', 'Strandgatan 9, 814 30, Skutskär')).toBe(true);
    expect(projectRepeatsAddress('strandgatan 9', 'Strandgatan 9, 814 30, Skutskär')).toBe(true);
  });

  it('jämför hela ord, så ett annat husnummer inte räknas som samma gata', () => {
    expect(projectRepeatsAddress('Strandgatan 9', 'Strandgatan 91, 814 30, Skutskär')).toBe(false);
  });

  it('behåller ett projektnamn som säger något mer', () => {
    expect(projectRepeatsAddress('Strandgatan 9 – vind', 'Strandgatan 9, 814 30, Skutskär')).toBe(false);
    expect(projectRepeatsAddress('Villa tak', 'Testvägen 32, 13232, Söderbärke')).toBe(false);
    expect(projectRepeatsAddress('', 'Testvägen 32')).toBe(false);
  });
});

describe('stopCallLine', () => {
  const contact = (over: Partial<Parameters<typeof stopCallLine>[0]> = {}) =>
    ({ contactName: 'Björn', phone: '08-222', isOnSiteContact: false, phoneFromCustomer: false, ...over });

  it('ringer orderns kontaktperson vid namn', () => {
    expect(stopCallLine(contact(), 'Acme AB')).toEqual({ label: 'Ring Björn', note: null });
  });

  it('säger att kontakten på plats är någon annan än kunden', () => {
    expect(stopCallLine(contact({ contactName: 'Ulla', isOnSiteContact: true }), 'Acme AB')).toEqual({ label: 'Ring Ulla (på plats)', note: null });
  });

  it('säger vems numret är när kontakten på plats har lånat kundens', () => {
    expect(stopCallLine(contact({ contactName: 'Ulla', isOnSiteContact: true, phoneFromCustomer: true }), 'Acme AB')?.note)
      .toBe('Numret går till kundens kontakt – kontakten på plats har inget eget.');
  });

  it('fyller aldrig i kundens namn för en namnlös kontakt på plats', () => {
    // Byggarens bolagsnamn över fastighetsägarens nummer hade varit en påhittad identitet.
    expect(stopCallLine(contact({ contactName: null, isOnSiteContact: true }), 'Bygg AB')?.label).toBe('Ring kontakten på plats');
  });

  it('låter kunden vara personen när ordern saknar kontaktnamn', () => {
    expect(stopCallLine(contact({ contactName: null }), 'Anna Andersson')?.label).toBe('Ring Anna Andersson');
    expect(stopCallLine(contact({ contactName: '  ' }), null)?.label).toBe('Ring kunden');
  });

  it('erbjuder ingen Ring-länk för ett nummer utan siffror', () => {
    // Telefonfälten är fritext. "ring växeln" hade blivit `tel:` — en länk som inte ringer någon.
    expect(stopCallLine(contact({ phone: 'ring växeln' }), 'Acme AB')).toBeNull();
    expect(stopCallLine(contact({ phone: '+46 70-123' }), 'Acme AB')).not.toBeNull();
  });
});

describe('nextOpenStopIndex', () => {
  it('pekar på det första stoppet som inte är klart', () => {
    expect(nextOpenStopIndex([true, false, false], (done) => done)).toBe(1);
    expect(nextOpenStopIndex([false, true], (done) => done)).toBe(0);
  });

  it('har inget nästa stopp när alla är klara', () => {
    expect(nextOpenStopIndex([true, true], (done) => done)).toBe(-1);
  });
});

describe('reportedProgress', () => {
  const base = { plannedSacks: 120, orderSacks: null, staged: false, reported: 45 };

  it('jämför med placeringens säckar på ett vanligt jobb', () => {
    expect(reportedProgress(base, false)).toEqual({ label: 'Rapporterat', of: 120, percent: 37.5 });
  });

  it('säger hela jobbet på ett flerdagarsjobb', () => {
    expect(reportedProgress(base, true)?.label).toBe('Rapporterat hela jobbet');
  });

  it('jämför med HELA ORDERNS säckar på en uppdelad order, aldrig med etappens', () => {
    // Säckboken är per arbetsorder: 45 är orderns, så "45 av 120" (etappens) hade ljugit.
    expect(reportedProgress({ ...base, orderSacks: 300, staged: true }, true)).toEqual({ label: 'Rapporterat hela ordern', of: 300, percent: 15 });
  });

  it('ritar ingen mätare utan nämnare', () => {
    expect(reportedProgress({ ...base, plannedSacks: null }, false)).toEqual({ label: 'Rapporterat', of: null, percent: null });
    expect(reportedProgress({ ...base, staged: true, orderSacks: null }, false)?.percent).toBeNull();
  });

  it('slår i taket vid överrapportering', () => {
    expect(reportedProgress({ ...base, reported: 150 }, false)?.percent).toBe(100);
  });

  it('har ingen rad när inget är rapporterat', () => {
    expect(reportedProgress({ ...base, reported: 0 }, false)).toBeNull();
  });
});

describe('mapsSearchHref', () => {
  it('kodar adressen', () => {
    expect(mapsSearchHref('Strandgatan 9, Skutskär')).toBe('https://www.google.com/maps/search/?api=1&query=Strandgatan%209%2C%20Skutsk%C3%A4r');
  });
});

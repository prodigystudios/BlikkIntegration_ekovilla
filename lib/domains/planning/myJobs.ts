import { workOrderRef, resolveJobAddress } from './display';
import { compareBoardOrder } from './order';

// Field cutover fas 1c — one feed, two worlds.
//
// During the drain, an installer's day can contain jobs from the legacy Blikk planning
// (get_my_jobs → planning_segments) and from the new CRM planning (get_my_crm_jobs → ops_segments
// → crm_work_orders). They are scheduled in different systems but they are the same person's week,
// so /mina-jobb shows them as one chronological list and tags each row with where it came from.
// The Blikk rows shrink toward zero on their own as planning moves into CRM — no migration, no
// cutover date.
//
// Pure: no I/O, no React. The RPC calls live in the page; this module only decides shape and order.

export type BlikkJobRow = {
  segment_id: string | number | null;
  project_id: string | number | null;
  project_name: string | null;
  customer: string | null;
  order_number: string | null;
  job_day: string | null;
  start_day: string | null;
  truck: string | null;
  job_type: string | null;
  bag_count: number | null;
};

export type CrmJobRow = {
  segment_id: string;
  // null på en platshållare — en bokad dag som planeraren publicerat till entreprenaden utan att
  // det finns (eller någonsin kommer att finnas) en arbetsorder: service av maskiner, interna
  // dagar. Det är den enda skillnaden mellan sorterna, och därmed det som avgör vad kortet får
  // erbjuda: utan order finns ingen arbetsorder att öppna.
  work_order_id: string | null;
  order_number: string | null;
  fortnox_order_number: string | null;
  project_name: string | null;
  customer: string | null;
  job_day: string | null;
  start_day: string | null;
  end_day: string | null;
  truck: string | null;
  truck_color: string | null;
  job_type: string | null;
  status: string | null;
  work_address: Record<string, unknown> | null;
  customer_address: Record<string, unknown> | null;
  // Platshållarens egen rubrik + vad som ska göras. Bara satta när work_order_id är null.
  placeholder_title: string | null;
  work_description: string | null;
  // Planerarens ordning på dagen (ops_segments.sort_index). Bara jämförbar med andra placeringar på
  // samma bil samma dag — se compareScheduleItems.
  sort_index: number | null;
};

export type MyJob = {
  // Stable React key. Segment + day, namespaced by source so a Blikk and a CRM segment can never
  // collide on a numeric/uuid id that happens to stringify the same.
  key: string;
  source: 'blikk' | 'crm';
  day: string;
  // How the business refers to the job: '#<fortnox>' when synced, else the internal order number.
  ref: string | null;
  projectName: string | null;
  customer: string | null;
  truck: string | null;
  truckColor: string | null;
  jobType: string | null;
  // CRM rows carry the work order status; Blikk rows have no equivalent.
  status: string | null;
  address: string | null;
  bagCount: number | null;
  // Vad som ska göras, skrivet av planeraren. Bara platshållare bär den — ett riktigt jobb har sin
  // arbetsorder att öppna, och där står allt.
  description: string | null;
  // Exactly one of these is set, by source. workOrderId drives the link to /arbetsorder/<id>;
  // projectId keeps the legacy Blikk comment/time flow working on old rows.
  //
  // ⚠️ En CRM-rad kan numera sakna BÅDA: en platshållare har ingen arbetsorder och inget
  // Blikk-projekt. Allt som leder någonstans måste därför grindas på id:t, inte på källan.
  workOrderId: string | null;
  projectId: string | null;
  /**
   * Placeringen raden kommer ifrån.
   *
   * 🧨 DRIVER ?segment= PÅ LÄNKEN TILL ARBETSORDERN. Fältvyn är per arbetsorder och kan inte veta
   * vilken ETAPP besättningen kom ifrån utan den — utan segmentet får en besättning som bara ska
   * göra etapp 1 hela ordern i handen, vilket är precis det etapperna finns för att undvika.
   * `key` bär det redan, men inbakat i en sträng ingen får plocka isär.
   */
  segmentId: string | null;
  // Placeringens startdag och planerarens ordning på dagen — det dagens CRM-jobb sorteras på, i samma
  // ordning som planeringstavlan (se compareMyJobs). null på Blikk-rader.
  startDay: string | null;
  sortIndex: number | null;
};

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};

// A segment spans days; the feed is per day. Prefer the expanded job_day, fall back to the
// segment start so a row is never silently dropped just because the view shape changed.
const dayOf = (row: { job_day: string | null; start_day: string | null }): string | null =>
  str(row.job_day) ?? str(row.start_day);

function fromBlikk(row: BlikkJobRow): MyJob | null {
  const day = dayOf(row);
  if (!day) return null;
  const projectId = str(row.project_id);
  const orderNumber = str(row.order_number);
  return {
    key: `blikk:${str(row.segment_id) ?? projectId ?? 'x'}:${day}`,
    // Blikk-rader har ingen CRM-placering att scopa på; länken går via projectId.
    segmentId: null,
    startDay: null,
    sortIndex: null,
    source: 'blikk',
    day,
    // Legacy rows only ever carry the Blikk order number, and the old card rendered it as '#nnn'.
    ref: orderNumber ? `#${orderNumber}` : null,
    projectName: str(row.project_name),
    customer: str(row.customer),
    truck: str(row.truck),
    truckColor: null,
    jobType: str(row.job_type),
    status: null,
    address: null,
    bagCount: typeof row.bag_count === 'number' ? row.bag_count : null,
    description: null,
    workOrderId: null,
    projectId,
  };
}

function fromCrm(row: CrmJobRow): MyJob | null {
  const day = dayOf(row);
  if (!day) return null;
  // En platshållare har varken Fortnox-nummer eller internt ordernummer, så den har ingen referens
  // att visa. `workOrderRef` hade svarat med tomma strängen och kortet hade ritat en tom
  // separatorprick efter kundnamnet.
  const ref = row.work_order_id ? workOrderRef(row.fortnox_order_number, row.order_number ?? '').ref || null : null;
  return {
    key: `crm:${row.segment_id}:${day}`,
    segmentId: row.segment_id,
    startDay: str(row.start_day),
    sortIndex: typeof row.sort_index === 'number' ? row.sort_index : null,
    source: 'crm',
    day,
    ref,
    // Platshållarens titel ÄR dess rubrik. Sammanslagningen görs här och inte i SQL, av samma skäl
    // som adressprecedensen: en visningsregel hör hemma på ett ställe.
    projectName: str(row.project_name) ?? str(row.placeholder_title),
    customer: str(row.customer),
    truck: str(row.truck),
    truckColor: str(row.truck_color),
    jobType: str(row.job_type),
    status: str(row.status),
    address: resolveJobAddress(row.work_address, row.customer_address),
    // Sacks are not in the v1 RPC (derived from line_items jsonb); the work order view has them.
    bagCount: null,
    description: str(row.work_description),
    workOrderId: str(row.work_order_id),
    projectId: null,
  };
}

// The dashboard's week schedule (components/dashboard/DashboardSchedule.tsx) is built around the
// legacy get_my_jobs row shape, and its stop card (components/dashboard/schedule/ScheduleStopCard.tsx)
// renders both kinds. A CRM job is adapted INTO that shape so it renders through the same path — with a `source`
// marker so the three places that must behave differently can branch:
//   • the enrichment queries hit legacy tables by segment_id (a CRM uuid matches nothing)
//   • opening the card looks a Blikk project up BY ORDER NUMBER — which, given Fortnox numbers are
//     numeric like Blikk's, could pull up an unrelated project for a CRM job
//   • time reporting has no Blikk project to attach a CRM job to
export type ScheduleItem = {
  segment_id: string;
  project_id: string | null;
  project_name: string | null;
  customer: string | null;
  // Arbetsplatsen — kortets rubrik när den finns. Samma upplösning som /mina-jobb (resolveJobAddress),
  // så en order visar samma adress på båda ytorna. null på en platshållare: den har ingen kund.
  address: string | null;
  order_number: string | null;
  start_day: string | null;
  end_day: string | null;
  job_day: string | null;
  truck: string | null;
  job_type: string | null;
  bag_count: number | null;
  source: 'crm';
  // ⚠️ null på en platshållare. Kortet i veckoschemat navigerar till /arbetsorder/<id> och visar
  // en "Öppna arbetsorder"-länk — båda MÅSTE grindas på det här fältet, annars får besättningen en
  // knapp som inte gör något.
  work_order_id: string | null;
  // Vad som ska göras. Bara platshållare bär den; ett riktigt jobb har sin arbetsorder.
  work_description: string | null;
  // Planerarens ordning på dagen. null = feeden saknade den (en databas före migreringen).
  sort_index: number | null;
};

export function crmJobToScheduleItem(row: CrmJobRow): ScheduleItem {
  const ref = row.work_order_id ? workOrderRef(row.fortnox_order_number, row.order_number ?? '').ref || null : null;
  return {
    segment_id: row.segment_id,
    project_id: null,
    project_name: str(row.project_name) ?? str(row.placeholder_title),
    customer: str(row.customer),
    address: resolveJobAddress(row.work_address, row.customer_address),
    order_number: ref,
    start_day: str(row.start_day),
    end_day: str(row.end_day),
    job_day: dayOf(row),
    truck: str(row.truck),
    job_type: str(row.job_type),
    // Not in the v1 RPC (derived from line_items jsonb); the work order view has them.
    bag_count: null,
    source: 'crm',
    work_order_id: str(row.work_order_id),
    work_description: str(row.work_description),
    sort_index: typeof row.sort_index === 'number' ? row.sort_index : null,
  };
}

/**
 * Två CRM-jobb på samma bil samma dag, i den ordning planeringstavlan visar dem.
 *
 * ⚠️ SAMMA JÄMFÖRELSE SOM TAVLAN, inte en egen. Startsidan sorterade CRM-jobben på ordernumret, så
 * planerarens "Ordning på dagen" nådde aldrig dem som kör jobben — kortets "1/2" var ordernumrets
 * ordning. compareBoardOrder är sort_index → startdag → id: ett jobb som fortsätter från igår står
 * först tills planeraren säger annat. Bilen jämförs av anroparen.
 */
export function compareScheduleItems(a: ScheduleItem, b: ScheduleItem): number {
  return compareBoardOrder(boardOrderable(a), boardOrderable(b));
}

// Saknas talet (en feed före migreringen) blir alla lika, och startdagen avgör.
const boardOrderable = (it: ScheduleItem) => ({ id: it.segment_id, start_day: it.start_day ?? '', sort_index: it.sort_index ?? 0 });

// En rad ur den gamla feeden (get_my_jobs). Bara fälten ordningen läser.
type LegacyScheduleRow = {
  source?: undefined;
  truck?: string | null;
  order_number?: string | number | null;
  project_name?: string | null;
};
export type ScheduleRow = ScheduleItem | LegacyScheduleRow;

/**
 * Startsidans ordning inom en dag: bil, sedan källan, sedan källans egen ordning.
 *
 * ⚠️ KÄLLAN FÖRE TALET. CRM-jobbens sort_index (ops_segments) och de gamla radernas
 * (planning_segments) är två orelaterade talserier. Jämförda med varandra hade ett CRM-jobb hamnat
 * före eller efter ett Blikk-jobb på samma bil av en slump, och jämförelsen blev icke-transitiv
 * (CRM-par på id, blandade par på ordernummer) — sorteringen kunde då bero på i vilken ordning de två
 * anropen svarade. De gamla raderna står först, som de i praktiken gjorde förut.
 *
 * `legacySortIndex` är de gamla radernas ordning, som startsidan hämtar separat ur planning_segments.
 */
export function compareScheduleRows(
  a: ScheduleRow,
  b: ScheduleRow,
  legacySortIndex: (row: LegacyScheduleRow) => number | null,
): number {
  const ta = (a.truck || '').toString();
  const tb = (b.truck || '').toString();
  if (ta !== tb) return ta.localeCompare(tb, 'sv');
  if (a.source === 'crm' || b.source === 'crm') {
    if (a.source !== 'crm') return -1;
    if (b.source !== 'crm') return 1;
    return compareScheduleItems(a, b);
  }
  // De gamla Blikk-radernas ordning, oförändrad.
  const sa = legacySortIndex(a);
  const sb = legacySortIndex(b);
  if (sa != null && sb != null && sa !== sb) return sa - sb;
  if (sa != null && sb == null) return -1;
  if (sb != null && sa == null) return 1;
  const ao = (a.order_number || '').toString();
  const bo = (b.order_number || '').toString();
  if (ao && bo && ao !== bo) return ao.localeCompare(bo, 'sv');
  return (a.project_name || '').toString().localeCompare((b.project_name || '').toString(), 'sv');
}

// Merge both feeds into one chronological list.
//
// Rows without a day are dropped (an unscheduled row is not a job in a day-ordered feed).
// Duplicates on the same key are collapsed, keeping the first occurrence — the same segment can
// arrive twice if a range query overlaps itself, and a doubled card reads as a doubled job.
export function mergeMyJobs(
  blikkJobs: BlikkJobRow[] | null | undefined,
  crmJobs: CrmJobRow[] | null | undefined,
): MyJob[] {
  const rows: MyJob[] = [
    ...(Array.isArray(blikkJobs) ? blikkJobs : []).map(fromBlikk).filter((j): j is MyJob => j !== null),
    ...(Array.isArray(crmJobs) ? crmJobs : []).map(fromCrm).filter((j): j is MyJob => j !== null),
  ];

  const seen = new Set<string>();
  const deduped = rows.filter((j) => (seen.has(j.key) ? false : (seen.add(j.key), true)));

  return deduped.sort(compareMyJobs);
}

/**
 * /mina-jobb: dag, bil, källa, och för CRM-jobben planerarens ordning — samma som startsidan och
 * planeringstavlan (compareBoardOrder). Förut sorterades dagen på ordernumret, så två vyer över samma
 * montörs dag visade jobben i olika ordning.
 *
 * Helt bestämd (till sist `key`) i stället för att lämnas åt i vilken ordning de två anropen svarade,
 * så listan inte kastas om mellan laddningar. Källan före ordningen av samma skäl som i
 * compareScheduleRows: två talserier som inte går att jämföra.
 */
export function compareMyJobs(a: MyJob, b: MyJob): number {
  const byDay = a.day.localeCompare(b.day) || (a.truck ?? '').localeCompare(b.truck ?? '', 'sv');
  if (byDay) return byDay;
  if (a.source !== b.source) return a.source === 'blikk' ? -1 : 1;
  if (a.source === 'crm') {
    const byBoard = compareBoardOrder(
      { id: a.segmentId ?? a.key, start_day: a.startDay ?? '', sort_index: a.sortIndex ?? 0 },
      { id: b.segmentId ?? b.key, start_day: b.startDay ?? '', sort_index: b.sortIndex ?? 0 },
    );
    if (byBoard) return byBoard;
  }
  return (a.ref ?? '').localeCompare(b.ref ?? '') || a.key.localeCompare(b.key);
}

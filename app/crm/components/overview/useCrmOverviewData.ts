"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCrmOverviewWindow } from '@/lib/domains/crm/goals';
import type { CrmOverviewSummary } from '@/lib/domains/crm/overviewSummary';
import type { WeeklyScoreboard } from '@/lib/domains/crm/weeklyScoreboard';
import type { CallItem, QuoteItem, TaskItem, WorkOrderItem } from './overviewTypes';

// The page's numbers come pre-counted from /api/crm/overview; the lists are only what the four
// "senaste …"-cards render, five rows each. Counting list rows in the browser is what this
// replaced — see lib/domains/crm/overviewSummary.ts for why that could not hold.
type LoadState = {
  summary: CrmOverviewSummary | null;
  calls: CallItem[];
  tasks: TaskItem[];
  quotes: QuoteItem[];
  // Lagets veckotavla: utfall per säljare mot veckomålen, läst förbi RLS så att alla ser hela
  // laget. Ersätter målhämtningen — tavlan bär både målen och utfallet.
  scoreboard: WeeklyScoreboard | null;
  workOrders: WorkOrderItem[];
  // Vilka hämtningar som inte gick att läsa. Varje sektion föder sin egen yta, så ett fel i en
  // av dem släcker den ytan och inget mer. Tidigare kastade fyra av sex hämtningar och
  // catch-grenen nollställde HELA state: en blinkande /api/crm/goals tog offertlistan,
  // orderlistan och statusbilden med sig. Arbetsorderhämtningen hade redan undantaget — det
  // här är samma tolerans, för alla.
  failed: SectionKey[];
};

export type SectionKey = 'summary' | 'calls' | 'tasks' | 'quotes' | 'scoreboard' | 'workOrders';

// Enda stället ordningen bestäms. Både hämtningarna och failed-listan itererar den här, så de
// kan inte glida isär — och Record<SectionKey, string> nedan gör att en ny sektion inte kan
// läggas till utan att också få en URL.
const SECTION_ORDER: SectionKey[] = ['summary', 'calls', 'tasks', 'quotes', 'scoreboard', 'workOrders'];

export const sectionLabel: Record<SectionKey, string> = {
  summary: 'siffrorna',
  calls: 'samtal',
  tasks: 'uppgifter',
  quotes: 'offerter',
  scoreboard: 'veckomålen',
  workOrders: 'arbetsordrar',
};

type Section = { ok: boolean; json: any };

// Hämtar EN sektion och läser dess kropp. Kastar aldrig — ett avvisat löfte, ett icke-ok svar och
// en otolkbar kropp är samma sak här: sektionen gick inte att läsa.
//
// 🧨 Varje sektion har en EGEN AbortController och en egen timer. Med en delad controller för alla
// sex — och kropparna lästa först efter Promise.allSettled — räckte EN hängande endpoint för att
// avbryta de fem andras olästa kroppsströmmar: deras res.json() avvisades, alla sex flaggades, och
// sidan tömdes. Det var precis den allt-eller-inget-släckning allSettled infördes för att ta bort.
// Kroppen läses därför direkt efter headern, innanför sektionens egen timeout, och timern rensas
// när sektionen är klar — annars hinner den brinna medan man väntar in en långsam granne.
//
// `undefined` som sentinel, inte null: en 200 med trasig kropp gav annars ok:true och json:null,
// summeringen föll tillbaka på EMPTY_SUMMARY, och sidan visade "0 kr" och "Läget är lugnt" utan
// felruta — okänt renderat som en säker nolla.
async function readSection(url: string): Promise<Section> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    const json = await res.json().catch(() => undefined);
    return { ok: res.ok && json !== undefined, json: json ?? null };
  } catch {
    return { ok: false, json: null };
  } finally {
    clearTimeout(timer);
  }
}

function itemsOf<T>(section: Section): T[] {
  return section.ok && Array.isArray(section.json?.data?.items) ? section.json.data.items : [];
}

// Rows per "senaste …" card. Five is enough to find what you just worked on without turning the
// overview into a list page — the cards' own "Visa alla" leads there.
export const RECENT_ITEM_LIMIT = 5;

// Utan tak väntar en hämtning hur länge som helst, och "Uppdatera" låg utgråad på "Uppdaterar…"
// resten av sessionen — samtidigt som varje felruta bad användaren trycka på den. Gäller per
// sektion, se readSection.
const REQUEST_TIMEOUT_MS = 15_000;

// Zeros while the summary is in flight or after a failed load, so the panels render their shape
// rather than blanking. Matches what the empty lists produced before the server did the counting.
const EMPTY_SUMMARY: CrmOverviewSummary = {
  pipelineProspects: 0, newProspects: 0, quotedProspects: 0, qualifiedProspects: 0,
  activeQuotes: 0, activeQuoteValue: 0, quoteFollowUps: 0,
  openWorkOrders: 0, openOrderValue: 0, workOrdersToInvoice: 0, toInvoiceOrderValue: 0,
  callsLast7Days: 0, followUpCalls: 0, standaloneCalls: 0,
  openTasks: 0, overdueTasks: 0, todayTasks: 0,
  weekTeam: { calls: 0, quotes: 0, quoteValue: 0, orderCount: 0, orderValue: 0, invoicedValue: 0 },
  weekByUser: {},
  truncated: [],
};

// Summeringen plus fördelningsremsans delade nämnare. Veckomålen räknas inte längre här — de
// kommer färdiga med veckotavlan.
export type OverviewFigures = CrmOverviewSummary & {
  flowScale: number;
};

// Översiktens hämtningar och tillstånd. Korten får var sin sektion härifrån, och readSection ovan
// är skälet till att en sektion som fallerar bara släcker sin egen yta.
export function useCrmOverviewData() {
  const [state, setState] = useState<LoadState>({ summary: null, calls: [], tasks: [], quotes: [], scoreboard: null, workOrders: [], failed: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Varje laddning får ett nummer; avmontering och nästa laddning räknar upp det. Ett svar från
  // en överkörd omgång skriver alltså inte över en färskare. `active`-flaggan som stod här förut
  // räckte för effektens engångskörning, men Uppdatera kan starta om medan en omgång är i luften.
  const loadIdRef = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);

    try {
      const overviewWindow = getCrmOverviewWindow();
      const summaryQuery = new URLSearchParams({
        today: overviewWindow.today,
        since: overviewWindow.since,
        week_start: overviewWindow.weekStart,
        week_end: overviewWindow.weekEnd,
      });
      const scoreboardQuery = new URLSearchParams({
        today: overviewWindow.today,
        week_start: overviewWindow.weekStart,
        week_end: overviewWindow.weekEnd,
      });

      const url: Record<SectionKey, string> = {
        summary: `/api/crm/overview?${summaryQuery}`,
        // Båda hämtningarna gick förut utan parametrar och landade på domänens tak — 50 samtal
        // och 100 uppgifter för att rendera fem rader var. Sorteringen sker i Postgres FÖRE
        // kapningen, så de fem var alltid rätt fem; det här är nyttolast, inte korrekthet.
        calls: `/api/crm/calls?limit=${RECENT_ITEM_LIMIT}`,
        // status=open serverfiltrerar det kortet ändå bara visar. Utan den hämtades även
        // avklarade uppgifter hem för att kastas av ett klientfilter.
        tasks: `/api/crm/tasks?status=open&limit=${RECENT_ITEM_LIMIT}`,
        // These two lists are now only the cards' five rows. Both sorts have to be asked for:
        // the offer list's default order leads with drafts and lost quotes, the order board's
        // with the earliest installation date — so a brand new order is the table's last row.
        quotes: `/api/crm/quotes?sort=updated_desc&limit=${RECENT_ITEM_LIMIT}`,
        scoreboard: `/api/crm/overview/scoreboard?${scoreboardQuery}`,
        workOrders: `/api/crm/work-orders?sort=created_desc&limit=${RECENT_ITEM_LIMIT}`,
      };

      // readSection avvisar aldrig, så Promise.all räcker: varje sektions utfall bärs för sig och
      // en trasig granne kan inte längre dra med sig de övriga.
      const read = await Promise.all(SECTION_ORDER.map((key) => readSection(url[key])));

      if (loadId !== loadIdRef.current) return;

      const section = Object.fromEntries(SECTION_ORDER.map((key, index) => [key, read[index]])) as Record<SectionKey, Section>;
      // En 200 utan data.summary i kroppen är inget svar heller — sidans alla siffror kommer
      // därifrån, så den saknade nyttolasten flaggas som ett fel i stället för att bli nollor.
      const summaryData = (section.summary.json?.data?.summary as CrmOverviewSummary | undefined) ?? null;
      // Samma regel för tavlan: utan data.scoreboard finns inga mål att visa, och det är ett fel —
      // inte "inga veckomål satta".
      const scoreboardData = (section.scoreboard.json?.data?.scoreboard as WeeklyScoreboard | undefined) ?? null;

      // Vid Uppdatera behålls föregående innehåll för de sektioner som inte gick att läsa. Ett
      // glapp på en manuell uppdatering ska inte kasta bort ytor som stod rätt på skärmen —
      // banderollen säger vad som inte kom in, korten visar det senast kända. Vid första
      // laddningen finns inget att behålla, och då är tomt rätt.
      const keep = mode === 'refresh';
      setState((prev) => ({
        summary: summaryData ?? (keep ? prev.summary : null),
        calls: section.calls.ok ? itemsOf<CallItem>(section.calls) : keep ? prev.calls : [],
        tasks: section.tasks.ok ? itemsOf<TaskItem>(section.tasks) : keep ? prev.tasks : [],
        quotes: section.quotes.ok ? itemsOf<QuoteItem>(section.quotes) : keep ? prev.quotes : [],
        scoreboard: scoreboardData ?? (keep ? prev.scoreboard : null),
        workOrders: section.workOrders.ok ? itemsOf<WorkOrderItem>(section.workOrders) : keep ? prev.workOrders : [],
        failed: SECTION_ORDER.filter((key) => !section[key].ok
          || (key === 'summary' && summaryData == null)
          || (key === 'scoreboard' && scoreboardData == null)),
      }));
    } catch {
      // Bakkant. allSettled avvisar inte, men getCrmOverviewWindow och URLSearchParams ligger
      // utanför den. Faller något där går ingenting på sidan att lita på, så allt flaggas.
      if (loadId !== loadIdRef.current) return;
      setState((prev) => mode === 'refresh'
        ? { ...prev, failed: [...SECTION_ORDER] }
        : { summary: null, calls: [], tasks: [], quotes: [], scoreboard: null, workOrders: [], failed: [...SECTION_ORDER] });
    } finally {
      if (loadId === loadIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load('initial');
    // Räkna upp vid avmontering så ett svar som landar efteråt räknas som överkört.
    return () => { loadIdRef.current += 1; };
  }, [load]);

  // The figures are counted by /api/crm/overview; what's left here is the flow bars' shared scale.
  const summary = useMemo<OverviewFigures>(() => {
    const counted = state.summary ?? EMPTY_SUMMARY;
    return {
      ...counted,
      // Delad nämnare för fördelningsremsans tre staplar — den största av lagren, så ingen kan
      // spränga spåret och de tre förblir jämförbara med varandra.
      flowScale: Math.max(counted.activeQuoteValue, counted.openOrderValue, counted.toInvoiceOrderValue),
    };
  }, [state.summary]);

  const failed = (key: SectionKey) => state.failed.includes(key);
  // En sektion visar sitt FELLÄGE bara när den inte har något att visa. Efter en misslyckad
  // Uppdatera ligger förra omgångens innehåll kvar, och då är synligt-men-inte-uppdaterat bättre
  // än en felruta där det nyss stod fem rader. Banderollen uppe säger ändå vad som inte kom in.
  const blank = (key: SectionKey, count: number) => failed(key) && count === 0;
  // Summeringen föder varenda siffra på sidan — nyckeltalen, statusbilden, fokusraderna och
  // topplistans utfall. Fallerar den är EMPTY_SUMMARY:s nollor inte "noll" utan "vi vet inte".
  const summaryFailed = failed('summary') && state.summary == null;
  // Tavlan föder målraderna och listan per säljare. Fallerar den är en tom lista "vi vet inte",
  // inte "inga veckomål satta".
  const scoreboardFailed = failed('scoreboard') && state.scoreboard == null;

  return { state, loading, refreshing, load, summary, blank, summaryFailed, scoreboardFailed };
}

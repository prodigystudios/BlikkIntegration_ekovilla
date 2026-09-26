import { createSessionClient } from '@/lib/supabase/session';
import { z } from 'zod';

import { documentErrorPage, isDocumentNavigation } from '@/lib/api/responses';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import {
  listTimeApprovalOverview,
  normalizeOverviewRow,
  periodRange,
  periodStartOf,
} from '@/lib/domains/time/approvals';
import { listCompensations, type CompensationItem } from '@/lib/domains/time/compensations';
import { listTimeEntries, toSummarizableEntry, type TimeEntryRow } from '@/lib/domains/time/entries';
import { payrollFilename, renderPayrollPdf, type PayrollPerson } from '@/lib/domains/time/payrollPdf';
import { summarizePerson } from '@/lib/domains/time/summary';
import { can, getEffectivePermissions, requirePermission, routeError, validationError } from '@/app/api/time/_lib';

// GET /api/admin/time/payroll-pdf?period=YYYY-MM[&user_id=…|&user_ids=…,…]
//
// Månadens löneunderlag som PDF — en anställd per avsnitt. Begärt av lönebyrån 2026-09-21: hon
// behöver kunna lämna över månadens timmar till sitt externa lönesystem utan att skriva av dagvyn
// för hand.
//
// ⚠️ TVÅ NYCKLAR, OCH DE SVARAR PÅ OLIKA FRÅGOR.
//
//   • `time.entry.read.all` är den RLS öppnar ANDRAS tidrader på. Utan den filtrerar databasen
//     tyst bort allt utom läsarens egna rader, och dokumentet blir en tom månad med status 200 —
//     alltså "har inte rapporterat något" om någon som rapporterat hela augusti. Samma val och
//     samma skäl som ../entries/route.ts.
//   • `time.approve` är vad RPC:n time_approval_overview kräver, och det är DEN som bär namnen.
//     Utan den vet vi inte vems timmar vi skriver ut, och ett löneunderlag utan namn är oanvändbart.
//
// Rollerna `ekonomi` och `admin` har båda seedade, så villkoret biter bara den som fått en enstaka
// nyckel via set_user_permission — precis som grinden på /ekonomi.
//
// ⚠️ SESSIONSKLIENT, ALDRIG getSupabaseAdmin(). Dokumentet ska visa vad LÄSAREN får se, och inget
// mer: når hon inte arbetsordern skriver renderaren "Arbetsorder" i stället för ordernamnet. En
// elevated klient hade lagt kundnamn per arbetad timme i vilken läsares händer som helst, förbi
// RLS — och till skillnad från en kolumn på skärmen är det här ett dokument som lämnar appen.
//
// (Rollen `ekonomi` har crm.workorder.read sedan 2026-09-18 och ser alltså namnen i dag. Det är
// ett taget beslut, inte något den här rutten ska kringgå åt något håll — se payrollPdf.ts.)
//
// Öppnas som en fliknavigering (window.open), så svaret måste tåla att LANDA i en flik: filnamnet
// sätts i Content-Disposition och fel svaras ut som HTML i stället för JSON.

// Next försöker annars rendera rutten statiskt vid bygget, misslyckas på `cookies()` och landar i
// catch-grenen nedan — som loggar "[loneunderlag-pdf] oväntat fel" i varje byggutskrift. Felet är
// ofarligt men falskt, och en byggutskrift med falska fel i slutar läsas.
export const dynamic = 'force-dynamic';

/**
 * Personurvalet.
 *
 * `user_ids` är en kommalista och inte en upprepad parameter: den ska rymmas i en `window.open`, och
 * taket på 200 är samma broms som påminnelserna har — företaget har tjugotalet anställda, så ett
 * anrop med fler än så är ett fel någonstans.
 *
 * Utelämnas båda skrivs ALLA i periodens översikt ut. Det är avsiktligt och inte en genväg förbi
 * grinden: översikten är redan vaktad av time.approve, och dess urval (konsulter undantagna) är
 * samma urval attestlistan visar.
 */
const querySchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Ogiltig period (ÅÅÅÅ-MM)'),
  user_id: z.string().uuid('Ogiltigt användar-id').nullable().optional(),
  user_ids: z
    .string()
    .nullable()
    .optional()
    .transform((value) => (value ? value.split(',').map((part) => part.trim()).filter(Boolean) : []))
    .pipe(z.array(z.string().uuid('Ogiltigt användar-id')).max(200, 'För många personer')),
});

/**
 * PostgREST svarar med högst 1000 rader och säger inte till när det kapar.
 *
 * ⚠️ DET ÄR DYRARE HÄR ÄN NÅGON ANNANSTANS. En kapad lista i en vy ser ut som en kort lista; en
 * kapad lista i ett löneunderlag är timmar som aldrig betalas ut, i ett dokument som ser komplett
 * ut. "Alla anställda × en månad" ligger dessutom nära taket: tjugofem personer med tjugofem
 * rapporterade dagar är 625 rader, och en månad med mycket frånvaro eller flera pass per dag
 * passerar tusen utan att någon gjort något ovanligt.
 *
 * ⚠️ FÖRUTSÄTTER EN UNIK SISTA SORTERINGSNYCKEL i frågan som bläddras. Båda listfunktionerna
 * sorterar på `id` sist av precis det skälet — utan den kan en rad komma med två gånger eller
 * falla mellan sidorna. Se noten i lib/domains/time/entries.ts.
 *
 * Samma form som `readAllPages` i lib/domains/planning/pagedRead.ts, som bär samma resonemang för
 * lagerläsningarna. Den ligger kvar i planeringsdomänen (skyddad yta) och delas inte härifrån; ska
 * de slås ihop hör flytten hemma i en egen ändring.
 */
const PAGE_SIZE = 1000;
/** 50 sidor = 50 000 rader. Nås det är något annat fel, och en oändlig loop är inte svaret. */
const MAX_PAGES = 50;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const { data, error } = await fetchPage(offset, offset + PAGE_SIZE - 1);
    if (error) return { data: [], error };
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) return { data: all, error: null };
  }
  return { data: [], error: { message: `Perioden gav fler än ${MAX_PAGES * PAGE_SIZE} rader` } };
}

export async function GET(req: Request) {
  const fail = (status: number, code: string, message: string) => (
    isDocumentNavigation(req) ? documentErrorPage(status, message) : routeError(status, code, message)
  );

  try {
    const gate = await requirePermission('time.entry.read.all');
    if (gate.response || !gate.currentUser) {
      return isDocumentNavigation(req)
        ? documentErrorPage(gate.response?.status ?? 403, gate.response?.status === 401
          ? 'Du är inte inloggad. Logga in och försök igen.'
          : 'Du har inte behörighet till löneunderlaget.')
        : gate.response;
    }
    // Andra nyckeln prövas uttryckligen. Utan den svarar RPC:n med ett fel som hade blivit ett 500
    // om en ren behörighetsfråga.
    if (!can(await getEffectivePermissions(), 'time.approve')) {
      return fail(403, 'forbidden', 'Du har inte behörighet till löneunderlaget.');
    }

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      period: url.searchParams.get('period'),
      user_id: url.searchParams.get('user_id'),
      user_ids: url.searchParams.get('user_ids'),
    });
    if (!parsed.success) {
      return isDocumentNavigation(req)
        ? documentErrorPage(400, 'Ogiltig period eller person i länken.')
        : validationError(parsed.error);
    }

    const periodStart = periodStartOf(parsed.data.period);
    const range = periodRange(periodStart);
    const supabase = createSessionClient();

    // ⚠️ GEMENER. `zod.uuid()` släpper igenom versaler och Postgres jämför `uuid`
    // skiftlägesokänsligt, så databasen svarar med rader — men summarizePersons strikta
    // strängjämförelse (`entry.userId === userId`) filtrerar bort dem allihop. Utfallet hade varit
    // ett tomt löneunderlag med status 200 för någon som rapporterat hela månaden.
    //
    // `Set` och inte bara en map: `?user_id=X&user_ids=X,Y` är en giltig fråga som skulle gett X
    // TVÅ avsnitt i samma dokument — och ett löneunderlag där en person står med två gånger är
    // precis den sortens fel som läses som en dubbelutbetalning.
    const requested = [...new Set(
      [parsed.data.user_id, ...parsed.data.user_ids]
        .filter((value): value is string => !!value)
        .map((value) => value.toLowerCase()),
    )];

    const overview = await listTimeApprovalOverview(supabase, periodStart);
    if (overview.error) return fail(500, 'time_overview_failed', 'Kunde inte läsa periodens anställda.');

    const names = new Map<string, string | null>();
    const order: string[] = [];
    for (const raw of (overview.data ?? []) as Record<string, unknown>[]) {
      const row = normalizeOverviewRow(raw);
      const id = row.user_id.toLowerCase();
      names.set(id, row.full_name);
      order.push(id);
    }

    // Begärda id:n som inte finns i översikten faller bort i stället för att bli en sida med
    // "(namn saknas)": översikten ÄR urvalet den här ytan arbetar med, och ett id utanför den är en
    // inaktuell knapp eller en handskriven länk — inte en anställd vi ska skriva ut.
    const chosen = requested.length > 0 ? requested.filter((id) => names.has(id)) : order;
    if (requested.length > 0 && chosen.length === 0) {
      return fail(404, 'no_people', 'Ingen av de valda personerna finns i periodens underlag.');
    }

    // En enda person hämtas skopat; hela listan hämtas i ETT svep. Ett anrop per person hade blivit
    // femtio rundturer för en tjugomannastyrka, och attestlistan är redan ett sådant anrop i taget.
    const only = chosen.length === 1 ? chosen[0] : undefined;
    const [entries, compensations] = await Promise.all([
      readAllPages<TimeEntryRow>((from, to) =>
        listTimeEntries(supabase, range, { userId: only, slice: { from, to } }) as unknown as PromiseLike<PageResult<TimeEntryRow>>),
      readAllPages<CompensationItem>((from, to) =>
        listCompensations(supabase, range, { userId: only, slice: { from, to } }) as unknown as PromiseLike<PageResult<CompensationItem>>),
    ]);
    if (entries.error) return fail(500, 'time_entries_failed', 'Kunde inte läsa tidraderna.');
    if (compensations.error) return fail(500, 'time_compensations_failed', 'Kunde inte läsa ersättningarna.');

    const summarizable = entries.data.map(toSummarizableEntry);
    const people: PayrollPerson[] = chosen.map((userId) => ({
      userId,
      name: names.get(userId) ?? null,
      summary: summarizePerson(summarizable, range, userId),
      compensations: compensations.data.filter((item) => (item.user_id ?? '').toLowerCase() === userId),
    }));

    const bytes = await renderPayrollPdf({
      periodStart,
      people,
      printedOn: stockholmTodayISO(),
    });

    const filename = payrollFilename({
      periodStart,
      // Ett samlat underlag heter efter perioden och inte efter den första personen i bunten.
      name: people.length === 1 ? people[0].name : null,
    });

    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        // Löneunderlag ska aldrig komma ur en cache: perioden kan ha öppnats och rättats sedan sist.
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    // Renderas alltid lokalt, så ett fel här är vårt eget — oftast en fil under public/ som inte
    // följde med in i serverfunktionen (se outputFileTracingIncludes i next.config.js). Utan
    // loggningen blir det ett tyst 500.
    console.error('[loneunderlag-pdf] oväntat fel:', e instanceof Error ? e.stack ?? e.message : e);
    return fail(500, 'payroll_pdf_unexpected', 'Kunde inte skapa löneunderlaget. Försök igen.');
  }
}

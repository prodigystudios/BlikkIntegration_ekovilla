import type { SupabaseClient } from '@supabase/supabase-js';
import { followUpPortalJob } from './jobIntakeStore';
import {
  portalDocumentSources,
  sweepPortalJobDocuments,
  type PortalDocumentSources,
  type PortalJobDocumentsSweepSummary,
} from './jobDocumentsStore';
import { retryPortalFortnox, type PortalFortnoxRetrySummary } from './jobFortnoxRetry';
import { sweepPortalJobMessages, type PortalJobMessagesSweepSummary } from './jobMessagesStore';
import { sweepStoreOrderNotices, type StoreOrderNoticeSweepSummary } from './storeOrdersStore';
import { retryStoreOrderFortnox, storeOrderFortnoxDeps, type StoreOrderFortnoxDeps } from './storeOrderActions';
import { syncPortalJobs, type PortalJobSyncSummary } from './jobSync';
import { dispatchPortalOutbox, type OutboxDispatchSummary } from './outbox';

/**
 * Ett varv av portalens bakgrundsarbete (RESELLER_PORTAL_CRM_PLAN.md fas 4b). Körs av cron-routen varje minut i prod
 * och av "Skicka väntande nu" på portalsidan (testmiljön har ingen cron).
 *
 *   1. De markerade jobben räknas om och skillnaden köas (jobSync.ts). Meddelandena städas: ett svar som sparats men
 *      inte köats köas, och en notis om butikens meddelande som inte gick iväg görs om (jobMessagesStore.ts, fas 6).
 *   2. Kön skickas (outbox.ts). Gör ingenting när integrationen är av i miljön; då ligger händelserna kvar.
 *   3. Levererades något räknas jobben om en gång till: "planerad" köas först när "bekräftad" är levererad, och annars
 *      hade butiken fått den en minut senare.
 *   4. Dokumenten (jobDocumentsStore.ts, fas 7): den automatiska orderbekräftelsen efter en levererad bekräftelse,
 *      omförsöken och det som inte hann köas. Efter utskicket, eftersom en orderbekräftelse är tre Fortnox-anrop och
 *      statusen inte ska vänta på dem. Köades något skickas kön en gång till.
 *   5. Butiksbeställningarnas notiser som inte gick iväg (storeOrdersStore.ts, fas 8), inom samma startgräns som
 *      dokumenten och en egen tidsbudget: de köar inget, och statusen och dokumenten ska inte vänta på dem.
 *   6. Fortnox-omförsöken (jobFortnoxRetry.ts), sist: ett försök kan ta upp mot 40 s, och statusen ska inte vänta på
 *      dem. Bara så många som hinns inom tidsgränsen. Butiksbeställningarnas efter jobbens (storeOrderActions.ts,
 *      fas 8b), inom det som är kvar av samma gräns.
 *
 * Ett steg som kastar stoppar inte nästa; felet står i sammanfattningen.
 */

/** Hur länge ett varv får påbörja Fortnox-försök. Routen har 300 s; utskicket tar högst ~90 s, ett försök ~40 s. */
export const PORTAL_CRON_FORTNOX_START_BEFORE_MS = 150_000;
/** Samma gräns för dokumenten: tre orderbekräftelser är nio Fortnox-anrop. */
export const PORTAL_CRON_DOCUMENTS_START_BEFORE_MS = 150_000;
/**
 * Knapparna på portalsidan (fortnoxRetries: false) har 180 s. Dokumenten görs där också, eftersom testmiljön inte har
 * någon cron, men bara om varvet hunnit så här lite: byggena (~10 s) och utskicket efter dem (30 s + ett dokument på
 * 30 s) ryms då.
 */
export const PORTAL_CLICK_DOCUMENTS_START_BEFORE_MS = 60_000;
/** Knapparna på portalsidan påbörjar butiksbeställningarnas notiser i högst så här lång tid (cron: 20 s). */
export const PORTAL_CLICK_STORE_ORDER_NOTICES_BUDGET_MS = 5_000;
/** Utskicket efter dokumenten tar nya händelser i högst så här lång tid; ett dokument kan ta 30 s till. */
export const PORTAL_CRON_DOCUMENTS_DISPATCH_BUDGET_MS = 30_000;

export type PortalCronSummary = {
  sync: PortalJobSyncSummary | { error: string };
  messages: PortalJobMessagesSweepSummary | { error: string };
  storeOrderNotices: StoreOrderNoticeSweepSummary | { error: string };
  dispatch: OutboxDispatchSummary | { error: string };
  resync?: PortalJobSyncSummary | { error: string };
  redispatch?: OutboxDispatchSummary | { error: string };
  documents: PortalJobDocumentsSweepSummary | { error: string };
  documentsDispatch?: OutboxDispatchSummary | { error: string };
  fortnox: PortalFortnoxRetrySummary | { error: string };
  storeOrderFortnox: PortalFortnoxRetrySummary | { error: string };
};

async function step<T>(name: string, run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[portal-cron] ${name} föll`, { error: message });
    return { error: message };
  }
}

const sentSomething = (s: OutboxDispatchSummary | { error: string }) => 'ran' in s && s.ran && s.sent > 0;
const queuedSomething = (s: PortalJobSyncSummary | PortalJobDocumentsSweepSummary | { error: string }) =>
  'queued' in s && s.queued > 0;

export async function runPortalCron(
  admin: SupabaseClient,
  options: {
    env: Record<string, string | undefined>;
    now?: () => Date;
    fetchImpl?: typeof fetch;
    followUp?: (quoteId: string) => Promise<unknown>;
    /** false från knapparna på portalsidan: ett Fortnox-försök kan ta 40 s och hör hemma i cron, inte i ett klick. */
    fortnoxRetries?: boolean;
    /** Varifrån dokumenten läses (Fortnox, arkivet). Testerna ger egna. */
    documentSources?: PortalDocumentSources;
    /** Butiksbeställningarnas Fortnox-anrop. Testerna ger egna. */
    storeOrderFortnoxDeps?: StoreOrderFortnoxDeps;
  },
): Promise<PortalCronSummary> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().getTime();
  const dispatch = () => dispatchPortalOutbox(admin, { env: options.env, now, fetchImpl: options.fetchImpl });

  const summary: PortalCronSummary = {
    sync: await step('omräkningen', () => syncPortalJobs(admin, { now })),
    messages: await step('meddelandena', () => sweepPortalJobMessages(admin, { now })),
    dispatch: await step('utskicket', dispatch),
    storeOrderNotices: { candidates: 0, sent: 0, failed: 0, noRecipient: 0, errors: 0, deferred: 0 },
    documents: { created: 0, queued: 0, failed: 0, retried: 0, errors: 0 },
    fortnox: { due: 0, attempted: 0, gaveUp: 0, skipped: 0, errors: 0 },
    storeOrderFortnox: { due: 0, attempted: 0, gaveUp: 0, skipped: 0, errors: 0 },
  };
  if (sentSomething(summary.dispatch)) {
    summary.resync = await step('omräkningen efter utskicket', () => syncPortalJobs(admin, { now }));
    if (queuedSomething(summary.resync)) summary.redispatch = await step('utskicket efter omräkningen', dispatch);
  }
  const documentsStartBefore =
    options.fortnoxRetries === false ? PORTAL_CLICK_DOCUMENTS_START_BEFORE_MS : PORTAL_CRON_DOCUMENTS_START_BEFORE_MS;
  if (now().getTime() - startedAt < documentsStartBefore) {
    summary.documents = await step('dokumenten', () =>
      sweepPortalJobDocuments(admin, {
        now,
        sources: options.documentSources ?? portalDocumentSources(admin, options.env),
        // Ett bygge per klick: ett långsamt Fortnox (klienten har ingen tidsgräns) får inte dra klicket förbi 180 s.
        builds: options.fortnoxRetries === false ? 1 : undefined,
      }),
    );
    if (queuedSomething(summary.documents)) {
      summary.documentsDispatch = await step('utskicket efter dokumenten', () =>
        dispatchPortalOutbox(admin, {
          env: options.env,
          now,
          fetchImpl: options.fetchImpl,
          budgetMs: PORTAL_CRON_DOCUMENTS_DISPATCH_BUDGET_MS,
        }),
      );
    }
  }

  // Butiksbeställningarnas notiser efter dokumenten (orderbekräftelserna ska inte tappa tid), inom samma startgräns: ett
  // varv som redan tagit sin tid påbörjar inga, de väntar till nästa.
  if (now().getTime() - startedAt < documentsStartBefore) {
    summary.storeOrderNotices = await step('butiksbeställningarnas notiser', () =>
      sweepStoreOrderNotices(admin, {
        now,
        budgetMs: options.fortnoxRetries === false ? PORTAL_CLICK_STORE_ORDER_NOTICES_BUDGET_MS : undefined,
      }),
    );
  }

  const remaining = PORTAL_CRON_FORTNOX_START_BEFORE_MS - (now().getTime() - startedAt);
  if (options.fortnoxRetries !== false && remaining > 0) {
    summary.fortnox = await step('Fortnox-försöken', () =>
      retryPortalFortnox(admin, {
        followUp: options.followUp ?? ((quoteId) => followUpPortalJob(admin, quoteId)),
        now,
        budgetMs: remaining,
      }),
    );
  }
  const storeOrdersRemaining = PORTAL_CRON_FORTNOX_START_BEFORE_MS - (now().getTime() - startedAt);
  if (options.fortnoxRetries !== false && storeOrdersRemaining > 0) {
    summary.storeOrderFortnox = await step('butiksbeställningarnas Fortnox-försök', () =>
      retryStoreOrderFortnox(admin, {
        deps: { ...(options.storeOrderFortnoxDeps ?? storeOrderFortnoxDeps()), now },
        budgetMs: storeOrdersRemaining,
      }),
    );
  }
  return summary;
}

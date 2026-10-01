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
import { syncStoreOrders, type StoreOrderSyncSummary } from './storeOrderSync';
import { dispatchPortalOutbox, type OutboxDispatchSummary } from './outbox';
import { invitePricelistSources, sweepInvitePricelists, type InvitePricelistSources, type InvitePricelistSweepSummary } from './invitePricelistStore';
import { isPortalDatabaseAllowed, WRONG_DATABASE_MESSAGE } from './config';

/**
 * Ett varv av portalens bakgrundsarbete (RESELLER_PORTAL_CRM_PLAN.md fas 4b). Körs av cron-routen varje minut i prod
 * och av "Skicka väntande nu" på portalsidan (testmiljön har ingen cron).
 *
 *   1. De markerade jobben och butiksbeställningarna räknas om och skillnaden köas (jobSync.ts, storeOrderSync.ts,
 *      fas 8b3). Meddelandena städas: ett svar som sparats men inte köats köas, och en notis om butikens meddelande som
 *      inte gick iväg görs om (jobMessagesStore.ts, fas 6).
 *   2. Kön skickas (outbox.ts). Gör ingenting när integrationen är av i miljön; då ligger händelserna kvar.
 *   3. Levererades något räknas jobben och beställningarna om en gång till: det som följer "bekräftad" köas först när
 *      den är levererad, och annars hade butiken fått det en minut senare.
 *   3b. En ny butik vars inbjudan gått fram får sin egen lista (invitePricelistStore.ts, 10b3): efter utskicket, där
 *      inbjudan går fram. Köades en lista skickas kön en gång till. Kortet läses i Fortnox en gång per ny butik.
 *   4. Dokumenten (jobDocumentsStore.ts, fas 7): den automatiska orderbekräftelsen efter en levererad bekräftelse,
 *      omförsöken och det som inte hann köas. Efter utskicket, eftersom en orderbekräftelse är tre Fortnox-anrop och
 *      statusen inte ska vänta på dem. Köades något skickas kön en gång till.
 *   5. Butiksbeställningarnas notiser som inte gick iväg (storeOrdersStore.ts, fas 8), inom samma startgräns som
 *      dokumenten och en egen tidsbudget: de köar inget, och statusen och dokumenten ska inte vänta på dem.
 *   6. Fortnox-omförsöken (jobFortnoxRetry.ts), sist: ett försök kan ta upp mot 40 s, och statusen ska inte vänta på
 *      dem. Bara så många som hinns inom tidsgränsen. Butiksbeställningarnas (storeOrderActions.ts, fas 8b) först, ett
 *      per varv, så att jobb som fortsätter att falla inte tar hela gränsen varje varv.
 *
 * Ett steg som kastar stoppar inte nästa; felet står i sammanfattningen.
 *
 * 🧨 Mot fel databas utanför prod (`isPortalDatabaseAllowed`, T4b) körs INGET steg: utskicket svarar som en
 * avstängd integration med skälet, och de andra stegen bär skälet som fel.
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
  storeOrderSync: StoreOrderSyncSummary | { error: string };
  messages: PortalJobMessagesSweepSummary | { error: string };
  storeOrderNotices: StoreOrderNoticeSweepSummary | { error: string };
  dispatch: OutboxDispatchSummary | { error: string };
  resync?: PortalJobSyncSummary | { error: string };
  storeOrderResync?: StoreOrderSyncSummary | { error: string };
  redispatch?: OutboxDispatchSummary | { error: string };
  invitePricelists: InvitePricelistSweepSummary | { error: string };
  invitePricelistsDispatch?: OutboxDispatchSummary | { error: string };
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
const queuedSomething = (
  s:
    | PortalJobSyncSummary
    | StoreOrderSyncSummary
    | PortalJobDocumentsSweepSummary
    | InvitePricelistSweepSummary
    | { error: string }
    | undefined,
) => s !== undefined && 'queued' in s && s.queued > 0;

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
    /** Var de nya butikernas kort och listor läses (Fortnox). Testerna ger egna. */
    invitePricelistSources?: InvitePricelistSources;
  },
): Promise<PortalCronSummary> {
  if (!isPortalDatabaseAllowed(options.env)) {
    const skipped = { error: WRONG_DATABASE_MESSAGE };
    return {
      sync: skipped,
      storeOrderSync: skipped,
      messages: skipped,
      dispatch: { ran: false, reason: WRONG_DATABASE_MESSAGE },
      invitePricelists: skipped,
      storeOrderNotices: skipped,
      documents: skipped,
      fortnox: skipped,
      storeOrderFortnox: skipped,
    };
  }
  const now = options.now ?? (() => new Date());
  const startedAt = now().getTime();
  const dispatch = () => dispatchPortalOutbox(admin, { env: options.env, now, fetchImpl: options.fetchImpl });

  const summary: PortalCronSummary = {
    sync: await step('omräkningen', () => syncPortalJobs(admin, { now })),
    storeOrderSync: await step('butiksbeställningarnas omräkning', () => syncStoreOrders(admin, { now })),
    messages: await step('meddelandena', () => sweepPortalJobMessages(admin, { now })),
    dispatch: await step('utskicket', dispatch),
    invitePricelists: { candidates: 0, queued: 0, settled: 0, failed: 0, deferred: 0 },
    storeOrderNotices: { candidates: 0, sent: 0, failed: 0, noRecipient: 0, errors: 0, deferred: 0 },
    documents: { created: 0, queued: 0, failed: 0, retried: 0, errors: 0 },
    fortnox: { due: 0, attempted: 0, gaveUp: 0, skipped: 0, errors: 0 },
    storeOrderFortnox: { due: 0, attempted: 0, gaveUp: 0, skipped: 0, errors: 0 },
  };
  if (sentSomething(summary.dispatch)) {
    summary.resync = await step('omräkningen efter utskicket', () => syncPortalJobs(admin, { now }));
    summary.storeOrderResync = await step('butiksbeställningarnas omräkning efter utskicket', () => syncStoreOrders(admin, { now }));
    if (queuedSomething(summary.resync) || queuedSomething(summary.storeOrderResync)) {
      summary.redispatch = await step('utskicket efter omräkningen', dispatch);
    }
  }
  const documentsStartBefore =
    options.fortnoxRetries === false ? PORTAL_CLICK_DOCUMENTS_START_BEFORE_MS : PORTAL_CRON_DOCUMENTS_START_BEFORE_MS;
  // Efter utskicket: det är där inbjudan går fram. Två Fortnox-anrop per butik och klienten har ingen tidsgräns: samma
  // startgräns som dokumenten, och från knapparna en butik per klick.
  if (now().getTime() - startedAt < documentsStartBefore) {
    summary.invitePricelists = await step('butikernas listor efter inbjudan', () =>
      sweepInvitePricelists(admin, {
        now,
        env: options.env,
        sources: options.invitePricelistSources ?? invitePricelistSources(),
        limit: options.fortnoxRetries === false ? 1 : undefined,
      }),
    );
    if (queuedSomething(summary.invitePricelists)) {
      summary.invitePricelistsDispatch = await step('utskicket efter listorna', dispatch);
    }
  }
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

  // Butiksbeställningarnas Fortnox-försök före jobbens, ett per varv: annars hade jobb som fortsätter att falla tagit hela
  // tidsgränsen varje varv, och en bekräftad beställnings fönster på 24 h runnit ut utan ett enda försök.
  const storeOrdersRemaining = PORTAL_CRON_FORTNOX_START_BEFORE_MS - (now().getTime() - startedAt);
  if (options.fortnoxRetries !== false && storeOrdersRemaining > 0) {
    summary.storeOrderFortnox = await step('butiksbeställningarnas Fortnox-försök', () =>
      retryStoreOrderFortnox(admin, {
        deps: { ...(options.storeOrderFortnoxDeps ?? storeOrderFortnoxDeps(admin)), now },
        limit: 1,
        budgetMs: storeOrdersRemaining,
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
  return summary;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { followUpPortalJob } from './jobIntakeStore';
import { retryPortalFortnox, type PortalFortnoxRetrySummary } from './jobFortnoxRetry';
import { syncPortalJobs, type PortalJobSyncSummary } from './jobSync';
import { dispatchPortalOutbox, type OutboxDispatchSummary } from './outbox';

/**
 * Ett varv av portalens bakgrundsarbete (RESELLER_PORTAL_CRM_PLAN.md fas 4b). Körs av cron-routen varje minut i prod
 * och av "Skicka väntande nu" på portalsidan (testmiljön har ingen cron).
 *
 *   1. De markerade jobben räknas om och skillnaden köas (jobSync.ts).
 *   2. Kön skickas (outbox.ts). Gör ingenting när integrationen är av i miljön; då ligger händelserna kvar.
 *   3. Levererades något räknas jobben om en gång till: "planerad" köas först när "bekräftad" är levererad, och annars
 *      hade butiken fått den en minut senare.
 *   4. Fortnox-omförsöken (jobFortnoxRetry.ts), sist: ett försök kan ta upp mot 40 s, och statusen ska inte vänta på
 *      dem. Bara så många som hinns inom tidsgränsen.
 *
 * Ett steg som kastar stoppar inte nästa; felet står i sammanfattningen.
 */

/** Hur länge ett varv får påbörja Fortnox-försök. Routen har 300 s; utskicket tar högst ~70 s, ett försök ~40 s. */
export const PORTAL_CRON_FORTNOX_START_BEFORE_MS = 150_000;

export type PortalCronSummary = {
  sync: PortalJobSyncSummary | { error: string };
  dispatch: OutboxDispatchSummary | { error: string };
  resync?: PortalJobSyncSummary | { error: string };
  redispatch?: OutboxDispatchSummary | { error: string };
  fortnox: PortalFortnoxRetrySummary | { error: string };
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
const queuedSomething = (s: PortalJobSyncSummary | { error: string }) => 'queued' in s && s.queued > 0;

export async function runPortalCron(
  admin: SupabaseClient,
  options: {
    env: Record<string, string | undefined>;
    now?: () => Date;
    fetchImpl?: typeof fetch;
    followUp?: (quoteId: string) => Promise<unknown>;
    /** false från knapparna på portalsidan: ett Fortnox-försök kan ta 40 s och hör hemma i cron, inte i ett klick. */
    fortnoxRetries?: boolean;
  },
): Promise<PortalCronSummary> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().getTime();
  const dispatch = () => dispatchPortalOutbox(admin, { env: options.env, now, fetchImpl: options.fetchImpl });

  const summary: PortalCronSummary = {
    sync: await step('omräkningen', () => syncPortalJobs(admin, { now })),
    dispatch: await step('utskicket', dispatch),
    fortnox: { due: 0, attempted: 0, gaveUp: 0, skipped: 0, errors: 0 },
  };
  if (sentSomething(summary.dispatch)) {
    summary.resync = await step('omräkningen efter utskicket', () => syncPortalJobs(admin, { now }));
    if (queuedSomething(summary.resync)) summary.redispatch = await step('utskicket efter omräkningen', dispatch);
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

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fortnox-omförsöken för portalens jobb (RESELLER_PORTAL_CRM_PLAN.md fas 4b, William 2026-09-28): bara efter ett
 * TEKNISKT fel (Fortnox nere, anslutningen ute) eller en process som dog innan den hann, efter 5 min, 15 min, 1 h och
 * sedan varje timme, i 24 h. Sedan bara för hand ("Skicka till Fortnox"). Saknas något på kundkortet (kontrollerna
 * stoppar) försöker den aldrig: det kräver en människa, som före 4b.
 *
 * Kolumnerna i crm_portal_jobs: fortnox_next_attempt_at (null = inget planerat), fortnox_attempts (misslyckade tekniska
 * försök) och fortnox_retry_until. Utfallet bokförs av followUpPortalJob (jobIntakeStore.ts) efter varje försök, och av
 * kopplingen av kund (linkCustomer.ts). Säljaren fick notisen vid första felet och får ingen ny per försök.
 */

export type PortalFortnoxOutcome = 'exists' | 'created' | 'blocked' | 'failed' | 'in_progress' | 'skipped';

export const PORTAL_FORTNOX_RETRY_WINDOW_MS = 24 * 3600_000;
/** Skyddsnätet: om processen dör efter svaret till portalen, innan Fortnox-försöket hunnits, görs det om efter 5 min. */
export const PORTAL_FORTNOX_SAFETY_NET_MS = 5 * 60_000;
/** Hur länge ett pågående försök (utskicket, en annan push) får hålla jobbet innan nästa körning tar det. */
export const PORTAL_FORTNOX_LEASE_MS = 10 * 60_000;

const DELAY_MINUTES = [5, 15, 60];

/** Väntan efter `failures` misslyckade tekniska försök: 5 min, 15 min, sedan en timme. */
export function portalFortnoxRetryDelayMs(failures: number): number {
  const n = Math.max(1, Math.floor(failures));
  return DELAY_MINUTES[Math.min(n, DELAY_MINUTES.length) - 1] * 60_000;
}

export type PortalFortnoxRetryColumns = {
  fortnox_next_attempt_at: string | null;
  fortnox_attempts: number;
  fortnox_retry_until: string | null;
};

/** Skyddsnätet när arbetsordern skapas: ett försök om 5 min, om inte utfallet hunnit bokföras innan dess. */
export function portalFortnoxSafetyNet(now: Date): PortalFortnoxRetryColumns {
  return {
    fortnox_next_attempt_at: new Date(now.getTime() + PORTAL_FORTNOX_SAFETY_NET_MS).toISOString(),
    fortnox_attempts: 0,
    fortnox_retry_until: new Date(now.getTime() + PORTAL_FORTNOX_RETRY_WINDOW_MS).toISOString(),
  };
}

/**
 * Nästa steg efter ett utfall. Ren.
 *   exists / created / blocked / skipped   inget mer (klart, en människa behövs, eller ingen order)
 *   failed                                  ett misslyckat försök till; nästa efter väntan, om fönstret räcker
 *   in_progress                             en annan push pågår; titta igen om 5 min, utan att räkna ett försök
 * `resendNotice`: en notis gick inte att skicka. Då görs ett varv till om 5 min när Fortnox-ordern finns, så att
 * notisen kommer fram (den skickas en gång, så ett extra varv gör inget mer). Aldrig för ett stoppat jobb.
 */
export function planPortalFortnoxRetry(input: {
  outcome: PortalFortnoxOutcome;
  attempts: number;
  retryUntil: string | null;
  now: Date;
  resendNotice?: boolean;
}): PortalFortnoxRetryColumns {
  const { outcome, now } = input;
  // Inget fönster, eller ett som gått ut: ett nytt fel (t.ex. när kunden kopplas dagar efter intaget) får ett eget
  // fönster på 24 h, räknat från nu och med försöken från noll.
  const stale = !input.retryUntil || new Date(input.retryUntil).getTime() < now.getTime();
  const until = stale ? new Date(now.getTime() + PORTAL_FORTNOX_RETRY_WINDOW_MS) : new Date(input.retryUntil as string);
  const within = (at: Date) => (at.getTime() <= until.getTime() ? at.toISOString() : null);

  if (outcome === 'failed') {
    const attempts = (stale ? 0 : input.attempts) + 1;
    return {
      fortnox_next_attempt_at: within(new Date(now.getTime() + portalFortnoxRetryDelayMs(attempts))),
      fortnox_attempts: attempts,
      fortnox_retry_until: until.toISOString(),
    };
  }
  const soon = within(new Date(now.getTime() + PORTAL_FORTNOX_SAFETY_NET_MS));
  // Ett varv till för en notis bara när Fortnox-ordern finns: ett varv på ett STOPPAT jobb hade pushat ordern om kortet
  // rättats under tiden, och ett stoppat jobb kräver en människa (William 2026-09-28).
  if (outcome === 'in_progress' || (input.resendNotice && (outcome === 'created' || outcome === 'exists'))) {
    return { fortnox_next_attempt_at: soon, fortnox_attempts: input.attempts, fortnox_retry_until: until.toISOString() };
  }
  return { fortnox_next_attempt_at: null, fortnox_attempts: input.attempts, fortnox_retry_until: input.retryUntil };
}

/** Bokför ett utfall på jobbet. Kastar när databasen inte svarar. */
export async function recordPortalFortnoxOutcome(
  admin: SupabaseClient,
  quoteId: string,
  outcome: PortalFortnoxOutcome,
  now: Date,
  options: { resendNotice?: boolean } = {},
): Promise<PortalFortnoxRetryColumns | null> {
  const read = await admin
    .from('crm_portal_jobs')
    .select('fortnox_attempts, fortnox_retry_until')
    .eq('quote_id', quoteId)
    .maybeSingle();
  if (read.error) throw new Error(`Jobbets Fortnox-försök gick inte att läsa: ${read.error.message}`);
  const row = read.data as { fortnox_attempts: number | null; fortnox_retry_until: string | null } | null;
  if (!row) return null;
  const plan = planPortalFortnoxRetry({
    outcome,
    attempts: row.fortnox_attempts ?? 0,
    retryUntil: row.fortnox_retry_until,
    now,
    resendNotice: options.resendNotice,
  });
  const saved = await admin.from('crm_portal_jobs').update(plan).eq('quote_id', quoteId);
  if (saved.error) throw new Error(`Jobbets Fortnox-försök kunde inte bokföras: ${saved.error.message}`);
  if (outcome === 'failed' && plan.fortnox_next_attempt_at === null) {
    console.warn('[portal-fortnox] omförsöken ges upp; bara för hand nu', { quoteId, attempts: plan.fortnox_attempts });
  }
  return plan;
}

export type PortalFortnoxRetrySummary = { due: number; attempted: number; gaveUp: number; skipped: number; errors: number };

/**
 * Försöker igen där det är dags. Varje jobb tas med ett lån (nästa försök flyttas fram 10 min, bara om det står kvar
 * som vi läste det), så att två samtidiga körningar aldrig gör samma push. `followUp` är followUpPortalJob, som gör
 * försöket och bokför utfallet; injicerad, eftersom jobIntakeStore.ts importerar den här filen.
 */
export async function retryPortalFortnox(
  admin: SupabaseClient,
  deps: { followUp: (quoteId: string) => Promise<unknown>; now?: () => Date; limit?: number; budgetMs?: number },
): Promise<PortalFortnoxRetrySummary> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().getTime();
  const summary: PortalFortnoxRetrySummary = { due: 0, attempted: 0, gaveUp: 0, skipped: 0, errors: 0 };

  const { data, error } = await admin
    .from('crm_portal_jobs')
    .select('quote_id, fortnox_next_attempt_at, fortnox_retry_until')
    .lte('fortnox_next_attempt_at', now().toISOString())
    .order('fortnox_next_attempt_at', { ascending: true })
    .limit(deps.limit ?? 2);
  if (error) throw new Error(`Fortnox-försöken gick inte att läsa: ${error.message}`);
  const due = (data ?? []) as { quote_id: string; fortnox_next_attempt_at: string; fortnox_retry_until: string | null }[];
  summary.due = due.length;

  for (const job of due) {
    if (deps.budgetMs !== undefined && now().getTime() - startedAt >= deps.budgetMs) break;
    const at = now();
    const expired = job.fortnox_retry_until !== null && at.getTime() > new Date(job.fortnox_retry_until).getTime();
    const lease = await admin
      .from('crm_portal_jobs')
      .update({ fortnox_next_attempt_at: expired ? null : new Date(at.getTime() + PORTAL_FORTNOX_LEASE_MS).toISOString() })
      .eq('quote_id', job.quote_id)
      .eq('fortnox_next_attempt_at', job.fortnox_next_attempt_at)
      .select('quote_id');
    if (lease.error) {
      summary.errors += 1;
      console.error('[portal-fortnox] jobbet kunde inte tas', { quoteId: job.quote_id, error: lease.error.message });
      continue;
    }
    if ((lease.data ?? []).length === 0) {
      summary.skipped += 1; // en annan körning hann först
      continue;
    }
    if (expired) {
      summary.gaveUp += 1;
      console.warn('[portal-fortnox] omförsöken ges upp; bara för hand nu', { quoteId: job.quote_id });
      continue;
    }
    try {
      await deps.followUp(job.quote_id);
      summary.attempted += 1;
    } catch (e) {
      summary.errors += 1;
      console.error('[portal-fortnox] försöket föll', { quoteId: job.quote_id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return summary;
}

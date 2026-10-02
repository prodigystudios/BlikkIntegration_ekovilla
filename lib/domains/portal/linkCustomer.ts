import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateWorkOrderReadiness, type WorkOrderReadinessIssue } from '@/lib/domains/crm/workOrderReadiness';
import { FortnoxNotConnectedError, FortnoxPushInProgressError, friendlyFortnoxMessage, WorkOrderCancelledError } from '@/lib/domains/fortnox/client';
import { pushWorkOrderToFortnox, type PushOrderResult } from '@/lib/domains/fortnox/orders';
import { JOB_CUSTOMER_SELECT, buildPortalCustomerLinkUpdate, type JobCustomerCard, type LinkableWorkOrder } from './jobIntake';
import { recordPortalFortnoxOutcome, type PortalFortnoxOutcome } from './jobFortnoxRetry';

/**
 * Butikens kundkort kopplas på en portalorder utan kund, och Fortnox-ordern skapas (RESELLER_PORTAL_CRM_PLAN.md
 * fas 3c). Ett jobb utan kundnummer, eller med ett nummer som inte finns i kundregistret, blir en arbetsorder utan
 * kund; utan kund når den aldrig Fortnox.
 *
 * Williams beslut 2026-09-28:
 *   - Den som har ordern, eller en admin, kopplar: samma som får redigera arbetsordern (RLS på crm_work_orders), med
 *     crm.workorder.write (routen).
 *   - Butiken är kunden, det är butiken Ekovilla fakturerar. Ett privatkundskort nekas.
 *   - Saknar kortet något som kontrollen kräver (org.nr, telefon …) nekas kopplingen med listan, och ingenting sparas.
 *     Kopplingen och Fortnox-ordern görs i ett steg, så en portalorder når aldrig Fortnox förbi kontrollen.
 *   - Kopplingen sparas också på butiken och gäller nästa jobb när portalens nummer saknas eller är okänt.
 *
 * Två klienter, med flit:
 *   sessionen      arbetsordern och kundkortet. RLS avgör vem som ser dem och vem som får ändra ordern.
 *   service-rollen jobbets och butikens rader (bara service_role skriver dem), efter att sessionen fått ändra ordern.
 *                  Se "Reviewed elevations" i SUPABASE_CONVENTIONS.md.
 */

export type LinkPortalCustomerResult =
  /** Ingen arbetsorder som sessionen ser, eller ingen portalorder. */
  | { kind: 'not_found' }
  | { kind: 'already_linked' }
  | { kind: 'in_fortnox' }
  | { kind: 'customer_not_found' }
  /** Ett privatkundskort: butiken är ett företag. */
  | { kind: 'not_business' }
  /** Kortet saknar något som kontrollen kräver. Ingenting sparat. */
  | { kind: 'incomplete'; blockers: WorkOrderReadinessIssue[] }
  /** Sessionen ser ordern men får inte ändra den: varken ansvarig eller admin. */
  | { kind: 'forbidden' }
  /** Ordern sparades av någon annan medan kopplingen förbereddes. Ingenting sparat; försök igen. */
  | { kind: 'changed' }
  | { kind: 'linked'; fortnoxOrderNumber: string | null; fortnoxError: string | null; storeLinked: boolean };

export type LinkPortalCustomerDeps = {
  push: (workOrderId: string) => Promise<PushOrderResult>;
  now: () => Date;
};

const WORK_ORDER_SELECT =
  'id, customer_id, fortnox_order_number, quote_type, customer_snapshot, line_items, rot_details, internal_handoff, updated_at';

type LinkWorkOrderRow = LinkableWorkOrder & {
  id: string;
  customer_id: string | null;
  fortnox_order_number: string | null;
  quote_type: 'private' | 'business';
  internal_handoff: Record<string, unknown> | null;
  updated_at: string;
};

export async function linkPortalJobCustomer(
  session: SupabaseClient,
  admin: SupabaseClient,
  input: { workOrderId: string; customerId: string; actorId: string },
  deps: LinkPortalCustomerDeps = { push: pushWorkOrderToFortnox, now: () => new Date() },
): Promise<LinkPortalCustomerResult> {
  const woRead = await session.from('crm_work_orders').select(WORK_ORDER_SELECT).eq('id', input.workOrderId).maybeSingle();
  if (woRead.error) throw new Error(`Arbetsordern gick inte att läsa: ${woRead.error.message}`);
  const workOrder = woRead.data as LinkWorkOrderRow | null;
  if (!workOrder) return { kind: 'not_found' };

  // Service-rollen, först när sessionen visat att den ser ordern: sessionen läser bara brickans kolumner i jobbet.
  const jobRead = await admin
    .from('crm_portal_jobs')
    .select('quote_id, reseller_id')
    .eq('work_order_id', input.workOrderId)
    .maybeSingle();
  if (jobRead.error) throw new Error(`Portaljobbet gick inte att läsa: ${jobRead.error.message}`);
  const job = jobRead.data as { quote_id: string; reseller_id: string } | null;
  if (!job) return { kind: 'not_found' };

  if (workOrder.customer_id) return { kind: 'already_linked' };
  if (workOrder.fortnox_order_number) return { kind: 'in_fortnox' };

  const cardRead = await session.from('crm_customers').select(JOB_CUSTOMER_SELECT).eq('id', input.customerId).maybeSingle();
  if (cardRead.error) throw new Error(`Kundkortet gick inte att läsa: ${cardRead.error.message}`);
  const card = cardRead.data as JobCustomerCard | null;
  if (!card) return { kind: 'customer_not_found' };
  if (card.customer_type !== 'business') return { kind: 'not_business' };

  // Samma kontroll som våra egna ordrar, på ordern som den blir med kortet.
  const update = buildPortalCustomerLinkUpdate(workOrder, card);
  const readiness = evaluateWorkOrderReadiness({ ...workOrder, ...update } as Parameters<typeof evaluateWorkOrderReadiness>[0], card);
  if (!readiness.ready) return { kind: 'incomplete', blockers: readiness.blockers };

  // Sessionen ändrar ordern: RLS släpper bara den ansvariga och admin. Bara om den fortfarande saknar kund och
  // Fortnox-order, och inte har sparats sedan den lästes: uppdateringen skriver hela snapshoten, och en märkning eller
  // kontakt som någon sparade under tiden hade annars försvunnit utan att någon märkt det.
  const saved = await session
    .from('crm_work_orders')
    .update(update)
    .eq('id', input.workOrderId)
    .eq('updated_at', workOrder.updated_at)
    .is('customer_id', null)
    .is('fortnox_order_number', null)
    .select('id');
  if (saved.error) throw new Error(`Kunden kunde inte kopplas: ${saved.error.message}`);
  if ((saved.data ?? []).length === 0) {
    // Ingen rad ändrad: någon hann före, eller så får sessionen inte ändra ordern. UPDATE svarar utan fel i båda fallen.
    const again = await session
      .from('crm_work_orders')
      .select('customer_id, fortnox_order_number, updated_at')
      .eq('id', input.workOrderId)
      .maybeSingle();
    if (again.error) throw new Error(`Arbetsordern gick inte att läsa: ${again.error.message}`);
    const now = again.data as { customer_id: string | null; fortnox_order_number: string | null; updated_at: string } | null;
    if (!now) return { kind: 'not_found' };
    if (now.customer_id) return { kind: 'already_linked' };
    if (now.fortnox_order_number) return { kind: 'in_fortnox' };
    if (now.updated_at !== workOrder.updated_at) return { kind: 'changed' };
    return { kind: 'forbidden' };
  }

  // Jobbet och butiken. Ordern är redan kopplad här: ett fel stoppar inte Fortnox-ordern, men loggas och sägs.
  const at = deps.now().toISOString();
  const [jobSaved, storeSaved] = await Promise.all([
    admin.from('crm_portal_jobs').update({ customer_id: card.id }).eq('quote_id', job.quote_id).select('quote_id'),
    admin
      .from('crm_portal_resellers')
      .update({ customer_id: card.id, customer_linked_by: input.actorId, customer_linked_at: at })
      .eq('reseller_id', job.reseller_id)
      .select('reseller_id'),
  ]);
  if (jobSaved.error) console.error('[portal-link] jobbets kund sparades inte', { quoteId: job.quote_id, error: jobSaved.error.message });
  const storeLinked = !storeSaved.error && (storeSaved.data ?? []).length > 0;
  if (!storeLinked) {
    console.error('[portal-link] butikens koppling sparades inte', { resellerId: job.reseller_id, error: storeSaved.error?.message });
  }

  let fortnoxOrderNumber: string | null = null;
  let fortnoxError: string | null = null;
  let outcome: PortalFortnoxOutcome = 'created';
  try {
    const pushed = await deps.push(input.workOrderId);
    fortnoxOrderNumber = pushed.fortnox_order_number;
    if (pushed.mirrorFailed) {
      fortnoxError = 'Fortnox-ordern skapades, men en ändring som sparades under tiden kom inte med. Synka om arbetsordern.';
    }
  } catch (e) {
    // En avbruten arbetsorder skapas inte i Fortnox (fortnox/workOrderCancel.ts): inget fel, inga omförsök.
    outcome = e instanceof FortnoxPushInProgressError ? 'in_progress' : e instanceof WorkOrderCancelledError ? 'skipped' : 'failed';
    fortnoxError =
      e instanceof FortnoxNotConnectedError || e instanceof FortnoxPushInProgressError || e instanceof WorkOrderCancelledError
        ? friendlyFortnoxMessage(e)
        : `Fortnox svarade: ${friendlyFortnoxMessage(e)}`;
    console.error('[portal-link] Fortnox-ordern kunde inte skapas', { workOrderId: input.workOrderId, error: e instanceof Error ? e.message : String(e) });
  }
  // Ett tekniskt fel ger nya försök av cron-utskicket (fas 4b); kontrollen har redan passerat. Ett fel här ändrar inget
  // i kopplingen: då blir det bara inga omförsök, och "Skicka till Fortnox" finns kvar.
  try {
    await recordPortalFortnoxOutcome(admin, job.quote_id, outcome, deps.now());
  } catch (e) {
    console.error('[portal-link] Fortnox-försöket kunde inte bokföras', { quoteId: job.quote_id, error: e instanceof Error ? e.message : String(e) });
  }
  return { kind: 'linked', fortnoxOrderNumber, fortnoxError, storeLinked };
}

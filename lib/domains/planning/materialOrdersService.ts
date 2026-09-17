import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupplier, type MaterialSupplier } from './materialSuppliers';
import { listAllDepots } from './depots';
import { getDepotStockWithForecast } from './depotStock';
import type { OpsDepot } from './types';
import {
  composeOrder,
  composedEqualsStored,
  orderDeliveryState,
  orderWarnings,
  type ComposedOrder,
  type OrderLine,
  type OrderLineInput,
  type OrderLineProblem,
  type OrderWarning,
  type OtherLineInput,
} from './materialOrders';
import type { OrderEmailTemplateProblem } from './materialOrderEmail';
import {
  deleteDraft,
  expectedStatusesForOrders,
  findOpenOrderForSupplier,
  getOrder,
  insertDraft,
  listSentOrdersForSupplier,
  writeComposed,
  type MaterialOrder,
} from './materialOrdersStore';

// Materialbeställningarnas utkast: skapa, ändra, slänga och varna. Utskicket bor i ./materialOrdersSend.ts.
//
// Server-side. SESSIONSKLIENTEN — RLS kräver planning.depot.manage.

type DbError = { message: string; code?: string } | null;

export type DraftInput = {
  lines: OrderLineInput[];
  other_lines: OtherLineInput[];
  message: string | null;
};

export type ComposeFailure =
  | { kind: 'supplier_not_found' }
  | { kind: 'invalid'; lineProblems: OrderLineProblem[]; templateProblems: OrderEmailTemplateProblem[] }
  | { kind: 'db_error'; message: string };

/** Registret som en order sätts ihop ur: leverantören och alla depåer. */
export async function loadRegistry(
  supabase: SupabaseClient,
  supplierId: string,
): Promise<{ supplier: MaterialSupplier | null; depots: OpsDepot[]; error: DbError }> {
  const [s, d] = await Promise.all([getSupplier(supabase, supplierId), listAllDepots(supabase)]);
  if (s.error) return { supplier: null, depots: [], error: s.error };
  if (d.error) return { supplier: null, depots: [], error: d.error };
  return { supplier: s.data, depots: (d.data ?? []) as OpsDepot[], error: null };
}

/** Sätt ihop en order ur registret. Samma väg för Granska, Ändra och kontrollen före Skicka. */
export async function composeFromRegistry(
  supabase: SupabaseClient,
  input: DraftInput & { supplierId: string; orderNo: number; composedByName: string; today: string; env: Record<string, string | undefined> },
): Promise<{ ok: true; composed: ComposedOrder; supplier: MaterialSupplier } | { ok: false; failure: ComposeFailure }> {
  const reg = await loadRegistry(supabase, input.supplierId);
  if (reg.error) return { ok: false, failure: { kind: 'db_error', message: reg.error.message } };
  if (!reg.supplier) return { ok: false, failure: { kind: 'supplier_not_found' } };
  const result = composeOrder({
    supplier: reg.supplier,
    depots: reg.depots,
    lines: input.lines,
    other_lines: input.other_lines,
    message: input.message,
    order_no: input.orderNo,
    composed_by_name: input.composedByName,
    today: input.today,
    env: input.env,
  });
  if (!result.ok) return { ok: false, failure: { kind: 'invalid', lineProblems: result.lineProblems, templateProblems: result.templateProblems } };
  return { ok: true, composed: result.order, supplier: reg.supplier };
}

export type CreateDraftResult =
  | { kind: 'created'; order: MaterialOrder }
  | { kind: 'open_order_exists'; order_id: string; order_no: number; status: string }
  | ComposeFailure;

/**
 * Granska: skapa ett utkast med ett renderat mail.
 *
 * Två skrivningar: ordernumret föds vid insert, och mailet (som bär numret) skrivs sedan. Faller den andra
 * slängs utkastet igen — ett tomt utkast hade spärrat fabriken utan att gå att skicka.
 *
 * Registret prövas FÖRE insert, så ett ogiltigt underlag aldrig lämnar ett tomt utkast som spärrar fabriken.
 */
export async function createDraft(
  supabase: SupabaseClient,
  input: DraftInput & {
    supplierId: string;
    actor: { id: string; name: string | null };
    today: string;
    env: Record<string, string | undefined>;
  },
): Promise<CreateDraftResult> {
  const composedByName = input.actor.name?.trim() || 'Ekovilla';
  // Provrendering med ett tillfälligt nummer: fångar ogiltiga rader och mallfel innan något skrivs.
  const probe = await composeFromRegistry(supabase, { ...input, orderNo: 0, composedByName });
  if (!probe.ok) return probe.failure;

  const inserted = await insertDraft(supabase, { supplierId: input.supplierId, actorUserId: input.actor.id, actorName: input.actor.name });
  if (inserted.error) {
    if (inserted.error.code === '23505') {
      const open = await findOpenOrderForSupplier(supabase, input.supplierId);
      if (open.data) return { kind: 'open_order_exists', order_id: open.data.id, order_no: open.data.order_no, status: open.data.status };
    }
    return { kind: 'db_error', message: inserted.error.message };
  }
  const draft = inserted.data!;

  const composed = await composeFromRegistry(supabase, { ...input, orderNo: draft.order_no, composedByName });
  const written = composed.ok ? await writeComposed(supabase, draft.id, draft.revision, composed.composed) : null;
  if (!composed.ok || !written || written.error || !written.data) {
    // ⚠️ Ett tomt utkast får inte bli kvar: det spärrar fabriken ("en öppen order per leverantör") utan att
    // gå att skicka. Släng det innan felet rapporteras.
    await deleteDraft(supabase, draft.id).catch(() => {});
    if (!composed.ok) return composed.failure;
    return { kind: 'db_error', message: written?.error?.message ?? 'Utkastet ändrades medan det skapades' };
  }
  return { kind: 'created', order: written.data };
}

export type UpdateDraftResult =
  | { kind: 'updated'; order: MaterialOrder }
  | { kind: 'not_found' }
  | { kind: 'not_draft'; status: string }
  | { kind: 'revision_changed'; order: MaterialOrder }
  | ComposeFailure;

/** Ändra ett utkast: sätt ihop hela ordern igen ur registret och skriv den på revisionen läsaren såg. */
export async function updateDraft(
  supabase: SupabaseClient,
  input: DraftInput & { orderId: string; revision: number; actorName: string | null; today: string; env: Record<string, string | undefined> },
): Promise<UpdateDraftResult> {
  const current = await getOrder(supabase, input.orderId);
  if (current.error) return { kind: 'db_error', message: current.error.message };
  if (!current.data) return { kind: 'not_found' };
  const order = current.data;
  if (order.status !== 'draft') return { kind: 'not_draft', status: order.status };
  if (!order.supplier_id) return { kind: 'supplier_not_found' };
  if (order.revision !== input.revision) return { kind: 'revision_changed', order };

  const composed = await composeFromRegistry(supabase, {
    ...input,
    supplierId: order.supplier_id,
    orderNo: order.order_no,
    composedByName: input.actorName?.trim() || 'Ekovilla',
  });
  if (!composed.ok) return composed.failure;
  // Oförändrat (t.ex. Granska igen för att se varningarna): inget att skriva. Databasen vägrar dessutom
  // revision+1 utan innehållsändring, och det hade blivit ett 500.
  if (composedEqualsStored(order as unknown as Record<string, unknown>, composed.composed)) {
    return { kind: 'updated', order };
  }
  const written = await writeComposed(supabase, order.id, input.revision, composed.composed);
  if (written.error) return { kind: 'db_error', message: written.error.message };
  if (!written.data) {
    const fresh = await getOrder(supabase, order.id);
    return fresh.data ? { kind: 'revision_changed', order: fresh.data } : { kind: 'not_found' };
  }
  return { kind: 'updated', order: written.data };
}

export async function discardDraft(supabase: SupabaseClient, orderId: string): Promise<{ kind: 'deleted' | 'not_draft' } | { kind: 'db_error'; message: string }> {
  const r = await deleteDraft(supabase, orderId);
  if (r.error) return { kind: 'db_error', message: r.error.message };
  return { kind: r.deleted ? 'deleted' : 'not_draft' };
}

/** Stockraderna som klientens inmatning igen — för att sätta ihop en lagrad order på nytt. */
export function draftInputOf(order: Pick<MaterialOrder, 'lines' | 'other_lines' | 'message'>): DraftInput {
  return {
    lines: order.lines.map((l: OrderLine) => ({ depot_id: l.depot_id, material: l.material, sacks: l.sacks, requested_on: l.requested_on })),
    other_lines: order.other_lines.map((o) => ({ text: o.text, depot_id: o.depot_id })),
    message: order.message,
  };
}

/**
 * Varningarna för en order. Prognosen och de tidigare ordrarna läses här.
 *
 * ⚠️ Ett läsfel blir en VARNING, aldrig ett tyst "inget att varna om": en felande prognos ger
 * forecast_unavailable, en felande läsning av tidigare ordrar earlier_orders_unknown.
 */
export async function warningsForOrder(
  supabase: SupabaseClient,
  order: Pick<MaterialOrder, 'id' | 'supplier_id' | 'lines'>,
  supplier: Pick<MaterialSupplier, 'lead_time_days'>,
  today: string,
): Promise<OrderWarning[]> {
  const stock = await getDepotStockWithForecast(supabase, today).catch(() => null);
  const forecast = stock && !stock.error && stock.forecast ? { rows: stock.forecast.rows, excludedCount: stock.forecast.excluded.length } : null;

  let openEarlier: number[] = [];
  let earlierOrdersUnknown = false;
  if (order.supplier_id) {
    const sent = await listSentOrdersForSupplier(supabase, order.supplier_id);
    const earlier = sent.data.filter((o) => o.id !== order.id);
    const statuses = sent.error ? null : await expectedStatusesForOrders(supabase, earlier.map((o) => o.id));
    if (sent.error || !statuses || statuses.error) {
      earlierOrdersUnknown = true;
    } else {
      openEarlier = earlier
        .filter((o) => {
          const state = orderDeliveryState(statuses.data.get(o.id) ?? []);
          return state === 'waiting' || state === 'partial';
        })
        .map((o) => o.order_no);
    }
  }

  return orderWarnings({ lines: order.lines, forecast, leadTimeDays: supplier.lead_time_days, today, openEarlierOrders: openEarlier, earlierOrdersUnknown });
}

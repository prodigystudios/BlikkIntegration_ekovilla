import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmWorkOrder, updateCrmWorkOrder, listWorkOrderInvoiceRounds, redactWorkOrderForField } from '@/lib/domains/crm/work-orders';
import { syncWorkOrderHeaderToFortnox } from '@/lib/domains/fortnox/orders';
import { FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { isNoRowsError, ok, pickProvidedFields, requireCrmUser, requirePermission, requireSignedInUser, routeError, updateCrmWorkOrderSchema, validationError } from '../_lib';

// Fakturastatus is system-managed (set by the invoice/delfakturering flow), never chosen
// by hand — so a crafted PATCH can't fake a billed order or regress one back to a manual state.
const SYSTEM_MANAGED_WO_STATUSES: string[] = ['invoiced', 'partially_invoiced'];

// The edited fields that Fortnox mirrors on the order header: contact person → YourReference,
// work address → delivery address, ansvarig → OurReference. Gating on these keeps a status-only
// PATCH — the board sends one on every drag — from becoming a Fortnox write.
const FORTNOX_MIRRORED_FIELDS = ['contact', 'work_address', 'assigned_to'] as const;

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    // Read is open to any signed-in employee (installers/member read the field view);
    // editing (PATCH below) stays restricted to CRM roles.
    const currentUser = await requireSignedInUser();
    if (currentUser.response) return currentUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getCrmWorkOrder(supabase, context.params.id);

    if (error) return routeError(404, 'crm_work_order_not_found', error.message);

    // Installers reach this through the crew RLS policy, which is row-level and therefore cannot
    // keep personnummer or order economics out of the payload — that line is drawn here instead.
    // Office roles (sales/admin/konsult) get the full row as before.
    if (currentUser.currentUser?.role === 'member') {
      return ok({ item: redactWorkOrderForField(data as Record<string, unknown>), rounds: [] });
    }

    // Delfakturering rounds (empty for orders never partially invoiced) so the detail page can
    // render the invoice history on load.
    const { data: rounds } = await listWorkOrderInvoiceRounds(supabase, context.params.id);

    return ok({ item: data, rounds: rounds ?? [] });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_fetch_unexpected', e?.message || 'Failed to fetch work order');
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.workorder.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const rawBody = await req.json().catch(() => null);
    const parsedBody = updateCrmWorkOrderSchema.safeParse(rawBody);
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    // Persist only fields the client actually sent, so a partial PATCH (e.g. a status-only
    // change) doesn't wipe untouched columns (internal_handoff, work_address) with defaults.
    const updateInput = pickProvidedFields(parsedBody.data, rawBody);

    // Read before the merge below deletes `contact` off updateInput.
    const touchesFortnox = FORTNOX_MIRRORED_FIELDS.some((field) => field in updateInput);

    // Load the current row once — both the contact-snapshot merge and the status guard need it.
    type WoCurrent = { status?: string | null; customer_snapshot?: Record<string, unknown> | null };
    let current: WoCurrent | null = null;
    if (updateInput.contact || updateInput.status) {
      current = (await getCrmWorkOrder(supabase, context.params.id)).data as WoCurrent | null;
    }

    // Contact override: merge into the (jsonb) customer_snapshot with a read-merge-write so the
    // other snapshot fields (personnummer, addresses, reverse_vat, end-contact) are preserved.
    // Lets a seller fix the responsible contact if it changed after the offer.
    if (updateInput.contact) {
      const snapshot = (current?.customer_snapshot ?? {}) as Record<string, unknown>;
      (updateInput as Record<string, unknown>).customer_snapshot = {
        ...snapshot,
        contact_name: updateInput.contact.contact_name ?? null,
        email: updateInput.contact.email ?? null,
        phone: updateInput.contact.phone ?? null,
      };
      delete (updateInput as { contact?: unknown }).contact;
    }

    // System-managed status guard — only a real TRANSITION is blocked. The client always sends
    // the current status alongside a contact/address/notes edit; re-sending it is a no-op, so
    // those edits still work on a billed order (they'd otherwise be wrongly rejected).
    if (updateInput.status && updateInput.status !== current?.status) {
      // Fakturastatus is set by the invoicing flow, never chosen manually…
      if (SYSTEM_MANAGED_WO_STATUSES.includes(updateInput.status)) {
        return routeError(409, 'crm_work_order_status_system_managed',
          'Fakturastatus sätts automatiskt vid fakturering och kan inte väljas manuellt.');
      }
      // …and a billed order can't be regressed to a manual status either.
      if (current?.status && SYSTEM_MANAGED_WO_STATUSES.includes(current.status)) {
        return routeError(409, 'crm_work_order_locked',
          'Ordern är fakturerad och statusen kan inte ändras manuellt.');
      }
    }

    const { data, error } = await updateCrmWorkOrder(supabase, context.params.id, updateInput);

    if (error) {
      // 0 rows = the order is missing OR the caller isn't its assigned owner (UPDATE RLS is
      // owner/admin, SELECT is open to all CRM readers) — answer 403/404 rather than a raw 500.
      if (isNoRowsError(error)) {
        const { data: existing } = await getCrmWorkOrder(supabase, context.params.id);
        return existing
          ? routeError(403, 'crm_work_order_forbidden', 'Du kan bara redigera arbetsorder du är ansvarig för.')
          : routeError(404, 'crm_work_order_not_found', 'Arbetsorder hittades inte.');
      }
      return routeError(500, 'crm_work_order_update_failed', error.message);
    }

    // Mirror the edit onto the Fortnox order header. Non-fatal, exactly like the article route:
    // the save has already succeeded, and a Fortnox outage must not make it look like it didn't.
    // The reason is handed back so the UI can say the save landed but the sync didn't.
    let fortnoxError: string | null = null;
    let synced = false;
    if (touchesFortnox) {
      try {
        synced = (await syncWorkOrderHeaderToFortnox(context.params.id)) !== null;
      } catch (e) {
        if (!(e instanceof FortnoxNotConnectedError)) {
          fortnoxError = friendlyFortnoxMessage(e);
          console.error('[fortnox] Arbetsorder-headersynk misslyckades:', (e as Error)?.message);
        }
      }
    }

    // Re-read only when Fortnox was actually touched, so the returned row carries the fresh
    // sync status/timestamp instead of the pre-sync one the update returned.
    if (synced || fortnoxError) {
      const fresh = await getCrmWorkOrder(supabase, context.params.id);
      return ok({ item: fresh.data ?? data, fortnox_error: fortnoxError });
    }

    return ok({ item: data, fortnox_error: null });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_update_unexpected', e?.message || 'Failed to update work order');
  }
}
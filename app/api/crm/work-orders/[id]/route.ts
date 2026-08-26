import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmWorkOrder, updateCrmWorkOrder, listWorkOrderInvoiceRounds, redactWorkOrderForField, getWorkOrderReportedSacks, getWorkOrderSourceQuote, mergeWorkOrderSnapshotOverrides, mergeWorkOrderRotDetails } from '@/lib/domains/crm/work-orders';
import { syncWorkOrderHeaderToFortnox, updateWorkOrderInFortnox } from '@/lib/domains/fortnox/orders';
import { FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { isNoRowsError, ok, pickProvidedFields, requireCrmUser, requirePermission, requireSignedInUser, routeError, updateCrmWorkOrderSchema, validationError } from '../_lib';

// Fakturastatus is system-managed (set by the invoice/delfakturering flow), never chosen by hand —
// so a crafted PATCH can't fake a billed order.
const SYSTEM_MANAGED_WO_STATUSES: string[] = ['invoiced', 'partially_invoiced'];

// …but only 'invoiced' is TERMINAL. A part-invoiced order is usually still being worked on, and
// `status` carries the work state, not the invoicing state — the two are independent facts that
// happen to share one column. Refusing to leave 'partially_invoiced' forced a running job to
// advertise itself as an invoicing state; the seller can now set it back to Pågående, and the
// fact that rounds exist is shown from the invoice history instead.
const TERMINAL_WO_STATUSES: string[] = ['invoiced'];

// The edited fields that Fortnox mirrors on the order header: Er referens → YourReference,
// work address → delivery address, ansvarig → OurReference. Gating on these keeps a status-only
// PATCH — the board sends one on every drag — from becoming a Fortnox write.
//
// `contact` and `end_contact` are deliberately ABSENT. Both are who we and the installers call —
// the customer's contact may be re-pointed at a site foreman mid-job, and the on-site end customer
// is a private person outside the customer card. Neither belongs on the customer's document.
// `contact` used to share a field with Er referens, which meant fixing a phone number silently
// rewrote the reference that routes the customer's invoice for approval. `end_contact` once rode
// along as a Remarks note (buildEndContactNote); that was removed, and Remarks isn't sent at all.
//
// `label` (Märkning) hör hit: den blir YourOrderNumber på Fortnox-ordern och står på kundens
// orderbekräftelse och faktura, så en rättning som stannar i CRM är precis den tysta drift som
// speglingen finns för att hindra.
const FORTNOX_MIRRORED_FIELDS = ['your_reference', 'work_address', 'assigned_to', 'label'] as const;

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

    // Kontorets extrafakta, hämtade parallellt med ordern. Alla tre ligger UTANFÖR `item` med
    // flit: PATCH-svaren returnerar bara arbetsordern, och ett fält som fanns på GET men saknas på
    // PATCH hade försvunnit ur vyn första gången någon sparade.
    //
    //  • rounds          — delfaktureringens historik (tom för ordrar som aldrig delfakturerats)
    //  • reported_sacks  — utblåsta säckar ur planeringens rapporter; null = ingen rapport alls
    //  • source_quote    — offertens nummer, så "Källa" kan visa en dokumentreferens
    const quoteId = (data as { quote_id?: string | null } | null)?.quote_id ?? null;
    const [{ data: rounds }, reportedSacks, sourceQuote] = await Promise.all([
      listWorkOrderInvoiceRounds(supabase, context.params.id),
      getWorkOrderReportedSacks(supabase, context.params.id),
      quoteId ? getWorkOrderSourceQuote(supabase, quoteId) : Promise.resolve(null),
    ]);

    return ok({ item: data, rounds: rounds ?? [], reported_sacks: reportedSacks, source_quote: sourceQuote });
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

    // Read before the merges below strip `contact`/`your_reference` off updateInput.
    const touchesFortnox = FORTNOX_MIRRORED_FIELDS.some((field) => field in updateInput);

    // ⚠️ ROT går INTE header-vägen. Uppgifterna delar sig i två halvor på dokumentet:
    // fastighetsbeteckningen blir headerns YourOrderNumber för en VILLA, men för en BOSTADSRÄTT
    // (BRF org.nr ifyllt) blir båda i stället en TEXTRAD — och header-synken släpper medvetet
    // radhalvan. Dessutom styr `enabled` husarbetesflaggan på varje artikelrad.
    //
    // Alltså full push. Ett villkor på "bara header när BRF saknas" hade varit en regel till att
    // hålla i synk med resolveRotReference, och den som glömmer den får en ändring som ser
    // sparad ut men aldrig når kundens dokument.
    const touchesRot = 'rot_details' in updateInput;

    // Load the current row once — the snapshot merges and the status guard all need it.
    type WoCurrent = {
      status?: string | null;
      customer_snapshot?: Record<string, unknown> | null;
      rot_details?: Record<string, unknown> | null;
      fortnox_order_number?: string | null;
      fortnox_invoice_number?: string | null;
    };
    let current: WoCurrent | null = null;
    const touchesSnapshot =
      Boolean(updateInput.contact) || updateInput.your_reference !== undefined
      || Boolean(updateInput.end_contact) || updateInput.label !== undefined;
    if (touchesSnapshot || touchesRot || updateInput.status) {
      const currentRead = await getCrmWorkOrder(supabase, context.params.id);
      // 🧨 FAIL-CLOSED PÅ LÄSFELET. Snapshoten skrivs read-merge-write, så en misslyckad läsning
      // gav `null` → merge mot `{}` → kolumnen ersattes av BARA överlagringarna. Personnummer,
      // org.nr, adresser och reverse_vat försvann alltså vid en tillfälligt trasig läsning, med
      // 200 tillbaka och ingenting i loggen. Personnumret är det som bär ROT hela vägen till
      // Fortnox, och byggmomsflaggan avgör 0 %-regimen — de får inte kunna tappas av en nätverksdipp.
      //
      // "Noll rader" är inte ett läsfel utan en saknad order — samma 404 som update-vägen nedan
      // svarar, så beteendet för en borttagen order är oförändrat.
      if (currentRead.error) {
        if (isNoRowsError(currentRead.error)) {
          return routeError(404, 'crm_work_order_not_found', 'Arbetsorder hittades inte.');
        }
        console.error('[crm] Arbetsorderläsning före snapshot-merge misslyckades:', currentRead.error.message);
        return routeError(503, 'crm_work_order_read_failed',
          'Kunde inte läsa arbetsordern just nu. Försök igen — ingenting har ändrats.');
      }
      current = currentRead.data as WoCurrent | null;
    }

    // Every snapshot override merges into the (jsonb) customer_snapshot with a read-merge-write so
    // the other snapshot fields (personnummer, addresses, reverse_vat) survive. The rule itself
    // lives in the domain (mergeWorkOrderSnapshotOverrides) — one merged object, so a PATCH
    // carrying several overrides doesn't have the later one drop the earlier.
    if (touchesSnapshot) {
      (updateInput as Record<string, unknown>).customer_snapshot = mergeWorkOrderSnapshotOverrides(
        current?.customer_snapshot,
        {
          contact: updateInput.contact,
          // Skickas bara vidare när klienten faktiskt sände fältet: `undefined` betyder "rör inte",
          // och `pickProvidedFields` har redan avgjort det åt oss.
          ...('your_reference' in updateInput ? { your_reference: updateInput.your_reference } : {}),
          ...('label' in updateInput ? { label: updateInput.label } : {}),
          end_contact: updateInput.end_contact,
        },
      );
      delete (updateInput as { contact?: unknown }).contact;
      delete (updateInput as { your_reference?: unknown }).your_reference;
      delete (updateInput as { end_contact?: unknown }).end_contact;
      delete (updateInput as { label?: unknown }).label;
    }

    // ROT-uppgifterna, samma read-merge-write. Regeln bor i domänen och bevarar applicant_name och
    // personal_number, som kommer ur kundkortet och inte redigeras här.
    //
    // 🧨 ROT-REGIMEN ÄR LÅST SÅ FORT ORDERN FINNS I FORTNOX. `TaxReductionType` sätts bara vid
    // create, och ett icke-ROT-dokument avvisar varje husarbetesfält med 2004021 — så att slå PÅ
    // ROT här hade sänkt varje efterföljande radsynk. Klienten döljer reglaget då, men spärren
    // måste stå här också: den som skickar en handskriven PATCH ska inte kunna låsa sin egen order.
    let rotChanged = false;
    if (touchesRot && updateInput.rot_details) {
      const currentRot = (current?.rot_details ?? {}) as Record<string, unknown>;
      const rot = mergeWorkOrderRotDetails(currentRot, updateInput.rot_details);

      // 🧨 ROT-REGIMEN ÄR LÅST SÅ FORT ORDERN FINNS I FORTNOX — ÅT BÅDA HÅLLEN.
      //
      // `TaxReductionType` sätts bara vid create. Att slå PÅ ROT efteråt är omöjligt (dokumentet är
      // 'none' och avvisar varje husarbetesfält med 2004021), och att slå AV det river
      // husarbetesflaggorna ur ett dokument som ÄR ett ROT-dokument — avdraget försvinner tyst från
      // kundens faktura. Formuläret döljer reglaget, men en flik som stod öppen innan ordern
      // pushades har det kvar, så spärren måste stå här.
      if (rot.enabledChanged && current?.fortnox_order_number) {
        return routeError(409, 'crm_work_order_rot_locked',
          'ROT-läget sätts när ordern skapas i Fortnox och kan inte ändras efteråt. Övriga ROT-uppgifter går att rätta.');
      }

      // Skriv bara när något faktiskt skiljer. Klienten skickar ROT-blocket vid varje sparning av
      // en privatorder, och en oförändrad sparning får varken röra kolumnen eller — viktigare —
      // dra igång den fulla Fortnox-pushen nedan.
      rotChanged = rot.changed;
      if (rotChanged) {
        (updateInput as Record<string, unknown>).rot_details = rot.merged;
        // En borttagen fastighetsbeteckning är en borttagen "Ert referensnummer" på en villa-order.
        // Samma minne som märkningen använder, av samma skäl: utan ett uttryckligt null står den
        // gamla beteckningen kvar på kundens dokument. Flaggan släcks av en genomförd PUT.
        if (rot.propertyCleared) {
          (updateInput as Record<string, unknown>).customer_snapshot = {
            ...((updateInput as { customer_snapshot?: Record<string, unknown> }).customer_snapshot
              ?? current?.customer_snapshot ?? {}),
            label_cleared: true,
          };
        }
      } else {
        delete (updateInput as { rot_details?: unknown }).rot_details;
      }
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
      // …and a FULLY invoiced order is closed and can't be regressed. A part-invoiced one can:
      // the job is often still running, and the invoicing progress is recorded in the rounds.
      if (current?.status && TERMINAL_WO_STATUSES.includes(current.status)) {
        return routeError(409, 'crm_work_order_locked',
          'Ordern är färdigfakturerad och statusen kan inte ändras.');
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
    // ⚠️ Den fulla pushen bara för en order som REDAN ligger i Fortnox och inte är fakturerad.
    //
    //  • Utan nummer skulle `updateWorkOrderInFortnox` falla tillbaka på create och alltså SKAPA
    //    dokumentet — en redigering på ordersidan får aldrig göra det (header-synken svarar null
    //    just därför). En order som ännu inte pushats får sin ROT vid create ändå.
    //  • En fakturerad order är stängd hos Fortnox: en rad-PUT avvisas, och statusen hade
    //    stämplats 'failed' av en sparning som egentligen bara rörde CRM.
    const rotPush = rotChanged
      && Boolean(current?.fortnox_order_number)
      && !current?.fortnox_invoice_number
      && current?.status !== 'invoiced';
    if (rotPush || touchesFortnox) {
      try {
        // ROT vinner över header-vägen när båda ändrats i samma sparning: den fulla pushen bär
        // headern också, så en header-synk därtill hade varit ett andra anrop som skriver samma
        // fält. Se touchesRot ovan för varför ROT inte kan gå header-vägen ensam.
        synced = rotPush
          ? Boolean(await updateWorkOrderInFortnox(context.params.id))
          : (await syncWorkOrderHeaderToFortnox(context.params.id)) !== null;
      } catch (e) {
        if (!(e instanceof FortnoxNotConnectedError)) {
          fortnoxError = friendlyFortnoxMessage(e);
          console.error('[fortnox] Arbetsordersynk misslyckades:', (e as Error)?.message);
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